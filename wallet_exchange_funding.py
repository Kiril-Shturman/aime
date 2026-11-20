"""User-approved custody payment jobs. Private keys and broadcasts live in the isolated signer."""
import json
import re
import time
import uuid
from aiohttp import web

NETWORKS={'BSC':'BNB','ETH':'ETH','TRON':'TRX'}
CUSTODY_WITHDRAWAL_NETWORKS = {"BNB": "BSC", "ETH": "ETH", "XAUT": "ETH", "TRX": "TRON", "SOL": "SOL", "BTC": "BTC", "GRAM": "TON"}
CUSTODY_WITHDRAWAL_CAPABILITIES = {
    "BNB": "BNB_WITHDRAWAL", "ETH": "ETH_WITHDRAWAL",
    "XAUT": "XAUT_WITHDRAWAL", "TRX": "TRX_WITHDRAWAL", "SOL": "SOL_WITHDRAWAL", "BTC": "BTC_WITHDRAWAL", "GRAM": "GRAM_WITHDRAWAL",
}
ACTIVE={'estimating','quoted','confirmed','signing','signed','broadcast','unknown'}
ERRORS={
 'NO_FUNDS':'На собственном адресе недостаточно USDT. Баланс приложения здесь не используется.',
 'NO_GAS':'На адресе недостаточно валюты сети для комиссии: пополните TRX, BNB или ETH.',
 'RPC_UNAVAILABLE':'Не удалось проверить сеть. Средства не отправлялись; попробуйте обновить расчёт.',
 'ORDER_NOT_PAYABLE':'Заявка уже оплачивается или истекла. Повторный перевод не отправлен.',
 'QUOTE_EXPIRED':'Расчёт сетевой комиссии устарел. Получите новый расчёт.',
 'KEY_UNAVAILABLE':'Подпись для этого кошелька пока недоступна.',
 'TX_FAILED':'Сеть отклонила перевод. Комиссия сети могла быть списана.',
 'OUTCOME_UNKNOWN':'Исход отправки уточняется. Не оплачивайте эту заявку повторно.',
 'SIGNER_ERROR':'Не удалось подготовить платёж. Обратитесь в поддержку.',
}


def prepare(ledger):
    ledger.db.executescript('''
      CREATE TABLE IF NOT EXISTS custody_funding_jobs (
        id TEXT PRIMARY KEY,intent_id TEXT NOT NULL,user_id TEXT NOT NULL,wallet_id TEXT NOT NULL,
        network TEXT NOT NULL,state TEXT NOT NULL,quote TEXT,signed_payload TEXT,tx_hash TEXT,
        error TEXT,created_at REAL NOT NULL,updated_at REAL NOT NULL,lease_until REAL NOT NULL DEFAULT 0,
        worker_id TEXT,next_attempt_at REAL NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS custody_funding_one_wallet ON custody_funding_jobs(wallet_id)
        WHERE state IN ('estimating','quoted','confirmed','signing','signed','broadcast','unknown');
      CREATE INDEX IF NOT EXISTS custody_funding_intent ON custody_funding_jobs(user_id,intent_id,created_at DESC);
      CREATE TABLE IF NOT EXISTS custody_withdrawal_intents (
        job_id TEXT PRIMARY KEY, recipient TEXT NOT NULL, amount TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS custody_signer_status (worker_id TEXT PRIMARY KEY,networks TEXT NOT NULL,key_id TEXT NOT NULL,heartbeat_at REAL NOT NULL);
    ''')

    columns = {row[1] for row in ledger.db.execute("PRAGMA table_info(custody_withdrawal_intents)")}
    if "asset" not in columns:
        ledger.db.execute("ALTER TABLE custody_withdrawal_intents ADD COLUMN asset TEXT NOT NULL DEFAULT 'BNB'")


