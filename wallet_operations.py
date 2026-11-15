"""GoSwap history. Provider-wide resources are restricted to the organization owner."""
import json
import re
from decimal import Decimal, localcontext
from aiohttp import web

METHODS = {'invoices': ('getInvoices', 'invoice_id', 'invoice_ids'),
           'transfers': ('getTransfers', 'spend_id', 'spend_id'),
           'withdrawals': ('getWithdrawals', 'spend_id', 'spend_id')}


def prepare_operations(ledger):
    ledger.db.execute('SAVEPOINT wallet_address_migration')
    try:
        # Upgrade legacy network-only keys without losing existing USDT addresses.
        columns = [row[1] for row in ledger.db.execute('PRAGMA table_info(wallet_addresses)')]
        if columns and 'asset' not in columns:
            ledger.db.execute('ALTER TABLE wallet_addresses RENAME TO wallet_addresses_legacy')
        ledger.db.execute('CREATE TABLE IF NOT EXISTS wallet_addresses (user_id TEXT, asset TEXT, network TEXT, body TEXT NOT NULL, PRIMARY KEY(user_id,asset,network))')
        if columns and 'asset' not in columns:
            rows = ledger.db.execute('SELECT user_id, network, body FROM wallet_addresses_legacy').fetchall()
            for row in rows:
                body = json.loads(row['body'])
                body['asset'] = body.get('asset', 'USDT')
                ledger.db.execute('INSERT OR IGNORE INTO wallet_addresses VALUES (?,?,?,?)', (row['user_id'], body['asset'], row['network'], json.dumps(body)))
            ledger.db.execute('DROP TABLE wallet_addresses_legacy')
        ledger.db.execute('RELEASE SAVEPOINT wallet_address_migration')
    except Exception:
        ledger.db.execute('ROLLBACK TO SAVEPOINT wallet_address_migration')
        ledger.db.execute('RELEASE SAVEPOINT wallet_address_migration')
        raise


def save_address(ledger, uid, result, asset='USDT'):
    # TRON uses expiring exact-amount claims, never permanent addresses.
    if result.get('address') and result.get('network') in {'BSC', 'ETH', 'TON', 'SOL'}:
        public = {key: result[key] for key in ('address', 'network', 'client_ref', 'min_deposit') if key in result}
        public['asset'] = asset
        ledger.db.execute('INSERT OR REPLACE INTO wallet_addresses VALUES (?,?,?,?)', (uid, asset, result['network'], json.dumps(public)))


def page_number(raw):
    if not re.fullmatch(r'\d{1,9}', str(raw)):
        raise ValueError('Invalid page')
    return int(raw)


