"""Restore quote-only FixedFloat routes while preserving the live backend."""
import ast
import sys
from pathlib import Path


def patch(source):
    if 'from wallet_fixedfloat import' in source:
        return source
    changes = [
        ('import asyncio\n', 'import asyncio\nfrom wallet_fixedfloat import FixedFloat, exchange_route, prepare_exchange_limits\n'),
        ("'AURA_API_KEY', 'AURA_ENVIRONMENT', 'AURA_BASE_URL',", "'FIXEDFLOAT_API_KEY', 'FIXEDFLOAT_API_SECRET',\n                    'AURA_API_KEY', 'AURA_ENVIRONMENT', 'AURA_BASE_URL',"),
        ('    prepare_notifications(ledger)\n', "    prepare_notifications(ledger)\n    prepare_exchange_limits(ledger)\n    exchange = FixedFloat(os.environ.get('FIXEDFLOAT_API_KEY', ''), os.environ.get('FIXEDFLOAT_API_SECRET', ''), ApiError)\n    exchange.ledger = ledger\n    app['wpay_exchange'] = exchange\n"),
        ("            if action == 'profile-avatar' and request.method == 'GET':", "            exchange_response = await exchange_route(request, action, uid, exchange)\n            if exchange_response is not None:\n                return exchange_response\n            if action == 'profile-avatar' and request.method == 'GET':"),
        ('        await aura_client.close()\n', '        await exchange.close()\n        await aura_client.close()\n'),
    ]
    for before, after in changes:
        if source.count(before) != 1:
            raise ValueError('Missing/ambiguous backend anchor: ' + before[:60])
        source = source.replace(before, after, 1)
    ast.parse(source)
    return source


if __name__ == '__main__':
    path = Path(sys.argv[1]) / 'wallet_backend.py'
    before = path.read_text()
    after = patch(before)
    if after != before:
        mode = path.stat().st_mode & 0o777
        path.unlink()
        path.write_text(after)
        path.chmod(mode)
    print('FixedFloat quote routes installed; existing backend preserved')
