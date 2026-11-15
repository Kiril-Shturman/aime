"""Owned transfers and invoice intents. Unknown POST outcomes are durable."""

import asyncio
import json
import time
import uuid
import weakref
from decimal import Decimal, localcontext
from aiohttp import web
from wallet_finance import require_coverage
from wallet_withdrawals import debt

D = Decimal


def prepare(ledger):
    ledger.db.executescript(
        """
      CREATE TABLE IF NOT EXISTS wallet_user_transfers (intent_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,spend_id TEXT UNIQUE NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,outcome TEXT,transfer_id TEXT UNIQUE,created_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_user_invoices (intent_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,payload TEXT UNIQUE NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,invoice_id TEXT UNIQUE,outcome TEXT,created_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_invoice_scan (scope TEXT PRIMARY KEY,offset INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS finance_provider_effects (row_id INTEGER PRIMARY KEY,kind TEXT NOT NULL,processed_at REAL NOT NULL);
    """
    )


def lock(ledger, key):
    if not hasattr(ledger, "user_op_locks"):
        ledger.user_op_locks = weakref.WeakValueDictionary()
    return ledger.user_op_locks.setdefault(key, asyncio.Lock())


def change(ledger, uid, asset, available_delta, reserved_delta=D(0)):
    with localcontext() as ctx:
        ctx.prec = 80
        available, reserved = ledger.balance(uid, asset)
        owed = debt(ledger, uid, asset)
        available += available_delta
        if available < 0:
            owed -= available
            available = D(0)
        elif owed:
            paid = min(available, owed)
            available -= paid
            owed -= paid
        ledger.put_balance(uid, asset, available, reserved + reserved_delta)
        ledger.set_debt(uid, asset, owed)


def apply_transfer(ledger, item, money, ApiError):
    state = item.get("status")
    if state not in {"pending", "completed", "reverted"}:
        raise ValueError("Invalid transfer status")
    ledger.begin(
        "transfer_outcome", "provider", "Verified transfer " + str(item.get("spend_id"))
    )
    try:
        row = ledger.db.execute(
            "SELECT * FROM wallet_user_transfers WHERE spend_id=?",
            (item.get("spend_id"),),
        ).fetchone()
        if (
            not row
            or row["state"] in {"prepared", "rejected", "reverted"}
            or row["state"] == state
            or (row["state"] == "completed" and state == "pending")
        ):
            ledger.commit()
            return False
        body = json.loads(row["body"])
        amount = money(body["amount"])
        if (
            item.get("asset") != body["asset"]
            or money(item["amount"]) != amount
            or str(item.get("user_id")) != body["user_id"]
            or not item.get("transfer_id")
            or (row["transfer_id"] and row["transfer_id"] != str(item["transfer_id"]))
        ):
            raise ValueError("Transfer identity mismatch")
        old_reserved = amount if row["state"] in {"reserved", "pending"} else D(0)
        new_reserved = amount if state == "pending" else D(0)
        refund = amount if state == "reverted" else D(0)
        change(
            ledger, row["user_id"], body["asset"], refund, new_reserved - old_reserved
        )
        ledger.db.execute(
            "UPDATE wallet_user_transfers SET state=?,outcome=?,transfer_id=? WHERE intent_id=?",
            (state, json.dumps(item), str(item["transfer_id"]), row["intent_id"]),
        )
        delta = (
            -amount
            if state == "completed"
            else amount if state == "reverted" and row["state"] == "completed" else D(0)
        )
        ledger.db.execute(
            "INSERT OR IGNORE INTO wallet_events VALUES (?,?,?,?,?,?,?)",
            (
                "transfer:" + row["spend_id"] + ":" + state,
                row["user_id"],
                body["asset"],
                str(delta),
                "transfer_" + state,
                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                json.dumps({**item, "operation_kind": "transfers"}),
            ),
        )
        ledger.commit()
        return True
    except Exception:
        ledger.rollback()
        raise


