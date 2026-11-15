import hashlib
import hmac
import json
import tempfile
import time
import unittest
import os
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from wallet_aura import (
    AuraClient, AuraService, prepare, process_inbox, reconcile, reconcile_pending,
    store_webhook, verify_signature,
)
from wallet_backend import ApiError, Ledger
from wallet_inbox import prepare as prepare_inbox
from wallet_aura_mock import MOCK_KEY, MOCK_PARTNER, make_app
from tests.test_wallet_backend import BOT, init_data


SECRET = "whsec_unit_test"


def signed(event, timestamp=None):
    raw = json.dumps(event, separators=(",", ":")).encode()
    timestamp = str(timestamp or int(time.time()))
    signature = hmac.new(SECRET.encode(), timestamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return raw, "t=" + timestamp + ",v1=" + signature


class AuraUnitTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.ledger = Ledger(self.tmp.name + "/db")
        prepare_inbox(self.ledger)
        prepare(self.ledger)
        self.uid = "tg:123"
        self.customer = self.ledger.account(self.uid)
        now = time.time()
        self.ledger.db.execute(
            "INSERT INTO aura_customers VALUES (?,?,?,?,?,?,?,?,?)",
            (self.uid, self.customer, "test", "registered", None, None, None, now, now),
        )

    def tearDown(self):
        self.ledger.book.verify()
        self.ledger.db.close()
        self.tmp.cleanup()

    def event(self, event_id="evt_one", deposit_id="dep_one", net="9", fee="1"):
        return {
            "event": "customer.deposit.confirmed", "event_id": event_id,
            "occurred_at": "2026-01-01T00:00:00Z", "partner_id": MOCK_PARTNER,
            "data": {
                "id": deposit_id, "customer_id": self.customer, "address_id": "addr_one",
                "currency": "USDT", "network": "nile", "status": "confirmed",
                "amount": str(int(net) + int(fee)), "fee": fee, "net_amount": net,
                "transaction_hash": "tx_one", "confirmations": 20,
                "confirmed_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            },
        }

    def test_signature_window_multiple_candidates_and_raw_bytes(self):
        raw, signature = signed(self.event())
        self.assertTrue(verify_signature(SECRET, raw, signature))
        self.assertTrue(verify_signature(SECRET, raw, signature + ",v1=" + "0" * 64))
        self.assertFalse(verify_signature(SECRET, raw + b" ", signature))
        old_raw, old_signature = signed(self.event(), int(time.time()) - 301)
        self.assertFalse(verify_signature(SECRET, old_raw, old_signature))

    def test_confirmed_deposit_is_atomic_namespaced_and_idempotent(self):
        event = self.event()
        raw, signature = signed(event)
        row, valid = store_webhook(
            self.ledger, raw, signature,
            {"X-Aura-Event": event["event"], "X-Aura-Event-Id": event["event_id"]},
            SECRET, MOCK_PARTNER,
        )
        self.assertTrue(valid)
        self.assertEqual(row["provider"], "aura")
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        self.assertEqual(process_inbox(self.ledger, "test"), 0)
        self.assertEqual(str(self.ledger.balance(self.uid, "USDT")[0]), "9")
        position = self.ledger.db.execute(
            "SELECT available FROM wallet_provider_positions WHERE provider='aura'"
        ).fetchone()
        self.assertEqual(position[0], "9")
        item = self.ledger.db.execute("SELECT * FROM aura_deposits").fetchone()
        self.assertEqual(item["status"], "confirmed")
        self.assertEqual(item["fee"], "1")
        self.assertEqual(
            self.ledger.db.execute("SELECT COUNT(*) FROM wallet_events").fetchone()[0], 1
        )

    def test_pending_then_confirmed_updates_without_double_credit(self):
        pending = self.event("evt_pending", "dep_progress")
        pending["event"] = "customer.deposit.pending"
        for key in ("fee", "net_amount", "confirmed_at"):
            pending["data"].pop(key, None)
        raw, signature = signed(pending)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        self.assertEqual(str(self.ledger.balance(self.uid, "USDT")[0]), "0")
        confirmed = self.event("evt_confirmed", "dep_progress")
        raw, signature = signed(confirmed)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        self.assertEqual(str(self.ledger.balance(self.uid, "USDT")[0]), "9")
        self.assertEqual(
            self.ledger.db.execute("SELECT status FROM aura_deposits").fetchone()[0],
            "confirmed",
        )

    def test_event_id_reuse_with_changed_body_is_quarantined(self):
        first = self.event()
        raw, signature = signed(first)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        changed = self.event(net="8", fee="2")
        raw, signature = signed(changed)
        _, valid = store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertFalse(valid)
        row = self.ledger.db.execute("SELECT * FROM wallet_webhook_inbox").fetchone()
        self.assertEqual(row["error"], "AURA_EVENT_ID_REUSED")
        self.assertEqual(process_inbox(self.ledger, "test"), 0)

    def test_bad_signature_cannot_poison_later_valid_delivery(self):
        event = self.event("evt_retry")
        raw, signature = signed(event)
        _, valid = store_webhook(self.ledger, raw, "t=1,v1=" + "0" * 64, {}, SECRET, MOCK_PARTNER)
        self.assertFalse(valid)
        _, valid = store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertTrue(valid)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        self.assertEqual(str(self.ledger.balance(self.uid, "USDT")[0]), "9")

    def test_kyc_webhook_updates_latest_state_idempotently(self):
        event = {
            "event": "customer.kyc.updated", "event_id": "evt_kyc",
            "occurred_at": "2026-01-01T00:02:00Z", "partner_id": MOCK_PARTNER,
            "data": {
                "customer_id": self.customer, "status": "verified",
                "verified": True, "terminal": True,
                "updated_at": "2026-01-01T00:02:00Z",
            },
        }
        raw, signature = signed(event)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        self.assertEqual(process_inbox(self.ledger, "test"), 0)
        state = self.ledger.db.execute(
            "SELECT * FROM aura_kyc_cases WHERE user_id=?", (self.uid,)
        ).fetchone()
        self.assertEqual(state["status"], "verified")
        self.assertEqual(state["verified"], 1)
        self.assertEqual(state["terminal"], 1)

    def test_card_lifecycle_operation_and_otp_redaction(self):
        opened = {
            "event": "card.opened", "event_id": "evt_card",
            "occurred_at": "2026-01-01T00:03:00Z", "partner_id": MOCK_PARTNER,
            "data": {
                "id": "card_one", "customer_id": self.customer,
                "kind": "physical", "status": "opened", "masked_pan": "**** 4242",
                "shipment_stage": "packing",
                "updated_at": "2026-01-01T00:03:00Z",
            },
        }
        raw, signature = signed(opened)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        operation = {
            "event": "card.operation", "event_id": "evt_operation",
            "occurred_at": "2026-01-01T00:04:00Z", "partner_id": MOCK_PARTNER,
            "data": {
                "operation_id": "op_one", "card_id": "card_one",
                "type": "purchase", "status": "completed",
                "previous_status": None, "currency": "USDT", "amount": "2.5",
                "fee": "0", "merchant_name": "Store", "merchant_country": "US",
                "mcc": "5734", "merchant_category": "Computer Software Stores",
                "original_amount": None, "original_currency": None,
                "refunded_amount": "0", "decline_reason": None,
                "decline_message": None, "balance_before": "10",
                "balance_after": "7.5", "created_at": "2026-01-01T00:04:00Z",
                "updated_at": "2026-01-01T00:04:00Z",
            },
        }
        raw, signature = signed(operation)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 2)
        card = self.ledger.db.execute("SELECT * FROM aura_cards").fetchone()
        self.assertEqual(card["status"], "opened")
        self.assertEqual(card["delivery_status"], "issued")
        self.assertNotIn("4242424242424242", card["body"])
        stored_operation = self.ledger.db.execute(
            "SELECT * FROM aura_card_operations"
        ).fetchone()
        self.assertEqual(stored_operation["amount"], "2.5")

        otp = {
            "event": "card.otp", "event_id": "evt_otp",
            "occurred_at": "2026-01-01T00:05:00Z", "partner_id": MOCK_PARTNER,
            "data": {"card_id": "card_one", "code": "123456",
                     "expires_at": "2026-01-01T00:06:00Z"},
        }
        raw, signature = signed(otp)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        inbox = self.ledger.db.execute(
            "SELECT raw_body FROM wallet_webhook_inbox WHERE provider_event_id='evt_otp'"
        ).fetchone()[0]
        self.assertNotIn(b"123456", bytes(inbox))
        self.assertIn(b"sensitive_payload_sha256", bytes(inbox))
        self.assertEqual(process_inbox(self.ledger, "test"), 1)

        delivery = {
            "api_version": "3.16.0", "event": "card.delivery_updated",
            "event_id": "evt_delivery",
            "occurred_at": "2026-01-01T00:07:00Z", "partner_id": MOCK_PARTNER,
            "data": {"card_id": "card_one", "customer_id": "internal-customer",
                     "owner_id": self.customer,
                     "delivery_status": "out_for_delivery",
                     "tracking": {"carrier": "DHL", "number": "TRACK1",
                                  "url": "https://tracking.invalid/TRACK1"}},
        }
        raw, signature = signed(delivery)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        card = self.ledger.db.execute("SELECT * FROM aura_cards").fetchone()
        self.assertEqual(card["status"], "opened")
        self.assertEqual(card["frozen"], 0)
        self.assertEqual(card["delivery_status"], "out_for_delivery")
        self.assertEqual(json.loads(card["tracking"])["number"], "TRACK1")

    def test_documented_card_operation_transitions_ignore_stale_events(self):
        opened = {
            "event": "card.opened", "event_id": "evt_operation_card",
            "occurred_at": "2026-09-11T09:59:00Z", "partner_id": MOCK_PARTNER,
            "data": {
                "card_id": "card_operation", "owner_id": self.customer,
                "customer_id": "internal-aura-customer", "status": "opened",
                "card_number_masked": "411111••••••1234",
            },
        }
        base = {
            "card_id": "card_operation",
            "operation_id": "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
            "type": "purchase", "status": "pending", "previous_status": None,
            "amount": "96.1314", "currency": "USDT",
            "original_amount": "75.87", "original_currency": "GBP",
            "merchant_name": "ANTHROPIC* CLAUDE SUB", "merchant_country": "US",
            "mcc": "5734", "merchant_category": "Computer Software Stores",
            "refunded_amount": "0", "decline_reason": None,
            "decline_message": None, "balance_before": "150",
            "balance_after": "53.8686", "created_at": "2026-09-11T10:00:00.000Z",
            "updated_at": "2026-09-11T10:00:00.000Z",
        }
        completed_data = {
            **base, "status": "completed", "previous_status": "pending",
            "updated_at": "2026-09-12T10:00:00.000Z",
        }
        events = (
            opened,
            {"event": "card.operation", "event_id": "evt_operation_pending",
             "occurred_at": base["updated_at"], "partner_id": MOCK_PARTNER,
             "data": base},
            {"event": "card.operation", "event_id": "evt_operation_completed",
             "occurred_at": completed_data["updated_at"], "partner_id": MOCK_PARTNER,
             "data": completed_data},
            {"event": "card.operation", "event_id": "evt_operation_stale",
             "occurred_at": base["updated_at"], "partner_id": MOCK_PARTNER,
             "data": base},
        )
        for event in events:
            raw, signature = signed(event)
            store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 4)
        operation = self.ledger.db.execute(
            "SELECT * FROM aura_card_operations WHERE operation_id=?",
            (base["operation_id"],),
        ).fetchone()
        self.assertEqual(operation["status"], "completed")
        self.assertEqual(operation["previous_status"], "pending")
        self.assertEqual(operation["amount"], "96.1314")
        self.assertEqual(operation["merchant"], "ANTHROPIC* CLAUDE SUB")
        self.assertEqual(operation["balance_before"], "150")
        self.assertEqual(operation["balance_after"], "53.8686")
        self.assertEqual(operation["provider_created_at"], "2026-09-11T10:00:00.000Z")
        self.assertEqual(operation["provider_updated_at"], "2026-09-12T10:00:00.000Z")

    def test_card_operation_contract_rejects_invalid_decline_and_refund_economics(self):
        opened = {
            "event": "card.opened", "event_id": "evt_contract_card",
            "occurred_at": "2026-09-11T09:59:00Z", "partner_id": MOCK_PARTNER,
            "data": {
                "card_id": "card_contract", "owner_id": self.customer,
                "customer_id": "internal-aura-customer", "status": "opened",
                "card_number_masked": "411111••••••1234",
            },
        }
        base = {
            "card_id": "card_contract",
            "operation_id": "4f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
            "type": "purchase", "status": "declined", "previous_status": "pending",
            "amount": "10", "currency": "USDT", "original_amount": None,
            "original_currency": None, "merchant_name": None,
            "merchant_country": None, "mcc": None, "merchant_category": None,
            "refunded_amount": "0", "decline_reason": "other",
            "decline_message": "Provider rejected purchase", "balance_before": "20",
            "balance_after": "19", "created_at": "2026-09-11T10:00:00.000Z",
            "updated_at": "2026-09-11T10:01:00.000Z",
        }
        invalid_refund = {
            **base, "operation_id": "5f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
            "status": "partially_refunded", "previous_status": "completed",
            "decline_reason": None, "decline_message": None,
            "balance_after": "30", "refunded_amount": "10",
        }
        for event in (
            opened,
            {"event": "card.operation", "event_id": "evt_invalid_decline",
             "occurred_at": base["updated_at"], "partner_id": MOCK_PARTNER,
             "data": base},
            {"event": "card.operation", "event_id": "evt_invalid_refund",
             "occurred_at": invalid_refund["updated_at"], "partner_id": MOCK_PARTNER,
             "data": invalid_refund},
        ):
            raw, signature = signed(event)
            store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        self.assertEqual(
            self.ledger.db.execute("SELECT COUNT(*) FROM aura_card_operations").fetchone()[0],
            0,
        )
        errors = {
            row["provider_event_id"]: row["error"]
            for row in self.ledger.db.execute(
                "SELECT provider_event_id,error FROM wallet_webhook_inbox "
                "WHERE provider_event_id IN ('evt_invalid_decline','evt_invalid_refund')"
            )
        }
        self.assertIn("must not change balance", errors["evt_invalid_decline"])
        self.assertIn("Invalid partially refunded", errors["evt_invalid_refund"])

    def test_documented_card_opened_uses_owner_id_not_internal_customer_id(self):
        event = {
            "api_version": "2.5.0", "event": "card.opened",
            "event_id": "c1f0a9b8-7d6e-4c5b-9a8f-0e1d2c3b4a59",
            "occurred_at": "2026-09-11T10:00:00.000Z",
            "partner_id": MOCK_PARTNER,
            "data": {
                "card_id": "9b5f3c2a-1d4e-4f60-8a7b-2c3d4e5f6a7b",
                "card_number_masked": "411111••••••1234",
                "customer_id": "7a1c9e42-5b3d-4f18-9c2a-6e7d8f9a0b1c",
                "owner_id": self.customer, "status": "opened",
            },
        }
        raw, signature = signed(event)
        timestamp = signature.split(",", 1)[0].split("=", 1)[1]
        headers = {
            "X-Aura-Event": "card.opened",
            "X-Aura-Event-Id": event["event_id"],
            "X-Aura-Timestamp": timestamp,
            "X-Aura-Attempt": "1",
        }
        _, valid = store_webhook(
            self.ledger, raw, signature, headers, SECRET, MOCK_PARTNER
        )
        self.assertTrue(valid)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        card = self.ledger.db.execute(
            "SELECT * FROM aura_cards WHERE card_id=?", (event["data"]["card_id"],)
        ).fetchone()
        self.assertEqual(card["user_id"], self.uid)
        self.assertEqual(card["customer_id"], self.customer)
        self.assertEqual(card["masked_pan"], "411111••••••1234")
        self.assertEqual(card["provider_updated_at"], event["occurred_at"])

        wrong_headers = {**headers, "X-Aura-Timestamp": str(int(timestamp) + 1)}
        _, valid = store_webhook(
            self.ledger, raw, signature, wrong_headers, SECRET, MOCK_PARTNER
        )
        self.assertFalse(valid)

    def test_documented_card_status_changed_sets_frozen_without_replacing_lifecycle_status(self):
        opened = {
            "api_version": "2.5.0", "event": "card.opened",
            "event_id": "b1f0a9b8-7d6e-4c5b-9a8f-0e1d2c3b4a58",
            "occurred_at": "2026-09-11T09:59:00.000Z",
            "partner_id": MOCK_PARTNER,
            "data": {
                "card_id": "9b5f3c2a-1d4e-4f60-8a7b-2c3d4e5f6a7b",
                "card_number_masked": "411111••••••1234",
                "owner_id": self.customer, "status": "opened",
            },
        }
        raw, signature = signed(opened)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        changed = {
            "api_version": "2.5.0", "event": "card.status_changed",
            "event_id": "c1f0a9b8-7d6e-4c5b-9a8f-0e1d2c3b4a59",
            "occurred_at": "2026-09-11T10:00:00.000Z",
            "partner_id": MOCK_PARTNER,
            "data": {
                "card_id": opened["data"]["card_id"], "status": "frozen",
            },
        }
        raw, signature = signed(changed)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        self.assertEqual(process_inbox(self.ledger, "test"), 0)
        card = self.ledger.db.execute(
            "SELECT * FROM aura_cards WHERE card_id=?", (opened["data"]["card_id"],)
        ).fetchone()
        self.assertEqual(card["status"], "opened")
        self.assertEqual(card["frozen"], 1)
        self.assertEqual(card["masked_pan"], "411111••••••1234")
        self.assertEqual(card["provider_updated_at"], changed["occurred_at"])
        self.assertTrue(json.loads(card["body"])["frozen"])

    def test_documented_card_failed_is_terminal_without_masked_number(self):
        event = {
            "api_version": "2.5.0", "event": "card.failed",
            "event_id": "d1f0a9b8-7d6e-4c5b-9a8f-0e1d2c3b4a50",
            "occurred_at": "2026-09-11T10:01:00.000Z",
            "partner_id": MOCK_PARTNER,
            "data": {
                "card_id": "8b5f3c2a-1d4e-4f60-8a7b-2c3d4e5f6a70",
                "card_number_masked": None,
                "customer_id": "6a1c9e42-5b3d-4f18-9c2a-6e7d8f9a0b1d",
                "owner_id": self.customer, "status": "failed_to_open",
            },
        }
        raw, signature = signed(event)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        card = self.ledger.db.execute(
            "SELECT * FROM aura_cards WHERE card_id=?", (event["data"]["card_id"],)
        ).fetchone()
        self.assertEqual(card["user_id"], self.uid)
        self.assertEqual(card["status"], "failed_to_open")
        self.assertIsNone(card["masked_pan"])
        self.assertEqual(card["provider_updated_at"], event["occurred_at"])

    def test_documented_card_cancelled_is_terminal_without_masked_number(self):
        event = {
            "api_version": "2.5.0", "event": "card.cancelled",
            "event_id": "4e2b7c9d-1a3f-4b5c-8d6e-7f8091a2b3c4",
            "occurred_at": "2026-09-11T10:02:00.000Z",
            "partner_id": MOCK_PARTNER,
            "data": {
                "card_id": "7b5f3c2a-1d4e-4f60-8a7b-2c3d4e5f6a71",
                "card_number_masked": None,
                "customer_id": "5a1c9e42-5b3d-4f18-9c2a-6e7d8f9a0b1e",
                "owner_id": self.customer, "status": "cancelled",
            },
        }
        raw, signature = signed(event)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        card = self.ledger.db.execute(
            "SELECT * FROM aura_cards WHERE card_id=?", (event["data"]["card_id"],)
        ).fetchone()
        self.assertEqual(card["user_id"], self.uid)
        self.assertEqual(card["status"], "cancelled")
        self.assertIsNone(card["masked_pan"])

    def test_sbp_terminal_webhook_records_without_crediting_unknown_contract(self):
        event = {
            "event": "order.completed", "event_id": "evt_order",
            "occurred_at": "2026-01-01T00:05:00Z", "partner_id": MOCK_PARTNER,
            "data": {
                "id": "order_one", "customer_id": self.customer,
                "status": "completed", "rub_amount": "9250",
                "usdt_amount": "100", "fee": "0",
                "updated_at": "2026-01-01T00:05:00Z",
                "qr_payload": "must-not-be-persisted",
            },
        }
        raw, signature = signed(event)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        order = self.ledger.db.execute("SELECT * FROM aura_sbp_orders").fetchone()
        self.assertEqual(order["status"], "completed")
        self.assertEqual(order["rub_amount"], "9250")
        self.assertEqual(order["usdt_amount"], "100")
        self.assertNotIn("qr_payload", order["body"])
        self.assertEqual(str(self.ledger.balance(self.uid, "USDT")[0]), "0")

    def test_qr_and_withdrawal_events_are_restart_safe(self):
        events = [
            {"event": "qr_payment.completed", "event_id": "evt_qr",
             "occurred_at": "2026-01-01T00:08:00Z", "partner_id": MOCK_PARTNER,
             "data": {"id": "qr_one", "status": "completed", "amount_rub": "925",
                      "rate": "92.50", "total_usdt": "10", "merchant_name": "Shop",
                      "updated_at": "2026-01-01T00:08:00Z", "qr": "do-not-store"}},
            {"event": "withdraw.confirmed", "event_id": "evt_withdraw",
             "occurred_at": "2026-01-01T00:09:00Z", "partner_id": MOCK_PARTNER,
             "data": {"id": "wd_one", "status": "confirmed", "amount": "20",
                      "fee": "2", "recipient": "TRecipient", "tx_hash": "tx_one",
                      "updated_at": "2026-01-01T00:09:00Z"}},
        ]
        for event in events:
            raw, signature = signed(event)
            store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 2)
        self.assertEqual(process_inbox(self.ledger, "test"), 0)
        qr = self.ledger.db.execute("SELECT * FROM aura_qr_payments").fetchone()
        withdrawal = self.ledger.db.execute("SELECT * FROM aura_withdrawals").fetchone()
        self.assertEqual(qr["total_usdt"], "10")
        self.assertNotIn("do-not-store", qr["body"])
        self.assertEqual(withdrawal["fee"], "2")
        self.assertEqual(withdrawal["status"], "confirmed")


class AuraMockContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.mock = TestClient(TestServer(make_app()))
        await self.mock.start_server()
        self.tmp = tempfile.TemporaryDirectory()
        self.ledger = Ledger(self.tmp.name + "/db")
        prepare_inbox(self.ledger)
        prepare(self.ledger)
        self.client = AuraClient(
            MOCK_KEY, "test", ApiError,
            base_url=str(self.mock.make_url("/v1/partner")).rstrip("/"),
        )
        self.service = AuraService(self.ledger, self.client, "test")

    async def asyncTearDown(self):
        self.ledger.book.verify()
        await self.client.close()
        await self.mock.close()
        self.ledger.db.close()
        self.tmp.cleanup()

    async def test_customer_address_and_balance_contract(self):
        uid = "tg:777"
        ref = self.ledger.account(uid)
        result = await self.service.get_or_create_deposit_address(uid, ref)
        self.assertEqual(result["provider"], "aura")
        self.assertEqual(result["chain"], "nile")
        self.assertTrue(result["address"].startswith("T"))
        self.assertEqual(self.client.remaining, 99)
        report = await reconcile(self.ledger, self.client, "test")
        self.assertEqual(report["state"], "ok")
        fees = await self.client.get_deposit_fees()
        self.assertEqual(fees["fee_min"], "0.5")
        created = await self.client.create_deposit_address(
            result["customer_id"], label="invoice-1042"
        )
        self.assertFalse(created["is_default"])
        self.assertEqual(created["label"], "invoice-1042")
        fetched = await self.client.get_deposit_address(created["id"])
        self.assertEqual(fetched, created)
        listed = await self.client.deposit_addresses(result["customer_id"])
        self.assertEqual(len(listed["data"]), 2)

    async def test_customer_and_widget_kyc_contract(self):
        uid = "tg:778"
        ref = self.ledger.account(uid)
        customer_id = await self.service.ensure_customer(
            uid, ref, email="ivan@example.com", phone="+79991234567"
        )
        customer = await self.client.get_customer(customer_id)
        self.assertEqual(customer["email"], "ivan@example.com")
        customers = await self.client.list_customers()
        self.assertEqual(customers["data"][0]["id"], customer_id)
        session = await self.service.start_kyc(uid, ref)
        self.assertEqual(session["status"], "pending")
        self.assertTrue(session["session_url"].startswith("https://"))
        stored = self.ledger.db.execute(
            "SELECT body FROM aura_kyc_cases WHERE user_id=?", (uid,)
        ).fetchone()[0]
        self.assertNotIn("session", stored)
        status = await self.service.get_kyc(uid, ref)
        self.assertFalse(status["verified"])

    async def test_imported_identity_is_validated_and_never_persisted(self):
        uid = "tg:identity-import"
        ref = self.ledger.account(uid)
        customer_id = await self.service.ensure_customer(
            uid, ref, email="ivan@example.com", phone="+79991234567"
        )
        state = await self.service.submit_identity(uid, customer_id, {
            "first_name": "Иван", "last_name": "Петров",
            "birth_date": "1990-05-20", "passport": "4510 123456",
            "passport_issue_date": "2010-06-01", "inn": "123456789012",
        })
        self.assertTrue(state["verified"])
        persisted = "\n".join(self.ledger.db.iterdump())
        self.assertNotIn("4510123456", persisted)
        self.assertNotIn("123456789012", persisted)
        self.assertNotIn("Иван", persisted)
        self.assertNotIn("4510123456", json.dumps(self.mock.app["state"].kyc))
        with self.assertRaises(ValueError):
            await self.client.submit_customer_identity(customer_id, {
                "first_name": "Ivan", "last_name": "Петров",
                "birth_date": "1990-05-20", "passport": "4510123456",
                "passport_issue_date": "2010-06-01",
            })

    async def test_sbp_quote_order_replay_and_cancel_contract(self):
        uid = "tg:sbp-write"
        ref = self.ledger.account(uid)
        customer_id = await self.service.ensure_customer(
            uid, ref, email="payer@example.com", phone="+79991234567"
        )
        await self.service.submit_identity(uid, customer_id, {
            "first_name": "Иван", "last_name": "Петров",
            "birth_date": "1990-05-20", "passport": "4510123456",
            "passport_issue_date": "2010-06-01",
        })
        rate = await self.client.get_sbp_rate()
        self.assertEqual(rate["fiat_currency"], "RUB")
        quote = await self.service.create_sbp_quote(uid, ref, "9250")
        self.assertEqual(quote["crypto_amount"], "100.000000")
        order = await self.service.create_sbp_order(
            uid, ref, quote["quote_token"], idempotency_key="sbp-order-one"
        )
        self.assertEqual(order["status"], "awaiting_payment")
        replay = await self.service.create_sbp_order(
            uid, ref, quote["quote_token"], idempotency_key="sbp-order-one"
        )
        self.assertEqual(replay["id"], order["id"])
        fetched = await self.service.get_sbp_order(uid, order["id"])
        self.assertEqual(fetched["id"], order["id"])
        cancelled = await self.service.cancel_sbp_order(uid, order["id"])
        self.assertEqual(cancelled["status"], "cancelled")
        stored = self.ledger.db.execute(
            "SELECT body FROM aura_sbp_orders WHERE order_id=?", (order["id"],)
        ).fetchone()[0]
        self.assertNotIn("qr.nspk", stored)
        self.assertNotIn("iVBOR", stored)

    async def test_qr_quote_payment_replay_and_owner_storage_contract(self):
        uid = "tg:qr-write"
        ref = self.ledger.account(uid)
        customer_id = await self.service.ensure_customer(uid, ref)
        self.mock.app["state"].balance = Decimal("100")
        qr_payload = "https://qr.nspk.ru/AS2A000000000001"
        quote = await self.service.create_qr_quote(uid, ref, qr_payload)
        payment = await self.service.create_qr_payment(
            uid, ref, quote["quote_token"], qr_payload,
            idempotency_key="qr-payment-one",
        )
        self.assertEqual(payment["status"], "processing")
        replay = await self.service.create_qr_payment(
            uid, ref, quote["quote_token"], qr_payload,
            idempotency_key="qr-payment-one",
        )
        self.assertEqual(replay["id"], payment["id"])
        self.assertEqual(self.mock.app["state"].balance, Decimal("90.000000"))
        self.assertEqual(
            (await self.service.get_qr_payment(uid, payment["id"]))["id"], payment["id"]
        )
        row = self.ledger.db.execute(
            "SELECT user_id,customer_id,body FROM aura_qr_payments WHERE payment_id=?",
            (payment["id"],),
        ).fetchone()
        self.assertEqual((row["user_id"], row["customer_id"]), (uid, customer_id))
        self.assertNotIn(qr_payload, row["body"])

    async def test_pending_recovery_polls_qr_terminal_state_without_replaying_post(self):
        uid = "tg:qr-recovery"
        ref = self.ledger.account(uid)
        await self.service.ensure_customer(uid, ref)
        self.mock.app["state"].balance = Decimal("100")
        qr_payload = "https://qr.nspk.ru/AS2A000000000002"
        quote = await self.service.create_qr_quote(uid, ref, qr_payload)
        payment = await self.service.create_qr_payment(
            uid, ref, quote["quote_token"], qr_payload,
            idempotency_key="qr-recovery-one",
        )
        provider = self.mock.app["state"].qr_payments[payment["id"]]
        provider.update({
            "status": "completed", "completed_at": "2026-12-01T00:01:00Z",
        })
        recovered = await reconcile_pending(self.ledger, self.client, "test")
        self.assertEqual(recovered["qr_payments"], 1)
        self.assertEqual(recovered["errors"], [])
        local = self.ledger.db.execute(
            "SELECT status FROM aura_qr_payments WHERE payment_id=?", (payment["id"],)
        ).fetchone()
        self.assertEqual(local["status"], "completed")
        self.assertEqual(len(self.mock.app["state"].qr_payments), 1)

    async def test_customer_input_validation(self):
        with self.assertRaises(ValueError):
            await self.client.upsert_customer("customer", email="not-an-email")
        with self.assertRaises(ValueError):
            await self.client.upsert_customer("customer", phone="89991234567")

    async def test_card_read_contracts_and_fees(self):
        uid = "tg:779"
        ref = self.ledger.account(uid)
        customer_id = await self.service.ensure_customer(uid, ref)
        created = await self.mock.post(
            "/mock/cards", json={"customer_id": customer_id, "kind": "virtual"}
        )
        card = (await created.json())["card"]
        fees = await self.client.get_card_fees()
        self.assertEqual(fees["currency"], "USDT")
        self.assertEqual(fees["open_virtual_card_fee"], "20")
        self.assertEqual(fees["minimum_recharge_amount"], "10")
        self.assertEqual((await self.client.list_cards())["data"][0]["id"], card["id"])
        self.assertEqual((await self.client.get_card(card["id"]))["status"], "opened")
        credentials = await self.client.get_card_credentials(card["id"])
        self.assertEqual(credentials, {
            "card_id": card["id"], "cvv": "123", "expiry": "09/29",
            "number": "4111111111111234",
        })
        self.assertIsNone(await self.client.get_latest_card_otp(card["id"]))
        otp = {
            "card_id": card["id"], "card_number_masked": "•••• 1234",
            "code": "582130", "consumed_at": None,
            "expires_at": "2099-09-11T10:02:00Z",
            "id": "0d7e2f7a-3c1b-4f5e-9a8d-6b4c2e1f0a9b",
            "received_at": "2099-09-11T10:00:00Z",
            "subject": "3DS Verification",
        }
        self.mock.app["state"].card_otps[card["id"]] = otp
        self.assertEqual(await self.client.get_latest_card_otp(card["id"]), otp)
        operation = await self.mock.post(
            "/mock/card-operations", json={"card_id": card["id"], "amount": "3"}
        )
        self.assertEqual(operation.status, 200)
        all_operations = await self.client.list_card_operations()
        card_operations = await self.client.list_card_operations(card["id"])
        self.assertEqual(len(all_operations["data"]), 1)
        self.assertEqual(len(card_operations["data"]), 1)
        frozen = await self.client.freeze_card(card["id"])
        self.assertEqual(frozen, {
            "balance": "25", "card_id": card["id"],
            "card_number_masked": "**** 4242", "currency": "USDT",
            "frozen": True, "operations_count": 1, "operations_value": "3",
            "owner_id": customer_id, "status": "opened",
            "activated_at": None, "delivery_status": None,
            "shipment_stage": None, "shipped_at": None,
            "shipping_address": None, "tracking": None,
        })
        self.assertEqual(await self.client.freeze_card(card["id"]), frozen)
        with self.assertRaises(ApiError) as frozen_recharge:
            await self.client.recharge_card(
                card["id"], amount="25", idempotency_key="frozen-recharge"
            )
        self.assertEqual(frozen_recharge.exception.name, "card_frozen")
        unfrozen = await self.client.unfreeze_card(card["id"])
        self.assertFalse(unfrozen["frozen"])
        self.assertEqual(await self.client.unfreeze_card(card["id"]), unfrozen)
        restored = await self.client.recharge_card(
            card["id"], amount="25", idempotency_key="unfrozen-recharge"
        )
        self.assertEqual(restored["status"], "completed")

    async def test_card_create_and_recharge_contracts_are_idempotent(self):
        uid = "tg:card-money"
        ref = self.ledger.account(uid)
        customer_id = await self.service.ensure_customer(uid, ref)
        self.mock.app["state"].balance = Decimal("100")
        card = await self.client.create_card(
            customer_id, kind="virtual", idempotency_key="open-card-one"
        )
        replay = await self.client.create_card(
            customer_id, kind="virtual", idempotency_key="open-card-one"
        )
        self.assertEqual(set(card), {"card_id"})
        self.assertEqual(card["card_id"], replay["card_id"])
        self.assertEqual(self.mock.app["state"].balance, Decimal("80"))
        recharge = await self.client.recharge_card(
            card["card_id"], amount="25", idempotency_key="recharge-one"
        )
        recharge_replay = await self.client.recharge_card(
            card["card_id"], amount="25", idempotency_key="recharge-one"
        )
        self.assertEqual(recharge["operation_id"], recharge_replay["operation_id"])
        self.assertEqual(recharge["charged_amount"], "25.500004")
        self.assertEqual(recharge["recharge_amount"], "25")
        self.assertEqual(recharge["fee"], "0.500004")
        self.assertEqual(self.mock.app["state"].balance, Decimal("54.499996"))

        with self.assertRaises(ApiError) as reused:
            await self.client.recharge_card(
                card["card_id"], amount="26", idempotency_key="recharge-one"
            )
        self.assertEqual(reused.exception.name, "idempotency_key_reused")

        second = await self.client.create_card(
            customer_id, kind="virtual", idempotency_key="open-card-two"
        )
        self.assertEqual(self.mock.app["state"].balance, Decimal("34.499996"))
        cancelled = await self.client.cancel_card(second["card_id"])
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(self.mock.app["state"].balance, Decimal("54.499996"))
        with self.assertRaises(ApiError) as not_cancelable:
            await self.client.cancel_card(second["card_id"])
        self.assertEqual(not_cancelable.exception.name, "card_request_not_cancelable")

    async def test_physical_card_activation_and_account_pin_are_ephemeral(self):
        uid = "tg:physical-controls"
        customer_id = await self.service.ensure_customer(uid, self.ledger.account(uid))
        created = await self.mock.post(
            "/mock/cards", json={"customer_id": customer_id, "kind": "physical"}
        )
        card_id = (await created.json())["card"]["id"]
        item = self.mock.app["state"].cards[card_id]
        item.update({
            "delivery_status": "out_for_delivery",
            "shipped_at": "2026-10-30T09:00:00Z",
            "shipping_address": {
                "address_line": "Lenina St 1, apt 1", "city": "Moscow",
                "country": "RU", "full_name": "Ivan Petrov",
                "phone": "+15555550100", "postal_code": "101000",
            },
            "tracking": {
                "carrier": "EMIRATES POST", "number": "EE617723698AE",
                "url": "https://parcelsapp.com/en/tracking/EE617723698AE",
            },
        })
        activated = await self.client.activate_card(card_id, " Ab12Cd ")
        self.assertEqual(activated["delivery_status"], "activated")
        self.assertEqual(activated["shipment_stage"], "activated")
        self.assertEqual(activated["status"], "opened")
        unchanged = await self.client.set_card_pin(card_id, "123456")
        self.assertEqual(unchanged, activated)
        self.assertNotIn("123456", json.dumps(self.mock.app["state"].cards))
        with self.assertRaises(ValueError):
            await self.client.set_card_pin(card_id, "12345")
        with self.assertRaises(ValueError):
            await self.client.activate_card(card_id, "bad code")

    async def test_card_request_response_is_linked_to_pending_owner(self):
        uid = "tg:card-request"
        ref = self.ledger.account(uid)
        self.mock.app["state"].balance = Decimal("100")
        self.ledger.begin("test_funding", "test", uid)
        self.ledger.put_balance(uid, "USDT", Decimal("100"), Decimal("0"))
        self.ledger.db.execute(
            "INSERT INTO wallet_provider_positions VALUES ('aura','test',?,'USDT','100','0',?)",
            (uid, time.time()),
        )
        self.ledger.commit()
        result = await self.service.create_card_request(
            uid, ref, kind="virtual", idempotency_key="request-link-one"
        )
        self.assertEqual(result["status"], "processing")
        card = self.ledger.db.execute(
            "SELECT * FROM aura_cards WHERE card_id=?", (result["card_id"],)
        ).fetchone()
        entity = self.ledger.db.execute(
            "SELECT * FROM wallet_provider_entities WHERE local_id='request-link-one'"
        ).fetchone()
        self.assertEqual(card["user_id"], uid)
        self.assertEqual(card["status"], "processing")
        self.assertEqual(entity["remote_id"], result["card_id"])
        self.assertEqual(self.ledger.balance(uid, "USDT"), (Decimal("80"), Decimal("0")))
        position = self.ledger.db.execute(
            "SELECT available,reserved FROM wallet_provider_positions WHERE user_id=?", (uid,)
        ).fetchone()
        self.assertEqual((Decimal(position[0]), Decimal(position[1])), (Decimal("80"), Decimal("0")))

        failed = {
            "api_version": "3.17.0", "event": "card.failed",
            "event_id": "evt_card_financial_refund",
            "occurred_at": "2026-01-01T00:10:00Z", "partner_id": MOCK_PARTNER,
            "data": {
                "card_id": result["card_id"], "card_number_masked": None,
                "customer_id": "internal-aura-id", "owner_id": ref,
                "status": "failed_to_open",
            },
        }
        raw, signature = signed(failed)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        self.assertEqual(self.ledger.balance(uid, "USDT"), (Decimal("100"), Decimal("0")))
        entity = self.ledger.db.execute(
            "SELECT * FROM wallet_provider_entities WHERE local_id='request-link-one'"
        ).fetchone()
        self.assertEqual(entity["status"], "refunded")
        self.assertEqual(process_inbox(self.ledger, "test"), 0)
        self.assertEqual(self.ledger.balance(uid, "USDT"), (Decimal("100"), Decimal("0")))

    async def test_card_recharge_uses_exact_response_amounts_and_is_idempotent(self):
        uid = "tg:card-recharge"
        ref = self.ledger.account(uid)
        customer_id = await self.service.ensure_customer(uid, ref)
        created = await self.mock.post(
            "/mock/cards", json={"customer_id": customer_id, "kind": "virtual"}
        )
        card_payload = await created.json()
        raw, signature = signed(card_payload["webhook"])
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        card_id = card_payload["card"]["id"]
        self.ledger.begin("test_funding", "test", uid)
        self.ledger.put_balance(uid, "USDT", Decimal("100"), Decimal("0"))
        self.ledger.db.execute(
            "INSERT INTO wallet_provider_positions VALUES ('aura','test',?,'USDT','100','0',?)",
            (uid, time.time()),
        )
        self.ledger.commit()
        self.mock.app["state"].balance = Decimal("100")

        result = await self.service.recharge_card_request(
            uid, card_id, amount="25", idempotency_key="recharge-service-one"
        )
        self.assertEqual(result["charged_amount"], "25.500004")
        self.assertEqual(result["recharge_amount"], "25")
        self.assertEqual(result["fee"], "0.500004")
        self.assertEqual(result["status"], "completed")
        self.assertEqual(
            self.ledger.balance(uid, "USDT"), (Decimal("74.499996"), Decimal("0"))
        )
        replay = await self.service.recharge_card_request(
            uid, card_id, amount="25", idempotency_key="recharge-service-one"
        )
        self.assertEqual(replay, result)
        self.assertEqual(self.mock.app["state"].balance, Decimal("74.499996"))

        spend = await self.service.recharge_card_request(
            uid, card_id, amount_spend="20.4", idempotency_key="recharge-service-two"
        )
        self.assertEqual(spend["charged_amount"], "20.4")
        self.assertEqual(spend["recharge_amount"], "20.000000")
        self.assertEqual(
            self.ledger.balance(uid, "USDT"), (Decimal("54.099996"), Decimal("0"))
        )

        pending_result = {
            "charged_amount": "10.2", "currency": "USDT",
            "failure_reason": None, "fee": "0.2",
            "operation_id": "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c",
            "recharge_amount": "10", "status": "sent",
        }
        with patch.object(
            self.client, "recharge_card", AsyncMock(return_value=pending_result)
        ):
            pending = await self.service.recharge_card_request(
                uid, card_id, amount_spend="10.2",
                idempotency_key="recharge-service-pending",
            )
        self.assertEqual(pending["status"], "sent")
        self.assertEqual(
            self.ledger.balance(uid, "USDT"), (Decimal("43.899996"), Decimal("10.2"))
        )
        declined_event = {
            "api_version": "3.17.0", "event": "card.operation",
            "event_id": "evt_recharge_failed", "occurred_at": "2026-01-01T00:30:00Z",
            "partner_id": MOCK_PARTNER,
            "data": {
                "operation_id": pending_result["operation_id"], "card_id": card_id,
                "type": "topup", "status": "declined", "previous_status": "pending",
                "currency": "USDT", "amount": "10", "fee": "0.2",
                "balance_before": "10", "balance_after": "10",
                "created_at": "2026-01-01T00:20:00Z",
                "updated_at": "2026-01-01T00:30:00Z",
                "decline_reason": "other", "decline_message": "Provider rejected topup",
                "mcc": None, "merchant_category": None, "merchant_country": None,
                "merchant_name": None, "original_amount": None,
                "original_currency": None, "refunded_amount": "0",
            },
        }
        raw, signature = signed(declined_event)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        self.assertEqual(
            self.ledger.balance(uid, "USDT"), (Decimal("54.099996"), Decimal("0"))
        )
        recharge = self.ledger.db.execute(
            "SELECT status FROM wallet_provider_entities WHERE local_id='recharge-service-pending'"
        ).fetchone()
        self.assertEqual(recharge["status"], "failed")
        self.assertEqual(process_inbox(self.ledger, "test"), 0)

    async def test_card_money_input_validation(self):
        with self.assertRaises(ValueError):
            await self.client.create_card(
                "owner", kind="plastic", idempotency_key="bad-kind"
            )
        with self.assertRaises(ValueError):
            await self.client.recharge_card(
                "card-id", amount="1", amount_spend="1", idempotency_key="bad-amount"
            )
        with self.assertRaises(ValueError):
            await self.client.create_card(
                "owner", kind="physical", idempotency_key="bad-address",
                shipping_address={
                    "full_name": "Иван Петров", "phone": "+15555550100",
                    "country": "RU", "city": "Moscow", "postal_code": "101000",
                    "address_line": "Lenina St 1",
                },
            )

    async def test_card_credentials_have_a_separate_five_per_minute_budget(self):
        uid = "tg:credentials-budget"
        ref = self.ledger.account(uid)
        customer_id = await self.service.ensure_customer(uid, ref)
        created = await self.mock.post(
            "/mock/cards", json={"customer_id": customer_id, "kind": "virtual"}
        )
        card_id = (await created.json())["card"]["id"]
        for _ in range(5):
            self.assertEqual(
                (await self.client.get_card_credentials(card_id))["card_id"], card_id
            )
        with self.assertRaises(ApiError) as limited:
            await self.client.get_card_credentials(card_id)
        self.assertEqual(limited.exception.name, "rate_limited")
        self.assertEqual(limited.exception.details["scope"], "credentials_reveal")
        self.assertIsNotNone(limited.exception.retry_after)
        self.assertEqual((await self.client.get_card(card_id))["status"], "opened")

    async def test_sbp_read_contracts(self):
        uid = "tg:780"
        ref = self.ledger.account(uid)
        customer_id = await self.service.ensure_customer(uid, ref)
        self.mock.app["state"].kyc[customer_id] = {
            "status": "completed", "verified": True, "reason": None,
            "terminal": False, "checked_at": "2026-12-01T00:00:00Z",
        }
        rate = await self.client.get_sbp_rate()
        self.assertEqual(rate["fiat_currency"], "RUB")
        quote = await self.client.create_sbp_quote(customer_id, "9250")
        order = await self.client.create_sbp_order(
            customer_id, quote["quote_token"], idempotency_key="read-order-one"
        )
        self.assertEqual((await self.client.list_sbp_orders())["data"][0]["id"], order["id"])
        self.assertEqual(
            (await self.client.get_sbp_order(order["id"]))["status"],
            "awaiting_payment",
        )

    async def test_qr_and_withdrawal_read_contracts(self):
        payment_id = "5b0c2f7e-1a3d-4e8f-9b6a-2c4d6e8f0a1b"
        self.mock.app["state"].qr_payments[payment_id] = {
            "id": payment_id, "customer_id": None, "status": "completed",
            "merchant_name": "Shop", "payment_type": "nspk",
            "amount_rub": "925.00", "rate": "92.50", "total_usdt": "10",
            "created_at": "2026-01-01T00:00:00Z",
            "completed_at": "2026-01-01T00:01:00Z", "failed_at": None,
            "refunded_at": None, "failure_reason": None,
        }
        withdrawal_id = "5e4d3c2b-1a09-4f8e-9d7c-6b5a49382716"
        self.mock.app["state"].withdrawals[withdrawal_id] = {
            "address": "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9",
            "amount": "20", "completed_at": "2026-10-20T09:13:10Z",
            "created_at": "2026-10-20T09:12:04Z", "currency": "USDT",
            "failure_reason": None, "fee": "2", "network": "TRC20",
            "status": "completed", "tx_hash": "9f3c2a71d4e85b06",
            "withdrawal_id": withdrawal_id,
        }
        self.assertEqual((await self.client.list_qr_payments())["data"][0]["id"], payment_id)
        self.assertEqual((await self.client.get_qr_payment(payment_id))["status"], "completed")
        self.assertEqual(
            (await self.client.list_withdrawals(status="completed"))["data"][0]["withdrawal_id"],
            withdrawal_id,
        )
        self.assertEqual(
            (await self.client.get_withdrawal(withdrawal_id))["status"], "completed"
        )

    async def test_balance_history_and_idempotent_withdrawal_contract(self):
        self.mock.app["state"].balance = Decimal("100")
        address = "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9"
        created = await self.client.create_withdrawal(
            "50", address, idempotency_key="withdrawal-one", note="payout #1042"
        )
        self.assertEqual(created["status"], "processing")
        self.assertEqual(created["fee"], "2")
        self.assertEqual(self.mock.app["state"].balance, Decimal("48"))
        replay = await self.client.create_withdrawal(
            "50", address, idempotency_key="withdrawal-one", note="payout #1042"
        )
        self.assertEqual(replay, created)
        self.assertEqual(self.mock.app["state"].balance, Decimal("48"))
        history = await self.client.list_balance_history(
            operation_type="cards_platform_withdrawal", status="pending"
        )
        self.assertEqual(len(history["data"]), 1)
        operation = await self.client.get_balance_operation(history["data"][0]["id"])
        self.assertEqual(operation["reference_operation_id"], created["withdrawal_id"])
        with self.assertRaises(ApiError) as reused:
            await self.client.create_withdrawal(
                "40", address, idempotency_key="withdrawal-one", note="payout #1042"
            )
        self.assertEqual(reused.exception.name, "idempotency_key_reused")

    async def test_event_feed_get_and_idempotent_redelivery(self):
        event_id = "c1f0a9b8-7d6e-4c5b-9a8f-0e1d2c3b4a59"
        created = await self.mock.post(
            "/mock/events", json={
                "id": event_id, "type": "card.otp",
                "data": {"card_id": "9b5f3c2a-1d4e-4f60-8a7b-2c3d4e5f6a7b",
                         "code": "582130"},
            },
        )
        self.assertEqual(created.status, 200)
        listed = await self.client.list_events(event_types=["card.otp"], limit=25)
        self.assertEqual([item["id"] for item in listed["data"]], [event_id])
        fetched = await self.client.get_event(event_id)
        self.assertEqual(fetched["data"]["code"], "582130")
        redelivered = await self.client.redeliver_event(
            event_id, idempotency_key="redeliver-event-one"
        )
        self.assertEqual(redelivered["delivery"]["status"], "pending")
        self.assertEqual(redelivered["delivery"]["attempts"], 0)
        repeated = await self.client.redeliver_event(
            event_id, idempotency_key="redeliver-event-one"
        )
        self.assertEqual(repeated, redelivered)
        with self.assertRaises(ValueError):
            await self.client.list_events(event_types=["unknown.event"])
        with self.assertRaises(ValueError):
            await self.client.get_event("not-a-uuid")

    async def test_product_capability_is_authoritative(self):
        self.assertTrue(await self.client.product_enabled("sbp_buy"))
        self.mock.app["state"].products["sbp_buy"] = False
        self.assertTrue(await self.client.product_enabled("sbp_buy"))
        await self.client.get_me(refresh=True)
        self.assertFalse(await self.client.product_enabled("sbp_buy"))

    async def test_environment_key_guard(self):
        with self.assertRaises(ValueError):
            AuraClient("ak_live_wrong", "test", ApiError)

    async def test_provider_error_envelope_is_typed(self):
        with self.assertRaises(ApiError) as caught:
            await self.client.deposit_addresses("missing")
        error = caught.exception
        self.assertEqual(error.name, "customer_not_found")
        self.assertEqual(error.retry_policy, "after_fix")
        self.assertTrue(error.request_id.startswith("req_"))


class AuraRouteIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.mock = TestClient(TestServer(make_app()))
        await self.mock.start_server()
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "GOSWAP_API_TOKEN": "", "WPAY_BOT_TOKEN": BOT,
            "WPAY_DB_PATH": self.tmp.name + "/db", "WPAY_FINANCE_WORKER": "0",
            "WPAY_AURA_ENABLED": "1", "AURA_ENVIRONMENT": "test",
            "AURA_API_KEY": MOCK_KEY, "AURA_WEBHOOK_SECRET": SECRET,
            "AURA_PARTNER_ID": MOCK_PARTNER,
            "AURA_BASE_URL": str(self.mock.make_url("/v1/partner")).rstrip("/"),
        })
        self.env.start()
        from wallet_backend import install_wallet
        self.app = web.Application()
        install_wallet(self.app, self.tmp.name, lambda key: key == "owner-test-key")
        self.wpay = TestClient(TestServer(self.app))
        await self.wpay.start_server()
        self.owner = {"X-Board-Key": "owner-test-key"}

    async def asyncTearDown(self):
        await self.wpay.close()
        await self.mock.close()
        self.env.stop()
        self.tmp.cleanup()

    async def test_disabled_route_then_complete_mock_deposit(self):
        disabled = await self.wpay.post("/api/wallet/aura-deposit-address", headers=self.owner)
        self.assertEqual(disabled.status, 503)
        enabled = await self.wpay.post(
            "/api/wallet/admin-provider-route", headers=self.owner,
            json={"product": "crypto_deposit", "asset": "USDT", "network": "TRON",
                  "environment": "test", "provider": "aura", "enabled": True},
        )
        self.assertEqual(enabled.status, 200, await enabled.text())
        address_response = await self.wpay.post(
            "/api/wallet/aura-deposit-address", headers=self.owner
        )
        self.assertEqual(address_response.status, 200, await address_response.text())
        address = await address_response.json()
        self.assertEqual(address["chain"], "nile")
        created = await self.mock.post(
            "/mock/deposits",
            json={"customer_id": address["customer_id"], "amount": "10", "fee": "1"},
        )
        event = (await created.json())["webhook"]
        raw, signature = signed(event)
        webhook = await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature,
                     "X-Aura-Event": event["event"],
                     "X-Aura-Event-Id": event["event_id"]},
        )
        self.assertEqual(webhook.status, 200, await webhook.text())
        processed = await self.wpay.post(
            "/api/wallet/admin-aura-process", headers=self.owner
        )
        self.assertEqual(processed.status, 200, await processed.text())
        body = await processed.json()
        self.assertEqual(body["processed"], 1)
        self.assertEqual(body["reconciliation"]["state"], "ok")
        self.assertEqual(
            str(self.app["wpay_ledger"].balance("owner", "USDT")[0]), "9"
        )

    async def test_aura_only_wallet_status_overview_sync_and_generic_deposit(self):
        status = await self.wpay.get("/api/wallet/status", headers=self.owner)
        self.assertTrue((await status.json())["configured"])
        await self.wpay.post(
            "/api/wallet/admin-provider-route", headers=self.owner,
            json={"product": "crypto_deposit", "asset": "USDT", "network": "TRON",
                  "environment": "test", "provider": "aura", "enabled": True},
        )
        deposit = await self.wpay.post(
            "/api/wallet/deposit", headers=self.owner,
            json={"asset": "USDT", "network": "TRON", "amount": "25"},
        )
        self.assertEqual(deposit.status, 200, await deposit.text())
        self.assertEqual((await deposit.json())["provider"], "aura")
        overview = await self.wpay.get("/api/wallet/overview", headers=self.owner)
        self.assertEqual(overview.status, 200, await overview.text())
        self.assertEqual((await overview.json())["rates"], [])
        synced = await self.wpay.post("/api/wallet/sync", headers=self.owner, json={})
        self.assertEqual(synced.status, 200, await synced.text())
        self.assertTrue((await synced.json())["ok"])

    async def test_additional_deposit_address_is_owner_scoped(self):
        await self.wpay.post(
            "/api/wallet/admin-provider-route", headers=self.owner,
            json={"product": "crypto_deposit", "asset": "USDT", "network": "TRON",
                  "environment": "test", "provider": "aura", "enabled": True},
        )
        default = await self.wpay.post(
            "/api/wallet/aura-deposit-address", headers=self.owner
        )
        self.assertEqual(default.status, 200, await default.text())
        created = await self.wpay.post(
            "/api/wallet/aura-deposit-address-create", headers=self.owner,
            json={"label": "invoice-1042"},
        )
        self.assertEqual(created.status, 200, await created.text())
        item = await created.json()
        self.assertEqual(item["label"], "invoice-1042")
        fetched = await self.wpay.get(
            "/api/wallet/aura-deposit-address?address_id=" + item["id"],
            headers=self.owner,
        )
        self.assertEqual(await fetched.json(), item)
        foreign = await self.wpay.get(
            "/api/wallet/aura-deposit-address?address_id=" + item["id"],
            headers={"X-Telegram-Init-Data": init_data(323)},
        )
        self.assertEqual(foreign.status, 404)

    async def test_admin_identity_import_is_secret_free(self):
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner,
            json={"email": "ivan@example.com", "phone": "+79991234567"},
        )
        customer_id = (await registered.json())["customer_id"]
        imported = await self.wpay.post(
            "/api/wallet/admin-aura-kyc-identity", headers=self.owner,
            json={
                "customer_id": customer_id,
                "first_name": "Иван", "last_name": "Петров",
                "birth_date": "1990-05-20", "passport": "4510 123456",
                "passport_issue_date": "2010-06-01", "inn": "123456789012",
            },
        )
        self.assertEqual(imported.status, 200, await imported.text())
        self.assertEqual(imported.headers.get("Cache-Control"), "no-store")
        self.assertTrue((await imported.json())["verified"])
        persisted = "\n".join(self.app["wpay_ledger"].db.iterdump())
        for secret in ("4510123456", "123456789012", "Иван", "Петров"):
            self.assertNotIn(secret, persisted)

    async def test_customer_kyc_session_status_and_webhook(self):
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner,
            json={"email": "owner@example.com", "phone": "+79991234567"},
        )
        self.assertEqual(registered.status, 200, await registered.text())
        customer_id = (await registered.json())["customer_id"]
        started = await self.wpay.post(
            "/api/wallet/aura-kyc", headers=self.owner, json={}
        )
        self.assertEqual(started.status, 200, await started.text())
        self.assertEqual((await started.json())["status"], "pending")
        changed = await self.mock.post(
            "/mock/kyc", json={"customer_id": customer_id, "status": "verified"}
        )
        event = (await changed.json())["webhook"]
        raw, signature = signed(event)
        webhook = await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature},
        )
        self.assertEqual(webhook.status, 200, await webhook.text())
        processed = await self.wpay.post(
            "/api/wallet/admin-aura-process", headers=self.owner
        )
        self.assertEqual(processed.status, 200, await processed.text())
        status = await self.wpay.get("/api/wallet/aura-kyc", headers=self.owner)
        self.assertEqual(status.status, 200, await status.text())
        body = await status.json()
        self.assertTrue(body["verified"])
        self.assertTrue(body["terminal"])

    async def test_card_webhooks_feed_owner_scoped_views(self):
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner, json={}
        )
        customer_id = (await registered.json())["customer_id"]
        created = await self.mock.post(
            "/mock/cards", json={"customer_id": customer_id}
        )
        card_result = await created.json()
        raw, signature = signed(card_result["webhook"])
        self.assertEqual((await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature},
        )).status, 200)
        card_id = card_result["card"]["id"]
        operation = await self.mock.post(
            "/mock/card-operations", json={"card_id": card_id, "amount": "4.5"}
        )
        operation_event = (await operation.json())["webhook"]
        raw, signature = signed(operation_event)
        self.assertEqual((await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature},
        )).status, 200)
        processed = await self.wpay.post(
            "/api/wallet/admin-aura-process", headers=self.owner
        )
        self.assertEqual((await processed.json())["processed"], 2)
        cards = await self.wpay.get("/api/wallet/aura-cards", headers=self.owner)
        self.assertEqual((await cards.json())["data"][0]["card_id"], card_id)
        operations = await self.wpay.get(
            "/api/wallet/aura-card-operations?card_id=" + card_id,
            headers=self.owner,
        )
        self.assertEqual((await operations.json())["data"][0]["amount"], "4.5")
        fees = await self.wpay.get("/api/wallet/aura-card-fees", headers=self.owner)
        self.assertEqual(fees.status, 200)
        self.assertEqual(fees.headers["Cache-Control"], "no-store")

    async def test_card_credentials_are_owner_scoped_no_store_and_never_persisted(self):
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner, json={}
        )
        customer_id = (await registered.json())["customer_id"]
        created = await self.mock.post(
            "/mock/cards", json={"customer_id": customer_id, "kind": "virtual"}
        )
        card_payload = await created.json()
        raw, signature = signed(card_payload["webhook"])
        self.assertEqual((await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature},
        )).status, 200)
        self.assertEqual((await self.wpay.post(
            "/api/wallet/admin-aura-process", headers=self.owner
        )).status, 200)
        card_id = card_payload["card"]["id"]
        foreign = await self.wpay.get(
            "/api/wallet/aura-card-credentials?card_id=" + card_id,
            headers={"X-Telegram-Init-Data": init_data(321)},
        )
        self.assertEqual(foreign.status, 404)
        response = await self.wpay.get(
            "/api/wallet/aura-card-credentials?card_id=" + card_id,
            headers=self.owner,
        )
        self.assertEqual(response.status, 200, await response.text())
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        credentials = await response.json()
        self.assertEqual(credentials["number"], "4111111111111234")
        self.assertEqual(credentials["cvv"], "123")
        ledger = self.app["wpay_ledger"]
        audit = ledger.db.execute(
            "SELECT action,outcome FROM aura_sensitive_access_audit WHERE card_id=?",
            (card_id,),
        ).fetchone()
        self.assertEqual((audit["action"], audit["outcome"]),
                         ("card.credentials.reveal", "succeeded"))
        persisted = "\n".join(ledger.db.iterdump())
        self.assertNotIn(credentials["number"], persisted)
        self.assertNotIn('"cvv":"' + credentials["cvv"] + '"', persisted)

    async def test_latest_card_otp_is_owner_scoped_no_store_nullable_and_never_persisted(self):
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner, json={}
        )
        customer_id = (await registered.json())["customer_id"]
        created = await self.mock.post(
            "/mock/cards", json={"customer_id": customer_id, "kind": "virtual"}
        )
        card_payload = await created.json()
        raw, signature = signed(card_payload["webhook"])
        self.assertEqual((await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature},
        )).status, 200)
        await self.wpay.post("/api/wallet/admin-aura-process", headers=self.owner)
        card_id = card_payload["card"]["id"]
        empty = await self.wpay.get(
            "/api/wallet/aura-card-otp-latest?card_id=" + card_id,
            headers=self.owner,
        )
        self.assertEqual(empty.status, 200, await empty.text())
        self.assertEqual(empty.headers["Cache-Control"], "no-store")
        self.assertIsNone(await empty.json())
        otp = {
            "card_id": card_id, "card_number_masked": "•••• 1234",
            "code": "582130", "consumed_at": None,
            "expires_at": "2099-09-11T10:02:00Z",
            "id": "0d7e2f7a-3c1b-4f5e-9a8d-6b4c2e1f0a9b",
            "received_at": "2099-09-11T10:00:00Z",
            "subject": "3DS Verification",
        }
        self.mock.app["state"].card_otps[card_id] = otp
        foreign = await self.wpay.get(
            "/api/wallet/aura-card-otp-latest?card_id=" + card_id,
            headers={"X-Telegram-Init-Data": init_data(322)},
        )
        self.assertEqual(foreign.status, 404)
        response = await self.wpay.get(
            "/api/wallet/aura-card-otp-latest?card_id=" + card_id,
            headers=self.owner,
        )
        self.assertEqual(response.status, 200, await response.text())
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual(await response.json(), otp)
        persisted = "\n".join(self.app["wpay_ledger"].db.iterdump())
        self.assertNotIn(otp["code"], persisted)

    async def test_card_freeze_is_owner_scoped_and_updates_safe_local_state(self):
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner, json={}
        )
        customer_id = (await registered.json())["customer_id"]
        created = await self.mock.post(
            "/mock/cards", json={"customer_id": customer_id, "kind": "virtual"}
        )
        card_payload = await created.json()
        raw, signature = signed(card_payload["webhook"])
        await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature},
        )
        await self.wpay.post("/api/wallet/admin-aura-process", headers=self.owner)
        card_id = card_payload["card"]["id"]
        foreign = await self.wpay.post(
            "/api/wallet/aura-card-freeze",
            headers={"X-Telegram-Init-Data": init_data(323)},
            json={"card_id": card_id},
        )
        self.assertEqual(foreign.status, 404)
        provider_balance = self.mock.app["state"].balance
        response = await self.wpay.post(
            "/api/wallet/aura-card-freeze", headers=self.owner,
            json={"card_id": card_id},
        )
        self.assertEqual(response.status, 200, await response.text())
        result = await response.json()
        self.assertTrue(result["frozen"])
        self.assertEqual(result["owner_id"], customer_id)
        self.assertEqual(result["status"], "opened")
        self.assertEqual(self.mock.app["state"].balance, provider_balance)
        local = self.app["wpay_ledger"].db.execute(
            "SELECT frozen,status FROM aura_cards WHERE card_id=?", (card_id,)
        ).fetchone()
        self.assertEqual((local["frozen"], local["status"]), (1, "opened"))
        repeated = await self.wpay.post(
            "/api/wallet/aura-card-freeze", headers=self.owner,
            json={"card_id": card_id},
        )
        self.assertEqual(repeated.status, 200, await repeated.text())
        self.assertTrue((await repeated.json())["frozen"])
        rejected = await self.wpay.post(
            "/api/wallet/aura-card-recharge",
            headers={**self.owner, "Idempotency-Key": "frozen-route-recharge"},
            json={"card_id": card_id, "amount": "25"},
        )
        self.assertEqual(rejected.status, 409, await rejected.text())
        self.assertEqual((await rejected.json())["error"]["name"], "card_frozen")
        self.assertIsNone(self.app["wpay_ledger"].db.execute(
            "SELECT 1 FROM wallet_provider_entities WHERE local_id=?",
            ("frozen-route-recharge",),
        ).fetchone())
        unfrozen = await self.wpay.post(
            "/api/wallet/aura-card-unfreeze", headers=self.owner,
            json={"card_id": card_id},
        )
        self.assertEqual(unfrozen.status, 200, await unfrozen.text())
        self.assertFalse((await unfrozen.json())["frozen"])
        repeated_unfreeze = await self.wpay.post(
            "/api/wallet/aura-card-unfreeze", headers=self.owner,
            json={"card_id": card_id},
        )
        self.assertEqual(repeated_unfreeze.status, 200, await repeated_unfreeze.text())
        local = self.app["wpay_ledger"].db.execute(
            "SELECT frozen,status FROM aura_cards WHERE card_id=?", (card_id,)
        ).fetchone()
        self.assertEqual((local["frozen"], local["status"]), (0, "opened"))
        pin = await self.wpay.post(
            "/api/wallet/aura-card-pin", headers=self.owner,
            json={"card_id": card_id, "pin": "123456"},
        )
        self.assertEqual(pin.status, 200, await pin.text())
        self.assertNotIn(
            "123456", "\n".join(self.app["wpay_ledger"].db.iterdump())
        )

    async def test_physical_activation_is_owner_scoped_and_secret_free(self):
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner, json={}
        )
        customer_id = (await registered.json())["customer_id"]
        created = await self.mock.post(
            "/mock/cards", json={"customer_id": customer_id, "kind": "physical"}
        )
        payload = await created.json()
        card_id = payload["card"]["id"]
        provider_card = self.mock.app["state"].cards[card_id]
        provider_card.update({
            "delivery_status": "out_for_delivery",
            "shipped_at": "2026-10-30T09:00:00Z",
            "shipping_address": {
                "address_line": "Lenina St 1, apt 1", "city": "Moscow",
                "country": "RU", "full_name": "Ivan Petrov",
                "phone": "+15555550100", "postal_code": "101000",
            },
            "tracking": {
                "carrier": "EMIRATES POST", "number": "EE617723698AE",
                "url": "https://parcelsapp.com/en/tracking/EE617723698AE",
            },
        })
        payload["webhook"]["data"]["kind"] = "physical"
        raw, signature = signed(payload["webhook"])
        await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature},
        )
        await self.wpay.post("/api/wallet/admin-aura-process", headers=self.owner)
        foreign = await self.wpay.post(
            "/api/wallet/aura-card-activate",
            headers={"X-Telegram-Init-Data": init_data(323)},
            json={"card_id": card_id, "activation_code": "Ab12Cd"},
        )
        self.assertEqual(foreign.status, 404)
        activated = await self.wpay.post(
            "/api/wallet/aura-card-activate", headers=self.owner,
            json={"card_id": card_id, "activation_code": "Ab12Cd"},
        )
        self.assertEqual(activated.status, 200, await activated.text())
        result = await activated.json()
        self.assertEqual(result["delivery_status"], "activated")
        local = self.app["wpay_ledger"].db.execute(
            "SELECT status,delivery_status FROM aura_cards WHERE card_id=?", (card_id,)
        ).fetchone()
        self.assertEqual((local["status"], local["delivery_status"]), ("opened", "activated"))
        persisted = "\n".join(self.app["wpay_ledger"].db.iterdump())
        self.assertNotIn("Ab12Cd", persisted)

    async def test_card_issue_route_reserves_spends_and_failed_event_refunds_once(self):
        ledger = self.app["wpay_ledger"]
        ledger.begin("test_funding", "test", "owner")
        ledger.put_balance("owner", "USDT", Decimal("100"), Decimal("0"))
        ledger.db.execute(
            "INSERT OR REPLACE INTO wallet_provider_positions "
            "VALUES ('aura','test','owner','USDT','100','0',?)", (time.time(),)
        )
        ledger.commit()
        self.mock.app["state"].balance = Decimal("100")
        issued = await self.wpay.post(
            "/api/wallet/aura-cards", headers={**self.owner, "Idempotency-Key": "route-card-one"},
            json={"kind": "virtual"},
        )
        self.assertEqual(issued.status, 200, await issued.text())
        card_id = (await issued.json())["card_id"]
        self.assertEqual(ledger.balance("owner", "USDT"), (Decimal("80"), Decimal("0")))
        customer_id = ledger.db.execute(
            "SELECT customer_id FROM aura_customers WHERE user_id='owner'"
        ).fetchone()[0]
        event = {
            "api_version": "3.17.0", "event": "card.failed",
            "event_id": "evt_route_card_failed", "occurred_at": "2026-01-01T00:20:00Z",
            "partner_id": MOCK_PARTNER,
            "data": {"card_id": card_id, "card_number_masked": None,
                     "customer_id": "internal", "owner_id": customer_id,
                     "status": "failed_to_open"},
        }
        raw, signature = signed(event)
        self.assertEqual((await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature},
        )).status, 200)
        processed = await self.wpay.post(
            "/api/wallet/admin-aura-process", headers=self.owner
        )
        self.assertEqual((await processed.json())["processed"], 1)
        self.assertEqual(ledger.balance("owner", "USDT"), (Decimal("100"), Decimal("0")))
        processed = await self.wpay.post(
            "/api/wallet/admin-aura-process", headers=self.owner
        )
        self.assertEqual((await processed.json())["processed"], 0)
        self.assertEqual(ledger.balance("owner", "USDT"), (Decimal("100"), Decimal("0")))

    async def test_card_recharge_route_uses_provider_charged_amount(self):
        ledger = self.app["wpay_ledger"]
        ledger.begin("test_funding", "test", "owner")
        ledger.put_balance("owner", "USDT", Decimal("100"), Decimal("0"))
        ledger.db.execute(
            "INSERT OR REPLACE INTO wallet_provider_positions "
            "VALUES ('aura','test','owner','USDT','100','0',?)", (time.time(),)
        )
        ledger.commit()
        self.mock.app["state"].balance = Decimal("100")
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner, json={}
        )
        customer_id = (await registered.json())["customer_id"]
        created = await self.mock.post(
            "/mock/cards", json={"customer_id": customer_id, "kind": "virtual"}
        )
        card_payload = await created.json()
        raw, signature = signed(card_payload["webhook"])
        self.assertEqual((await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature},
        )).status, 200)
        processed = await self.wpay.post(
            "/api/wallet/admin-aura-process", headers=self.owner
        )
        self.assertEqual((await processed.json())["processed"], 1)
        card_id = card_payload["card"]["id"]
        response = await self.wpay.post(
            "/api/wallet/aura-card-recharge",
            headers={**self.owner, "Idempotency-Key": "route-recharge-one"},
            json={"card_id": card_id, "amount": "25"},
        )
        self.assertEqual(response.status, 200, await response.text())
        result = await response.json()
        self.assertEqual(result["charged_amount"], "25.500004")
        self.assertEqual(result["recharge_amount"], "25")
        self.assertEqual(
            ledger.balance("owner", "USDT"), (Decimal("74.499996"), Decimal("0"))
        )
        replay = await self.wpay.post(
            "/api/wallet/aura-card-recharge",
            headers={**self.owner, "Idempotency-Key": "route-recharge-one"},
            json={"card_id": card_id, "amount": "25"},
        )
        self.assertEqual(await replay.json(), result)
        self.assertEqual(self.mock.app["state"].balance, Decimal("74.499996"))

    async def test_sbp_terminal_webhook_feeds_owner_scoped_view(self):
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner, json={}
        )
        customer_id = (await registered.json())["customer_id"]
        created = await self.mock.post(
            "/mock/orders", json={"customer_id": customer_id, "status": "completed"}
        )
        event = (await created.json())["webhook"]
        raw, signature = signed(event)
        webhook = await self.wpay.post(
            "/api/wallet/aura-webhook", data=raw,
            headers={"X-Aura-Signature-V2": signature},
        )
        self.assertEqual(webhook.status, 200, await webhook.text())
        processed = await self.wpay.post(
            "/api/wallet/admin-aura-process", headers=self.owner
        )
        self.assertEqual((await processed.json())["processed"], 1)
        orders = await self.wpay.get("/api/wallet/aura-sbp-orders", headers=self.owner)
        self.assertEqual((await orders.json())["data"][0]["status"], "completed")
        rate = await self.wpay.get("/api/wallet/aura-sbp-rate", headers=self.owner)
        self.assertEqual(rate.status, 200)
        self.assertEqual((await rate.json())["fiat_currency"], "RUB")

    async def test_sbp_write_flow_is_idempotent_and_owner_scoped(self):
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner,
            json={"email": "payer@example.com", "phone": "+79991234567"},
        )
        customer_id = (await registered.json())["customer_id"]
        self.mock.app["state"].kyc[customer_id] = {
            "status": "completed", "verified": True, "reason": None,
            "terminal": False, "checked_at": "2026-12-01T00:00:00Z",
        }
        quote_response = await self.wpay.post(
            "/api/wallet/aura-sbp-quote", headers=self.owner,
            json={"fiat_amount": "9250"},
        )
        self.assertEqual(quote_response.status, 200, await quote_response.text())
        self.assertEqual(quote_response.headers["Cache-Control"], "no-store")
        quote = await quote_response.json()
        order_response = await self.wpay.post(
            "/api/wallet/aura-sbp-order",
            headers={**self.owner, "Idempotency-Key": "route-sbp-order-one"},
            json={"quote_token": quote["quote_token"]},
        )
        self.assertEqual(order_response.status, 200, await order_response.text())
        order = await order_response.json()
        replay = await self.wpay.post(
            "/api/wallet/aura-sbp-order",
            headers={**self.owner, "Idempotency-Key": "route-sbp-order-one"},
            json={"quote_token": quote["quote_token"]},
        )
        self.assertEqual((await replay.json())["id"], order["id"])
        foreign = await self.wpay.get(
            "/api/wallet/aura-sbp-order?order_id=" + order["id"],
            headers={"X-Telegram-Init-Data": init_data(323)},
        )
        self.assertEqual(foreign.status, 403)
        cancelled = await self.wpay.post(
            "/api/wallet/aura-sbp-order-cancel", headers=self.owner,
            json={"order_id": order["id"]},
        )
        self.assertEqual((await cancelled.json())["status"], "cancelled")

    async def test_qr_write_flow_is_idempotent_and_owner_scoped(self):
        registered = await self.wpay.post(
            "/api/wallet/aura-customer", headers=self.owner, json={}
        )
        self.assertEqual(registered.status, 200, await registered.text())
        self.mock.app["state"].balance = Decimal("100")
        qr_payload = "https://qr.nspk.ru/AS2A000000000001"
        quoted = await self.wpay.post(
            "/api/wallet/aura-qr-quote", headers=self.owner,
            json={"qr_payload": qr_payload},
        )
        self.assertEqual(quoted.status, 200, await quoted.text())
        self.assertEqual(quoted.headers["Cache-Control"], "no-store")
        quote = await quoted.json()
        paid = await self.wpay.post(
            "/api/wallet/aura-qr-payment",
            headers={**self.owner, "Idempotency-Key": "route-qr-payment-one"},
            json={"quote_token": quote["quote_token"], "qr_payload": qr_payload},
        )
        self.assertEqual(paid.status, 200, await paid.text())
        payment = await paid.json()
        replay = await self.wpay.post(
            "/api/wallet/aura-qr-payment",
            headers={**self.owner, "Idempotency-Key": "route-qr-payment-one"},
            json={"quote_token": quote["quote_token"], "qr_payload": qr_payload},
        )
        self.assertEqual((await replay.json())["id"], payment["id"])
        self.assertEqual(self.mock.app["state"].balance, Decimal("90.000000"))
        foreign = await self.wpay.get(
            "/api/wallet/aura-qr-payment?payment_id=" + payment["id"],
            headers={"X-Telegram-Init-Data": init_data(323)},
        )
        self.assertEqual(foreign.status, 403)
        fetched = await self.wpay.get(
            "/api/wallet/aura-qr-payment?payment_id=" + payment["id"],
            headers=self.owner,
        )
        self.assertEqual((await fetched.json())["status"], "processing")
        listed = await self.wpay.get("/api/wallet/aura-qr-payments", headers=self.owner)
        self.assertEqual((await listed.json())["data"][0]["payment_id"], payment["id"])

    async def test_disabled_sbp_product_blocks_kyc_start_and_rate(self):
        self.mock.app["state"].products["sbp_buy"] = False
        kyc = await self.wpay.post(
            "/api/wallet/aura-kyc", headers=self.owner,
            json={"email": "owner@example.com"},
        )
        self.assertEqual(kyc.status, 403, await kyc.text())
        self.assertEqual((await kyc.json())["error"]["name"], "sbp_buy_not_enabled")
        rate = await self.wpay.get("/api/wallet/aura-sbp-rate", headers=self.owner)
        self.assertEqual(rate.status, 403, await rate.text())

    async def test_admin_event_recovery_redacts_otp_and_requires_admin(self):
        event_id = "e7d6c5b4-a392-4817-8f6e-5d4c3b2a1908"
        created = await self.mock.post(
            "/mock/events", json={
                "id": event_id, "type": "card.otp",
                "data": {"card_id": "9b5f3c2a-1d4e-4f60-8a7b-2c3d4e5f6a7b",
                         "code": "901245"},
            },
        )
        self.assertEqual(created.status, 200)
        forbidden = await self.wpay.get(
            "/api/wallet/admin-aura-events",
            headers={"X-Telegram-Init-Data": init_data(323)},
        )
        self.assertEqual(forbidden.status, 403)
        listed = await self.wpay.get(
            "/api/wallet/admin-aura-events?type=card.otp&limit=25",
            headers=self.owner,
        )
        self.assertEqual(listed.status, 200, await listed.text())
        self.assertEqual((await listed.json())["data"][0]["data"]["code"], "[REDACTED]")
        fetched = await self.wpay.get(
            "/api/wallet/admin-aura-event?event_id=" + event_id,
            headers=self.owner,
        )
        self.assertEqual(fetched.status, 200, await fetched.text())
        self.assertEqual((await fetched.json())["data"]["code"], "[REDACTED]")
        redelivered = await self.wpay.post(
            "/api/wallet/admin-aura-event-redeliver", headers={
                **self.owner, "Idempotency-Key": "admin-redeliver-one",
            }, json={"event_id": event_id},
        )
        self.assertEqual(redelivered.status, 200, await redelivered.text())
        delivery = (await redelivered.json())["delivery"]
        self.assertEqual((delivery["status"], delivery["attempts"]), ("pending", 0))

    async def test_admin_balance_history_and_withdrawal_are_idempotent(self):
        self.mock.app["state"].balance = Decimal("100")
        address = "TN3W4H6rK2ce4vX9YnFQHwKENnHjoxb3m9"
        missing_key = await self.wpay.post(
            "/api/wallet/admin-aura-withdrawal", headers=self.owner,
            json={"amount": "25", "address": address},
        )
        self.assertEqual(missing_key.status, 400)
        created = await self.wpay.post(
            "/api/wallet/admin-aura-withdrawal",
            headers={**self.owner, "Idempotency-Key": "admin-withdrawal-one"},
            json={"amount": "25", "address": address, "note": "private payout 778"},
        )
        self.assertEqual(created.status, 200, await created.text())
        withdrawal = await created.json()
        self.assertEqual(withdrawal["status"], "processing")
        replay = await self.wpay.post(
            "/api/wallet/admin-aura-withdrawal",
            headers={**self.owner, "Idempotency-Key": "admin-withdrawal-one"},
            json={"amount": "25", "address": address, "note": "private payout 778"},
        )
        self.assertEqual(await replay.json(), withdrawal)
        self.assertEqual(self.mock.app["state"].balance, Decimal("73"))
        stored = self.app["wpay_ledger"].db.execute(
            "SELECT status,amount,fee FROM aura_withdrawals WHERE withdrawal_id=?",
            (withdrawal["withdrawal_id"],),
        ).fetchone()
        self.assertEqual(tuple(stored), ("processing", "25", "2"))
        self.assertNotIn(
            "private payout 778", "\n".join(self.app["wpay_ledger"].db.iterdump())
        )
        history = await self.wpay.get(
            "/api/wallet/admin-aura-balance-history?type=cards_platform_withdrawal&status=pending",
            headers=self.owner,
        )
        self.assertEqual(history.status, 200, await history.text())
        operation_id = (await history.json())["data"][0]["id"]
        operation = await self.wpay.get(
            "/api/wallet/admin-aura-balance-operation?operation_id=" + operation_id,
            headers=self.owner,
        )
        self.assertEqual(operation.status, 200, await operation.text())
        self.assertEqual(
            (await operation.json())["reference_operation_id"],
            withdrawal["withdrawal_id"],
        )


if __name__ == "__main__":
    unittest.main()
