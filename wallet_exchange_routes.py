"""Routing policy for exchange between wPay balances and on-chain wallets."""
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from decimal import Decimal

from wallet_operations import goswap_network_balances


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
        "execution_enabled": method == "internal",
    }


def internal_exchange(ledger, uid, body, key, enabled, provider, error):
    fields = {"from_asset", "from_network", "to_asset", "to_network", "amount"}
    if not isinstance(body, dict) or set(body) != fields or any(not isinstance(value, str) for value in body.values()):
        raise ValueError("Некорректные параметры обмена")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{16,80}", key):
        raise ValueError("Укажите идентификатор операции")
    if not re.fullmatch(r"[0-9]{1,12}(?:\.[0-9]{1,6})?", body["amount"]) or Decimal(body["amount"]) <= 0:
        raise ValueError("Укажите положительную сумму USDT с точностью до 6 знаков")
    amount = Decimal(body["amount"])
    source, destination = body["from_network"], body["to_network"]
    if source not in {"ETH", "BSC", "SOL", "TON", "TRON"} or destination not in {"ETH", "BSC", "SOL", "TON", "TRON"}:
        raise ValueError("Неизвестная сеть USDT")
    if body["from_asset"] != "USDT" or body["to_asset"] != "USDT":
        raise ValueError("Внутренний обмен доступен для USDT")
    detail = {"amount": format(amount.normalize(), "f"), "from_network": source, "to_network": destination}
    event_id = "goswap:exchange:" + hashlib.sha256(f"{uid}:{key}".encode()).hexdigest()
    ledger.begin("goswap_network_exchange", uid, event_id)
    try:
        existing = ledger.db.execute(
            "SELECT detail FROM wallet_events WHERE event_id=? AND user_id=?", (event_id, uid),
        ).fetchone()
        if existing:
            if json.loads(existing[0]) != detail:
                raise error("IDEMPOTENCY_CONFLICT", "Для этой операции уже сохранена другая сумма или сеть", 409)
        else:
            if resolve(ledger, body, enabled, provider)["method"] != "internal":
                raise error("EXCHANGE_UNAVAILABLE", "Внутренний маршрут отключён", 409)
            debt = ledger.db.execute(
                "SELECT amount FROM wallet_debts WHERE user_id=? AND asset='USDT'", (uid,),
            ).fetchone()
            available = goswap_network_balances(ledger, uid, "USDT").get(source, Decimal(0))
            if amount > available or (debt and Decimal(debt[0]) > 0):
                raise error("INSUFFICIENT_FUNDS", "Недостаточно доступных USDT в исходной сети", 409)
            ledger.db.execute(
                "INSERT INTO wallet_events VALUES (?,?,?,?,?,?,?)",
                (event_id, uid, "USDT", "0", "exchange_internal",
                 datetime.now(timezone.utc).isoformat(), json.dumps(detail)),
            )
        balances = goswap_network_balances(ledger, uid, "USDT")
        ledger.commit()
    except Exception:
        ledger.rollback()
        raise
    return {"status": "completed", "received": detail["amount"],
            "balances": {network: str(value) for network, value in balances.items()}}