async def sync_transfers(ledger, provider, money, ApiError, uid=None, background=False):
    rows = ledger.db.execute(
        (
            "SELECT spend_id FROM wallet_user_transfers WHERE state IN ('reserved','pending') AND intent_id NOT IN (SELECT entity FROM wallet_poll_schedule WHERE kind='transfer' AND next_at>"
            + str(time.time())
            + ")"
            if background
            else "SELECT spend_id FROM wallet_user_transfers WHERE state NOT IN ('prepared','rejected')"
        )
        + (" AND user_id=?" if uid else "")
        + (
            " ORDER BY COALESCE((SELECT next_at FROM wallet_poll_schedule WHERE kind='transfer' AND entity=intent_id),0) LIMIT 200"
            if background
            else ""
        ),
        (uid,) if uid else (),
    ).fetchall()
    for start in range(0, len(rows), 100):
        ids = {row["spend_id"] for row in rows[start : start + 100]}
        result = await provider.call(
            "getTransfers", {"spend_id": ",".join(sorted(ids)), "count": 100}
        )
        if background:
            for spend_id in ids:
                ledger.db.execute(
                    "INSERT OR REPLACE INTO wallet_poll_schedule SELECT 'transfer',intent_id,? FROM wallet_user_transfers WHERE spend_id=?",
                    (time.time() + 60, spend_id),
                )
        for item in result.get("items", []):
            if item.get("spend_id") in ids:
                apply_transfer(ledger, item, money, ApiError)


async def transfer_enabled(provider, ApiError):
    me = await provider.call("getMe")
    if me.get("can_transfer") is not True:
        raise ApiError("NOT_ENABLED", "Переводы в Telegram недоступны", 403)


async def currency_enabled(provider, asset, capability, ApiError):
    result = await provider.call("getCurrencies")
    rows = result if isinstance(result, list) else result.get("items", [])
    if not any(
        (row.get("code") or row.get("currency_code")) == asset
        and row.get(capability) is True
        for row in rows
    ):
        raise ApiError("UNSUPPORTED_ASSET", "Операция с этой монетой недоступна", 400)


