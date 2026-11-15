"""Aura Partner API adapter and restart-safe testnet integration.

The module is disabled unless ``WPAY_AURA_ENABLED=1``.  It never falls back
from testnet to production and never exposes provider secrets to HTTP clients.
"""

import asyncio
import hashlib
import hmac
import json
import re
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from urllib.parse import quote, urlsplit

from aiohttp import ClientSession, ClientTimeout, web


TEST_BASE_URL = "https://testnet-api.aurawallet.co/v1/partner"
LIVE_BASE_URL = "https://api.aurawallet.co/v1/partner"
FINAL_ERROR_CODES = {
    "kyc_rejected", "card_kind_unavailable", "card_already_requested",
    "card_request_not_cancelable", "card_not_active",
    "card_controls_unavailable", "unauthenticated", "ip_not_allowed",
    "sbp_buy_blocked", "sbp_buy_bank_not_found", "sbp_buy_bank_unsupported",
    "sbp_buy_pending_qr_limit", "kyc_passport_already_used",
    "qr_unsupported", "card_not_activatable", "kyc_identity_locked",
    "kyc_session_unavailable", "sbp_buy_not_enabled", "cards_not_enabled",
    "crypto_processing_not_enabled", "qr_pay_not_enabled",
}
WAIT_ERROR_CODES = {
    "kyc_pending", "card_paused", "pin_change_rate_limited",
    "withdrawal_limit_exceeded", "resource_exhausted",
}
DELAY_ERROR_CODES = {"rate_limited"}
LATER_ERROR_CODES = {
    "card_float_exhausted", "unavailable", "internal", "rate_unavailable",
    "sbp_buy_temporarily_unavailable", "sbp_buy_daily_qr_limit",
    "sbp_buy_daily_paid_qr_limit", "sbp_buy_fiat_daily_limit",
    "sbp_buy_fiat_monthly_limit",
}


def prepare(ledger):
    """Install additive tables. Existing GoSwap rows and routes stay untouched."""
    ledger.db.executescript(
        """
      CREATE TABLE IF NOT EXISTS wallet_provider_routes (
        product TEXT NOT NULL, asset TEXT NOT NULL, network TEXT NOT NULL,
        environment TEXT NOT NULL, provider TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
        updated_at REAL NOT NULL, PRIMARY KEY(product,asset,network,environment)
      );
      CREATE TABLE IF NOT EXISTS wallet_provider_entities (
        provider TEXT NOT NULL, environment TEXT NOT NULL, entity_type TEXT NOT NULL,
        local_id TEXT NOT NULL, remote_id TEXT, user_id TEXT, status TEXT,
        idempotency_key TEXT, request_body TEXT, provider_updated_at TEXT,
        created_at REAL NOT NULL, updated_at REAL NOT NULL,
        PRIMARY KEY(provider,environment,entity_type,local_id),
        UNIQUE(provider,environment,entity_type,remote_id)
      );
      CREATE TABLE IF NOT EXISTS aura_customers (
        user_id TEXT PRIMARY KEY, customer_id TEXT UNIQUE NOT NULL,
        environment TEXT NOT NULL, state TEXT NOT NULL, email_hash TEXT, phone_hash TEXT,
        provider_updated_at TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aura_deposit_addresses (
        address_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        environment TEXT NOT NULL, network TEXT NOT NULL, address TEXT NOT NULL,
        label TEXT, is_default INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL,
        created_at REAL NOT NULL, updated_at REAL NOT NULL,
        UNIQUE(environment,address)
      );
      CREATE TABLE IF NOT EXISTS aura_deposits (
        deposit_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, customer_id TEXT NOT NULL,
        address_id TEXT, environment TEXT NOT NULL, status TEXT NOT NULL,
        asset TEXT NOT NULL, network TEXT NOT NULL, gross TEXT NOT NULL,
        fee TEXT, net TEXT, transaction_hash TEXT, confirmations INTEGER,
        provider_updated_at TEXT, body TEXT NOT NULL, created_at REAL NOT NULL,
        updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wallet_provider_positions (
        provider TEXT NOT NULL, environment TEXT NOT NULL, user_id TEXT NOT NULL,
        asset TEXT NOT NULL, available TEXT NOT NULL DEFAULT '0', reserved TEXT NOT NULL DEFAULT '0',
        updated_at REAL NOT NULL,
        PRIMARY KEY(provider,environment,user_id,asset)
      );
      CREATE TABLE IF NOT EXISTS wallet_provider_reconciliation (
        provider TEXT NOT NULL, environment TEXT NOT NULL, asset TEXT NOT NULL,
        provider_available TEXT NOT NULL, allocated TEXT NOT NULL, difference TEXT NOT NULL,
        state TEXT NOT NULL, checked_at REAL NOT NULL, detail TEXT NOT NULL,
        PRIMARY KEY(provider,environment,asset)
      );
      CREATE TABLE IF NOT EXISTS aura_runtime_state (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at REAL NOT NULL
      );
    """
    )
    columns = {row[1] for row in ledger.db.execute("PRAGMA table_info(wallet_webhook_inbox)")}
    if "provider" not in columns:
        ledger.db.execute(
            "ALTER TABLE wallet_webhook_inbox ADD COLUMN provider TEXT NOT NULL DEFAULT 'goswap'"
        )
    if "provider_event_id" not in columns:
        ledger.db.execute("ALTER TABLE wallet_webhook_inbox ADD COLUMN provider_event_id TEXT")
    ledger.db.execute(
        "CREATE INDEX IF NOT EXISTS wallet_webhook_provider_pending "
        "ON wallet_webhook_inbox(provider,processed_at,next_attempt_at)"
    )
    stamp = time.time()
    ledger.db.execute(
        "INSERT OR IGNORE INTO wallet_provider_routes VALUES (?,?,?,?,?,?,?)",
        ("crypto_deposit", "USDT", "TRON", "test", "aura", 0, stamp),
    )


