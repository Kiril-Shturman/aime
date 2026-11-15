"""Local Aura contract mock for development without provider credentials.

Run: ``python3 wallet_aura_mock.py``.  This process is test-only and binds to
127.0.0.1.  It never accepts an Aura production key.
"""

import argparse
import hashlib
import json
import time
import uuid
from decimal import Decimal

from aiohttp import web

MOCK_KEY = "ak_test_local_mock"
MOCK_PARTNER = "partner_local_mock"


class State:
    def __init__(self):
        self.customers = {}
        self.kyc = {}
        self.cards = {}
        self.card_operations = []
        self.orders = {}
        self.qr_payments = {}
        self.withdrawals = {}
        self.products = {"crypto_processing": True, "cards": True,
                         "sbp_buy": True, "qr_pay": True}
        self.addresses = {}
        self.deposits = []
        self.balance = Decimal("0")
        self.idempotency = {}


def envelope(code, message, status=400, error_type="invalid_request_error", **details):
    request_id = "req_" + uuid.uuid4().hex
    return web.json_response(
        {"error": {"code": code, "type": error_type, "message": message,
                   "request_id": request_id, "doc_url": "https://local.invalid/errors#" + code,
                   **({"details": details} if details else {})}},
        status=status, headers={"X-Request-Id": request_id},
    )


@web.middleware
async def auth_and_limits(request, handler):
    if request.path.startswith("/mock/"):
        return await handler(request)
    if request.headers.get("X-API-Key") != MOCK_KEY:
        return envelope("unauthenticated", "Invalid local mock key", 401, "authentication_error")
    response = await handler(request)
    response.headers["X-RateLimit-Limit"] = "100"
    response.headers["X-RateLimit-Remaining"] = "99"
    response.headers["X-RateLimit-Reset"] = "1"
    response.headers["X-Request-Id"] = response.headers.get("X-Request-Id", "req_" + uuid.uuid4().hex)
    return response