async def route(request, action, uid, ledger, provider, money, ApiError):
    actions = {
        "transfer-prepare",
        "transfer-send",
        "transfer-revoke",
        "transfer-history",
        "invoice-prepare",
        "invoice-create",
        "invoice-history",
        "financial-capabilities",
    }
    if action not in actions:
        return None
    if action == "financial-capabilities" and request.method == "GET":
        me = await provider.call("getMe")
        return web.json_response(
            {
                "can_transfer": me.get("can_transfer") is True,
                "can_withdraw": me.get("can_withdraw") is True,
                "currencies": await provider.call("getCurrencies"),
            }
        )
    if action in {"transfer-history", "invoice-history"} and request.method == "GET":
        if action == "transfer-history":
            await sync_transfers(ledger, provider, money, ApiError, uid)
            table = "wallet_user_transfers"
        else:
            await sync_invoices(ledger, provider, uid)
            table = "wallet_user_invoices"
            # Backwards-compatible, server-recorded ownership from earlier releases.
            if not ledger.db.execute(
                "SELECT 1 FROM wallet_user_invoices WHERE user_id=?", (uid,)
            ).fetchone():
                legacy = set()
                for record in ledger.db.execute(
                    "SELECT detail FROM wallet_events WHERE user_id=?", (uid,)
                ):
                    item = json.loads(record[0])
                    if (
                        item.get("operation_kind") == "invoices"
                        and str(item.get("invoice_id", "")).isdigit()
                    ):
                        legacy.add(str(item["invoice_id"]))
                if legacy:
                    result = await provider.call(
                        "getInvoices",
                        {
                            "invoice_ids": ",".join(sorted(legacy)),
                            "count": min(len(legacy), 500),
                        },
                    )
                    return web.json_response(
                        {
                            "items": [
                                item
                                for item in result.get("items", [])
                                if str(item.get("invoice_id")) in legacy
                            ],
                            "scope": "personal",
                            "has_more": False,
                        }
                    )
        # List owned local intents only. Never forward arbitrary browser IDs.
        count = min(max(int(request.query.get("count", "100")), 1), 1000)
        offset = int(request.query.get("offset", "0"))
        if offset < 0:
            raise ValueError("Invalid offset")
        rows = ledger.db.execute(
            f"SELECT * FROM {table} WHERE user_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (uid, count + 1, offset),
        ).fetchall()
        return web.json_response(
            {
                "items": [
                    (
                        {
                            **(
                                json.loads(row["outcome"])
                                if row["outcome"]
                                else json.loads(row["body"])
                            ),
                            "intent_id": row["intent_id"],
                            "status": row["state"],
                            "spend_id": row["spend_id"],
                        }
                        if table == "wallet_user_transfers"
                        else {
                            **(json.loads(row["outcome"]) if row["outcome"] else {}),
                            "intent_id": row["intent_id"],
                            "status": row["state"],
                        }
                    )
                    for row in rows[:count]
                ],
                "has_more": len(rows) > count,
                "scope": "personal",
            }
        )
    if request.method != "POST":
        raise ApiError("METHOD_NOT_ALLOWED", "POST required", 405)
    body = await request.json()
    if action == "transfer-prepare":
        if set(body) - {"recipient_id", "asset", "amount", "comment"}:
            raise ValueError("Unknown parameter")
        await transfer_enabled(provider, ApiError)
        asset = str(body.get("asset", "USDT")).upper()
        await currency_enabled(provider, asset, "can_transfer", ApiError)
        recipient = str(body.get("recipient_id", ""))
        if not recipient.isdigit() or not 0 < int(recipient) < 10**16:
            raise ValueError("Numeric Telegram recipient required")
        amount = money(body.get("amount"))
        comment = str(body.get("comment", ""))
        if len(comment) > 1024 or (asset == "USDT" and amount < D(".1")):
            raise ValueError("Invalid transfer")
        intent = uuid.uuid4().hex
        canonical = {
            "user_id": recipient,
            "asset": asset,
            "amount": str(amount),
            "comment": comment,
        }
        ledger.db.execute(
            "INSERT INTO wallet_user_transfers VALUES (?,?,?,?,?,?,?,?)",
            (
                intent,
                uid,
                "wpay-t-" + uuid.uuid4().hex,
                json.dumps(canonical),
                "prepared",
                None,
                None,
                time.time(),
            ),
        )
        return web.json_response({"intent_id": intent, **canonical})
    if action == "invoice-prepare":
        if set(body) - {"asset", "amount", "description", "expires_in"}:
            raise ValueError("Unknown parameter")
        asset = str(body.get("asset", "USDT")).upper()
        amount = money(body.get("amount"))
        expiry = body.get("expires_in", 3600)
        description = str(body.get("description", ""))
        limits = {"USDT": D(100000), "TRX": D(1000000), "BNB": D(200), "ETH": D(50)}
        if (
            asset not in limits
            or amount > limits[asset]
            or type(expiry) is not int
            or not 60 <= expiry <= 2678400
            or len(description) > 1024
        ):
            raise ValueError("Invalid invoice")
        intent = uuid.uuid4().hex
        payload = "wpay:invoice:" + intent
        canonical = {
            "asset": asset,
            "amount": str(amount),
            "description": description,
            "expires_in": expiry,
            "payload": payload,
        }
        ledger.db.execute(
            "INSERT INTO wallet_user_invoices VALUES (?,?,?,?,?,?,?,?)",
            (
                intent,
                uid,
                payload,
                json.dumps(canonical),
                "prepared",
                None,
                None,
                time.time(),
            ),
        )
        return web.json_response({"intent_id": intent})
    intent = body.get("intent_id")
    if set(body) != {"intent_id"}:
        raise ValueError("Only server intent_id is accepted")
    async with lock(ledger, (uid, intent)):
        if action == "invoice-create":
            return await create_invoice(ledger, provider, uid, intent, ApiError)
        row = ledger.db.execute(
            "SELECT * FROM wallet_user_transfers WHERE intent_id=? AND user_id=?",
            (intent, uid),
        ).fetchone()
        if not row:
            raise ApiError("NOT_FOUND", "Перевод не найден", 404)
        if action == "transfer-revoke":
            await transfer_enabled(provider, ApiError)
            current = await provider.call(
                "getTransfers", {"spend_id": row["spend_id"], "count": 1}
            )
            item = next(
                (
                    item
                    for item in current.get("items", [])
                    if item.get("spend_id") == row["spend_id"]
                ),
                None,
            )
            if not item:
                raise ApiError("NOT_FOUND", "Перевод ещё не найден у провайдера", 409)
            apply_transfer(ledger, item, money, ApiError)
            if item.get("status") == "reverted":
                return web.json_response(item)
            if item.get("status") != "pending":
                raise ApiError(
                    "NOT_REVOCABLE", "Полученный перевод отозвать нельзя", 409
                )
            result = await provider.call(
                "revokeTransfer", {"spend_id": row["spend_id"]}, post=True
            )
            # A fresh read, not a guessed local refund, owns the accounting.
            current = await provider.call(
                "getTransfers", {"spend_id": row["spend_id"], "count": 1}
            )
            verified = next(
                (
                    item
                    for item in current.get("items", [])
                    if item.get("spend_id") == row["spend_id"]
                ),
                None,
            )
            if verified:
                apply_transfer(ledger, verified, money, ApiError)
            return web.json_response(verified or result)
        if action != "transfer-send":
            raise ApiError("NOT_FOUND", "Unknown action", 404)
        if row["state"] in {"pending", "completed", "reverted"}:
            return web.json_response(json.loads(row["outcome"]))
        if row["state"] == "rejected":
            raise ApiError("REESTIMATE_REQUIRED", "Создайте новую заявку", 409)
        # Reads and cached results remain available when transfer permission is off.
        await transfer_enabled(provider, ApiError)
        canonical = json.loads(row["body"])
        amount = money(canonical["amount"])
        first_submission = False
        if row["state"] == "reserved":
            result = await provider.call(
                "getTransfers", {"spend_id": row["spend_id"], "count": 1}
            )
            existing = next(
                (
                    item
                    for item in result.get("items", [])
                    if item.get("spend_id") == row["spend_id"]
                ),
                None,
            )
            if existing:
                apply_transfer(ledger, existing, money, ApiError)
                return web.json_response(existing)
        else:
            await require_coverage(ledger, provider, canonical["asset"], ApiError)
            ledger.begin("transfer_reserve", uid, "Reserve transfer " + intent)
            try:
                current = ledger.db.execute(
                    "SELECT * FROM wallet_user_transfers WHERE intent_id=? AND user_id=?",
                    (intent, uid),
                ).fetchone()
                if current["state"] == "prepared":
                    first_submission = True
                    available, reserved = ledger.balance(uid, canonical["asset"])
                    if debt(ledger, uid, canonical["asset"]):
                        raise ApiError("INSUFFICIENT_FUNDS", "Есть задолженность", 409)
                    ledger.put_balance(
                        uid, canonical["asset"], available - amount, reserved + amount
                    )
                    ledger.db.execute(
                        "UPDATE wallet_user_transfers SET state='reserved' WHERE intent_id=?",
                        (intent,),
                    )
                ledger.commit()
                if current["state"] in {"pending", "completed", "reverted"}:
                    return web.json_response(json.loads(current["outcome"]))
            except Exception:
                ledger.rollback()
                raise
        try:
            result = await provider.call(
                "transfer", {**canonical, "spend_id": row["spend_id"]}, post=True
            )
            if result.get("spend_id") != row["spend_id"]:
                raise ValueError("Wrong provider transfer")
            apply_transfer(ledger, result, money, ApiError)
            return web.json_response(result)
        except ApiError as error:
            if (
                first_submission
                and 400 <= error.status < 500
                and error.name != "SPEND_ID_CONFLICT"
            ):
                ledger.begin(
                    "transfer_rejected", "provider", "Definitive rejection " + intent
                )
                try:
                    current = ledger.db.execute(
                        "SELECT state FROM wallet_user_transfers WHERE intent_id=?",
                        (intent,),
                    ).fetchone()
                    if current["state"] == "reserved":
                        change(ledger, uid, canonical["asset"], amount, -amount)
                        ledger.db.execute(
                            "UPDATE wallet_user_transfers SET state='rejected' WHERE intent_id=?",
                            (intent,),
                        )
                    ledger.commit()
                except Exception:
                    ledger.rollback()
                    raise
            raise


