"""Private SSH bridge for the separate signer. Never mounted as a web route."""
import base64
import json
import sqlite3
import time


def bridge(db,body):
    worker=body.get('worker_id')
    if not isinstance(worker,str) or not 8<=len(worker)<=100:raise ValueError('Invalid worker')
    op=body.get('op')
    if op in {'export-claim','export-complete'}:
        from wallet_key_export import bridge as export_bridge
        return export_bridge(db,body)
    if op=='heartbeat':
        networks=body['networks']
        if not isinstance(networks,list) or set(networks)-{'BSC','ETH','TRON','BNB_WITHDRAWAL'}:raise ValueError('Invalid networks')
        db.execute('INSERT OR REPLACE INTO custody_signer_status VALUES (?,?,?,?)',(worker,json.dumps(networks),body['key_id'],time.time()))
        return {'ok':True}
    if op=='claim':
        db.execute('BEGIN IMMEDIATE')
        try:
            db.execute("UPDATE custody_funding_jobs SET state='expired',error='QUOTE_EXPIRED' WHERE state='quoted' AND json_extract(quote,'$.expires_at')<?",(time.time(),))
            row=db.execute("""
                SELECT * FROM custody_funding_jobs j
                WHERE state IN ('estimating','confirmed','signing','signed','broadcast','unknown')
                AND lease_until<=? AND next_attempt_at<=?
                AND (? OR NOT EXISTS (SELECT 1 FROM custody_withdrawal_intents w WHERE w.job_id=j.id))
                ORDER BY next_attempt_at,created_at LIMIT 1
            """,(time.time(),time.time(),body.get('native_bnb') is True)).fetchone()
            if not row:db.execute('COMMIT');return {'job':None}
            db.execute("UPDATE custody_funding_jobs SET worker_id=?,lease_until=?,state=CASE WHEN state='confirmed' THEN 'signing' ELSE state END WHERE id=?",(worker,time.time()+120,row['id']))
            db.execute('COMMIT')
        except Exception:db.execute('ROLLBACK');raise
        row=db.execute('SELECT * FROM custody_funding_jobs WHERE id=?',(row['id'],)).fetchone()
        wallet=dict(db.execute('SELECT * FROM custody_wallets WHERE id=? AND user_id=?',(row['wallet_id'],row['user_id'])).fetchone())
        wallet['encrypted_secret']=base64.b64encode(wallet['encrypted_secret']).decode()
        withdrawal=db.execute('SELECT * FROM custody_withdrawal_intents WHERE job_id=?',(row['id'],)).fetchone()
        if withdrawal:
            return {'job':dict(row),'wallet':wallet,'withdrawal':dict(withdrawal)}
        order=dict(db.execute('SELECT * FROM fixedfloat_order_intents WHERE id=? AND user_id=?',(row['intent_id'],row['user_id'])).fetchone())
        return {'job':dict(row),'wallet':wallet,'order':order}
    row=db.execute('SELECT * FROM custody_funding_jobs WHERE id=? AND worker_id=?',(body.get('job_id'),worker)).fetchone()
    if not row:raise ValueError('Unowned worker job')
    if op=='quote':
        quote=body['quote']
        if not isinstance(quote,dict) or len(json.dumps(quote))>16384 or not isinstance(quote.get('expires_at'),(int,float)) or quote['expires_at']<=time.time() or quote['expires_at']>time.time()+120:raise ValueError('Invalid quote')
        if row['state']=='estimating':
            db.execute("UPDATE custody_funding_jobs SET state='quoted',quote=?,updated_at=?,lease_until=0,error=NULL WHERE id=? AND state='estimating'",(json.dumps(quote),time.time(),row['id']))
        return {'ok':True}
    if op=='signed':
        if row['state'] not in {'signing','signed','broadcast','unknown'}:raise ValueError('Not approved')
        if not isinstance(body.get('payload'),dict) or len(json.dumps(body['payload']))>16384 or not isinstance(body.get('tx_hash'),str) or len(body['tx_hash']) not in {64,66}:raise ValueError('Invalid signed transaction')
        db.execute("UPDATE custody_funding_jobs SET state='signed',signed_payload=?,tx_hash=?,updated_at=? WHERE id=? AND signed_payload IS NULL",(json.dumps(body['payload']),body['tx_hash'],time.time(),row['id']))
        stored=db.execute('SELECT signed_payload,tx_hash FROM custody_funding_jobs WHERE id=?',(row['id'],)).fetchone()
        return {'payload':json.loads(stored['signed_payload']),'tx_hash':stored['tx_hash']}
    if op=='status':
        state=body['state'];error=body.get('error')
        if state not in {'failed','expired','broadcast','unknown','done'}:raise ValueError('Invalid signer state')
        if error not in {None,'NO_FUNDS','NO_GAS','RPC_UNAVAILABLE','ORDER_NOT_PAYABLE','QUOTE_EXPIRED','KEY_UNAVAILABLE','TX_FAILED','OUTCOME_UNKNOWN','SIGNER_ERROR'}:raise ValueError('Invalid error')
        if state in {'done','broadcast','unknown'} and not row['signed_payload']:raise ValueError('No signed transaction')
        if row['state'] in {'cancelled','done','failed','expired'}:return {'ok':True}
        if state in {'failed','expired'} and row['signed_payload'] and error not in {'TX_FAILED'}:
            state='unknown';error='OUTCOME_UNKNOWN'
        db.execute("UPDATE custody_funding_jobs SET state=?,error=?,updated_at=?,lease_until=0,next_attempt_at=? WHERE id=? AND state NOT IN ('done','cancelled','failed','expired')",(state,error,time.time(),time.time()+15,row['id']))
        return {'ok':True}
    raise ValueError('Unsupported bridge operation')
