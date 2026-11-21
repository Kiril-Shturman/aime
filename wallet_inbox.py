"""Durable deliveries. Money and processed_at commit in the same transaction."""

import hashlib
import hmac
import json
import time
from aiohttp import web
from wallet_withdrawals import apply_outcome
from wallet_user_ops import apply_transfer, bind_invoice, apply_journal
from wallet_notifications import enqueue as enqueue_notification, prepare as prepare_notifications


def prepare(ledger):
    prepare_notifications(ledger)
    ledger.db.executescript(
        """
      CREATE TABLE IF NOT EXISTS wallet_webhook_inbox (id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT UNIQUE NOT NULL,raw_body BLOB NOT NULL,signature TEXT NOT NULL,signature_valid INTEGER NOT NULL,origin TEXT NOT NULL,update_type TEXT,entity_id TEXT,status TEXT,version INTEGER,received_at REAL NOT NULL,processed_at REAL,error TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at REAL NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS wallet_provider_journal (id INTEGER PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_provider_cursor (id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL);
    """
    )


def event_key(kind, payload, raw):
    entity = (
        payload.get("deposit_id")
        or payload.get("payment_id")
        or payload.get("withdrawal_id")
        or payload.get("transfer_id")
        or payload.get("invoice_id")
        or payload.get("spend_id")
    )
    if kind == "deposit_received":
        key = "deposit:" + str(entity)
    elif kind.startswith("qr_payment_"):
        key = "qr:" + str(entity) + ":" + str(payload.get("status"))
    elif kind.startswith("withdrawal_"):
        key = (
            "withdrawal:"
            + str(entity)
            + ":"
            + str(payload.get("version"))
            + ":"
            + str(payload.get("status"))
        )
    elif kind.startswith("transfer_"):
        key = "transfer:" + str(entity) + ":" + str(payload.get("status"))
    else:
        key = "delivery:" + hashlib.sha256(raw).hexdigest()
    return key, str(entity or "")


def store(ledger, raw, signature, valid, origin="webhook", event=None):
    try:
        event = event or json.loads(raw)
        kind = event.get("update_type", "")
        payload = event.get("payload") or {}
        if not isinstance(payload, dict):
            raise ValueError("Payload must be an object")
        key, entity = event_key(kind, payload, raw)
    except (ValueError, TypeError, AttributeError):
        kind = "invalid"
        payload = {}
        entity = ""
        key = hashlib.sha256(raw).hexdigest()
    if not valid:
        key = "invalid:" + hashlib.sha256(raw + signature.encode()).hexdigest()
    ledger.begin("inbox_receive", "provider", "Persist raw delivery")
    try:
        ledger.db.execute(
            "INSERT OR IGNORE INTO wallet_webhook_inbox(event_key,raw_body,signature,signature_valid,origin,update_type,entity_id,status,version,received_at,error) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                key,
                raw,
                signature,
                int(valid),
                origin,
                kind,
                entity,
                payload.get("status"),
                payload.get("version"),
                time.time(),
                None if valid else "BAD_SIGNATURE",
            ),
        )
        row = ledger.db.execute(
            "SELECT * FROM wallet_webhook_inbox WHERE event_key=?", (key,)
        ).fetchone()
        ledger.commit()
        return row
    except Exception:
        ledger.rollback()
        raise


async def fetch_pages(ledger, provider, ApiError, max_pages=10):
    row = ledger.db.execute(
        "SELECT value FROM wallet_provider_cursor WHERE id=1"
    ).fetchone()
    cursor = row[0] if row else 0
    pages = []
    for _ in range(max_pages):
        page = await provider.call("getTransactions", {"after": cursor, "count": 1000})
        next_cursor = page.get("cursor", cursor)
        if (
            type(next_cursor) is not int
            or next_cursor < cursor
            or (page.get("has_more") and next_cursor == cursor)
        ):
            raise ApiError("PROVIDER_UNAVAILABLE", "Invalid journal cursor", 502)
        pages.append(page)
        cursor = next_cursor
        if not page.get("has_more"):
            break
    return pages