async def operations_route(request, action, uid, client_ref, ledger, provider, ApiError):
    owner = uid == 'owner'
    if action == 'access' and request.method == 'GET':
        return web.json_response({'owner': owner})
    if action == 'addresses' and request.method == 'GET':
        rows = ledger.db.execute('SELECT body FROM wallet_addresses WHERE user_id=? ORDER BY asset,network', (uid,))
        return web.json_response({'items': [json.loads(row[0]) for row in rows]})
    if action == 'address' and request.method == 'POST':
        body = await request.json()
        network = body.get('network')
        if body.get('asset', 'USDT') != 'USDT':
            raise ValueError('Permanent client addresses support USDT only; use an asset-specific deposit')
        if network not in {'BSC', 'ETH', 'TON', 'SOL'}:
            raise ValueError('Unsupported permanent network')
        result = await provider.call('getClientAddress', {'client_ref': client_ref, 'network': network}, post=True)
        save_address(ledger, uid, result)
        return web.json_response(result)
    if action in {'operations-invoices', 'operations-transfers', 'operations-withdrawals', 'operations-deposits', 'operations-reconciliation'} and request.method == 'GET':
        kind = action.removeprefix('operations-')
        count = min(max(page_number(request.query.get('count', '50')), 1), 100)
        offset = page_number(request.query.get('offset', '0'))
        params = {'count': count, 'offset': offset}
        if kind == 'reconciliation':
            if not owner:
                raise ApiError('FORBIDDEN', 'Сверка доступна только владельцу организации', 403)
            params = {'count': count}
            if request.query.get('before'):
                params['before'] = page_number(request.query['before'])
            result = await provider.call('getTransactions', params)
            return web.json_response(result)
        if kind == 'deposits':
            params['client_ref'] = client_ref
            result = await provider.call('getDeposits', params)
            items = [item for item in result.get('items', []) if item.get('client_ref') == client_ref]
        else:
            method, field, parameter = METHODS[kind]
            if not owner:
                # Only server-recorded ownership is trusted; never accept IDs/client_ref from the browser.
                refs = set()
                for row in ledger.db.execute('SELECT detail FROM wallet_events WHERE user_id=?', (uid,)):
                    detail = json.loads(row[0])
                    if detail.get('operation_kind') == kind and detail.get(field):
                        refs.add(str(detail[field]))
                ids = sorted(refs)[offset:offset + count]
                if not ids:
                    return web.json_response({'items': [], 'has_more': False, 'scope': 'personal', 'notice': 'Здесь появятся операции, созданные для вашего аккаунта в WPay.'})
                params = {parameter: ','.join(ids), 'count': count}
                result = await provider.call(method, params)
                items = [item for item in result.get('items', []) if str(item.get(field)) in ids]
                return web.json_response({'items': items, 'has_more': len(refs) > offset + count, 'scope': 'personal'})
            result = await provider.call(method, params)
            items = result.get('items', [])
        return web.json_response({'items': items, 'has_more': len(result.get('items', [])) == count,
                                  'scope': 'organization' if owner and kind != 'deposits' else 'personal'})
    if action == 'provider-audit' and request.method == 'GET':
        if not owner:
            raise ApiError('FORBIDDEN', 'Сверка доступна только владельцу организации', 403)
        def balances(rows):
            return {row['currency_code']: Decimal(str(row['available'])) for row in rows}
        def difference(a, b):
            with localcontext() as ctx:
                ctx.prec = 60
                return a - b
        start = balances(await provider.call('getBalance'))
        totals, seen, cursor, complete = {}, set(), None, False
        for _ in range(20):
            params = {'count': 1000}
            if cursor is not None:
                params['before'] = cursor
            page = await provider.call('getTransactions', params)
            for item in page.get('items', []):
                key = str(item['id'])
                if key in seen:
                    continue
                seen.add(key)
                asset = item['asset']
                with localcontext() as ctx:
                    ctx.prec = 60
                    totals[asset] = totals.get(asset, Decimal(0)) + Decimal(str(item['net']))
            if not page.get('has_more'):
                complete = True
                break
            next_cursor = page.get('cursor')
            if next_cursor is None or next_cursor == cursor:
                raise ApiError('PROVIDER_UNAVAILABLE', 'Провайдер не вернул следующий курсор сверки', 502)
            cursor = next_cursor
        end = balances(await provider.call('getBalance'))
        stable = start == end
        rows = [{'asset': asset, 'balance': str(end.get(asset, Decimal(0))),
                 'net': str(totals.get(asset, Decimal(0))),
                 'difference': str(difference(end.get(asset, Decimal(0)), totals.get(asset, Decimal(0)))) if complete and stable else None}
                for asset in sorted(set(end) | set(totals))]
        return web.json_response({'items': rows, 'complete': complete, 'stable': stable, 'entries': len(seen)})
    if action == 'revoke-transfer' and request.method == 'POST':
        # These are organization payouts. Revocation returns money to the organization,
        # not a personal ledger balance. Do not expose it as a client-side refund.
        if not owner:
            raise ApiError('FORBIDDEN', 'Отзыв выплаты доступен только владельцу организации', 403)
        spend_id = (await request.json()).get('spend_id')
        if not isinstance(spend_id, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,64}', spend_id):
            raise ValueError('Invalid spend_id')
        current = await provider.call('getTransfers', {'spend_id': spend_id})
        transfer = next((row for row in current.get('items', []) if row.get('spend_id') == spend_id), None)
        if not transfer:
            raise ApiError('NOT_FOUND', 'Перевод не найден', 404)
        if transfer.get('status') != 'pending':
            raise ApiError('TRANSFER_NOT_PENDING', 'Перевод уже получен или отозван. Обновите историю.', 409)
        return web.json_response(await provider.call('revokeTransfer', {'spend_id': spend_id}, post=True))
    return None
