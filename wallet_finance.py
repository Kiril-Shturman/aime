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
    liabilities, allocated, inflight = {}, {}, {}
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
        tables = {
            row[0]
            for row in ledger.db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
        if "wallet_provider_positions" in tables:
            for row in ledger.db.execute(
                "SELECT asset,available,reserved FROM wallet_provider_positions"
            ):
                allocated[row["asset"]] = (
                    allocated.get(row["asset"], D(0))
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
                # Provider positions are reconciled against their own provider and
                # environment. Only the unallocated remainder belongs to the
                # legacy GoSwap pool.
                goswap_liability = liabilities.get(asset, D(0)) - allocated.get(asset, D(0))
                # Confirmed outgoing provider balances are held against reserved
                # client liabilities until their final outcome is known.
                difference = (
                    external.get(asset, D(0))
                    + inflight.get(asset, D(0))
                    - goswap_liability
                )
                row = {
                    "provider": "goswap",
                    "environment": "live",
                    "asset": asset,
                    "provider_available": str(external.get(asset, D(0))),
                    "liabilities": str(goswap_liability),
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
            if "wallet_provider_reconciliation" in tables:
                for stored in ledger.db.execute(
                    "SELECT provider,environment,asset,provider_available,allocated,"
                    "difference,state FROM wallet_provider_reconciliation "
                    "ORDER BY provider,environment,asset"
                ):
                    state = str(stored["state"]).lower()
                    rows.append({
                        "provider": stored["provider"],
                        "environment": stored["environment"],
                        "asset": stored["asset"],
                        "provider_available": stored["provider_available"],
                        "liabilities": stored["allocated"],
                        "inflight": "0",
                        "difference": stored["difference"],
                        "state": state,
                    })
            ledger.commit()
        except Exception:
            ledger.rollback()
            raise
    return {
        "items": rows,
        "blocked": any(
            row["state"] in {"deficit", "error", "failed", "mismatch"}
            for row in rows
        ),
    }


async def require_coverage(ledger, provider, asset, ApiError):
    report = await coverage(ledger, provider, ApiError)
    row = next(
        (
            item for item in report["items"]
            if item["provider"] == "goswap" and item["asset"] == asset
        ),
        None,
    )
    if row and row["state"] != "ok":
        raise ApiError(
            "BALANCE_MISMATCH",
            "Расходы заблокированы: баланс организации не совпадает с обязательствами перед клиентами.",
            503,
        )


async def finance_route(
    request, action, uid, admin, ledger, provider, money, ApiError,
    audit_callback=None,
):
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
        if set(body) - {"account_id", "asset", "amount", "reason", "bucket", "confirm"}:
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
        confirmation_amount = str(body.get("amount", "")).strip()
        amount = money(confirmation_amount, positive=False)
        if not asset.isalnum() or not 2 <= len(asset) <= 12 or not amount:
            raise ValueError("Invalid adjustment")
        confirmation = f"ADJUST {target} {asset} {confirmation_amount}"
        if body.get("confirm") != confirmation:
            raise ApiError(
                "CONFIRMATION_REQUIRED",
                "Подтвердите корректировку баланса точной контрольной строкой",
                409,
            )
        bucket = body.get("bucket", "available")
        ledger.begin("admin_adjustment", uid, reason)
        try:
            if bucket == "available":
                available, reserved = ledger.balance(target, asset)
                before, after = available, available + amount
                ledger.put_balance(target, asset, available + amount, reserved)
            elif bucket == "debt":
                from wallet_withdrawals import debt

                before = debt(ledger, target, asset)
                after = before + amount
                ledger.set_debt(target, asset, after)
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
            if audit_callback:
                audit_callback(
                    uid, "balance.adjust", target,
                    detail={
                        "asset": asset, "amount": str(amount), "bucket": bucket,
                        "before": str(before), "after": str(after),
                        "event_id": key, "reason_characters": len(reason),
                    },
                )
            ledger.commit()
            return web.json_response({
                "event_id": key, "asset": asset, "bucket": bucket,
                "before": str(before), "after": str(after),
            })
        except Exception:
            ledger.rollback()
            raise
    return None
