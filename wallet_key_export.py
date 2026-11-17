"""Short-lived, owner-only encrypted key export. Recovery keys stay off the web host."""
import base64
import json
import re
import time
import uuid
from urllib.parse import parse_qs
from aiohttp import web


def prepare(ledger):
    ledger.db.executescript('''
        CREATE TABLE IF NOT EXISTS custody_key_exports (
            id TEXT PRIMARY KEY,user_id TEXT NOT NULL,wallet_id TEXT NOT NULL,
            public_key TEXT NOT NULL,state TEXT NOT NULL,created_at REAL NOT NULL,
            expires_at REAL NOT NULL,lease_until REAL NOT NULL DEFAULT 0,
            worker_id TEXT,ciphertext TEXT,error TEXT
        );
        CREATE INDEX IF NOT EXISTS custody_key_export_owner ON custody_key_exports(user_id,created_at);
    ''')


def fresh(request, uid, error):
    # Called only AFTER the normal Telegram HMAC validation and identity check.
    if not uid.startswith('tg:'):
        raise error('FRESH_TELEGRAM_AUTH_REQUIRED','Для экспорта откройте кошелёк заново из Telegram',403)
    try:
        dates=parse_qs(request.headers.get('X-Telegram-Init-Data',''))['auth_date']
        if len(dates)!=1:raise ValueError('Duplicate auth date')
        stamp=int(dates[0])
    except (ValueError,KeyError,IndexError):
        stamp=0
    if not 0 <= time.time()-stamp <= 120:
        raise error('FRESH_TELEGRAM_AUTH_REQUIRED','Закройте миниапку и откройте её заново из Telegram, затем повторите экспорт',403)


def cleanup(db):
    db.execute("UPDATE custody_key_exports SET state='expired',ciphertext=NULL,public_key='' WHERE expires_at<=? AND state NOT IN ('consumed','expired')",(time.time(),))


async def _route(request, action, uid, custody):
    if action not in {'custody-export-prepare','custody-export-status','custody-export-reveal'}:
        return None
    error=custody.error;db=custody.ledger.db
    fresh(request,uid,error)
    if not custody.configured:raise error('CUSTODY_NOT_CONFIGURED','Кошельки недоступны',503)
    cleanup(db)
    headers={'Cache-Control':'no-store, private','Pragma':'no-cache','Referrer-Policy':'no-referrer'}
    if action=='custody-export-status':
        if request.method!='GET' or set(request.query)!={'job_id'}:raise ValueError('Only export job accepted')
        body=dict(request.query)
    else:
        if request.method!='POST':raise error('METHOD_NOT_ALLOWED','Неверный метод',405)
        body=await request.json()
        if not isinstance(body,dict):raise ValueError('Invalid export request')
    if action=='custody-export-prepare':
        if set(body)!={'wallet_id','public_key','acknowledged'} or body['acknowledged'] is not True:raise ValueError('Explicit export confirmation required')
        if not isinstance(body['wallet_id'],str) or not re.fullmatch('[a-f0-9]{32}',body['wallet_id']):raise ValueError('Invalid wallet')
        if not isinstance(body['public_key'],str) or not 500<=len(body['public_key'])<=1000:raise ValueError('Invalid recipient key')
        try:base64.b64decode(body['public_key'],validate=True)
        except Exception:raise ValueError('Invalid recipient key') from None
        wallet=db.execute('SELECT * FROM custody_wallets WHERE id=? AND user_id=?',(body['wallet_id'],uid)).fetchone()
        if not wallet:raise error('NOT_FOUND','Кошелёк не найден',404)
        if wallet['network'] not in {'ETH','BSC'}:raise error('EXPORT_NOT_SUPPORTED','Экспорт для этой сети пока не подключён',400)
        online=db.execute('SELECT 1 FROM custody_signer_status WHERE key_id=? AND heartbeat_at>?',(wallet['key_id'],time.time()-45)).fetchone()
        if not online:raise error('SIGNER_UNAVAILABLE','Защищённый процесс временно недоступен',503)
        custody.ledger.begin('key_export_request',uid,wallet['id'])
        try:
            count=db.execute('SELECT count(*) FROM custody_key_exports WHERE user_id=? AND created_at>?',(uid,time.time()-600)).fetchone()[0]
            if count>=3:raise error('RATE_LIMITED','Не более трёх экспортов за 10 минут',429)
            identifier=uuid.uuid4().hex;stamp=time.time()
            db.execute('INSERT INTO custody_key_exports(id,user_id,wallet_id,public_key,state,created_at,expires_at) VALUES (?,?,?,?,?,?,?)',(identifier,uid,wallet['id'],body['public_key'],'pending',stamp,stamp+90))
            db.execute('INSERT INTO custody_activity VALUES (?,?,?,?,?)',(uuid.uuid4().hex,wallet['id'],uid,'key_export_requested',stamp))
            custody.ledger.commit()
        except Exception:custody.ledger.rollback();raise
        return web.json_response({'job_id':identifier,'state':'pending'},headers=headers)
    if set(body)!={'job_id'} or not isinstance(body['job_id'],str) or not re.fullmatch('[a-f0-9]{32}',body['job_id']):raise ValueError('Invalid export job')
    row=db.execute('SELECT * FROM custody_key_exports WHERE id=? AND user_id=?',(body['job_id'],uid)).fetchone()
    if not row:raise error('NOT_FOUND','Экспорт не найден',404)
    if action=='custody-export-status':
        return web.json_response({'job_id':row['id'],'state':row['state']},headers=headers)
    custody.ledger.begin('key_export_delivered',uid,row['wallet_id'])
    try:
        row=db.execute('SELECT * FROM custody_key_exports WHERE id=? AND user_id=?',(body['job_id'],uid)).fetchone()
        if row['state']!='ready' or row['expires_at']<=time.time():raise error('EXPORT_NOT_READY','Экспорт недоступен или уже получен. Начните заново',409)
        ciphertext=row['ciphertext']
        db.execute("UPDATE custody_key_exports SET state='consumed',ciphertext=NULL,public_key='' WHERE id=?",(row['id'],))
        db.execute('INSERT INTO custody_activity VALUES (?,?,?,?,?)',(uuid.uuid4().hex,row['wallet_id'],uid,'key_export_delivered',time.time()))
        custody.ledger.commit()
    except Exception:custody.ledger.rollback();raise
    return web.json_response({'job_id':row['id'],'ciphertext':ciphertext},headers=headers)


