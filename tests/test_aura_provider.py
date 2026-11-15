import hashlib
import hmac
import json
import tempfile
import time
import unittest
import os
from decimal import Decimal
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from wallet_aura import (
    AuraClient, AuraService, prepare, process_inbox, reconcile,
    store_webhook, verify_signature,
)
from wallet_backend import ApiError, Ledger
from wallet_inbox import prepare as prepare_inbox
from wallet_aura_mock import MOCK_KEY, MOCK_PARTNER, make_app
from tests.test_wallet_backend import BOT


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
                "kind": "virtual", "status": "opened", "masked_pan": "**** 4242",
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
                "id": "op_one", "card_id": "card_one", "type": "purchase",
                "status": "completed", "asset": "USDT", "amount": "-2.5",
                "fee": "0", "merchant": "Store",
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
        self.assertEqual(stored_operation["amount"], "-2.5")

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
            "event": "card.delivery_updated", "event_id": "evt_delivery",
            "occurred_at": "2026-01-01T00:07:00Z", "partner_id": MOCK_PARTNER,
            "data": {"card_id": "card_one", "customer_id": self.customer,
                     "delivery_status": "out_for_delivery",
                     "tracking": {"carrier": "DHL", "number": "TRACK1",
                                  "url": "https://tracking.invalid/TRACK1"},
                     "updated_at": "2026-01-01T00:07:00Z"},
        }
        raw, signature = signed(delivery)
        store_webhook(self.ledger, raw, signature, {}, SECRET, MOCK_PARTNER)
        self.assertEqual(process_inbox(self.ledger, "test"), 1)
        card = self.ledger.db.execute("SELECT * FROM aura_cards").fetchone()
        self.assertEqual(card["delivery_status"], "out_for_delivery")
        self.assertEqual(json.loads(card["tracking"])["number"], "TRACK1")

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
        operation = await self.mock.post(
            "/mock/card-operations", json={"card_id": card["id"], "amount": "3"}
        )
        self.assertEqual(operation.status, 200)
        all_operations = await self.client.list_card_operations()
        card_operations = await self.client.list_card_operations(card["id"])
        self.assertEqual(len(all_operations["data"]), 1)
        self.assertEqual(len(card_operations["data"]), 1)

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
        self.assertEqual(recharge["id"], recharge_replay["id"])
        self.assertEqual(recharge["charged_amount"], "25")
        self.assertEqual(self.mock.app["state"].balance, Decimal("55"))

        with self.assertRaises(ApiError) as reused:
            await self.client.recharge_card(
                card["card_id"], amount="26", idempotency_key="recharge-one"
            )
        self.assertEqual(reused.exception.name, "idempotency_key_reused")

        second = await self.client.create_card(
            customer_id, kind="virtual", idempotency_key="open-card-two"
        )
        self.assertEqual(self.mock.app["state"].balance, Decimal("35"))
        cancelled = await self.client.cancel_card(second["card_id"])
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(self.mock.app["state"].balance, Decimal("55"))
        with self.assertRaises(ApiError) as not_cancelable:
            await self.client.cancel_card(second["card_id"])
        self.assertEqual(not_cancelable.exception.name, "card_request_not_cancelable")

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

    async def test_sbp_read_contracts(self):
        uid = "tg:780"
        ref = self.ledger.account(uid)
        customer_id = await self.service.ensure_customer(uid, ref)
        rate = await self.client.get_sbp_rate()
        self.assertEqual(rate["fiat"], "RUB")
        created = await self.mock.post(
            "/mock/orders", json={"customer_id": customer_id, "status": "completed"}
        )
        order = (await created.json())["order"]
        self.assertEqual((await self.client.list_sbp_orders())["data"][0]["id"], order["id"])
        self.assertEqual((await self.client.get_sbp_order(order["id"]))["status"], "completed")

    async def test_qr_and_withdrawal_read_contracts(self):
        self.mock.app["state"].qr_payments["qr_one"] = {
            "id": "qr_one", "status": "completed", "total_usdt": "10"
        }
        self.mock.app["state"].withdrawals["wd_one"] = {
            "id": "wd_one", "status": "confirmed", "amount": "20", "fee": "2"
        }
        self.assertEqual((await self.client.list_qr_payments())["data"][0]["id"], "qr_one")
        self.assertEqual((await self.client.get_qr_payment("qr_one"))["status"], "completed")
        self.assertEqual((await self.client.list_withdrawals())["data"][0]["id"], "wd_one")
        self.assertEqual((await self.client.get_withdrawal("wd_one"))["status"], "confirmed")

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
            "/mock/card-operations", json={"card_id": card_id, "amount": "-4.5"}
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
        self.assertEqual((await operations.json())["data"][0]["amount"], "-4.5")
        fees = await self.wpay.get("/api/wallet/aura-card-fees", headers=self.owner)
        self.assertEqual(fees.status, 200)
        self.assertEqual(fees.headers["Cache-Control"], "no-store")

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
        self.assertEqual((await rate.json())["fiat"], "RUB")

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


if __name__ == "__main__":
    unittest.main()
