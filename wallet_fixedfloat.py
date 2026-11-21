"""Signed FixedFloat transport; quote API and explicit, gated order methods."""

import asyncio
import hashlib
import hmac
import json
import math
import re
import time
from collections import defaultdict, deque
from decimal import Decimal, localcontext

from aiohttp import ClientError, ClientSession, ClientTimeout, web

NETWORKS = {
    "TRON": ("USDTTRC", "TRX", "Tron", "TRC20"),
    "ETH": ("USDT", "ETH", "Ethereum", "ERC20"),
    "BSC": ("USDTBSC", "BSC", "BNB Smart Chain", "BEP20"),
    "SOL": ("USDTSOL", "SOL", "Solana", "SPL"),
    "TON": ("USDTTON", "TON", "TON", "Jetton"),
}


class FixedFloat:
    def __init__(self, key, secret, error, base_url="https://ff.io/api/v2"):
        self.key, self.secret, self.error, self.base_url = key, secret, error, base_url
        self.session = None
        self.window = deque()
        self.user_windows = defaultdict(deque)
        self.currency_cache = None
        self.currency_until = 0
        self.currency_lock = asyncio.Lock()
        self.ledger = None
        self.orders_enabled = False

    @property
    def configured(self):
        return bool(self.key and self.secret)

    def throttle(self, uid):
        if self.ledger is not None:
            ledger = self.ledger
            stamp = time.time()
            ledger.begin(
                "exchange_rate_limit",
                uid,
                "Bound read-only provider requests across workers",
            )
            try:
                ledger.db.execute(
                    "DELETE FROM wallet_exchange_rate_limits WHERE created_at<=?",
                    (stamp - 60,),
                )
                total = ledger.db.execute(
                    "SELECT COUNT(*) FROM wallet_exchange_rate_limits"
                ).fetchone()[0]
                count = ledger.db.execute(
                    "SELECT COUNT(*) FROM wallet_exchange_rate_limits WHERE user_id=?",
                    (uid,),
                ).fetchone()[0]
                if total >= 100 or count >= 20:
                    first = ledger.db.execute(
                        "SELECT MIN(created_at) FROM wallet_exchange_rate_limits"
                        + (" WHERE user_id=?" if count >= 20 else ""),
                        (uid,) if count >= 20 else (),
                    ).fetchone()[0]
                    raise self.error(
                        "RATE_LIMITED",
                        "Лимит расчётов обмена",
                        429,
                        str(max(1, math.ceil(first + 60 - stamp))),
                    )
                ledger.db.execute(
                    "INSERT INTO wallet_exchange_rate_limits(user_id,created_at) VALUES (?,?)",
                    (uid, stamp),
                )
                ledger.commit()
                return
            except Exception:
                ledger.rollback()
                raise
        stamp = time.monotonic()
        window = self.user_windows[uid]
        while window and window[0] <= stamp - 60:
            window.popleft()
        if len(window) >= 20:
            raise self.error(
                "RATE_LIMITED", "Слишком много расчётов. Повторите позже.", 429, "60"
            )
        window.append(stamp)
        # Bound memory used by identities that no longer make requests.
        if len(self.user_windows) > 1000:
            self.user_windows = defaultdict(
                deque,
                {
                    key: value
                    for key, value in self.user_windows.items()
                    if value and value[-1] > stamp - 60
                },
            )

    async def call(self, method, params):
        # These POST endpoints are read-only. Deliberately reject create/order actions.
        if method not in {"ccies", "price"}:
            raise ValueError("Only quote endpoints are allowed")
        return await self._request(method, params)

    async def create_order(self, params):
        if not self.orders_enabled:
            raise self.error("EXCHANGE_NOT_ENABLED", "Создание обменов не включено", 503)
        if set(params) - {"type","fromCcy","toCcy","direction","amount","toAddress","tag"}:
            raise ValueError("Unsupported order parameters")
        return await self._request("create", params)

    async def fetch_order(self, order_id, token):
        if not self.orders_enabled:
            raise self.error("EXCHANGE_NOT_ENABLED", "Создание обменов не включено", 503)
        return await self._request("order", {"id":order_id,"token":token})

    async def _request(self, method, params):
        if method not in {"ccies", "price", "create", "order"}:
            raise ValueError("Unsupported FixedFloat method")
        if not self.configured:
            raise self.error(
                "EXCHANGE_NOT_CONFIGURED", "Расчёт обмена пока недоступен", 503
            )
        weight = 50 if method == "create" else 1
        stamp = time.monotonic()
        while self.window and self.window[0][0] <= stamp - 60:
            self.window.popleft()
        if sum(item[1] for item in self.window) + weight > 200:
            error = self.error("RATE_LIMITED", "Лимит запросов обменника", 429, "60")
            error.definitive = True
            raise error
        if self.ledger is not None:
            ledger = self.ledger
            ledger.begin("fixedfloat_budget", "system", "Bound provider request weights")
            try:
                ledger.db.execute("DELETE FROM fixedfloat_call_budget WHERE created_at<=?", (time.time()-60,))
                used = ledger.db.execute("SELECT COALESCE(SUM(weight),0) FROM fixedfloat_call_budget").fetchone()[0]
                if used + weight > 200:
                    error = self.error("RATE_LIMITED", "Лимит запросов обменника", 429, "60")
                    error.definitive = True
                    raise error
                ledger.db.execute("INSERT INTO fixedfloat_call_budget(created_at,weight) VALUES (?,?)", (time.time(),weight))
                ledger.commit()
            except Exception:
                ledger.rollback()
                raise
        self.window.append((stamp, weight))
        raw = json.dumps(params, separators=(",", ":"), ensure_ascii=False).encode(
            "utf-8"
        )
        headers = {
            "Content-Type": "application/json; charset=UTF-8",
            "X-API-KEY": self.key,
            "X-API-SIGN": hmac.new(
                self.secret.encode(), raw, hashlib.sha256
            ).hexdigest(),
        }
        if self.session is None:
            self.session = ClientSession(timeout=ClientTimeout(total=12))
        try:
            async with self.session.post(
                self.base_url + "/" + method,
                data=raw,
                headers=headers,
                allow_redirects=False,
            ) as response:
                if response.status == 429:
                    retry = response.headers.get("Retry-After", "60")
                    error = self.error("RATE_LIMITED", "Сервис обмена временно ограничил запросы", 429, retry)
                    error.definitive = True
                    raise error
                if response.status != 200:
                    error = self.error("EXCHANGE_UNAVAILABLE", "Сервис обмена временно недоступен", 503)
                    error.definitive = response.status in {400,401,403,404,405,415,422}
                    raise error
                data = await response.json(
                    content_type=None,
                    loads=lambda raw: json.loads(raw, parse_float=Decimal),
                )
                if not isinstance(data, dict) or data.get("code") != 0:
                    error = self.error("EXCHANGE_REJECTED", "Обменник отклонил запрос. Проверьте направление, сумму и адрес", 400) if method == "create" else self.error("EXCHANGE_UNAVAILABLE", "Не удалось получить ответ обменника", 503)
                    error.definitive = method == "create" and isinstance(data, dict) and type(data.get("code")) is int and data["code"] != 0
                    raise error
                return data["data"]
        except (asyncio.TimeoutError, ClientError):
            raise self.error(
                "EXCHANGE_UNAVAILABLE",
                "Не удалось получить ответ сервиса обмена. Повторите расчёт.",
                503,
            )

    async def networks(self):
        async with self.currency_lock:
            if self.currency_cache is None or self.currency_until <= time.monotonic():
                rows = await self.call("ccies", {})
                if not isinstance(rows, list):
                    raise ValueError("Invalid currency response")
                by_code = {
                    row["code"]: row
                    for row in rows
                    if isinstance(row, dict) and isinstance(row.get("code"), str)
                }
                result = []
                for network, (code, chain, name, standard) in NETWORKS.items():
                    row = by_code.get(code, {})
                    # A missing token/network is unavailable, never assumed supported.
                    matches = row.get("coin") == "USDT" and row.get("network") == chain
                    result.append(
                        {
                            "network": network,
                            "name": name,
                            "standard": standard,
                            "can_send": matches and row.get("recv") in (True, 1),
                            "can_receive": matches and row.get("send") in (True, 1),
                        }
                    )
                self.currency_cache, self.currency_until = result, time.monotonic() + 30
            return self.currency_cache

    async def quote(self, body):
        if not isinstance(body, dict) or set(body) != {
            "from_network",
            "to_network",
            "amount",
            "rate_type",
        }:
            raise ValueError("Unexpected quote parameters")
        source, destination, mode, amount = (
            body[key] for key in ("from_network", "to_network", "rate_type", "amount")
        )
        if (
            not isinstance(source, str)
            or not isinstance(destination, str)
            or source not in NETWORKS
            or destination not in NETWORKS
            or source == destination
            or mode not in {"float", "fixed"}
        ):
            raise ValueError("Invalid exchange direction")
        if (
            not isinstance(amount, str)
            or not re.fullmatch(r"(?:0|[1-9]\d{0,8})(?:\.\d{1,6})?", amount)
            or Decimal(amount) <= 0
        ):
            raise ValueError("Invalid amount")
        networks = {row["network"]: row for row in await self.networks()}
        summary = {
            "provider": "fixedfloat",
            "asset": "USDT",
            "from_network": source,
            "to_network": destination,
            "rate_type": mode,
            "from_amount": amount,
            "to_amount": None,
            "difference": None,
            "available": False,
            "reasons": [],
            "quoted_at": time.time(),
            "refresh_after_seconds": 20,
            "execution_enabled": False,
        }
        if not networks[source]["can_send"] or not networks[destination]["can_receive"]:
            return {
                **summary, "reasons": ["NETWORK_UNAVAILABLE"],
                "unavailable_sides": [
                    side for side, ready in (("from", networks[source]["can_send"]),
                                             ("to", networks[destination]["can_receive"]))
                    if not ready
                ],
            }
        result = await self.call(
            "price",
            {
                "fromCcy": NETWORKS[source][0],
                "toCcy": NETWORKS[destination][0],
                "amount": amount,
                "direction": "from",
                "type": mode,
            },
        )
        sending, receiving = result["from"], result["to"]
        for row, network in ((sending, source), (receiving, destination)):
            if (
                row.get("code") != NETWORKS[network][0]
                or row.get("network") != NETWORKS[network][1]
                or row.get("coin") != "USDT"
            ):
                raise ValueError("Mismatched quote asset/network")
        if Decimal(str(sending["amount"])) != Decimal(amount):
            raise ValueError("Provider changed sending amount")
        errors = result.get("errors")
        if not isinstance(errors, list) or not all(
            isinstance(error, str) for error in errors
        ):
            raise ValueError("Missing quote availability")
        # Do not expose a payout if the quote is under maintenance or outside limits.
        if errors:
            known = {
                "MAINTENANCE_FROM",
                "MAINTENANCE_TO",
                "OFFLINE_FROM",
                "OFFLINE_TO",
                "RESERVE_FROM",
                "RESERVE_TO",
                "LIMIT_MIN",
                "LIMIT_MAX",
            }
            return {
                **summary,
                "reasons": [
                    error if error in known else "PROVIDER_UNAVAILABLE"
                    for error in errors
                ],
            }
        payout = Decimal(str(receiving["amount"]))
        if not payout.is_finite() or payout <= 0:
            raise ValueError("Invalid payout")
        with localcontext() as ctx:
            ctx.prec = 60
            difference = Decimal(amount) - payout
        return {
            **summary,
            "available": True,
            "to_amount": str(payout),
            "difference": str(difference),
        }

    async def close(self):
        if self.session:
            await self.session.close()