def bind_invoice(ledger, row, item):
    invoice_id = str(item.get("invoice_id", ""))
    if not invoice_id.isdigit():
        raise ValueError("Invalid invoice ID")
    canonical = json.loads(row["body"])
    if item.get("payload") is not None and item["payload"] != row["payload"]:
        raise ValueError("Wrong invoice payload")
    if item.get("asset") is not None and item["asset"] != canonical["asset"]:
        raise ValueError("Wrong invoice asset")
    owner = ledger.db.execute(
        "SELECT user_id,intent_id FROM wallet_user_invoices WHERE invoice_id=?",
        (invoice_id,),
    ).fetchone()
    if owner and owner["intent_id"] != row["intent_id"]:
        raise ValueError("Invoice already owned")
    ledger.db.execute(
        "UPDATE wallet_user_invoices SET invoice_id=?,outcome=?,state=? WHERE intent_id=?",
        (invoice_id, json.dumps(item), item.get("status", "active"), row["intent_id"]),
    )


async def create_invoice(ledger, provider, uid, intent, ApiError):
    row = ledger.db.execute(
        "SELECT * FROM wallet_user_invoices WHERE intent_id=? AND user_id=?",
        (intent, uid),
    ).fetchone()
    if not row:
        raise ApiError("NOT_FOUND", "Счёт не найден", 404)
    if row["state"] == "rejected":
        raise ApiError("INVOICE_REJECTED", "Счёт отклонён. Создайте новую заявку.", 409)
    if row["invoice_id"]:
        return web.json_response(json.loads(row["outcome"]))
    if row["state"] != "prepared":
        await sync_invoices(ledger, provider, uid)
        row = ledger.db.execute(
            "SELECT * FROM wallet_user_invoices WHERE intent_id=?", (intent,)
        ).fetchone()
        if row["invoice_id"]:
            return web.json_response(json.loads(row["outcome"]))
        raise ApiError(
            "OUTCOME_UNKNOWN",
            "Ответ потерян. Счёт ищется по серверному payload; повторный createInvoice не выполняется.",
            503,
        )
    # Persist the intent BEFORE an endpoint that has no spend_id idempotency.
    changed = ledger.db.execute(
        "UPDATE wallet_user_invoices SET state='creating' WHERE intent_id=? AND state='prepared'",
        (intent,),
    ).rowcount
    if changed != 1:
        raise ApiError("OUTCOME_UNKNOWN", "Счёт уже создаётся, дождитесь сверки", 503)
    try:
        result = await provider.call(
            "createInvoice", json.loads(row["body"]), post=True
        )
    except ApiError as error:
        if error.status in {400, 401, 403, 404, 405, 422}:
            ledger.db.execute(
                "UPDATE wallet_user_invoices SET state='rejected' WHERE intent_id=? AND state='creating'",
                (intent,),
            )
            raise ApiError("INVOICE_REJECTED", error.detail, error.status)
        raise
    ledger.begin("invoice_created", uid, "Bind invoice " + intent)
    try:
        bind_invoice(ledger, row, result)
        ledger.commit()
    except Exception:
        ledger.rollback()
        raise
    return web.json_response(result)


