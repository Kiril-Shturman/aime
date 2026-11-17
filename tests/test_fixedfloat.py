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
from wallet_backend import ApiError, install_wallet
from wallet_fixedfloat import FixedFloat, NETWORKS


class FixedFloatTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.calls = []
        self.disabled = set()
        self.errors = []
        self.http_status = 200
        self.bad_identity = False
        self.adjust_amount = False
        self.provider_code = 0
        self.key, self.secret = "test-key", "test-secret"
        app = web.Application()
        app.router.add_post("/{method}", self.provider)
        self.server = TestServer(app)
        await self.server.start_server()
        self.adapter = FixedFloat(
            self.key, self.secret, ApiError, str(self.server.make_url("")).rstrip("/")
        )

    async def asyncTearDown(self):
        await self.adapter.close()
        await self.server.close()

    async def provider(self, request):
        raw = await request.read()
        self.assertEqual(request.headers["X-API-KEY"], self.key)
        self.assertEqual(
            request.headers["X-API-SIGN"],
            hmac.new(self.secret.encode(), raw, hashlib.sha256).hexdigest(),
        )
        method = request.match_info["method"]
        body = json.loads(raw)
        self.calls.append((method, body))
        if self.http_status != 200:
            return web.json_response(
                {"secret": "must never reach browser"},
                status=self.http_status,
                headers={"Retry-After": "45"},
            )
        if self.provider_code:
            return web.json_response(
                {
                    "code": self.provider_code,
                    "msg": "must never reach browser: " + self.secret,
                }
            )
        if method == "ccies":
            data = [
                {
                    "code": v[0],
                    "coin": "USDT",
                    "network": v[1],
                    "recv": int(k not in self.disabled),
                    "send": int(k not in self.disabled),
                }
                for k, v in NETWORKS.items()
            ]
        elif method == "price":
            source = next(v for v in NETWORKS.values() if v[0] == body["fromCcy"])
            target = next(v for v in NETWORKS.values() if v[0] == body["toCcy"])
            data = {
                "from": {
                    "code": source[0],
                    "coin": "USDT",
                    "network": source[1],
                    "amount": str(
                        Decimal(body["amount"]) + (1 if self.adjust_amount else 0)
                    ),
                },
                "to": {
                    "code": target[0],
                    "coin": "USDT",
                    "network": "WRONG" if self.bad_identity else target[1],
                    "amount": str(
                        Decimal(body["amount"]) * Decimal(".995") - Decimal(".308")
                    ),
                },
                "errors": self.errors,
            }
        else:
            raise AssertionError("Order endpoint called")
        return web.json_response({"code": 0, "msg": "OK", "data": data})

    def body(self, **values):
        return {
            "from_network": "TRON",
            "to_network": "BSC",
            "amount": "100",
            "rate_type": "float",
            **values,
        }

    async def test_signed_quote_has_exact_decimal_difference_and_no_order(self):
        quote = await self.adapter.quote(self.body())
        self.assertTrue(quote["available"])
        self.assertEqual(quote["to_amount"], "99.192")
        self.assertEqual(quote["difference"], "0.808")
        self.assertFalse(quote["execution_enabled"])
        self.assertEqual([method for method, _ in self.calls], ["ccies", "price"])
        self.assertEqual(
            self.calls[-1][1],
            {
                "fromCcy": "USDTTRC",
                "toCcy": "USDTBSC",
                "amount": "100",
                "direction": "from",
                "type": "float",
            },
        )

    async def test_unavailable_currency_does_not_request_price(self):
        self.disabled.add("TON")
        quote = await self.adapter.quote(self.body(to_network="TON"))
        self.assertFalse(quote["available"])
        self.assertIsNone(quote["to_amount"])
        self.assertEqual(self.calls[0][0], "ccies")
        self.assertEqual(len(self.calls), 1)

    async def test_maintenance_limits_and_unknown_provider_errors_hide_amount(self):
        for reason in [
            "MAINTENANCE_TO",
            "LIMIT_MIN",
            "LIMIT_MAX",
            "RESERVE_TO",
            "new-provider-reason",
        ]:
            self.errors = [reason]
            quote = await self.adapter.quote(self.body())
            self.assertFalse(quote["available"])
            self.assertIsNone(quote["to_amount"])
            self.assertIsNone(quote["difference"])

    async def test_provider_cannot_change_network_or_amount(self):
        self.bad_identity = True
        with self.assertRaises(ValueError):
            await self.adapter.quote(self.body())
        self.bad_identity = False
        self.adjust_amount = True
        with self.assertRaises(ValueError):
            await self.adapter.quote(self.body())

    async def test_rejects_invalid_inputs_before_provider(self):
        for body in [
            self.body(amount="NaN"),
            self.body(amount="1e3"),
            self.body(amount="0"),
            self.body(amount="0.0000001"),
            self.body(amount=100),
            self.body(to_network="TRON"),
            self.body(to_network="http://attacker"),
            self.body(spend_id="client-id"),
        ]:
            with self.assertRaises(ValueError):
                await self.adapter.quote(body)
        self.assertEqual(self.calls, [])

    async def test_no_money_method_is_exposed(self):
        for method in ["create", "order", "emergency"]:
            with self.assertRaises(ValueError):
                await self.adapter.call(method, {})
        self.assertEqual(self.calls, [])

    async def test_currency_cache_collapses_concurrent_requests(self):
        await asyncio.gather(*[self.adapter.networks() for _ in range(5)])
        self.assertEqual(len(self.calls), 1)

    async def test_rate_limit_and_provider_error_do_not_expose_secrets(self):
        for status in [429, 403, 502]:
            self.http_status = status
            with self.assertRaises(ApiError) as error:
                await self.adapter.call("ccies", {})
            self.assertNotIn(self.secret, error.exception.detail)
            self.assertEqual(error.exception.status, 429 if status == 429 else 503)
            if status == 429:
                self.assertEqual(error.exception.retry_after, "45")
        self.http_status = 200
        self.provider_code = 123
        with self.assertRaises(ApiError) as error:
            await self.adapter.call("ccies", {})
        self.assertNotIn(self.secret, error.exception.detail)

    async def test_quote_routes_work_without_goswap_and_do_not_change_money(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(
            os.environ,
            {
                "GOSWAP_API_TOKEN": "",
                "WPAY_BOT_TOKEN": "",
                "BOARD_BOT_TOKEN": "",
                "WPAY_DB_PATH": root + "/db",
                "WPAY_FINANCE_WORKER": "0",
            },
        ), patch("wallet_backend.FixedFloat", return_value=self.adapter):
            app = web.Application()
            install_wallet(app, root, lambda key: key == "owner-test-key")
            client = TestClient(TestServer(app))
            await client.start_server()
            try:
                response = await client.get("/api/wallet/exchange-status")
                self.assertEqual(response.status, 401)
                headers = {"X-Board-Key": "owner-test-key"}
                response = await client.get(
                    "/api/wallet/exchange-status", headers=headers
                )
                status = await response.json()
                self.assertEqual(response.status, 200)
                self.assertTrue(status["configured"])
                self.assertNotIn(self.key, json.dumps(status))
                self.assertNotIn(self.secret, json.dumps(status))
                response = await client.post(
                    "/api/wallet/exchange-quote", json=self.body(), headers=headers
                )
                quote = await response.json()
                self.assertEqual(response.status, 200)
                self.assertEqual(quote["to_amount"], "99.192")
                self.assertEqual(
                    app["wpay_ledger"].balance("owner", "USDT"),
                    (Decimal(0), Decimal(0)),
                )
                self.assertEqual(
                    app["wpay_ledger"]
                    .db.execute("SELECT COUNT(*) FROM finance_transactions")
                    .fetchone()[0],
                    0,
                )
                for _ in range(19):
                    response = await client.get(
                        "/api/wallet/exchange-status", headers=headers
                    )
                self.assertEqual(response.status, 429)
            finally:
                await client.close()

    async def test_not_configured_returns_503_without_network(self):
        other = FixedFloat("", "", ApiError)
        try:
            with self.assertRaises(ApiError) as error:
                await other.quote(self.body())
            self.assertEqual(error.exception.status, 503)
        finally:
            await other.close()

    async def test_quote_budget_is_shared_between_backend_instances(self):
        from wallet_backend import Ledger
        from wallet_fixedfloat import prepare_exchange_limits

        with tempfile.TemporaryDirectory() as root:
            first = Ledger(root + "/db")
            prepare_exchange_limits(first)
            second = Ledger(root + "/db")
            prepare_exchange_limits(second)
            other = FixedFloat("other-key", "other-secret", ApiError)
            self.adapter.ledger = first
            other.ledger = second
            try:
                for index in range(20):
                    (self.adapter if index % 2 else other).throttle("same-user")
                with self.assertRaises(ApiError):
                    other.throttle("same-user")
                for index in range(80):
                    (self.adapter if index % 2 else other).throttle(
                        "user-" + str(index)
                    )
                with self.assertRaises(ApiError):
                    self.adapter.throttle("new-user")
                self.assertEqual(
                    second.db.execute(
                        "SELECT COUNT(*) FROM wallet_exchange_rate_limits"
                    ).fetchone()[0],
                    100,
                )
                self.assertEqual(
                    first.db.execute(
                        "SELECT COUNT(*) FROM finance_transactions"
                    ).fetchone()[0],
                    0,
                )
            finally:
                self.adapter.ledger = None
                first.db.close()
                second.db.close()
                await other.close()