def bridge(db, body):
    """Called by the existing root-only SSH bridge, not by a public HTTP route."""
    worker=body['worker_id']
    if body['op']=='export-claim' and not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='custody_key_exports'").fetchone():return {'job':None}
    cleanup(db)
    if body['op']=='export-claim':
        db.execute('BEGIN IMMEDIATE')
        try:
            row=db.execute("SELECT * FROM custody_key_exports WHERE state IN ('pending','processing') AND lease_until<=? AND expires_at>? ORDER BY created_at LIMIT 1",(time.time(),time.time())).fetchone()
            if not row:db.execute('COMMIT');return {'job':None}
            db.execute("UPDATE custody_key_exports SET state='processing',worker_id=?,lease_until=? WHERE id=?",(worker,time.time()+30,row['id']))
            wallet=db.execute('SELECT * FROM custody_wallets WHERE id=? AND user_id=?',(row['wallet_id'],row['user_id'])).fetchone()
            if not wallet or wallet['network'] not in {'ETH','BSC'}:raise ValueError('Invalid export wallet')
            db.execute('COMMIT')
        except Exception:db.execute('ROLLBACK');raise
        wallet=dict(wallet);wallet['encrypted_secret']=base64.b64encode(wallet['encrypted_secret']).decode()
        return {'job':dict(row),'wallet':wallet}
    if body['op']=='export-complete':
        ciphertext=body.get('ciphertext')
        if ciphertext is not None:
            if not isinstance(ciphertext,str) or len(base64.b64decode(ciphertext,validate=True))!=384:raise ValueError('Invalid encrypted export')
        db.execute("UPDATE custody_key_exports SET state=?,ciphertext=?,error=? WHERE id=? AND worker_id=? AND state='processing' AND expires_at>?",('ready' if ciphertext else 'failed',ciphertext,None if ciphertext else 'EXPORT_FAILED',body['job_id'],worker,time.time()))
        return {'ok':True}
    raise ValueError('Invalid export operation')


async def route(request, action, uid, custody):
    if action not in {'custody-export-prepare','custody-export-status','custody-export-reveal'}:return None
    headers={'Cache-Control':'no-store, private','Pragma':'no-cache','Referrer-Policy':'no-referrer'}
    try:
        return await _route(request,action,uid,custody)
    except Exception as error:
        if hasattr(error,'name') and hasattr(error,'status'):
            from wallet_aura_errors import wallet_error_payload
            if error.retry_after:headers['Retry-After']=str(error.retry_after)
            return web.json_response(wallet_error_payload(error),status=error.status,headers=headers)
        if isinstance(error,(ValueError,KeyError,TypeError)):
            return web.json_response({'ok':False,'error':{'name':'INVALID_REQUEST'},'detail':'Некорректный запрос экспорта'},status=400,headers=headers)
        raise