async def sync_invoices(ledger, provider, uid=None, background=False):
    rows = ledger.db.execute(
        (
            "SELECT * FROM wallet_user_invoices WHERE state NOT IN ('paid','rejected','prepared') AND intent_id NOT IN (SELECT entity FROM wallet_poll_schedule WHERE kind='invoice' AND next_at>"
            + str(time.time())
            + ")"
            if background
            else "SELECT * FROM wallet_user_invoices WHERE 1=1"
        )
        + (" AND user_id=?" if uid else "")
        + (
            " ORDER BY COALESCE((SELECT next_at FROM wallet_poll_schedule WHERE kind='invoice' AND entity=intent_id),0) LIMIT 1000"
            if background
            else ""
        ),
        (uid,) if uid else (),
    ).fetchall()
    known = {row["invoice_id"]: row for row in rows if row["invoice_id"]}
    ids = list(known)
    for start in range(0, len(ids), 500):
        result = await provider.call(
            "getInvoices", {"invoice_ids": ",".join(ids[start : start + 500])}
        )
        for item in result.get("items", []):
            row = known.get(str(item.get("invoice_id")))
            if row and item.get("payload") == row["payload"]:
                bind_invoice(ledger, row, item)
    if background:
        for row in rows:
            # Expired invoices can still be paid late; check them rarely.
            delay = 3600 if row["state"] == "expired" else 60
            ledger.db.execute(
                "INSERT OR REPLACE INTO wallet_poll_schedule VALUES ('invoice',?,?)",
                (row["intent_id"], time.time() + delay),
            )
    unknown = {
        row["payload"]: row
        for row in rows
        if not row["invoice_id"] and row["state"] == "creating"
    }
    if unknown:
        scope = uid or "*"
        progress = ledger.db.execute(
            "SELECT offset FROM wallet_invoice_scan WHERE scope=?", (scope,)
        ).fetchone()
        offset = progress[0] if progress else 0
        for _ in range(1 if background else 10):
            result = await provider.call(
                "getInvoices", {"count": 1000, "offset": offset}
            )
            for item in result.get("items", []):
                row = unknown.get(item.get("payload"))
                if row:
                    bind_invoice(ledger, row, item)
                    unknown.pop(item["payload"], None)
            done = not unknown or not result.get("items")
            offset = 0 if done else offset + 1000
            ledger.db.execute(
                "INSERT OR REPLACE INTO wallet_invoice_scan VALUES (?,?)",
                (scope, offset),
            )
            if done:
                break


