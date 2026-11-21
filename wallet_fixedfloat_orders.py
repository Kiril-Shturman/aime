"""Externally funded FixedFloat orders. No wallet signing or internal money postings."""
import asyncio
import hashlib
import json
import logging
import re
import time
import uuid
from decimal import Decimal
from aiohttp import web
from bip_utils import EthAddrDecoder, TrxAddrDecoder, SolAddrDecoder
from pytoniq_core import Address as TonAddress
from wallet_fixedfloat import NETWORKS

STATES = {'NEW','PENDING','EXCHANGE','WITHDRAW','DONE','EXPIRED','EMERGENCY'}
TERMINAL = {'DONE','EXPIRED','REFUNDED'}


def address(network, value):
    if not isinstance(value,str) or not 1 <= len(value) <= 128 or value.strip()!=value or re.search(r'\s|[\x00-\x1f\x7f]',value):
        raise ValueError('Invalid receiving address')
    try:
        if network in {'ETH','BSC'}:
            raw = EthAddrDecoder.DecodeAddr(value, skip_chksum_enc=True)
            if raw == bytes(20):raise ValueError('Zero address')
            return raw.hex()
        if network == 'TRON':return TrxAddrDecoder.DecodeAddr(value).hex()
        if network == 'SOL':return SolAddrDecoder.DecodeAddr(value).hex()
        if network == 'TON':
            parsed=TonAddress(value)
            if parsed.is_test_only or parsed.wc != 0:raise ValueError('Mainnet wallet required')
            return parsed.to_str(is_user_friendly=False)
    except Exception:
        raise ValueError('Адрес не соответствует выбранной сети') from None
    raise ValueError('Unsupported address network')


def positive(value):
    if isinstance(value,bool):raise ValueError('Invalid amount')
    number=Decimal(str(value))
    if not number.is_finite() or number<=0 or number.adjusted()>18 or number.as_tuple().exponent < -18:
        raise ValueError('Invalid amount')
    return number


def text(value, limit=256):
    if value is None:return None
    if not isinstance(value,str) or len(value)>limit or re.search(r'[\x00-\x1f\x7f]',value):raise ValueError('Invalid provider text')
    return value


