"""WPay: GoSwap transport, per-user ledger, signed webhooks and QR reservations.

Secrets: GOSWAP_API_TOKEN, WPAY_BOT_TOKEN (or BOARD_BOT_TOKEN).
Only this module sees the provider token; organization funds are never a user's
balance. All money arithmetic uses Decimal and SQLite write transactions.
"""
from wallet_exchange_routes import (
    prepare as prepare_exchange_rules, rules as exchange_rules,
    save_rule as save_exchange_rule, resolve as resolve_exchange_route, internal_exchange,
)
from wallet_dex import PAIR as DEX_PAIR, quote_bnb
import asyncio
from wallet_fixedfloat_orders import Orders
from wallet_card_ui import CardUI
from wallet_fixedfloat import FixedFloat, exchange_route, prepare_exchange_limits
from wallet_key_export import prepare as prepare_key_export, route as key_export_route, fresh as fresh_wallet_auth
from wallet_exchange_funding import Funding
from wallet_custody_withdrawal import CustodyWithdrawal
from wallet_admin_wallets import control_wallet, user_wallet_inventory
from wallet_custody import Custody, custody_route, prepare as prepare_custody
from wallet_chain import ASSET_NETWORKS as CUSTODY_ASSET_NETWORKS, ChainReader
from wallet_aura_errors import wallet_error_payload
import hashlib
import hmac
import json
import logging
import os
import re
import sqlite3
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, localcontext
from urllib.parse import parse_qsl, quote, urlsplit

from aiohttp import ClientError, ClientSession, ClientTimeout, FormData, web
from xml.etree import ElementTree
from wallet_avatar import load_avatar, AvatarNotFound

from wallet_book import Book
from wallet_user_ops import prepare as prepare_user_ops, route as user_ops_route
from wallet_inbox import prepare as prepare_inbox, receive as receive_webhook
from wallet_finance_worker import prepare as prepare_finance_worker, Worker as FinanceWorker
from wallet_finance import finance_route, require_coverage, require_goswap_user_funds
from wallet_notifications import (
    prepare as prepare_notifications, snapshot as notification_snapshot,
    NotificationWorker, save_template as save_notification_template,
)
from wallet_referrals import capture as capture_referral, ensure_code as ensure_referral_code, prepare as prepare_referrals, summary as referral_summary
from wallet_operations import goswap_network_balances, prepare_operations, operations_route, save_address
from wallet_withdrawals import prepare_withdrawals, withdrawal_route, reconcile as reconcile_withdrawals, debt
from wallet_tariffs import prepare as prepare_tariffs, snapshot as tariff_snapshot, create_version as create_tariff_version
from wallet_aura import (
    AuraClient, AuraService, prepare as prepare_aura,
    receive_webhook as receive_aura_webhook, process_inbox as process_aura_inbox,
    reconcile as reconcile_aura, run_worker as run_aura_worker,
    reconcile_pending as reconcile_aura_pending, store_withdrawal_snapshot,
    user_withdrawal as aura_user_withdrawal, withdrawal_frozen as aura_withdrawal_frozen,
)

BASE_URL = 'https://goswap.site/api/'
NETWORKS = {'BSC', 'ETH', 'TON', 'SOL', 'TRON'}
DEPOSIT_NETWORKS = {'USDT': NETWORKS, 'ETH': {'ETH'}, 'BNB': {'BSC'}, 'TON': {'TON'}, 'SOL': {'SOL'}}
WALLET_ASSET_NETWORKS = {
    'USDT': ('BSC', 'ETH', 'TON', 'SOL', 'TRON'),
    'TRX': ('TRON',), 'BNB': ('BSC',), 'ETH': ('ETH',),
    'GRAM': ('TON',), 'SOL': ('SOL',), 'BTC': ('BTC',), 'XAUT': ('ETH',),
}

def deposit_provider_options(asset, network):
    options = []
    if network in CUSTODY_ASSET_NETWORKS.get(asset, ()):
        options.append('wpay')
    if network in DEPOSIT_NETWORKS.get(asset, ()):
        options.append('goswap')
    if (asset, network) == ('USDT', 'TRON'):
        options.append('aura')
    return options


def default_deposit_provider(asset, network):
    if asset == 'USDT':
        return 'aura' if network == 'TRON' else 'goswap'
    return 'wpay'


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


def _aura_method(title, verb, path, *, params=(), required=(), example=None,
                 path_params=(), query_params=(), dangerous=False,
                 idempotent=False, blocked_reason=None):
    return {
        'title': title, 'verb': verb, 'path': path,
        'params': list(params), 'required': list(required),
        'example': example or {}, 'path_params': list(path_params),
        'query_params': list(query_params), 'dangerous': dangerous,
        'idempotent': idempotent, 'blocked_reason': blocked_reason,
    }


