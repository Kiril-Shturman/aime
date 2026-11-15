"""WPay: GoSwap transport, per-user ledger, signed webhooks and QR reservations.

Secrets: GOSWAP_API_TOKEN, WPAY_BOT_TOKEN (or BOARD_BOT_TOKEN).
Only this module sees the provider token; organization funds are never a user's
balance. All money arithmetic uses Decimal and SQLite write transactions.
"""
import asyncio
import hashlib
import hmac
import json
import os
import re
import sqlite3
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from urllib.parse import parse_qsl, urlsplit

from aiohttp import ClientSession, ClientTimeout, web

from wallet_fixedfloat import FixedFloat, exchange_route, prepare_exchange_limits
from wallet_book import Book
from wallet_user_ops import prepare as prepare_user_ops, route as user_ops_route
from wallet_inbox import prepare as prepare_inbox, receive as receive_webhook
from wallet_finance_worker import prepare as prepare_finance_worker, Worker as FinanceWorker
from wallet_finance import finance_route, require_coverage
from wallet_operations import prepare_operations, operations_route, save_address
from wallet_withdrawals import prepare_withdrawals, withdrawal_route, reconcile as reconcile_withdrawals, debt

BASE_URL = 'https://goswap.site/api/'
NETWORKS = {'BSC', 'ETH', 'TON', 'SOL', 'TRON'}
DEPOSIT_NETWORKS = {'USDT': NETWORKS, 'ETH': {'ETH'}, 'BNB': {'BSC'}, 'TON': {'TON'}, 'SOL': {'SOL'}}

ADMIN_GOSWAP_METHODS = {
    'getMe': {'title': 'Приложение', 'post': False, 'params': [], 'required': [], 'example': {}},
    'getBalance': {'title': 'Баланс организации', 'post': False, 'params': [], 'required': [], 'example': {}},
    'getCurrencies': {'title': 'Валюты', 'post': False, 'params': [], 'required': [], 'example': {}},
    'getExchangeRates': {'title': 'Курсы', 'post': False, 'params': [], 'required': [], 'example': {}},
    'getInvoices': {'title': 'Счета', 'post': False, 'params': ['invoice_ids', 'status', 'count', 'offset'], 'required': [], 'example': {'count': 100, 'offset': 0}},
    'getTransfers': {'title': 'Выплаты', 'post': False, 'params': ['spend_id', 'user_id', 'status', 'count', 'offset'], 'required': [], 'example': {'count': 100, 'offset': 0}},
    'getWithdrawals': {'title': 'Выводы', 'post': False, 'params': ['withdrawal_ids', 'spend_id', 'count', 'offset'], 'required': [], 'example': {'count': 100, 'offset': 0}},
    'getDeposits': {'title': 'Пополнения', 'post': False, 'params': ['client_ref', 'network', 'count', 'offset'], 'required': [], 'example': {'count': 1000, 'offset': 0}},
    'getTransactions': {'title': 'Лента операций', 'post': False, 'params': ['asset', 'type', 'count', 'before', 'after'], 'required': [], 'example': {'count': 100, 'after': 0}},
    'getQrPayments': {'title': 'QR-платежи', 'post': False, 'params': ['payment_ids', 'spend_ids', 'status', 'count', 'offset'], 'required': [], 'example': {'count': 100, 'offset': 0}},
    'estimateWithdrawal': {'title': 'Расчёт вывода', 'post': False, 'params': ['asset', 'network', 'address', 'amount', 'memo'], 'required': ['asset', 'network', 'address', 'amount'], 'example': {'asset': 'USDT', 'network': 'BSC', 'address': '', 'amount': '10'}},
    'createInvoice': {'title': 'Создать счёт', 'post': True, 'params': ['asset', 'amount', 'description', 'payload', 'expires_in'], 'required': ['asset', 'amount'], 'example': {'asset': 'USDT', 'amount': '10', 'description': '', 'payload': '', 'expires_in': 3600}},
    'transfer': {'title': 'Выплата пользователю', 'post': True, 'dangerous': True, 'params': ['user_id', 'asset', 'amount', 'spend_id', 'comment'], 'required': ['user_id', 'asset', 'amount', 'spend_id'], 'example': {'user_id': '', 'asset': 'USDT', 'amount': '1', 'spend_id': '', 'comment': ''}},
    'revokeTransfer': {'title': 'Отозвать выплату', 'post': True, 'dangerous': True, 'params': ['spend_id'], 'required': ['spend_id'], 'example': {'spend_id': ''}},
    'createWithdrawal': {'title': 'Вывод в сеть', 'post': True, 'dangerous': True, 'params': ['asset', 'network', 'address', 'amount', 'spend_id', 'memo', 'max_fee'], 'required': ['asset', 'network', 'address', 'amount', 'spend_id'], 'example': {'asset': 'USDT', 'network': 'BSC', 'address': '', 'amount': '1', 'spend_id': '', 'max_fee': ''}},
    'getClientAddress': {'title': 'Адрес клиента', 'post': True, 'params': ['client_ref', 'network'], 'required': ['client_ref', 'network'], 'example': {'client_ref': '', 'network': 'BSC'}},
    'createDeposit': {'title': 'Окно пополнения', 'post': True, 'params': ['client_ref', 'network', 'asset'], 'required': ['client_ref'], 'example': {'client_ref': '', 'network': 'BSC', 'asset': 'USDT'}},
    'createExactDeposit': {'title': 'Точное пополнение TRON', 'post': True, 'params': ['client_ref', 'amount', 'network', 'asset'], 'required': ['client_ref', 'amount'], 'example': {'client_ref': '', 'amount': '1', 'network': 'TRON', 'asset': 'USDT'}},
    'createQrQuote': {'title': 'Котировка QR', 'post': True, 'params': ['qr'], 'required': ['qr'], 'example': {'qr': ''}},
    'payQr': {'title': 'Оплатить QR', 'post': True, 'dangerous': True, 'params': ['quote_id', 'spend_id'], 'required': ['quote_id', 'spend_id'], 'example': {'quote_id': '', 'spend_id': ''}},
}


def money(value, positive=True):
    try:
        value = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError('Некорректная сумма')
    if not value.is_finite() or abs(value) > Decimal('1000000000000') or (positive and value <= 0):
        raise ValueError('Некорректная сумма')
    if value.as_tuple().exponent < -18:
        raise ValueError('Слишком много знаков после запятой')
    return value


