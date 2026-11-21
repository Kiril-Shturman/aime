"""GoSwap history. Provider-wide resources are restricted to the organization owner."""
import json
import re
from collections import deque
from decimal import Decimal, localcontext
from aiohttp import web
from wallet_reconciliation import audit

METHODS = {'invoices': ('getInvoices', 'invoice_id', 'invoice_ids'),
           'transfers': ('getTransfers', 'spend_id', 'spend_id'),
           'withdrawals': ('getWithdrawals', 'spend_id', 'spend_id')}


def prepare_operations(ledger):
    ledger.db.execute('SAVEPOINT wallet_address_migration')
    try:
        columns = list(ledger.db.execute('PRAGMA table_info(wallet_addresses)'))
        keys = [row[1] for row in sorted(columns, key=lambda row: row[5]) if row[5]]
        migrate = bool(columns) and keys != ['user_id', 'network']
        if migrate:
            ledger.db.execute('ALTER TABLE wallet_addresses RENAME TO wallet_addresses_archive_v1')
        ledger.db.execute('CREATE TABLE IF NOT EXISTS wallet_addresses (user_id TEXT, network TEXT, body TEXT NOT NULL, PRIMARY KEY(user_id,network))')
        if migrate:
            rows = ledger.db.execute("SELECT user_id,network,body FROM wallet_addresses_archive_v1 ORDER BY CASE WHEN asset='USDT' THEN 0 ELSE 1 END").fetchall()
            for row in rows:
                value = json.loads(row['body'])
                save_address(ledger, row['user_id'], value, value.get('asset', 'USDT'), migrating=True)
            # Archive is retained for audit; it is never used to issue payment details.
        else:
            for row in ledger.db.execute('SELECT user_id,network,body FROM wallet_addresses').fetchall():
                value = json.loads(row['body'])
                value.setdefault('asset', 'USDT')
                value.setdefault('assets', [value['asset']])
                ledger.db.execute('UPDATE wallet_addresses SET body=? WHERE user_id=? AND network=?', (json.dumps(value), row['user_id'], row['network']))
        ledger.db.execute('RELEASE SAVEPOINT wallet_address_migration')
    except Exception:
        ledger.db.execute('ROLLBACK TO SAVEPOINT wallet_address_migration')
        ledger.db.execute('RELEASE SAVEPOINT wallet_address_migration')
        raise


def save_address(ledger, uid, result, asset='USDT', migrating=False):
    # A provider client has one permanent address per network. Asset describes
    # observed support, never a second independently owned wallet address.
    if not result.get('address') or result.get('network') not in {'BSC', 'ETH', 'TON', 'SOL'}:
        return
    previous = ledger.db.execute('SELECT body FROM wallet_addresses WHERE user_id=? AND network=?', (uid, result['network'])).fetchone()
    previous = json.loads(previous['body']) if previous else {}
    if previous and previous['address'] != result['address']:
        if migrating:
            return  # Prefer the legacy USDT row; alternative is retained in archive.
        raise ValueError('Provider changed the permanent address unexpectedly')
    public = {**previous, **{key: result[key] for key in ('address', 'network', 'client_ref', 'min_deposit') if key in result}}
    public['assets'] = sorted(set(previous.get('assets', [previous.get('asset', asset)])) | {asset})
    public['asset'] = previous.get('asset', asset)
    ledger.db.execute('INSERT OR REPLACE INTO wallet_addresses VALUES (?,?,?)', (uid, result['network'], json.dumps(public)))


def goswap_network_balances(ledger, uid, asset):
    """Project remaining GoSwap deposits using FIFO and cap by unreserved funds."""
    lots = deque()
    by_id = {}
    with localcontext() as ctx:
        ctx.prec = 80
        for row in ledger.db.execute(
            "SELECT event_id,amount,type,detail FROM wallet_events "
            "WHERE user_id=? AND asset=? ORDER BY rowid", (uid, asset),
        ):
            event_id, raw, kind, raw_detail = row
            if event_id.startswith('aura:'):
                continue
            delta = Decimal(raw)
            if kind == 'exchange_internal':
                detail = json.loads(raw_detail)
                left = Decimal(detail['amount'])
                reordered = deque()
                for lot in reversed(lots):
                    if left and lot[0] == detail['from_network'] and lot[1] > 0:
                        moved = min(left, lot[1])
                        lot[1] -= moved
                        target = [detail['to_network'], moved, lot[2]]
                        reordered.appendleft(target)
                        by_id[lot[2]].append(target)
                        left -= moved
                    reordered.appendleft(lot)
                if left:
                    raise ValueError('Cannot replay GoSwap network reallocation')
                lots = reordered
            elif delta > 0 and kind in {'deposit', 'admin_adjustment'}:
                detail = json.loads(raw_detail)
                if not (kind == 'deposit' and event_id.startswith('deposit:')
                        or kind == 'admin_adjustment' and detail.get('source') == 'goswap'):
                    continue
                network = detail.get('network')
                if network not in {'BSC', 'ETH', 'SOL', 'TON', 'TRON'}:
                    continue
                origin = event_id.removeprefix('deposit:')
                lot = [network, delta, origin]
                by_id.setdefault(origin, []).append(lot)
                lots.append(lot)
            elif delta < 0:
                remaining = -delta
                if kind == 'deposit_return':
                    detail = json.loads(raw_detail).get('details') or {}
                    for lot in by_id.get(str(detail.get('deposit_id')), ()):
                        debit = min(lot[1], remaining)
                        lot[1] -= debit
                        remaining -= debit
                        if not remaining:
                            break
                while remaining and lots:
                    lot = lots[0]
                    debit = min(lot[1], remaining)
                    lot[1] -= debit
                    remaining -= debit
                    if not lot[1]:
                        lots.popleft()

        available, _ = ledger.balance(uid, asset)
        backed_elsewhere = sum(
            (Decimal(row[0]) for row in ledger.db.execute(
                "SELECT available FROM wallet_provider_positions "
                "WHERE user_id=? AND asset=? AND provider!='goswap'", (uid, asset),
            )), Decimal(0),
        )
        remaining = max(Decimal(0), available - backed_elsewhere)
        balances = {}
        for network, amount, _ in reversed(lots):
            allocated = min(amount, remaining)
            balances[network] = balances.get(network, Decimal(0)) + allocated
            remaining -= allocated
    return balances


def page_number(raw):
    if not re.fullmatch(r'\d{1,9}', str(raw)):
        raise ValueError('Invalid page')
    return int(raw)


async def operations_route(request, action, uid, client_ref, ledger, provider, ApiError):
    owner = uid == 'owner'
    if action == 'access' and request.method == 'GET':
        return web.json_response({'owner': owner})
    if action == 'addresses' and request.method == 'GET':
        rows = ledger.db.execute('SELECT body FROM wallet_addresses WHERE user_id=? ORDER BY network', (uid,))
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
            if 'before' in request.query and 'after' in request.query:
                raise ValueError('Use before or after, not both')
            if 'after' in request.query:
                params['after'] = page_number(request.query['after'])
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
        return web.json_response(await audit(ledger, provider, ApiError))
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
