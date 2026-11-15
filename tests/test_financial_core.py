import asyncio
import hashlib
import hmac
import json
import os
import tempfile
import unittest
from decimal import Decimal
from unittest.mock import patch
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from test_wallet_backend import BOT, TOKEN, OWNER, init_data, FakeProvider
from wallet_backend import Ledger, ApiError, install_wallet, money
from wallet_user_ops import prepare as prepare_ops
from wallet_inbox import prepare as prepare_inbox, process as process_inbox
from wallet_finance_worker import prepare as prepare_worker, Worker
from wallet_operations import prepare_operations

D = Decimal


class Provider(FakeProvider):
    def __init__(self, token):
        super().__init__(token)
        self.org = D(100)
        self.transfers = {}
        self.invoices = {}
        self.withdrawals = {}
        self.journal = []
        self.can_transfer = True
        self.next_transfer = "pending"
        self.lose_transfer = False
        self.lose_invoice = False
        self.lose_revoke = False

    def entry(self, kind, net, details, asset="USDT"):
        self.journal.append(
            {
                "id": len(self.journal) * 7 + 5,
                "operation_id": len(self.journal) + 1,
                "type": kind,
                "asset": asset,
                "amount": str(net),
                "fee": "0",
                "net": str(net),
                "details": details,
            }
        )

    async def call(self, method, data=None, post=False):
        self.calls.append((method, data, post))
        if method == "getMe":
            return {
                "can_transfer": self.can_transfer,
                "can_withdraw": True,
            }
        if method == "getBalance":
            return [{"currency_code": "USDT", "available": str(self.org)}]
        if method == "getCurrencies":
            return [
                {
                    "code": "USDT",
                    "can_withdraw": True,
                    "can_transfer": True,
                    "decimals": 6,
                }
            ]
        if method == "getExchangeRates":
            return []
        if method == "getTransactions":
            rows = [item for item in self.journal if item["id"] > data.get("after", 0)]
            return {
                "items": rows,
                "cursor": rows[-1]["id"] if rows else data.get("after", 0),
                "has_more": False,
            }
        if method == "getDeposits":
            return {"items": []}
        if method == "getQrPayments":
            return {"items": self.payments}
        if method == "createQrQuote":
            return {
                "quote_id": "q-one",
                "amount": "9.13",
                "asset": "USDT",
                "amount_rub": "700",
                "rate": "76.67",
                "merchant_name": "shop",
                "expires_at": "2099-01-01T00:00:00Z",
            }
        if method == "payQr":
            if not self.payments:
                self.org -= D("9.13")
                self.payments = [
                    {
                        "payment_id": "p-one",
                        "spend_id": data["spend_id"],
                        "status": "processing",
                        "asset": "USDT",
                        "amount": "9.13",
                    }
                ]
            return self.payments[0]
        if method == "estimateWithdrawal":
            return {**data, "fee": "1", "total": str(D(data["amount"]) + 1)}
        if method == "createWithdrawal":
            if data["spend_id"] not in self.withdrawals:
                self.org -= D(data["amount"]) + 1
                self.withdrawals[data["spend_id"]] = {
                    **data,
                    "withdrawal_id": "w-one",
                    "fee": "1",
                    "status": "processing",
                    "version": 0,
                }
            return self.withdrawals[data["spend_id"]]
        if method == "getWithdrawals":
            return {
                "items": [
                    row
                    for key, row in self.withdrawals.items()
                    if key in data.get("spend_id", "").split(",")
                ]
            }
        if method == "transfer":
            if data["spend_id"] not in self.transfers:
                self.org -= D(data["amount"])
                self.transfers[data["spend_id"]] = {
                    **data,
                    "transfer_id": len(self.transfers) + 1,
                    "status": self.next_transfer,
                    "claim_url": "https://t.me/goswap?start=claim",
                }
            if self.lose_transfer:
                self.lose_transfer = False
                raise ApiError("PROVIDER_TIMEOUT", "timeout", 504)
            return self.transfers[data["spend_id"]]
        if method == "getTransfers":
            return {
                "items": [
                    row
                    for key, row in self.transfers.items()
                    if key in data.get("spend_id", "").split(",")
                ]
            }
        if method == "revokeTransfer":
            row = self.transfers[data["spend_id"]]
            if row["status"] == "completed":
                raise ApiError("NOT_REVOCABLE", "received", 400)
            if row["status"] != "reverted":
                row["status"] = "reverted"
                self.org += D(row["amount"])
            if self.lose_revoke:
                self.lose_revoke = False
                raise ApiError("UNAVAILABLE", "lost", 503)
            return row
        if method == "createInvoice":
            item = {
                **data,
                "invoice_id": str(len(self.invoices) + 1000),
                "status": "active",
                "bot_invoice_url": "https://t.me/goswap?start=invoice",
            }
            self.invoices[item["invoice_id"]] = item
            if self.lose_invoice:
                self.lose_invoice = False
                raise ApiError("PROVIDER_TIMEOUT", "lost", 504)
            return item
        if method == "getInvoices":
            rows = list(self.invoices.values())
            if data.get("invoice_ids"):
                rows = [
                    row
                    for row in rows
                    if row["invoice_id"] in data["invoice_ids"].split(",")
                ]
            else:
                rows = rows[
                    data.get("offset", 0) : data.get("offset", 0)
                    + data.get("count", 100)
                ]
            return {"items": rows}
        raise AssertionError(method)


class FinancialCoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = self.tmp.name + "/db"
        self.env = patch.dict(
            os.environ,
            {
                "GOSWAP_API_TOKEN": TOKEN,
                "WPAY_BOT_TOKEN": BOT,
                "WPAY_DB_PATH": self.path,
                "WPAY_ADMIN_IDS": "321",
                "WPAY_FINANCE_WORKER": "0",
            },
        )
        self.env.start()
        self.fake = patch("wallet_backend.GoSwap", Provider)
        self.fake.start()
        self.app = web.Application()
        install_wallet(self.app, self.tmp.name, lambda key: key == "owner-test-key")
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()
        self.ledger = self.app["wpay_ledger"]
        self.provider = self.app["wpay_provider"]
        self.user = {"X-Telegram-Init-Data": init_data(123)}
        self.foreign = {"X-Telegram-Init-Data": init_data(999)}
        ref = self.ledger.account("tg:123")
        self.ledger.deposit(
            {
                "deposit_id": "seed",
                "client_ref": ref,
                "asset": "USDT",
                "credited": "100",
            }
        )

    async def asyncTearDown(self):
        self.ledger.book.verify()
        for row in self.ledger.db.execute("SELECT id FROM finance_transactions"):
            total = sum(
                (
                    D(item[0])
                    for item in self.ledger.db.execute(
                        "SELECT amount FROM finance_postings WHERE transaction_id=?",
                        (row[0],),
                    )
                ),
                D(0),
            )
            self.assertEqual(total, 0)
        await self.client.close()
        self.fake.stop()
        self.env.stop()
        self.tmp.cleanup()

    async def post(self, path, body, headers=None):
        return await self.client.post(
            "/api/wallet/" + path, json=body, headers=headers or self.user
        )

    async def transfer(self):
        response = await self.post(
            "transfer-prepare", {"recipient_id": "777", "asset": "USDT", "amount": "10"}
        )
        self.assertEqual(response.status, 200, await response.text())
        return (await response.json())["intent_id"]

    async def invoice(self):
        response = await self.post("invoice-prepare", {"asset": "USDT", "amount": "10"})
        return (await response.json())["intent_id"]

    async def hook(self, kind, payload, bad=False):
        raw = json.dumps({"update_type": kind, "payload": payload}, indent=2).encode()
        sig = hmac.new(
            hashlib.sha256(TOKEN.encode()).digest(), raw, hashlib.sha256
        ).hexdigest()
        return await self.client.post(
            "/api/wallet/webhook",
            data=raw,
            headers={"crypto-pay-api-signature": "bad" if bad else sig},
        )

    def balance(self):
        return self.ledger.balance("tg:123", "USDT")

    async def test_authorized_withdrawal_without_tron_address(self):
        quote = await (
            await self.post(
                "withdrawal-estimate",
                {
                    "asset": "USDT",
                    "network": "TRON",
                    "address": "T" + "a" * 33,
                    "amount": "10",
                },
            )
        ).json()
        response = await self.post(
            "withdrawal-create", {"intent_id": quote["intent_id"]}
        )
        self.assertEqual(response.status, 200, await response.text())
        self.assertEqual(self.balance(), (D(89), D(11)))
        self.assertFalse(
            any(call[0] == "getClientAddress" for call in self.provider.calls)
        )

    async def test_transfer_parallel_requests_reserve_once(self):
        intent = await self.transfer()
        responses = await asyncio.gather(
            *[self.post("transfer-send", {"intent_id": intent}) for _ in range(2)]
        )
        self.assertEqual([r.status for r in responses], [200, 200])
        self.assertEqual(self.balance(), (D(90), D(10)))
        self.assertEqual(sum(m == "transfer" for m, _, _ in self.provider.calls), 1)

    async def test_transfer_timeout_recovered_without_another_post(self):
        intent = await self.transfer()
        self.provider.lose_transfer = True
        self.assertEqual(
            (await self.post("transfer-send", {"intent_id": intent})).status, 504
        )
        self.assertEqual(self.balance(), (D(90), D(10)))
        self.assertEqual(
            (await self.post("transfer-send", {"intent_id": intent})).status, 200
        )
        self.assertEqual(sum(m == "transfer" for m, _, _ in self.provider.calls), 1)

    async def test_disabled_transfer_never_calls_money_endpoint(self):
        intent = await self.transfer()
        self.provider.can_transfer = False
        self.assertEqual(
            (await self.post("transfer-send", {"intent_id": intent})).status, 403
        )
        self.assertEqual(self.balance(), (D(100), D(0)))
        self.assertFalse(any(m == "transfer" for m, _, _ in self.provider.calls))

    async def test_transfer_revoke_confirmed_once_and_safe_after_503(self):
        intent = await self.transfer()
        await self.post("transfer-send", {"intent_id": intent})
        self.provider.lose_revoke = True
        self.assertEqual(
            (await self.post("transfer-revoke", {"intent_id": intent})).status, 503
        )
        self.assertEqual(self.balance(), (D(90), D(10)))
        for _ in range(2):
            self.assertEqual(
                (await self.post("transfer-revoke", {"intent_id": intent})).status, 200
            )
        self.assertEqual(self.balance(), (D(100), D(0)))

    async def test_received_transfer_cannot_be_revoked(self):
        intent = await self.transfer()
        self.provider.next_transfer = "completed"
        await self.post("transfer-send", {"intent_id": intent})
        self.assertEqual(
            (await self.post("transfer-revoke", {"intent_id": intent})).status, 409
        )
        self.assertEqual(self.balance(), (D(90), D(0)))
        self.assertFalse(any(m == "revokeTransfer" for m, _, _ in self.provider.calls))

    async def test_foreign_transfer_cannot_read_send_or_revoke(self):
        intent = await self.transfer()
        for action in ["transfer-send", "transfer-revoke"]:
            self.assertEqual(
                (await self.post(action, {"intent_id": intent}, self.foreign)).status,
                404,
            )
        response = await self.client.get(
            "/api/wallet/transfer-history", headers=self.foreign
        )
        self.assertEqual((await response.json())["items"], [])

    async def test_invoice_parallel_creation_has_one_post(self):
        intent = await self.invoice()
        responses = await asyncio.gather(
            *[self.post("invoice-create", {"intent_id": intent}) for _ in range(2)]
        )
        self.assertEqual([r.status for r in responses], [200, 200])
        self.assertEqual(
            sum(m == "createInvoice" for m, _, _ in self.provider.calls), 1
        )

    async def test_invoice_timeout_is_found_by_server_payload(self):
        intent = await self.invoice()
        self.provider.lose_invoice = True
        self.assertEqual(
            (await self.post("invoice-create", {"intent_id": intent})).status, 504
        )
        response = await self.post("invoice-create", {"intent_id": intent})
        self.assertEqual(response.status, 200)
        self.assertEqual(
            sum(m == "createInvoice" for m, _, _ in self.provider.calls), 1
        )

    async def test_invoice_foreign_id_is_not_exposed(self):
        intent = await self.invoice()
        await self.post("invoice-create", {"intent_id": intent})
        self.assertEqual(
            (
                await self.post("invoice-create", {"intent_id": intent}, self.foreign)
            ).status,
            404,
        )
        response = await self.client.get(
            "/api/wallet/invoice-history?invoice_ids=1000", headers=self.foreign
        )
        self.assertEqual((await response.json())["items"], [])

    async def test_invoice_payment_hold_release_refund_and_duplicates(self):
        intent = await self.invoice()
        invoice = await (
            await self.post("invoice-create", {"intent_id": intent})
        ).json()
        iid = invoice["invoice_id"]
        invoice.update(status="paid")
        self.provider.invoices[iid] = invoice
        self.provider.entry("invoice_payment", "0", {"invoice_id": iid})
        for _ in range(2):
            self.assertEqual((await self.hook("invoice_paid", invoice)).status, 200)
        self.assertEqual(self.balance(), (D(100), D(0)))
        self.provider.org += 10
        self.provider.entry("hold_release", "10", {"invoice_id": iid})
        for _ in range(2):
            self.assertEqual((await self.hook("hold_release", invoice)).status, 200)
        self.assertEqual(self.balance(), (D(110), D(0)))
        self.provider.org -= 10
        self.provider.entry("invoice_refund", "-10", {"invoice_id": iid})
        for _ in range(2):
            self.assertEqual((await self.hook("invoice_refund", invoice)).status, 200)
        self.assertEqual(self.balance(), (D(100), D(0)))

    async def test_inbox_failure_rolls_back_money_but_preserves_raw_delivery(self):
        payload = {
            "deposit_id": "inbox-credit",
            "client_ref": self.ledger.account("tg:123"),
            "asset": "USDT",
            "credited": "7",
        }
        original = self.ledger.put_balance

        def fail(*args):
            original(*args)
            raise ValueError("injected failure")

        self.ledger.put_balance = fail
        self.assertEqual((await self.hook("deposit_received", payload)).status, 400)
        self.ledger.put_balance = original
        self.assertEqual(self.balance(), (D(100), D(0)))
        row = self.ledger.db.execute(
            "SELECT * FROM wallet_webhook_inbox WHERE entity_id='inbox-credit'"
        ).fetchone()
        self.assertIsNone(row["processed_at"])
        self.assertTrue(row["error"])
        self.assertTrue(row["raw_body"])
        await process_inbox(self.ledger, self.provider, row, money, ApiError)
        await process_inbox(self.ledger, self.provider, row, money, ApiError)
        self.assertEqual(self.balance(), (D(107), D(0)))

    async def test_bad_signature_is_durable_without_money(self):
        payload = {
            "deposit_id": "invalid",
            "client_ref": self.ledger.account("tg:123"),
            "asset": "USDT",
            "credited": "7",
        }
        self.assertEqual(
            (await self.hook("deposit_received", payload, True)).status, 401
        )
        row = self.ledger.db.execute("SELECT * FROM wallet_webhook_inbox").fetchone()
        self.assertEqual(row["signature_valid"], 0)
        self.assertEqual(self.balance(), (D(100), D(0)))

    async def test_worker_restart_continues_cursor_without_duplicate_invoice_credit(
        self,
    ):
        intent = await self.invoice()
        invoice = await (
            await self.post("invoice-create", {"intent_id": intent})
        ).json()
        self.provider.entry(
            "invoice_payment", "10", {"invoice_id": invoice["invoice_id"]}
        )
        self.provider.org += 10
        await Worker(self.ledger, self.provider, money, ApiError).step()
        self.assertEqual(self.balance(), (D(110), D(0)))
        cursor = self.ledger.db.execute(
            "SELECT value FROM wallet_provider_cursor"
        ).fetchone()[0]
        other = Ledger(self.path)
        prepare_operations(other)
        prepare_ops(other)
        prepare_inbox(other)
        prepare_worker(other)
        try:
            await Worker(other, self.provider, money, ApiError).step()
            other.book.verify()
        finally:
            other.db.close()
        calls = [
            data
            for method, data, _ in self.provider.calls
            if method == "getTransactions"
        ]
        self.assertEqual(calls[-1]["after"], cursor)
        self.assertEqual(self.balance(), (D(110), D(0)))

    async def test_worker_recovers_missed_qr_refund(self):
        quote = await (await self.post("quote", {"qr": "test"})).json()
        await self.post("pay", {"quote_id": quote["quote_id"]})
        self.provider.payments[0]["status"] = "completed"
        await Worker(self.ledger, self.provider, money, ApiError).step()
        self.assertEqual(self.balance(), (D("90.87"), D(0)))
        self.ledger.db.execute("DELETE FROM wallet_poll_schedule WHERE kind='qr'")
        self.provider.payments[0]["status"] = "refunded"
        self.provider.org += D("9.13")
        await Worker(self.ledger, self.provider, money, ApiError).step()
        self.assertEqual(self.balance(), (D(100), D(0)))

    async def test_deficit_blocks_new_expense(self):
        intent = await self.transfer()
        self.provider.org = D(99)
        self.assertEqual(
            (await self.post("transfer-send", {"intent_id": intent})).status, 503
        )
        self.assertEqual(self.balance(), (D(100), D(0)))
        self.assertFalse(any(m == "transfer" for m, _, _ in self.provider.calls))
        report = await self.client.get(
            "/api/wallet/finance-reconciliation", headers=OWNER
        )
        self.assertEqual((await report.json())["items"][0]["difference"], "-1")

    async def test_positive_unexplained_difference_also_blocks(self):
        intent = await self.transfer()
        self.provider.org = D(101)
        self.assertEqual(
            (await self.post("transfer-send", {"intent_id": intent})).status, 503
        )

    async def test_insufficient_balance_includes_entire_transfer(self):
        response = await self.post(
            "transfer-prepare",
            {"recipient_id": "777", "asset": "USDT", "amount": "101"},
        )
        intent = (await response.json())["intent_id"]
        self.assertEqual(
            (await self.post("transfer-send", {"intent_id": intent})).status, 409
        )
        self.assertEqual(self.balance(), (D(100), D(0)))

    async def test_admin_adjustment_requires_actor_reason_and_balances_postings(self):
        body = {
            "account_id": "tg:123",
            "asset": "USDT",
            "amount": "2",
            "reason": "Support correction",
        }
        self.assertEqual((await self.post("finance-adjustment", body)).status, 403)
        self.assertEqual(
            (
                await self.post("finance-adjustment", {**body, "reason": ""}, OWNER)
            ).status,
            400,
        )
        self.assertEqual(
            (await self.post("finance-adjustment", body, OWNER)).status, 200
        )
        self.assertEqual(self.balance(), (D(102), D(0)))
        row = self.ledger.db.execute(
            "SELECT * FROM finance_transactions WHERE kind='admin_adjustment'"
        ).fetchone()
        self.assertEqual(row["actor"], "owner")
        self.assertEqual(row["reason"], "Support correction")

    async def test_accounting_mismatch_blocks_without_modifying_projection(self):
        self.ledger.db.execute(
            "UPDATE wallet_balances SET available='999' WHERE user_id='tg:123'"
        )
        with self.assertRaises(ApiError):
            self.balance()
        self.ledger.db.execute(
            "UPDATE wallet_balances SET available='100' WHERE user_id='tg:123'"
        )

    async def test_unknown_transfer_retry_4xx_keeps_reserve(self):
        intent = await self.transfer()
        self.provider.lose_transfer = True
        self.assertEqual(
            (await self.post("transfer-send", {"intent_id": intent})).status, 504
        )
        original = self.provider.call

        async def unavailable(method, data=None, post=False):
            if method == "getTransfers":
                return {"items": []}
            if method == "transfer":
                raise ApiError("NOT_ENABLED", "disabled after timeout", 403)
            return await original(method, data, post)

        self.provider.call = unavailable
        self.assertEqual(
            (await self.post("transfer-send", {"intent_id": intent})).status, 403
        )
        self.assertEqual(self.balance(), (D(90), D(10)))

    async def test_unknown_withdrawal_retry_4xx_keeps_reserve(self):
        quote = await (
            await self.post(
                "withdrawal-estimate",
                {
                    "asset": "USDT",
                    "network": "TRON",
                    "address": "T" + "a" * 33,
                    "amount": "10",
                },
            )
        ).json()
        original = self.provider.call

        async def lost(method, data=None, post=False):
            if method == "createWithdrawal":
                await original(method, data, post)
                raise ApiError("PROVIDER_TIMEOUT", "lost", 504)
            return await original(method, data, post)

        self.provider.call = lost
        self.assertEqual(
            (
                await self.post("withdrawal-create", {"intent_id": quote["intent_id"]})
            ).status,
            504,
        )

        async def rejected(method, data=None, post=False):
            if method == "createWithdrawal":
                raise ApiError("NOT_ENABLED", "disabled after timeout", 403)
            return await original(method, data, post)

        self.provider.call = rejected
        self.assertEqual(
            (
                await self.post("withdrawal-create", {"intent_id": quote["intent_id"]})
            ).status,
            403,
        )
        self.assertEqual(self.balance(), (D(89), D(11)))

    async def test_corrected_withdrawal_debt_and_next_deposit_are_balanced(self):
        from wallet_withdrawals import apply_outcome

        quote = await (
            await self.post(
                "withdrawal-estimate",
                {
                    "asset": "USDT",
                    "network": "TRON",
                    "address": "T" + "a" * 33,
                    "amount": "10",
                },
            )
        ).json()
        row = await (
            await self.post("withdrawal-create", {"intent_id": quote["intent_id"]})
        ).json()
        apply_outcome(
            self.ledger, {**row, "status": "failed", "version": 1}, money, ApiError
        )
        self.ledger.put_balance("tg:123", "USDT", D(0), D(0))
        apply_outcome(
            self.ledger, {**row, "status": "completed", "version": 2}, money, ApiError
        )
        self.assertEqual(self.ledger.book.bucket("tg:123", "USDT", "debt"), D(11))
        self.ledger.deposit(
            {
                "deposit_id": "repay",
                "client_ref": self.ledger.account("tg:123"),
                "asset": "USDT",
                "credited": "15",
            }
        )
        self.assertEqual(self.balance(), (D(4), D(0)))
        self.assertEqual(self.ledger.book.bucket("tg:123", "USDT", "debt"), D(0))

    async def test_worker_replays_unprocessed_inbox_after_restart(self):
        from wallet_inbox import store

        payload = {
            "deposit_id": "restart-credit",
            "client_ref": self.ledger.account("tg:123"),
            "asset": "USDT",
            "credited": "3",
        }
        store(
            self.ledger,
            json.dumps(
                {"update_type": "deposit_received", "payload": payload}
            ).encode(),
            "verified-by-receiver",
            True,
        )
        self.provider.org += 3
        other = Ledger(self.path)
        prepare_operations(other)
        prepare_ops(other)
        prepare_inbox(other)
        prepare_worker(other)
        try:
            await Worker(other, self.provider, money, ApiError).step()
            await Worker(other, self.provider, money, ApiError).step()
            self.assertEqual(other.balance("tg:123", "USDT"), (D(103), D(0)))
            self.assertIsNotNone(
                other.db.execute(
                    "SELECT processed_at FROM wallet_webhook_inbox WHERE entity_id='restart-credit'"
                ).fetchone()[0]
            )
        finally:
            other.db.close()

    async def test_missing_balance_projection_is_detected(self):
        self.ledger.db.execute("DELETE FROM wallet_balances WHERE user_id='tg:123'")
        with self.assertRaises(ApiError):
            self.ledger.book.verify()
        self.ledger.db.execute(
            "INSERT INTO wallet_balances VALUES ('tg:123','USDT','100','0')"
        )

    async def test_duplicate_transfer_webhook_never_refunds_twice(self):
        intent = await self.transfer()
        row = await (await self.post("transfer-send", {"intent_id": intent})).json()
        current = self.provider.transfers[row["spend_id"]]
        current["status"] = "reverted"
        self.provider.org += 10
        for _ in range(2):
            self.assertEqual(
                (await self.hook("transfer_reverted", current)).status, 200
            )
        self.assertEqual(self.balance(), (D(100), D(0)))

    async def test_legacy_opening_migration_is_exact_and_runs_once(self):
        import sqlite3

        path = self.tmp.name + "/legacy"
        db = sqlite3.connect(path)
        db.executescript(
            "CREATE TABLE wallet_balances(user_id TEXT,asset TEXT,available TEXT,reserved TEXT,PRIMARY KEY(user_id,asset));CREATE TABLE wallet_debts(user_id TEXT,asset TEXT,amount TEXT,PRIMARY KEY(user_id,asset));INSERT INTO wallet_balances VALUES ('tg:456','USDT','12.345678','2');INSERT INTO wallet_debts VALUES ('tg:456','USDT','1.2');"
        )
        db.commit()
        db.close()
        first = Ledger(path)
        try:
            first.book.verify()
            count = first.db.execute(
                "SELECT COUNT(*) FROM finance_transactions"
            ).fetchone()[0]
            self.assertEqual(first.balance("tg:456", "USDT"), (D("12.345678"), D(2)))
            self.assertEqual(first.book.bucket("tg:456", "USDT", "debt"), D("1.2"))
        finally:
            first.db.close()
        second = Ledger(path)
        try:
            second.book.verify()
            self.assertEqual(
                second.db.execute(
                    "SELECT COUNT(*) FROM finance_transactions"
                ).fetchone()[0],
                count,
            )
        finally:
            second.db.close()

    async def test_withdrawal_permission_requires_explicit_true(self):
        original = self.provider.call
        for me in [{}, {"can_withdraw": False}]:

            async def denied(method, data=None, post=False):
                if method == "getMe":
                    return me
                return await original(method, data, post)

            self.provider.call = denied
            response = await self.post(
                "withdrawal-estimate",
                {
                    "asset": "USDT",
                    "network": "TRON",
                    "address": "T" + "a" * 33,
                    "amount": "10",
                },
            )
            self.assertEqual(response.status, 403)
        self.assertFalse(
            any(
                m in {"estimateWithdrawal", "createWithdrawal"}
                for m, _, _ in self.provider.calls
            )
        )

    async def test_withdrawal_permission_revoked_after_estimate(self):
        quote = await (
            await self.post(
                "withdrawal-estimate",
                {
                    "asset": "USDT",
                    "network": "TRON",
                    "address": "T" + "a" * 33,
                    "amount": "10",
                },
            )
        ).json()
        original = self.provider.call

        async def denied(method, data=None, post=False):
            if method == "getMe":
                return {}
            return await original(method, data, post)

        self.provider.call = denied
        self.assertEqual(
            (
                await self.post("withdrawal-create", {"intent_id": quote["intent_id"]})
            ).status,
            403,
        )
        self.assertEqual(self.balance(), (D(100), D(0)))

    async def test_deposit_return_uses_original_owner_and_deduplicates(self):
        from wallet_inbox import apply_pages

        self.provider.entry("deposit_return", "-40", {"deposit_id": "seed"})
        for _ in range(2):
            apply_pages(
                self.ledger,
                [{"items": self.provider.journal, "cursor": 5}],
                money,
                ApiError,
            )
        self.assertEqual(self.balance(), (D(60), D(0)))
        self.assertEqual(
            self.ledger.db.execute(
                "SELECT COUNT(*) FROM finance_provider_effects"
            ).fetchone()[0],
            1,
        )

    async def test_spent_deposit_return_creates_debt_and_restart_restores_owner(self):
        from wallet_inbox import apply_pages

        self.ledger.put_balance("tg:123", "USDT", D(5), D(0))
        self.ledger.db.execute("DELETE FROM wallet_deposit_owners")
        other = Ledger(self.path)
        prepare_operations(other)
        prepare_ops(other)
        prepare_inbox(other)
        prepare_worker(other)
        try:
            self.provider.entry("deposit_return", "-40", {"deposit_id": "seed"})
            for _ in range(2):
                apply_pages(
                    other,
                    [{"items": self.provider.journal, "cursor": 5}],
                    money,
                    ApiError,
                )
            self.assertEqual(other.balance("tg:123", "USDT"), (D(0), D(0)))
            self.assertEqual(other.book.bucket("tg:123", "USDT", "debt"), D(35))
        finally:
            other.db.close()

    async def test_definitive_invoice_failure_rejects_intent(self):
        original = self.provider.call
        for status in [400, 403, 422]:
            intent = await self.invoice()

            async def reject(method, data=None, post=False):
                if method == "createInvoice":
                    raise ApiError("REJECTED", "definitive", status)
                return await original(method, data, post)

            self.provider.call = reject
            response = await self.post("invoice-create", {"intent_id": intent})
            self.assertEqual(response.status, status)
            self.assertEqual(
                (await response.json())["error"]["name"], "INVOICE_REJECTED"
            )
            self.assertEqual(
                self.ledger.db.execute(
                    "SELECT state FROM wallet_user_invoices WHERE intent_id=?",
                    (intent,),
                ).fetchone()[0],
                "rejected",
            )
            self.assertEqual(
                (await self.post("invoice-create", {"intent_id": intent})).status, 409
            )
        self.provider.call = original
        new = await self.invoice()
        self.assertEqual(
            (await self.post("invoice-create", {"intent_id": new})).status, 200
        )

    async def test_terminal_history_does_not_consume_worker_calls(self):
        for n in range(3000):
            self.ledger.db.execute(
                "INSERT INTO wallet_user_transfers VALUES (?,?,?,?,?,?,?,?)",
                (str(n), "tg:123", "old" + str(n), "{}", "completed", None, str(n), 0),
            )
            self.ledger.db.execute(
                "INSERT INTO wallet_user_invoices VALUES (?,?,?,?,?,?,?,?)",
                (str(n), "tg:123", "payload" + str(n), "{}", "paid", str(n), "{}", 0),
            )
        await Worker(self.ledger, self.provider, money, ApiError).step()
        self.assertFalse(
            any(m in {"getTransfers", "getInvoices"} for m, _, _ in self.provider.calls)
        )
        self.assertTrue(any(m == "getTransactions" for m, _, _ in self.provider.calls))
        self.assertTrue(any(m == "getBalance" for m, _, _ in self.provider.calls))

    async def test_worker_budget_and_backoff_survive_restart(self):
        from wallet_finance_worker import BudgetProvider, BudgetExhausted

        worker = Worker(self.ledger, self.provider, money, ApiError)
        limited = BudgetProvider(worker)
        for _ in range(4):
            await limited.call("getBalance")
        with self.assertRaises(BudgetExhausted):
            await limited.call("getBalance")
        original = self.provider.call

        async def unavailable(method, data=None, post=False):
            if method == "getInvoices":
                raise ApiError("RATE_LIMITED", "rate", 429, "120")
            return await original(method, data, post)

        self.provider.call = unavailable
        with self.assertRaises(ApiError):
            await BudgetProvider(worker).call("getInvoices", {})
        with self.assertRaises(BudgetExhausted):
            await BudgetProvider(
                Worker(self.ledger, self.provider, money, ApiError)
            ).call("getInvoices", {})
        await Worker(self.ledger, self.provider, money, ApiError).step()
        self.assertTrue(any(m == "getTransactions" for m, _, _ in self.provider.calls))
        self.assertTrue(any(m == "getBalance" for m, _, _ in self.provider.calls))

    async def test_terminal_transfer_refreshed_from_journal_only_once(self):
        intent = await self.transfer()
        self.provider.next_transfer = "completed"
        result = await (await self.post("transfer-send", {"intent_id": intent})).json()
        self.provider.transfers[result["spend_id"]]["status"] = "reverted"
        self.provider.org += 10
        self.provider.entry(
            "transfer_revoked",
            "10",
            {"spend_id": result["spend_id"], "transfer_id": result["transfer_id"]},
        )
        await Worker(self.ledger, self.provider, money, ApiError).step()
        self.assertEqual(self.balance(), (D(100), D(0)))
        reads = sum(m == "getTransfers" for m, _, _ in self.provider.calls)
        await Worker(self.ledger, self.provider, money, ApiError).step()
        self.assertEqual(
            sum(m == "getTransfers" for m, _, _ in self.provider.calls), reads
        )
        self.assertEqual(self.balance(), (D(100), D(0)))

    async def test_cycle_total_call_budget_is_enforced(self):
        from wallet_finance_worker import BudgetProvider, BudgetExhausted

        limited = BudgetProvider(Worker(self.ledger, self.provider, money, ApiError))
        for method in [
            "getBalance",
            "getMe",
            "getCurrencies",
            "getDeposits",
            "getTransactions",
            "getInvoices",
        ]:
            for _ in range(4):
                await limited.call(method, {"after": 0})
        self.assertEqual(limited.total, 24)
        with self.assertRaises(BudgetExhausted):
            await limited.call("getQrPayments", {})

    async def test_invoice_429_waits_and_retries_same_payload_once(self):
        import time

        stamp = time.time()
        original = self.provider.call
        posts = []

        async def rate_limited(method, data=None, post=False):
            if method == "createInvoice":
                posts.append(dict(data))
                if len(posts) == 1:
                    raise ApiError("RATE_LIMITED", "Wait", 429, "120")
            return await original(method, data, post)

        self.provider.call = rate_limited
        intent = await self.invoice()
        with patch("wallet_user_ops.time.time", return_value=stamp):
            response = await self.post("invoice-create", {"intent_id": intent})
            self.assertEqual(response.status, 429)
            self.assertEqual(response.headers["Retry-After"], "120")
            row = self.ledger.db.execute(
                "SELECT state FROM wallet_user_invoices WHERE intent_id=?", (intent,)
            ).fetchone()
            self.assertEqual(row["state"], "prepared")
            other = Ledger(self.path)
            prepare_ops(other)
            try:
                from wallet_user_ops import create_invoice

                with self.assertRaises(ApiError) as failure:
                    await create_invoice(
                        other, self.provider, "tg:123", intent, ApiError
                    )
                self.assertEqual(failure.exception.status, 429)
                retry = other.db.execute(
                    "SELECT * FROM wallet_invoice_retries WHERE intent_id=?", (intent,)
                ).fetchone()
                self.assertEqual(retry["retry_after"], "120")
                self.assertEqual(retry["retry_at"], stamp + 120)
            finally:
                other.db.close()
            self.assertEqual(len(posts), 1)
        with patch("wallet_user_ops.time.time", return_value=stamp + 121):
            responses = await asyncio.gather(
                *[self.post("invoice-create", {"intent_id": intent}) for _ in range(2)]
            )
            self.assertEqual([response.status for response in responses], [200, 200])
        self.assertEqual(len(posts), 2)
        self.assertEqual(posts[0], posts[1])
        self.assertEqual(len(self.provider.invoices), 1)

    async def test_worker_critical_errors_and_backoff_preserve_last_success(self):
        await Worker(self.ledger, self.provider, money, ApiError).step()

        def state():
            return dict(
                self.ledger.db.execute(
                    "SELECT key,value FROM finance_worker_state"
                ).fetchall()
            )

        success = state()["last_success"]
        original = self.provider.call
        for target in ["getTransactions", "getBalance"]:

            async def broken(method, data=None, post=False):
                if method == target:
                    raise ApiError("UNAVAILABLE", "critical " + target, 503, "120")
                return await original(method, data, post)

            self.provider.call = broken
            await Worker(self.ledger, self.provider, money, ApiError).step()
            self.assertEqual(state()["health"], "degraded")
            self.assertEqual(state()["last_success"], success)
            self.assertTrue(state()["last_error"])
            self.provider.call = original
            await Worker(self.ledger, self.provider, money, ApiError).step()
            self.assertEqual(state()["health"], "degraded")
            self.assertEqual(state()["last_success"], success)
            self.ledger.db.execute(
                "DELETE FROM finance_worker_state WHERE key LIKE 'backoff:%'"
            )
            await Worker(self.ledger, self.provider, money, ApiError).step()
            self.assertEqual(state()["health"], "healthy")
            self.assertEqual(state()["last_error"], "")
            self.assertGreater(float(state()["last_success"]), float(success))
            success = state()["last_success"]