async def exchange_route(request, action, uid, provider):
    if action not in {"exchange-status", "exchange-quote"}:
        return None
    provider.throttle(uid)
    if action == "exchange-status" and request.method == "GET":
        return web.json_response(
            {
                "configured": provider.configured,
                "provider": "fixedfloat",
                "execution_enabled": False,
                "orders_enabled": provider.orders_enabled and provider.configured,
                "funding_modes": (["external", "own_wallet"] if getattr(provider, "wallet_funding_enabled", False) else ["external"]) if provider.orders_enabled else [],
                "wallet_funding_enabled": bool(getattr(provider, "wallet_funding_enabled", False)),
                "networks": await provider.networks() if provider.configured else [],
            }
        )
    if action == "exchange-quote" and request.method == "POST":
        return web.json_response(await provider.quote(await request.json()))
    raise provider.error("METHOD_NOT_ALLOWED", "Неверный метод запроса", 405)


def prepare_exchange_limits(ledger):
    ledger.db.executescript(
        """
      CREATE TABLE IF NOT EXISTS wallet_exchange_rate_limits (id INTEGER PRIMARY KEY,user_id TEXT NOT NULL,created_at REAL NOT NULL);
      CREATE INDEX IF NOT EXISTS wallet_exchange_rate_limits_time ON wallet_exchange_rate_limits(created_at);
      CREATE TABLE IF NOT EXISTS fixedfloat_call_budget (id INTEGER PRIMARY KEY,created_at REAL NOT NULL,weight INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS fixedfloat_call_budget_time ON fixedfloat_call_budget(created_at);
    """
    )