def _decimal(value, *, allow_zero=False):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Invalid Aura decimal")
    if not result.is_finite() or result < 0 or (not allow_zero and result == 0):
        raise ValueError("Invalid Aura decimal")
    if result.as_tuple().exponent < -18:
        raise ValueError("Aura decimal has too many places")
    return result


def _safe_identifier(value, label):
    value = str(value or "")
    if not value or len(value) > 200 or not re.fullmatch(r"[A-Za-z0-9_.:-]+", value):
        raise ValueError("Invalid Aura " + label)
    return value


def _retry_policy(code, status):
    if code in FINAL_ERROR_CODES:
        return "no"
    if code in WAIT_ERROR_CODES:
        return "wait"
    if code in DELAY_ERROR_CODES:
        return "after_delay"
    if code in LATER_ERROR_CODES or status >= 500:
        return "later"
    return "after_fix"


class AuraClient:
    def __init__(self, api_key, environment, error_cls, base_url=None, session=None):
        if environment not in {"test", "live"}:
            raise ValueError("AURA_ENVIRONMENT must be test or live")
        self.api_key = api_key
        self.environment = environment
        self.error_cls = error_cls
        official = TEST_BASE_URL if environment == "test" else LIVE_BASE_URL
        self.base_url = (base_url or official).rstrip("/")
        if base_url and self.base_url != official:
            host = (urlsplit(self.base_url).hostname or "").lower()
            if environment != "test" or host not in {"127.0.0.1", "localhost", "::1"}:
                raise ValueError("Custom Aura URL is allowed only for a local test mock")
        if api_key:
            expected = "ak_test_" if environment == "test" else "ak_live_"
            if not api_key.startswith(expected):
                raise ValueError("Aura key prefix does not match environment")
        self.session = session
        self._owns_session = session is None
        self._limit_lock = asyncio.Lock()
        self.remaining = None
        self.reset_at = 0.0

    @property
    def configured(self):
        return bool(self.api_key)

    async def _throttle(self):
        async with self._limit_lock:
            delay = self.reset_at - time.monotonic()
            if self.remaining == 0 and delay > 30:
                raise self.error_cls("rate_limited", "Aura request budget is recovering", 429, str(int(delay) + 1))
            if self.remaining == 0 and delay > 0:
                await asyncio.sleep(delay)
            if delay <= 0:
                self.remaining = None

    def _observe_limits(self, headers):
        try:
            remaining = int(headers.get("X-RateLimit-Remaining", ""))
            reset = float(headers.get("X-RateLimit-Reset", "0"))
        except (TypeError, ValueError):
            return
        self.remaining = max(0, remaining)
        self.reset_at = time.monotonic() + max(0, reset)

    def _error(self, response, body):
        envelope = body.get("error") if isinstance(body, dict) else None
        envelope = envelope if isinstance(envelope, dict) else {}
        code = str(envelope.get("code") or "provider_error")[:100]
        message = str(envelope.get("message") or "Aura temporarily unavailable")[:500]
        retry_after = response.headers.get("Retry-After")
        error = self.error_cls(code, message, response.status, retry_after)
        error.provider = "aura"
        error.provider_type = str(envelope.get("type") or "")[:100]
        error.request_id = str(envelope.get("request_id") or response.headers.get("X-Request-Id") or "")[:200]
        error.doc_url = str(envelope.get("doc_url") or "")[:1000]
        error.param = str(envelope.get("param") or "")[:200]
        error.details = envelope.get("details") if isinstance(envelope.get("details"), dict) else {}
        error.retry_policy = _retry_policy(code, response.status)
        return error

    async def request(self, method, path, *, params=None, body=None, idempotency_key=None):
        if not self.api_key:
            raise self.error_cls("aura_not_configured", "Aura is not configured", 503)
        await self._throttle()
        if self.session is None:
            self.session = ClientSession(timeout=ClientTimeout(total=20))
        headers = {"X-API-Key": self.api_key, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            idempotency_key = str(idempotency_key)
            if not 1 <= len(idempotency_key) <= 200 or "\r" in idempotency_key or "\n" in idempotency_key:
                raise ValueError("Invalid Aura idempotency key")
            headers["Idempotency-Key"] = idempotency_key
        try:
            async with self.session.request(
                method, self.base_url + path, headers=headers, params=params,
                **({"json": body} if body is not None else {}),
            ) as response:
                self._observe_limits(response.headers)
                try:
                    payload = await response.json(content_type=None)
                except (ValueError, TypeError):
                    raise self.error_cls("aura_invalid_response", "Aura returned invalid JSON", 502)
                if response.status < 200 or response.status >= 300:
                    raise self._error(response, payload)
                if not isinstance(payload, (dict, list)):
                    raise self.error_cls("aura_invalid_response", "Aura returned an invalid response", 502)
                return payload
        except (asyncio.TimeoutError, OSError):
            error = self.error_cls(
                "aura_timeout", "Aura outcome is unknown; reconcile before another monetary request", 504
            )
            error.provider = "aura"
            error.retry_policy = "later"
            raise error

    async def get_me(self):
        return await self.request("GET", "/me")

    async def upsert_customer(self, customer_id, *, email=None, phone=None):
        body = {"id": _safe_identifier(customer_id, "customer id")}
        if email:
            body["email"] = str(email)[:320]
        if phone:
            body["phone"] = str(phone)[:32]
        return await self.request("POST", "/customers", body=body)

    async def deposit_addresses(self, customer_id):
        return await self.request("GET", "/customers/" + quote(_safe_identifier(customer_id, "customer id"), safe="") + "/deposit-addresses")

    async def list_deposits(self, *, cursor=None, limit=100, customer_id=None):
        params = {"limit": min(max(int(limit), 1), 100)}
        if cursor:
            params["cursor"] = str(cursor)
        if customer_id:
            params["customer_id"] = _safe_identifier(customer_id, "customer id")
        return await self.request("GET", "/deposits", params=params)

    async def get_balance(self):
        return await self.request("GET", "/balance")

    async def close(self):
        if self.session is not None and self._owns_session:
            await self.session.close()
        self.session = None


def _list_data(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        raise ValueError("Invalid Aura list")
    data = payload.get("data")
    if isinstance(data, list):
        return data
    if isinstance(payload.get("items"), list):
        return payload["items"]
    raise ValueError("Invalid Aura list")


class AuraService:
    def __init__(self, ledger, client, environment):
        self.ledger, self.client, self.environment = ledger, client, environment

    async def ensure_customer(self, uid, client_ref, email=None, phone=None):
        row = self.ledger.db.execute("SELECT * FROM aura_customers WHERE user_id=?", (uid,)).fetchone()
        customer_id = row["customer_id"] if row else client_ref
        result = await self.client.upsert_customer(customer_id, email=email, phone=phone)
        provider_id = str(result.get("id") or result.get("customer_id") or customer_id)
        if provider_id != customer_id:
            raise ValueError("Aura customer identity mismatch")
        stamp = time.time()
        digest = lambda value: hashlib.sha256(str(value).encode()).hexdigest() if value else None
        self.ledger.db.execute(
            "INSERT INTO aura_customers VALUES (?,?,?,?,?,?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET state=excluded.state,email_hash=excluded.email_hash,"
            "phone_hash=excluded.phone_hash,provider_updated_at=excluded.provider_updated_at,updated_at=excluded.updated_at",
            (uid, customer_id, self.environment, str(result.get("status") or "registered"),
             digest(email), digest(phone), result.get("updated_at"), stamp, stamp),
        )
        return customer_id

    async def get_or_create_deposit_address(self, uid, client_ref):
        customer_id = await self.ensure_customer(uid, client_ref)
        payload = await self.client.deposit_addresses(customer_id)
        rows = _list_data(payload)
        if not rows:
            raise ValueError("Aura returned no deposit address")
        stamp = time.time()
        selected = None
        for item in rows:
            if not isinstance(item, dict):
                raise ValueError("Invalid Aura deposit address")
            address_id = _safe_identifier(item.get("id") or item.get("address_id"), "address id")
            address = str(item.get("address") or "")
            network = str(item.get("network") or "")
            if not address or len(address) > 200 or network not in {"nile", "mainnet"}:
                raise ValueError("Invalid Aura deposit address")
            if (self.environment == "test" and network != "nile") or (self.environment == "live" and network != "mainnet"):
                raise ValueError("Aura address network mismatch")
            self.ledger.db.execute(
                "INSERT INTO aura_deposit_addresses VALUES (?,?,?,?,?,?,?,?,?,?,?) "
                "ON CONFLICT(address_id) DO UPDATE SET label=excluded.label,is_default=excluded.is_default,"
                "body=excluded.body,updated_at=excluded.updated_at",
                (address_id, uid, customer_id, self.environment, network, address,
                 item.get("label"), int(bool(item.get("is_default"))),
                 json.dumps(item, separators=(",", ":"), ensure_ascii=False), stamp, stamp),
            )
            if selected is None or item.get("is_default"):
                selected = item
        return {
            "provider": "aura", "asset": "USDT", "network": "TRON",
            "chain": selected.get("network"), "address": selected.get("address"),
            "address_id": selected.get("id") or selected.get("address_id"),
            "customer_id": customer_id,
        }


def verify_signature(secret, raw, header, now_seconds=None, tolerance=300):
    if not secret or not header:
        return False
    timestamp, signatures = None, []
    for part in header.split(","):
        key, sep, value = part.strip().partition("=")
        if not sep:
            continue
        if key == "t" and value.isdigit():
            timestamp = value
        elif key == "v1" and re.fullmatch(r"[0-9a-f]{64}", value):
            signatures.append(value)
    if timestamp is None:
        return False
    now_seconds = int(time.time()) if now_seconds is None else int(now_seconds)
    if abs(now_seconds - int(timestamp)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), timestamp.encode() + b"." + raw, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


def store_webhook(ledger, raw, signature, headers, secret, partner_id=None):
    valid = verify_signature(secret, raw, signature)
    try:
        event = json.loads(raw)
        if not isinstance(event, dict) or not isinstance(event.get("data"), dict):
            raise ValueError("Invalid Aura envelope")
        event_id = _safe_identifier(event.get("event_id"), "event id")
        kind = _safe_identifier(event.get("event"), "event type")
        if headers.get("X-Aura-Event-Id") not in {None, "", event_id}:
            valid = False
        if headers.get("X-Aura-Event") not in {None, "", kind}:
            valid = False
        if partner_id and str(event.get("partner_id")) != partner_id:
            valid = False
    except (ValueError, TypeError, json.JSONDecodeError):
        event, event_id, kind, valid = {}, hashlib.sha256(raw).hexdigest(), "invalid", False
    key = "aura:" + event_id if valid else "aura:invalid:" + hashlib.sha256(raw + signature.encode()).hexdigest()
    ledger.begin("aura_webhook_receive", "aura", key)
    try:
        ledger.db.execute(
            "INSERT OR IGNORE INTO wallet_webhook_inbox "
            "(event_key,raw_body,signature,signature_valid,origin,update_type,entity_id,"
            "received_at,error,provider,provider_event_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (key, raw, signature, int(valid), "webhook", kind, event_id, time.time(),
             None if valid else "BAD_AURA_SIGNATURE", "aura", event_id),
        )
        row = ledger.db.execute("SELECT * FROM wallet_webhook_inbox WHERE event_key=?", (key,)).fetchone()
        if valid and row and bytes(row["raw_body"]) != raw:
            valid = False
            ledger.db.execute(
                "UPDATE wallet_webhook_inbox SET signature_valid=0,error='AURA_EVENT_ID_REUSED' WHERE id=?",
                (row["id"],),
            )
        ledger.commit()
        return row, valid
    except Exception:
        ledger.rollback()
        raise


async def receive_webhook(request, ledger, secret, error_cls, partner_id=None):
    raw = await request.read()
    signature = request.headers.get("X-Aura-Signature-V2", "")
    _, valid = store_webhook(ledger, raw, signature, request.headers, secret, partner_id)
    if not valid:
        raise error_cls("BAD_AURA_SIGNATURE", "Invalid Aura webhook signature", 400)
    return web.json_response({"ok": True})


def _position_add(ledger, environment, uid, asset, amount):
    row = ledger.db.execute(
        "SELECT available,reserved FROM wallet_provider_positions "
        "WHERE provider='aura' AND environment=? AND user_id=? AND asset=?",
        (environment, uid, asset),
    ).fetchone()
    old_available, reserved = (Decimal(row[0]), Decimal(row[1])) if row else (Decimal(0), Decimal(0))
    with localcontext() as ctx:
        ctx.prec = 80
        available = old_available + amount
    ledger.db.execute(
        "INSERT INTO wallet_provider_positions VALUES ('aura',?,?,?,?,?,?) "
        "ON CONFLICT(provider,environment,user_id,asset) DO UPDATE SET "
        "available=excluded.available,reserved=excluded.reserved,updated_at=excluded.updated_at",
        (environment, uid, asset, str(available), str(reserved), time.time()),
    )


def process_inbox(ledger, environment, limit=20):
    rows = ledger.db.execute(
        "SELECT * FROM wallet_webhook_inbox WHERE provider='aura' AND signature_valid=1 "
        "AND processed_at IS NULL AND next_attempt_at<=? ORDER BY id LIMIT ?",
        (time.time(), limit),
    ).fetchall()
    processed = 0
    for row in rows:
        try:
            event = json.loads(row["raw_body"])
            kind, data = event.get("event"), event.get("data")
            ledger.begin("aura_webhook", "aura", row["event_key"])
            current = ledger.db.execute(
                "SELECT processed_at FROM wallet_webhook_inbox WHERE id=?", (row["id"],)
            ).fetchone()
            if current[0] is not None:
                ledger.commit()
                continue
            if kind == "customer.deposit.confirmed":
                deposit_id = _safe_identifier(data.get("id") or data.get("deposit_id"), "deposit id")
                customer_id = _safe_identifier(data.get("customer_id") or data.get("owner_id"), "customer id")
                owner = ledger.db.execute(
                    "SELECT user_id FROM aura_customers WHERE customer_id=? AND environment=?",
                    (customer_id, environment),
                ).fetchone()
                if not owner:
                    raise ValueError("Unknown Aura deposit owner")
                gross = _decimal(data.get("amount"))
                fee = _decimal(data.get("fee", "0"), allow_zero=True)
                net = _decimal(data.get("net_amount"))
                if gross - fee != net:
                    raise ValueError("Aura deposit amount mismatch")
                asset = str(data.get("currency") or data.get("asset") or "USDT").upper()
                network = str(data.get("network") or ("nile" if environment == "test" else "mainnet"))
                if asset != "USDT" or network != ("nile" if environment == "test" else "mainnet"):
                    raise ValueError("Unexpected Aura deposit asset/network")
                existing = ledger.db.execute(
                    "SELECT * FROM aura_deposits WHERE deposit_id=?", (deposit_id,)
                ).fetchone()
                canonical = json.dumps(data, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
                if existing and existing["status"] == "confirmed" and (
                    existing["customer_id"] != customer_id
                    or Decimal(existing["gross"]) != gross
                    or Decimal(existing["fee"]) != fee
                    or Decimal(existing["net"]) != net
                ):
                    raise ValueError("Confirmed Aura deposit economics changed")
                if existing and existing["status"] == "rejected":
                    raise ValueError("Rejected Aura deposit became confirmed")
                ledger.db.execute(
                    "INSERT INTO aura_deposits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(deposit_id) DO UPDATE SET status='confirmed',fee=excluded.fee,"
                    "net=excluded.net,transaction_hash=excluded.transaction_hash,"
                    "confirmations=excluded.confirmations,provider_updated_at=excluded.provider_updated_at,"
                    "body=excluded.body,updated_at=excluded.updated_at",
                    (deposit_id, owner[0], customer_id, data.get("address_id"), environment,
                     "confirmed", asset, network, str(gross), str(fee), str(net),
                     data.get("transaction_hash"), data.get("confirmations"), data.get("updated_at"),
                     canonical, time.time(), time.time()),
                )
                namespaced_id = "aura:" + environment + ":" + deposit_id
                credited = ledger.deposit(
                    {"deposit_id": namespaced_id, "client_ref": customer_id, "asset": asset,
                     "credited": str(net), "credited_at": data.get("confirmed_at"),
                     "provider": "aura", "gross": str(gross), "fee": str(fee)},
                    manage_transaction=False,
                )
                if credited:
                    _position_add(ledger, environment, owner[0], asset, net)
            elif kind in {"customer.deposit.pending", "customer.deposit.rejected"}:
                deposit_id = _safe_identifier(data.get("id") or data.get("deposit_id"), "deposit id")
                customer_id = _safe_identifier(data.get("customer_id") or data.get("owner_id"), "customer id")
                owner = ledger.db.execute("SELECT user_id FROM aura_customers WHERE customer_id=?", (customer_id,)).fetchone()
                if not owner:
                    raise ValueError("Unknown Aura deposit owner")
                status = "pending" if kind.endswith("pending") else "rejected"
                gross = _decimal(data.get("amount"))
                canonical = json.dumps(data, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
                existing = ledger.db.execute(
                    "SELECT status,provider_updated_at FROM aura_deposits WHERE deposit_id=?",
                    (deposit_id,),
                ).fetchone()
                incoming_updated = str(data.get("updated_at") or "")
                stale = bool(
                    existing and (
                        existing["status"] == "confirmed"
                        or (existing["status"] == "rejected" and status == "pending")
                        or (incoming_updated and existing["provider_updated_at"]
                            and incoming_updated <= existing["provider_updated_at"])
                    )
                )
                if not stale:
                    ledger.db.execute(
                        "INSERT INTO aura_deposits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) "
                        "ON CONFLICT(deposit_id) DO UPDATE SET status=excluded.status,confirmations=excluded.confirmations,"
                        "provider_updated_at=excluded.provider_updated_at,body=excluded.body,updated_at=excluded.updated_at",
                        (deposit_id, owner[0], customer_id, data.get("address_id"), environment,
                         status, "USDT", str(data.get("network") or ("nile" if environment == "test" else "mainnet")), str(gross), None, None,
                         data.get("transaction_hash"), data.get("confirmations"), data.get("updated_at"),
                         canonical, time.time(), time.time()),
                    )
            else:
                # Forward compatibility: preserve and acknowledge unknown events.
                ledger.db.execute(
                    "UPDATE wallet_webhook_inbox SET processed_at=?,error=? WHERE id=?",
                    (time.time(), "IGNORED_UNKNOWN_AURA_EVENT", row["id"]),
                )
                ledger.commit()
                processed += 1
                continue
            ledger.db.execute(
                "UPDATE wallet_webhook_inbox SET processed_at=?,error=NULL,attempts=attempts+1 WHERE id=?",
                (time.time(), row["id"]),
            )
            ledger.commit()
            processed += 1
        except Exception as error:
            if ledger.db.in_transaction:
                ledger.rollback()
            ledger.db.execute(
                "UPDATE wallet_webhook_inbox SET error=?,attempts=attempts+1,next_attempt_at=? WHERE id=?",
                (str(error)[:1000], time.time() + min(3600, 2 ** min(row["attempts"] + 1, 11)), row["id"]),
            )
    return processed


def _platform_balance(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid Aura balance")
    candidates = [
        payload.get("platform_balance"), payload.get("available"), payload.get("balance")
    ]
    if isinstance(payload.get("platform"), dict):
        candidates.extend([payload["platform"].get("available"), payload["platform"].get("balance")])
    for value in candidates:
        if value is not None and not isinstance(value, (dict, list)):
            return _decimal(value, allow_zero=True)
    raise ValueError("Aura platform balance missing")


async def reconcile(ledger, client, environment):
    external = _platform_balance(await client.get_balance())
    with localcontext() as ctx:
        ctx.prec = 80
        allocated = sum(
            (Decimal(row[0]) + Decimal(row[1]) for row in ledger.db.execute(
                "SELECT available,reserved FROM wallet_provider_positions "
                "WHERE provider='aura' AND environment=? AND asset='USDT'", (environment,)
            )), Decimal(0)
        )
        difference = external - allocated
    detail = {
        "provider": "aura", "environment": environment, "asset": "USDT",
        "provider_available": str(external), "allocated": str(allocated),
        "difference": str(difference), "state": "ok" if difference == 0 else "deficit" if difference < 0 else "mismatch",
    }
    ledger.db.execute(
        "INSERT OR REPLACE INTO wallet_provider_reconciliation VALUES (?,?,?,?,?,?,?,?,?)",
        ("aura", environment, "USDT", str(external), str(allocated), str(difference),
         detail["state"], time.time(), json.dumps(detail, separators=(",", ":"))),
    )
    return detail


async def run_worker(ledger, client, environment, interval=10):
    last_reconcile = 0.0
    while True:
        try:
            process_inbox(ledger, environment)
            if client.configured and time.time() - last_reconcile >= 60:
                result = await reconcile(ledger, client, environment)
                ledger.db.execute(
                    "INSERT OR REPLACE INTO aura_runtime_state VALUES (?,?,?)",
                    ("reconciliation", json.dumps(result, separators=(",", ":")), time.time()),
                )
                last_reconcile = time.time()
            ledger.db.execute(
                "INSERT OR REPLACE INTO aura_runtime_state VALUES (?,?,?)",
                ("health", "healthy", time.time()),
            )
        except asyncio.CancelledError:
            raise
        except Exception as error:
            ledger.db.execute(
                "INSERT OR REPLACE INTO aura_runtime_state VALUES (?,?,?)",
                ("health", "degraded:" + str(error)[:500], time.time()),
            )
        await asyncio.sleep(interval)
