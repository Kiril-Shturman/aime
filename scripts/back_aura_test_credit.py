"""Audited repair of one existing test grant; never credits money or calls a payment API."""
import argparse,asyncio,json,os,subprocess,sys
from pathlib import Path
from decimal import Decimal
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from wallet_backend import Ledger,ApiError
from wallet_aura import AuraClient,_platform_balance
from wallet_finance import apply_aura_test_backing


def snapshot(db):
    return {name:[tuple(row) for row in db.execute('SELECT * FROM '+name+' ORDER BY rowid')]
            for name in ['wallet_balances','wallet_debts','finance_postings']}


async def main():
    parser=argparse.ArgumentParser();parser.add_argument('--event-id',required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    if os.geteuid()!=0:raise ValueError('Root-only maintenance')
    pid=subprocess.check_output(['systemctl','show','wpay','-p','MainPID','--value'],text=True).strip()
    env=dict(item.split('=',1) for item in Path('/proc/'+pid+'/environ').read_text().split('\0') if '=' in item)
    if env.get('AURA_ENVIRONMENT')!='test':raise ValueError('Test environment required')
    client=AuraClient(env['AURA_API_KEY'],'test',ApiError,base_url=env.get('AURA_BASE_URL') or None)
    try:platform=_platform_balance(await client.get_balance())
    finally:await client.close()
    ledger=Ledger(env['WPAY_DB_PATH'])
    try:
        ledger.book.verify();ledger.begin('test_credit_backing_repair','system','Back existing manual TEST credit with confirmed Aura reserve; no balance increase')
        try:
            grant=ledger.db.execute("SELECT user_id,amount,type FROM wallet_events WHERE event_id=? AND asset='USDT'",(args.event_id,)).fetchone()
            if not grant or grant['type'] not in {'adjustment','admin_adjustment'} or Decimal(grant['amount'])<=0:raise ValueError('Existing positive administrative USDT grant required')
            before=snapshot(ledger.db)
            apply_aura_test_backing(ledger,grant['user_id'],Decimal(grant['amount']),args.event_id,'system:test-credit-repair',platform)
            if before!=snapshot(ledger.db):raise ValueError('User balances and monetary postings must remain unchanged')
            position=ledger.db.execute("SELECT available FROM wallet_provider_positions WHERE provider='aura' AND environment='test' AND user_id=? AND asset='USDT'",(grant['user_id'],)).fetchone()
            if args.apply:ledger.commit()
            else:ledger.rollback()
        except Exception:ledger.rollback();raise
        ledger.book.verify()
        print(json.dumps({'environment':'test','applied':args.apply,'card_funding_available':position['available'],'balances_and_postings_unchanged':True,'no_monetary_provider_post':True}))
    finally:ledger.db.close()


if __name__=='__main__':
    os.umask(0o077)
    try:asyncio.run(main())
    except Exception:raise SystemExit('Test credit backing repair failed; verify the environment, reserve and source grant. No provider payment was requested.')
