"""Rebuild card-issue history from durable requests without changing money."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from wallet_backend import Ledger
from wallet_aura import backfill_card_issue_history,backfill_card_recharge_history


def money_snapshot(db):
    return {table:[tuple(row) for row in db.execute('SELECT * FROM '+table+' ORDER BY rowid')]
            for table in ['wallet_balances','wallet_provider_positions','wallet_debts','finance_postings']}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--database',required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    if not Path(args.database).is_file():raise ValueError('Existing database required')
    ledger=Ledger(args.database)
    try:
        ledger.book.verify()
        ledger.begin('card_history_repair','system','Rebuild display history from settled card requests; no monetary changes')
        try:
            before=money_snapshot(ledger.db)
            count=backfill_card_issue_history(ledger)+backfill_card_recharge_history(ledger)
            if before!=money_snapshot(ledger.db):raise ValueError('Monetary changes prohibited')
            if args.apply:ledger.commit()
            else:ledger.rollback()
        except Exception:
            ledger.rollback();raise
        ledger.book.verify()
        print(json.dumps({'requests_checked':count,'applied':args.apply,'balances_and_postings_unchanged':True}))
    finally:ledger.db.close()


if __name__=='__main__':
    try:main()
    except Exception:raise SystemExit('Card history repair failed; check the database and request records. No new monetary operation was requested.')