class Orders:
    def __init__(self, ledger, provider, enabled=False):
        self.ledger,self.provider=ledger,provider
        self.enabled=bool(enabled and provider.configured)
        provider.orders_enabled=self.enabled
        self.locks={}
        self.validate_managed_route = None
        ledger.db.executescript('''
          CREATE TABLE IF NOT EXISTS fixedfloat_order_intents (
            id TEXT PRIMARY KEY,user_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
            params TEXT NOT NULL,quote TEXT NOT NULL,state TEXT NOT NULL,
            provider_id TEXT UNIQUE,access_token TEXT,snapshot TEXT,
            created_at REAL NOT NULL,expires_at REAL NOT NULL,checked_at REAL NOT NULL DEFAULT 0,
            next_check_at REAL NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,
            error TEXT,poll_nonce TEXT
          );
          CREATE INDEX IF NOT EXISTS fixedfloat_order_owner ON fixedfloat_order_intents(user_id,created_at DESC);
          CREATE INDEX IF NOT EXISTS fixedfloat_order_due ON fixedfloat_order_intents(next_check_at);
        ''')

    def owned(self,uid,intent_id):
        row=self.ledger.db.execute('SELECT * FROM fixedfloat_order_intents WHERE id=? AND user_id=?',(intent_id,uid)).fetchone()
        if not row:raise self.provider.error('NOT_FOUND','Обмен не найден',404)
        return row

    def public(self,row):
        params=json.loads(row['params']);quote=json.loads(row['quote'])
        state='unknown' if row['state']=='creating' else row['state']
        return {'intent_id':row['id'],'state':state,'provider':'fixedfloat','funding_mode':'external',
                'from_network':params['from_network'],'to_network':params['to_network'],
                'amount':params['amount'],'rate_type':params['rate_type'],
                'to_address':params['to_address'],'to_tag':params['to_tag'],
                'quote':quote,'order':json.loads(row['snapshot']) if row['snapshot'] else None,
                'created_at':row['created_at'],'quote_expires_at':row['expires_at'],
                'error':row['error'],'next_check_at':row['next_check_at']}

    def require_enabled(self):
        if not self.enabled:raise self.provider.error('EXCHANGE_NOT_ENABLED','Создание обменов пока не включено',503)

    async def prepare(self,uid,body, *, managed_provider=None, min_deposit=None):
        self.require_enabled()
        if not isinstance(body,dict) or set(body)-{'from_network','to_network','amount','rate_type','to_address','to_tag'}:
            raise ValueError('Invalid exchange parameters')
        base={key:body.get(key) for key in ['from_network','to_network','amount','rate_type']}
        destination=base['to_network']
        if destination not in NETWORKS:raise ValueError('Invalid destination')
        try:address(destination,body.get('to_address'))
        except ValueError:raise self.provider.error('ADDRESS_INVALID','Проверьте адрес получения и выбранную сеть',400) from None
        tag=text(body.get('to_tag'),128) or None
        params={**base,'to_address':body['to_address'],'to_tag':tag}
        if managed_provider:
            params['managed_provider'] = managed_provider
            params['min_deposit'] = str(min_deposit) if min_deposit is not None else None
        # Strict amount/direction validation is shared with the existing quote adapter.
        fingerprint=hashlib.sha256(json.dumps(params,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        existing=self.ledger.db.execute(
            "SELECT * FROM fixedfloat_order_intents WHERE user_id=? AND fingerprint=? AND (state IN ('prepared','creating','unknown') OR (state='ready' AND json_extract(snapshot,'$.status') NOT IN ('DONE','EXPIRED','REFUNDED'))) ORDER BY created_at DESC LIMIT 1",
            (uid,fingerprint),
        ).fetchone()
        if existing and (existing['state']!='prepared' or existing['expires_at']>time.time()):
            return self.public(existing)
        quote=await self.provider.quote(base)
        if not quote['available']:raise self.provider.error('EXCHANGE_UNAVAILABLE','Направление или сумма сейчас недоступны',409)
        if min_deposit is not None and Decimal(str(quote['to_amount'])) < Decimal(str(min_deposit)):
            raise self.provider.error('AMOUNT_TOO_SMALL', 'Сумма выплаты меньше минимума пополнения', 400)
        self.ledger.begin('exchange_prepare',uid,'Prepare externally funded exchange')
        try:
            # A second process may have prepared the same operation while price was loading.
            existing=self.ledger.db.execute(
                "SELECT * FROM fixedfloat_order_intents WHERE user_id=? AND fingerprint=? AND (state IN ('creating','unknown') OR (state='ready' AND json_extract(snapshot,'$.status') NOT IN ('DONE','EXPIRED','REFUNDED')) OR (state='prepared' AND expires_at>?)) ORDER BY created_at DESC LIMIT 1",
                (uid,fingerprint,time.time()),
            ).fetchone()
            if existing:
                self.ledger.commit();return self.public(existing)
            intent_id=uuid.uuid4().hex
            self.ledger.db.execute(
                'INSERT INTO fixedfloat_order_intents(id,user_id,fingerprint,params,quote,state,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)',
                (intent_id,uid,fingerprint,json.dumps(params),json.dumps(quote),'prepared',time.time(),time.time()+20),
            )
            self.ledger.commit()
        except Exception:self.ledger.rollback();raise
        return self.public(self.owned(uid,intent_id))

    def snapshot(self,payload,params,provider_id=None,creating=False):
        if not isinstance(payload,dict):raise ValueError('Invalid order')
        order_id=payload.get('id');status=payload.get('status')
        if not isinstance(order_id,str) or not re.fullmatch(r'[A-Za-z0-9]{6}',order_id) or (provider_id and order_id!=provider_id):
            raise ValueError('Order identity mismatch')
        if status not in STATES or payload.get('type')!=params['rate_type']:
            raise ValueError('Order type/status mismatch')
        source,destination=payload.get('from'),payload.get('to')
        for part,network in [(source,params['from_network']),(destination,params['to_network'])]:
            if not isinstance(part,dict) or part.get('code')!=NETWORKS[network][0] or part.get('coin')!='USDT' or part.get('network')!=NETWORKS[network][1]:
                raise ValueError('Order asset/network mismatch')
        pay_amount=positive(source.get('amount'));receive_amount=positive(destination.get('amount'))
        if status == 'NEW' and params.get('min_deposit') is not None and receive_amount < positive(params['min_deposit']):
            raise ValueError('Order payout below deposit minimum')
        if creating and pay_amount!=positive(params['amount']):raise ValueError('Changed sending amount')
        address(params['from_network'],source.get('address'))
        if address(params['to_network'],destination.get('address'))!=address(params['to_network'],params['to_address']):
            raise ValueError('Payout address mismatch')
        if (text(destination.get('tag'),128) or None)!=params['to_tag']:raise ValueError('Payout memo mismatch')
        clock=payload.get('time')
        if not isinstance(clock,dict):raise ValueError('Missing order times')
        expiration=clock.get('expiration');updated=clock.get('update') or clock.get('reg')
        if isinstance(expiration,bool) or not isinstance(expiration,(int,Decimal)) or expiration<=0 or expiration>30_000_000_000:
            raise ValueError('Invalid expiration')
        if isinstance(updated,bool) or not isinstance(updated,(int,Decimal)) or updated<=0 or updated>30_000_000_000:
            raise ValueError('Invalid update time')
        pay_tx=source.get('tx') or {};payout_tx=destination.get('tx') or {}
        if not isinstance(pay_tx,dict) or not isinstance(payout_tx,dict):raise ValueError('Invalid transactions')
        payout_hash=text(payout_tx.get('id'))
        back=payload.get('back') or {}
        refund_hash=text((back.get('tx') or {}).get('id')) if isinstance(back,dict) else None
        if status=='DONE' and not payout_hash:
            if refund_hash and (payload.get('emergency') or {}).get('choice')=='REFUND':status='REFUNDED'
            else:raise ValueError('Missing payout transaction')
        emergencies=(payload.get('emergency') or {}).get('status',[])
        if not isinstance(emergencies,list) or not all(isinstance(x,str) and len(x)<=40 for x in emergencies):
            raise ValueError('Invalid emergency state')
        return {'provider_id':order_id,'status':status,'from_amount':str(pay_amount),'to_amount':str(receive_amount),
                'pay_address':source['address'],'pay_tag':text(source.get('tag'),128),
                'to_address':destination['address'],'to_tag':params['to_tag'],
                'expires_at':int(expiration),'updated_at':int(updated),
                'pay_tx_hash':text(pay_tx.get('id')),'payout_tx_hash':payout_hash,'refund_tx_hash':refund_hash,
                'emergency':emergencies}

    async def create(self,uid,intent_id):
        self.require_enabled()
        # The durable claim happens before the non-idempotent provider POST.
        self.ledger.begin('exchange_create',uid,str(intent_id))
        try:
            row=self.owned(uid,intent_id)
            if row['state']!='prepared':
                self.ledger.commit();return self.public(row)
            params = json.loads(row["params"])
            if params.get("managed_provider"):
                if not self.validate_managed_route:
                    raise self.provider.error("EXCHANGE_UNAVAILABLE", "Маршрут обмена недоступен", 409)
                self.validate_managed_route(params["from_network"], params["to_network"], params["managed_provider"])
            if row['expires_at']<time.time():raise self.provider.error('QUOTE_EXPIRED','Расчёт устарел. Рассчитайте обмен заново',400)
            if row['next_check_at']>time.time():raise self.provider.error('RATE_LIMITED','Повторите после окончания ограничения',429,str(max(1,int(row['next_check_at']-time.time()))))
            self.ledger.db.execute("UPDATE fixedfloat_order_intents SET state='creating',error=NULL WHERE id=?",(intent_id,))
            self.ledger.commit()
        except Exception:self.ledger.rollback();raise
        params=json.loads(row['params'])
        request={'type':params['rate_type'],'fromCcy':NETWORKS[params['from_network']][0],
                 'toCcy':NETWORKS[params['to_network']][0],'direction':'from','amount':params['amount'],'toAddress':params['to_address']}
        if params['to_tag']:request['tag']=params['to_tag']
        try:
            payload=await self.provider.create_order(request)
            token=payload.get('token') if isinstance(payload,dict) else None
            if not isinstance(token,str) or not re.fullmatch(r'[A-Za-z0-9._:-]{16,512}',token):raise ValueError('Missing order access token')
            if not isinstance(payload.get('id'),str) or not re.fullmatch(r'[A-Za-z0-9]{6}',payload['id']):raise ValueError('Invalid provider id')
            self.ledger.db.execute("UPDATE fixedfloat_order_intents SET provider_id=?,access_token=? WHERE id=? AND state='creating'",(payload['id'],token,intent_id))
            snapshot=self.snapshot(payload,params,creating=True)
            if snapshot['status']!='NEW' or snapshot['expires_at']<=time.time():raise ValueError('New order already expired')
            self.ledger.begin('exchange_created',uid,intent_id)
            try:
                self.ledger.db.execute(
                    "UPDATE fixedfloat_order_intents SET state='ready',provider_id=?,access_token=?,snapshot=?,checked_at=?,next_check_at=?,error=NULL WHERE id=? AND state='creating'",
                    (snapshot['provider_id'],token,json.dumps(snapshot),time.time(),time.time()+15,intent_id),
                )
                self.ledger.commit()
            except Exception:self.ledger.rollback();raise
        except asyncio.CancelledError:
            self.ledger.db.execute("UPDATE fixedfloat_order_intents SET state='unknown',error='OUTCOME_UNKNOWN' WHERE id=? AND state='creating'",(intent_id,))
            raise
        except Exception as error:
            definitive=getattr(error,'definitive',False)
            state='rejected' if definitive else 'unknown'
            delay=0
            if definitive and getattr(error,'status',None)==429:
                try:delay=max(1,min(3600,int(error.retry_after)))
                except (ValueError,TypeError):delay=60
                state='prepared'
            self.ledger.db.execute(
                'UPDATE fixedfloat_order_intents SET state=?,error=?,next_check_at=? WHERE id=? AND state=\'creating\'',
                (state,'RATE_LIMITED' if delay else 'EXCHANGE_REJECTED' if definitive else 'OUTCOME_UNKNOWN',time.time()+delay,intent_id),
            )
        return self.public(self.owned(uid,intent_id))

    async def refresh(self,uid,intent_id,force=False):
        row=self.owned(uid,intent_id)
        if row['state'] not in {'ready','unknown','creating'} or not row['provider_id'] or not row['access_token'] or row['next_check_at']>time.time():return self.public(row)
        if row['snapshot'] and json.loads(row['snapshot'])['status'] in {'DONE','REFUNDED'}:return self.public(row)
        # Conditional nonce prevents an older parallel response overwriting a newer read.
        nonce=uuid.uuid4().hex
        claimed=self.ledger.db.execute('UPDATE fixedfloat_order_intents SET poll_nonce=?,next_check_at=? WHERE id=? AND next_check_at<=?',(nonce,time.time()+15,intent_id,time.time())).rowcount
        if not claimed:return self.public(self.owned(uid,intent_id))
        try:
            payload=await self.provider.fetch_order(row['provider_id'],row['access_token'])
            fresh=self.snapshot(payload,json.loads(row['params']),row['provider_id'])
            old=json.loads(row['snapshot']) if row['snapshot'] else None
            if old and fresh['updated_at']<old['updated_at']:raise ValueError('Stale provider response')
            self.ledger.db.execute(
                "UPDATE fixedfloat_order_intents SET state='ready',snapshot=?,checked_at=?,next_check_at=?,error=NULL,attempts=0 WHERE id=? AND poll_nonce=?",
                (json.dumps(fresh),time.time(),time.time()+(3600 if fresh['status']=='EXPIRED' else 15),intent_id,nonce),
            )
        except asyncio.CancelledError:raise
        except Exception as error:
            attempts=min(6,row['attempts']+1)
            delay=min(900,15*2**attempts)
            if getattr(error,'retry_after',None):
                try:delay=max(delay,min(3600,int(error.retry_after)))
                except (ValueError,TypeError):pass
            self.ledger.db.execute('UPDATE fixedfloat_order_intents SET error=?,attempts=?,next_check_at=? WHERE id=? AND poll_nonce=?',
                                   ('STATUS_UNAVAILABLE',attempts,time.time()+delay,intent_id,nonce))
        return self.public(self.owned(uid,intent_id))

    async def run(self):
        while True:
            try:
                rows=self.ledger.db.execute(
                    "SELECT id,user_id FROM fixedfloat_order_intents WHERE next_check_at<=? AND provider_id IS NOT NULL AND access_token IS NOT NULL "
                    "AND (state IN ('unknown','creating') OR (state='ready' AND json_extract(snapshot,'$.status') NOT IN ('DONE','REFUNDED') "
                    "AND (json_extract(snapshot,'$.status')!='EXPIRED' OR json_extract(snapshot,'$.expires_at')>?))) ORDER BY next_check_at LIMIT 6",
                    (time.time(),time.time()-3*86400),
                ).fetchall()
                for row in rows:
                    await self.refresh(row['user_id'],row['id'])
            except asyncio.CancelledError:raise
            except Exception:
                logging.getLogger(__name__).warning('FixedFloat status cycle failed')
            await asyncio.sleep(15)

    async def route(self,request,action,uid):
        if action not in {'exchange-prepare','exchange-create','exchange-order','exchange-orders','exchange-own-address'}:return None
        self.require_enabled()
        if action=='exchange-prepare' and request.method=='POST':
            self.provider.throttle(uid)
            return web.json_response(await self.prepare(uid,await request.json()),headers={'Cache-Control':'no-store'})
        if action=='exchange-create' and request.method=='POST':
            body=await request.json()
            if not isinstance(body,dict) or set(body)!={'intent_id'} or not isinstance(body['intent_id'],str) or not re.fullmatch(r'[a-f0-9]{32}',body['intent_id']):raise ValueError('Only server intent accepted')
            self.provider.throttle(uid)
            return web.json_response(await self.create(uid,body['intent_id']),headers={'Cache-Control':'no-store'})
        if action=='exchange-order' and request.method=='GET':
            if set(request.query)!={'intent_id'}:raise ValueError('Invalid order filter')
            return web.json_response(await self.refresh(uid,request.query['intent_id']),headers={'Cache-Control':'no-store'})
        if action=='exchange-orders' and request.method=='GET':
            if request.query:raise ValueError('No ownership filters accepted')
            rows=self.ledger.db.execute('SELECT * FROM fixedfloat_order_intents WHERE user_id=? ORDER BY created_at DESC LIMIT 30',(uid,)).fetchall()
            return web.json_response({'items':[self.public(row) for row in rows]},headers={'Cache-Control':'no-store'})
        if action=='exchange-own-address' and request.method=='POST':
            body=await request.json()
            if not isinstance(body,dict) or set(body)!={'network'}:raise ValueError('Only network accepted')
            custody=request.app['wpay_custody']
            if not custody.configured or custody.chain_env!='mainnet':raise self.provider.error('CUSTODY_NOT_CONFIGURED','Собственный mainnet-кошелёк не подключён',503)
            if body['network'] not in NETWORKS:raise ValueError('Invalid destination network')
            wallet=custody.create(uid,body['network'])
            return web.json_response({'address':wallet['address'],'network':wallet['network'],'provider':'wpay','internal_credit_enabled':False},headers={'Cache-Control':'no-store'})
        raise self.provider.error('METHOD_NOT_ALLOWED','Неверный метод',405)
