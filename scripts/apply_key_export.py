"""Install key export without replacing unrelated production backend code."""
import ast
import sys
from pathlib import Path


def patch(source):
    if 'from wallet_key_export import prepare as prepare_key_export' in source:return source
    changes=[
        ('import asyncio\n','import asyncio\nfrom wallet_key_export import prepare as prepare_key_export, route as key_export_route\n'),
        ("    app['wpay_custody'] = custody\n","    app['wpay_custody'] = custody\n    prepare_key_export(ledger)\n"),
        ('            custody_response = await custody_route(request, action, uid, custody)','            export_response = await key_export_route(request, action, uid, custody)\n            if export_response is not None:return export_response\n            custody_response = await custody_route(request, action, uid, custody)'),
    ]
    for before,after in changes:
        if source.count(before)!=1:raise ValueError('Export integration anchor missing')
        source=source.replace(before,after,1)
    ast.parse(source);return source


if __name__=='__main__':
    p=Path(sys.argv[1])/'wallet_backend.py';before=p.read_text();after=patch(before)
    if before!=after:
        mode=p.stat().st_mode & 0o777;p.unlink();p.write_text(after);p.chmod(mode)
    print('Owner key export installed; unrelated backend preserved')
