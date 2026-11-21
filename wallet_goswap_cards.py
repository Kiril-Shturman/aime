"""Customer GoSwap issuance, isolated from the operator API console."""
import asyncio
import json
import time
import uuid
from datetime import datetime, timezone
from decimal import Decimal, localcontext
from aiohttp import web
from wallet_finance import aura_available, require_coverage, require_goswap_user_funds
from wallet_tariffs import GOSWAP_CARD_PLANS, active, card_issue_enabled, storefront_positions
from wallet_withdrawals import debt

ASSET = "USDT"
TERMINAL = {"completed", "failed"}


class GoSwapCards:
    def __init__(self, ledger, provider, money, error):
        self.ledger, self.provider, self.money, self.error = ledger, provider, money, error
        self.db = ledger.db
        self.catalogue_lock = asyncio.Lock()
        self.catalogue_cache = (0, {})
        self.db.execute("""CREATE TABLE IF NOT EXISTS wallet_goswap_card_issues (
            intent_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan TEXT NOT NULL,
            product TEXT NOT NULL, client_ref TEXT NOT NULL, spend_id TEXT NOT NULL UNIQUE,
            provider_fee TEXT NOT NULL, service_fee TEXT NOT NULL, held TEXT NOT NULL,
            state TEXT NOT NULL, expires_at REAL NOT NULL, updated_at REAL NOT NULL,
            card_id INTEGER, last4 TEXT, provider_status TEXT, op_id TEXT
        )""")
        self.db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS wallet_goswap_card_pending
            ON wallet_goswap_card_issues(user_id,plan) WHERE state IN ('submitted','processing')""")

    @staticmethod
    def product(plan):
        return "us" if plan == "goswap_card_us" else "sg"

    async def catalogue(self):
        async with self.catalogue_lock:
            if self.catalogue_cache[0] > time.monotonic():
                return self.catalogue_cache[1]
            info = await self.provider.call("getMe")
            if not isinstance(info, dict):
                raise ValueError("Invalid GoSwap capabilities")
            products = {}
            if info.get("can_issue_cards") is True and self.money(info.get("card_topup_limit_usd", "0"), False) > 0:
                products = {item["product"]: self.money(item["issue"]) for item in info.get("card_products", [])
                            if item.get("status") == "available" and item.get("product") in {"sg", "us"}}
            self.catalogue_cache = (time.monotonic() + 15, products)
            return products

    def configured(self, plan):
        return plan in GOSWAP_CARD_PLANS and storefront_positions(self.ledger).get(plan) is not None and card_issue_enabled(self.ledger, plan)

    def configured_fee(self, plan):
        return self.money(active(self.ledger, plan)["fixed_fee"], False)

    async def quote(self, uid, client_ref, plan):
        if not isinstance(plan, str) or not self.configured(plan):
            raise self.error("CARD_UNAVAILABLE", "Выпуск этой карты выключен", 409)
        pending = self.db.execute("""SELECT * FROM wallet_goswap_card_issues WHERE user_id=? AND plan=?
            AND state IN ('submitted','processing')""", (uid, plan)).fetchone()
        if pending:
            return self.public(pending)
        product = self.product(plan)
        fee = (await self.catalogue()).get(product)
        if fee is None:
            raise self.error("CARD_UNAVAILABLE", "GoSwap пока не выпускает эту карту", 409)
        service_fee = self.configured_fee(plan)
        with localcontext() as ctx:
            ctx.prec = 80
            total = fee + service_fee
            available = max(Decimal(0), self.ledger.balance(uid, ASSET)[0] - aura_available(self.ledger, uid, ASSET))
        now = time.time()
        intent = uuid.uuid4().hex
        self.db.execute("DELETE FROM wallet_goswap_card_issues WHERE user_id=? AND state='quoted' AND expires_at<?", (uid, now))
        quotes = self.db.execute("SELECT COUNT(*) FROM wallet_goswap_card_issues WHERE user_id=? AND state='quoted'", (uid,)).fetchone()[0]
        if quotes >= 20:
            raise self.error("RATE_LIMITED", "Слишком много расчётов. Повторите позже", 429)
        self.db.execute("""INSERT INTO wallet_goswap_card_issues (
            intent_id,user_id,plan,product,client_ref,spend_id,provider_fee,service_fee,held,state,expires_at,updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,'quoted',?,?)""",
            (intent, uid, plan, product, client_ref, "wpay-card-" + intent, str(fee), str(service_fee), str(total), now + 120, now))
        return self.public(self.get(uid, intent)) | {"wallet_available": str(available)}

    def get(self, uid, intent):
        row = self.db.execute("SELECT * FROM wallet_goswap_card_issues WHERE user_id=? AND intent_id=?", (uid, intent)).fetchone()
        if not row:
            raise self.error("NOT_FOUND", "Заявка не найдена", 404)
        return row

    def public(self, row):
        return {key: row[key] for key in ("intent_id", "plan", "state", "card_id", "last4", "provider_status", "expires_at")} | {
            "label": GOSWAP_CARD_PLANS[row["plan"]]["label"], "total": row["held"],
        }

    async def submit(self, uid, intent):
        row = self.get(uid, intent)
        if row["state"] != "quoted":
            return self.public(await self.reconcile(row))
        fee = (await self.catalogue()).get(row["product"])
        if fee is None:
            raise self.error("CARD_UNAVAILABLE", "GoSwap пока не выпускает эту карту", 409)
        await require_coverage(self.ledger, self.provider, ASSET, self.error)
        self.ledger.begin("goswap_card_reserve", uid, intent)
        try:
            row = self.get(uid, intent)
            if row["state"] != "quoted":
                self.ledger.commit()
                return self.public(row)
            if row["expires_at"] <= time.time() or not self.configured(row["plan"]) or fee != Decimal(row["provider_fee"]) or self.configured_fee(row["plan"]) != Decimal(row["service_fee"]):
                raise self.error("QUOTE_EXPIRED", "Условия изменились. Рассчитайте выпуск заново", 409)
            if self.db.execute("""SELECT 1 FROM wallet_goswap_card_issues WHERE user_id=? AND plan=?
                    AND state IN ('submitted','processing')""", (uid, row["plan"])).fetchone():
                raise self.error("CARD_OPERATION_PENDING", "По этому тарифу уже есть заявка в обработке", 409)
            held = Decimal(row["held"])
            available, reserved = self.ledger.balance(uid, ASSET)
            require_goswap_user_funds(self.ledger, uid, ASSET, available, held, self.error)
            if debt(self.ledger, uid, ASSET):
                raise self.error("INSUFFICIENT_FUNDS", "На кошельке есть задолженность", 409)
            with localcontext() as ctx:
                ctx.prec = 80
                self.ledger.put_balance(uid, ASSET, available - held, reserved + held)
            self.db.execute("UPDATE wallet_goswap_card_issues SET state='submitted',updated_at=? WHERE intent_id=?", (time.time(), intent))
            self.ledger.commit()
        except Exception:
            self.ledger.rollback()
            raise
        try:
            result = await self.provider.call("createCard", {k: row[k] for k in ("client_ref", "spend_id", "product")}, post=True)
            self.apply(row, result)
        except self.error as error:
            if error.status in {400, 401, 403, 404, 405, 422, 429}:
                self.settle(row, "failed")
                raise
        except (ValueError, TypeError, KeyError):
            # An unexpected response cannot prove that GoSwap did not charge.
            pass
        return self.public(self.get(uid, intent))

    def apply(self, row, result):
        if not isinstance(result, dict) or result.get("spend_id") != row["spend_id"] or result.get("kind") != "issue":
            raise ValueError("Unexpected GoSwap card operation")
        status = result.get("status")
        if status not in TERMINAL | {"processing"}:
            raise ValueError("Unknown GoSwap card operation status")
        card = result.get("card") or {}
        card_id = result.get("card_id")
        if card and (card.get("card_id") != card_id or str(card.get("client_ref", "")).lower() != row["client_ref"].lower()
                     or card.get("product") != row["product"]):
            raise ValueError("Unexpected GoSwap card owner")
        if status in {"completed", "processing"} and self.money(result.get("total")) != Decimal(row["provider_fee"]):
            raise ValueError("GoSwap card issue fee changed")
        if status == "completed" and row["card_id"] is not None and row["card_id"] != card_id:
            raise ValueError("GoSwap returned another card")
        if status == "completed" and (type(card_id) is not int or card_id <= 0):
            raise ValueError("Missing issued card identifier")
        last4 = card.get("last4")
        if not isinstance(last4, str) or len(last4) != 4 or not last4.isascii() or not last4.isdigit():
            last4 = None
        self.settle(row, status, card_id, last4, card.get("status"), result.get("op_id"))

    def settle(self, row, status, card_id=None, last4=None, provider_status=None, op_id=None):
        uid, intent = row["user_id"], row["intent_id"]
        self.ledger.begin("goswap_card_outcome", uid, intent)
        try:
            current = self.get(uid, intent)
            if current["state"] in {"submitted", "processing"}:
                if status in TERMINAL:
                    held = Decimal(current["held"])
                    available, reserved = self.ledger.balance(uid, ASSET)
                    with localcontext() as ctx:
                        ctx.prec = 80
                        self.ledger.put_balance(uid, ASSET, available + (held if status == "failed" else 0), reserved - held)
                    if status == "completed":
                        detail = {"provider": "goswap", "status": status, "plan": GOSWAP_CARD_PLANS[row["plan"]]["label"],
                                  "card_id": card_id, "provider_fee": row["provider_fee"], "service_fee": row["service_fee"], "operation_id": op_id}
                        self.db.execute("INSERT INTO wallet_events VALUES (?,?,?,?,?,?,?)",
                            ("goswap:card_issue:" + row["spend_id"], uid, ASSET, str(-held), "card_issue",
                             datetime.now(timezone.utc).isoformat(), json.dumps(detail)))
                self.db.execute("""UPDATE wallet_goswap_card_issues SET state=?,card_id=?,last4=COALESCE(?,last4),
                    provider_status=COALESCE(?,provider_status),op_id=COALESCE(?,op_id),updated_at=? WHERE intent_id=?""",
                    (status, card_id, last4, provider_status, op_id, time.time(), intent))
            self.ledger.commit()
        except Exception:
            self.ledger.rollback()
            raise

    async def reconcile(self, row):
        if row["state"] in {"submitted", "processing"} and row["updated_at"] <= time.time() - 15:
            self.db.execute("UPDATE wallet_goswap_card_issues SET updated_at=? WHERE intent_id=? AND state IN ('submitted','processing')",
                            (time.time(), row["intent_id"]))
            try:
                payload = await self.provider.call("getCardOps", {"spend_id": row["spend_id"], "count": 1})
                items = payload.get("items", []) if isinstance(payload, dict) else []
                match = next((op for op in items if isinstance(op, dict) and op.get("spend_id") == row["spend_id"]), None)
                if match:
                    self.apply(row, match)
            except (self.error, ValueError, TypeError, KeyError):
                pass
        return self.get(row["user_id"], row["intent_id"])

    async def run(self):
        while True:
            await asyncio.sleep(30)
            rows = self.db.execute("""SELECT * FROM wallet_goswap_card_issues WHERE state IN ('submitted','processing')
                ORDER BY updated_at LIMIT 8""").fetchall()
            for row in rows:
                await self.reconcile(row)

    async def route(self, request, action, uid, client_ref):
        if action == "goswap-card-issues" and request.method == "GET":
            rows = self.db.execute("""SELECT * FROM wallet_goswap_card_issues WHERE user_id=? AND state!='quoted'
                ORDER BY updated_at DESC LIMIT 50""", (uid,)).fetchall()
            return web.json_response({"items": [self.public(row) for row in rows]}, headers={"Cache-Control": "no-store"})
        if action not in {"goswap-card-quote", "goswap-card-issue"} or request.method != "POST":
            return None
        body = await request.json()
        key = "plan_id" if action == "goswap-card-quote" else "intent_id"
        if not isinstance(body, dict) or set(body) != {key} or not isinstance(body[key], str):
            raise ValueError("Некорректная заявка на карту")
        result = await (self.quote(uid, client_ref, body[key]) if key == "plan_id" else self.submit(uid, body[key]))
        return web.json_response(result, headers={"Cache-Control": "no-store"})