def apply_pages(ledger, pages, money, ApiError):
    ledger.begin("provider_journal", "provider", "Apply immutable organization journal")
    try:
        for page in pages:
            for item in page.get("items", []):
                if type(item.get("id")) is not int:
                    raise ValueError("Invalid journal ID")
                existing = ledger.db.execute(
                    "SELECT body FROM wallet_provider_journal WHERE id=?", (item["id"],)
                ).fetchone()
                if existing and json.loads(existing[0]) != item:
                    raise ValueError("Changed immutable journal row")
                ledger.db.execute(
                    "INSERT OR IGNORE INTO wallet_provider_journal VALUES (?,?)",
                    (item["id"], json.dumps(item)),
                )
            cursor = page.get("cursor", 0)
            ledger.db.execute(
                "INSERT INTO wallet_provider_cursor VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=MAX(value,excluded.value)",
                (cursor,),
            )
        # Retry previously unowned invoice rows after intent ownership recovery.
        for row in ledger.db.execute(
            "SELECT j.body FROM wallet_provider_journal j LEFT JOIN finance_provider_effects e ON e.row_id=j.id WHERE e.row_id IS NULL ORDER BY j.id"
        ).fetchall():
            item = json.loads(row["body"])
            raw = json.dumps({"update_type": "provider_row", "payload": item}).encode()
            key = "journal:" + str(item["id"])
            ledger.db.execute(
                "INSERT OR IGNORE INTO wallet_webhook_inbox(event_key,raw_body,signature,signature_valid,origin,update_type,entity_id,received_at) VALUES (?,?,?,?,?,?,?,?)",
                (
                    key,
                    raw,
                    "",
                    1,
                    "provider_api",
                    "provider_row",
                    str(item["id"]),
                    time.time(),
                ),
            )
            if apply_journal(ledger, item, money, ApiError):
                ledger.db.execute(
                    "UPDATE wallet_webhook_inbox SET processed_at=?,error=NULL,attempts=attempts+1 WHERE event_key=?",
                    (time.time(), key),
                )
        ledger.commit()
    except Exception:
        ledger.rollback()
        raise