def make_app():
    app = web.Application(middlewares=[auth_and_limits])
    state = State()
    app["state"] = state

    async def me(_):
        return web.json_response({
            "partner_id": MOCK_PARTNER, "environment": "test",
            "products": dict(state.products),
        })

    async def customers(request):
        body = await request.json()
        customer_id = str(body.get("id") or "")
        if not customer_id:
            return envelope("invalid_argument", "id is required")
        item = state.customers.setdefault(customer_id, {
            "id": customer_id, "status": "registered",
            "created_at": "2026-01-01T00:00:00Z",
        })
        item.update({key: body[key] for key in ("email", "phone") if key in body})
        return web.json_response(item)

    async def list_customers(request):
        items = list(reversed(list(state.customers.values())))
        limit = min(max(int(request.query.get("limit", "100")), 1), 100)
        return web.json_response({"data": items[:limit], "next_cursor": None})

    async def customer(request):
        customer_id = request.match_info["customer_id"]
        if customer_id not in state.customers:
            return envelope("customer_not_found", "Customer not found", 404)
        return web.json_response(state.customers[customer_id])

    async def kyc_status(request):
        customer_id = request.match_info["customer_id"]
        if customer_id not in state.customers:
            return envelope("customer_not_found", "Customer not found", 404)
        return web.json_response(state.kyc.get(customer_id, {
            "customer_id": customer_id, "status": "not_started",
            "verified": False, "terminal": False,
            "updated_at": "2026-01-01T00:00:00Z",
        }))

    async def start_kyc(request):
        customer_id = request.match_info["customer_id"]
        customer_item = state.customers.get(customer_id)
        if not customer_item:
            return envelope("customer_not_found", "Customer not found", 404)
        if not customer_item.get("email"):
            return envelope("kyc_email_required", "Customer email is required", 412)
        item = state.kyc.setdefault(customer_id, {
            "customer_id": customer_id, "status": "pending",
            "verified": False, "terminal": False,
            "updated_at": "2026-01-01T00:01:00Z",
        })
        return web.json_response({
            **item, "verification_url": "https://local.invalid/kyc/" + customer_id,
        })

    async def set_kyc(request):
        body = await request.json()
        customer_id = str(body.get("customer_id") or "")
        if customer_id not in state.customers:
            return envelope("customer_not_found", "Customer not found", 404)
        status = str(body.get("status") or "verified")
        item = {
            "customer_id": customer_id, "status": status,
            "verified": bool(body.get("verified", status == "verified")),
            "terminal": bool(body.get("terminal", status in {"verified", "rejected"})),
            "reason": body.get("reason"),
            "updated_at": str(body.get("updated_at") or "2026-01-01T00:02:00Z"),
        }
        state.kyc[customer_id] = item
        event = {
            "event": "customer.kyc.updated", "event_id": "evt_" + uuid.uuid4().hex,
            "occurred_at": item["updated_at"], "partner_id": MOCK_PARTNER,
            "data": item,
        }
        return web.json_response({"kyc": item, "webhook": event})

    async def addresses(request):
        customer_id = request.match_info["customer_id"]
        if customer_id not in state.customers:
            return envelope("customer_not_found", "Customer not found", 404)
        if customer_id not in state.addresses:
            digest = hashlib.sha256(customer_id.encode()).hexdigest()
            state.addresses[customer_id] = [{
                "id": "addr_" + digest[:24], "customer_id": customer_id,
                "network": "nile", "address": "T" + digest[:33],
                "is_default": True, "label": None,
            }]
        return web.json_response({"data": state.addresses[customer_id], "next_cursor": None})

    async def deposits(request):
        customer_id = request.query.get("customer_id")
        items = [item for item in reversed(state.deposits)
                 if not customer_id or item["customer_id"] == customer_id]
        return web.json_response({"data": items[:int(request.query.get("limit", "100"))], "next_cursor": None})

    async def deposit(request):
        deposit_id = request.match_info["deposit_id"]
        item = next((item for item in state.deposits if item["id"] == deposit_id), None)
        if item is None:
            return envelope("deposit_not_found", "Deposit not found", 404)
        return web.json_response(item)

    async def deposit_fees(_):
        return web.json_response({"fee_type": "percent", "fee": "1", "fee_min": "0.5"})

    async def balance(_):
        return web.json_response({
            "platform_balance": str(state.balance), "cards_balance": "0",
            "deposit_address": "TLOCALMOCKBALANCEADDRESS",
        })

    async def card_fees(_):
        return web.json_response({
            "currency": "USDT", "issue_fee": "15", "recharge_fee": "0",
            "minimum_recharge": "1", "updated_at": "2026-01-01T00:00:00Z",
        })

    async def cards(request):
        items = list(reversed(list(state.cards.values())))
        limit = min(max(int(request.query.get("limit", "100")), 1), 100)
        return web.json_response({"data": items[:limit], "next_cursor": None})

    async def card(request):
        card_id = request.match_info["card_id"]
        if card_id not in state.cards:
            return envelope("card_not_found", "Card not found", 404)
        return web.json_response(state.cards[card_id])

    async def card_operations(request):
        card_id = request.match_info.get("card_id")
        items = [item for item in reversed(state.card_operations)
                 if not card_id or item["card_id"] == card_id]
        limit = min(max(int(request.query.get("limit", "100")), 1), 100)
        return web.json_response({"data": items[:limit], "next_cursor": None})

    def idempotent(request, body, create):
        key = request.headers.get("Idempotency-Key")
        if not key:
            return envelope("idempotency_key_required", "Idempotency-Key is required", 400)
        fingerprint = json.dumps(body, sort_keys=True, separators=(",", ":"))
        slot = (request.method, request.path, key)
        previous = state.idempotency.get(slot)
        if previous:
            if previous[0] != fingerprint:
                return envelope("idempotency_key_reused", "Idempotency-Key was reused", 409)
            return web.json_response(previous[1])
        result = create()
        state.idempotency[slot] = (fingerprint, result)
        return web.json_response(result)

    async def open_card(request):
        body = await request.json()
        owner_id = str(body.get("owner_id") or "")
        kind = str(body.get("kind") or "")
        if owner_id not in state.customers:
            return envelope("customer_not_found", "Customer not found", 404)
        if kind not in {"virtual", "physical"}:
            return envelope("invalid_argument", "kind is invalid", 400)
        if kind == "physical" and not isinstance(body.get("shipping_address"), dict):
            return envelope("invalid_argument", "shipping_address is required", 400)

        def create():
            card_id = str(uuid.uuid4())
            item = {
                "id": card_id, "owner_id": owner_id, "customer_id": owner_id,
                "kind": kind, "status": "processing", "frozen": False,
                "masked_pan": None, "delivery_status": "issuing" if kind == "physical" else None,
                "tracking": None, "updated_at": "2026-01-01T00:03:00Z",
            }
            state.cards[card_id] = item
            state.balance -= Decimal("15")
            return item

        return idempotent(request, body, create)

    async def recharge_card(request):
        card_id = request.match_info["card_id"]
        card_item = state.cards.get(card_id)
        if not card_item:
            return envelope("card_not_found", "Card not found", 404)
        body = await request.json()
        if ("amount" in body) == ("amount_spend" in body):
            return envelope("invalid_argument", "Provide amount or amount_spend", 400)
        requested = Decimal(str(body.get("amount", body.get("amount_spend"))))
        if requested <= 0:
            return envelope("amount_out_of_range", "amount is invalid", 400)

        def create():
            result = {
                "id": "recharge_" + uuid.uuid4().hex,
                "card_id": card_id, "status": "completed", "currency": "USDT",
                "charged_amount": str(requested), "recharge_amount": str(requested),
                "fee": "0", "failure_reason": None,
                "updated_at": "2026-01-01T00:05:00Z",
            }
            state.balance -= requested
            return result

        return idempotent(request, body, create)

    async def cancel_card(request):
        card_id = request.match_info["card_id"]
        item = state.cards.get(card_id)
        if not item:
            return envelope("card_not_found", "Card not found", 404)
        if item["status"] != "processing":
            return envelope(
                "card_request_not_cancelable", "Card request cannot be cancelled", 409
            )
        item["status"] = "cancelled"
        item["updated_at"] = "2026-01-01T00:06:00Z"
        state.balance += Decimal("15")
        return web.json_response(item)

    async def create_card(request):
        body = await request.json()
        customer_id = str(body.get("customer_id") or "")
        if customer_id not in state.customers:
            return envelope("customer_not_found", "Customer not found", 404)
        card_id = "card_" + uuid.uuid4().hex
        item = {
            "id": card_id, "customer_id": customer_id,
            "kind": str(body.get("kind") or "virtual"), "status": "opened",
            "frozen": False, "masked_pan": "**** 4242",
            "updated_at": "2026-01-01T00:03:00Z",
        }
        state.cards[card_id] = item
        event = {
            "event": "card.opened", "event_id": "evt_" + uuid.uuid4().hex,
            "occurred_at": item["updated_at"], "partner_id": MOCK_PARTNER,
            "api_version": "3.17.0",
            "data": {
                "card_id": card_id, "card_number_masked": item["masked_pan"],
                "customer_id": str(uuid.uuid4()), "owner_id": customer_id,
                "status": "opened",
            },
        }
        return web.json_response({"card": item, "webhook": event})

    async def create_card_operation(request):
        body = await request.json()
        card_id = str(body.get("card_id") or "")
        if card_id not in state.cards:
            return envelope("card_not_found", "Card not found", 404)
        item = {
            "id": "op_" + uuid.uuid4().hex, "card_id": card_id,
            "type": str(body.get("type") or "purchase"),
            "status": str(body.get("status") or "completed"),
            "asset": "USDT", "amount": str(body.get("amount") or "1"),
            "fee": str(body.get("fee") or "0"),
            "merchant": body.get("merchant") or "Local Store",
            "updated_at": "2026-01-01T00:04:00Z",
        }
        state.card_operations.append(item)
        event = {
            "event": "card.operation", "event_id": "evt_" + uuid.uuid4().hex,
            "occurred_at": item["updated_at"], "partner_id": MOCK_PARTNER,
            "data": item,
        }
        return web.json_response({"operation": item, "webhook": event})

    async def sbp_rate(_):
        return web.json_response({
            "rate": "92.50", "fiat": "RUB", "asset": "USDT",
            "min_amount": "1000", "max_amount": "100000",
            "updated_at": "2026-01-01T00:00:00Z",
        })

    async def orders(request):
        items = list(reversed(list(state.orders.values())))
        limit = min(max(int(request.query.get("limit", "100")), 1), 100)
        return web.json_response({"data": items[:limit], "next_cursor": None})

    async def order(request):
        order_id = request.match_info["order_id"]
        if order_id not in state.orders:
            return envelope("order_not_found", "Order not found", 404)
        return web.json_response(state.orders[order_id])

    async def create_order_event(request):
        body = await request.json()
        customer_id = str(body.get("customer_id") or "")
        if customer_id not in state.customers:
            return envelope("customer_not_found", "Customer not found", 404)
        status = str(body.get("status") or "completed")
        order_id = "order_" + uuid.uuid4().hex
        item = {
            "id": order_id, "customer_id": customer_id, "status": status,
            "rub_amount": str(body.get("rub_amount") or "9250"),
            "usdt_amount": str(body.get("usdt_amount") or "100"),
            "fee": str(body.get("fee") or "0"),
            "updated_at": "2026-01-01T00:05:00Z",
        }
        state.orders[order_id] = item
        event = {
            "event": "order." + status, "event_id": "evt_" + uuid.uuid4().hex,
            "occurred_at": item["updated_at"], "partner_id": MOCK_PARTNER,
            "data": item,
        }
        return web.json_response({"order": item, "webhook": event})

    async def list_qr_payments(request):
        items = list(reversed(list(state.qr_payments.values())))
        return web.json_response({"data": items[:int(request.query.get("limit", "100"))], "next_cursor": None})

    async def qr_payment(request):
        item = state.qr_payments.get(request.match_info["payment_id"])
        return web.json_response(item) if item else envelope("not_found", "Payment not found", 404)

    async def list_withdrawals(request):
        items = list(reversed(list(state.withdrawals.values())))
        return web.json_response({"data": items[:int(request.query.get("limit", "100"))], "next_cursor": None})

    async def withdrawal(request):
        item = state.withdrawals.get(request.match_info["withdrawal_id"])
        return web.json_response(item) if item else envelope("not_found", "Withdrawal not found", 404)

    async def create_deposit(request):
        body = await request.json()
        customer_id = str(body.get("customer_id") or "")
        if customer_id not in state.customers:
            return envelope("customer_not_found", "Customer not found", 404)
        amount = Decimal(str(body.get("amount") or "0"))
        fee = Decimal(str(body.get("fee") or "0"))
        if amount <= 0 or fee < 0 or fee > amount:
            return envelope("amount_out_of_range", "Invalid amount")
        if customer_id not in state.addresses:
            digest = hashlib.sha256(customer_id.encode()).hexdigest()
            state.addresses[customer_id] = [{
                "id": "addr_" + digest[:24], "customer_id": customer_id,
                "network": "nile", "address": "T" + digest[:33],
                "is_default": True, "label": None,
            }]
        item = {
            "id": "dep_" + uuid.uuid4().hex, "customer_id": customer_id,
            "address_id": state.addresses[customer_id][0]["id"], "status": "confirmed",
            "currency": "USDT", "network": "nile", "amount": str(amount),
            "fee": str(fee), "net_amount": str(amount - fee),
            "transaction_hash": uuid.uuid4().hex, "confirmations": 20,
            "confirmed_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z",
        }
        state.deposits.append(item)
        state.balance += amount - fee
        event = {
            "event": "customer.deposit.confirmed", "event_id": "evt_" + uuid.uuid4().hex,
            "occurred_at": "2026-01-01T00:00:00Z", "partner_id": MOCK_PARTNER,
            "data": item,
        }
        return web.json_response({"deposit": item, "webhook": event})

    app.router.add_get("/v1/partner/me", me)
    app.router.add_get("/v1/partner/customers", list_customers)
    app.router.add_post("/v1/partner/customers", customers)
    app.router.add_get("/v1/partner/customers/{customer_id}", customer)
    app.router.add_get("/v1/partner/customers/{customer_id}/kyc", kyc_status)
    app.router.add_post("/v1/partner/customers/{customer_id}/kyc", start_kyc)
    app.router.add_get("/v1/partner/customers/{customer_id}/deposit-addresses", addresses)
    app.router.add_get("/v1/partner/deposits", deposits)
    app.router.add_get("/v1/partner/deposits-fees", deposit_fees)
    app.router.add_get("/v1/partner/deposits/{deposit_id}", deposit)
    app.router.add_get("/v1/partner/balance", balance)
    app.router.add_get("/v1/partner/cards-fees", card_fees)
    app.router.add_post("/v1/partner/cards", open_card)
    app.router.add_get("/v1/partner/cards", cards)
    app.router.add_get("/v1/partner/cards/operations", card_operations)
    app.router.add_get("/v1/partner/cards/{card_id}/operations", card_operations)
    app.router.add_get("/v1/partner/cards/{card_id}", card)
    app.router.add_post("/v1/partner/cards/{card_id}/recharge", recharge_card)
    app.router.add_post("/v1/partner/cards/{card_id}/cancel", cancel_card)
    app.router.add_get("/v1/partner/rate", sbp_rate)
    app.router.add_get("/v1/partner/orders", orders)
    app.router.add_get("/v1/partner/orders/{order_id}", order)
    app.router.add_get("/v1/partner/qr-payments", list_qr_payments)
    app.router.add_get("/v1/partner/qr-payments/{payment_id}", qr_payment)
    app.router.add_get("/v1/partner/withdrawals", list_withdrawals)
    app.router.add_get("/v1/partner/withdrawals/{withdrawal_id}", withdrawal)
    app.router.add_post("/mock/deposits", create_deposit)
    app.router.add_post("/mock/kyc", set_kyc)
    app.router.add_post("/mock/cards", create_card)
    app.router.add_post("/mock/card-operations", create_card_operation)
    app.router.add_post("/mock/orders", create_order_event)
    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8099)
    args = parser.parse_args()
    web.run_app(make_app(), host="127.0.0.1", port=args.port)
