#!/usr/bin/env python3
"""Root-only, stdin/stdout SSH RPC. No server private key or signing capability."""
import json
import os
import sqlite3
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from wallet_signer_bridge import bridge

if __name__=='__main__':
    try:
        if os.geteuid()!=0:raise PermissionError('root only')
        raw=sys.stdin.buffer.read(262145)
        if len(raw)>262144:raise ValueError('Too large')
        body=json.loads(raw)
        db=sqlite3.connect(sys.argv[1],isolation_level=None,timeout=30);db.row_factory=sqlite3.Row
        result=bridge(db,body);db.close()
        print(json.dumps(result,separators=(',',':')))
    except Exception:
        print(json.dumps({'ok':False,'error':'SIGNER_BRIDGE_ERROR'}));sys.exit(1)
