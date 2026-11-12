import hashlib
import hmac
import json
import os
import tempfile
import time
import unittest
from urllib.parse import urlencode
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from wallet_backend import ApiError, Ledger, install_wallet, telegram_user

TOKEN = 'unit-test-provider-key'
BOT = 'unit-test-telegram-key'
OWNER = {'X-Board-Key': 'owner-test-key'}


def sign_body(body):
    return hmac.new(hashlib.sha256(TOKEN.encode()).digest(), body, hashlib.sha256).hexdigest()


def init_data(uid=123, age=0):
    values = {'auth_date': str(int(time.time()) - age), 'user': json.dumps({'id': uid})}
    secret = hmac.new(b'WebAppData', BOT.encode(), hashlib.sha256).digest()
    values['hash'] = hmac.new(secret, '\n'.join(f'{k}={values[k]}' for k in sorted(values)).encode(), hashlib.sha256).hexdigest()
    return urlencode(values)


class FakeProvider:
    def __init__(self, token):
        self.calls = []
        self.payments = []
        self.timeout_once = False

    async def call(self, method, data=None, post=False):
        self.calls.append((method, data, post))
        if method == 'getExchangeRates':
            return []
        if method == 'getCurrencies':
            return [{'code': 'USDT'}]
        if method == 'getDeposits':
            return {'items': []}
        if method == 'getQrPayments':
            return {'items': self.payments}
        if method == 'createQrQuote':
            return {'quote_id': 'q-one', 'amount': '9.13', 'asset': 'USDT', 'amount_rub': '700.00', 'merchant_name': 'Test shop', 'rate': '76.67', 'expires_at': '2099-01-01T00:00:00Z'}
        if method == 'payQr':
            if self.timeout_once:
                self.timeout_once = False
                raise ApiError('PROVIDER_TIMEOUT', 'timeout', 504)
            return {'payment_id': 'p-one', 'spend_id': data['spend_id'], 'status': 'processing', 'asset': 'USDT', 'amount': '9.13'}
        if method == 'createDeposit':
            return {'address': 'test-address', 'network': data['network'], 'url': 'https://goswap.site/pay?dep=test'}
        raise AssertionError('Unexpected provider call ' + method)

    async def close(self):
        pass


class AuthenticationTests(unittest.TestCase):
    def test_telegram_signature_and_expiry(self):
        self.assertEqual(telegram_user(init_data(), BOT), 'tg:123')
        self.assertIsNone(telegram_user(init_data(age=90000), BOT))
        self.assertIsNone(telegram_user(init_data(age=-100), BOT))
        self.assertIsNone(telegram_user(init_data() + '&auth_date=1', BOT))
        self.assertIsNone(telegram_user(init_data(), 'other-token'))

    def test_decimal_deposit_dust_is_not_lost(self):
        with tempfile.TemporaryDirectory() as path:
            ledger = Ledger(path + '/db')
            ref = ledger.account('one')
            payload = {'deposit_id': 'a', 'client_ref': ref, 'asset': 'ETH', 'credited': '123456789012.123456789012345678'}
            ledger.deposit(payload)
            ledger.deposit({**payload, 'deposit_id': 'b', 'credited': '0.000000000000000001'})
            self.assertEqual(str(ledger.balance('one', 'ETH')[0]), '123456789012.123456789012345679')
            ledger.db.close()


class WalletRoutesTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'GOSWAP_API_TOKEN': TOKEN, 'WPAY_BOT_TOKEN': BOT, 'WPAY_DB_PATH': self.tmp.name + '/db'})
        self.env.start()
        self.fake = patch('wallet_backend.GoSwap', FakeProvider)
        self.fake.start()
        self.app = web.Application()
        install_wallet(self.app, self.tmp.name, lambda key: key == 'owner-test-key')
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()
        self.ledger = self.app['wpay_ledger']
        self.provider = self.app['wpay_provider']

    async def asyncTearDown(self):
        await self.client.close()
        self.fake.stop()
        self.env.stop()
        self.tmp.cleanup()

    async def webhook(self, kind, payload, bad=False):
        raw = json.dumps({'update_type': kind, 'payload': payload}, indent=2).encode()
        return await self.client.post('/api/wallet/webhook', data=raw, headers={'crypto-pay-api-signature': 'wrong' if bad else sign_body(raw)})

    async def fund(self):
        ref = self.ledger.account('owner')
        payload = {'deposit_id': 'deposit-1', 'client_ref': ref, 'asset': 'USDT', 'credited': '100.00'}
        response = await self.webhook('deposit_received', payload)
        self.assertEqual(response.status, 200)
        return payload

    async def test_anonymous_and_member_cannot_read_or_spend(self):
        for headers in [{}, {'X-Board-Key': 'member'}, {'X-Telegram-Init-Data': init_data() + '&hash=forged'}]:
            response = await self.client.get('/api/wallet/overview', headers=headers)
            self.assertEqual(response.status, 401)
        self.assertEqual(self.provider.calls, [])

    async def test_raw_signature_and_duplicate_deposit(self):
        payload = await self.fund()
        self.assertEqual((await self.webhook('deposit_received', payload)).status, 200)
        self.assertEqual((await self.webhook('deposit_received', {**payload, 'credited': '900'}, bad=True)).status, 401)
        self.assertEqual(str(self.ledger.balance('owner', 'USDT')[0]), '100.00')
        self.assertEqual(self.ledger.db.execute('SELECT COUNT(*) FROM wallet_events').fetchone()[0], 1)
        foreign = await self.client.get('/api/wallet/overview', headers={'X-Telegram-Init-Data': init_data(999)})
        self.assertEqual((await foreign.json())['balances'], [])

    async def test_quote_ownership_reservation_completion_and_refund(self):
        await self.fund()
        response = await self.client.post('/api/wallet/quote', json={'qr': 'ST00012|test'}, headers=OWNER)
        quote = await response.json()
        foreign = await self.client.post('/api/wallet/pay', json={'quote_id': quote['quote_id']}, headers={'X-Telegram-Init-Data': init_data(999)})
        self.assertEqual(foreign.status, 404)
        for _ in range(2):
            self.assertEqual((await self.client.post('/api/wallet/pay', json={'quote_id': quote['quote_id']}, headers=OWNER)).status, 200)
        self.assertEqual(len([x for x in self.provider.calls if x[0] == 'payQr']), 1)
        self.assertEqual(tuple(map(str, self.ledger.balance('owner', 'USDT'))), ('90.87', '9.13'))
        payload = {'payment_id': 'p-one', 'spend_id': quote['spend_id'], 'asset': 'USDT', 'amount': '9.13', 'status': 'completed'}
        await self.webhook('qr_payment_completed', payload)
        await self.webhook('qr_payment_completed', payload)
        self.assertEqual(tuple(map(str, self.ledger.balance('owner', 'USDT'))), ('90.87', '0.00'))
        await self.webhook('qr_payment_refunded', {**payload, 'status': 'refunded'})
        await self.webhook('qr_payment_refunded', {**payload, 'status': 'refunded'})
        self.assertEqual(tuple(map(str, self.ledger.balance('owner', 'USDT'))), ('100.00', '0.00'))
        await self.webhook('qr_payment_completed', payload)
        self.assertEqual(str(self.ledger.balance('owner', 'USDT')[0]), '100.00')

    async def test_timeout_retry_keeps_same_spend_id(self):
        await self.fund()
        quote = await (await self.client.post('/api/wallet/quote', json={'qr': 'test'}, headers=OWNER)).json()
        self.provider.timeout_once = True
        response = await self.client.post('/api/wallet/pay', json={'quote_id': quote['quote_id']}, headers=OWNER)
        self.assertEqual(response.status, 504)
        self.assertEqual(tuple(map(str, self.ledger.balance('owner', 'USDT'))), ('90.87', '9.13'))
        await self.client.post('/api/wallet/pay', json={'quote_id': quote['quote_id']}, headers=OWNER)
        spends = [x[1]['spend_id'] for x in self.provider.calls if x[0] == 'payQr']
        self.assertEqual(spends, [quote['spend_id'], quote['spend_id']])
        self.assertEqual(str(self.ledger.balance('owner', 'USDT')[0]), '90.87')

    async def test_deposit_identity_is_server_owned(self):
        response = await self.client.post('/api/wallet/deposit', json={'asset': 'USDT', 'network': 'BSC', 'client_ref': 'attacker'}, headers=OWNER)
        self.assertEqual(response.status, 200)
        call = [x for x in self.provider.calls if x[0] == 'createDeposit'][0]
        self.assertEqual(call[1]['client_ref'], self.ledger.account('owner'))
        response = await self.client.post('/api/wallet/deposit', json={'asset': 'BTC', 'network': 'BSC'}, headers=OWNER)
        self.assertEqual(response.status, 400)


if __name__ == '__main__':
    unittest.main()