async def process(ledger, provider, row, money, ApiError):
    if not row["signature_valid"] or row["processed_at"] is not None:
        return False
    try:
        event = json.loads(row["raw_body"])
        kind = event.get("update_type", "")
        payload = event.get("payload") or {}
    except (ValueError, TypeError):
        ledger.db.execute(
            "UPDATE wallet_webhook_inbox SET error=?,attempts=attempts+1,next_attempt_at=? WHERE id=?",
            ("Invalid JSON", time.time() + 3600, row["id"]),
        )
        raise
    verified = []
    pages = []
    invoice_binding = None
    try:
        # All network I/O is before BEGIN IMMEDIATE. The application phase is synchronous.
        if kind.startswith("withdrawal_"):
            result = await provider.call(
                "getWithdrawals",
                {"spend_id": str(payload.get("spend_id", "")), "count": 100},
            )
            verified = [
                item
                for item in result.get("items", [])
                if item.get("spend_id") == payload.get("spend_id")
            ]
            if not verified:
                raise ApiError("UNAVAILABLE", "Withdrawal state not yet available", 503)
        elif kind.startswith("transfer_"):
            result = await provider.call(
                "getTransfers",
                {"spend_id": str(payload.get("spend_id", "")), "count": 100},
            )
            verified = [
                item
                for item in result.get("items", [])
                if item.get("spend_id") == payload.get("spend_id")
            ]
            if not verified:
                raise ApiError("UNAVAILABLE", "Transfer state not yet available", 503)
        elif kind.startswith("invoice_") or kind in {"hold_release", "invoice_refund"}:
            invoice_id = str(payload.get("invoice_id", ""))
            own = ledger.db.execute(
                "SELECT * FROM wallet_user_invoices WHERE invoice_id=? OR payload=?",
                (invoice_id, payload.get("payload", "")),
            ).fetchone()
            if own and invoice_id.isdigit():
                result = await provider.call("getInvoices", {"invoice_ids": invoice_id})
                current = next(
                    (
                        item
                        for item in result.get("items", [])
                        if str(item.get("invoice_id")) == invoice_id
                        and item.get("payload") == own["payload"]
                    ),
                    None,
                )
                if current:
                    invoice_binding = (own, current)
            pages = await fetch_pages(ledger, provider, ApiError)
        ledger.begin("webhook", "provider", row["event_key"])
        try:
            current = ledger.db.execute(
                "SELECT processed_at FROM wallet_webhook_inbox WHERE id=?", (row["id"],)
            ).fetchone()
            if current[0] is not None:
                ledger.commit()
                return False
            if kind == "deposit_received":
                owner = ledger.db.execute(
                    "SELECT user_id FROM wallet_accounts WHERE client_ref=?",
                    (payload.get("client_ref"),),
                ).fetchone()
                credited = ledger.deposit(payload)
                if credited and owner:
                    amount = str(payload.get("credited") or payload.get("amount") or "")
                    asset = str(payload.get("asset") or "USDT")
                    enqueue_notification(
                        ledger, "goswap:deposit:" + str(payload.get("deposit_id")),
                        owner[0], "deposit", "Пополнение зачислено",
                        f"На баланс зачислено {amount} {asset}.",
                        variables={"amount": amount, "asset": asset, "network_suffix": ""},
                    )
            elif kind in {
                "qr_payment_completed",
                "qr_payment_failed",
                "qr_payment_refunded",
            }:
                if payload.get("status") != kind.removeprefix("qr_payment_"):
                    raise ValueError("Mismatched QR status")
                ledger.payment(payload)
                quote = ledger.db.execute(
                    "SELECT user_id FROM wallet_quotes WHERE spend_id=?",
                    (payload.get("spend_id"),),
                ).fetchone()
                if quote:
                    status = str(payload.get("status") or "")
                    enqueue_notification(
                        ledger, f"goswap:qr:{payload.get('payment_id')}:{status}",
                        quote[0], "qr", "Оплата по QR", "Статус оплаты: " + status + ".",
                    )
            elif kind.startswith("withdrawal_"):
                for item in verified:
                    apply_outcome(ledger, item, money, ApiError)
                    owner = ledger.db.execute(
                        "SELECT user_id FROM wallet_withdrawal_intents WHERE spend_id=?",
                        (item.get("spend_id"),),
                    ).fetchone()
                    if owner:
                        status = str(item.get("status") or "")
                        amount = str(item.get("amount") or "")
                        enqueue_notification(
                            ledger, f"goswap:withdrawal:{item.get('withdrawal_id')}:{item.get('version')}:{status}",
                            owner[0], "withdrawal", "Вывод средств",
                            f"Статус вывода {amount} {item.get('asset') or 'USDT'}: {status}.",
                        )
            elif kind.startswith("transfer_"):
                for item in verified:
                    apply_transfer(ledger, item, money, ApiError)
            elif kind.startswith("invoice_") or kind in {
                "hold_release",
                "invoice_refund",
            }:
                if invoice_binding:
                    bind_invoice(ledger, *invoice_binding)
                apply_pages(ledger, pages, money, ApiError)
            else:
                raise ValueError("Unsupported webhook type")
            ledger.db.execute(
                "UPDATE wallet_webhook_inbox SET processed_at=?,error=NULL,attempts=attempts+1 WHERE id=?",
                (time.time(), row["id"]),
            )
            ledger.commit()
            return True
        except Exception:
            ledger.rollback()
            raise
    except Exception as error:
        ledger.db.execute(
            "UPDATE wallet_webhook_inbox SET error=?,attempts=attempts+1,next_attempt_at=? WHERE id=?",
            (
                str(error)[:1000],
                time.time() + min(3600, 2 ** min(row["attempts"] + 1, 11)),
                row["id"],
            ),
        )
        raise


async def receive(request, ledger, provider, token, money, ApiError):
    raw = await request.read()
    signature = request.headers.get("crypto-pay-api-signature", "")
    expected = hmac.new(
        hashlib.sha256(token.encode()).digest(), raw, hashlib.sha256
    ).hexdigest()
    valid = bool(token) and hmac.compare_digest(expected, signature)
    row = store(ledger, raw, signature, valid)
    if not valid:
        raise ApiError("BAD_SIGNATURE", "Неверная подпись", 401)
    await process(ledger, provider, row, money, ApiError)
    return web.json_response({"ok": True})
