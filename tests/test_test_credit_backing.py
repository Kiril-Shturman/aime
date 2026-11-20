import json,tempfile,time,unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock
from aiohttp import web
from aiohttp.test_utils import TestClient,TestServer
from wallet_backend import Ledger,ApiError,money
from wallet_aura import prepare
from wallet_inbox import prepare as prepare_inbox
from wallet_finance import finance_route,apply_aura_test_backing


class TestCreditBackingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.ledger=Ledger(self.tmp.name+'/db');prepare_inbox(self.ledger);prepare(self.ledger);self.ledger.account('tg:1')
        self.goswap=SimpleNamespace(call=AsyncMock(return_value=[{'currency_code':'USDT','available':'30'}]))
        self.aura=SimpleNamespace(environment='test',get_balance=AsyncMock(return_value={'platform_balance':'1000'}))
        async def handler(request):
            try:return await finance_route(request,'finance-adjustment','owner',request.headers.get('X-Test-Admin')=='yes',self.ledger,self.goswap,money,ApiError,aura_test_client=self.aura)
            except ApiError as e:return web.json_response({'error':e.name},status=e.status)
        app=web.Application();app.router.add_post('/adjust',handler)
        self.http=TestClient(TestServer(app));await self.http.start_server()
    async def asyncTearDown(self):
        await self.http.close();self.ledger.book.verify();self.ledger.db.close();self.tmp.cleanup()
    async def adjust(self,value='20',admin=True):
        return await self.http.post('/adjust',json={'account_id':'tg:1','asset':'USDT','amount':value,'reason':'Test card funding','bucket':'available','confirm':'ADJUST tg:1 USDT '+value},headers={'X-Test-Admin':'yes' if admin else 'no'})
    def backed(self):
        row=self.ledger.db.execute("SELECT available FROM wallet_provider_positions WHERE provider='aura' AND environment='test' AND user_id='tg:1' AND asset='USDT'").fetchone()
        return Decimal(row[0]) if row else Decimal(0)
    async def test_credit_and_backing_commit_together_and_decrease_together(self):
        response=await self.adjust();self.assertEqual(response.status,200);event=(await response.json())['event_id']
        self.assertEqual(self.backed(),Decimal(20));self.assertEqual(self.ledger.balance('tg:1','USDT')[0],Decimal(20))
        before=self.ledger.balance('tg:1','USDT')
        self.ledger.begin('repeat_test_allocation','test','idempotency')
        apply_aura_test_backing(self.ledger,'tg:1',Decimal(20),event,'owner',Decimal(1000));self.ledger.commit()
        self.assertEqual(self.backed(),Decimal(20));self.assertEqual(self.ledger.balance('tg:1','USDT'),before)
        self.assertEqual((await self.adjust('-5')).status,200)
        self.assertEqual(self.backed(),Decimal(15));self.assertEqual(self.ledger.balance('tg:1','USDT')[0],Decimal(15))
    async def test_insufficient_provider_reserve_rolls_back_entire_credit(self):
        self.aura.get_balance.return_value={'platform_balance':'19'}
        response=await self.adjust();self.assertEqual(response.status,409)
        self.assertEqual((await response.json())['error'],'AURA_TEST_RESERVE_INSUFFICIENT')
        self.assertEqual(self.backed(),Decimal(0));self.assertEqual(self.ledger.balance('tg:1','USDT')[0],Decimal(0))
        self.assertEqual(self.ledger.db.execute('SELECT count(*) FROM wallet_events').fetchone()[0],0)
    async def test_live_environment_never_automatically_allocates(self):
        self.aura.environment='live'
        self.assertEqual((await self.adjust()).status,200)
        self.assertEqual(self.backed(),Decimal(0));self.aura.get_balance.assert_not_awaited()
    async def test_non_admin_cannot_issue_a_credit_or_query_reserve(self):
        self.assertEqual((await self.adjust(admin=False)).status,403);self.aura.get_balance.assert_not_awaited()

    async def test_parallel_credits_cannot_overallocate_one_reserve(self):
        import asyncio
        self.aura.get_balance.return_value={'platform_balance':'30'}
        replies=await asyncio.gather(self.adjust(),self.adjust())
        self.assertEqual(sorted(r.status for r in replies),[200,409])
        self.assertEqual(self.backed(),Decimal(20));self.assertEqual(self.ledger.balance('tg:1','USDT')[0],Decimal(20))

    async def test_goswap_credit_checks_reserve_and_does_not_allocate_aura(self):
        import asyncio

        async def credit(operation_id):
            return await self.http.post('/adjust', json={
                'account_id': 'tg:1', 'asset': 'USDT', 'amount': '20',
                'reason': 'GoSwap reserve allocation', 'source': 'goswap',
                'operation_id': operation_id, 'network': 'BSC',
                'confirm': 'ADJUST tg:1 USDT 20 GOSWAP BSC',
            }, headers={'X-Test-Admin': 'yes'})

        first = "11111111-1111-4111-8111-111111111111"
        second = "22222222-2222-4222-8222-222222222222"
        replies = await asyncio.gather(credit(first), credit(second))
        self.assertEqual(sorted(reply.status for reply in replies), [200, 409])
        winner = first if replies[0].status == 200 else second
        self.assertEqual((await credit(winner)).status, 200)
        self.assertEqual(self.ledger.balance('tg:1', 'USDT')[0], Decimal('20'))
        self.assertEqual(self.backed(), Decimal('0'))
        self.aura.get_balance.assert_not_awaited()
        event = self.ledger.db.execute("SELECT detail FROM wallet_events").fetchone()
        self.assertEqual(json.loads(event['detail'])['source'], 'goswap')
        from wallet_operations import goswap_network_balances
        self.assertEqual(goswap_network_balances(self.ledger, 'tg:1', 'USDT'), {'BSC': Decimal('20')})
