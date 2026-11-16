import hashlib
import hmac
import json
import os
import sqlite3
import tempfile
import time
import unittest
from decimal import Decimal
from urllib.parse import urlencode
from unittest.mock import patch

from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from wallet_backend import ApiError, Ledger, install_wallet, telegram_user
from wallet_operations import prepare_operations, save_address

TOKEN = 'unit-test-provider-key'
BOT = 'unit-test-telegram-key'
OWNER = {'X-Board-Key': 'owner-test-key'}


def sign_body(body):
    return hmac.new(hashlib.sha256(TOKEN.encode()).digest(), body, hashlib.sha256).hexdigest()


def init_data(uid=123, age=0, user=None, start_param=None):
    profile = {'id': uid, **(user or {})}
    values = {'auth_date': str(int(time.time()) - age), 'user': json.dumps(profile)}
    if start_param is not None:
        values['start_param'] = start_param
    secret = hmac.new(b'WebAppData', BOT.encode(), hashlib.sha256).digest()
    values['hash'] = hmac.new(secret, '\n'.join(f'{k}={values[k]}' for k in sorted(values)).encode(), hashlib.sha256).hexdigest()
    return urlencode(values)


class FakeProvider:
    def __init__(self, token):
        self.calls = []
        self.payments = []
        self.timeout_once = False
        self.transfer_status = 'pending'

    async def call(self, method, data=None, post=False):
        self.calls.append((method, data, post))
        if method == 'getMe':
            return {'name': 'Test', 'can_transfer': True, 'can_withdraw': False}
        if method == 'getBalance':
            return [{'currency_code': 'USDT', 'available': getattr(self,'organization_balance','10')}]
        if method == 'getInvoices':
            return {'items': [{'invoice_id': '101', 'status': 'active'}, {'invoice_id': '999', 'status': 'paid'}]}
        if method == 'getTransfers':
            return {'items': [{'spend_id': 'owner-payout', 'status': self.transfer_status, 'amount': '10', 'asset': 'USDT'}]}
        if method == 'revokeTransfer':
            self.transfer_status = 'reverted'
            return {'spend_id': data['spend_id'], 'status': 'reverted'}
        if method == 'getWithdrawals':
            return {'items': []}
        if method == 'getTransactions':
            return {'items': [{'id': 1, 'asset': 'USDT', 'net': '10'}], 'has_more': False, 'cursor': 1}
        if method == 'getClientAddress':
            return {'address': 'test-address', 'network': data['network'], 'client_ref': data['client_ref'], 'min_deposit': '1'}
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
        if method == 'createWithdrawal':
            return {'withdrawal_id': 'withdrawal-one', 'spend_id': data['spend_id'], 'status': 'processing'}
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

    def test_address_migration_preserves_network_identity_and_asset_support(self):
        with tempfile.TemporaryDirectory() as path:
            ledger = Ledger(path + '/db')
            ledger.db.execute('CREATE TABLE wallet_addresses (user_id TEXT, asset TEXT, network TEXT, body TEXT, PRIMARY KEY(user_id,asset,network))')
            for asset in ['ETH', 'USDT']:
                ledger.db.execute('INSERT INTO wallet_addresses VALUES (?,?,?,?)', ('tg:1', asset, 'ETH', json.dumps({'network': 'ETH', 'address': 'shared', 'asset': asset})))
            prepare_operations(ledger)
            rows = ledger.db.execute('SELECT body FROM wallet_addresses WHERE user_id=?', ('tg:1',)).fetchall()
            self.assertEqual(len(rows), 1)
            self.assertEqual(json.loads(rows[0]['body'])['assets'], ['ETH', 'USDT'])
            prepare_operations(ledger)
            self.assertEqual(ledger.db.execute('SELECT COUNT(*) FROM wallet_addresses').fetchone()[0], 1)
            ledger.db.close()

    def test_legacy_accounts_are_migrated_and_rich_profiles_are_kept(self):
        with tempfile.TemporaryDirectory() as path:
            database = path + '/db'
            db = sqlite3.connect(database)
            db.execute('CREATE TABLE wallet_accounts (user_id TEXT PRIMARY KEY, client_ref TEXT UNIQUE NOT NULL)')
            db.execute("INSERT INTO wallet_accounts VALUES ('tg:777','legacy-ref')")
            db.commit()
            db.close()
            ledger = Ledger(database)
            ledger.account('tg:777', {
                'id': 777, 'username': 'tester', 'first_name': 'Test', 'last_name': 'User',
                'language_code': 'ru', 'is_premium': True, 'photo_url': 'https://example.test/avatar.jpg',
                'added_to_attachment_menu': True, 'allows_write_to_pm': True,
            }, bot_started=True, source='bot', start_param='franchise-one')
            row = ledger.db.execute("SELECT * FROM wallet_accounts WHERE user_id='tg:777'").fetchone()
            self.assertEqual(row['telegram_id'], 777)
            self.assertEqual(row['telegram_username'], 'tester')
            self.assertEqual(row['first_name'], 'Test')
            self.assertEqual(row['language_code'], 'ru')
            self.assertEqual(row['is_premium'], 1)
            self.assertEqual(row['allows_write_to_pm'], 1)
            self.assertEqual(row['first_start_param'], 'franchise-one')
            self.assertIsNotNone(row['bot_started_at'])
            self.assertIsNone(row['created_at'])
            ledger.db.close()


class WalletRoutesTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'GOSWAP_API_TOKEN': TOKEN, 'WPAY_BOT_TOKEN': BOT, 'WPAY_DB_PATH': self.tmp.name + '/db', 'WPAY_ADMIN_IDS': '321', 'WPAY_FINANCE_WORKER': '0'})
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
        self.provider.organization_balance='100.00'
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

    async def test_signed_miniapp_profile_and_acquisition_are_persisted(self):
        profile = {
            'first_name': 'Alice', 'last_name': 'Example', 'username': 'alice',
            'language_code': 'ru', 'is_premium': True, 'allows_write_to_pm': True,
            'photo_url': 'https://example.test/alice.jpg',
        }
        headers = {'X-Telegram-Init-Data': init_data(555, user=profile, start_param='partner-42')}
        response = await self.client.get('/api/wallet/access', headers=headers)
        self.assertEqual(response.status, 200)
        row = self.ledger.db.execute("SELECT * FROM wallet_accounts WHERE user_id='tg:555'").fetchone()
        self.assertEqual(row['telegram_username'], 'alice')
        self.assertEqual(row['first_name'], 'Alice')
        self.assertEqual(row['language_code'], 'ru')
        self.assertEqual(row['is_premium'], 1)
        self.assertEqual(row['first_start_param'], 'partner-42')
        self.assertIsNotNone(row['last_miniapp_at'])

    async def test_referral_link_attributes_only_a_new_account_once(self):
        owner = {'X-Telegram-Init-Data': init_data(700, user={'first_name': 'Owner'})}
        response = await self.client.get('/api/wallet/referrals', headers=owner)
        self.assertEqual(response.status, 200)
        program = await response.json()
        self.assertRegex(program['link'], r'^https://t\.me/Workingpaybot\?start=ref_[A-Za-z0-9]{10,24}$')

        invited = {'X-Telegram-Init-Data': init_data(
            701, user={'first_name': 'Friend'}, start_param=program['start_param']
        )}
        self.assertEqual((await self.client.get('/api/wallet/access', headers=invited)).status, 200)
        referral = self.ledger.db.execute(
            "SELECT * FROM wallet_referrals WHERE referred_user_id='tg:701'"
        ).fetchone()
        self.assertEqual(referral['referrer_user_id'], 'tg:700')

        other = {'X-Telegram-Init-Data': init_data(702)}
        other_program = await (await self.client.get('/api/wallet/referrals', headers=other)).json()
        replacement = {'X-Telegram-Init-Data': init_data(701, start_param=other_program['start_param'])}
        await self.client.get('/api/wallet/access', headers=replacement)
        referral = self.ledger.db.execute(
            "SELECT * FROM wallet_referrals WHERE referred_user_id='tg:701'"
        ).fetchone()
        self.assertEqual(referral['referrer_user_id'], 'tg:700')
        summary = await (await self.client.get('/api/wallet/referrals', headers=owner)).json()
        self.assertEqual(summary['invited'], 1)
        self.assertFalse(summary['rewards_enabled'])

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

    async def test_admin_overview_is_allowlisted_and_exact(self):
        self.ledger.account('tg:321')
        self.ledger.put_balance('tg:321', 'USDT', Decimal('1.000000000000000001'), Decimal('0.2'))
        denied = await self.client.get('/api/wallet/admin-overview', headers={'X-Telegram-Init-Data': init_data(999)})
        self.assertEqual(denied.status, 403)
        response = await self.client.get('/api/wallet/admin-overview', headers={'X-Telegram-Init-Data': init_data(321)})
        self.assertEqual(response.status, 200)
        result = await response.json()
        self.assertEqual(result['users'], 2)
        self.assertEqual(result['liabilities'][0]['total'], '1.200000000000000001')
        self.assertEqual(result['provider']['balance'][0]['available'], '10')
        self.assertTrue((await (await self.client.get('/api/wallet/access', headers={'X-Telegram-Init-Data': init_data(321)})).json())['owner'])
        admin_headers = {'X-Telegram-Init-Data': init_data(321)}
        for action in ['admin-users', 'admin-database', 'admin-payments', 'admin-crypto', 'admin-goswap', 'admin-broadcasts', 'admin-notifications', 'admin-audit', 'admin-cards']:
            self.assertEqual((await self.client.get('/api/wallet/' + action, headers=admin_headers)).status, 200)
            self.assertEqual((await self.client.get('/api/wallet/' + action, headers={'X-Telegram-Init-Data': init_data(999)})).status, 403)

    async def test_admin_user_detail_enriches_aura_and_masks_contacts(self):
        uid = 'tg:555'
        self.ledger.account(uid, {'first_name': 'Test', 'username': 'tester'})
        stamp = time.time()
        customer_id = 'wpay-admin-user-test'
        self.ledger.db.execute(
            'INSERT INTO wallet_profile_contacts VALUES (?,?,?,?,?)',
            (uid, 'test', 'secret@example.com', '+79991234567', stamp),
        )
        self.ledger.db.execute(
            'INSERT INTO aura_customers VALUES (?,?,?,?,?,?,?,?,?)',
            (uid, customer_id, 'test', 'registered', None, None, None, stamp, stamp),
        )
        self.ledger.db.execute(
            'INSERT INTO aura_kyc_cases VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            (uid, customer_id, 'test', 'pending', 0, 0, None, None, '{}', stamp, stamp - 90000),
        )
        self.ledger.db.execute(
            'INSERT INTO aura_cards '
            '(card_id,user_id,customer_id,environment,kind,status,frozen,masked_pan,'
            'delivery_status,tracking,provider_updated_at,body,created_at,updated_at) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            ('card-admin-test', uid, customer_id, 'test', 'virtual', 'opened', 0,
             '411111******1234', None, None, None, '{}', stamp, stamp),
        )
        admin = {'X-Telegram-Init-Data': init_data(321)}
        users = await self.client.get('/api/wallet/admin-users', headers=admin)
        self.assertEqual(users.status, 200, await users.text())
        item = next(row for row in (await users.json())['items'] if row['user_id'] == uid)
        self.assertEqual(item['aura_customer_id'], customer_id)
        self.assertEqual(item['kyc_status'], 'pending')
        self.assertEqual(item['card_count'], 1)
        detail = await self.client.get(
            '/api/wallet/admin-user?user_id=' + uid, headers=admin,
        )
        self.assertEqual(detail.status, 200, await detail.text())
        raw = await detail.text()
        self.assertNotIn('secret@example.com', raw)
        self.assertNotIn('+79991234567', raw)
        body = json.loads(raw)
        self.assertEqual(body['contacts']['email'], 'se***@example.com')
        self.assertTrue(body['contacts']['phone'].endswith('67'))
        self.assertEqual(body['aura']['cards'][0]['masked_pan'], '411111******1234')
        cards = await self.client.get('/api/wallet/admin-cards', headers=admin)
        self.assertEqual(cards.status, 200, await cards.text())
        card_body = await cards.json()
        self.assertEqual(card_body['total'], 1)
        self.assertEqual(card_body['items'][0]['user_id'], uid)
        self.assertEqual(card_body['items'][0]['masked_pan'], '411111******1234')
        self.assertNotIn('body', card_body['items'][0])
        denied = await self.client.get(
            '/api/wallet/admin-user?user_id=' + uid,
            headers={'X-Telegram-Init-Data': init_data(999)},
        )
        self.assertEqual(denied.status, 403)
        overview = await (await self.client.get(
            '/api/wallet/admin-overview', headers=admin,
        )).json()
        kyc_problem = next(row for row in overview['problems']['items'] if row['kind'] == 'kyc')
        self.assertEqual(kyc_problem['count'], 1)

    async def test_admin_user_actions_are_scoped_and_audited_without_content(self):
        from wallet_notifications import enqueue
        admin = {'X-Telegram-Init-Data': init_data(321)}
        member = {'X-Telegram-Init-Data': init_data(999)}
        uid = 'tg:777'
        self.ledger.account(uid, bot_started=True, source='bot')
        self.assertTrue(enqueue(
            self.ledger, 'test:retry:one', uid, 'deposit',
            'Sensitive title', 'Sensitive notification body',
        ))
        self.ledger.db.execute(
            "UPDATE notification_outbox SET status='failed',last_error='private provider error' "
            "WHERE user_id=?", (uid,),
        )
        denied = await self.client.post('/api/wallet/admin-user-action', json={
            'user_id': uid, 'operation': 'retry_notifications',
        }, headers=member)
        self.assertEqual(denied.status, 403)
        response = await self.client.post('/api/wallet/admin-user-action', json={
            'user_id': uid, 'operation': 'retry_notifications',
        }, headers=admin)
        self.assertEqual(response.status, 200, await response.text())
        self.assertEqual((await response.json())['queued'], 1)
        self.assertEqual(self.ledger.db.execute(
            'SELECT status FROM notification_outbox WHERE user_id=?', (uid,),
        ).fetchone()[0], 'queued')
        audit_response = await self.client.get(
            '/api/wallet/admin-audit?user_id=' + uid, headers=admin,
        )
        self.assertEqual(audit_response.status, 200, await audit_response.text())
        raw = await audit_response.text()
        self.assertNotIn('Sensitive title', raw)
        self.assertNotIn('Sensitive notification body', raw)
        self.assertNotIn('private provider error', raw)
        audit = json.loads(raw)
        self.assertEqual(audit['total'], 1)
        self.assertEqual(audit['items'][0]['action'], 'user.retry_notifications')
        self.assertEqual(audit['items'][0]['detail'], {'queued': 1})
        detail = await (await self.client.get(
            '/api/wallet/admin-user?user_id=' + uid, headers=admin,
        )).json()
        self.assertEqual(detail['audit'][0]['outcome'], 'succeeded')

    async def test_notification_center_settings_and_deduped_deposit(self):
        admin = {'X-Telegram-Init-Data': init_data(321)}
        self.ledger.account('tg:123', bot_started=True, source='bot')
        response = await self.client.post('/api/wallet/admin-notifications', json={
            'operation': 'settings', 'settings': {'deposit': False},
        }, headers=admin)
        self.assertEqual(response.status, 200)
        settings = {row['event_type']: row['enabled'] for row in (await response.json())['settings']}
        self.assertEqual(settings['deposit'], 0)
        response = await self.client.post('/api/wallet/admin-notifications', json={
            'operation': 'settings', 'settings': {'deposit': True},
        }, headers=admin)
        self.assertEqual(response.status, 200)
        from wallet_notifications import enqueue
        self.assertTrue(enqueue(self.ledger, 'test:deposit:one', 'tg:123', 'deposit', 'Пополнение', 'Зачислено 1 USDT.'))
        self.assertFalse(enqueue(self.ledger, 'test:deposit:one', 'tg:123', 'deposit', 'Пополнение', 'Зачислено 1 USDT.'))
        center = await (await self.client.get('/api/wallet/admin-notifications', headers=admin)).json()
        self.assertEqual(center['counts']['queued'], 1)
        self.assertEqual(center['eligible_users'], 1)

    async def test_admin_goswap_console_is_allowlisted_and_confirmed(self):
        admin = {'X-Telegram-Init-Data': init_data(321)}
        denied = await self.client.post('/api/wallet/admin-goswap-action', json={'method': 'getBalance', 'params': {}}, headers={'X-Telegram-Init-Data': init_data(999)})
        self.assertEqual(denied.status, 403)
        unknown = await self.client.post('/api/wallet/admin-goswap-action', json={'method': 'deleteEverything', 'params': {}}, headers=admin)
        self.assertEqual(unknown.status, 400)
        bad_param = await self.client.post('/api/wallet/admin-goswap-action', json={'method': 'getBalance', 'params': {'token': 'leak'}}, headers=admin)
        self.assertEqual(bad_param.status, 400)
        missing = await self.client.post('/api/wallet/admin-goswap-action', json={'method': 'createWithdrawal', 'params': {}}, headers=admin)
        self.assertEqual(missing.status, 400)
        params = {'asset': 'USDT', 'network': 'BSC', 'address': '0xabc', 'amount': '1', 'spend_id': 'admin-test-1'}
        unconfirmed = await self.client.post('/api/wallet/admin-goswap-action', json={'method': 'createWithdrawal', 'params': params}, headers=admin)
        self.assertEqual(unconfirmed.status, 409)
        confirmed = await self.client.post('/api/wallet/admin-goswap-action', json={'method': 'createWithdrawal', 'params': params, 'confirm': 'createWithdrawal'}, headers=admin)
        self.assertEqual(confirmed.status, 200)
        self.assertEqual((await confirmed.json())['result']['status'], 'processing')
        self.assertEqual(self.provider.calls[-1], ('createWithdrawal', params, True))

    async def test_admin_can_leave_only_usdt_trc20_and_server_enforces_it(self):
        admin = {'X-Telegram-Init-Data': init_data(321)}
        member = {'X-Telegram-Init-Data': init_data(999)}
        denied = await self.client.post(
            '/api/wallet/admin-assets', json={'preset': 'usdt_trc20_only'},
            headers=member,
        )
        self.assertEqual(denied.status, 403)
        before = await self.client.get('/api/wallet/admin-crypto', headers=admin)
        self.assertGreater(len((await before.json())['asset_routes']), 1)
        applied = await self.client.post(
            '/api/wallet/admin-assets', json={'preset': 'usdt_trc20_only'},
            headers=admin,
        )
        self.assertEqual(applied.status, 200, await applied.text())
        enabled = (await applied.json())['enabled']
        self.assertEqual(enabled, {'USDT': ['TRON']})
        status = await self.client.get('/api/wallet/status')
        self.assertEqual((await status.json())['asset_routes'], {'USDT': ['TRON']})
        blocked = await self.client.post(
            '/api/wallet/deposit', json={'asset': 'ETH', 'network': 'ETH'},
            headers=member,
        )
        self.assertEqual(blocked.status, 403)
        self.assertEqual((await blocked.json())['error']['name'], 'ASSET_DISABLED')


