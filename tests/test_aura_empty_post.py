import unittest
from aiohttp import web
from aiohttp.test_utils import TestClient,TestServer
from wallet_aura import AuraClient
from wallet_backend import ApiError


class EmptyPostTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async def probe(request):
            raw=await request.read()
            if request.method=='POST' and request.content_type!='application/json':
                return web.json_response({'error':{'code':'unsupported_media_type','type':'invalid_request_error','message':'JSON required','param':'Content-Type'}},status=415)
            return web.json_response({'body':await request.json() if raw else None,'content_type':request.content_type,'idempotency_key':request.headers.get('Idempotency-Key')})
        app=web.Application();app.router.add_route('*','/probe',probe)
        self.http=TestClient(TestServer(app));await self.http.start_server()
        self.client=AuraClient('ak_test_fixture','test',ApiError,base_url=str(self.http.make_url('')).rstrip('/'))

    async def asyncTearDown(self):
        await self.client.close();await self.http.close()

    async def test_parameterless_post_is_json_object(self):
        result=await self.client.request('POST','/probe')
        self.assertEqual(result['body'],{});self.assertEqual(result['content_type'],'application/json')

    async def test_console_uses_same_empty_json_contract(self):
        result=await self.client.diagnostic_request('POST','/probe')
        self.assertEqual(result['http_status'],200);self.assertEqual(result['body']['body'],{})

    async def test_explicit_monetary_payload_and_key_are_unchanged(self):
        result=await self.client.request('POST','/probe',body={'amount':'25'},idempotency_key='same-operation')
        self.assertEqual(result['body'],{'amount':'25'});self.assertEqual(result['idempotency_key'],'same-operation')
        result=await self.client.request('GET','/probe')
        self.assertIsNone(result['body'])
