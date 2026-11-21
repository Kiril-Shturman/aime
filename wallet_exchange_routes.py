"""Routing policy for exchange between wPay balances and on-chain wallets."""
import time


RULES = {
    "goswap_internal": ("USDT между сетями GoSwap", ("internal", "disabled")),
    "aura_bridge": ("USDT между GoSwap и Aura", ("fixedfloat", "disabled")),
    "native_dex": ("Нативная монета → USDT GoSwap в той же сети", ("dex", "fixedfloat", "disabled")),
    "cross_chain": ("Обмен между сетями и BTC", ("fixedfloat", "disabled")),
}
NATIVE_NETWORK = {"ETH": "ETH", "BNB": "BSC", "SOL": "SOL", "GRAM": "TON"}


def prepare(ledger):
    ledger.db.execute("""
      CREATE TABLE IF NOT EXISTS wallet_exchange_rules (
        rule TEXT PRIMARY KEY, method TEXT NOT NULL, updated_at REAL NOT NULL, updated_by TEXT NOT NULL
      )
    """)


def rules(ledger):
    overrides = dict(ledger.db.execute("SELECT rule,method FROM wallet_exchange_rules"))
    return [
        {"id": key, "label": label, "method": overrides.get(key, methods[0]), "methods": methods}
        for key, (label, methods) in RULES.items()
    ]


def save_rule(ledger, body, actor):
    if not isinstance(body, dict) or body.keys() != {"rule", "method"}:
        raise ValueError("Укажите правило и способ обмена")
    rule, method = body["rule"], body["method"]
    if not isinstance(rule, str) or rule not in RULES or method not in RULES[rule][1]:
        raise ValueError("Этот способ недоступен для выбранного правила")
    ledger.db.execute(
        "INSERT INTO wallet_exchange_rules VALUES (?,?,?,?) ON CONFLICT(rule) DO UPDATE "
        "SET method=excluded.method,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
        (rule, method, time.time(), actor),
    )


def classify(source, destination, provider):
    asset, network = source
    out_asset, out_network = destination
    if source == destination:
        return None
    if asset == out_asset == "USDT":
        providers = {provider(*source), provider(*destination)}
        if providers == {"goswap"}:
            return "goswap_internal"
        if providers == {"goswap", "aura"}:
            return "aura_bridge"
    if (out_asset == "USDT" and NATIVE_NETWORK.get(asset) == network == out_network
            and provider(*source) == "wpay" and provider(*destination) == "goswap"):
        return "native_dex"
    if out_asset == "USDT" and (asset in NATIVE_NETWORK or asset == "BTC" or asset == "USDT"):
        return "cross_chain"
    return None


def resolve(ledger, query, enabled, provider):
    source = (query.get("from_asset", "").upper(), query.get("from_network", "").upper())
    destination = (query.get("to_asset", "").upper(), query.get("to_network", "").upper())
    rule = classify(source, destination, provider) if enabled(*source) and enabled(*destination) else None
    selected = next((item for item in rules(ledger) if item["id"] == rule), None)
    method = selected["method"] if selected else "disabled"
    return {
        "method": method,
        "rule": rule,
        "execution_enabled": False,
    }