class OperationRoutesTests(unittest.IsolatedAsyncioTestCase):
    asyncSetUp = WalletRoutesTests.asyncSetUp
    asyncTearDown = WalletRoutesTests.asyncTearDown
    async def test_organization_history_requires_owner(self):
        user = {'X-Telegram-Init-Data': init_data(123)}
        for action in ['operations-invoices', 'operations-transfers', 'operations-withdrawals']:
            response = await self.client.get('/api/wallet/' + action, headers=user)
            self.assertEqual(response.status, 200)
            self.assertEqual((await response.json())['items'], [])
        self.assertEqual(self.provider.calls, [])
        for action in ['provider', 'operations-reconciliation']:
            self.assertEqual((await self.client.get('/api/wallet/' + action, headers=user)).status, 403)
        self.assertEqual((await self.client.get('/api/wallet/operations-invoices', headers=OWNER)).status, 200)
        self.assertEqual((await self.client.get('/api/wallet/access', headers=user)).status, 200)
        self.assertFalse((await (await self.client.get('/api/wallet/access', headers=user)).json())['owner'])

    async def test_invoice_ownership_filters_provider_response(self):
        self.ledger.db.execute('INSERT INTO wallet_events VALUES (?,?,?,?,?,?,?)', ('invoice-test', 'tg:123', 'USDT', '0', 'invoice', '2026-11-13', json.dumps({'operation_kind': 'invoices', 'invoice_id': '101'})))
        response = await self.client.get('/api/wallet/operations-invoices?invoice_ids=999', headers={'X-Telegram-Init-Data': init_data(123)})
        self.assertEqual([row['invoice_id'] for row in (await response.json())['items']], ['101'])
        self.assertEqual(self.provider.calls[-1][1]['invoice_ids'], '101')

    async def test_owner_revoke_rechecks_status_and_is_not_client_refund(self):
        response = await self.client.post('/api/wallet/revoke-transfer', json={'spend_id': 'owner-payout'}, headers={'X-Telegram-Init-Data': init_data(123)})
        self.assertEqual(response.status, 403)
        self.assertEqual(self.provider.calls, [])
        self.provider.transfer_status = 'completed'
        self.assertEqual((await self.client.post('/api/wallet/revoke-transfer', json={'spend_id': 'owner-payout'}, headers=OWNER)).status, 409)
        self.provider.transfer_status = 'pending'
        response = await self.client.post('/api/wallet/revoke-transfer', json={'spend_id': 'owner-payout'}, headers=OWNER)
        self.assertEqual((await response.json())['status'], 'reverted')
        self.assertEqual(str(self.ledger.balance('owner', 'USDT')[0]), '0')

    async def test_pagination_and_reconciliation_cursor(self):
        self.assertEqual((await self.client.get('/api/wallet/operations-invoices?offset=-1', headers=OWNER)).status, 400)
        response = await self.client.get('/api/wallet/operations-reconciliation?before=55&count=9999', headers=OWNER)
        self.assertEqual(response.status, 200)
        self.assertEqual(self.provider.calls[-1], ('getTransactions', {'count': 100, 'before': 55}, False))

    async def test_saved_addresses_are_isolated_and_server_scoped(self):
        user = {'X-Telegram-Init-Data': init_data(123)}
        response = await self.client.post('/api/wallet/address', json={'network': 'BSC', 'client_ref': 'foreign'}, headers=user)
        self.assertEqual(response.status, 200)
        self.assertNotEqual(self.provider.calls[-1][1]['client_ref'], 'foreign')
        rows = await (await self.client.get('/api/wallet/addresses', headers=user)).json()
        self.assertEqual(len(rows['items']), 1)
        foreign = await (await self.client.get('/api/wallet/addresses', headers={'X-Telegram-Init-Data': init_data(999)})).json()
        self.assertEqual(foreign['items'], [])
        self.assertEqual((await self.client.post('/api/wallet/address', json={'network': 'TRON'}, headers=user)).status, 400)

    async def test_permanent_address_does_not_silently_use_another_asset(self):
        user = {'X-Telegram-Init-Data': init_data(123)}
        response = await self.client.post('/api/wallet/address', json={'network': 'ETH', 'asset': 'ETH'}, headers=user)
        self.assertEqual(response.status, 400)
        await self.client.post('/api/wallet/address', json={'network': 'ETH', 'asset': 'USDT'}, headers=user)
        rows = await (await self.client.get('/api/wallet/addresses', headers=user)).json()
        self.assertEqual(rows['items'][0]['asset'], 'USDT')

    async def test_full_audit_is_owner_only_and_compares_exact_net(self):
        self.assertEqual((await self.client.get('/api/wallet/provider-audit', headers={'X-Telegram-Init-Data': init_data(123)})).status, 403)
        response = await self.client.get('/api/wallet/provider-audit', headers=OWNER)
        result = await response.json()
        self.assertTrue(result['complete'])
        self.assertTrue(result['stable'])
        self.assertEqual(result['items'][0]['difference'], '0')

    async def test_audit_pagination_deduplication_and_changing_balance(self):
        original = self.provider.call
        balance_calls = 0
        async def scripted(method, data=None, post=False):
            nonlocal balance_calls
            if method == 'getBalance':
                balance_calls += 1
                return [{'currency_code': 'USDT', 'available': '30' if balance_calls == 1 else '31'}]
            if method == 'getTransactions':
                if data['after'] == 0:
                    return {'items': [{'id': 1, 'asset': 'USDT', 'net': '10'}], 'has_more': True, 'cursor': 1}
                self.assertEqual(data['after'], 1)
                return {'items': [{'id': 1, 'asset': 'USDT', 'net': '10'}, {'id': 2, 'asset': 'USDT', 'net': '20'}], 'has_more': False, 'cursor': 2}
            return await original(method, data, post)
        self.provider.call = scripted
        result = await (await self.client.get('/api/wallet/provider-audit', headers=OWNER)).json()
        self.assertEqual(result['entries'], 2)
        self.assertEqual(result['items'][0]['net'], '30')
        self.assertIsNone(result['items'][0]['difference'])
        self.assertFalse(result['stable'])

    async def test_deposit_history_cannot_select_another_client(self):
        original = self.provider.call
        async def scripted(method, data=None, post=False):
            if method == 'getDeposits':
                self.assertEqual(data['client_ref'], self.ledger.account('tg:123'))
                return {'items': [{'deposit_id': 'mine', 'client_ref': data['client_ref']}, {'deposit_id': 'foreign', 'client_ref': 'other'}]}
            return await original(method, data, post)
        self.provider.call = scripted
        response = await self.client.get('/api/wallet/operations-deposits?client_ref=other', headers={'X-Telegram-Init-Data': init_data(123)})
        self.assertEqual([row['deposit_id'] for row in (await response.json())['items']], ['mine'])

    async def withdrawal_fixture(self, network='BSC'):
        original = self.provider.call
        self.withdrawal_rows = {}
        self.withdrawal_timeout = False
        self.withdrawal_create_calls = []
        async def scripted(method, data=None, post=False):
            if method == 'getMe': return {'can_withdraw':True}
            if method == 'getBalance': return [{'currency_code':'USDT','available':'100'}]
            if method == 'getCurrencies': return [{'code': 'USDT', 'can_withdraw': True}]
            if method == 'estimateWithdrawal': return {**data, 'fee': '1', 'total': str(Decimal(data['amount'])+1)}
            if method == 'createWithdrawal':
                self.withdrawal_create_calls.append(data)
                row = self.withdrawal_rows.setdefault(data['spend_id'], {**data, 'fee': '1', 'withdrawal_id': 'withdrawal-one', 'version': 0, 'status': 'processing'})
                if self.withdrawal_timeout:
                    self.withdrawal_timeout = False
                    raise ApiError('PROVIDER_TIMEOUT', 'timeout', 504)
                return row
            if method == 'getWithdrawals':
                ids = data.get('spend_id', '').split(',')
                return {'items': [row for key,row in self.withdrawal_rows.items() if key in ids]}
            return await original(method, data, post)
        self.provider.call = scripted
        user = {'X-Telegram-Init-Data': init_data(123)}
        self.ledger.deposit({'client_ref': self.ledger.account('tg:123'), 'deposit_id': 'funds', 'asset': 'USDT', 'credited': '100'})
        response = await self.client.post('/api/wallet/withdrawal-estimate', json={'asset':'USDT', 'network':network, 'address':('T'+'a'*33) if network=='TRON' else ('0x'+'a'*40), 'amount':'10'}, headers=user)
        self.assertEqual(response.status, 200, await response.text())
        return user, await response.json()

    async def test_withdrawal_retry_reserves_once_and_refund_is_verified(self):
        user, quote = await self.withdrawal_fixture()
        self.withdrawal_timeout = True
        response = await self.client.post('/api/wallet/withdrawal-create', json={'intent_id':quote['intent_id']}, headers=user)
        self.assertEqual(response.status, 504)
        self.assertEqual(self.ledger.balance('tg:123','USDT'), (Decimal('89'),Decimal('11')))
        response = await self.client.post('/api/wallet/withdrawal-create', json={'intent_id':quote['intent_id']}, headers=user)
        result = await response.json()
        self.assertEqual(response.status, 200)
        self.assertEqual(self.withdrawal_create_calls[0]['spend_id'],self.withdrawal_create_calls[1]['spend_id'])
        self.assertEqual(self.withdrawal_create_calls[1]['max_fee'],'1')
        self.withdrawal_rows[result['spend_id']].update(status='completed',version=2)
        raw=json.dumps({'update_type':'withdrawal_failed','payload':{**result,'status':'failed','version':1}}).encode()
        signature=hmac.new(hashlib.sha256(TOKEN.encode()).digest(),raw,hashlib.sha256).hexdigest()
        self.assertEqual((await self.client.post('/api/wallet/webhook',data=raw,headers={'crypto-pay-api-signature':signature})).status,200)
        self.assertEqual(self.ledger.balance('tg:123','USDT'),(Decimal('89'),Decimal('0')))
        await self.client.post('/api/wallet/webhook',data=raw,headers={'crypto-pay-api-signature':signature})
        self.assertEqual(self.ledger.balance('tg:123','USDT'),(Decimal('89'),Decimal('0')))

    async def test_corrected_withdrawal_cannot_create_spendable_refund(self):
        from wallet_withdrawals import debt
        user, quote = await self.withdrawal_fixture()
        response=await self.client.post('/api/wallet/withdrawal-create',json={'intent_id':quote['intent_id']},headers=user)
        result=await response.json()
        self.withdrawal_rows[result['spend_id']].update(status='failed',version=1)
        await self.client.get('/api/wallet/withdrawal-history',headers=user)
        self.assertEqual(self.ledger.balance('tg:123','USDT'),(Decimal('100'),Decimal('0')))
        self.ledger.put_balance('tg:123','USDT',Decimal('2'),Decimal('0'))
        self.withdrawal_rows[result['spend_id']].update(status='completed',version=2)
        await self.client.get('/api/wallet/withdrawal-history',headers=user)
        self.assertEqual(self.ledger.balance('tg:123','USDT'),(Decimal('0'),Decimal('0')))
        self.assertEqual(debt(self.ledger,'tg:123','USDT'),Decimal('9'))
        self.ledger.deposit({'client_ref':self.ledger.account('tg:123'),'deposit_id':'repay','asset':'USDT','credited':'5'})
        self.assertEqual(debt(self.ledger,'tg:123','USDT'),Decimal('4'))
        self.assertEqual(self.ledger.balance('tg:123','USDT'),(Decimal('0'),Decimal('0')))

    async def test_withdrawal_intents_are_owned_and_reject_obsolete_source_parameter(self):
        user, quote=await self.withdrawal_fixture()
        foreign={'X-Telegram-Init-Data':init_data(999)}
        response=await self.client.post('/api/wallet/withdrawal-create',json={'intent_id':quote['intent_id']},headers=foreign)
        self.assertEqual(response.status,404)
        response=await self.client.post('/api/wallet/withdrawal-estimate',json={'asset':'USDT','network':'BSC','source_address':'foreign','address':'0x'+'a'*40,'amount':'10'},headers=user)
        self.assertEqual(response.status,400)
        self.assertEqual(self.ledger.balance('tg:123','USDT'),(Decimal('100'),Decimal('0')))

    async def test_retry_after_reaches_client(self):
        async def unavailable(*args,**kwargs): raise ApiError('UNAVAILABLE','Адрес готовится',503,retry_after='17')
        self.provider.call=unavailable
        response=await self.client.post('/api/wallet/address',json={'network':'TON'},headers={'X-Telegram-Init-Data':init_data(123)})
        self.assertEqual(response.status,503)
        self.assertEqual(response.headers['Retry-After'],'17')

    async def test_audit_follows_empty_pages_and_resumes_saved_cursor(self):
        original=self.provider.call
        seen=[]
        async def scripted(method,data=None,post=False):
            if method=='getTransactions':
                seen.append(data['after'])
                if data['after']==0:return {'items':[],'cursor':5,'has_more':True}
                if data['after']==5:return {'items':[{'id':9,'asset':'USDT','net':'10'}],'cursor':9,'has_more':False}
                return {'items':[],'cursor':9,'has_more':False}
            return await original(method,data,post)
        self.provider.call=scripted
        for _ in range(2):
            response=await self.client.get('/api/wallet/provider-audit',headers=OWNER)
            result=await response.json()
            self.assertEqual(response.status,200,result)
            self.assertEqual(result['entries'],1)
            self.assertEqual(result['items'][0]['difference'],'0')
        self.assertEqual(seen,[0,5,9])

    async def test_fee_rejection_releases_reserve_and_cannot_reuse_rejected_intent(self):
        user,quote=await self.withdrawal_fixture()
        original=self.provider.call
        async def scripted(method,data=None,post=False):
            if method=='createWithdrawal':raise ApiError('FEE_CHANGED','Комиссия изменилась',409)
            return await original(method,data,post)
        self.provider.call=scripted
        for _ in range(2):
            response=await self.client.post('/api/wallet/withdrawal-create',json={'intent_id':quote['intent_id']},headers=user)
            self.assertEqual(response.status,409)
            self.assertEqual(self.ledger.balance('tg:123','USDT'),(Decimal('100'),Decimal('0')))

    async def test_withdrawal_reservation_includes_fee_and_parallel_retries_do_not_duplicate(self):
        import asyncio
        user,quote=await self.withdrawal_fixture()
        self.ledger.put_balance('tg:123','USDT',Decimal('10'),Decimal('0'))
        response=await self.client.post('/api/wallet/withdrawal-create',json={'intent_id':quote['intent_id']},headers=user)
        self.assertEqual(response.status,409)
        self.assertEqual(len(self.withdrawal_create_calls),0)
        self.ledger.put_balance('tg:123','USDT',Decimal('100'),Decimal('0'))
        responses=await asyncio.gather(*[self.client.post('/api/wallet/withdrawal-create',json={'intent_id':quote['intent_id']},headers=user) for _ in range(2)])
        self.assertEqual([row.status for row in responses],[200,200])
        self.assertEqual(len(self.withdrawal_create_calls),1)
        self.assertEqual(self.ledger.balance('tg:123','USDT'),(Decimal('89'),Decimal('11')))

    async def test_exact_tron_rejects_invalid_precision_before_provider(self):
        user={'X-Telegram-Init-Data':init_data(123)}
        for amount in ['0.9','1.0000001']:
            response=await self.client.post('/api/wallet/deposit',json={'asset':'USDT','network':'TRON','amount':amount},headers=user)
            self.assertEqual(response.status,400)
        self.assertFalse(any(call[0]=='createExactDeposit' for call in self.provider.calls))

    async def test_deposit_sync_continues_after_short_page_and_deduplicates(self):
        original=self.provider.call
        seen=[]
        async def scripted(method,data=None,post=False):
            if method=='getDeposits':
                seen.append(data['offset'])
                item={'deposit_id':'single','asset':'USDT','credited':'7','client_ref':data['client_ref']}
                return {'items':[item] if data['offset'] in [0,1000] else []}
            return await original(method,data,post)
        self.provider.call=scripted
        response=await self.client.post('/api/wallet/sync',json={},headers={'X-Telegram-Init-Data':init_data(123)})
        self.assertEqual(response.status,200)
        self.assertTrue((await response.json())['sync_complete'])
        self.assertEqual(seen,[0,1000,2000])
        self.assertEqual(self.ledger.balance('tg:123','USDT'),(Decimal('7'),Decimal('0')))

    async def test_tron_withdrawal_uses_global_balance_without_any_deposit_address(self):
        user,quote=await self.withdrawal_fixture('TRON')
        self.assertEqual(self.ledger.db.execute('SELECT COUNT(*) FROM wallet_addresses').fetchone()[0],0)
        self.assertFalse(any(call[0]=='getClientAddress' for call in self.provider.calls))
        canonical=json.loads(self.ledger.db.execute('SELECT body FROM wallet_withdrawal_intents WHERE intent_id=?',(quote['intent_id'],)).fetchone()[0])
        self.assertNotIn('source_address',canonical)
        response=await self.client.post('/api/wallet/withdrawal-create',json={'intent_id':quote['intent_id']},headers=user)
        result=await response.json()
        self.assertEqual(response.status,200,result)
        self.assertEqual(result['network'],'TRON')
        self.assertEqual(self.withdrawal_create_calls[0]['amount'],'10')
        self.assertEqual(self.withdrawal_create_calls[0]['max_fee'],'1')
        self.assertNotIn('source_address',self.withdrawal_create_calls[0])
        self.assertEqual(self.ledger.balance('tg:123','USDT'),(Decimal('89'),Decimal('11')))

    async def test_can_withdraw_on_another_network_without_allocating_addresses(self):
        user,quote=await self.withdrawal_fixture('ETH')
        response=await self.client.post('/api/wallet/withdrawal-create',json={'intent_id':quote['intent_id']},headers=user)
        self.assertEqual(response.status,200)
        self.assertEqual(self.ledger.db.execute('SELECT COUNT(*) FROM wallet_addresses').fetchone()[0],0)
        self.assertEqual(self.withdrawal_create_calls[0]['network'],'ETH')


if __name__ == '__main__':
    unittest.main()