class Funding:
    def __init__(self,ledger,orders,custody,enabled=False):
        self.ledger,self.orders,self.custody=ledger,orders,custody
        self.enabled=bool(enabled and orders.enabled)
        orders.provider.wallet_funding_enabled=self.enabled
        self.error=orders.provider.error
        prepare(ledger)

    def public(self,row):
        if not row:return None
        quote=json.loads(row['quote']) if row['quote'] else None
        shown={key:quote.get(key) for key in ['approval_id','amount','token_balance','native_balance','max_fee','fee_currency','expires_at','source_address']} if quote else None
        return {'job_id':row['id'],'intent_id':row['intent_id'],'state':row['state'],'network':row['network'],
                'quote':shown,'tx_hash':row['tx_hash'],'error':row['error'],
                'detail':ERRORS.get(row['error'],'Статус платежа уточняется' if row['error'] else None)}

    def signer(self,network,native_bnb=False,withdrawal_asset=None):
        capability = CUSTODY_WITHDRAWAL_CAPABILITIES.get(withdrawal_asset or ("BNB" if native_bnb else ""))
        rows=self.ledger.db.execute('SELECT * FROM custody_signer_status WHERE heartbeat_at>?',(time.time()-45,)).fetchall()
        return any(r['key_id']==self.custody.key_id and network in json.loads(r['networks'])
                   and (not capability or capability in json.loads(r['networks'])) for r in rows)

    def status(self,uid,intent_id):
        order=self.orders.owned(uid,intent_id)
        params=json.loads(order['params']);network=params['from_network']
        row=self.ledger.db.execute('SELECT * FROM custody_funding_jobs WHERE user_id=? AND intent_id=? ORDER BY created_at DESC LIMIT 1',(uid,intent_id)).fetchone()
        return {'enabled':self.enabled and network in NETWORKS,'signer_online':self.signer(network),
                'networks':list(NETWORKS),'native_asset':NETWORKS.get(network),'job':self.public(row)}

    def payable(self,uid,intent_id):
        row=self.orders.owned(uid,intent_id)
        snapshot=json.loads(row['snapshot']) if row['snapshot'] else None
        if row['state']!='ready' or not snapshot or snapshot['status']!='NEW' or snapshot['expires_at']<time.time()+90:
            raise self.error('ORDER_NOT_PAYABLE','Заявку сейчас нельзя оплатить автоматически',409)
        return row,snapshot

    def estimate(self,uid,intent_id):
        if not self.enabled:raise self.error('FUNDING_NOT_ENABLED','Оплата с собственного кошелька не включена',503)
        order,snapshot=self.payable(uid,intent_id);network=json.loads(order['params'])['from_network']
        if network not in NETWORKS:raise self.error('UNSUPPORTED_NETWORK','Автоматическая оплата в этой сети ещё не подключена',400)
        if not self.signer(network):raise self.error('SIGNER_UNAVAILABLE','Процесс подписи временно недоступен',503)
        if not self.custody.configured or self.custody.chain_env!='mainnet':raise self.error('KEY_UNAVAILABLE','Нужен собственный mainnet-кошелёк',503)
        wallet=self.custody.create(uid,network)
        self.ledger.begin('funding_estimate',uid,intent_id)
        try:
            self.ledger.db.execute("UPDATE custody_funding_jobs SET state='expired',error='QUOTE_EXPIRED' WHERE state='quoted' AND json_extract(quote,'$.expires_at')<?",(time.time(),))
            active=self.ledger.db.execute("SELECT * FROM custody_funding_jobs WHERE wallet_id=? AND state IN ('estimating','quoted','confirmed','signing','signed','broadcast','unknown')",(wallet['id'],)).fetchone()
            if active:
                if active['intent_id']!=intent_id:raise self.error('PAYMENT_IN_PROGRESS','С этого адреса уже выполняется платёж. Дождитесь результата',409)
                self.ledger.commit();return self.public(active)
            job=uuid.uuid4().hex;stamp=time.time()
            self.ledger.db.execute('INSERT INTO custody_funding_jobs(id,intent_id,user_id,wallet_id,network,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',(job,intent_id,uid,wallet['id'],network,'estimating',stamp,stamp))
            self.ledger.commit()
        except Exception:self.ledger.rollback();raise
        return self.public(self.ledger.db.execute('SELECT * FROM custody_funding_jobs WHERE id=?',(job,)).fetchone())

    def confirm(self,uid,job_id,approval_id,native_bnb=False):
        if not native_bnb and not self.enabled:raise self.error('FUNDING_NOT_ENABLED','Оплата с собственного кошелька не включена',503)
        self.ledger.begin('funding_confirm',uid,job_id)
        try:
            row=self.ledger.db.execute('SELECT * FROM custody_funding_jobs WHERE id=? AND user_id=?',(job_id,uid)).fetchone()
            if not row:raise self.error('NOT_FOUND','Платёж не найден',404)
            withdrawal = self.ledger.db.execute(
                'SELECT 1 FROM custody_withdrawal_intents WHERE job_id=?', (job_id,),
            ).fetchone()
            if bool(withdrawal) != native_bnb:
                raise self.error('NOT_FOUND','Платёж не найден',404)
            if row['state'] in {'confirmed','signing','signed','broadcast','unknown','done'}:
                self.ledger.commit();return self.public(row)
            quote=json.loads(row['quote']) if row['quote'] else None
            if row['state']!='quoted' or not quote or quote['expires_at']<time.time() or quote['approval_id']!=approval_id:
                raise self.error('QUOTE_EXPIRED','Расчёт комиссии устарел. Обновите его',400)
            if not native_bnb:
                self.payable(uid,row['intent_id'])
            self.ledger.db.execute("UPDATE custody_funding_jobs SET state='confirmed',updated_at=?,lease_until=0 WHERE id=?",(time.time(),job_id))
            self.ledger.commit()
        except Exception:self.ledger.rollback();raise
        return self.public(self.ledger.db.execute('SELECT * FROM custody_funding_jobs WHERE id=?',(job_id,)).fetchone())

    async def route(self,request,action,uid):
        if action not in {'exchange-funding','exchange-funding-prepare','exchange-funding-confirm','exchange-funding-cancel'}:return None
        if action=='exchange-funding' and request.method=='GET':
            if set(request.query)!={'intent_id'}:raise ValueError('Only intent accepted')
            return web.json_response(self.status(uid,request.query['intent_id']),headers={'Cache-Control':'no-store'})
        if action=='exchange-funding' or request.method!='POST':raise self.error('METHOD_NOT_ALLOWED','Неверный метод',405)
        body=await request.json()
        if not isinstance(body,dict):raise ValueError('Invalid funding body')
        if any(not isinstance(v,str) or not re.fullmatch(r'[a-f0-9]{32}',v) for v in body.values()):raise ValueError('Invalid server identifier')
        if action=='exchange-funding-prepare':
            if set(body)!={'intent_id'}:raise ValueError('Only server intent accepted')
            result=self.estimate(uid,body['intent_id'])
        elif action=='exchange-funding-confirm':
            if set(body)!={'job_id','approval_id'}:raise ValueError('Only server job and approval accepted')
            result=self.confirm(uid,body['job_id'],body['approval_id'])
        else:
            if set(body)!={'job_id'}:raise ValueError('Only job accepted')
            row=self.ledger.db.execute('SELECT * FROM custody_funding_jobs WHERE id=? AND user_id=?',(body['job_id'],uid)).fetchone()
            if not row:raise self.error('NOT_FOUND','Платёж не найден',404)
            if row['state'] not in {'estimating','quoted'}:raise self.error('PAYMENT_IN_PROGRESS','Отправленный платёж отменить нельзя',409)
            self.ledger.db.execute("UPDATE custody_funding_jobs SET state='cancelled',updated_at=? WHERE id=? AND state IN ('estimating','quoted')",(time.time(),row['id']))
            result=self.public(self.ledger.db.execute('SELECT * FROM custody_funding_jobs WHERE id=?',(row['id'],)).fetchone())
        return web.json_response(result,headers={'Cache-Control':'no-store'})
