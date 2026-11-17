"""Add owned-wallet routes to an existing release without replacing its backend."""
import ast
import sys
from pathlib import Path


def patch(source):
    if 'from wallet_custody import' in source:
        return source
    replacements = [
        ('import asyncio\n', 'import asyncio\nfrom wallet_custody import Custody, custody_route, prepare as prepare_custody\nfrom wallet_chain import ChainReader\n'),
        ("'AURA_API_KEY', 'AURA_ENVIRONMENT', 'AURA_BASE_URL',", "'WPAY_CUSTODY_ENABLED', 'WPAY_CUSTODY_CHAIN_ENV', 'WPAY_CUSTODY_PUBLIC_KEY_FILE',\n                    'AURA_API_KEY', 'AURA_ENVIRONMENT', 'AURA_BASE_URL',"),
        ('    prepare_notifications(ledger)\n', '''    prepare_notifications(ledger)
    prepare_custody(ledger)
    custody = Custody(
        ledger, ApiError,
        enabled=os.environ.get('WPAY_CUSTODY_ENABLED', '0') == '1',
        public_key_file=os.environ.get('WPAY_CUSTODY_PUBLIC_KEY_FILE', ''),
        chain_env=os.environ.get('WPAY_CUSTODY_CHAIN_ENV', 'testnet'),
    )
    app['wpay_custody'] = custody
    app['wpay_chain'] = ChainReader(ledger, ApiError)
'''),
        ("            if action == 'profile-avatar' and request.method == 'GET':", "            custody_response = await custody_route(request, action, uid, custody)\n            if custody_response is not None:\n                return custody_response\n            if action == 'profile-avatar' and request.method == 'GET':"),
        ('        await aura_client.close()\n', "        await app['wpay_chain'].close()\n        await aura_client.close()\n"),
    ]
    for before, after in replacements:
        if source.count(before) != 1:
            raise ValueError('Backend anchor missing or ambiguous: ' + before[:70])
        source = source.replace(before, after, 1)
    ast.parse(source)
    return source


if __name__ == '__main__':
    target = Path(sys.argv[1]) / 'wallet_backend.py'
    original = target.read_text()
    updated = patch(original)
    if updated != original:
        mode = target.stat().st_mode & 0o777
        target.unlink()  # Release files may be hardlinks.
        target.write_text(updated)
        target.chmod(mode)
    print('Owned wallet routes installed')
