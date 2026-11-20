"""Client-owned withdrawal intents over an organization-funded provider API."""
import asyncio
import json
import time
import uuid
import weakref
from decimal import Decimal, localcontext
from aiohttp import web
from wallet_finance import aura_available, require_coverage, require_goswap_user_funds


def prepare_withdrawals(ledger):
    ledger.db.executescript('''
      CREATE TABLE IF NOT EXISTS wallet_withdrawal_intents (
        intent_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, spend_id TEXT UNIQUE NOT NULL,
        body TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT -1,
        held TEXT NOT NULL, withdrawal_id TEXT UNIQUE, outcome TEXT, expires_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wallet_debts (
        user_id TEXT NOT NULL, asset TEXT NOT NULL, amount TEXT NOT NULL,
        PRIMARY KEY(user_id,asset)
      );
    ''')


def debt(ledger, uid, asset):
    row = ledger.db.execute('SELECT amount FROM wallet_debts WHERE user_id=? AND asset=?', (uid, asset)).fetchone()
    return Decimal(row[0]) if row else Decimal(0)


def apply_outcome(ledger, payload, money, ApiError):
    state, version = payload.get('status'), payload.get('version')
    if state not in {'processing', 'completed', 'failed'} or type(version) is not int or version < 0 or (state in {'completed','failed'} and version < 1):
        raise ValueError('Invalid withdrawal outcome')
    ledger.begin('withdrawal_outcome','provider','Withdrawal '+str(payload.get('spend_id'))+' version '+str(version))
    try:
        row = ledger.db.execute('SELECT * FROM wallet_withdrawal_intents WHERE spend_id=?', (payload.get('spend_id'),)).fetchone()
        if not row or row['state'] in {'estimated', 'rejected'}:
            ledger.commit()
            return False
        if version <= row['version']:
            ledger.commit()
            return False
        if row['state'] in {'completed', 'failed'} and state == 'processing':
            raise ValueError('A terminal outcome cannot return to processing')
        body = json.loads(row['body'])
        amount, fee = money(payload['amount']), money(payload['fee'], positive=False)
        if fee < 0 or amount != money(body['amount']) or payload.get('asset') != body['asset'] or payload.get('network') != body['network'] or payload.get('address') != body['address'] or (payload.get('memo') or None) != (body.get('memo') or None):
            raise ValueError('Withdrawal identity mismatch')
        if row['withdrawal_id'] and row['withdrawal_id'] != payload.get('withdrawal_id'):
            raise ValueError('Withdrawal ID mismatch')
        if not payload.get('withdrawal_id'):
            raise ValueError('Missing withdrawal ID')
        if fee > money(body['fee'], positive=False):
            raise ValueError('Withdrawal exceeds accepted max_fee')
        with localcontext() as ctx:
            ctx.prec = 60
            old_total = Decimal(row['held'])
            total = amount + fee
            old_liability = old_total if row['state'] in {'reserved', 'processing', 'completed'} else Decimal(0)
            new_liability = total if state in {'processing', 'completed'} else Decimal(0)
            old_reserved = old_total if row['state'] in {'reserved', 'processing'} else Decimal(0)
            new_reserved = total if state == 'processing' else Decimal(0)
            available, reserved = ledger.balance(row['user_id'], body['asset'])
            change = old_liability - new_liability
            protected = min(available, aura_available(ledger, row["user_id"], body["asset"]))
            available += change
            owed = debt(ledger, row['user_id'], body['asset'])
            if available < protected:
                owed += protected - available
                available = protected
            elif owed:
                repayment = min(available - protected, owed)
                available -= repayment
                owed -= repayment
            ledger.put_balance(row['user_id'], body['asset'], available, reserved + new_reserved - old_reserved)
            ledger.set_debt(row['user_id'],body['asset'],owed)
        old_fee=old_total-amount if row['state']=='completed' else Decimal(0)
        new_fee=fee if state=='completed' else Decimal(0)
        ledger.book.fee(body['asset'],new_fee-old_fee,'withdrawal-fee:'+row['spend_id']+':'+str(version))
        ledger.db.execute('UPDATE wallet_withdrawal_intents SET state=?,version=?,held=?,withdrawal_id=?,outcome=? WHERE intent_id=?', (state, version, str(total), payload['withdrawal_id'], json.dumps(payload), row['intent_id']))
        # Reservation is internal. Events record actual spends/refunds, not duplicate completions.
        previous_spent = old_total if row['state'] == 'completed' else Decimal(0)
        current_spent = total if state == 'completed' else Decimal(0)
        delta = previous_spent - current_spent
        ledger.db.execute('INSERT OR IGNORE INTO wallet_events VALUES (?,?,?,?,?,?,?)', ('withdrawal:'+row['spend_id']+':'+str(version), row['user_id'], body['asset'], str(delta), 'withdrawal_'+state, payload.get('completed_at') or payload.get('failed_at') or time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), json.dumps(payload)))
        ledger.commit()
        return True
    except Exception:
        ledger.rollback()
        raise


