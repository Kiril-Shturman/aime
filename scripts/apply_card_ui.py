"""Patch card integration into a release without replacing unrelated backend work."""
import ast
import sys
from pathlib import Path


def backend(source):
    if 'from wallet_card_ui import CardUI' in source:
        return source
    changes = [
        ('import asyncio\n','import asyncio\nfrom wallet_card_ui import CardUI\n'),
        ('    aura_service = AuraService(ledger, aura_client, aura_environment)\n',
         '    aura_service = AuraService(ledger, aura_client, aura_environment)\n    card_ui = CardUI(ledger, aura_service, enabled=aura_enabled)\n    app["wpay_card_ui"] = card_ui\n'),
        ("            if action == 'profile-avatar' and request.method == 'GET':",'            card_response = await card_ui.route(request, action, uid, client_ref)\n            if card_response is not None:\n                return card_response\n            if action == \'profile-avatar\' and request.method == \'GET\':'),
    ]
    for before,after in changes:
        if source.count(before) != 1:raise ValueError('Card backend anchor missing: '+before[:60])
        source=source.replace(before,after,1)
    # Current deployed route already has plan support. Older source clients keep parity.
    source=source.replace("allowed = {'kind', 'shipping_address'}", "allowed = {'kind', 'shipping_address', 'plan_id'}")
    marker="                    shipping_address=body.get('shipping_address'),\n                ))"
    if marker in source:source=source.replace(marker,"                    shipping_address=body.get('shipping_address'),\n                    plan_id=body.get('plan_id'),\n                ))",1)
    ast.parse(source)
    return source


def aura(source):
    if 'price_guard=None' in source:return source
    source=source.replace('calculate as calculate_tariff, resolve_card_plan','calculate as calculate_tariff, resolve_card_plan, prepare as prepare_tariffs',1)
    source=source.replace('def prepare(ledger):\n','def prepare(ledger):\n    prepare_tariffs(ledger)\n',1)
    changes=[
      ('idempotency_key, shipping_address=None, plan_id=None):','idempotency_key, shipping_address=None, plan_id=None, price_guard=None):'),
      ('amount=None, amount_spend=None):\n        card_id = _safe_identifier', 'amount=None, amount_spend=None, price_guard=None):\n        card_id = _safe_identifier'),
      ('            fee = provider_fee + service_fee\n','            fee = provider_fee + service_fee\n            if price_guard: price_guard(fee, tariff.get("version_id"))\n'),
      ('            reserve_amount += service_fee\n','            reserve_amount += service_fee\n            if price_guard: price_guard(reserve_amount, tariff.get("version_id"))\n'),
    ]
    for before,after in changes:
        if source.count(before)!=1:raise ValueError('Card service anchor missing: '+before[:65])
        source=source.replace(before,after,1)
    for label in ['aura_card_reserve','aura_card_recharge_reserve']:
        before=f'            available, reserved = self.ledger.balance(uid, "USDT")\n            self.ledger.begin("{label}", uid, idempotency_key)\n            try:\n'
        after=f'            self.ledger.begin("{label}", uid, idempotency_key)\n            try:\n                available, reserved = self.ledger.balance(uid, "USDT")\n'
        if source.count(before)!=1:raise ValueError('Card reservation anchor missing')
        source=source.replace(before,after,1)
    ast.parse(source)
    return source


if __name__=='__main__':
    root=Path(sys.argv[1])
    for name, fn in [('wallet_backend.py',backend),('wallet_aura.py',aura)]:
        p=root/name;before=p.read_text();after=fn(before)
        if before!=after:
            mode=p.stat().st_mode & 0o777;p.unlink();p.write_text(after);p.chmod(mode)
    print('Card UI integration installed; unrelated backend preserved')
