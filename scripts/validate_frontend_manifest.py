"""Reject stale manifests before packaging a production frontend."""
import json
import re
from pathlib import Path

root=Path('static')
manifest=json.loads((root/'.vite/manifest.json').read_text())
files=set()
for item in manifest.values():
    files.update([item['file'],*item.get('css',[]),*item.get('assets',[])])
refs=re.findall(r'(?:src|href)="/([^"?#]+)',(root/'index.html').read_text())
entries=[ref for ref in refs if ref.startswith('assets/') and ref.endswith(('.js','.css'))]
if not entries or any(ref not in files or not(root/ref).is_file() for ref in entries):
    raise SystemExit('Frontend manifest does not match index.html. Rebuild with --manifest after the final frontend change.')
if any(not(root/name).is_file() for name in files):
    raise SystemExit('Frontend manifest references missing files')
print('Frontend entry files match the packaging manifest')
