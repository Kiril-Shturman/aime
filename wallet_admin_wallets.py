"""Read-only wallet inventory for a user's admin card."""

import asyncio
import json
from decimal import Decimal

from wallet_chain import ASSET_NETWORKS
from wallet_operations import goswap_network_balances


async def user_wallet_inventory(ledger, chain, user_id):
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
            "network": address["network"], "address": address["address"],
            "available": (address["available"] or "0") if first else None,
            "reserved": (address["reserved"] or "0") if first else None,
            "balance_scope": "provider",
        })

    own = list(ledger.db.execute("""
        SELECT w.id,w.network,w.chain_env,w.address,h.wallet_id IS NOT NULL AS hidden
        FROM custody_wallets w LEFT JOIN custody_hidden h ON h.wallet_id=w.id AND h.user_id=w.user_id
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
            "available": result.get("amount"), "reserved": None, "balance_scope": "onchain",
        }

    rows.extend(await asyncio.gather(*(
        observe(dict(wallet), asset) for wallet in own
        for asset, networks in ASSET_NETWORKS.items()
        if wallet["network"] in networks and asset != "TON"
        and (wallet["chain_env"] == "mainnet" or asset not in {"USDT", "XAUT"})
    )))
    return rows
