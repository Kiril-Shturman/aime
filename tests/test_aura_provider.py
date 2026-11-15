import hashlib
import hmac
import json
import tempfile
import time
import unittest
import os
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


if __name__ == "__main__":
    unittest.main()