def add(a, b):
    with localcontext() as ctx:
        ctx.prec = 50
        return a + b


def now():
    return datetime.now(timezone.utc).isoformat()


def telegram_payload(raw, token):
    if not raw or not token:
        return None
    try:
        pairs = parse_qsl(raw, keep_blank_values=True, strict_parsing=True)
        data = dict(pairs)
        if len(pairs) != len(data):
            return None
        signature = data.pop('hash')
        age = time.time() - int(data['auth_date'])
        if age < -30 or age > 86400:
            return None
        secret = hmac.new(b'WebAppData', token.encode(), hashlib.sha256).digest()
        expected = hmac.new(secret, '\n'.join(f'{k}={data[k]}' for k in sorted(data)).encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            return None
        user = json.loads(data['user'])
        uid = user.get('id')
        if not isinstance(uid, int) or isinstance(uid, bool) or uid <= 0:
            return None
        return {
            'user': user,
            'auth_date': int(data['auth_date']),
            'start_param': str(data.get('start_param') or '')[:128],
        }
    except (ValueError, KeyError, TypeError):
        return None


def telegram_profile(raw, token):
    payload = telegram_payload(raw, token)
    return payload['user'] if payload else None


def telegram_user(raw, token):
    user = telegram_profile(raw, token)
    return f"tg:{user['id']}" if user else None


class ApiError(Exception):
    def __init__(self, name, detail, status=400, retry_after=None):
        self.name, self.detail, self.status, self.retry_after = name, detail, status, retry_after


class GoSwap:
    def __init__(self, token):
        self.token = token
        self.session = None
        self.rate_windows = defaultdict(deque)

    async def call(self, method, data=None, post=False):
        if not self.token:
            raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён', 503)
        window=self.rate_windows[method];stamp=time.monotonic();limit=30 if method=='getClientAddress' else 60
        while window and window[0]<=stamp-60:window.popleft()
        if len(window)>=limit:raise ApiError('RATE_LIMITED','Лимит запросов GoSwap',429,str(max(1,int(61-(stamp-window[0])))))
        window.append(stamp)
        if self.session is None:
            self.session = ClientSession(timeout=ClientTimeout(total=20))
        try:
            async with self.session.request('POST' if post else 'GET', BASE_URL + method,
                    headers={'Crypto-Pay-API-Token': self.token},
                    **({'json': data or {}} if post else {'params': data or {}})) as response:
                try:
                    body = await response.json(content_type=None)
                except (ValueError, TypeError):
                    raise ApiError('PROVIDER_UNAVAILABLE', 'Провайдер временно недоступен', 502)
                if not isinstance(body, dict):
                    raise ApiError('PROVIDER_UNAVAILABLE', 'Некорректный ответ провайдера', 502)
                if response.status >= 400 or not body.get('ok'):
                    error = body.get('error') or {}
                    raise ApiError(error.get('name', 'PROVIDER_ERROR'), str(body.get('detail') or 'Ошибка провайдера')[:300], response.status if response.status >= 400 else 502, response.headers.get('Retry-After'))
                return body.get('result')
        except (asyncio.TimeoutError, OSError):
            raise ApiError('PROVIDER_TIMEOUT', 'Ответ не получен. Проверьте статус операции перед повтором.', 504)

    async def close(self):
        if self.session:
            await self.session.close()


class Ledger:
    def __init__(self, path):
        self.db = sqlite3.connect(path, isolation_level=None)
        if path != ':memory:':
            os.chmod(path, 0o600)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS wallet_accounts (user_id TEXT PRIMARY KEY, client_ref TEXT UNIQUE NOT NULL);
          CREATE TABLE IF NOT EXISTS wallet_balances (user_id TEXT, asset TEXT, available TEXT NOT NULL DEFAULT '0', reserved TEXT NOT NULL DEFAULT '0', PRIMARY KEY(user_id,asset));
          CREATE TABLE IF NOT EXISTS wallet_events (event_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL, detail TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS wallet_events_user ON wallet_events(user_id,created_at);
          CREATE TABLE IF NOT EXISTS wallet_quotes (quote_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, spend_id TEXT UNIQUE NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'quoted', payment_id TEXT);
          CREATE TABLE IF NOT EXISTS admin_broadcasts (broadcast_id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, target TEXT NOT NULL, text TEXT NOT NULL, button_text TEXT, button_url TEXT, status TEXT NOT NULL, total INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT);
          CREATE TABLE IF NOT EXISTS admin_broadcast_deliveries (broadcast_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(broadcast_id,user_id));
        ''')

        prepare_withdrawals(self)
        self.book = Book(self.db, ApiError)
        self.db.execute('CREATE TABLE IF NOT EXISTS wallet_deposit_owners (deposit_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,asset TEXT NOT NULL)')
        for event in self.db.execute("SELECT event_id,user_id,asset FROM wallet_events WHERE type='deposit'").fetchall():
            if event['event_id'].startswith('deposit:'):
                self.db.execute('INSERT OR IGNORE INTO wallet_deposit_owners VALUES (?,?,?)',(event['event_id'][8:],event['user_id'],event['asset']))
        columns = {row[1] for row in self.db.execute('PRAGMA table_info(wallet_accounts)')}
        for name, definition in {
            'telegram_id': 'INTEGER',
            'telegram_username': 'TEXT', 'first_name': 'TEXT', 'last_name': 'TEXT',
            'language_code': 'TEXT', 'is_premium': 'INTEGER', 'photo_url': 'TEXT',
            'added_to_attachment_menu': 'INTEGER', 'allows_write_to_pm': 'INTEGER',
            'created_at': 'TEXT', 'updated_at': 'TEXT', 'last_seen': 'TEXT',
            'last_miniapp_at': 'TEXT', 'bot_started_at': 'TEXT', 'last_bot_at': 'TEXT',
            'profile_synced_at': 'TEXT', 'profile_source': 'TEXT',
            'profile_sync_attempted_at': 'TEXT', 'profile_sync_error': 'TEXT',
            'first_start_param': 'TEXT', 'last_start_param': 'TEXT',
            'bot_blocked_at': 'TEXT',
            'role': "TEXT NOT NULL DEFAULT 'user'",
            'status': "TEXT NOT NULL DEFAULT 'active'",
        }.items():
            if name not in columns:
                self.db.execute(f'ALTER TABLE wallet_accounts ADD COLUMN {name} {definition}')
        self.db.execute("UPDATE wallet_accounts SET telegram_id=CAST(SUBSTR(user_id,4) AS INTEGER) WHERE user_id LIKE 'tg:%' AND telegram_id IS NULL")
        self.db.execute('CREATE UNIQUE INDEX IF NOT EXISTS wallet_accounts_telegram_id ON wallet_accounts(telegram_id) WHERE telegram_id IS NOT NULL')
        self.db.execute('CREATE INDEX IF NOT EXISTS wallet_accounts_last_seen ON wallet_accounts(last_seen)')

    def account(self, uid, profile=None, bot_started=False, source='miniapp', start_param=None, touch=True):
        stamp = now()
        telegram_id = int(uid[3:]) if uid.startswith('tg:') and uid[3:].isdigit() else None
        self.db.execute(
            'INSERT OR IGNORE INTO wallet_accounts(user_id,client_ref,telegram_id,created_at,updated_at,last_seen,last_miniapp_at) VALUES (?,?,?,?,?,?,?)',
            (uid, 'wpay-' + uuid.uuid4().hex, telegram_id, stamp, stamp,
             stamp if touch and source == 'miniapp' else None,
             stamp if touch and source == 'miniapp' else None),
        )
        if uid.startswith('tg:'):
            updates, values = ['telegram_id=COALESCE(telegram_id,?)', 'updated_at=?'], [telegram_id, stamp]
            if touch and source == 'miniapp':
                updates.extend(['last_seen=?', 'last_miniapp_at=?'])
                values.extend([stamp, stamp])
            elif touch and source == 'bot':
                updates.append('last_bot_at=?')
                values.append(stamp)
            if profile:
                updates.extend([
                    'telegram_username=?', 'first_name=?', 'last_name=?',
                    'profile_synced_at=?', 'profile_source=?', 'profile_sync_error=NULL',
                ])
                values.extend([
                    str(profile.get('username'))[:64] if profile.get('username') else None,
                    str(profile.get('first_name'))[:128] if profile.get('first_name') else None,
                    str(profile.get('last_name'))[:128] if profile.get('last_name') else None,
                    stamp, source[:32],
                ])
                optional = {
                    'language_code': (str(profile.get('language_code'))[:16] if profile.get('language_code') else None),
                    'is_premium': int(bool(profile.get('is_premium'))) if 'is_premium' in profile else None,
                    'photo_url': str(profile.get('photo_url'))[:1000] if profile.get('photo_url') else None,
                    'added_to_attachment_menu': int(bool(profile.get('added_to_attachment_menu'))) if 'added_to_attachment_menu' in profile else None,
                    'allows_write_to_pm': int(bool(profile.get('allows_write_to_pm'))) if 'allows_write_to_pm' in profile else None,
                }
                for column, value in optional.items():
                    if value is not None:
                        updates.append(f'{column}=?')
                        values.append(value)
            if bot_started:
                updates.extend(['bot_started_at=COALESCE(bot_started_at,?)', 'bot_blocked_at=NULL'])
                values.append(stamp)
            if start_param:
                value = str(start_param)[:128]
                updates.extend(['first_start_param=COALESCE(first_start_param,?)', 'last_start_param=?'])
                values.extend([value, value])
            values.append(uid)
            self.db.execute(f"UPDATE wallet_accounts SET {','.join(updates)} WHERE user_id=?", values)
        return self.db.execute('SELECT client_ref FROM wallet_accounts WHERE user_id=?', (uid,)).fetchone()[0]

    def profile_sync_result(self, uid, error=None):
        self.db.execute(
            'UPDATE wallet_accounts SET profile_sync_attempted_at=?,profile_sync_error=? WHERE user_id=?',
            (now(), str(error)[:300] if error else None, uid),
        )

    def bot_delivery(self, uid, delivered, blocked=False):
        if delivered:
            self.db.execute('UPDATE wallet_accounts SET bot_blocked_at=NULL,updated_at=? WHERE user_id=?', (now(), uid))
        elif blocked:
            self.db.execute('UPDATE wallet_accounts SET bot_blocked_at=COALESCE(bot_blocked_at,?),updated_at=? WHERE user_id=?', (now(), now(), uid))

    def begin(self, kind='balance_change', actor='system', reason='Balance projection update'):
        self.book.begin(kind,actor,reason)

    def commit(self):self.book.commit()
    def rollback(self):self.book.rollback()

    def balance(self, uid, asset):
        row=self.db.execute('SELECT available,reserved FROM wallet_balances WHERE user_id=? AND asset=?',(uid,asset)).fetchone()
        available,reserved=(Decimal(row[0]),Decimal(row[1])) if row else (Decimal(0),Decimal(0))
        self.book.check(uid,asset,available,reserved)
        return available,reserved

    def put_balance(self, uid, asset, available, reserved):
        if available<0 or reserved<0:raise ApiError('INSUFFICIENT_FUNDS','Недостаточно средств на вашем балансе',409)
        self.book.set_balance(uid,asset,available,reserved)

    def set_debt(self, uid, asset, amount):self.book.set_debt(uid,asset,amount)

    def deposit(self, payload):
        uid = self.db.execute('SELECT user_id FROM wallet_accounts WHERE client_ref=?', (payload.get('client_ref'),)).fetchone()
        if not uid:
            return False
        amount = money(payload['credited'])
        asset = str(payload['asset']).upper()
        event_id = 'deposit:' + str(payload['deposit_id'])
        self.begin('deposit','provider',event_id)
        try:
            self.db.execute('INSERT OR IGNORE INTO wallet_deposit_owners VALUES (?,?,?)',(str(payload['deposit_id']),uid[0],asset))
            if self.db.execute('SELECT 1 FROM wallet_events WHERE event_id=?', (event_id,)).fetchone():
                self.commit()
                return False
            available, reserved = self.balance(uid[0], asset)
            with localcontext() as ctx:
                ctx.prec = 50
                owed = debt(self, uid[0], asset)
                repayment = min(owed, amount)
                self.set_debt(uid[0],asset,owed-repayment)
                self.put_balance(uid[0], asset, available + amount - repayment, reserved)
            self.db.execute('INSERT INTO wallet_events VALUES (?,?,?,?,?,?,?)', (event_id, uid[0], asset, str(amount), 'deposit', str(payload.get('credited_at') or now()), json.dumps(payload)))
            self.commit()
            return True
        except Exception:
            self.rollback()
            raise

    def reserve(self, uid, quote_id):
        self.begin('qr_reserve',uid,'Reserve QR '+str(quote_id))
        try:
            row = self.db.execute('SELECT * FROM wallet_quotes WHERE quote_id=? AND user_id=?', (quote_id, uid)).fetchone()
            if not row:
                raise ApiError('QUOTE_NOT_FOUND', 'Котировка не найдена', 404)
            quote = json.loads(row['body'])
            if row['state'] == 'quoted':
                expiry = datetime.fromisoformat(quote['expires_at'].replace('Z', '+00:00'))
                if expiry <= datetime.now(timezone.utc):
                    raise ApiError('QUOTE_EXPIRED', 'Котировка истекла. Запросите новую.', 409)
                amount = money(quote['amount'])
                if debt(self, uid, quote['asset']):
                    raise ApiError('INSUFFICIENT_FUNDS', 'Есть задолженность по уточнённому выводу', 409)
                available, reserved = self.balance(uid, quote['asset'])
                self.put_balance(uid, quote['asset'], add(available, -amount), add(reserved, amount))
                self.db.execute("UPDATE wallet_quotes SET state='reserved' WHERE quote_id=?", (quote_id,))
            self.commit()
            return dict(row), quote
        except Exception:
            self.rollback()
            raise

    def payment(self, payload):
        state = payload.get('status')
        if state not in {'processing', 'completed', 'failed', 'refunded'}:
            raise ValueError('Некорректный статус платежа')
        self.begin('qr_outcome','provider','QR '+str(payload.get('spend_id'))+' '+str(state))
        try:
            row = self.db.execute('SELECT * FROM wallet_quotes WHERE spend_id=?', (payload.get('spend_id'),)).fetchone()
            if not row or row['state'] == 'quoted':
                self.commit()
                return False
            old = row['state']
            if old in {'failed', 'refunded'} or old == state or (old == 'completed' and state != 'refunded'):
                self.commit()
                return False
            quote = json.loads(row['body'])
            if row['payment_id'] and payload.get('payment_id') and str(payload['payment_id']) != row['payment_id']:
                raise ValueError('Payment ID mismatch')
            amount = money(quote['amount'])
            if payload.get('amount') is not None and money(payload['amount']) != amount:
                raise ValueError('Сумма платежа не совпадает с котировкой')
            if payload.get('asset') is not None and payload['asset'] != quote['asset']:
                raise ValueError('Валюта платежа не совпадает с котировкой')
            available, reserved = self.balance(row['user_id'], quote['asset'])
            delta = Decimal(0)
            if state in {'completed', 'failed'}:
                reserved = add(reserved, -amount)
                if state == 'failed':
                    available = add(available, amount)
            elif state == 'refunded':
                if old == 'completed':
                    available = add(available, amount)
                else:
                    reserved = add(reserved, -amount)
                    available = add(available, amount)
            self.put_balance(row['user_id'], quote['asset'], available, reserved)
            self.db.execute('UPDATE wallet_quotes SET state=?,payment_id=? WHERE quote_id=?', (state, str(payload.get('payment_id') or row['payment_id'] or ''), row['quote_id']))
            if state in {'completed', 'failed', 'refunded'}:
                delta = -amount if state == 'completed' else amount if state == 'refunded' else Decimal(0)
                self.db.execute('INSERT OR IGNORE INTO wallet_events VALUES (?,?,?,?,?,?,?)', ('qr:' + row['spend_id'] + ':' + state, row['user_id'], quote['asset'], str(delta), 'qr_' + state, now(), json.dumps(payload)))
            self.commit()
            return True
        except Exception:
            self.rollback()
            raise


def install_wallet(app, root, owner_check):
    # Local service secrets are read only here, never served or bundled.
    secrets_file = os.path.join(root, '.env.wallet')
    if os.path.isfile(secrets_file):
        with open(secrets_file, encoding='utf-8') as config:
            for line in config:
                key, sep, value = line.strip().partition('=')
                if sep and key in {'GOSWAP_API_TOKEN', 'WPAY_BOT_TOKEN', 'WPAY_DB_PATH', 'WPAY_ADMIN_IDS', 'FIXEDFLOAT_API_KEY', 'FIXEDFLOAT_API_SECRET'}:
                    os.environ.setdefault(key, value.strip().strip('\"\''))
    token = os.environ.get('GOSWAP_API_TOKEN', '')
    bot_token = os.environ.get('WPAY_BOT_TOKEN') or os.environ.get('BOARD_BOT_TOKEN', '')
    admin_ids = {value.strip() for value in os.environ.get('WPAY_ADMIN_IDS', '').split(',') if value.strip().isdigit()}
    ledger = Ledger(os.environ.get('WPAY_DB_PATH', os.path.join(root, 'wpay.sqlite3')))
    prepare_operations(ledger)
    prepare_withdrawals(ledger)
    prepare_user_ops(ledger)
    prepare_inbox(ledger)
    prepare_finance_worker(ledger)
    provider = GoSwap(token)
    exchange = FixedFloat(os.environ.get('FIXEDFLOAT_API_KEY',''),os.environ.get('FIXEDFLOAT_API_SECRET',''),ApiError)
    prepare_exchange_limits(ledger)
    exchange.ledger=ledger
    app['wpay_exchange'] = exchange
    app['wpay_provider'] = provider
    app['wpay_ledger'] = ledger
    app['wpay_broadcast_tasks'] = set()

    def identity(request):
        payload = telegram_payload(request.headers.get('X-Telegram-Init-Data', ''), bot_token)
        if payload:
            request['wpay_profile'] = payload['user']
            request['wpay_start_param'] = payload['start_param']
            return f"tg:{payload['user']['id']}"
        key = request.headers.get('X-Board-Key', '')
        if key and owner_check(key):
            return 'owner'
        raise ApiError('AUTH_REQUIRED', 'Откройте кошелёк из Telegram или войдите как владелец', 401)

    def is_admin(uid):
        return uid == 'owner' or (uid.startswith('tg:') and uid[3:] in admin_ids)

    for admin_id in admin_ids:
        ledger.db.execute("UPDATE wallet_accounts SET role='admin' WHERE user_id=?", (f'tg:{admin_id}',))

    async def telegram_api(method, data):
        if not bot_token:
            raise ApiError('TELEGRAM_NOT_CONFIGURED', 'Telegram-бот не настроен', 503)
        async with ClientSession(timeout=ClientTimeout(total=15)) as session:
            async with session.post(f'https://api.telegram.org/bot{bot_token}/{method}', json=data) as response:
                body = await response.json(content_type=None)
                if response.status >= 400 or not isinstance(body, dict) or not body.get('ok'):
                    detail = body.get('description') if isinstance(body, dict) else 'Telegram error'
                    raise ApiError('TELEGRAM_ERROR', str(detail or 'Telegram error')[:300], response.status if response.status >= 400 else 502, response.headers.get('Retry-After'))
                return body.get('result')

    async def sync_telegram_users(only_missing=False):
        where = "WHERE user_id LIKE 'tg:%'"
        if only_missing:
            where += " AND profile_synced_at IS NULL"
        rows = ledger.db.execute(f'SELECT user_id,telegram_id FROM wallet_accounts {where} ORDER BY rowid').fetchall()
        synced = failed = 0
        for row in rows:
            uid = row['user_id']
            telegram_id = row['telegram_id'] or int(uid.removeprefix('tg:'))
            try:
                profile = await telegram_api('getChat', {'chat_id': telegram_id})
                if not isinstance(profile, dict):
                    raise ApiError('TELEGRAM_ERROR', 'Telegram вернул пустой профиль', 502)
                ledger.account(uid, profile, source='bot_api', touch=False)
                ledger.profile_sync_result(uid)
                synced += 1
            except (ApiError, asyncio.TimeoutError, OSError, ValueError) as error:
                ledger.profile_sync_result(uid, getattr(error, 'detail', str(error)))
                failed += 1
            await asyncio.sleep(0.04)
        return {'total': len(rows), 'synced': synced, 'failed': failed}

    async def admin_overview():
        liabilities = {}
        for row in ledger.db.execute('SELECT asset,available,reserved FROM wallet_balances'):
            item = liabilities.setdefault(row['asset'], [Decimal(0), Decimal(0)])
            item[0] = add(item[0], Decimal(row['available']))
            item[1] = add(item[1], Decimal(row['reserved']))
        tables = {row[0] for row in ledger.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        def grouped_counts(table, column):
            if table not in tables:
                return {}
            return {str(row[0]): int(row[1]) for row in ledger.db.execute(f'SELECT {column},COUNT(*) FROM {table} GROUP BY {column}')}
        recent = [dict(row) for row in ledger.db.execute(
            'SELECT event_id,user_id,asset,amount,type,created_at,detail FROM wallet_events ORDER BY rowid DESC LIMIT 100'
        )]
        for item in recent:
            try:
                item['detail'] = json.loads(item['detail'])
            except (ValueError, TypeError):
                item['detail'] = {}
        app_info, organization_balance, currencies = await asyncio.gather(
            provider.call('getMe'), provider.call('getBalance'), provider.call('getCurrencies')
        )
        return {
            'users': ledger.db.execute("SELECT COUNT(*) FROM wallet_accounts WHERE user_id LIKE 'tg:%'").fetchone()[0],
            'events': ledger.db.execute('SELECT COUNT(*) FROM wallet_events').fetchone()[0],
            'liabilities': [
                {'asset': asset, 'available': str(values[0]), 'reserved': str(values[1]), 'total': str(add(values[0], values[1]))}
                for asset, values in sorted(liabilities.items())
            ],
            'states': {
                'quotes': grouped_counts('wallet_quotes', 'state'),
                'transfers': grouped_counts('wallet_transfers', 'status'),
                'withdrawals': grouped_counts('wallet_withdrawal_intents', 'state'),
            },
            'recent': recent,
            'debts': decoded_rows('SELECT user_id,asset,amount FROM wallet_debts WHERE CAST(amount AS REAL)>0'),
            'provider': {'app': app_info, 'balance': organization_balance, 'currencies': currencies},
        }

    def tables():
        return {row[0] for row in ledger.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    def decoded_rows(sql, params=()):
        rows = [dict(row) for row in ledger.db.execute(sql, params)]
        for row in rows:
            for key in ('body', 'detail'):
                if key in row and isinstance(row[key], str):
                    try:
                        row[key] = json.loads(row[key])
                    except (ValueError, TypeError):
                        pass
        return rows

    def admin_users():
        rows = decoded_rows('''
          SELECT a.*,
                 COALESCE((SELECT COUNT(*) FROM wallet_events e WHERE e.user_id=a.user_id),0) event_count,
                 COALESCE((SELECT COUNT(*) FROM wallet_addresses d WHERE d.user_id=a.user_id),0) address_count
          FROM wallet_accounts a WHERE a.user_id LIKE 'tg:%' ORDER BY COALESCE(a.last_seen,a.created_at) DESC, a.rowid DESC LIMIT 1000
        ''') if 'wallet_addresses' in tables() else decoded_rows('''
          SELECT a.*, COALESCE((SELECT COUNT(*) FROM wallet_events e WHERE e.user_id=a.user_id),0) event_count, 0 address_count
          FROM wallet_accounts a WHERE a.user_id LIKE 'tg:%' ORDER BY COALESCE(a.last_seen,a.created_at) DESC, a.rowid DESC LIMIT 1000
        ''')
        balances = decoded_rows('SELECT user_id,asset,available,reserved FROM wallet_balances ORDER BY user_id,asset')
        by_user = {}
        for balance in balances:
            by_user.setdefault(balance['user_id'], []).append(balance)
        for row in rows:
            row['balances'] = by_user.get(row['user_id'], [])
        return {'items': rows, 'total': ledger.db.execute("SELECT COUNT(*) FROM wallet_accounts WHERE user_id LIKE 'tg:%'").fetchone()[0]}

    def admin_database(request):
        allowed = sorted(name for name in tables() if name.startswith(('wallet_', 'admin_')))
        selected = request.query.get('table') or (allowed[0] if allowed else '')
        if selected not in allowed:
            raise ApiError('INVALID_TABLE', 'Неизвестная таблица', 400)
        count = min(max(int(request.query.get('count', '50')), 1), 200)
        offset = max(int(request.query.get('offset', '0')), 0)
        columns = [row[1] for row in ledger.db.execute(f'PRAGMA table_info("{selected}")')]
        query, params = f'SELECT rowid,* FROM "{selected}"', []
        search = request.query.get('q', '').strip()[:200]
        if search and columns:
            query += ' WHERE ' + ' OR '.join(f'CAST("{column}" AS TEXT) LIKE ?' for column in columns)
            params.extend([f'%{search}%'] * len(columns))
        query += ' ORDER BY rowid DESC LIMIT ? OFFSET ?'
        params.extend([count, offset])
        totals = {name: ledger.db.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0] for name in allowed}
        return {'tables': totals, 'table': selected, 'columns': ['rowid', *columns], 'items': decoded_rows(query, params), 'offset': offset, 'count': count}

    def admin_payments():
        result = {'events': decoded_rows('SELECT rowid,* FROM wallet_events ORDER BY rowid DESC LIMIT 500')}
        for table, key in [('wallet_quotes', 'quotes'), ('wallet_invoices', 'invoices'), ('wallet_transfers', 'transfers'), ('wallet_withdrawal_intents', 'withdrawals')]:
            result[key] = decoded_rows(f'SELECT rowid,* FROM {table} ORDER BY rowid DESC LIMIT 500') if table in tables() else []
        return result

    def admin_crypto():
        addresses = decoded_rows('SELECT rowid,* FROM wallet_addresses ORDER BY rowid DESC LIMIT 1000') if 'wallet_addresses' in tables() else []
        deposits = decoded_rows("SELECT rowid,* FROM wallet_events WHERE type='deposit' ORDER BY rowid DESC LIMIT 500")
        balances = decoded_rows('SELECT user_id,asset,available,reserved FROM wallet_balances ORDER BY user_id,asset')
        return {'addresses': addresses, 'deposits': deposits, 'balances': balances}

    async def safe_provider(method, data=None):
        try:
            return {'ok': True, 'result': await provider.call(method, data or {})}
        except ApiError as error:
            return {'ok': False, 'error': error.name, 'detail': error.detail}

    async def admin_goswap():
        methods = {
            'account': ('getMe', {}), 'balance': ('getBalance', {}), 'currencies': ('getCurrencies', {}),
            'transactions': ('getTransactions', {'count': 100}), 'invoices': ('getInvoices', {'count': 100}),
            'transfers': ('getTransfers', {'count': 100}), 'withdrawals': ('getWithdrawals', {'count': 100}),
            'deposits': ('getDeposits', {'count': 100}), 'qrPayments': ('getQrPayments', {'count': 100}),
            'rates': ('getExchangeRates', {}),
        }
        values = await asyncio.gather(*(safe_provider(method, params) for method, params in methods.values()))
        catalog = [{'method': method, **spec} for method, spec in ADMIN_GOSWAP_METHODS.items()]
        return {'snapshot': dict(zip(methods, values)), 'methods': catalog}

    async def admin_goswap_action(request):
        body = await request.json()
        if not isinstance(body, dict):
            raise ValueError('Некорректный запрос')
        method = str(body.get('method') or '')
        spec = ADMIN_GOSWAP_METHODS.get(method)
        if not spec:
            raise ApiError('METHOD_NOT_ALLOWED', 'Метод отсутствует в разрешённом списке GoSwap', 400)
        params = body.get('params') or {}
        if not isinstance(params, dict):
            raise ValueError('Параметры должны быть JSON-объектом')
        unknown = sorted(set(params) - set(spec['params']))
        if unknown:
            raise ApiError('INVALID_PARAMS', 'Недопустимые параметры: ' + ', '.join(unknown), 400)
        params = {key: value for key, value in params.items() if value is not None and value != ''}
        if any(isinstance(value, (dict, list)) for value in params.values()):
            raise ApiError('INVALID_PARAMS', 'Параметры должны быть строками, числами или флагами', 400)
        missing = [key for key in spec['required'] if key not in params]
        if missing:
            raise ApiError('MISSING_PARAMS', 'Обязательные параметры: ' + ', '.join(missing), 400)
        if spec['post'] and body.get('confirm') != method:
            raise ApiError('CONFIRMATION_REQUIRED', f'Подтвердите вызов {method}', 409)
        result = await provider.call(method, params, post=spec['post'])
        return {'ok': True, 'method': method, 'result': result}

    async def run_broadcast(broadcast_id, targets, text, button_text, button_url):
        ledger.db.execute("UPDATE admin_broadcasts SET status='sending',started_at=? WHERE broadcast_id=?", (now(), broadcast_id))
        sent = failed = 0
        async with ClientSession(timeout=ClientTimeout(total=15)) as session:
            for uid in targets:
                payload = {'chat_id': int(uid.removeprefix('tg:')), 'text': text}
                if button_text and button_url:
                    payload['reply_markup'] = {'inline_keyboard': [[{'text': button_text, 'url': button_url}]]}
                error = None
                blocked = False
                try:
                    async with session.post(f'https://api.telegram.org/bot{bot_token}/sendMessage', json=payload) as response:
                        body = await response.json(content_type=None)
                        if response.status >= 400 or not body.get('ok'):
                            error = str(body.get('description') or 'Telegram error')[:300]
                            blocked = response.status == 403
                except (asyncio.TimeoutError, OSError, ValueError) as reason:
                    error = str(reason)[:300]
                status = 'failed' if error else 'sent'
                failed += bool(error)
                sent += not bool(error)
                ledger.bot_delivery(uid, not error, blocked)
                ledger.db.execute('INSERT OR REPLACE INTO admin_broadcast_deliveries VALUES (?,?,?,?,?)', (broadcast_id, uid, status, error, now()))
                ledger.db.execute('UPDATE admin_broadcasts SET sent=?,failed=? WHERE broadcast_id=?', (sent, failed, broadcast_id))
                await asyncio.sleep(0.04)
        ledger.db.execute("UPDATE admin_broadcasts SET status='completed',finished_at=?,sent=?,failed=? WHERE broadcast_id=?", (now(), sent, failed, broadcast_id))

    async def admin_broadcasts(request, uid):
        if request.method == 'GET':
            items = decoded_rows('SELECT * FROM admin_broadcasts ORDER BY rowid DESC LIMIT 100')
            return {'items': items}
        body = await request.json()
        text = str(body.get('text') or '').strip()
        if not 1 <= len(text) <= 4096:
            raise ValueError('Текст рассылки должен быть от 1 до 4096 символов')
        target = str(body.get('target') or 'self')
        if target not in {'self', 'all'}:
            raise ValueError('Некорректная аудитория')
        if uid == 'owner':
            raise ApiError('TELEGRAM_REQUIRED', 'Откройте админку через Telegram', 400)
        button_text = str(body.get('button_text') or '').strip()[:64]
        button_url = str(body.get('button_url') or '').strip()[:2048]
        if bool(button_text) != bool(button_url) or (button_url and urlsplit(button_url).scheme not in {'http', 'https'}):
            raise ValueError('Укажите корректную кнопку и ссылку')
        if target == 'self':
            targets = [uid]
        else:
            targets = [row[0] for row in ledger.db.execute("SELECT user_id FROM wallet_accounts WHERE user_id LIKE 'tg:%' AND status='active'")]
        broadcast_id = 'broadcast-' + uuid.uuid4().hex
        ledger.db.execute('INSERT INTO admin_broadcasts(broadcast_id,admin_id,target,text,button_text,button_url,status,total,created_at) VALUES (?,?,?,?,?,?,?,?,?)', (broadcast_id, uid, target, text, button_text or None, button_url or None, 'queued', len(targets), now()))
        task = asyncio.create_task(run_broadcast(broadcast_id, targets, text, button_text, button_url))
        app['wpay_broadcast_tasks'].add(task)
        task.add_done_callback(app['wpay_broadcast_tasks'].discard)
        return {'broadcast_id': broadcast_id, 'status': 'queued', 'total': len(targets)}

    async def sync_payments(uid):
        rows = ledger.db.execute("SELECT spend_id FROM wallet_quotes WHERE user_id=? AND state IN ('reserved','processing') LIMIT 100", (uid,)).fetchall()
        if rows:
            data = await provider.call('getQrPayments', {'spend_ids': ','.join(r[0] for r in rows)})
            for payment in data.get('items', []):
                if payment.get('spend_id') in {r[0] for r in rows}:
                    ledger.payment(payment)

    async def route(request):
        try:
            action = request.match_info['action']
            if action == 'status' and request.method == 'GET':
                return web.json_response({'configured': bool(token), 'telegram_auth': bool(bot_token)})
            if action == 'webhook' and request.method == 'POST':
                return await receive_webhook(request,ledger,provider,token,money,ApiError)
            uid = identity(request)
            exchange_response=await exchange_route(request,action,uid,exchange)
            if exchange_response is not None:return exchange_response
            admin = is_admin(uid)
            client_ref = ledger.account(
                uid,
                request.get('wpay_profile'),
                source='miniapp',
                start_param=request.get('wpay_start_param'),
            )
            if admin and uid.startswith('tg:'):
                ledger.db.execute("UPDATE wallet_accounts SET role='admin' WHERE user_id=?", (uid,))
            if action == 'access' and request.method == 'GET':
                return web.json_response({'owner': admin})
            if action.startswith('admin-') and not admin:
                raise ApiError('FORBIDDEN', 'Админка доступна только администраторам WPay', 403)
            if action == 'admin-overview' and request.method == 'GET':
                if not token:
                    raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён', 503)
                return web.json_response(await admin_overview())
            if action == 'admin-users' and request.method == 'GET':
                return web.json_response(admin_users())
            if action == 'admin-sync-users' and request.method == 'POST':
                return web.json_response(await sync_telegram_users())
            if action == 'admin-database' and request.method == 'GET':
                return web.json_response(admin_database(request))
            if action == 'admin-payments' and request.method == 'GET':
                return web.json_response(admin_payments())
            if action == 'admin-crypto' and request.method == 'GET':
                return web.json_response(admin_crypto())
            if action == 'admin-goswap' and request.method == 'GET':
                if not token:
                    raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён', 503)
                return web.json_response(await admin_goswap())
            if action == 'admin-goswap-action' and request.method == 'POST':
                if not token:
                    raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён', 503)
                return web.json_response(await admin_goswap_action(request))
            if action == 'admin-broadcasts' and request.method in {'GET', 'POST'}:
                return web.json_response(await admin_broadcasts(request, uid))
            if not token:
                raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён. Ожидается серверный API-ключ.', 503)
            financial = await finance_route(request,action,uid,admin,ledger,provider,money,ApiError)
            if financial is not None:return financial
            aliases={'operations-transfers':'transfer-history','operations-invoices':'invoice-history'}
            owned = await user_ops_route(request,aliases.get(action,action) if uid!='owner' else action,uid,ledger,provider,money,ApiError)
            if owned is not None:return owned
            if action == 'operations-withdrawals' and uid != 'owner':
                return await withdrawal_route(request, 'withdrawal-history', uid, ledger, provider, money, ApiError)
            operations = await operations_route(request, action, uid, client_ref, ledger, provider, ApiError)
            if operations is not None:
                return operations
            withdrawals = await withdrawal_route(request, action, uid, ledger, provider, money, ApiError)
            if withdrawals is not None:
                return withdrawals
            if action == 'overview' and request.method == 'GET':
                await sync_payments(uid)
                await reconcile_withdrawals(ledger, provider, money, ApiError, uid)
                rates = await provider.call('getExchangeRates')
                balances = [dict(r) for r in ledger.db.execute('SELECT asset,available,reserved FROM wallet_balances WHERE user_id=?', (uid,))]
                items = [dict(r) for r in ledger.db.execute('SELECT event_id,asset,amount,type,created_at,detail FROM wallet_events WHERE user_id=? ORDER BY rowid DESC LIMIT 100', (uid,))]
                for item in items:
                    item['detail'] = json.loads(item['detail'])
                return web.json_response({'balances': balances, 'rates': rates, 'transactions': items, 'debts': [dict(row) for row in ledger.db.execute('SELECT asset,amount FROM wallet_debts WHERE user_id=?', (uid,))]})
            if action == 'provider' and request.method == 'GET':
                if not admin:
                    raise ApiError('FORBIDDEN', 'Только владелец', 403)
                return web.json_response({'app': await provider.call('getMe'), 'organization_balance': await provider.call('getBalance'), 'currencies': await provider.call('getCurrencies')})
            if action == 'currencies' and request.method == 'GET':
                return web.json_response(await provider.call('getCurrencies'))
            if action == 'deposit' and request.method == 'POST':
                body = await request.json()
                network = body.get('network')
                if network not in NETWORKS:
                    raise ValueError('Выберите поддерживаемую сеть')
                asset = str(body.get('asset', 'USDT')).upper()
                if not re.fullmatch(r'[A-Z0-9]{2,12}', asset):
                    raise ValueError('Некорректная валюта')
                if network not in DEPOSIT_NETWORKS.get(asset, set()):
                    raise ValueError('Пополнение этой валюты в выбранной сети не поддерживается')
                if network == 'TRON':
                    exact_amount = money(body.get('amount'))
                    if exact_amount < 1 or exact_amount.as_tuple().exponent < -6:
                        raise ValueError('TRON: минимум 1 USDT, до 6 знаков после точки')
                    if asset != 'USDT':
                        raise ValueError('TRON поддерживает пополнение USDT')
                    result = await provider.call('createExactDeposit', {'client_ref': client_ref, 'amount': str(money(body.get('amount'))), 'network': 'TRON', 'asset': 'USDT'}, post=True)
                else:
                    result = await provider.call('createDeposit', {'client_ref': client_ref, 'network': network, 'asset': asset}, post=True)
                save_address(ledger, uid, result, asset)
                ledger.db.execute('INSERT OR REPLACE INTO wallet_deposit_requests VALUES (?,?,?,?,?)',(str(result.get('claim_id') or uuid.uuid4().hex),uid,network,json.dumps(result),time.time()))
                return web.json_response(result)
            if action == 'sync' and request.method == 'POST':
                ledger.db.execute('CREATE TABLE IF NOT EXISTS wallet_deposit_sync_cursor (user_id TEXT PRIMARY KEY, offset INTEGER NOT NULL)')
                progress = ledger.db.execute('SELECT offset FROM wallet_deposit_sync_cursor WHERE user_id=?', (uid,)).fetchone()
                offset, complete = progress[0] if progress else 0, False
                for _ in range(10):
                    data = await provider.call('getDeposits', {'client_ref': client_ref, 'count': 1000, 'offset': offset})
                    items = data.get('items', [])
                    for item in items:
                        if item.get('client_ref') == client_ref:
                            ledger.deposit(item)
                    if not items:
                        offset, complete = 0, True
                        ledger.db.execute('INSERT OR REPLACE INTO wallet_deposit_sync_cursor VALUES (?,?)', (uid, offset))
                        break
                    offset += 1000
                    ledger.db.execute('INSERT OR REPLACE INTO wallet_deposit_sync_cursor VALUES (?,?)', (uid, offset))
                await sync_payments(uid)
                await reconcile_withdrawals(ledger, provider, money, ApiError, uid)
                return web.json_response({'ok': True, 'sync_complete': complete, 'offset': offset})
            if action == 'quote' and request.method == 'POST':
                body = await request.json()
                qr = body.get('qr')
                if not isinstance(qr, str) or not 1 <= len(qr) <= 8192:
                    raise ValueError('Вставьте строку QR-кода')
                result = await provider.call('createQrQuote', {'qr': qr}, post=True)
                money(result['amount'])
                if result['asset'] != 'USDT':
                    raise ValueError('Неожиданная валюта котировки')
                existing = ledger.db.execute('SELECT user_id,spend_id FROM wallet_quotes WHERE quote_id=?', (result['quote_id'],)).fetchone()
                if existing and existing['user_id'] != uid:
                    raise ApiError('QUOTE_UNAVAILABLE', 'Для этого QR уже создана котировка', 409)
                spend_id = existing['spend_id'] if existing else 'wpay-' + uuid.uuid4().hex
                ledger.db.execute('INSERT OR IGNORE INTO wallet_quotes(quote_id,user_id,spend_id,body) VALUES (?,?,?,?)', (result['quote_id'], uid, spend_id, json.dumps(result)))
                return web.json_response({**result, 'spend_id': spend_id})
            if action == 'pay' and request.method == 'POST':
                body = await request.json()
                pending=ledger.db.execute('SELECT state,body FROM wallet_quotes WHERE quote_id=? AND user_id=?',(str(body.get('quote_id','')),uid)).fetchone()
                if pending and pending['state']=='quoted':
                    check=json.loads(pending['body'])
                    if ledger.balance(uid,check['asset'])[0]<money(check['amount']):raise ApiError('INSUFFICIENT_FUNDS','Недостаточно средств',409)
                    await require_coverage(ledger,provider,check['asset'],ApiError)
                row, quote = ledger.reserve(uid, str(body.get('quote_id', '')))
                if row['state'] in {'completed', 'failed', 'refunded', 'processing'}:
                    return web.json_response({'spend_id': row['spend_id'], 'status': row['state']})
                # Unknown outcomes retain the reservation. Retrying uses the SAME spend_id.
                # Validation/network errors cannot safely release funds until reconciled.
                try:
                    result = await provider.call('payQr', {'quote_id': row['quote_id'], 'spend_id': row['spend_id']}, post=True)
                except ApiError as error:
                    definitive = {'QUOTE_EXPIRED', 'INSUFFICIENT_FUNDS', 'LIMIT_EXCEEDED', 'NOT_ENABLED', 'QR_UNREADABLE', 'QR_UNSUPPORTED', 'AMOUNT_OUT_OF_RANGE'}
                    if row['state'] == 'quoted' and error.name in definitive:
                        ledger.payment({'spend_id': row['spend_id'], 'status': 'failed', 'asset': quote['asset'], 'amount': quote['amount'], 'failure_reason': error.name})
                    raise
                ledger.payment(result)
                return web.json_response(result)
            raise ApiError('NOT_FOUND', 'Метод не найден', 404)
        except ApiError as error:
            return web.json_response({'ok': False, 'error': {'name': error.name}, 'detail': error.detail}, status=error.status, headers={'Retry-After': str(error.retry_after)} if error.retry_after else None)
        except (ValueError, KeyError, TypeError):
            return web.json_response({'ok': False, 'error': {'name': 'INVALID_REQUEST'}, 'detail': 'Некорректные данные запроса или ответа провайдера'}, status=400)

    async def cleanup(_):
        task=app.get('wpay_finance_task')
        if task:
            task.cancel();await asyncio.gather(task,return_exceptions=True)
        for task in app['wpay_broadcast_tasks']:
            task.cancel()
        if app['wpay_broadcast_tasks']:
            await asyncio.gather(*app['wpay_broadcast_tasks'], return_exceptions=True)
        await provider.close()
        await exchange.close()
        ledger.db.close()

    async def startup(_):
        if token and os.environ.get('WPAY_FINANCE_WORKER','1')!='0':
            app['wpay_finance_task']=asyncio.create_task(FinanceWorker(ledger,provider,money,ApiError).run())
        if bot_token:
            task = asyncio.create_task(sync_telegram_users(only_missing=True))
            app['wpay_broadcast_tasks'].add(task)
            task.add_done_callback(app['wpay_broadcast_tasks'].discard)

    app.router.add_route('*', '/api/wallet/{action}', route)
    app.on_startup.append(startup)
    app.on_cleanup.append(cleanup)