async def reconcile(ledger, provider, money, ApiError, uid=None, spend_id=None, background=False):
    query = "SELECT spend_id FROM wallet_withdrawal_intents WHERE state IN ('reserved','processing','failed','completed')" if spend_id else "SELECT spend_id FROM wallet_withdrawal_intents WHERE state IN ('reserved','processing','failed')"
    params = []
    if uid is not None:
        query += ' AND user_id=?'
        params.append(uid)
    if spend_id is not None:
        query += ' AND spend_id=?'
        params.append(spend_id)
    if background:
        query+=" AND intent_id NOT IN (SELECT entity FROM wallet_poll_schedule WHERE kind='withdrawal' AND next_at>?) ORDER BY COALESCE((SELECT next_at FROM wallet_poll_schedule WHERE kind='withdrawal' AND entity=intent_id),0) LIMIT 200"
        params.append(time.time())
    rows = ledger.db.execute(query, params).fetchall()
    for offset in range(0, len(rows), 100):
        ids = {row['spend_id'] for row in rows[offset:offset+100]}
        result = await provider.call('getWithdrawals', {'spend_id': ','.join(sorted(ids)), 'count': 100})
        for item in result.get('items', []):
            if item.get('spend_id') in ids:
                apply_outcome(ledger, item, money, ApiError)
        if background:
            for value in ids:
                ledger.db.execute("INSERT OR REPLACE INTO wallet_poll_schedule SELECT 'withdrawal',intent_id,?+CASE WHEN state='failed' THEN 3600 ELSE 60 END FROM wallet_withdrawal_intents WHERE spend_id=?",(time.time(),value))


