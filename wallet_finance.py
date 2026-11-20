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


class TestBackingUnavailable(ValueError):
    pass


def apply_aura_test_backing(ledger, target, amount, event_id, actor, platform):
    """Earmark existing test credits; never increase a user balance or call a payment API."""
    if not ledger.db.in_transaction:raise ValueError("Allocation requires a transaction")
    ledger.db.execute("""CREATE TABLE IF NOT EXISTS custody_test_allocation_audit (
        event_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,environment TEXT NOT NULL,asset TEXT NOT NULL,
        amount TEXT NOT NULL,platform_available TEXT NOT NULL,prior_allocations TEXT NOT NULL,
        actor TEXT NOT NULL,reason TEXT NOT NULL,created_at REAL NOT NULL)""")
    prior=ledger.db.execute('SELECT user_id FROM custody_test_allocation_audit WHERE event_id=?',(event_id,)).fetchone()
    if prior:
        if prior['user_id']!=target:raise ValueError('Allocation owner mismatch')
        return
    event=ledger.db.execute("SELECT amount,type FROM wallet_events WHERE event_id=? AND user_id=? AND asset='USDT'",(event_id,target)).fetchone()
    if not event or event['type'] not in {'adjustment','admin_adjustment'} or D(event['amount'])!=amount:raise ValueError('Existing administrative credit required')
    row=ledger.db.execute("SELECT available FROM wallet_provider_positions WHERE provider='aura' AND environment='test' AND user_id=? AND asset='USDT'",(target,)).fetchone()
    backed=D(row['available']) if row else D(0)
    with localcontext() as ctx:
        ctx.prec=80
        allocated=sum((D(r['available'])+D(r['reserved']) for r in ledger.db.execute("SELECT available,reserved FROM wallet_provider_positions WHERE provider='aura' AND environment='test' AND asset='USDT'")),D(0))
        delta=amount if amount>0 else -min(backed,-amount)
        if delta>0 and (platform is None or not platform.is_finite() or platform<allocated+delta):raise TestBackingUnavailable('Insufficient unallocated Aura test reserve')
        after_backing=backed+delta
    available,_=ledger.balance(target,'USDT')
    if after_backing>available:raise ValueError('Allocation exceeds existing user balance')
    from wallet_aura import _position_adjust
    _position_adjust(ledger,'test',target,'USDT',delta,D(0))
    ledger.db.execute('INSERT INTO custody_test_allocation_audit VALUES (?,?,?,?,?,?,?,?,?,?)',(event_id,target,'test','USDT',str(delta),str(platform) if platform is not None else 'not_required',str(allocated),actor,'Back existing administrative TEST credit with Aura reserve; no additional user credit',time.time()))


def require_goswap_credit_reserve(ledger, asset, credit, platform, error):
    """Bound new credits by existing liabilities and a fresh organization balance."""
    with localcontext() as ctx:
        ctx.prec = 80
        liabilities = D(0)
        backing = {}
        for row in ledger.db.execute(
            "SELECT user_id,available FROM wallet_provider_positions "
            "WHERE provider='aura' AND asset=?", (asset,),
        ):
            backing[row["user_id"]] = backing.get(row["user_id"], D(0)) + D(row["available"])
        for row in ledger.db.execute(
            "SELECT user_id,available,reserved FROM wallet_balances WHERE asset=?", (asset,),
        ):
            available = D(row["available"])
            liabilities += available + D(row["reserved"]) - min(available, backing.get(row["user_id"], D(0)))
        if platform < liabilities + credit:
            raise error(
                "GOSWAP_RESERVE_INSUFFICIENT",
                "Свободного резерва GoSwap недостаточно для этого начисления.",
                409,
            )


async def finance_route(
    request, action, uid, admin, ledger, provider, money, ApiError,
    audit_callback=None, aura_test_client=None,
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
        if not isinstance(body, dict) or set(body) - {"account_id", "asset", "amount", "reason", "bucket", "confirm", "source"}:
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
        source = body.get("source", "default")
        if source not in ("default", "goswap"):
            raise ValueError("Invalid correction source")
        confirmation = f"ADJUST {target} {asset} {confirmation_amount}"
        if source == "goswap":
            confirmation += " GOSWAP"
        if body.get("confirm") != confirmation:
            raise ApiError(
                "CONFIRMATION_REQUIRED",
                "Подтвердите корректировку баланса точной контрольной строкой",
                409,
            )
        bucket = body.get("bucket", "available")
        goswap_credit = source == "goswap"
        if goswap_credit and (bucket != "available" or amount <= 0):
            raise ValueError("GoSwap source supports positive available credits only")
        test_backing = not goswap_credit and aura_test_client is not None and aura_test_client.environment == "test" and asset == "USDT" and bucket == "available"
        platform = None
        if test_backing and amount > 0:
            from wallet_aura import _platform_balance
            platform = _platform_balance(await aura_test_client.get_balance())
        if goswap_credit:
            balances = await provider.call("getBalance")
            platform = next((D(str(row["available"])) for row in balances if row["currency_code"] == asset), D(0))
            if not platform.is_finite() or platform < 0:
                raise ValueError("Invalid GoSwap balance")
        ledger.begin("admin_adjustment", uid, reason)
        try:
            if goswap_credit:
                require_goswap_credit_reserve(ledger, asset, amount, platform, ApiError)
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
                    json.dumps({"reason": reason, "actor": uid, "bucket": bucket, "source": "goswap" if goswap_credit else "aura_test" if test_backing else "ledger"}),
                ),
            )
            if test_backing:
                try:apply_aura_test_backing(ledger,target,amount,key,uid,platform)
                except TestBackingUnavailable:
                    raise ApiError('AURA_TEST_RESERVE_INSUFFICIENT','Недостаточно свободного тестового резерва Aura. Корректировка отменена.',409)
            if audit_callback:
                audit_callback(
                    uid, "balance.adjust", target,
                    detail={
                        "asset": asset, "amount": str(amount), "bucket": bucket,
                        "before": str(before), "after": str(after),
                        "event_id": key, "reason_characters": len(reason), "source": source,
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
