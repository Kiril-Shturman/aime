import asyncio
import json
import tempfile
import time
import unittest
from decimal import Decimal
from unittest.mock import AsyncMock
from aiohttp.test_utils import TestClient, TestServer
from wallet_aura_mock import make_app, MOCK_KEY
from wallet_aura import AuraClient, AuraService, prepare, _store_card_event
from wallet_backend import Ledger, ApiError
from wallet_card_ui import CardUI
from wallet_inbox import prepare as prepare_inbox
from wallet_tariffs import create_version


class CardUITests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.mock=TestClient(TestServer(make_app()));await self.mock.start_server()
        self.temp=tempfile.TemporaryDirectory();self.ledger=Ledger(self.temp.name+'/db')
        prepare_inbox(self.ledger);prepare(self.ledger)
        self.client=AuraClient(MOCK_KEY,'test',ApiError,base_url=str(self.mock.make_url('/v1/partner')).rstrip('/'))
        self.service=AuraService(self.ledger,self.client,'test');self.ui=CardUI(self.ledger,self.service)
        self.uid='tg:cards';self.ref=self.ledger.account(self.uid);self.ledger.account('tg:other')
        self.ledger.begin('test_fund','test',self.uid)
        self.ledger.put_balance(self.uid,'USDT',Decimal(300),Decimal(0))
        self.ledger.db.execute("INSERT INTO wallet_provider_positions VALUES ('aura','test',?,'USDT','300','0',?)",(self.uid,time.time()))
        self.ledger.commit();self.mock.app['state'].balance=Decimal(300)

    async def asyncTearDown(self):
        self.ledger.book.verify();await self.client.close();await self.mock.close();self.ledger.db.close();self.temp.cleanup()

    def tariff(self,plan='card_subscriptions',fixed='5',percent='3',minimum='1'):
        return create_version(self.ledger,plan,enabled=True,fixed_fee=fixed,percent_fee=percent,minimum_fee=minimum,note='Test',created_by='test')

    async def card(self):
        owner=await self.service.ensure_customer(self.uid,self.ref)
        response=await self.mock.post('/mock/cards',json={'customer_id':owner,'kind':'virtual'})
        payload=await response.json();raw=payload['card'];_store_card_event(self.ledger,'test','card.snapshot',raw)
        return raw['id']

    async def test_catalogue_never_substitutes_fake_cards_and_requires_explicit_tariff(self):
        self.assertEqual(self.ui.cards(self.uid),[])
        fees=await self.ui.fees();self.assertEqual(len(fees['plans']),4)
        self.assertFalse(any(p['available'] for p in fees['plans']))
        with self.assertRaises(ApiError):await self.ui.quote(self.uid,{'operation':'issue','plan_id':'card_travel'})
        self.tariff('card_travel',fixed='7')
        fees=await self.ui.fees();travel=next(p for p in fees['plans'] if p['plan_id']=='card_travel')
        self.assertEqual(travel['issue_fee'],'27');self.assertTrue(travel['available'])

    async def test_issue_uses_plan_tariff_and_debits_exactly_once(self):
        self.tariff('card_travel',fixed='7')
        q=await self.ui.quote(self.uid,{'operation':'issue','plan_id':'card_travel'})
        body={'quote_id':q['quote_id'],'plan_id':'card_travel'}
        guard=self.ui.guard(self.uid,body,'issue','issue-one')
        first=await self.service.create_card_request(self.uid,self.ref,kind='virtual',plan_id='card_travel',idempotency_key='issue-one',price_guard=guard)
        second=await self.service.create_card_request(self.uid,self.ref,kind='virtual',plan_id='card_travel',idempotency_key='issue-one',price_guard=guard)
        self.assertEqual(first,second);self.assertEqual(self.ledger.balance(self.uid,'USDT'),(Decimal(273),Decimal(0)))
        card=self.ui.cards(self.uid)[0];self.assertEqual(card['plan_id'],'card_travel');self.assertEqual(card['skin'],'navy')

    async def test_tariff_change_blocks_issue_before_any_monetary_post(self):
        self.tariff();q=await self.ui.quote(self.uid,{'operation':'issue','plan_id':'card_subscriptions'})
        self.tariff(fixed='9');self.client.create_card=AsyncMock()
        guard=self.ui.guard(self.uid,{'quote_id':q['quote_id'],'plan_id':'card_subscriptions'},'issue','changed')
        with self.assertRaises(ApiError):await self.service.create_card_request(self.uid,self.ref,plan_id='card_subscriptions',idempotency_key='changed',price_guard=guard)
        self.client.create_card.assert_not_awaited();self.assertEqual(self.ledger.balance(self.uid,'USDT')[0],Decimal(300))

    async def test_quote_owner_expiry_and_single_operation_binding(self):
        self.tariff();q=await self.ui.quote(self.uid,{'operation':'issue','plan_id':'card_subscriptions'});body={'quote_id':q['quote_id'],'plan_id':'card_subscriptions'}
        with self.assertRaises(ApiError):self.ui.guard('tg:other',body,'issue','x')
        self.ui.guard(self.uid,body,'issue','key1')
        with self.assertRaises(ApiError):self.ui.guard(self.uid,body,'issue','key2')
        self.ledger.db.execute('UPDATE wallet_card_quotes SET expires_at=0 WHERE id=?',(q['quote_id'],))
        with self.assertRaises(ApiError):self.ui.guard(self.uid,body,'issue','key1')

    async def test_recharge_quote_and_settlement_include_our_minimum_fee(self):
        self.tariff();card=await self.card();q=await self.ui.quote(self.uid,{'operation':'recharge','card_id':card,'amount':'25'})
        self.assertEqual(Decimal(q['service_fee']),Decimal(1));self.assertEqual(Decimal(q['total']),Decimal('26.5'))
        body={'quote_id':q['quote_id'],'card_id':card,'amount':'25'}
        guard=self.ui.guard(self.uid,body,'recharge','topup')
        result=await self.service.recharge_card_request(self.uid,card,amount='25',idempotency_key='topup',price_guard=guard)
        self.assertEqual(Decimal(result['service_fee']),Decimal(1));self.assertEqual(Decimal(result['charged_amount']),Decimal('26.500004'))
        self.assertEqual(self.ledger.balance(self.uid,'USDT')[0],Decimal('273.499996'))
        repeated=await self.service.recharge_card_request(self.uid,card,amount='25',idempotency_key='topup',price_guard=guard)
        self.assertEqual(result,repeated)

    async def test_foreign_card_never_reaches_provider(self):
        self.tariff();card=await self.card();self.client.recharge_card=AsyncMock()
        with self.assertRaises(ApiError):await self.ui.quote('tg:other',{'operation':'recharge','card_id':card,'amount':'25'})
        self.client.recharge_card.assert_not_awaited()

    async def test_insufficient_funds_and_parallel_issues_keep_balanced_postings(self):
        self.tariff(fixed='200');q1=await self.ui.quote(self.uid,{'operation':'issue','plan_id':'card_subscriptions'});q2=await self.ui.quote(self.uid,{'operation':'issue','plan_id':'card_subscriptions'})
        async def send(q,key):
            guard=self.ui.guard(self.uid,{'quote_id':q['quote_id'],'plan_id':'card_subscriptions'},'issue',key)
            return await self.service.create_card_request(self.uid,self.ref,plan_id='card_subscriptions',idempotency_key=key,price_guard=guard)
        results=await asyncio.gather(send(q1,'p1'),send(q2,'p2'),return_exceptions=True)
        self.assertEqual(sum(isinstance(r,dict) for r in results),1)
        self.assertEqual(self.ledger.balance(self.uid,'USDT')[0],Decimal(80));self.ledger.book.verify()

    async def test_timeout_retry_survives_new_ui_instance_and_uses_same_key(self):
        self.tariff();self.client.create_card=AsyncMock(side_effect=asyncio.TimeoutError())
        q=await self.ui.quote(self.uid,{'operation':'issue','plan_id':'card_subscriptions'});body={'quote_id':q['quote_id'],'plan_id':'card_subscriptions'}
        with self.assertRaises(asyncio.TimeoutError):await self.service.create_card_request(self.uid,self.ref,plan_id='card_subscriptions',idempotency_key='lost',price_guard=self.ui.guard(self.uid,body,'issue','lost'))
        after=self.ledger.balance(self.uid,'USDT');restarted=CardUI(self.ledger,self.service)
        recovered=await restarted.quote(self.uid,{'operation':'issue','plan_id':'card_subscriptions'})
        self.assertEqual(recovered['retry_key'],'lost');self.assertEqual(self.ledger.balance(self.uid,'USDT'),after)

    async def test_refresh_is_read_only_scoped_and_never_leaks_credentials(self):
        self.tariff();card=await self.card();self.client.get_card_credentials=AsyncMock()
        await self.ui.refresh(self.uid);await self.ui.refresh(self.uid)
        cards=self.ui.cards(self.uid);self.assertEqual(cards[0]['card_id'],card)
        self.assertEqual(self.ui.cards('tg:other'),[])
        self.assertNotIn('cvv',json.dumps(cards));self.client.get_card_credentials.assert_not_awaited()

    async def test_unbacked_app_credit_never_reaches_provider_or_reserves_money(self):
        self.tariff();self.ledger.db.execute("DELETE FROM wallet_provider_positions WHERE user_id=?",(self.uid,))
        quote=await self.ui.quote(self.uid,{'operation':'issue','plan_id':'card_subscriptions'})
        self.assertFalse(quote['can_afford']);self.assertEqual(quote['spendable'],'0');self.assertEqual(quote['funding_error'],'AURA_FUNDS_UNAVAILABLE')
        self.client.create_card=AsyncMock()
        with self.assertRaises(ApiError) as caught:
            await self.service.create_card_request(self.uid,self.ref,plan_id='card_subscriptions',idempotency_key='unbacked',price_guard=self.ui.guard(self.uid,{'quote_id':quote['quote_id'],'plan_id':'card_subscriptions'},'issue','unbacked'))
        self.assertEqual(caught.exception.name,'AURA_FUNDS_UNAVAILABLE')
        self.client.create_card.assert_not_awaited();self.assertEqual(self.ledger.balance(self.uid,'USDT'),(Decimal(300),Decimal(0)))
        self.assertFalse(self.ledger.db.execute("SELECT 1 FROM wallet_provider_entities WHERE local_id='unbacked'").fetchone())