# Complete Aura Partner API 3.17 catalog. Calls are deliberately allowlisted:
# secrets/requisites remain visible as catalog entries, but cannot be revealed
# through the general-purpose admin console.
ADMIN_AURA_METHODS = {
    'getMe': _aura_method('Партнёр и подключённые продукты', 'GET', '/me'),
    'getBalance': _aura_method('Баланс партнёра', 'GET', '/balance'),
    'getBalanceHistory': _aura_method(
        'История баланса', 'GET', '/balance/history',
        params=('type', 'status', 'sort', 'order', 'from', 'to', 'cursor', 'limit'),
        query_params=('type', 'status', 'sort', 'order', 'from', 'to', 'cursor', 'limit'),
        example={'limit': 100, 'sort': 'created_at', 'order': 'desc'},
    ),
    'getBalanceOperation': _aura_method(
        'Операция баланса', 'GET', '/balance/history/{operation_id}',
        params=('operation_id',), required=('operation_id',), path_params=('operation_id',),
        example={'operation_id': ''},
    ),
    'listEvents': _aura_method(
        'События и доставки webhook', 'GET', '/events',
        params=('type', 'created_after', 'created_before', 'cursor', 'limit'),
        query_params=('type', 'created_after', 'created_before', 'cursor', 'limit'),
        example={'limit': 25},
    ),
    'getEvent': _aura_method(
        'Событие', 'GET', '/events/{event_id}', params=('event_id',),
        required=('event_id',), path_params=('event_id',), example={'event_id': ''},
    ),
    'redeliverEvent': _aura_method(
        'Повторить доставку события', 'POST', '/events/{event_id}/redeliver',
        params=('event_id',), required=('event_id',), path_params=('event_id',),
        example={'event_id': ''}, dangerous=True, idempotent=True,
    ),
    'listCustomers': _aura_method(
        'Клиенты', 'GET', '/customers', params=('cursor', 'limit'),
        query_params=('cursor', 'limit'), example={'limit': 100},
    ),
    'createCustomer': _aura_method(
        'Создать или обновить клиента', 'POST', '/customers',
        params=('id', 'email', 'phone'), required=('id',),
        example={'id': '', 'email': '', 'phone': ''}, dangerous=True,
    ),
    'getCustomer': _aura_method(
        'Клиент', 'GET', '/customers/{customer_id}', params=('customer_id',),
        required=('customer_id',), path_params=('customer_id',), example={'customer_id': ''},
    ),
    'getCustomerKyc': _aura_method(
        'Статус KYC', 'GET', '/customers/{customer_id}/kyc', params=('customer_id',),
        required=('customer_id',), path_params=('customer_id',), example={'customer_id': ''},
    ),
    'startCustomerKyc': _aura_method(
        'Запустить KYC', 'POST', '/customers/{customer_id}/kyc', params=('customer_id',),
        required=('customer_id',), path_params=('customer_id',),
        example={'customer_id': ''}, dangerous=True,
    ),
    'importCustomerIdentity': _aura_method(
        'Импорт KYC-данных', 'POST', '/customers/{customer_id}/kyc/identity',
        params=('customer_id',), required=('customer_id',), path_params=('customer_id',),
        example={'customer_id': ''}, blocked_reason='Паспорт и ИНН доступны только в защищённом KYC-flow',
    ),
    'getCardFees': _aura_method('Тарифы выпуска карт', 'GET', '/cards-fees'),
    'listCards': _aura_method(
        'Карты', 'GET', '/cards', params=('cursor', 'limit'),
        query_params=('cursor', 'limit'), example={'limit': 100},
    ),
    'createCard': _aura_method(
        'Выпустить карту', 'POST', '/cards',
        params=('owner_id', 'type', 'shipping_address'), required=('owner_id', 'type'),
        example={'owner_id': '', 'type': 'virtual'}, dangerous=True, idempotent=True,
    ),
    'getCard': _aura_method(
        'Карта', 'GET', '/cards/{card_id}', params=('card_id',),
        required=('card_id',), path_params=('card_id',), example={'card_id': ''},
    ),
    'getCardCredentials': _aura_method(
        'Реквизиты карты', 'GET', '/cards/{card_id}/credentials',
        params=('card_id',), required=('card_id',), path_params=('card_id',),
        example={'card_id': ''}, blocked_reason='PAN, CVV и срок карты нельзя выводить в общей API-консоли',
    ),
    'getLatestCardOtp': _aura_method(
        'Последний 3DS-код', 'GET', '/cards/{card_id}/otp/latest',
        params=('card_id',), required=('card_id',), path_params=('card_id',),
        example={'card_id': ''}, blocked_reason='OTP доступен только владельцу карты в no-store flow',
    ),
    'listCardOperations': _aura_method(
        'Все операции по картам', 'GET', '/cards/operations',
        params=('cursor', 'limit'), query_params=('cursor', 'limit'), example={'limit': 100},
    ),
    'listCardOperationsByCard': _aura_method(
        'Операции одной карты', 'GET', '/cards/{card_id}/operations',
        params=('card_id', 'cursor', 'limit'), required=('card_id',),
        path_params=('card_id',), query_params=('cursor', 'limit'),
        example={'card_id': '', 'limit': 100},
    ),
    'rechargeCard': _aura_method(
        'Пополнить карту', 'POST', '/cards/{card_id}/recharge',
        params=('card_id', 'amount', 'amount_spend'), required=('card_id',),
        path_params=('card_id',), example={'card_id': '', 'amount': '25'},
        dangerous=True, idempotent=True,
    ),
    'freezeCard': _aura_method(
        'Заморозить карту', 'POST', '/cards/{card_id}/freeze',
        params=('card_id',), required=('card_id',), path_params=('card_id',),
        example={'card_id': ''}, dangerous=True,
    ),
    'unfreezeCard': _aura_method(
        'Разморозить карту', 'POST', '/cards/{card_id}/unfreeze',
        params=('card_id',), required=('card_id',), path_params=('card_id',),
        example={'card_id': ''}, dangerous=True,
    ),
    'cancelCard': _aura_method(
        'Закрыть карту', 'POST', '/cards/{card_id}/cancel', params=('card_id',),
        required=('card_id',), path_params=('card_id',), example={'card_id': ''}, dangerous=True,
    ),
    'activateCard': _aura_method(
        'Активировать физическую карту', 'POST', '/cards/{card_id}/activate',
        params=('card_id',), required=('card_id',), path_params=('card_id',),
        example={'card_id': ''}, blocked_reason='Код активации нельзя вводить в общей API-консоли',
    ),
    'setCardPin': _aura_method(
        'Установить PIN', 'POST', '/cards/{card_id}/pin', params=('card_id',),
        required=('card_id',), path_params=('card_id',), example={'card_id': ''},
        blocked_reason='PIN нельзя вводить или возвращать через общую API-консоль',
    ),
    'getSbpRate': _aura_method('Курс покупки через СБП', 'GET', '/rate'),
    'createSbpQuote': _aura_method(
        'Котировка СБП', 'POST', '/quotes', params=('customer_id', 'fiat_amount'),
        required=('customer_id', 'fiat_amount'), example={'customer_id': '', 'fiat_amount': '1000'},
    ),
    'listSbpOrders': _aura_method(
        'Заказы СБП', 'GET', '/orders',
        params=('customer_id', 'status', 'created_from', 'created_to', 'cursor', 'limit'),
        query_params=('customer_id', 'status', 'created_from', 'created_to', 'cursor', 'limit'),
        example={'limit': 20},
    ),
    'createSbpOrder': _aura_method(
        'Создать заказ СБП', 'POST', '/orders', params=('customer_id', 'quote_token'),
        required=('customer_id', 'quote_token'), example={'customer_id': '', 'quote_token': ''},
        dangerous=True, idempotent=True,
    ),
    'getSbpOrder': _aura_method(
        'Заказ СБП', 'GET', '/orders/{order_id}', params=('order_id',),
        required=('order_id',), path_params=('order_id',), example={'order_id': ''},
    ),
    'cancelSbpOrder': _aura_method(
        'Отменить заказ СБП', 'POST', '/orders/{order_id}/cancel', params=('order_id',),
        required=('order_id',), path_params=('order_id',), example={'order_id': ''}, dangerous=True,
    ),
    'listDepositAddresses': _aura_method(
        'Депозитные адреса клиента', 'GET', '/customers/{customer_id}/deposit-addresses',
        params=('customer_id', 'cursor', 'limit'), required=('customer_id',),
        path_params=('customer_id',), query_params=('cursor', 'limit'),
        example={'customer_id': '', 'limit': 100}, dangerous=True,
    ),
    'createDepositAddress': _aura_method(
        'Создать дополнительный адрес', 'POST', '/customers/{customer_id}/deposit-addresses',
        params=('customer_id', 'label'), required=('customer_id',), path_params=('customer_id',),
        example={'customer_id': '', 'label': ''}, dangerous=True,
    ),
    'getDepositAddress': _aura_method(
        'Депозитный адрес', 'GET', '/deposit-addresses/{address_id}', params=('address_id',),
        required=('address_id',), path_params=('address_id',), example={'address_id': ''},
    ),
    'listDeposits': _aura_method(
        'Пополнения', 'GET', '/deposits', params=('customer_id', 'cursor', 'limit'),
        query_params=('customer_id', 'cursor', 'limit'), example={'limit': 100},
    ),
    'getDeposit': _aura_method(
        'Пополнение', 'GET', '/deposits/{deposit_id}', params=('deposit_id',),
        required=('deposit_id',), path_params=('deposit_id',), example={'deposit_id': ''},
    ),
    'getDepositFees': _aura_method('Комиссии пополнений', 'GET', '/deposits-fees'),
    'createQrQuote': _aura_method(
        'Распознать QR и получить котировку', 'POST', '/qr-payments/quotes',
        params=('customer_id', 'qr_payload'), required=('qr_payload',),
        example={'customer_id': '', 'qr_payload': ''},
    ),
    'listQrPayments': _aura_method(
        'QR-платежи', 'GET', '/qr-payments',
        params=('customer_id', 'status', 'created_from', 'created_to', 'cursor', 'limit'),
        query_params=('customer_id', 'status', 'created_from', 'created_to', 'cursor', 'limit'),
        example={'limit': 20},
    ),
    'createQrPayment': _aura_method(
        'Оплатить QR', 'POST', '/qr-payments',
        params=('customer_id', 'quote_token', 'qr_payload'),
        required=('customer_id', 'quote_token', 'qr_payload'),
        example={'customer_id': '', 'quote_token': '', 'qr_payload': ''},
        dangerous=True, idempotent=True,
    ),
    'getQrPayment': _aura_method(
        'QR-платёж', 'GET', '/qr-payments/{payment_id}', params=('payment_id',),
        required=('payment_id',), path_params=('payment_id',), example={'payment_id': ''},
    ),
    'listWithdrawals': _aura_method(
        'Выводы TRC-20', 'GET', '/withdrawals', params=('status', 'cursor', 'limit'),
        query_params=('status', 'cursor', 'limit'), example={'limit': 100},
    ),
    'createWithdrawal': _aura_method(
        'Создать вывод TRC-20', 'POST', '/withdrawals',
        params=('amount', 'address', 'note'), required=('amount', 'address'),
        example={'amount': '10', 'address': '', 'note': ''}, dangerous=True, idempotent=True,
    ),
    'getWithdrawal': _aura_method(
        'Вывод TRC-20', 'GET', '/withdrawals/{withdrawal_id}', params=('withdrawal_id',),
        required=('withdrawal_id',), path_params=('withdrawal_id',), example={'withdrawal_id': ''},
    ),
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


def safe_aura_event_for_admin(event):
    """Return an event without exposing short-lived card secrets to the UI."""
    result = json.loads(json.dumps(event))
    if result.get('type') == 'card.otp' and isinstance(result.get('data'), dict):
        if 'code' in result['data']:
            result['data']['code'] = '[REDACTED]'
    return result


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
          CREATE TABLE IF NOT EXISTS admin_action_audit (audit_id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, action TEXT NOT NULL, target_user_id TEXT, outcome TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS admin_action_audit_created ON admin_action_audit(created_at);
          CREATE INDEX IF NOT EXISTS admin_action_audit_target ON admin_action_audit(target_user_id,created_at);
        ''')

        prepare_withdrawals(self)
        prepare_tariffs(self)
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
        prepare_referrals(self)

    def account(self, uid, profile=None, bot_started=False, source='miniapp', start_param=None, touch=True):
        stamp = now()
        telegram_id = int(uid[3:]) if uid.startswith('tg:') and uid[3:].isdigit() else None
        inserted = self.db.execute(
            'INSERT OR IGNORE INTO wallet_accounts(user_id,client_ref,telegram_id,created_at,updated_at,last_seen,last_miniapp_at) VALUES (?,?,?,?,?,?,?)',
            (uid, 'wpay-' + uuid.uuid4().hex, telegram_id, stamp, stamp,
             stamp if touch and source == 'miniapp' else None,
             stamp if touch and source == 'miniapp' else None),
        )
        if uid.startswith('tg:'):
            ensure_referral_code(self, uid)
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
            capture_referral(self, uid, start_param, source, inserted.rowcount == 1)
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

    def deposit(self, payload, manage_transaction=True):
        uid = self.db.execute('SELECT user_id FROM wallet_accounts WHERE client_ref=?', (payload.get('client_ref'),)).fetchone()
        if not uid:
            return False
        amount = money(payload['credited'])
        asset = str(payload['asset']).upper()
        event_id = 'deposit:' + str(payload['deposit_id'])
        if manage_transaction:
            self.begin('deposit','provider',event_id)
        try:
            self.db.execute('INSERT OR IGNORE INTO wallet_deposit_owners VALUES (?,?,?)',(str(payload['deposit_id']),uid[0],asset))
            if self.db.execute('SELECT 1 FROM wallet_events WHERE event_id=?', (event_id,)).fetchone():
                if manage_transaction:
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
            if manage_transaction:
                self.commit()
            return True
        except Exception:
            if manage_transaction:
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
                require_goswap_user_funds(self, uid, quote['asset'], available, amount, ApiError)
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
                if sep and key in {
                    'GOSWAP_API_TOKEN', 'WPAY_BOT_TOKEN', 'WPAY_DB_PATH', 'WPAY_ADMIN_IDS',
                    'WPAY_CUSTODY_ENABLED', 'WPAY_CUSTODY_CHAIN_ENV', 'WPAY_CUSTODY_PUBLIC_KEY_FILE',
                    'FIXEDFLOAT_API_KEY', 'FIXEDFLOAT_API_SECRET', 'WPAY_FIXEDFLOAT_ORDERS_ENABLED', 'WPAY_WALLET_FUNDING_ENABLED',
                    'AURA_API_KEY', 'AURA_ENVIRONMENT', 'AURA_BASE_URL',
                    'AURA_WEBHOOK_SECRET', 'AURA_PARTNER_ID', 'WPAY_AURA_ENABLED',
                }:
                    os.environ.setdefault(key, value.strip().strip('\"\''))
    token = os.environ.get('GOSWAP_API_TOKEN', '')
    aura_enabled = os.environ.get('WPAY_AURA_ENABLED', '0') == '1'
    aura_environment = os.environ.get('AURA_ENVIRONMENT', 'test')
    aura_token = os.environ.get('AURA_API_KEY', '')
    aura_secret = os.environ.get('AURA_WEBHOOK_SECRET', '')
    aura_partner_id = os.environ.get('AURA_PARTNER_ID', '') or None
    bot_token = os.environ.get('WPAY_BOT_TOKEN') or os.environ.get('BOARD_BOT_TOKEN', '')
    admin_ids = {value.strip() for value in os.environ.get('WPAY_ADMIN_IDS', '').split(',') if value.strip().isdigit()}
    ledger = Ledger(os.environ.get('WPAY_DB_PATH', os.path.join(root, 'wpay.sqlite3')))
    prepare_operations(ledger)
    prepare_withdrawals(ledger)
    prepare_user_ops(ledger)
    prepare_inbox(ledger)
    prepare_aura(ledger)
    prepare_finance_worker(ledger)
    prepare_notifications(ledger)
    prepare_exchange_limits(ledger)
    prepare_exchange_rules(ledger)
    exchange = FixedFloat(os.environ.get('FIXEDFLOAT_API_KEY', ''), os.environ.get('FIXEDFLOAT_API_SECRET', ''), ApiError)
    exchange.ledger = ledger
    app['wpay_exchange'] = exchange
    exchange_orders = Orders(ledger, exchange, enabled=os.environ.get('WPAY_FIXEDFLOAT_ORDERS_ENABLED','0') == '1')
    app['wpay_exchange_orders'] = exchange_orders
    prepare_custody(ledger)
    custody = Custody(
        ledger, ApiError,
        enabled=os.environ.get('WPAY_CUSTODY_ENABLED', '0') == '1',
        public_key_file=os.environ.get('WPAY_CUSTODY_PUBLIC_KEY_FILE', ''),
        chain_env=os.environ.get('WPAY_CUSTODY_CHAIN_ENV', 'testnet'),
    )
    app['wpay_custody'] = custody
    prepare_key_export(ledger)
    exchange_funding = Funding(ledger, exchange_orders, custody, enabled=os.environ.get('WPAY_WALLET_FUNDING_ENABLED','0') == '1')
    custody_withdrawal = CustodyWithdrawal(
        exchange_funding, enabled=os.environ.get('WPAY_CUSTODY_WITHDRAWAL_ENABLED') == '1',
        bnb_enabled=os.environ.get('WPAY_CUSTODY_BNB_WITHDRAWAL_ENABLED') == '1',
    )
    app['wpay_exchange_funding'] = exchange_funding
    app['wpay_chain'] = ChainReader(ledger, ApiError)
    prepare_tariffs(ledger)
    ledger.db.executescript('''
      CREATE TABLE IF NOT EXISTS wallet_asset_routes (
        asset TEXT NOT NULL, network TEXT NOT NULL, enabled INTEGER NOT NULL,
        updated_at TEXT NOT NULL, updated_by TEXT NOT NULL,
        PRIMARY KEY(asset,network)
      );
    ''')
    ledger.db.execute("""CREATE TABLE IF NOT EXISTS wallet_deposit_providers (
        asset TEXT NOT NULL, network TEXT NOT NULL, provider TEXT NOT NULL,
        PRIMARY KEY(asset, network)
    )""")
    if not ledger.db.execute('SELECT 1 FROM wallet_asset_routes LIMIT 1').fetchone():
        stamp = now()
        ledger.db.executemany(
            'INSERT INTO wallet_asset_routes VALUES (?,?,?,?,?)',
            [(asset, network, 1, stamp, 'system-default')
             for asset, networks in WALLET_ASSET_NETWORKS.items() for network in networks],
        )
    provider = GoSwap(token)
    aura_client = AuraClient(
        aura_token, aura_environment, ApiError,
        base_url=os.environ.get('AURA_BASE_URL') or None,
    )
    aura_service = AuraService(ledger, aura_client, aura_environment)
    card_ui = CardUI(ledger, aura_service, enabled=aura_enabled)
    app["wpay_card_ui"] = card_ui
    app['wpay_provider'] = provider
    app['wpay_aura_provider'] = aura_client
    app['wpay_ledger'] = ledger
    app['wpay_broadcast_tasks'] = set()
    app['wpay_notification_worker'] = NotificationWorker(
        ledger, bot_token, os.environ.get('WPAY_APP_URL', 'https://wallet.178-236-255-214.nip.io/wallet'),
        otp_lookup=aura_service.notification_otp if aura_enabled else None,
    )

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

    def deposit_provider(asset, network):
        row = ledger.db.execute(
            'SELECT provider FROM wallet_deposit_providers WHERE asset=? AND network=?',
            (asset, network),
        ).fetchone()
        return row['provider'] if row else default_deposit_provider(asset, network)

    def asset_route_rows():
        rows = [dict(row) for row in ledger.db.execute(
            "SELECT asset,network,enabled,updated_at,updated_by FROM wallet_asset_routes "
            "ORDER BY CASE asset WHEN 'USDT' THEN 0 ELSE 1 END,asset,network"
        )]
        for row in rows:
            asset, network = row['asset'], row['network']
            row['provider'] = deposit_provider(asset, network)
            row['providers'] = deposit_provider_options(asset, network)
        return rows

    def enabled_asset_routes():
        result = {}
        for row in asset_route_rows():
            if row['enabled']:
                result.setdefault(row['asset'], []).append(row['network'])
        return result

    def asset_enabled(asset, network=None):
        asset = str(asset or '').upper()
        if network is None:
            return bool(enabled_asset_routes().get(asset))
        row = ledger.db.execute(
            'SELECT enabled FROM wallet_asset_routes WHERE asset=? AND network=?',
            (asset, str(network or '').upper()),
        ).fetchone()
        return bool(row and row['enabled'])

    def require_asset_enabled(asset, network=None):
        if not asset_enabled(asset, network):
            suffix = f' / {str(network).upper()}' if network else ''
            raise ApiError(
                'ASSET_DISABLED', f'{str(asset).upper()}{suffix} отключён администратором', 403
            )

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
            'problems': admin_problems(),
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

    def record_admin_action(admin_id, action, target_user_id=None, outcome='succeeded', detail=None):
        safe_detail = detail if isinstance(detail, dict) else {}
        ledger.db.execute(
            'INSERT INTO admin_action_audit VALUES (?,?,?,?,?,?,?)',
            (
                'audit-' + uuid.uuid4().hex, str(admin_id), str(action),
                str(target_user_id) if target_user_id else None, str(outcome),
                json.dumps(safe_detail, ensure_ascii=False, separators=(',', ':')), now(),
            ),
        )

    def admin_audit(request):
        count = min(max(int(request.query.get('count', '100')), 1), 500)
        target_user_id = str(request.query.get('user_id') or '').strip()
        action_filter = str(request.query.get('action') or '').strip()[:100]
        clauses, params = [], []
        if target_user_id:
            if not target_user_id.startswith('tg:') or not target_user_id[3:].isdigit():
                raise ValueError('Некорректный идентификатор пользователя')
            clauses.append('target_user_id=?')
            params.append(target_user_id)
        if action_filter:
            clauses.append('action=?')
            params.append(action_filter)
        where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
        params.append(count)
        return {
            'items': decoded_rows(
                'SELECT audit_id,admin_id,action,target_user_id,outcome,detail,created_at '
                f'FROM admin_action_audit{where} ORDER BY rowid DESC LIMIT ?', params,
            ),
            'total': ledger.db.execute(
                f'SELECT COUNT(*) FROM admin_action_audit{where}', params[:-1],
            ).fetchone()[0],
        }

    def admin_users():
        rows = decoded_rows('''
          SELECT a.*,
                 COALESCE((SELECT COUNT(*) FROM wallet_events e WHERE e.user_id=a.user_id),0) event_count,
                 COALESCE((SELECT COUNT(*) FROM wallet_addresses d WHERE d.user_id=a.user_id),0) address_count,
                 COALESCE((SELECT COUNT(*) FROM wallet_referrals r WHERE r.referrer_user_id=a.user_id),0) referral_count,
                 (SELECT r.referrer_user_id FROM wallet_referrals r WHERE r.referred_user_id=a.user_id) referred_by,
                 ac.customer_id aura_customer_id, ac.state aura_customer_state,
                 ac.environment aura_environment,
                 COALESCE(k.status, CASE WHEN ac.customer_id IS NOT NULL THEN 'not_started' END) kyc_status,
                 COALESCE(k.verified,0) kyc_verified, COALESCE(k.terminal,0) kyc_terminal,
                 COALESCE((SELECT COUNT(*) FROM aura_cards c WHERE c.user_id=a.user_id),0) card_count
          FROM wallet_accounts a
          LEFT JOIN aura_customers ac ON ac.user_id=a.user_id
          LEFT JOIN aura_kyc_cases k ON k.user_id=a.user_id
          WHERE a.user_id LIKE 'tg:%'
          ORDER BY COALESCE(a.last_seen,a.created_at) DESC, a.rowid DESC LIMIT 1000
        ''')
        balances = decoded_rows('SELECT user_id,asset,available,reserved FROM wallet_balances ORDER BY user_id,asset')
        by_user = {}
        for balance in balances:
            by_user.setdefault(balance['user_id'], []).append(balance)
        for row in rows:
            row['balances'] = by_user.get(row['user_id'], [])
        return {'items': rows, 'total': ledger.db.execute("SELECT COUNT(*) FROM wallet_accounts WHERE user_id LIKE 'tg:%'").fetchone()[0]}

    def masked_email(value):
        if not value or '@' not in str(value):
            return None
        local, domain = str(value).split('@', 1)
        return (local[:2] if len(local) > 1 else local[:1]) + '***@' + domain

    def masked_phone(value):
        digits = ''.join(character for character in str(value or '') if character.isdigit())
        if len(digits) < 4:
            return None
        prefix = '+' + digits[0] if str(value).strip().startswith('+') else digits[0]
        return f'{prefix} *** ***-**-{digits[-2:]}'

    async def admin_user(request):
        user_id = str(request.query.get('user_id') or '')
        if not user_id.startswith('tg:') or not user_id[3:].isdigit():
            raise ValueError('Некорректный идентификатор пользователя')
        account = ledger.db.execute('SELECT * FROM wallet_accounts WHERE user_id=?', (user_id,)).fetchone()
        if not account:
            raise ApiError('NOT_FOUND', 'Пользователь не найден', 404)
        contact = ledger.db.execute(
            'SELECT email,phone,updated_at FROM wallet_profile_contacts WHERE user_id=? AND environment=?',
            (user_id, aura_environment),
        ).fetchone()
        customer = ledger.db.execute(
            'SELECT customer_id,environment,state,provider_updated_at,created_at,updated_at '
            'FROM aura_customers WHERE user_id=?', (user_id,),
        ).fetchone()
        kyc = ledger.db.execute(
            'SELECT status,verified,terminal,reason,provider_updated_at,created_at,updated_at '
            'FROM aura_kyc_cases WHERE user_id=?', (user_id,),
        ).fetchone()
        return {
            'account': dict(account),
            'contacts': {
                'email': masked_email(contact['email']) if contact else None,
                'phone': masked_phone(contact['phone']) if contact else None,
                'updated_at': contact['updated_at'] if contact else None,
            },
            'aura': {
                'customer': dict(customer) if customer else None,
                'kyc': dict(kyc) if kyc else None,
                'cards': decoded_rows(
                    'SELECT card_id,kind,status,frozen,masked_pan,delivery_status,tracking,'
                    'provider_updated_at,created_at,updated_at FROM aura_cards WHERE user_id=? '
                    'ORDER BY updated_at DESC LIMIT 50', (user_id,),
                ),
            },
            'credit_assets': enabled_asset_routes(),
            'wallets': await user_wallet_inventory(
                ledger, app['wpay_chain'], user_id,
                {network: deposit_provider('USDT', network) for network in enabled_asset_routes().get('USDT', [])},
                aura_environment,
            ),
            'balances': decoded_rows(
                'SELECT asset,available,reserved FROM wallet_balances WHERE user_id=? ORDER BY asset',
                (user_id,),
            ),
            'addresses': decoded_rows(
                'SELECT network,body FROM wallet_addresses WHERE user_id=? LIMIT 50',
                (user_id,),
            ),
            'events': decoded_rows(
                'SELECT event_id,asset,amount,type,created_at,detail FROM wallet_events '
                'WHERE user_id=? ORDER BY rowid DESC LIMIT 50', (user_id,),
            ),
            'notifications': decoded_rows(
                'SELECT notification_id,event_type,title,status,attempts,last_error,created_at,sent_at '
                'FROM notification_outbox WHERE user_id=? ORDER BY rowid DESC LIMIT 50', (user_id,),
            ),
            'audit': decoded_rows(
                'SELECT audit_id,admin_id,action,outcome,detail,created_at '
                'FROM admin_action_audit WHERE target_user_id=? ORDER BY rowid DESC LIMIT 50',
                (user_id,),
            ),
            'referrals': {
                'invited': decoded_rows(
                    'SELECT referred_user_id,source,created_at FROM wallet_referrals '
                    'WHERE referrer_user_id=? ORDER BY rowid DESC LIMIT 100', (user_id,),
                ),
                'referred_by': next((dict(row) for row in ledger.db.execute(
                    'SELECT referrer_user_id,source,created_at FROM wallet_referrals '
                    'WHERE referred_user_id=? LIMIT 1', (user_id,),
                )), None),
            },
        }

    def validate_managed_exchange(source, destination, expected_provider=None):
        if not exchange_orders.enabled or source not in WALLET_ASSET_NETWORKS['USDT'] or destination not in WALLET_ASSET_NETWORKS['USDT']:
            raise ApiError('EXCHANGE_UNAVAILABLE', 'Заявки для этого маршрута недоступны', 409)
        pair = {'from_asset': 'USDT', 'to_asset': 'USDT', 'from_network': source, 'to_network': destination}
        selected = deposit_provider('USDT', destination)
        envs = {deposit_provider('USDT', source), selected}
        if resolve_exchange_route(ledger, pair, asset_enabled, deposit_provider)['method'] != 'fixedfloat':
            raise ApiError('EXCHANGE_UNAVAILABLE', 'Маршрут FixedFloat отключён', 409)
        if selected not in {'goswap', 'aura'} or (selected == 'goswap' and (not token or destination == 'TRON')):
            raise ApiError('EXCHANGE_UNAVAILABLE', 'Адрес зачисления недоступен', 409)
        if 'aura' in envs and (not aura_enabled or not aura_client.configured or aura_environment != 'live'):
            raise ApiError('EXCHANGE_UNAVAILABLE', 'Для обмена через Aura нужна основная сеть TRON', 409)
        if expected_provider is not None and selected != expected_provider:
            raise ApiError('EXCHANGE_UNAVAILABLE', 'Провайдер зачисления изменился. Создайте новую заявку', 409)
        return selected

    exchange_orders.validate_managed_route = validate_managed_exchange

    async def aura_withdrawal_response(request, uid, actor=None):
        require_asset_enabled('USDT', 'TRON')
        if deposit_provider('USDT', 'TRON') != 'aura' or not aura_enabled or not aura_client.configured:
            raise ApiError('NOT_CONFIGURED', 'Вывод через Aura недоступен', 503)
        fee = money(os.environ.get('AURA_WITHDRAWAL_FEE_USDT', '2'), positive=False)
        if fee < 0:
            raise ApiError('NOT_CONFIGURED', 'Комиссия Aura не настроена', 503)
        if request.method == 'POST':
            return web.json_response(await aura_user_withdrawal(
                ledger, aura_client, aura_environment, uid, await request.json(),
                request.headers.get('Idempotency-Key', ''), fee, actor=actor, audit=record_admin_action,
            ))
        position = ledger.db.execute(
            "SELECT available FROM wallet_provider_positions WHERE provider='aura' "
            "AND environment=? AND user_id=? AND asset='USDT'", (aura_environment, uid),
        ).fetchone()
        pending = ledger.db.execute(
            "SELECT request_body FROM wallet_provider_entities WHERE provider='aura' "
            "AND environment=? AND entity_type='withdrawal' AND user_id=? "
            "AND remote_id IS NULL AND status='reserved' AND json_extract(request_body,'$.operator') IS ? LIMIT 1",
            (aura_environment, uid, actor),
        ).fetchone()
        withdrawal_id = request.query.get('withdrawal_id')
        latest = ledger.db.execute(
            "SELECT w.withdrawal_id,w.status,w.amount,w.fee,w.recipient,w.transaction_hash "
            "FROM wallet_provider_entities e JOIN aura_withdrawals w "
            "ON w.withdrawal_id=e.remote_id AND w.environment=e.environment "
            "WHERE e.provider='aura' AND e.entity_type='withdrawal' AND e.environment=? "
            "AND e.user_id=? AND json_extract(e.request_body,'$.operator') IS ? "
            "AND (? IS NULL OR w.withdrawal_id=?) ORDER BY e.created_at DESC LIMIT 1",
            (aura_environment, uid, actor, withdrawal_id, withdrawal_id),
        ).fetchone()
        if withdrawal_id is not None and latest is None:
            raise ApiError('WITHDRAWAL_NOT_FOUND', 'Вывод не найден', 404)
        available, _ = ledger.balance(uid, 'USDT')
        response = web.json_response({
            'available': str(min(available, Decimal(position[0])) if position else 0),
            'fee': str(fee), 'environment': aura_environment,
            'frozen': aura_withdrawal_frozen(ledger, aura_environment, uid),
            'withdrawal': dict(latest) if latest else None,
            'pending': json.loads(pending[0]) if pending else None,
        })
        response.headers['Cache-Control'] = 'no-store'
        return response

    async def admin_user_action(request, admin_id):
        body = await request.json()
        if not isinstance(body, dict) or set(body) - {'user_id', 'operation', 'text', 'confirm'}:
            raise ValueError('Некорректная команда оператора')
        user_id = str(body.get('user_id') or '')
        operation = str(body.get('operation') or '')
        if not user_id.startswith('tg:') or not user_id[3:].isdigit():
            raise ValueError('Некорректный идентификатор пользователя')
        account = ledger.db.execute(
            'SELECT client_ref,telegram_id FROM wallet_accounts WHERE user_id=?', (user_id,),
        ).fetchone()
        if not account:
            raise ApiError('NOT_FOUND', 'Пользователь не найден', 404)
        action_name = 'user.' + operation
        try:
            if operation == 'refresh_kyc':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                customer = ledger.db.execute(
                    'SELECT customer_id FROM aura_customers WHERE user_id=? AND environment=?',
                    (user_id, aura_environment),
                ).fetchone()
                if not customer:
                    raise ApiError('NOT_FOUND', 'У пользователя ещё нет клиента Aura', 404)
                result = await aura_service.get_kyc(user_id, account['client_ref'])
                record_admin_action(
                    admin_id, action_name, user_id, detail={'status': result.get('status')},
                )
                return {'ok': True, 'operation': operation, 'result': result}
            if operation == 'retry_notifications':
                cursor = ledger.db.execute(
                    "UPDATE notification_outbox SET status='queued',next_attempt_at=0,"
                    "last_error=NULL,updated_at=? WHERE user_id=? AND status IN ('failed','retry','skipped')",
                    (time.time(), user_id),
                )
                record_admin_action(
                    admin_id, action_name, user_id, detail={'queued': cursor.rowcount},
                )
                return {'ok': True, 'operation': operation, 'queued': cursor.rowcount}
            if operation == 'send_message':
                message_text = str(body.get('text') or '').strip()
                if not 1 <= len(message_text) <= 4096:
                    raise ValueError('Текст сообщения должен быть от 1 до 4096 символов')
                if body.get('confirm') != 'send_message':
                    raise ApiError('CONFIRMATION_REQUIRED', 'Подтвердите отправку сообщения', 409)
                await telegram_api('sendMessage', {
                    'chat_id': account['telegram_id'] or int(user_id.removeprefix('tg:')),
                    'text': message_text,
                })
                ledger.bot_delivery(user_id, True)
                record_admin_action(
                    admin_id, action_name, user_id, detail={'characters': len(message_text)},
                )
                return {'ok': True, 'operation': operation, 'sent': True}
            raise ValueError('Неизвестная команда оператора')
        except (ApiError, ValueError) as error:
            record_admin_action(
                admin_id, action_name, user_id, outcome='failed',
                detail={'error': getattr(error, 'name', 'INVALID_REQUEST')},
            )
            raise

    def admin_cards(request):
        query = str(request.query.get('q') or '').strip()[:200]
        selected_card_id = str(request.query.get('card_id') or '').strip()
        clauses, params = ['c.environment=?'], [aura_environment]
        if selected_card_id:
            clauses.append('c.card_id=?')
            params.append(selected_card_id)
        elif query:
            pattern = '%' + query + '%'
            clauses.append(
                '(c.card_id LIKE ? OR c.masked_pan LIKE ? OR c.user_id LIKE ? '
                'OR c.customer_id LIKE ? OR a.telegram_username LIKE ?)'
            )
            params.extend([pattern] * 5)
        rows = decoded_rows(
            'SELECT c.card_id,c.user_id,c.customer_id,c.environment,c.kind,c.plan_id,c.status,'
            'c.frozen,c.masked_pan,c.delivery_status,c.tracking,c.provider_updated_at,'
            'c.created_at,c.updated_at,a.telegram_id,a.telegram_username,a.first_name,a.last_name,'
            '(SELECT COUNT(*) FROM aura_card_operations o WHERE o.card_id=c.card_id) operation_count '
            'FROM aura_cards c LEFT JOIN wallet_accounts a ON a.user_id=c.user_id WHERE ' +
            ' AND '.join(clauses) + ' ORDER BY c.updated_at DESC LIMIT 500', params,
        )
        for row in rows:
            body = ledger.db.execute(
                'SELECT body FROM aura_cards WHERE card_id=?', (row['card_id'],),
            ).fetchone()
            try:
                state = json.loads(body['body']) if body else {}
            except (TypeError, ValueError, json.JSONDecodeError):
                state = {}
            balance = state.get('balance') if isinstance(state, dict) else None
            row['balance'] = str(balance) if balance is not None else None
            row['currency'] = 'USDT' if balance is not None else None
            row['frozen'] = bool(row['frozen'])
        operations = []
        if selected_card_id:
            operations = decoded_rows(
                'SELECT operation_id,card_id,user_id,operation_type,status,asset,amount,fee,'
                'merchant,original_amount,original_currency,refunded_amount,balance_before,'
                'balance_after,merchant_country,mcc,merchant_category,decline_reason,'
                'decline_message,provider_created_at,provider_updated_at,created_at '
                'FROM aura_card_operations WHERE card_id=? AND environment=? '
                'ORDER BY rowid DESC LIMIT 100', (selected_card_id, aura_environment),
            )
        return {'items': rows, 'operations': operations, 'total': len(rows)}

    def store_admin_card_control(card, result):
        if result['owner_id'] != card['customer_id']:
            raise ValueError('Aura card owner mismatch')
        ledger.db.execute(
            'UPDATE aura_cards SET frozen=?,status=?,masked_pan=COALESCE(?,masked_pan),'
            'delivery_status=COALESCE(?,delivery_status),provider_updated_at=?,body=?,updated_at=? '
            'WHERE card_id=? AND user_id=? AND environment=?',
            (
                int(result['frozen']), result['status'], result.get('card_number_masked'),
                result.get('delivery_status'), now(),
                json.dumps(result, separators=(',', ':'), ensure_ascii=False), time.time(),
                card['card_id'], card['user_id'], aura_environment,
            ),
        )

    def normalize_admin_card_snapshot(card, payload):
        if not isinstance(payload, dict):
            raise ValueError('Invalid Aura card response')
        card_id = str(payload.get('card_id') or payload.get('id') or '')
        owner_id = str(payload.get('owner_id') or payload.get('customer_id') or '')
        status = str(payload.get('status') or '')
        kind = str(payload.get('kind') or card.get('kind') or '')
        frozen = payload.get('frozen')
        masked = payload.get('card_number_masked') or payload.get('masked_pan') or ''
        if (
            card_id != card['card_id'] or owner_id != card['customer_id']
            or not re.fullmatch(r'[a-zA-Z0-9_.:-]{1,100}', status)
            or kind not in {'virtual', 'physical'} or not isinstance(frozen, bool)
            or not isinstance(masked, str) or len(masked) > 64
        ):
            raise ValueError('Invalid Aura card response')
        balance = payload.get('balance')
        if balance is not None:
            balance = str(money(balance, positive=False))
            if Decimal(balance) < 0 or payload.get('currency', 'USDT') != 'USDT':
                raise ValueError('Invalid Aura card balance')
        return {
            'balance': balance, 'card_id': card_id, 'card_number_masked': masked,
            'currency': 'USDT', 'frozen': frozen, 'owner_id': owner_id,
            'status': status, 'kind': kind,
            'delivery_status': payload.get('delivery_status'),
        }

    async def admin_card_action(request, admin_id):
        body = await request.json()
        if not isinstance(body, dict) or set(body) - {'card_id', 'operation', 'confirm'}:
            raise ValueError('Некорректная команда по карте')
        if not aura_enabled or not aura_client.configured:
            raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
        card_id = str(body.get('card_id') or '')
        operation = str(body.get('operation') or '')
        card = ledger.db.execute(
            'SELECT card_id,user_id,customer_id,status,frozen FROM aura_cards '
            'WHERE card_id=? AND environment=?', (card_id, aura_environment),
        ).fetchone()
        if not card:
            raise ApiError('CARD_NOT_FOUND', 'Карта не найдена', 404)
        action_name = 'card.' + operation
        try:
            if operation == 'refresh':
                result = normalize_admin_card_snapshot(
                    dict(card), await aura_client.get_card(card_id)
                )
                store_admin_card_control(card, result)
            elif operation in {'freeze', 'unfreeze', 'cancel'}:
                if body.get('confirm') != f'{operation}:{card_id}':
                    raise ApiError('CONFIRMATION_REQUIRED', 'Подтвердите действие с картой', 409)
                if operation == 'freeze':
                    result = await aura_client.freeze_card(card_id)
                    store_admin_card_control(card, result)
                elif operation == 'unfreeze':
                    result = await aura_client.unfreeze_card(card_id)
                    store_admin_card_control(card, result)
                else:
                    result = await aura_client.cancel_card(card_id)
                    status = str(result.get('status') or 'cancelled')
                    if status not in {'cancelled', 'closed'}:
                        raise ValueError('Unexpected Aura card cancellation status')
                    ledger.db.execute(
                        'UPDATE aura_cards SET status=?,provider_updated_at=?,updated_at=? '
                        'WHERE card_id=? AND user_id=? AND environment=?',
                        (status, now(), time.time(), card_id, card['user_id'], aura_environment),
                    )
            else:
                raise ValueError('Неизвестная команда по карте')
            record_admin_action(
                admin_id, action_name, card['user_id'],
                detail={'card_id': card_id, 'status': result.get('status'), 'operation': operation},
            )
            return {'ok': True, 'operation': operation, 'card_id': card_id, 'result': result}
        except (ApiError, ValueError) as error:
            record_admin_action(
                admin_id, action_name, card['user_id'], outcome='failed',
                detail={'card_id': card_id, 'error': getattr(error, 'name', 'INVALID_REQUEST')},
            )
            raise

    def admin_problems():
        present = tables()
        issues = []
        def count_issue(kind, label, sql, params=()):
            count = int(ledger.db.execute(sql, params).fetchone()[0])
            issues.append({'kind': kind, 'label': label, 'count': count})
        cutoff_15m = time.time() - 900
        cutoff_1h = time.time() - 3600
        cutoff_24h = time.time() - 86400
        if 'wallet_webhook_inbox' in present:
            count_issue(
                'webhooks', 'Вебхуки с ошибкой',
                'SELECT COUNT(*) FROM wallet_webhook_inbox WHERE signature_valid=1 AND '
                '(error IS NOT NULL OR (processed_at IS NULL AND received_at<?))',
                (cutoff_15m,),
            )
        if 'notification_outbox' in present:
            count_issue(
                'notifications', 'Ошибки уведомлений',
                "SELECT COUNT(*) FROM notification_outbox WHERE status IN ('failed','retry')",
            )
        if 'aura_kyc_cases' in present:
            count_issue(
                'kyc', 'KYC дольше 24 часов',
                "SELECT COUNT(*) FROM aura_kyc_cases WHERE status IN ('pending','in_review') AND updated_at<?",
                (cutoff_24h,),
            )
        if 'aura_sbp_orders' in present:
            count_issue(
                'sbp', 'Зависшие SBP-заявки',
                "SELECT COUNT(*) FROM aura_sbp_orders WHERE status IN ('pending','processing','awaiting_payment') AND updated_at<?",
                (cutoff_1h,),
            )
        if 'aura_qr_payments' in present:
            count_issue(
                'qr', 'Зависшие QR-платежи',
                "SELECT COUNT(*) FROM aura_qr_payments WHERE status IN ('pending','processing','created') AND updated_at<?",
                (cutoff_1h,),
            )
        if 'aura_withdrawals' in present:
            count_issue(
                'withdrawals', 'Зависшие выводы Aura',
                "SELECT COUNT(*) FROM aura_withdrawals WHERE status IN ('pending','processing','created') AND updated_at<?",
                (cutoff_1h,),
            )
        if 'wallet_debts' in present:
            count_issue(
                'debts', 'Долги пользователей',
                'SELECT COUNT(*) FROM wallet_debts WHERE CAST(amount AS REAL)>0',
            )
        if 'wallet_provider_reconciliation' in present:
            count_issue(
                'reconciliation', 'Дефицит обеспечения',
                "SELECT COUNT(*) FROM wallet_provider_reconciliation WHERE LOWER(state) IN ('deficit','error','failed')",
            )
        return {'total': sum(item['count'] for item in issues), 'items': issues}

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
        return {
            'addresses': addresses, 'deposits': deposits, 'balances': balances,
            'asset_routes': asset_route_rows(),
            'exchange_rules': exchange_rules(ledger),
        }

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

    async def admin_goswap_action(request, admin_id):
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
        record_admin_action(
            admin_id, 'goswap.' + method,
            detail={'method': method, 'post': bool(spec['post']), 'parameter_names': sorted(params)},
        )
        return {'ok': True, 'method': method, 'result': result}

    def admin_aura_console():
        return {
            'environment': aura_environment,
            'configured': aura_client.configured,
            'methods': [
                {'method': method, **{
                    key: value for key, value in spec.items()
                    if key not in {'path_params', 'query_params'}
                }}
                for method, spec in ADMIN_AURA_METHODS.items()
            ],
        }

    async def admin_aura_action(request, admin_id):
        if not aura_enabled or not aura_client.configured:
            raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
        payload = await request.json()
        if not isinstance(payload, dict) or set(payload) - {
            'method', 'params', 'confirm', 'idempotency_key'
        }:
            raise ValueError('Invalid Aura console request')
        method = str(payload.get('method') or '')
        spec = ADMIN_AURA_METHODS.get(method)
        if not spec:
            raise ApiError('METHOD_NOT_ALLOWED', 'Метод отсутствует в разрешённом списке Aura', 400)
        if spec['blocked_reason']:
            raise ApiError('SENSITIVE_METHOD_BLOCKED', spec['blocked_reason'], 403)
        params = payload.get('params') or {}
        if not isinstance(params, dict):
            raise ValueError('Параметры должны быть JSON-объектом')
        unknown = sorted(set(params) - set(spec['params']))
        if unknown:
            raise ApiError('INVALID_PARAMS', 'Недопустимые параметры: ' + ', '.join(unknown), 400)
        params = {key: value for key, value in params.items() if value is not None and value != ''}
        missing = [key for key in spec['required'] if key not in params]
        if missing:
            raise ApiError('MISSING_PARAMS', 'Обязательные параметры: ' + ', '.join(missing), 400)
        try:
            encoded_size = len(json.dumps(params, ensure_ascii=False).encode())
        except (TypeError, ValueError):
            raise ApiError('INVALID_PARAMS', 'Параметры должны быть корректным JSON', 400)
        if encoded_size > 32768:
            raise ApiError('INVALID_PARAMS', 'Слишком большой запрос', 413)
        if spec['dangerous'] and payload.get('confirm') != method:
            raise ApiError('CONFIRMATION_REQUIRED', f'Подтвердите вызов {method}', 409)
        idempotency_key = None
        if spec['idempotent']:
            idempotency_key = str(payload.get('idempotency_key') or '')
            if not 1 <= len(idempotency_key) <= 200:
                raise ApiError('idempotency_key_required', 'Idempotency-Key is required', 400)
        path = spec['path']
        for key in spec['path_params']:
            value = params.pop(key)
            if isinstance(value, (dict, list)):
                raise ApiError('INVALID_PARAMS', f'{key} должен быть строкой', 400)
            path = path.replace('{' + key + '}', quote(str(value), safe=''))
        query = {}
        for key in spec['query_params']:
            if key in params:
                query[key] = params.pop(key)
        body = params if spec['verb'] == 'POST' and params else None
        result = await aura_client.diagnostic_request(
            spec['verb'], path, params=query or None, body=body,
            idempotency_key=idempotency_key,
        )
        record_admin_action(
            admin_id, 'aura.' + method,
            detail={'method': method, 'verb': spec['verb'], 'path': path},
        )
        safe_body = body
        if isinstance(body, dict):
            safe_body = dict(body)
            for key in ('quote_token', 'qr_payload', 'pin', 'activation_code'):
                if key in safe_body:
                    safe_body[key] = '[REDACTED]'
        return {
            'ok': 200 <= result['http_status'] < 300,
            'method': method,
            'request': {
                'verb': spec['verb'], 'path': path,
                'query': query, 'body': safe_body,
                'idempotency_key': idempotency_key,
            },
            'response': result,
        }

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
        record_admin_action(
            uid, 'broadcast.create',
            detail={'broadcast_id': broadcast_id, 'target': target, 'total': len(targets), 'characters': len(text), 'has_button': bool(button_text)},
        )
        task = asyncio.create_task(run_broadcast(broadcast_id, targets, text, button_text, button_url))
        app['wpay_broadcast_tasks'].add(task)
        task.add_done_callback(app['wpay_broadcast_tasks'].discard)
        return {'broadcast_id': broadcast_id, 'status': 'queued', 'total': len(targets)}

    async def admin_notifications(request, uid):
        if request.method == 'GET':
            return notification_snapshot(ledger)
        body = await request.json()
        operation = str(body.get('operation') or '')
        if operation == 'settings':
            values = body.get('settings')
            if not isinstance(values, dict):
                raise ValueError('Некорректные настройки уведомлений')
            known = {row[0] for row in ledger.db.execute('SELECT event_type FROM notification_settings')}
            if set(values) - known or any(type(value) is not bool for value in values.values()):
                raise ValueError('Некорректные настройки уведомлений')
            stamp = time.time()
            ledger.db.executemany(
                'UPDATE notification_settings SET enabled=?,updated_at=?,updated_by=? WHERE event_type=?',
                [(int(value), stamp, uid, key) for key, value in values.items()],
            )
        elif operation == 'template':
            if 'template' not in body:
                raise ValueError('Шаблон уведомления не передан')
            save_notification_template(ledger, str(body.get('event_type') or ''), body['template'], uid)
        elif operation == 'retry':
            notification_id = str(body.get('notification_id') or '')
            cursor = ledger.db.execute(
                "UPDATE notification_outbox SET status='queued',next_attempt_at=0,last_error=NULL,updated_at=? "
                "WHERE notification_id=? AND status IN ('failed','retry','skipped')",
                (time.time(), notification_id),
            )
            if cursor.rowcount != 1:
                raise ApiError('NOT_FOUND', 'Уведомление не найдено или уже доставлено', 404)
        elif operation == 'retry_failed':
            ledger.db.execute(
                "UPDATE notification_outbox SET status='queued',next_attempt_at=0,last_error=NULL,updated_at=? "
                "WHERE status IN ('failed','retry')", (time.time(),)
            )
        else:
            raise ValueError('Неизвестная операция центра уведомлений')
        record_admin_action(
            uid, 'notifications.' + operation,
            detail={
                'notification_id': str(body.get('notification_id') or '') or None,
                'event_type': body.get('event_type') if operation == 'template' else None,
                'setting_names': sorted((body.get('settings') or {}).keys()),
            },
        )
        return notification_snapshot(ledger)

    async def sync_payments(uid):
        rows = ledger.db.execute("SELECT spend_id FROM wallet_quotes WHERE user_id=? AND state IN ('reserved','processing') LIMIT 100", (uid,)).fetchall()
        if rows:
            data = await provider.call('getQrPayments', {'spend_ids': ','.join(r[0] for r in rows)})
            for payment in data.get('items', []):
                if payment.get('spend_id') in {r[0] for r in rows}:
                    ledger.payment(payment)

    rapira_quote = None
    rapira_checked = 0.0
    rapira_lock = asyncio.Lock()

    async def get_rapira_quote():
        nonlocal rapira_quote, rapira_checked
        async with rapira_lock:
            if not rapira_checked or time.monotonic() - rapira_checked >= 60:
                rapira_checked = time.monotonic()
                try:
                    async with ClientSession(timeout=ClientTimeout(total=6)) as session:
                        async with session.get('https://api.rapira.net/open/market/rates') as response:
                            if response.status != 200:
                                raise ValueError('Unexpected Rapira status')
                            payload = await response.json(content_type=None)
                    pair = next(item for item in payload['data'] if item['symbol'] == 'USDT/RUB')
                    values = {key: Decimal(str(pair[key])) for key in ('close', 'low', 'high')}
                    if not all(value.is_finite() and value > 0 for value in values.values()):
                        raise ValueError('Invalid Rapira prices')
                    if not values['low'] <= values['close'] <= values['high']:
                        raise ValueError('Invalid Rapira range')
                    rapira_quote = {key: str(value) for key, value in values.items()}
                except (OSError, ValueError, TypeError, KeyError, StopIteration, ArithmeticError, asyncio.TimeoutError):
                    rapira_quote = None
        if rapira_quote is None:
            raise ApiError('RAPIRA_UNAVAILABLE', 'Курс Rapira недоступен', 503)
        return web.json_response(rapira_quote)

    market_snapshots = {}
    market_locks = {name: asyncio.Lock() for name in ('rapira-depth', 'cbr-usd')}

    async def get_public_market_snapshot(name):
        ttl = 10 if name == 'rapira-depth' else 300
        async with market_locks[name]:
            checked, data = market_snapshots.get(name, (float('-inf'), None))
            if time.monotonic() - checked >= ttl:
                try:
                    async with ClientSession(timeout=ClientTimeout(total=6)) as session:
                        if name == 'rapira-depth':
                            form = FormData()
                            form.add_field('symbol', 'USDT/RUB', content_type='text/plain')
                            async with session.post(
                                'https://api.rapira.net/market/exchange-plate-mini', data=form,
                            ) as response:
                                response.raise_for_status()
                                payload = await response.json(content_type=None)
                            data = {}
                            for side in ('ask', 'bid'):
                                book = payload[side]
                                if book['symbol'] != 'USDT/RUB':
                                    raise ValueError('Unexpected market pair')
                                levels = [
                                    (Decimal(str(item['price'])), Decimal(str(item['amount'])))
                                    for item in book['items']
                                ]
                                if any(not v.is_finite() or v <= 0 for level in levels for v in level):
                                    raise ValueError('Invalid order book level')
                                levels.sort(key=lambda level: level[0], reverse=side == 'bid')
                                data[side] = [
                                    {'price': str(price), 'amount': str(amount)}
                                    for price, amount in levels[:5]
                                ]
                        else:
                            async with session.get('https://www.cbr.ru/scripts/XML_daily.asp') as response:
                                response.raise_for_status()
                                document = ElementTree.fromstring(await response.read())
                            usd = next(row for row in document if row.findtext('CharCode') == 'USD')
                            rate = Decimal(usd.findtext('Value').replace(',', '.')) / int(usd.findtext('Nominal'))
                            if not rate.is_finite() or rate <= 0:
                                raise ValueError('Invalid CBR rate')
                            data = {'rate': str(rate), 'date': document.attrib['Date']}
                except (ClientError, OSError, asyncio.TimeoutError, ValueError, TypeError,
                        KeyError, AttributeError, StopIteration, ArithmeticError, ElementTree.ParseError):
                    data = None
                market_snapshots[name] = (time.monotonic(), data)
        if data is None:
            raise ApiError('MARKET_UNAVAILABLE', 'Рыночные данные недоступны', 503)
        return web.json_response(data)

    async def route(request):
        try:
            action = request.match_info['action']
            if action in market_locks and request.method == 'GET':
                return await get_public_market_snapshot(action)
            if action == 'rapira-quote' and request.method == 'GET':
                return await get_rapira_quote()
            if action == 'status' and request.method == 'GET':
                aura_products = {
                    'cards': False, 'sbp_buy': False,
                    'crypto_processing': False, 'qr_pay': False,
                }
                aura_available = bool(aura_enabled and aura_client.configured)
                if aura_available:
                    try:
                        me = await aura_client.get_me()
                        advertised = me.get('products', {})
                        aura_products = {
                            key: advertised.get(key) is True for key in aura_products
                        }
                    except (ApiError, asyncio.TimeoutError, OSError, ValueError):
                        aura_available = False
                qr_provider = (
                    'aura' if aura_available and aura_products['qr_pay']
                    else 'goswap' if bool(token) else None
                )
                deposit_modes, deposit_providers = {}, {}
                for row in asset_route_rows():
                    asset, network, selected = row['asset'], row['network'], row['provider']
                    available = row['enabled'] and selected in row['providers'] and (
                        (selected == 'aura' and aura_available and aura_products['crypto_processing'])
                        or (selected == 'goswap' and bool(token))
                        or (selected == 'wpay' and custody.configured and custody.chain_env == 'mainnet')
                    )
                    exact = selected == 'goswap' and network == 'TRON'
                    deposit_modes.setdefault(asset, {})[network] = (
                        ('exact' if exact else 'address') if available else 'disabled'
                    )
                    deposit_providers.setdefault(asset, {})[network] = selected
                return web.json_response({
                    'configured': bool(token) or bool(aura_enabled and aura_client.configured)
                    or (custody.configured and custody.chain_env == 'mainnet'),
                    'telegram_auth': bool(bot_token),
                    'asset_routes': enabled_asset_routes(),
                    'deposit_modes': deposit_modes,
                    'deposit_providers': deposit_providers,
                    'capabilities': {
                        'cards': aura_available and aura_products['cards'],
                        'sbp_buy': aura_available and aura_products['sbp_buy'],
                        'crypto_processing': (
                            aura_available and aura_products['crypto_processing']
                        ),
                        'qr_pay': bool(qr_provider),
                    },
                    'routes': {'qr_pay': qr_provider},
                    'providers': {
                        'goswap': {'configured': bool(token)},
                        'aura': {'enabled': aura_enabled, 'configured': aura_client.configured,
                                 'available': aura_available,
                                 'environment': aura_environment,
                                 'products': aura_products},
                    },
                })
            if action == 'webhook' and request.method == 'POST':
                return await receive_webhook(request,ledger,provider,token,money,ApiError)
            if action == 'aura-webhook' and request.method == 'POST':
                if not aura_enabled or not aura_secret:
                    raise ApiError('NOT_CONFIGURED', 'Aura webhook is not configured', 503)
                return await receive_aura_webhook(
                    request, ledger, aura_secret, ApiError, aura_partner_id
                )
            uid = identity(request)
            admin = is_admin(uid)
            client_ref = ledger.account(
                uid,
                request.get('wpay_profile'),
                source='miniapp',
                start_param=request.get('wpay_start_param'),
            )
            if action == 'exchange-internal' and request.method == 'POST':
                return web.json_response(internal_exchange(
                    ledger, uid, await request.json(), request.headers.get('Idempotency-Key', ''),
                    asset_enabled, deposit_provider, ApiError,
                ), headers={'Cache-Control': 'no-store'})
            if action == 'exchange-btc-quote' and request.method == 'POST':
                body = await request.json()
                if not isinstance(body, dict) or set(body) != {'from_network', 'to_network', 'amount', 'rate_type'}:
                    raise ValueError('Укажите сети и сумму BTC')
                if body.get('from_network') != 'BTC' or not isinstance(body.get('to_network'), str):
                    raise ValueError('Укажите сеть получения USDT')
                pair = {**body, 'from_asset': 'BTC', 'to_asset': 'USDT'}
                if resolve_exchange_route(ledger, pair, asset_enabled, deposit_provider)['method'] != 'fixedfloat':
                    raise ApiError('EXCHANGE_UNAVAILABLE', 'Обмен BTC для этой пары отключён', 409)
                exchange.throttle(uid)
                return web.json_response(await exchange.quote(body, from_asset='BTC'), headers={'Cache-Control': 'no-store'})
            if action == 'exchange-dex-quote' and request.method == 'POST':
                body = await request.json()
                if not isinstance(body, dict) or set(body) != set(DEX_PAIR) | {'amount'}:
                    raise ValueError('Укажите пару и сумму DEX')
                if any(body[key] != value for key, value in DEX_PAIR.items()) or resolve_exchange_route(
                    ledger, body, asset_enabled, deposit_provider,
                )['method'] != 'dex':
                    raise ApiError('EXCHANGE_UNAVAILABLE', 'Котировка DEX для этой пары недоступна', 409)
                exchange.throttle(uid)
                quote = await quote_bnb(app['wpay_chain'], body['amount'])
                if quote is None:
                    raise ApiError('DEX_UNAVAILABLE', 'PancakeSwap пока не вернул котировку', 503)
                return web.json_response(quote, headers={'Cache-Control': 'no-store'})
            if action == 'exchange-route' and request.method == 'GET':
                route = resolve_exchange_route(ledger, request.query, asset_enabled, deposit_provider)
                route['managed_order_enabled'] = False
                if route['method'] == 'fixedfloat' and request.query.get('from_asset') == request.query.get('to_asset') == 'USDT':
                    try:
                        route['payout_provider'] = validate_managed_exchange(
                            request.query.get('from_network'), request.query.get('to_network'),
                        )
                        route['managed_order_enabled'] = True
                    except ApiError:
                        pass
                return web.json_response(route, headers={'Cache-Control': 'no-store'})
            if action == 'exchange-managed-prepare' and request.method == 'POST':
                body = await request.json()
                if not isinstance(body, dict) or set(body) != {'from_network', 'to_network', 'amount', 'rate_type'} or any(not isinstance(value, str) for value in body.values()):
                    raise ValueError('Укажите сети и сумму обмена')
                if body['rate_type'] != 'fixed':
                    raise ValueError('Для зачисления на баланс используйте фиксированный курс')
                source, destination = body['from_network'], body['to_network']
                selected = validate_managed_exchange(source, destination)
                exchange.throttle(uid)
                if selected == 'goswap':
                    address = await provider.call('getClientAddress', {'client_ref': client_ref, 'network': destination}, post=True)
                    if address.get('network') != destination or address.get('client_ref') != client_ref:
                        raise ApiError('EXCHANGE_UNAVAILABLE', 'GoSwap не подтвердил реквизиты пользователя', 502)
                    save_address(ledger, uid, address, 'USDT')
                else:
                    if not await aura_client.product_enabled('crypto_processing'):
                        raise ApiError('EXCHANGE_UNAVAILABLE', 'Зачисления Aura отключены', 409)
                    address = await aura_service.get_or_create_deposit_address(uid, client_ref)
                    if address.get('chain') != 'mainnet':
                        raise ApiError('EXCHANGE_UNAVAILABLE', 'Aura не вернула адрес основной сети', 502)
                validate_managed_exchange(source, destination, selected)
                result = await exchange_orders.prepare(
                    uid, {**body, 'to_address': address['address']}, managed_provider=selected,
                    min_deposit=address.get('min_deposit'),
                )
                return web.json_response(result, headers={'Cache-Control': 'no-store'})
            if action == 'aura-user-withdrawal' and request.method in {'GET', 'POST'}:
                return await aura_withdrawal_response(request, uid)
            if action == 'addresses' and request.method == 'GET':
                items = [
                    {**json.loads(row['body']), 'provider': 'goswap'}
                    for row in ledger.db.execute(
                        'SELECT body FROM wallet_addresses WHERE user_id=? ORDER BY network', (uid,),
                    )
                ]
                balances = goswap_network_balances(ledger, uid, 'USDT')
                if items:
                    for item in items:
                        if 'USDT' in item.get('assets', [item.get('asset')]):
                            item['provider_available'] = str(balances.get(item['network'], 0))
                            item['balance_asset'] = 'USDT'
                if aura_enabled and aura_client.configured:
                    row = ledger.db.execute(
                        'SELECT address,network FROM aura_deposit_addresses WHERE user_id=? '
                        'AND environment=? ORDER BY is_default DESC, created_at ASC, address_id LIMIT 1',
                        (uid, aura_environment),
                    ).fetchone()
                    if row:
                        position = ledger.db.execute(
                            "SELECT available FROM wallet_provider_positions WHERE provider='aura' "
                            "AND environment=? AND user_id=? AND asset='USDT'",
                            (aura_environment, uid),
                        ).fetchone()
                        items.append({'provider': 'aura', 'asset': 'USDT', 'network': 'TRON',
                                      'address': row['address'], 'chain': row['network'],
                                      'provider_available': position['available'] if position else '0'})
                response = web.json_response({'items': items, 'goswap_usdt_balances': {
                    network: str(value) for network, value in balances.items()
                }})
                response.headers['Cache-Control'] = 'no-store'
                return response
            export_response = await key_export_route(request, action, uid, custody)
            if export_response is not None:return export_response
            custody_response = await custody_route(request, action, uid, custody)
            if custody_response is not None:
                return custody_response
            custody_withdrawal_response = await custody_withdrawal.route(request, action, uid, require_asset_enabled)
            if custody_withdrawal_response is not None:
                return custody_withdrawal_response
            funding_response = await exchange_funding.route(request, action, uid)
            if funding_response is not None:return funding_response
            order_response = await exchange_orders.route(request, action, uid)
            if order_response is not None:
                return order_response
            exchange_response = await exchange_route(request, action, uid, exchange)
            if exchange_response is not None:
                return exchange_response
            card_response = await card_ui.route(request, action, uid, client_ref)
            if card_response is not None:
                return card_response
            if action == 'profile-avatar' and request.method == 'GET':
                if request.query:
                    raise ValueError('Avatar query parameters are not supported')
                if not uid.startswith('tg:'):
                    raise ApiError('AVATAR_NOT_FOUND', 'Фото профиля не найдено', 404)
                try:
                    image, content_type = await load_avatar(bot_token, int(uid.removeprefix('tg:')))
                except AvatarNotFound:
                    raise ApiError('AVATAR_NOT_FOUND', 'Фото профиля не найдено', 404)
                except ValueError:
                    raise ApiError('AVATAR_UNAVAILABLE', 'Фото профиля временно недоступно', 502)
                return web.Response(body=image, content_type=content_type, headers={
                    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
                    'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:",
                })
            if admin and uid.startswith('tg:'):
                ledger.db.execute("UPDATE wallet_accounts SET role='admin' WHERE user_id=?", (uid,))
            if action == 'access' and request.method == 'GET':
                return web.json_response({'owner': admin})
            if action == 'referrals' and request.method == 'GET':
                return web.json_response(referral_summary(
                    ledger, uid, os.environ.get('WPAY_BOT_USERNAME', 'Workingpaybot')
                ))
            if action.startswith('admin-') and not admin:
                raise ApiError('FORBIDDEN', 'Админка доступна только администраторам WPay', 403)
            if action == 'admin-overview' and request.method == 'GET':
                if not token:
                    raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён', 503)
                return web.json_response(await admin_overview())
            if action == 'admin-users' and request.method == 'GET':
                return web.json_response(admin_users())
            if action == 'admin-user' and request.method == 'GET':
                return web.json_response(await admin_user(request), headers={'Cache-Control': 'private, no-store'})
            if action in {'admin-custody-export-prepare', 'admin-custody-export-status', 'admin-custody-export-reveal'}:
                target = request.query.get('user_id', '')
                if not re.fullmatch(r'tg:[0-9]+', target):
                    raise ValueError('Некорректный идентификатор пользователя')
                return await key_export_route(
                    request, action.removeprefix('admin-'), target, custody,
                    actor=uid, audit=record_admin_action,
                )
            if action in {'admin-custody-withdrawal', 'admin-custody-withdrawal-prepare', 'admin-custody-withdrawal-confirm'}:
                target = request.query.get('user_id', '')
                wallet_id = request.query.get('wallet_id', '')
                if not re.fullmatch(r'tg:[0-9]+', target) or not re.fullmatch(r'[a-f0-9]{32}', wallet_id):
                    raise ValueError('Некорректный идентификатор кошелька')
                if request.method == 'POST':
                    fresh_wallet_auth(request, uid, ApiError)
                return await custody_withdrawal.route(
                    request, action.removeprefix('admin-'), target, require_asset_enabled,
                    actor=uid, wallet_id=wallet_id, audit=record_admin_action,
                )
            if action in {'admin-aura-user-withdrawal', 'admin-aura-withdrawal-freeze'}:
                target = request.query.get('user_id', '')
                env = request.query.get('environment', '')
                if not re.fullmatch(r'tg:[0-9]+', target) or env != aura_environment:
                    raise ApiError('NOT_FOUND', 'Баланс Aura в этом окружении недоступен', 404)
                if not ledger.db.execute(
                    "SELECT 1 FROM wallet_provider_positions WHERE provider='aura' AND user_id=? AND environment=? AND asset='USDT' "
                    "UNION SELECT 1 FROM aura_deposit_addresses WHERE user_id=? AND environment=? LIMIT 1",
                    (target, env, target, env),
                ).fetchone():
                    raise ApiError('NOT_FOUND', 'Кошелёк Aura не найден', 404)
                if action == 'admin-aura-user-withdrawal' and request.method in {'GET', 'POST'}:
                    if request.method == 'POST':
                        fresh_wallet_auth(request, uid, ApiError)
                    return await aura_withdrawal_response(request, target, actor=uid)
                if action == 'admin-aura-withdrawal-freeze' and request.method == 'POST':
                    body = await request.json()
                    if not isinstance(body, dict) or set(body) != {'frozen'} or type(body['frozen']) is not bool:
                        raise ValueError('Укажите статус заморозки')
                    ledger.begin('admin_aura_withdrawal_freeze', uid, target)
                    try:
                        if body['frozen']:
                            ledger.db.execute(
                                'INSERT OR REPLACE INTO aura_user_withdrawal_freezes VALUES (?,?,?)',
                                (target, env, time.time()),
                            )
                        else:
                            ledger.db.execute(
                                'DELETE FROM aura_user_withdrawal_freezes WHERE user_id=? AND environment=?',
                                (target, env),
                            )
                        record_admin_action(uid, 'wallet.aura_withdrawal_freeze', target,
                                            detail={'frozen': body['frozen'], 'environment': env})
                        ledger.commit()
                    except Exception:
                        ledger.rollback()
                        raise
                    return web.json_response({'frozen': body['frozen']})
                raise ApiError('METHOD_NOT_ALLOWED', 'Неверный метод', 405)
            if action == 'admin-wallet-control' and request.method == 'POST':
                body = await request.json()
                if not isinstance(body, dict) or set(body) != {'user_id', 'wallet_id', 'operation'}:
                    raise ValueError('Некорректная команда оператора')
                if not isinstance(body['operation'], str):
                    raise ValueError('Некорректное действие')
                return web.json_response(control_wallet(
                    ledger, body['user_id'], body['wallet_id'], body['operation'],
                    uid, record_admin_action, ApiError,
                ), headers={'Cache-Control': 'private, no-store'})
            if action == 'admin-user-action' and request.method == 'POST':
                return web.json_response(
                    await admin_user_action(request, uid),
                    headers={'Cache-Control': 'private, no-store'},
                )
            if action == 'admin-audit' and request.method == 'GET':
                return web.json_response(admin_audit(request), headers={'Cache-Control': 'private, no-store'})
            if action == 'admin-cards' and request.method == 'GET':
                return web.json_response(admin_cards(request), headers={'Cache-Control': 'private, no-store'})
            if action == 'admin-card-action' and request.method == 'POST':
                return web.json_response(
                    await admin_card_action(request, uid),
                    headers={'Cache-Control': 'private, no-store'},
                )
            if action == 'admin-tariffs' and request.method == 'GET':
                result = tariff_snapshot(ledger)
                result['provider'] = {'currency': 'USDT'}
                if aura_enabled and aura_client.configured:
                    try:
                        card_fees = await aura_client.get_card_fees()
                        result['provider']['card_fees'] = card_fees
                        provider_prices = {
                            'virtual': (card_fees.get('open_virtual_card_fee'), card_fees.get('recharge_fee_pct')),
                            'physical': (card_fees.get('open_physical_card_fee'), card_fees.get('physical_recharge_fee_pct')),
                        }
                        for item in result['items']:
                            if item.get('card_plan'):
                                item['provider_issue_fee'], item['provider_recharge_fee'] = provider_prices[item['kind']]
                                item['provider_minimum'] = card_fees.get('minimum_recharge_amount')
                    except (ApiError, ValueError, asyncio.TimeoutError, OSError) as error:
                        result['provider']['error'] = getattr(error, 'name', type(error).__name__)
                return web.json_response(result, headers={'Cache-Control': 'private, no-store'})
            if action == 'admin-tariffs' and request.method == 'POST':
                body = await request.json()
                required = {'product','enabled','fixed_fee','percent_fee','minimum_fee','note','confirm'}
                if not isinstance(body, dict) or set(body) != required:
                    raise ValueError('Invalid tariff body')
                product = str(body['product'])
                if body['confirm'] != f'TARIFF {product}':
                    raise ApiError('CONFIRMATION_REQUIRED', 'Неверная контрольная строка', 400)
                item = create_tariff_version(
                    ledger, product, enabled=body['enabled'],
                    fixed_fee=body['fixed_fee'], percent_fee=body['percent_fee'],
                    minimum_fee=body['minimum_fee'], note=body['note'], created_by=uid,
                )
                record_admin_action(uid, 'tariffs.update', detail={
                    'product': product, 'enabled': item['enabled'],
                    'fixed_fee': item['fixed_fee'], 'percent_fee': item['percent_fee'],
                    'minimum_fee': item['minimum_fee'], 'version_id': item['version_id'],
                })
                return web.json_response({'ok': True, 'tariff': item})
            if action == 'admin-sync-users' and request.method == 'POST':
                result = await sync_telegram_users()
                record_admin_action(uid, 'users.sync', detail=result)
                return web.json_response(result)
            if action == 'admin-database' and request.method == 'GET':
                return web.json_response(admin_database(request))
            if action == 'admin-payments' and request.method == 'GET':
                return web.json_response(admin_payments())
            if action == 'admin-crypto' and request.method == 'GET':
                return web.json_response(admin_crypto())
            if action == 'admin-exchange-rule' and request.method == 'POST':
                body = await request.json()
                ledger.begin('admin_exchange_rule', uid, 'Update exchange routing')
                try:
                    save_exchange_rule(ledger, body, uid)
                    record_admin_action(uid, 'exchange.rule', detail=body)
                    ledger.commit()
                except Exception:
                    ledger.rollback()
                    raise
                return web.json_response({'rules': exchange_rules(ledger)})
            if action == 'admin-assets' and request.method == 'POST':
                body = await request.json()
                if not isinstance(body, dict):
                    raise ValueError('Invalid asset settings body')
                stamp = now()
                if body == {'preset': 'usdt_trc20_only'}:
                    ledger.begin('admin_asset_routes', uid, 'Enable only USDT TRC20')
                    try:
                        ledger.db.execute(
                            'UPDATE wallet_asset_routes SET enabled=0,updated_at=?,updated_by=?',
                            (stamp, uid),
                        )
                        ledger.db.execute(
                            "UPDATE wallet_asset_routes SET enabled=1,updated_at=?,updated_by=? "
                            "WHERE asset='USDT' AND network='TRON'",
                            (stamp, uid),
                        )
                        ledger.commit()
                    except Exception:
                        ledger.rollback()
                        raise
                elif set(body) == {'asset', 'enabled'} and type(body['enabled']) is bool:
                    asset = str(body['asset']).upper()
                    if asset not in WALLET_ASSET_NETWORKS:
                        raise ApiError('INVALID_ASSET_ROUTE', 'Unsupported asset', 400)
                    ledger.db.execute(
                        'UPDATE wallet_asset_routes SET enabled=?,updated_at=?,updated_by=? WHERE asset=?',
                        (int(body['enabled']), stamp, uid, asset),
                    )
                elif set(body) == {'asset', 'network', 'provider'}:
                    asset, network, selected = str(body['asset']).upper(), str(body['network']).upper(), body['provider']
                    if network not in WALLET_ASSET_NETWORKS.get(asset, ()) or selected not in deposit_provider_options(asset, network):
                        raise ApiError('INVALID_ASSET_ROUTE', 'Unsupported deposit provider for this asset and network', 400)
                    ledger.db.execute(
                        'INSERT INTO wallet_deposit_providers VALUES (?,?,?) '
                        'ON CONFLICT(asset,network) DO UPDATE SET provider=excluded.provider',
                        (asset, network, selected),
                    )
                elif set(body) == {'asset', 'network', 'enabled'} \
                        and type(body['enabled']) is bool:
                    asset = str(body['asset']).upper()
                    network = str(body['network']).upper()
                    if network not in WALLET_ASSET_NETWORKS.get(asset, ()):
                        raise ApiError('INVALID_ASSET_ROUTE', 'Unsupported asset/network pair', 400)
                    ledger.db.execute(
                        'UPDATE wallet_asset_routes SET enabled=?,updated_at=?,updated_by=? '
                        'WHERE asset=? AND network=?',
                        (int(body['enabled']), stamp, uid, asset, network),
                    )
                else:
                    raise ApiError('INVALID_ASSET_SETTINGS', 'Unsupported asset settings operation', 400)
                record_admin_action(
                    uid, 'assets.update',
                    detail={
                        'preset': body.get('preset'), 'asset': body.get('asset'),
                        'network': body.get('network'), 'enabled': body.get('enabled'),
                        'provider': body.get('provider'),
                    },
                )
                return web.json_response({
                    'ok': True, 'asset_routes': asset_route_rows(),
                    'enabled': enabled_asset_routes(),
                })
            if action == 'admin-goswap' and request.method == 'GET':
                if not token:
                    raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён', 503)
                return web.json_response(await admin_goswap())
            if action == 'admin-goswap-action' and request.method == 'POST':
                if not token:
                    raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён', 503)
                return web.json_response(await admin_goswap_action(request, uid))
            if action == 'admin-aura-console' and request.method == 'GET':
                return web.json_response(admin_aura_console())
            if action == 'admin-aura-action' and request.method == 'POST':
                return web.json_response(await admin_aura_action(request, uid))
            if action == 'admin-providers' and request.method == 'GET':
                aura_state = {
                    'enabled': aura_enabled,
                    'configured': aura_client.configured,
                    'environment': aura_environment,
                    'health': {
                        'available': False,
                        'error': None,
                        'request_id': None,
                    },
                    'routes': [dict(row) for row in ledger.db.execute(
                        "SELECT * FROM wallet_provider_routes ORDER BY product,asset,network,environment"
                    )],
                    'reconciliation': [dict(row) for row in ledger.db.execute(
                        "SELECT * FROM wallet_provider_reconciliation ORDER BY provider,environment,asset"
                    )],
                }
                if aura_enabled and aura_client.configured:
                    try:
                        aura_state['capabilities'] = await aura_client.get_me()
                        aura_state['health']['available'] = True
                    except (ApiError, asyncio.TimeoutError, OSError, ValueError) as error:
                        aura_state['health']['error'] = getattr(
                            error, 'name', type(error).__name__
                        )
                        aura_state['health']['request_id'] = getattr(
                            error, 'request_id', None
                        )
                return web.json_response({
                    'goswap': {'enabled': bool(token), 'configured': bool(token)},
                    'aura': aura_state,
                })
            if action == 'admin-aura-process' and request.method == 'POST':
                if not aura_enabled:
                    raise ApiError('NOT_CONFIGURED', 'Aura is disabled', 503)
                count = process_aura_inbox(ledger, aura_environment)
                result = {'processed': count}
                if aura_client.configured:
                    result['reconciliation'] = await reconcile_aura(
                        ledger, aura_client, aura_environment
                    )
                return web.json_response(result)
            if action == 'admin-aura-events' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                event_types = []
                for value in request.query.getall('type', []):
                    event_types.extend(part for part in value.split(',') if part)
                result = await aura_client.list_events(
                    event_types=event_types or None,
                    created_after=request.query.get('created_after'),
                    created_before=request.query.get('created_before'),
                    cursor=request.query.get('cursor'),
                    limit=request.query.get('limit', '25'),
                )
                return web.json_response({
                    'data': [safe_aura_event_for_admin(item) for item in result['data']],
                    'next_cursor': result['next_cursor'],
                })
            if action == 'admin-aura-event' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                event_id = request.query.get('event_id')
                if not event_id:
                    raise ValueError('event_id is required')
                return web.json_response(safe_aura_event_for_admin(
                    await aura_client.get_event(event_id)
                ))
            if action == 'admin-aura-event-redeliver' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                body = await request.json()
                if not isinstance(body, dict) or set(body) != {'event_id'}:
                    raise ValueError('event_id is required')
                key = request.headers.get('Idempotency-Key', '')
                if not 1 <= len(key) <= 200:
                    raise ApiError(
                        'idempotency_key_required', 'Idempotency-Key is required', 400
                    )
                return web.json_response(safe_aura_event_for_admin(
                    await aura_client.redeliver_event(
                        str(body['event_id']), idempotency_key=key
                    )
                ))
            if action == 'admin-aura-balance-history' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                return web.json_response(await aura_client.list_balance_history(
                    operation_type=request.query.get('type'),
                    status=request.query.get('status'),
                    sort=request.query.get('sort', 'created_at'),
                    order=request.query.get('order', 'desc'),
                    date_from=request.query.get('from'),
                    date_to=request.query.get('to'),
                    cursor=request.query.get('cursor'),
                    limit=request.query.get('limit', '100'),
                ))
            if action == 'admin-aura-balance-operation' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                operation_id = request.query.get('operation_id')
                if not operation_id:
                    raise ValueError('operation_id is required')
                return web.json_response(
                    await aura_client.get_balance_operation(operation_id)
                )
            if action == 'admin-aura-withdrawal' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                body = await request.json()
                if not isinstance(body, dict) or not {'amount', 'address'}.issubset(body) \
                        or set(body) - {'amount', 'address', 'note'}:
                    raise ValueError('Invalid Aura withdrawal body')
                key = request.headers.get('Idempotency-Key', '')
                if not 1 <= len(key) <= 200:
                    raise ApiError(
                        'idempotency_key_required', 'Idempotency-Key is required', 400
                    )
                result = await aura_client.create_withdrawal(
                    body['amount'], body['address'], idempotency_key=key,
                    note=body.get('note'),
                )
                store_withdrawal_snapshot(ledger, aura_environment, result)
                return web.json_response(result)
            if action == 'admin-aura-kyc-identity' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('sbp_buy'):
                    raise ApiError('sbp_buy_not_enabled', 'Aura SBP purchase is not enabled', 403)
                body = await request.json()
                if not isinstance(body, dict) or 'customer_id' not in body:
                    raise ValueError('customer_id is required')
                customer_id = str(body['customer_id'])
                row = ledger.db.execute(
                    'SELECT user_id FROM aura_customers WHERE customer_id=? AND environment=?',
                    (customer_id, aura_environment),
                ).fetchone()
                if not row:
                    raise ApiError('CUSTOMER_NOT_FOUND', 'Customer not found', 404)
                result = await aura_service.submit_identity(
                    row['user_id'], customer_id,
                    {key: value for key, value in body.items() if key != 'customer_id'},
                )
                response = web.json_response(result)
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'admin-aura-qr-payments' and request.method == 'GET':
                return web.json_response({'data': [dict(row) for row in ledger.db.execute(
                    'SELECT payment_id,status,amount_rub,rate,total_usdt,merchant,provider_updated_at '
                    'FROM aura_qr_payments WHERE environment=? ORDER BY updated_at DESC LIMIT 200',
                    (aura_environment,),
                )]})
            if action == 'admin-aura-withdrawals' and request.method == 'GET':
                return web.json_response({'data': [dict(row) for row in ledger.db.execute(
                    'SELECT withdrawal_id,status,amount,fee,recipient,transaction_hash,provider_updated_at '
                    'FROM aura_withdrawals WHERE environment=? ORDER BY updated_at DESC LIMIT 200',
                    (aura_environment,),
                )]})
            if action == 'admin-provider-route' and request.method == 'POST':
                body = await request.json()
                allowed = {
                    ('crypto_deposit', 'USDT', 'TRON', 'test', 'aura'),
                    ('crypto_deposit', 'USDT', 'TRON', 'live', 'aura'),
                }
                key = (
                    str(body.get('product') or ''), str(body.get('asset') or '').upper(),
                    str(body.get('network') or '').upper(),
                    str(body.get('environment') or ''), str(body.get('provider') or ''),
                )
                if key not in allowed or type(body.get('enabled')) is not bool:
                    raise ApiError('INVALID_ROUTE', 'Unsupported provider route', 400)
                if key[3] == 'live' and aura_environment != 'live':
                    raise ApiError('ENVIRONMENT_MISMATCH', 'Aura live route requires live configuration', 409)
                ledger.db.execute(
                    "INSERT OR REPLACE INTO wallet_provider_routes VALUES (?,?,?,?,?,?,?)",
                    (*key, int(body['enabled']), time.time()),
                )
                return web.json_response({'ok': True, 'route': {
                    'product': key[0], 'asset': key[1], 'network': key[2],
                    'environment': key[3], 'provider': key[4], 'enabled': body['enabled'],
                }})
            if action == 'admin-broadcasts' and request.method in {'GET', 'POST'}:
                return web.json_response(await admin_broadcasts(request, uid))
            if action == 'admin-notifications' and request.method in {'GET', 'POST'}:
                return web.json_response(await admin_notifications(request, uid))
            if action == 'aura-customer' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                body = await request.json()
                allowed = {'email', 'phone'}
                if not isinstance(body, dict) or set(body) - allowed:
                    raise ValueError('Unsupported Aura customer fields')
                customer_id = await aura_service.ensure_customer(
                    uid, client_ref, email=body.get('email'), phone=body.get('phone')
                )
                return web.json_response({'customer_id': customer_id, 'registered': True})
            if action == 'aura-customer' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                row = ledger.db.execute(
                    'SELECT customer_id FROM aura_customers WHERE user_id=? AND environment=?',
                    (uid, aura_environment),
                ).fetchone()
                if not row:
                    raise ApiError('CUSTOMER_NOT_REGISTERED', 'Aura customer is not registered', 404)
                contacts = aura_service.saved_contacts(uid)
                if contacts and contacts.get('email') and contacts.get('phone'):
                    result = {'id': row['customer_id'], **contacts}
                else:
                    result = dict(await aura_client.get_customer(row['customer_id']))
                    for field in ('email', 'phone'):
                        if contacts and contacts.get(field):
                            result[field] = contacts[field]
                return web.json_response(result, headers={'Cache-Control': 'private, no-store'})
            if action == 'aura-kyc' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                return web.json_response(await aura_service.get_kyc(uid, client_ref), headers={'Cache-Control': 'no-store'})
            if action == 'aura-kyc' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('sbp_buy'):
                    raise ApiError('sbp_buy_not_enabled', 'Aura SBP purchase is not enabled', 403)
                body = await request.json()
                if not isinstance(body, dict):
                    raise ValueError('Invalid Aura KYC identity')
                row = ledger.db.execute(
                    'SELECT customer_id FROM aura_customers WHERE user_id=? AND environment=?',
                    (uid, aura_environment),
                ).fetchone()
                if not row:
                    raise ApiError(
                        'CUSTOMER_NOT_REGISTERED', 'Aura customer is not registered', 404
                    )
                response = web.json_response(await aura_service.submit_identity(
                    uid, row['customer_id'], body
                ))
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-card-fees' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                response = web.json_response(await aura_client.get_card_fees())
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-cards' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('cards'):
                    raise ApiError('cards_not_enabled', 'Aura cards are not enabled', 403)
                idempotency_key = request.headers.get('Idempotency-Key', '')
                if not 1 <= len(idempotency_key) <= 200:
                    raise ApiError('idempotency_key_required', 'Idempotency-Key is required', 400)
                body = await request.json()
                allowed = {'kind', 'shipping_address', 'plan_id'}
                if not isinstance(body, dict) or set(body) - allowed:
                    raise ValueError('Unsupported Aura card fields')
                return web.json_response(await aura_service.create_card_request(
                    uid, client_ref, kind=body.get('kind', 'virtual'),
                    idempotency_key=idempotency_key,
                    shipping_address=body.get('shipping_address'),
                    plan_id=body.get('plan_id'),
                ))
            if action == 'aura-cards' and request.method == 'GET':
                cards = [dict(row) for row in ledger.db.execute(
                    'SELECT card_id,kind,plan_id,status,frozen,masked_pan,delivery_status,provider_updated_at '
                    'FROM aura_cards WHERE user_id=? AND environment=? ORDER BY updated_at DESC',
                    (uid, aura_environment),
                )]
                for item in cards:
                    item['frozen'] = bool(item['frozen'])
                return web.json_response({'data': cards})
            if action == 'aura-card-credentials' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                card_id = str(request.query.get('card_id') or '')
                if not card_id:
                    raise ValueError('card_id is required')
                owned = ledger.db.execute(
                    'SELECT 1 FROM aura_cards WHERE card_id=? AND user_id=? AND environment=?',
                    (card_id, uid, aura_environment),
                ).fetchone()
                if not owned:
                    raise ApiError('CARD_NOT_FOUND', 'Card not found', 404)
                access_id = uuid.uuid4().hex
                ledger.db.execute(
                    'INSERT INTO aura_sensitive_access_audit '
                    '(access_id,user_id,card_id,environment,action,outcome,created_at,completed_at) '
                    'VALUES (?,?,?,?,?,?,?,NULL)',
                    (access_id, uid, card_id, aura_environment,
                     'card.credentials.reveal', 'requested', time.time()),
                )
                try:
                    credentials = await aura_client.get_card_credentials(card_id)
                except Exception:
                    ledger.db.execute(
                        'UPDATE aura_sensitive_access_audit SET outcome=?,completed_at=? '
                        'WHERE access_id=?', ('failed', time.time(), access_id),
                    )
                    raise
                ledger.db.execute(
                    'UPDATE aura_sensitive_access_audit SET outcome=?,completed_at=? '
                    'WHERE access_id=?', ('succeeded', time.time(), access_id),
                )
                response = web.json_response(credentials)
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-card-otp-latest' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                card_id = str(request.query.get('card_id') or '')
                if not card_id:
                    raise ValueError('card_id is required')
                owned = ledger.db.execute(
                    'SELECT 1 FROM aura_cards WHERE card_id=? AND user_id=? AND environment=?',
                    (card_id, uid, aura_environment),
                ).fetchone()
                if not owned:
                    raise ApiError('CARD_NOT_FOUND', 'Card not found', 404)
                otp = await aura_client.get_latest_card_otp(card_id)
                response = web.json_response(otp)
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-card-cancel' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                body = await request.json()
                if not isinstance(body, dict) or set(body) != {'card_id'}:
                    raise ValueError('card_id is required')
                card_id = str(body['card_id'])
                owned = ledger.db.execute(
                    'SELECT 1 FROM aura_cards WHERE card_id=? AND user_id=? AND environment=?',
                    (card_id, uid, aura_environment),
                ).fetchone()
                if not owned:
                    raise ApiError('CARD_NOT_FOUND', 'Card not found', 404)
                result = await aura_client.cancel_card(card_id)
                return web.json_response({'card_id': card_id, 'status': result.get('status')})
            if action in {
                'aura-card-freeze', 'aura-card-unfreeze',
                'aura-card-activate', 'aura-card-pin',
            } and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                body = await request.json()
                expected = {'card_id'}
                if action == 'aura-card-activate':
                    expected.add('activation_code')
                elif action == 'aura-card-pin':
                    expected.add('pin')
                if not isinstance(body, dict) or set(body) != expected:
                    raise ValueError('Invalid Aura card control body')
                card_id = str(body['card_id'])
                owned = ledger.db.execute(
                    'SELECT customer_id FROM aura_cards '
                    'WHERE card_id=? AND user_id=? AND environment=?',
                    (card_id, uid, aura_environment),
                ).fetchone()
                if not owned:
                    raise ApiError('CARD_NOT_FOUND', 'Card not found', 404)
                if action == 'aura-card-freeze':
                    result = await aura_client.freeze_card(card_id)
                elif action == 'aura-card-unfreeze':
                    result = await aura_client.unfreeze_card(card_id)
                elif action == 'aura-card-activate':
                    result = await aura_client.activate_card(
                        card_id, body['activation_code']
                    )
                else:
                    result = await aura_client.set_card_pin(card_id, body['pin'])
                if result['owner_id'] != owned['customer_id']:
                    raise ValueError('Aura card owner mismatch')
                tracking = result.get('tracking')
                ledger.db.execute(
                    'UPDATE aura_cards SET frozen=?,status=?,masked_pan=COALESCE(?,masked_pan),'
                    'delivery_status=COALESCE(?,delivery_status),'
                    'tracking=COALESCE(?,tracking),provider_updated_at=?,body=?,updated_at=? '
                    'WHERE card_id=? AND user_id=? AND environment=?',
                    (int(result['frozen']), result['status'], result['card_number_masked'],
                     result.get('delivery_status'),
                     json.dumps(tracking, separators=(',', ':')) if tracking else None,
                     now(), json.dumps(result, separators=(',', ':'), ensure_ascii=False), time.time(),
                     card_id, uid, aura_environment),
                )
                return web.json_response(result)
            if action == 'aura-card-recharge' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('cards'):
                    raise ApiError('cards_not_enabled', 'Aura cards are not enabled', 403)
                idempotency_key = request.headers.get('Idempotency-Key', '')
                if not 1 <= len(idempotency_key) <= 200:
                    raise ApiError('idempotency_key_required', 'Idempotency-Key is required', 400)
                body = await request.json()
                if not isinstance(body, dict) or 'card_id' not in body:
                    raise ValueError('card_id is required')
                allowed = {'card_id', 'amount', 'amount_spend'}
                if set(body) - allowed or (('amount' in body) == ('amount_spend' in body)):
                    raise ValueError('Provide exactly one of amount or amount_spend')
                return web.json_response(await aura_service.recharge_card_request(
                    uid, body['card_id'], idempotency_key=idempotency_key,
                    amount=body.get('amount'), amount_spend=body.get('amount_spend'),
                ))
            if action == 'aura-card-operations' and request.method == 'GET':
                card_id = str(request.query.get('card_id') or '')
                if not card_id:
                    raise ValueError('card_id is required')
                owned = ledger.db.execute(
                    'SELECT 1 FROM aura_cards WHERE card_id=? AND user_id=? AND environment=?',
                    (card_id, uid, aura_environment),
                ).fetchone()
                if not owned:
                    raise ApiError('CARD_NOT_FOUND', 'Card not found', 404)
                operations = [dict(row) for row in ledger.db.execute(
                    'SELECT operation_id,operation_type,status,previous_status,asset,amount,fee,merchant,'
                    'original_amount,original_currency,refunded_amount,balance_before,balance_after,'
                    'merchant_country,mcc,merchant_category,decline_reason,decline_message,'
                    'provider_created_at,provider_updated_at '
                    'FROM aura_card_operations WHERE card_id=? AND user_id=? '
                    'ORDER BY updated_at DESC LIMIT 200', (card_id, uid),
                )]
                return web.json_response({'data': operations})
            if action == 'aura-sbp-rate' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('sbp_buy'):
                    raise ApiError('sbp_buy_not_enabled', 'Aura SBP purchase is not enabled', 403)
                response = web.json_response(await aura_client.get_sbp_rate())
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-sbp-quote' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('sbp_buy'):
                    raise ApiError('sbp_buy_not_enabled', 'Aura SBP purchase is not enabled', 403)
                body = await request.json()
                if not isinstance(body, dict) or set(body) != {'fiat_amount'}:
                    raise ValueError('fiat_amount is required')
                response = web.json_response(
                    await aura_service.create_sbp_quote(uid, client_ref, body['fiat_amount'])
                )
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-sbp-order' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('sbp_buy'):
                    raise ApiError('sbp_buy_not_enabled', 'Aura SBP purchase is not enabled', 403)
                body = await request.json()
                if not isinstance(body, dict) or set(body) != {'quote_token'}:
                    raise ValueError('quote_token is required')
                key = request.headers.get('Idempotency-Key', '')
                if not 1 <= len(key) <= 200:
                    raise ApiError('idempotency_key_required', 'Idempotency-Key is required', 400)
                response = web.json_response(await aura_service.create_sbp_order(
                    uid, client_ref, body['quote_token'], idempotency_key=key
                ))
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-sbp-order' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('sbp_buy'):
                    raise ApiError('sbp_buy_not_enabled', 'Aura SBP purchase is not enabled', 403)
                order_id = request.query.get('order_id')
                if not order_id:
                    raise ValueError('order_id is required')
                response = web.json_response(await aura_service.get_sbp_order(uid, order_id))
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-sbp-order-cancel' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('sbp_buy'):
                    raise ApiError('sbp_buy_not_enabled', 'Aura SBP purchase is not enabled', 403)
                body = await request.json()
                if not isinstance(body, dict) or set(body) != {'order_id'}:
                    raise ValueError('order_id is required')
                response = web.json_response(
                    await aura_service.cancel_sbp_order(uid, str(body['order_id']))
                )
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-sbp-orders' and request.method == 'GET':
                orders = [dict(row) for row in ledger.db.execute(
                    'SELECT order_id,status,rub_amount,usdt_amount,fee,provider_updated_at '
                    'FROM aura_sbp_orders WHERE user_id=? AND environment=? '
                    'ORDER BY updated_at DESC LIMIT 200', (uid, aura_environment),
                )]
                pending = ledger.db.execute(
                    "SELECT 1 FROM wallet_provider_entities WHERE provider='aura' AND environment=? "
                    "AND entity_type='sbp_order' AND user_id=? AND status='submitting' LIMIT 1",
                    (aura_environment, uid),
                ).fetchone()
                return web.json_response({'data': orders, 'pending_creation': bool(pending)}, headers={'Cache-Control': 'no-store'})
            if action == 'aura-qr-quote' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('qr_pay'):
                    raise ApiError('qr_pay_not_enabled', 'Aura QR payment is not enabled', 403)
                body = await request.json()
                if not isinstance(body, dict) or set(body) != {'qr_payload'}:
                    raise ValueError('qr_payload is required')
                response = web.json_response(
                    await aura_service.create_qr_quote(uid, client_ref, body['qr_payload'])
                )
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-qr-payment' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('qr_pay'):
                    raise ApiError('qr_pay_not_enabled', 'Aura QR payment is not enabled', 403)
                body = await request.json()
                if not isinstance(body, dict) or set(body) != {'quote_token', 'qr_payload'}:
                    raise ValueError('quote_token and qr_payload are required')
                key = request.headers.get('Idempotency-Key', '')
                if not 1 <= len(key) <= 200:
                    raise ApiError('idempotency_key_required', 'Idempotency-Key is required', 400)
                response = web.json_response(await aura_service.create_qr_payment(
                    uid, client_ref, body['quote_token'], body['qr_payload'],
                    idempotency_key=key,
                ))
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'aura-qr-payment' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('qr_pay'):
                    raise ApiError('qr_pay_not_enabled', 'Aura QR payment is not enabled', 403)
                payment_id = request.query.get('payment_id')
                if not payment_id:
                    raise ValueError('payment_id is required')
                return web.json_response(
                    await aura_service.get_qr_payment(uid, payment_id)
                )
            if action == 'aura-qr-payments' and request.method == 'GET':
                rows = [dict(row) for row in ledger.db.execute(
                    'SELECT payment_id,status,amount_rub,rate,total_usdt,merchant,payment_type,'
                    'provider_updated_at FROM aura_qr_payments '
                    'WHERE user_id=? AND environment=? ORDER BY updated_at DESC LIMIT 200',
                    (uid, aura_environment),
                )]
                return web.json_response({'data': rows})
            if action == 'aura-deposit-address' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                active = ledger.db.execute(
                    "SELECT enabled FROM wallet_provider_routes WHERE product='crypto_deposit' "
                    "AND asset='USDT' AND network='TRON' AND environment=? AND provider='aura'",
                    (aura_environment,),
                ).fetchone()
                if not active or not active['enabled']:
                    raise ApiError('ROUTE_DISABLED', 'Aura TRON deposits are disabled', 503)
                if deposit_provider('USDT', 'TRON') != 'aura':
                    raise ApiError('ROUTE_DISABLED', 'Для USDT TRC-20 выбран другой провайдер', 409)
                require_asset_enabled('USDT', 'TRON')
                result = await aura_service.get_or_create_deposit_address(uid, client_ref)
                return web.json_response(result)
            if action == 'aura-deposit-address' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                address_id = request.query.get('address_id')
                if not address_id:
                    raise ValueError('address_id is required')
                owned = ledger.db.execute(
                    'SELECT customer_id FROM aura_deposit_addresses '
                    'WHERE address_id=? AND user_id=? AND environment=?',
                    (address_id, uid, aura_environment),
                ).fetchone()
                if not owned:
                    raise ApiError('DEPOSIT_ADDRESS_NOT_FOUND', 'Deposit address not found', 404)
                result = await aura_client.get_deposit_address(address_id)
                if result['customer_id'] != owned['customer_id']:
                    raise ValueError('Aura deposit address owner mismatch')
                return web.json_response(result)
            if action == 'aura-deposit-address-create' and request.method == 'POST':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                active = ledger.db.execute(
                    "SELECT enabled FROM wallet_provider_routes WHERE product='crypto_deposit' "
                    "AND asset='USDT' AND network='TRON' AND environment=? AND provider='aura'",
                    (aura_environment,),
                ).fetchone()
                if not active or not active['enabled']:
                    raise ApiError('ROUTE_DISABLED', 'Aura TRON deposits are disabled', 503)
                if deposit_provider('USDT', 'TRON') != 'aura':
                    raise ApiError('ROUTE_DISABLED', 'Для USDT TRC-20 выбран другой провайдер', 409)
                require_asset_enabled('USDT', 'TRON')
                if not await aura_client.product_enabled('crypto_processing'):
                    raise ApiError(
                        'crypto_processing_not_enabled',
                        'Aura crypto processing is not enabled', 403,
                    )
                body = await request.json()
                if not isinstance(body, dict) or set(body) - {'label'}:
                    raise ValueError('Invalid Aura deposit address body')
                return web.json_response(
                    await aura_service.create_additional_deposit_address(
                        uid, client_ref, label=body.get('label')
                    )
                )
            if action == 'aura-deposit-fees' and request.method == 'GET':
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                if not await aura_client.product_enabled('crypto_processing'):
                    raise ApiError('crypto_processing_not_enabled', 'Aura crypto processing is not enabled', 403)
                response = web.json_response(await aura_client.get_deposit_fees())
                response.headers['Cache-Control'] = 'no-store'
                return response
            if action == 'deposit' and request.method == 'POST':
                body = await request.json()
                asset = str(body.get('asset', 'USDT')).upper()
                network = str(body.get('network') or '').upper()
                if network not in WALLET_ASSET_NETWORKS.get(asset, ()):
                    raise ValueError('Пополнение этой валюты в выбранной сети не поддерживается')
                require_asset_enabled(asset, network)
                selected = deposit_provider(asset, network)
                if selected not in deposit_provider_options(asset, network):
                    raise ApiError('ROUTE_DISABLED', 'Пополнение этой монеты пока недоступно', 503)
                if selected == 'wpay':
                    if not custody.configured or custody.chain_env != 'mainnet':
                        raise ApiError('NOT_CONFIGURED', 'Основная сеть кошельков wPay не подключена', 503)
                    result = custody.create(uid, network)
                    return web.json_response({**result, 'asset': asset})
                if selected == 'aura':
                    if not aura_enabled or not aura_client.configured:
                        raise ApiError('NOT_CONFIGURED', 'Aura is not configured', 503)
                    if not await aura_client.product_enabled('crypto_processing'):
                        raise ApiError('crypto_processing_not_enabled', 'Aura crypto processing is not enabled', 403)
                    return web.json_response(await aura_service.get_or_create_deposit_address(uid, client_ref))
                if not token:
                    raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён', 503)
                if asset == 'USDT' and network != 'TRON':
                    result = await provider.call('getClientAddress', {'client_ref': client_ref, 'network': network}, post=True)
                    save_address(ledger, uid, result, asset)
                    return web.json_response(result)
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
            if action == 'overview' and request.method == 'GET' and not token:
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Платёжный провайдер не подключён', 503)
                process_aura_inbox(ledger, aura_environment)
                balances = [dict(row) for row in ledger.db.execute(
                    'SELECT asset,available,reserved FROM wallet_balances WHERE user_id=?',
                    (uid,),
                ) if asset_enabled(row['asset'])]
                items = [dict(row) for row in ledger.db.execute(
                    'SELECT event_id,asset,amount,type,created_at,detail FROM wallet_events '
                    'WHERE user_id=? ORDER BY rowid DESC LIMIT 100', (uid,),
                )]
                for item in items:
                    item['detail'] = json.loads(item['detail'])
                return web.json_response({
                    'balances': balances, 'rates': [], 'transactions': items,
                    'debts': [dict(row) for row in ledger.db.execute(
                        'SELECT asset,amount FROM wallet_debts WHERE user_id=?', (uid,)
                    )],
                })
            if action == 'sync' and request.method == 'POST' and not token:
                if not aura_enabled or not aura_client.configured:
                    raise ApiError('NOT_CONFIGURED', 'Платёжный провайдер не подключён', 503)
                processed = process_aura_inbox(ledger, aura_environment)
                recovered = await reconcile_aura_pending(
                    ledger, aura_client, aura_environment
                )
                return web.json_response({
                    'ok': True, 'processed': processed, 'recovered': recovered,
                })
            if not token:
                raise ApiError('NOT_CONFIGURED', 'GoSwap пока не подключён. Ожидается серверный API-ключ.', 503)
            if request.method == 'POST' and action in {
                'address', 'withdrawal-estimate', 'withdrawal-create',
                'transfer-prepare', 'transfer-send', 'invoice-prepare', 'invoice-create',
            }:
                body = await request.json()
                if action == 'address':
                    asset, network = body.get('asset', 'USDT'), body.get('network')
                    require_asset_enabled(asset, network)
                    if asset == 'USDT' and network in {'BSC', 'ETH', 'TON', 'SOL'} \
                            and deposit_provider(asset, network) != 'goswap':
                        raise ApiError('ROUTE_DISABLED', 'Используйте реквизиты выбранного провайдера', 409)
                elif action == 'withdrawal-estimate':
                    require_asset_enabled(body.get('asset'), body.get('network'))
                elif action == 'withdrawal-create':
                    row = ledger.db.execute(
                        'SELECT body FROM wallet_withdrawal_intents WHERE intent_id=? AND user_id=?',
                        (body.get('intent_id'), uid),
                    ).fetchone()
                    if row:
                        intent = json.loads(row['body'])
                        require_asset_enabled(intent.get('asset'), intent.get('network'))
                elif action in {'transfer-prepare', 'invoice-prepare'}:
                    require_asset_enabled(body.get('asset', 'USDT'))
                elif action == 'transfer-send':
                    row = ledger.db.execute(
                        'SELECT body FROM wallet_user_transfers WHERE intent_id=? AND user_id=?',
                        (body.get('intent_id'), uid),
                    ).fetchone()
                    if row:
                        require_asset_enabled(json.loads(row['body']).get('asset'))
                elif action == 'invoice-create':
                    row = ledger.db.execute(
                        'SELECT body FROM wallet_user_invoices WHERE intent_id=? AND user_id=?',
                        (body.get('intent_id'), uid),
                    ).fetchone()
                    if row:
                        require_asset_enabled(json.loads(row['body']).get('asset'))
            financial = await finance_route(
                request, action, uid, admin, ledger, provider, money, ApiError,
                audit_callback=record_admin_action,
                aura_test_client=aura_client if aura_enabled and aura_environment == 'test' else None,
            )
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
                balances = [dict(r) for r in ledger.db.execute('SELECT asset,available,reserved FROM wallet_balances WHERE user_id=?', (uid,)) if asset_enabled(r['asset'])]
                items = [dict(r) for r in ledger.db.execute('SELECT event_id,asset,amount,type,created_at,detail FROM wallet_events WHERE user_id=? ORDER BY rowid DESC LIMIT 100', (uid,))]
                for item in items:
                    item['detail'] = json.loads(item['detail'])
                rates = [rate for rate in rates if asset_enabled(rate.get('source')) or asset_enabled(rate.get('target'))]
                return web.json_response({'balances': balances, 'rates': rates, 'transactions': items, 'debts': [dict(row) for row in ledger.db.execute('SELECT asset,amount FROM wallet_debts WHERE user_id=?', (uid,))]})
            if action == 'provider' and request.method == 'GET':
                if not admin:
                    raise ApiError('FORBIDDEN', 'Только владелец', 403)
                return web.json_response({'app': await provider.call('getMe'), 'organization_balance': await provider.call('getBalance'), 'currencies': await provider.call('getCurrencies')})
            if action == 'currencies' and request.method == 'GET':
                currencies = await provider.call('getCurrencies')
                if isinstance(currencies, list):
                    currencies = [row for row in currencies if asset_enabled(row.get('code') or row.get('currency_code'))]
                elif isinstance(currencies, dict) and isinstance(currencies.get('items'), list):
                    currencies = {**currencies, 'items': [row for row in currencies['items'] if asset_enabled(row.get('code') or row.get('currency_code'))]}
                return web.json_response(currencies)
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
                    require_goswap_user_funds(ledger, uid, check['asset'], ledger.balance(uid, check['asset'])[0], money(check['amount']), ApiError)
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
            if action in {'aura-customer', 'aura-kyc'}:
                logging.getLogger('wpay.profile').warning(
                    'Profile request failed action=%s method=%s status=%s code=%s request_id=%s',
                    action, request.method, error.status, error.name,
                    getattr(error, 'request_id', '') or '-',
                )
            return web.json_response(wallet_error_payload(error), status=error.status, headers={'Retry-After': str(error.retry_after)} if error.retry_after else None)
        except (ValueError, KeyError, TypeError):
            return web.json_response({'ok': False, 'error': {'name': 'INVALID_REQUEST'}, 'detail': 'Некорректные данные запроса или ответа провайдера'}, status=400)

    async def cleanup(_):
        order_task = app.get('wpay_order_task')
        if order_task:
            order_task.cancel(); await asyncio.gather(order_task, return_exceptions=True)
        task=app.get('wpay_finance_task')
        if task:
            task.cancel();await asyncio.gather(task,return_exceptions=True)
        aura_task = app.get('wpay_aura_task')
        if aura_task:
            aura_task.cancel();await asyncio.gather(aura_task,return_exceptions=True)
        notification_task = app.get('wpay_notification_task')
        if notification_task:
            notification_task.cancel();await asyncio.gather(notification_task,return_exceptions=True)
        for task in app['wpay_broadcast_tasks']:
            task.cancel()
        if app['wpay_broadcast_tasks']:
            await asyncio.gather(*app['wpay_broadcast_tasks'], return_exceptions=True)
        await provider.close()
        await app['wpay_chain'].close()
        await exchange.close()
        await aura_client.close()
        ledger.db.close()

    async def startup(_):
        if exchange_orders.enabled:
            app['wpay_order_task'] = asyncio.create_task(exchange_orders.run())
        if bot_token:
            app['wpay_notification_task'] = asyncio.create_task(
                app['wpay_notification_worker'].run()
            )
        if token and os.environ.get('WPAY_FINANCE_WORKER','1')!='0':
            app['wpay_finance_task']=asyncio.create_task(FinanceWorker(ledger,provider,money,ApiError).run())
        if bot_token:
            task = asyncio.create_task(sync_telegram_users(only_missing=True))
            app['wpay_broadcast_tasks'].add(task)
            task.add_done_callback(app['wpay_broadcast_tasks'].discard)
        if aura_enabled and (aura_client.configured or aura_secret):
            app['wpay_aura_task'] = asyncio.create_task(
                run_aura_worker(ledger, aura_client, aura_environment)
            )

    app.router.add_route('*', '/api/wallet/{action}', route)
    app.on_startup.append(startup)
    app.on_cleanup.append(cleanup)
