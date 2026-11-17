"""Minimal integration on an existing release; preserves unrelated backend changes."""
import ast
import sys
from pathlib import Path


def patch(source):
    if 'from wallet_exchange_funding import Funding' in source:
        return source
    changes = [
        ('import asyncio\n', 'import asyncio\nfrom wallet_exchange_funding import Funding\n'),
        ("'FIXEDFLOAT_API_KEY', 'FIXEDFLOAT_API_SECRET', 'WPAY_FIXEDFLOAT_ORDERS_ENABLED',", "'FIXEDFLOAT_API_KEY', 'FIXEDFLOAT_API_SECRET', 'WPAY_FIXEDFLOAT_ORDERS_ENABLED', 'WPAY_WALLET_FUNDING_ENABLED',"),
        ("    app['wpay_custody'] = custody\n", "    app['wpay_custody'] = custody\n    exchange_funding = Funding(ledger, exchange_orders, custody, enabled=os.environ.get('WPAY_WALLET_FUNDING_ENABLED','0') == '1')\n    app['wpay_exchange_funding'] = exchange_funding\n"),
        ('            order_response = await exchange_orders.route(request, action, uid)', '            funding_response = await exchange_funding.route(request, action, uid)\n            if funding_response is not None:return funding_response\n            order_response = await exchange_orders.route(request, action, uid)'),
    ]
    for before, after in changes:
        if source.count(before) != 1:
            raise ValueError('Funding integration anchor missing')
        source = source.replace(before, after, 1)
    ast.parse(source)
    return source


if __name__ == '__main__':
    path = Path(sys.argv[1]) / 'wallet_backend.py'
    before = path.read_text(); after = patch(before)
    if before != after:
        mode = path.stat().st_mode & 0o777
        path.unlink(); path.write_text(after); path.chmod(mode)
    print('Custody funding installed; unrelated backend preserved')