async def _withdrawal_route(request, action, uid, ledger, provider, money, ApiError):
    if action not in {'withdrawal-estimate', 'withdrawal-create', 'withdrawal-history'}:
        return None
    if action == 'withdrawal-history' and request.method == 'GET':
        await reconcile(ledger, provider, money, ApiError, uid)
        rows = ledger.db.execute('SELECT intent_id,spend_id,state,outcome,body FROM wallet_withdrawal_intents WHERE user_id=? AND state!=? ORDER BY rowid DESC LIMIT 100', (uid, 'estimated')).fetchall()
        return web.json_response({'items': [{**(json.loads(row['outcome']) if row['outcome'] else json.loads(row['body'])), 'intent_id': row['intent_id'], 'spend_id': row['spend_id'], 'status': 'processing' if row['state']=='reserved' else row['state'], 'submission_unknown': row['state']=='reserved'} for row in rows]})
    if request.method != 'POST':
        raise ApiError('METHOD_NOT_ALLOWED', 'Метод не поддерживается', 405)
    body = await request.json()
    if action == 'withdrawal-estimate':
        if set(body)-{'asset','network','address','amount','memo'}:
            raise ValueError('Неизвестный параметр вывода')
        asset, network = str(body.get('asset', '')).upper(), str(body.get('network', '')).upper()
        if asset == 'BTC':
            raise ValueError('BTC по API пока не выводится')
        if (await provider.call('getMe')).get('can_withdraw') is not True:
            raise ApiError('NOT_ENABLED', 'Вывод для организации недоступен', 403)
        currencies = await provider.call('getCurrencies')
        rows = currencies if isinstance(currencies, list) else currencies.get('items', [])
        if not any((row.get('code') or row.get('currency_code')) == asset and row.get('can_withdraw') is True for row in rows):
            raise ApiError('UNSUPPORTED_ASSET', 'Вывод этой монеты недоступен', 400)
        amount = money(body.get('amount'))
        address = str(body.get('address') or '').strip()
        memo = body.get('memo') or None
        if not address or len(address) > 256 or network not in {'BSC', 'ETH', 'TON', 'SOL', 'TRON'} or (memo is not None and (not isinstance(memo, str) or len(memo) > 256)):
            raise ValueError('Некорректные реквизиты')
        params = {'asset': asset, 'network': network, 'address': address, 'amount': str(amount)}
        if memo:
            params['memo'] = memo
        estimate = await provider.call('estimateWithdrawal', params)
        fee = money(estimate['fee'], positive=False)
        with localcontext() as ctx:
            ctx.prec = 60
            total = amount + fee
        if fee < 0 or money(estimate['amount']) != amount or money(estimate['total']) != total or any(estimate.get(key) != params[key] for key in ('asset', 'network', 'address')) or (estimate.get('memo') or None) != memo:
            raise ValueError('Некорректный расчёт комиссии')
        canonical = {**params, 'fee': str(fee), 'total': str(total)}
        intent_id, spend_id = uuid.uuid4().hex, 'wpay-w-'+uuid.uuid4().hex
        ledger.db.execute('INSERT INTO wallet_withdrawal_intents(intent_id,user_id,spend_id,body,state,held,expires_at) VALUES (?,?,?,?,?,?,?)', (intent_id, uid, spend_id, json.dumps(canonical), 'estimated', str(total), time.time()+120))
        return web.json_response({**canonical, 'intent_id': intent_id, 'expires_at': time.time()+120})
    intent_id = body.get('intent_id')
    pending=ledger.db.execute('SELECT state,body FROM wallet_withdrawal_intents WHERE intent_id=? AND user_id=?',(intent_id,uid)).fetchone()
    if pending and pending['state'] in {'estimated','reserved'} and (await provider.call('getMe')).get('can_withdraw') is not True:
        raise ApiError('NOT_ENABLED','Вывод для организации недоступен',403)
    if pending and pending['state']=='estimated':
        check=json.loads(pending['body'])
        require_goswap_user_funds(ledger, uid, check['asset'], ledger.balance(uid, check['asset'])[0], money(check['total']), ApiError)
        await require_coverage(ledger,provider,check['asset'],ApiError)
    ledger.begin('withdrawal_reserve',uid,'Reserve withdrawal '+str(intent_id))
    try:
        row = ledger.db.execute('SELECT * FROM wallet_withdrawal_intents WHERE intent_id=? AND user_id=?', (intent_id, uid)).fetchone()
        if not row:
            raise ApiError('NOT_FOUND', 'Расчёт не найден', 404)
        canonical = json.loads(row['body'])
        if row['state'] == 'rejected':
            raise ApiError('REESTIMATE_REQUIRED', 'Запросите новый расчёт', 409)
        if row['state'] == 'estimated':
            if row['expires_at'] <= time.time():
                raise ApiError('QUOTE_EXPIRED', 'Расчёт истёк. Повторите расчёт.', 409)
            available, reserved = ledger.balance(uid, canonical['asset'])
            total = money(canonical['total'])
            require_goswap_user_funds(ledger, uid, canonical['asset'], available, total, ApiError)
            if debt(ledger, uid, canonical['asset']):
                raise ApiError('INSUFFICIENT_FUNDS', 'Есть задолженность по уточнённому выводу', 409)
            with localcontext() as ctx:
                ctx.prec = 60
                ledger.put_balance(uid, canonical['asset'], available-total, reserved+total)
            ledger.db.execute("UPDATE wallet_withdrawal_intents SET state='reserved' WHERE intent_id=?", (intent_id,))
        ledger.commit()
    except Exception:
        ledger.rollback()
        raise
    if row['state'] in {'processing', 'completed', 'failed'}:
        return web.json_response(json.loads(row['outcome']))
    params = {key: canonical[key] for key in ('asset', 'network', 'address', 'amount', 'memo') if key in canonical}
    params.update(spend_id=row['spend_id'], max_fee=canonical['fee'])
    try:
        result = await provider.call('createWithdrawal', params, post=True)
        if result.get('spend_id') != row['spend_id']:
            raise ValueError('Provider returned another withdrawal')
        if result.get('status') == 'failed':
            current = await provider.call('getWithdrawals', {'spend_id': row['spend_id'], 'count': 1})
            verified = next((item for item in current.get('items', []) if item.get('spend_id') == row['spend_id']), None)
            if not verified:
                raise ApiError('UNAVAILABLE', 'Исход вывода ещё не подтверждён', 503)
            result = verified
        apply_outcome(ledger, result, money, ApiError)
        return web.json_response(result)
    except ApiError as error:
        # Concurrent retries use the same provider spend_id. Never release an
        # unknown reservation on timeout/503 or conflict; reconciliation owns it.
        if row['state'] == 'estimated' and 400 <= error.status < 500 and error.name != 'SPEND_ID_CONFLICT':
            ledger.begin()
            try:
                current = ledger.db.execute('SELECT state FROM wallet_withdrawal_intents WHERE intent_id=?', (intent_id,)).fetchone()
                if current['state'] == 'reserved':
                    available, reserved = ledger.balance(uid, canonical['asset'])
                    total = money(canonical['total'])
                    with localcontext() as ctx:
                        ctx.prec = 60
                        ledger.put_balance(uid, canonical['asset'], available+total, reserved-total)
                    ledger.db.execute("UPDATE wallet_withdrawal_intents SET state='rejected' WHERE intent_id=?", (intent_id,))
                ledger.commit()
            except Exception:
                ledger.rollback()
                raise
        raise


async def withdrawal_route(request, action, uid, ledger, provider, money, ApiError):
    if action != 'withdrawal-create':
        return await _withdrawal_route(request, action, uid, ledger, provider, money, ApiError)
    # SQLite protects accounting; the lock avoids concurrent submission of the
    # same intent within this process. Provider spend_id handles process retries.
    if not hasattr(ledger, 'withdrawal_locks'):
        ledger.withdrawal_locks = weakref.WeakValueDictionary()
    body = await request.json()
    key = (uid, str(body.get('intent_id')))
    lock = ledger.withdrawal_locks.setdefault(key, asyncio.Lock())
    async with lock:
        return await _withdrawal_route(request, action, uid, ledger, provider, money, ApiError)
