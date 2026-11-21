"""Read-only wallet inventory for a user's admin card."""

import asyncio
import json
import time
from decimal import Decimal

from wallet_chain import ASSET_NETWORKS
from wallet_operations import goswap_network_balances


async def user_wallet_inventory(ledger, chain, user_id, usdt_routes, aura_environment):
    rows = []
    goswap = list(ledger.db.execute(
        "SELECT body FROM wallet_addresses WHERE user_id=? ORDER BY network", (user_id,),
    ))
    if goswap:
        balances = goswap_network_balances(ledger, user_id, "USDT")
        for row in goswap:
            saved = json.loads(row["body"])
            network = saved["network"]
            for asset in saved.get("assets", [saved.get("asset", "USDT")]):
                rows.append({
                    "provider": "goswap", "environment": None,
                    "network": network, "asset": asset, "address": saved["address"],
                    "available": str(balances.get(network, Decimal(0))) if asset == "USDT" else None,
                    "reserved": None, "balance_scope": "network",
                })

    shown_aura = set()
    for address in ledger.db.execute("""
        SELECT a.address,a.environment,a.network,p.available,p.reserved
        FROM aura_deposit_addresses a
        LEFT JOIN wallet_provider_positions p ON p.user_id=a.user_id
          AND p.provider='aura' AND p.environment=a.environment AND p.asset='USDT'
        WHERE a.user_id=?
        ORDER BY a.environment,a.is_default DESC,a.created_at,a.address_id
    """, (user_id,)):
        first = address["environment"] not in shown_aura
        shown_aura.add(address["environment"])
        rows.append({
            "provider": "aura", "environment": address["environment"], "asset": "USDT",
            "network": "TRON", "chain": address["network"], "address": address["address"],
            "available": (address["available"] or "0") if first else None,
            "reserved": (address["reserved"] or "0") if first else None,
            "balance_scope": "provider",
        })

    own = list(ledger.db.execute("""
        SELECT w.id,w.network,w.chain_env,w.address,c.state,h.wallet_id IS NOT NULL AS hidden
        FROM custody_wallets w LEFT JOIN custody_hidden h ON h.wallet_id=w.id AND h.user_id=w.user_id
        LEFT JOIN custody_wallet_controls c ON c.wallet_id=w.id
        WHERE w.user_id=? ORDER BY w.chain_env,w.network
    """, (user_id,)))

    async def observe(wallet, asset):
        try:
            result = await asyncio.wait_for(chain.observe(wallet, asset), timeout=6)
        except asyncio.TimeoutError:
            result = {}
        return {
            "provider": "wpay", "environment": wallet["chain_env"], "network": wallet["network"],
            "asset": asset, "address": wallet["address"], "hidden": bool(wallet["hidden"]),
            "wallet_id": wallet["id"], "state": wallet["state"],
            "available": result.get("amount"), "reserved": None, "balance_scope": "onchain",
        }

    observations = await asyncio.gather(*(
        observe(dict(wallet), asset) for wallet in own
        for asset, networks in ASSET_NETWORKS.items()
        if wallet["network"] in networks and asset != "TON"
        and (wallet["chain_env"] == "mainnet" or asset not in {"USDT", "XAUT"})
    ))
    for row in observations:
        alternate_usdt = row["asset"] == "USDT" and usdt_routes.get(row["network"]) != "wpay"
        if alternate_usdt:
            if row["available"] is None or Decimal(row["available"]) == 0:
                continue
            row["balance_scope"] = "secondary_onchain"
        rows.append(row)

    present = {(row["provider"], row["network"]) for row in rows
               if row["asset"] == "USDT" and
               (row["provider"] != "aura" or row["environment"] == aura_environment)}
    for network, provider in usdt_routes.items():
        if (provider, network) in present:
            continue
        rows.append({
            "provider": provider, "network": network, "asset": "USDT", "address": None,
            "environment": aura_environment if provider == "aura" else None,
            "available": None, "reserved": None,
            "balance_scope": "onchain" if provider == "wpay" else "provider" if provider == "aura" else "network",
        })
    return rows

def control_wallet(ledger, uid, wallet_id, operation, actor, record, error):
    states = {"freeze": "frozen", "archive": "archived", "restore": None}
    if not isinstance(wallet_id, str) or len(wallet_id) != 32 or operation not in states:
        raise ValueError("Некорректное действие с кошельком")
    ledger.begin("admin_wallet_control", actor, operation)
    try:
        if not ledger.db.execute(
            "SELECT 1 FROM custody_wallets WHERE id=? AND user_id=?", (wallet_id, uid),
        ).fetchone():
            raise error("NOT_FOUND", "Кошелёк не найден", 404)
        state = states[operation]
        if state:
            active = ledger.db.execute(
                "SELECT 1 FROM custody_funding_jobs WHERE wallet_id=? "
                "AND state IN ('signing','signed','broadcast','unknown') LIMIT 1", (wallet_id,),
            ).fetchone()
            if active:
                raise error("PAYMENT_IN_PROGRESS", "Дождитесь результата текущего вывода", 409)
            ledger.db.execute(
                "UPDATE custody_funding_jobs SET state='cancelled',updated_at=? "
                "WHERE wallet_id=? AND state IN ('estimating','quoted','confirmed')",
                (time.time(), wallet_id),
            )
            ledger.db.execute(
                "UPDATE custody_key_exports SET state='expired',ciphertext=NULL,public_key='' "
                "WHERE wallet_id=? AND state IN ('pending','ready','processing')", (wallet_id,),
            )
            ledger.db.execute(
                "INSERT OR REPLACE INTO custody_wallet_controls VALUES (?,?,?)",
                (wallet_id, state, time.time()),
            )
        else:
            ledger.db.execute("DELETE FROM custody_wallet_controls WHERE wallet_id=?", (wallet_id,))
        record(actor, "wallet." + operation, uid, detail={"wallet_id": wallet_id, "state": state})
        ledger.commit()
        return {"ok": True, "state": state}
    except Exception:
        ledger.rollback()
        raise