def apply_journal(ledger, item, money, ApiError):
    """Only immutable, owned provider rows can credit invoice money."""
    if ledger.db.execute(
        "SELECT 1 FROM finance_provider_effects WHERE row_id=?", (item["id"],)
    ).fetchone():
        return False
    kind = item.get("type")
    details = item.get("details") or {}
    invoice_id = details.get("invoice_id")
    if kind not in {
        "invoice_payment",
        "hold_release",
        "invoice_refund",
        "deposit",
        "deposit_return",
    }:
        return False
    invoice = (
        ledger.db.execute(
            "SELECT * FROM wallet_user_invoices WHERE invoice_id=?", (str(invoice_id),)
        ).fetchone()
        if invoice_id is not None
        else None
    )
    if kind in {"invoice_payment", "hold_release", "invoice_refund"} and not invoice:
        return False
    uid = invoice["user_id"] if invoice else None
    if kind == "deposit_return":
        owner = ledger.db.execute(
            "SELECT user_id,asset FROM wallet_deposit_owners WHERE deposit_id=?",
            (details.get("deposit_id"),),
        ).fetchone()
        if not owner:
            return False
        if owner["asset"] != item["asset"]:
            raise ValueError("Deposit return asset mismatch")
        uid = owner["user_id"]
    if not uid:
        account = ledger.db.execute(
            "SELECT user_id FROM wallet_accounts WHERE client_ref=?",
            (details.get("client_ref"),),
        ).fetchone()
        if not account:
            return False
        uid = account[0]
    delta = money(item["net"], positive=False)
    asset = item["asset"]
    if kind == "deposit_return" and delta >= 0:
        raise ValueError("Deposit return must debit")
    ledger.begin(
        "provider_" + kind, "provider", "Provider journal row " + str(item["id"])
    )
    try:
        if kind == "deposit" and details.get("deposit_id"):
            ledger.deposit(
                {
                    "deposit_id": details["deposit_id"],
                    "client_ref": ledger.account(uid),
                    "asset": asset,
                    "credited": str(delta),
                    "network": details.get("network"),
                    "tx_hash": details.get("tx_hash"),
                    "claim_id": details.get("claim_id"),
                    "credited_at": item.get("created_at"),
                }
            )
        else:
            change(ledger, uid, asset, delta)
            ledger.db.execute(
                "INSERT OR IGNORE INTO wallet_events VALUES (?,?,?,?,?,?,?)",
                (
                    "provider-row:" + str(item["id"]),
                    uid,
                    asset,
                    str(delta),
                    kind,
                    item.get("created_at")
                    or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    json.dumps(item),
                ),
            )
        if item.get("fee") is not None and D(str(item["fee"])) != 0:
            ledger.book.fee(asset, item["fee"], "provider-fee:" + str(item["id"]))
        ledger.db.execute(
            "INSERT INTO finance_provider_effects VALUES (?,?,?)",
            (item["id"], kind, time.time()),
        )
        ledger.commit()
        return True
    except Exception:
        ledger.rollback()
        raise
