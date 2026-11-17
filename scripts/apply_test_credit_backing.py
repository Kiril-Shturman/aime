"""Patch only the admin correction call on the current backend."""
import ast,sys
from pathlib import Path


def patch(source):
    line="                aura_test_client=aura_client if aura_enabled and aura_environment == 'test' else None,\n"
    if line in source:return source
    anchor='                audit_callback=record_admin_action,\n'
    if source.count(anchor)!=1:raise ValueError('Admin finance anchor missing')
    source=source.replace(anchor,anchor+line,1);ast.parse(source);return source


if __name__=='__main__':
    p=Path(sys.argv[1])/'wallet_backend.py';before=p.read_text();after=patch(before)
    if before!=after:
        mode=p.stat().st_mode&0o777;p.unlink();p.write_text(after);p.chmod(mode)
    print('Test-only credit backing connected; other backend flows preserved')
