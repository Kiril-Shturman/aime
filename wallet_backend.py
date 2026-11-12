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
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from urllib.parse import parse_qsl

from aiohttp import ClientSession, ClientTimeout, web

BASE_URL = 'https://goswap.site/api/'
NETWORKS = {'BSC', 'ETH', 'TON', 'SOL', 'TRON'}
DEPOSIT_NETWORKS = {'USDT': NETWORKS, 'ETH': {'ETH'}, 'BNB': {'BSC'}, 'TON': {'TON'}, 'SOL': {'SOL'}}


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


def telegram_user(raw, token):
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
        return f'tg:{uid}' if isinstance(uid, int) and not isinstance(uid, bool) and uid > 0 else None
    except (ValueError, KeyError, TypeError):
        return None


class ApiError(Exception):
    def __init__(self, name, detail, status=400):
        self.name, self.detail, self.status = name, detail, status


class GoSwap:
    def __init__(self, token):
        self.token = token
        self.session = None

    async def call(self, method, data=None, post=False):
        if not self.token:
            raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён', 503)
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
                    raise ApiError(error.get('name', 'PROVIDER_ERROR'), str(body.get('detail') or 'Ошибка провайдера')[:300], response.status if response.status >= 400 else 502)
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
        ''')

    def account(self, uid):
        self.db.execute('INSERT OR IGNORE INTO wallet_accounts VALUES (?,?)', (uid, 'wpay-' + uuid.uuid4().hex))
        return self.db.execute('SELECT client_ref FROM wallet_accounts WHERE user_id=?', (uid,)).fetchone()[0]

    def balance(self, uid, asset):
        row = self.db.execute('SELECT available,reserved FROM wallet_balances WHERE user_id=? AND asset=?', (uid, asset)).fetchone()
        return (Decimal(row[0]), Decimal(row[1])) if row else (Decimal(0), Decimal(0))

    def put_balance(self, uid, asset, available, reserved):
        if available < 0 or reserved < 0:
            raise ApiError('INSUFFICIENT_FUNDS', 'Недостаточно средств на вашем балансе', 409)
        self.db.execute('INSERT OR REPLACE INTO wallet_balances VALUES (?,?,?,?)', (uid, asset, str(available), str(reserved)))

    def deposit(self, payload):
        uid = self.db.execute('SELECT user_id FROM wallet_accounts WHERE client_ref=?', (payload.get('client_ref'),)).fetchone()
        if not uid:
            return False
        amount = money(payload['credited'])
        asset = str(payload['asset']).upper()
        event_id = 'deposit:' + str(payload['deposit_id'])
        self.db.execute('BEGIN IMMEDIATE')
        try:
            if self.db.execute('SELECT 1 FROM wallet_events WHERE event_id=?', (event_id,)).fetchone():
                self.db.execute('COMMIT')
                return False
            available, reserved = self.balance(uid[0], asset)
            with localcontext() as ctx:
                ctx.prec = 50
                self.put_balance(uid[0], asset, available + amount, reserved)
            self.db.execute('INSERT INTO wallet_events VALUES (?,?,?,?,?,?,?)', (event_id, uid[0], asset, str(amount), 'deposit', str(payload.get('credited_at') or now()), json.dumps(payload)))
            self.db.execute('COMMIT')
            return True
        except Exception:
            self.db.execute('ROLLBACK')
            raise

    def reserve(self, uid, quote_id):
        self.db.execute('BEGIN IMMEDIATE')
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
                available, reserved = self.balance(uid, quote['asset'])
                self.put_balance(uid, quote['asset'], add(available, -amount), add(reserved, amount))
                self.db.execute("UPDATE wallet_quotes SET state='reserved' WHERE quote_id=?", (quote_id,))
            self.db.execute('COMMIT')
            return dict(row), quote
        except Exception:
            self.db.execute('ROLLBACK')
            raise

    def payment(self, payload):
        state = payload.get('status')
        if state not in {'processing', 'completed', 'failed', 'refunded'}:
            raise ValueError('Некорректный статус платежа')
        self.db.execute('BEGIN IMMEDIATE')
        try:
            row = self.db.execute('SELECT * FROM wallet_quotes WHERE spend_id=?', (payload.get('spend_id'),)).fetchone()
            if not row or row['state'] == 'quoted':
                self.db.execute('COMMIT')
                return False
            old = row['state']
            if old in {'failed', 'refunded'} or old == state or (old == 'completed' and state != 'refunded'):
                self.db.execute('COMMIT')
                return False
            quote = json.loads(row['body'])
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
            self.db.execute('COMMIT')
            return True
        except Exception:
            self.db.execute('ROLLBACK')
            raise


def install_wallet(app, root, owner_check):
    # Local service secrets are read only here, never served or bundled.
    secrets_file = os.path.join(root, '.env.wallet')
    if os.path.isfile(secrets_file):
        with open(secrets_file, encoding='utf-8') as config:
            for line in config:
                key, sep, value = line.strip().partition('=')
                if sep and key in {'GOSWAP_API_TOKEN', 'WPAY_BOT_TOKEN', 'WPAY_DB_PATH'}:
                    os.environ.setdefault(key, value.strip().strip('\"\''))
    token = os.environ.get('GOSWAP_API_TOKEN', '')
    bot_token = os.environ.get('WPAY_BOT_TOKEN') or os.environ.get('BOARD_BOT_TOKEN', '')
    ledger = Ledger(os.environ.get('WPAY_DB_PATH', os.path.join(root, 'wpay.sqlite3')))
    provider = GoSwap(token)
    app['wpay_provider'] = provider
    app['wpay_ledger'] = ledger

    def identity(request):
        uid = telegram_user(request.headers.get('X-Telegram-Init-Data', ''), bot_token)
        if uid:
            return uid
        key = request.headers.get('X-Board-Key', '')
        if key and owner_check(key):
            return 'owner'
        raise ApiError('AUTH_REQUIRED', 'Откройте кошелёк из Telegram или войдите как владелец', 401)

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
                raw = await request.read()
                signature = request.headers.get('crypto-pay-api-signature', '')
                expected = hmac.new(hashlib.sha256(token.encode()).digest(), raw, hashlib.sha256).hexdigest()
                if not token or not hmac.compare_digest(expected, signature):
                    raise ApiError('BAD_SIGNATURE', 'Неверная подпись', 401)
                event = json.loads(raw)
                kind, payload = event.get('update_type'), event.get('payload', {})
                if kind == 'deposit_received':
                    ledger.deposit(payload)
                elif kind in {'qr_payment_completed', 'qr_payment_failed', 'qr_payment_refunded'}:
                    status = kind.removeprefix('qr_payment_')
                    if payload.get('status') != status:
                        raise ValueError('Несовпадение типа события и статуса')
                    ledger.payment(payload)
                return web.json_response({'ok': True})
            uid = identity(request)
            client_ref = ledger.account(uid)
            if not token:
                raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён. Ожидается серверный API-ключ.', 503)
            if action == 'overview' and request.method == 'GET':
                await sync_payments(uid)
                rates = await provider.call('getExchangeRates')
                balances = [dict(r) for r in ledger.db.execute('SELECT asset,available,reserved FROM wallet_balances WHERE user_id=?', (uid,))]
                items = [dict(r) for r in ledger.db.execute('SELECT event_id,asset,amount,type,created_at,detail FROM wallet_events WHERE user_id=? ORDER BY rowid DESC LIMIT 100', (uid,))]
                for item in items:
                    item['detail'] = json.loads(item['detail'])
                return web.json_response({'balances': balances, 'rates': rates, 'transactions': items})
            if action == 'provider' and request.method == 'GET':
                if uid != 'owner':
                    raise ApiError('FORBIDDEN', 'Только владелец', 403)
                return web.json_response({'app': await provider.call('getMe'), 'organization_balance': await provider.call('getBalance')})
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
                    if asset != 'USDT':
                        raise ValueError('TRON поддерживает пополнение USDT')
                    result = await provider.call('createExactDeposit', {'client_ref': client_ref, 'amount': str(money(body.get('amount'))), 'network': 'TRON', 'asset': 'USDT'}, post=True)
                else:
                    result = await provider.call('createDeposit', {'client_ref': client_ref, 'network': network, 'asset': asset}, post=True)
                return web.json_response(result)
            if action == 'sync' and request.method == 'POST':
                # Fetch all pages; bound the work and allow the next sync to continue.
                for offset in range(0, 5000, 1000):
                    data = await provider.call('getDeposits', {'client_ref': client_ref, 'count': 1000, 'offset': offset})
                    items = data.get('items', [])
                    for item in items:
                        if item.get('client_ref') == client_ref:
                            ledger.deposit(item)
                    if len(items) < 1000:
                        break
                await sync_payments(uid)
                return web.json_response({'ok': True})
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
            return web.json_response({'ok': False, 'error': {'name': error.name}, 'detail': error.detail}, status=error.status)
        except (ValueError, KeyError, TypeError):
            return web.json_response({'ok': False, 'error': {'name': 'INVALID_REQUEST'}, 'detail': 'Некорректные данные запроса или ответа провайдера'}, status=400)

    async def cleanup(_):
        await provider.close()
        ledger.db.close()
    app.router.add_route('*', '/api/wallet/{action}', route)
    app.on_cleanup.append(cleanup)
