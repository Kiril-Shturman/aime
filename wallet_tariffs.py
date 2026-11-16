"""Append-only WPay service tariffs with deterministic operation snapshots."""
import time
import uuid
from decimal import Decimal, InvalidOperation, localcontext

PRODUCTS = {
    "card_virtual_issue": ("Выпуск виртуальной карты", True),
    "card_physical_issue": ("Выпуск физической карты", True),
    "card_virtual_recharge": ("Пополнение виртуальной карты", True),
    "card_physical_recharge": ("Пополнение физической карты", True),
    "sbp_buy": ("Покупка через СБП", False),
    "qr_pay": ("Оплата по QR", False),
    "withdrawal": ("Вывод криптовалюты (не с карты)", False),
}

def prepare(ledger):
    ledger.db.executescript("""
      CREATE TABLE IF NOT EXISTS wallet_tariff_versions (
        version_id TEXT PRIMARY KEY, product TEXT NOT NULL, enabled INTEGER NOT NULL,
        fixed_fee TEXT NOT NULL, percent_fee TEXT NOT NULL, minimum_fee TEXT NOT NULL,
        currency TEXT NOT NULL, note TEXT, created_at REAL NOT NULL, created_by TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS wallet_tariff_product_created
        ON wallet_tariff_versions(product,created_at DESC);
    """)

def _number(value, name, maximum=None):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError(f"Invalid {name}")
    if not result.is_finite() or result < 0 or (maximum is not None and result > maximum):
        raise ValueError(f"Invalid {name}")
    return result

def active(ledger, product):
    if product not in PRODUCTS:
        raise ValueError("Unknown tariff product")
    row = ledger.db.execute(
        "SELECT * FROM wallet_tariff_versions WHERE product=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
        (product,),
    ).fetchone()
    if not row:
        return {"version_id": None, "product": product, "enabled": False,
                "fixed_fee": "0", "percent_fee": "0", "minimum_fee": "0",
                "currency": "USDT", "note": None, "created_at": None, "created_by": None}
    result = dict(row)
    result["enabled"] = bool(result["enabled"])
    return result

def snapshot(ledger):
    items = []
    for product, (label, enforced) in PRODUCTS.items():
        item = active(ledger, product)
        item.update(label=label, enforced=enforced)
        items.append(item)
    history = [dict(row) for row in ledger.db.execute(
        "SELECT * FROM wallet_tariff_versions ORDER BY created_at DESC,rowid DESC LIMIT 200"
    )]
    for item in history:
        item["enabled"] = bool(item["enabled"])
    return {"items": items, "history": history}

def calculate(ledger, product, amount=0):
    tariff = active(ledger, product)
    if not tariff["enabled"] or not PRODUCTS[product][1]:
        return Decimal(0), tariff
    base = _number(amount, "tariff amount")
    fixed = _number(tariff["fixed_fee"], "fixed fee")
    percent = _number(tariff["percent_fee"], "percent fee", Decimal("100"))
    minimum = _number(tariff["minimum_fee"], "minimum fee")
    with localcontext() as ctx:
        ctx.prec = 80
        return max(minimum, fixed + base * percent / Decimal(100)), tariff

def create_version(ledger, product, *, enabled, fixed_fee, percent_fee,
                   minimum_fee, note, created_by):
    if product not in PRODUCTS:
        raise ValueError("Unknown tariff product")
    if type(enabled) is not bool:
        raise ValueError("Invalid tariff enabled flag")
    if enabled and not PRODUCTS[product][1]:
        raise ValueError("This tariff is not connected to settlement yet")
    fixed = _number(fixed_fee, "fixed fee")
    percent = _number(percent_fee, "percent fee", Decimal("100"))
    minimum = _number(minimum_fee, "minimum fee")
    note = str(note or "").strip()
    if len(note) > 300:
        raise ValueError("Tariff note is too long")
    version_id = uuid.uuid4().hex
    ledger.db.execute(
        "INSERT INTO wallet_tariff_versions VALUES (?,?,?,?,?,?,?,?,?,?)",
        (version_id, product, int(enabled), str(fixed), str(percent), str(minimum),
         "USDT", note or None, time.time(), str(created_by)),
    )
    return active(ledger, product)
