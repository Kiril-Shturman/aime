"""Coverage checks and explicit, audited administrative corrections."""

import json
import time
import uuid
from decimal import Decimal, localcontext
from aiohttp import web

D = Decimal


async def coverage(ledger, provider, ApiError):
    ledger.book.verify()
    balances = await provider.call("getBalance")
    external = {row["currency_code"]: D(str(row["available"])) for row in balances}
    if any(not value.is_finite() or value < 0 for value in external.values()):
        raise ValueError("Invalid provider balance")
    liabilities, inflight = {}, {}
    with localcontext() as ctx:
        ctx.prec = 80
        for row in ledger.db.execute(
            "SELECT asset,available,reserved FROM wallet_balances"
        ):
            liabilities[row["asset"]] = (
                liabilities.get(row["asset"], D(0))
                + D(row["available"])
                + D(row["reserved"])
            )
        for row in ledger.db.execute(
            "SELECT body,held FROM wallet_withdrawal_intents WHERE state='processing'"
        ):
            asset = json.loads(row["body"])["asset"]
            inflight[asset] = inflight.get(asset, D(0)) + D(row["held"])
        for row in ledger.db.execute(
            "SELECT body FROM wallet_quotes WHERE state='processing'"
        ):
            item = json.loads(row["body"])
            asset = item["asset"]
            inflight[asset] = inflight.get(asset, D(0)) + D(item["amount"])
        if ledger.db.execute(
            "SELECT 1 FROM sqlite_master WHERE name='wallet_user_transfers'"
        ).fetchone():
            for row in ledger.db.execute(
                "SELECT body FROM wallet_user_transfers WHERE state='pending'"
            ):
                item = json.loads(row["body"])
                asset = item["asset"]
                inflight[asset] = inflight.get(asset, D(0)) + D(item["amount"])
        rows = []
        ledger.begin(
            "coverage", "system", "Compare organization assets with client obligations"
        )
        try:
            for asset in sorted(set(external) | set(liabilities) | set(inflight)):
                # Confirmed outgoing provider balances are held against reserved
                # client liabilities until their final outcome is known.
                difference = (
                    external.get(asset, D(0))
                    + inflight.get(asset, D(0))
                    - liabilities.get(asset, D(0))
                )
                row = {
                    "asset": asset,
                    "provider_available": str(external.get(asset, D(0))),
                    "liabilities": str(liabilities.get(asset, D(0))),
                    "inflight": str(inflight.get(asset, D(0))),
                    "difference": str(difference),
                    "state": (
                        "ok"
                        if difference == 0
                        else "deficit" if difference < 0 else "mismatch"
                    ),
                }
                ledger.db.execute(
                    "INSERT OR REPLACE INTO finance_reconciliation VALUES (?,?,?,?,?,?,?,?)",
                    (
                        asset,
                        row["provider_available"],
                        row["liabilities"],
                        row["inflight"],
                        row["difference"],
                        row["state"],
                        time.time(),
                        json.dumps(row),
                    ),
                )
                rows.append(row)
            ledger.commit()
        except Exception:
            ledger.rollback()
            raise
    return {"items": rows, "blocked": any(row["state"] != "ok" for row in rows)}


async def require_coverage(ledger, provider, asset, ApiError):
    report = await coverage(ledger, provider, ApiError)
    row = next((item for item in report["items"] if item["asset"] == asset), None)
    if row and row["state"] != "ok":
        raise ApiError(
            "BALANCE_MISMATCH",
            "Расходы заблокированы: баланс организации не совпадает с обязательствами перед клиентами.",
            503,
        )


async def finance_route(request, action, uid, admin, ledger, provider, money, ApiError):
    if action == "finance-reconciliation" and request.method == "GET":
        if not admin:
            raise ApiError("FORBIDDEN", "Только администратор", 403)
        report = await coverage(ledger, provider, ApiError)
        report["worker"] = dict(
            ledger.db.execute(
                "SELECT key,value FROM finance_worker_state WHERE key IN ('health','last_attempt','last_success','last_error','last_cycle_errors')"
            ).fetchall()
        )
        return web.json_response(report)
    if action == "finance-adjustment" and request.method == "POST":
        if not admin:
            raise ApiError("FORBIDDEN", "Только администратор", 403)
        body = await request.json()
        if set(body) - {"account_id", "asset", "amount", "reason", "bucket"}:
            raise ValueError("Unknown parameter")
        target = body.get("account_id")
        asset = str(body.get("asset", "")).upper()
        reason = str(body.get("reason", "")).strip()
        if (
            not ledger.db.execute(
                "SELECT 1 FROM wallet_accounts WHERE user_id=?", (target,)
            ).fetchone()
            or not reason
            or len(reason) > 1000
        ):
            raise ValueError("Existing account and reason required")
        amount = money(body.get("amount"), positive=False)
        if not asset.isalnum() or not 2 <= len(asset) <= 12 or not amount:
            raise ValueError("Invalid adjustment")
        bucket = body.get("bucket", "available")
        ledger.begin("admin_adjustment", uid, reason)
        try:
            if bucket == "available":
                available, reserved = ledger.balance(target, asset)
                ledger.put_balance(target, asset, available + amount, reserved)
            elif bucket == "debt":
                from wallet_withdrawals import debt

                ledger.set_debt(target, asset, debt(ledger, target, asset) + amount)
            else:
                raise ValueError("Only available/debt can be adjusted")
            key = "adjustment:" + uuid.uuid4().hex
            ledger.db.execute(
                "INSERT INTO wallet_events VALUES (?,?,?,?,?,?,?)",
                (
                    key,
                    target,
                    asset,
                    str(amount),
                    "admin_adjustment",
                    time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    json.dumps({"reason": reason, "actor": uid, "bucket": bucket}),
                ),
            )
            ledger.commit()
            return web.json_response({"event_id": key})
        except Exception:
            ledger.rollback()
            raise
    return None
