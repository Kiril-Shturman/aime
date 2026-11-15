"""Incremental immutable organization journal. No client balances are credited here."""
import json
from decimal import Decimal, localcontext

async def audit(ledger, provider, ApiError):
    ledger.db.executescript('''
      CREATE TABLE IF NOT EXISTS wallet_provider_journal (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_provider_cursor (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
    ''')
    start = {row['currency_code']: Decimal(str(row['available'])) for row in await provider.call('getBalance')}
    row = ledger.db.execute('SELECT value FROM wallet_provider_cursor WHERE id=1').fetchone()
    cursor, complete = row[0] if row else 0, False
    for _ in range(20):
        page = await provider.call('getTransactions', {'count': 1000, 'after': cursor})
        next_cursor = page.get('cursor', cursor)
        if type(next_cursor) is not int or next_cursor < cursor or (page.get('has_more') and next_cursor == cursor):
            raise ApiError('PROVIDER_UNAVAILABLE', 'Некорректный курсор сверки', 502)
        ledger.db.execute('BEGIN IMMEDIATE')
        try:
            for item in page.get('items', []):
                if type(item.get('id')) is not int or not Decimal(str(item['net'])).is_finite():
                    raise ValueError('Invalid journal row')
                existing = ledger.db.execute('SELECT body FROM wallet_provider_journal WHERE id=?', (item['id'],)).fetchone()
                if existing and json.loads(existing[0]) != item:
                    raise ValueError('Provider changed an immutable journal row')
                ledger.db.execute('INSERT OR IGNORE INTO wallet_provider_journal VALUES (?,?)', (item['id'], json.dumps(item)))
            ledger.db.execute('INSERT OR REPLACE INTO wallet_provider_cursor VALUES (1,?)', (next_cursor,))
            ledger.db.execute('COMMIT')
        except Exception:
            ledger.db.execute('ROLLBACK')
            raise
        cursor = next_cursor
        if not page.get('has_more'):
            complete = True
            break
    totals, entries = {}, 0
    with localcontext() as ctx:
        ctx.prec = 60
        for row in ledger.db.execute('SELECT body FROM wallet_provider_journal'):
            item = json.loads(row[0])
            totals[item['asset']] = totals.get(item['asset'], Decimal(0)) + Decimal(str(item['net']))
            entries += 1
        end = {row['currency_code']: Decimal(str(row['available'])) for row in await provider.call('getBalance')}
        stable = start == end
        items = [{'asset': asset, 'balance': str(end.get(asset, Decimal(0))), 'net': str(totals.get(asset, Decimal(0))), 'difference': str(end.get(asset, Decimal(0))-totals.get(asset, Decimal(0))) if complete and stable else None} for asset in sorted(set(end)|set(totals))]
    return {'items': items, 'complete': complete, 'stable': stable, 'entries': entries, 'cursor': cursor}
