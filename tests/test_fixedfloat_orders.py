import asyncio
import copy
import hashlib
import hmac
import json
import tempfile
import time
import unittest
from decimal import Decimal
from aiohttp import web
from aiohttp.test_utils import TestClient,TestServer
from wallet_backend import Ledger,ApiError
from wallet_fixedfloat import FixedFloat,NETWORKS,prepare_exchange_limits
from wallet_fixedfloat_orders import Orders,address
from wallet_custody import derive


class OrderTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp=tempfile.TemporaryDirectory();self.ledger=Ledger(self.temp.name+'/db')
        prepare_exchange_limits(self.ledger);self.ledger.account('tg:1');self.ledger.account('tg:2')
        self.calls=[];self.creation_error=None;self.bad_identity=False;self.provider_state='NEW'
        self.payout_tx=None;self.updated=int(time.time());self.amount='100';self.token='SERVER_ONLY_TOKEN_1234567890'
        self.addresses={n:derive(bytes([i+1])*32,n,'mainnet')['address'] for i,n in enumerate(NETWORKS)}
        self.provider_payload=None
        async def api(request):
            raw=await request.read();self.assertEqual(request.headers['X-API-SIGN'],hmac.new(b'secret',raw,hashlib.sha256).hexdigest())
            method=request.match_info['method'];body=json.loads(raw);self.calls.append((method,body))
            if method=='ccies':return web.json_response({'code':0,'data':[{'code':value[0],'coin':'USDT','network':value[1],'recv':True,'send':True} for value in NETWORKS.values()]})
            if method=='price':
                source=next(n for n,v in NETWORKS.items() if v[0]==body['fromCcy']);target=next(n for n,v in NETWORKS.items() if v[0]==body['toCcy'])
                return web.json_response({'code':0,'data':{'from':{'code':NETWORKS[source][0],'coin':'USDT','network':NETWORKS[source][1],'amount':body['amount']},'to':{'code':NETWORKS[target][0],'coin':'USDT','network':NETWORKS[target][1],'amount':'99'},'errors':[]}})
            if method=='create':
                if self.creation_error=='429':return web.json_response({'error':'limit'},status=429,headers={'Retry-After':'1'})
                if self.creation_error=='503':return web.json_response({'error':'unknown'},status=503)
                if self.creation_error=='400':return web.json_response({'error':'bad'},status=400)
                self.provider_payload=self.payload(body)
                if self.creation_error=='malformed':self.provider_payload['to']['address']=self.addresses['ETH']
                await asyncio.sleep(.02)
                return web.json_response({'code':0,'data':self.provider_payload})
            if method=='order':
                self.assertEqual(body,{'id':'ABC123','token':self.token})
                payload=copy.deepcopy(self.provider_payload);payload['status']=self.provider_state
                payload['time']['update']=self.updated
                payload['to']['tx']={'id':self.payout_tx}
                return web.json_response({'code':0,'data':payload})
            return web.json_response({},status=404)
        app=web.Application();app.router.add_post('/{method}',api)
        self.http=TestClient(TestServer(app));await self.http.start_server()
        self.ff=FixedFloat('key','secret',ApiError,str(self.http.make_url('')).rstrip('/'));self.ff.ledger=self.ledger
        self.orders=Orders(self.ledger,self.ff,True)

    async def asyncTearDown(self):
        self.ledger.book.verify();self.assertEqual(self.ledger.balance('tg:1','USDT'),(Decimal(0),Decimal(0)))
        await self.ff.close();await self.http.close();self.ledger.db.close();self.temp.cleanup()

    def body(self):return {'from_network':'TRON','to_network':'BSC','amount':'100','rate_type':'float','to_address':self.addresses['BSC']}

    def payload(self,body):
        source=next(n for n,v in NETWORKS.items() if v[0]==body['fromCcy']);target=next(n for n,v in NETWORKS.items() if v[0]==body['toCcy'])
        return {'id':'ABC123','token':self.token,'type':body['type'],'status':'NEW','time':{'reg':self.updated,'update':self.updated,'expiration':int(time.time()+1800)},
                'from':{'code':body['fromCcy'],'coin':'USDT','network':NETWORKS[source][1],'amount':body['amount'],'address':self.addresses[source],'tag':None,'tx':{}},
                'to':{'code':body['toCcy'],'coin':'USDT','network':NETWORKS[target][1],'amount':'99','address':body['toAddress'],'tag':body.get('tag'),'tx':{}},'emergency':{'status':[]}}

    async def prepared(self):return await self.orders.prepare('tg:1',self.body())

    async def due(self,intent_id):
        self.ledger.db.execute('UPDATE fixedfloat_order_intents SET next_check_at=0 WHERE id=?',(intent_id,))
        return await self.orders.refresh('tg:1',intent_id)

    async def test_real_lifecycle_has_one_create_and_never_exposes_token_or_moves_balance(self):
        prepared=await self.prepared();self.assertEqual(prepared['state'],'prepared')
        self.assertEqual(sum(m=='create' for m,_ in self.calls),0)
        first,second=await asyncio.gather(self.orders.create('tg:1',prepared['intent_id']),self.orders.create('tg:1',prepared['intent_id']))
        ready=await self.orders.create('tg:1',prepared['intent_id'])
        self.assertEqual(sum(m=='create' for m,_ in self.calls),1);self.assertEqual(ready['state'],'ready')
        self.assertEqual(ready['order']['pay_address'],self.addresses['TRON']);self.assertNotIn(self.token,json.dumps(ready))
        self.provider_state='DONE';self.payout_tx='payout-hash';self.updated+=1
        done=await self.due(prepared['intent_id']);self.assertEqual(done['order']['status'],'DONE')
        self.assertEqual(done['order']['payout_tx_hash'],'payout-hash')

    async def test_managed_payout_checks_minimum_and_revalidates_route_before_create(self):
        with self.assertRaises(ApiError):
            await self.orders.prepare("tg:1", self.body(), managed_provider="goswap", min_deposit="1000")
        prepared = await self.orders.prepare("tg:1", self.body(), managed_provider="goswap", min_deposit="1")
        with self.assertRaises(ApiError):
            await self.orders.create("tg:1", prepared["intent_id"])
        self.assertFalse(any(method == "create" for method, _ in self.calls))
        checks = []
        self.orders.validate_managed_route = lambda *pair: checks.append(pair)
        ready = await self.orders.create("tg:1", prepared["intent_id"])
        self.assertEqual(ready["state"], "ready")
        self.assertEqual(checks, [("TRON", "BSC", "goswap")])
        self.assertEqual(ready["to_address"], self.addresses["BSC"])

    async def test_parallel_prepare_reuses_owned_intent(self):
        one,two=await asyncio.gather(self.prepared(),self.prepared());self.assertEqual(one['intent_id'],two['intent_id'])

    async def test_foreign_intent_is_not_readable_or_executable(self):
        p=await self.prepared()
        with self.assertRaises(ApiError):await self.orders.create('tg:2',p['intent_id'])
        with self.assertRaises(ApiError):self.orders.owned('tg:2',p['intent_id'])
        self.assertEqual(sum(m=='create' for m,_ in self.calls),0)

    async def test_expired_quote_never_creates_order(self):
        p=await self.prepared();self.ledger.db.execute('UPDATE fixedfloat_order_intents SET expires_at=0 WHERE id=?',(p['intent_id'],))
        with self.assertRaises(ApiError):await self.orders.create('tg:1',p['intent_id'])
        self.assertEqual(sum(m=='create' for m,_ in self.calls),0)

    async def test_503_never_retries_create_even_after_restart(self):
        self.creation_error='503';p=await self.prepared();first=await self.orders.create('tg:1',p['intent_id'])
        self.assertEqual(first['state'],'unknown');restarted=Orders(self.ledger,self.ff,True)
        again=await restarted.create('tg:1',p['intent_id']);self.assertEqual(again['state'],'unknown')
        self.assertEqual(sum(m=='create' for m,_ in self.calls),1)

    async def test_crash_after_durable_claim_never_replays_post(self):
        p=await self.prepared();self.ledger.db.execute("UPDATE fixedfloat_order_intents SET state='creating' WHERE id=?",(p['intent_id'],))
        resumed=await Orders(self.ledger,self.ff,True).create('tg:1',p['intent_id'])
        self.assertEqual(resumed['state'],'unknown');self.assertEqual(sum(m=='create' for m,_ in self.calls),0)

    async def test_definitive_400_is_rejected(self):
        self.creation_error='400';p=await self.prepared();r=await self.orders.create('tg:1',p['intent_id'])
        self.assertEqual(r['state'],'rejected')

    async def test_429_only_retries_after_delay_with_same_intent(self):
        self.creation_error='429';p=await self.prepared();r=await self.orders.create('tg:1',p['intent_id']);self.assertEqual(r['state'],'prepared')
        with self.assertRaises(ApiError):await self.orders.create('tg:1',p['intent_id'])
        self.creation_error=None;self.ledger.db.execute('UPDATE fixedfloat_order_intents SET next_check_at=0 WHERE id=?',(p['intent_id'],))
        r=await self.orders.create('tg:1',p['intent_id']);self.assertEqual(r['state'],'ready')
        self.assertEqual(sum(m=='create' for m,_ in self.calls),2)

    async def test_wrong_payout_is_hidden_and_never_becomes_payable(self):
        # Distinct EVM recipient under the same format must not be accepted.
        self.creation_error='malformed';p=await self.prepared();r=await self.orders.create('tg:1',p['intent_id'])
        self.assertEqual(r['state'],'unknown');self.assertIsNone(r['order'])

    async def test_completed_without_payout_proof_preserves_previous_status(self):
        p=await self.prepared();await self.orders.create('tg:1',p['intent_id']);self.provider_state='DONE'
        r=await self.due(p['intent_id']);self.assertEqual(r['order']['status'],'NEW');self.assertEqual(r['error'],'STATUS_UNAVAILABLE')

    async def test_stale_status_does_not_regress(self):
        p=await self.prepared();await self.orders.create('tg:1',p['intent_id']);self.provider_state='PENDING';self.updated+=10
        r=await self.due(p['intent_id']);self.assertEqual(r['order']['status'],'PENDING')
        self.provider_state='NEW';self.updated-=20;r=await self.due(p['intent_id']);self.assertEqual(r['order']['status'],'PENDING')

    async def test_terminal_order_does_not_block_new_exchange(self):
        p=await self.prepared();await self.orders.create('tg:1',p['intent_id']);self.provider_state='DONE';self.payout_tx='tx';self.updated+=1
        await self.due(p['intent_id']);new=await self.prepared();self.assertNotEqual(new['intent_id'],p['intent_id'])

    async def test_address_validation_checks_network_and_test_only_ton(self):
        for n,value in self.addresses.items():self.assertTrue(address(n,value))
        with self.assertRaises(ValueError):address('TRON',self.addresses['BSC'])
        test_ton=derive(bytes([9])*32,'TON','testnet')['address']
        with self.assertRaises(ValueError):address('TON',test_ton)

    async def test_weighted_budget_bounds_create_calls(self):
        self.ledger.db.execute('INSERT INTO fixedfloat_call_budget(created_at,weight) VALUES (?,?)',(time.time(),190))
        p=await self.prepared();r=await self.orders.create('tg:1',p['intent_id']);self.assertEqual(r['state'],'prepared')
        self.assertEqual(sum(m=='create' for m,_ in self.calls),0)

    async def test_http_auth_ownership_and_browser_parameter_rejection(self):
        import os
        from unittest.mock import patch
        from wallet_backend import install_wallet
        from tests.test_wallet_backend import BOT,init_data
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ,{
            'WPAY_DB_PATH':root+'/route-db','WPAY_BOT_TOKEN':BOT,'GOSWAP_API_TOKEN':'',
            'FIXEDFLOAT_API_KEY':'key','FIXEDFLOAT_API_SECRET':'secret','WPAY_FIXEDFLOAT_ORDERS_ENABLED':'1','WPAY_AURA_ENABLED':'0',
        }):
            app=web.Application();install_wallet(app,root,lambda key:False)
            app['wpay_exchange'].base_url=str(self.http.make_url('')).rstrip('/')
            app.on_startup.clear()  # No Telegram calls or background polling during route tests.
            client=TestClient(TestServer(app));await client.start_server()
            try:
                self.assertEqual((await client.get('/api/wallet/exchange-orders')).status,401)
                headers={'X-Telegram-Init-Data':init_data(1)};foreign={'X-Telegram-Init-Data':init_data(2)}
                bad=await client.post('/api/wallet/exchange-prepare',json={**self.body(),'user_id':'tg:2'},headers=headers)
                self.assertEqual(bad.status,400)
                response=await client.post('/api/wallet/exchange-prepare',json=self.body(),headers=headers)
                self.assertEqual(response.status,200,await response.text());intent=(await response.json())['intent_id']
                response=await client.post('/api/wallet/exchange-create',json={'intent_id':intent},headers=headers)
                self.assertEqual(response.status,200);data=await response.json();self.assertEqual(data['state'],'ready')
                self.assertNotIn(self.token,json.dumps(data))
                denied=await client.get('/api/wallet/exchange-order?intent_id='+intent,headers=foreign);self.assertEqual(denied.status,404)
                own=await client.get('/api/wallet/exchange-orders',headers=headers);self.assertEqual(len((await own.json())['items']),1)
                other=await client.get('/api/wallet/exchange-orders',headers=foreign);self.assertEqual((await other.json())['items'],[])
                self.assertEqual(app['wpay_ledger'].balance('tg:1','USDT'),(Decimal(0),Decimal(0)))
            finally:await client.close()

    async def test_disabled_orders_do_not_call_provider(self):
        disabled=Orders(self.ledger,self.ff,False)
        with self.assertRaises(ApiError):await disabled.prepare('tg:1',self.body())
        self.assertEqual(self.calls,[])

    async def test_restart_recovers_known_remote_credentials_without_new_create(self):
        p=await self.prepared()
        self.provider_payload=self.payload({'fromCcy':'USDTTRC','toCcy':'USDTBSC','amount':'100','type':'float','toAddress':self.addresses['BSC']})
        self.ledger.db.execute("UPDATE fixedfloat_order_intents SET state='creating',provider_id='ABC123',access_token=? WHERE id=?",(self.token,p['intent_id']))
        result=await Orders(self.ledger,self.ff,True).refresh('tg:1',p['intent_id'])
        self.assertEqual(result['state'],'ready');self.assertEqual(sum(m=='create' for m,_ in self.calls),0)
        self.assertNotIn(self.token,json.dumps(result))
