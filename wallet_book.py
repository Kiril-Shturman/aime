"""Decimal double-entry journal and transactional balance projections.

Posting amount is positive for debit and negative for credit. User available /
reserved are credit-normal liabilities; user debt is a debit-normal receivable.
Every journal transaction is single-asset and sums to exactly zero.
"""

import json
import time
import uuid
from decimal import Decimal, localcontext

D = Decimal


class Book:
    def __init__(self, db, error):
        self.db, self.error, self.stack = db, error, []
        db.execute("PRAGMA foreign_keys=ON")
        db.executescript(
            """
          CREATE TABLE IF NOT EXISTS finance_migrations (name TEXT PRIMARY KEY, applied_at REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS finance_accounts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, asset TEXT NOT NULL, bucket TEXT NOT NULL, UNIQUE(owner,asset,bucket));
          CREATE TABLE IF NOT EXISTS finance_transactions (id TEXT PRIMARY KEY, event_key TEXT UNIQUE NOT NULL, asset TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL, created_at REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS finance_postings (transaction_id TEXT NOT NULL REFERENCES finance_transactions(id), account_id TEXT NOT NULL REFERENCES finance_accounts(id), amount TEXT NOT NULL, PRIMARY KEY(transaction_id,account_id));
          CREATE INDEX IF NOT EXISTS finance_postings_account ON finance_postings(account_id);
          CREATE TRIGGER IF NOT EXISTS finance_postings_no_update BEFORE UPDATE ON finance_postings BEGIN SELECT RAISE(ABORT,'immutable postings'); END;
          CREATE TRIGGER IF NOT EXISTS finance_postings_no_delete BEFORE DELETE ON finance_postings BEGIN SELECT RAISE(ABORT,'immutable postings'); END;
          CREATE TRIGGER IF NOT EXISTS finance_transactions_no_update BEFORE UPDATE ON finance_transactions BEGIN SELECT RAISE(ABORT,'immutable transactions'); END;
          CREATE TRIGGER IF NOT EXISTS finance_transactions_no_delete BEFORE DELETE ON finance_transactions BEGIN SELECT RAISE(ABORT,'immutable transactions'); END;
          CREATE TABLE IF NOT EXISTS finance_reconciliation (asset TEXT PRIMARY KEY, provider_available TEXT NOT NULL, liabilities TEXT NOT NULL, inflight TEXT NOT NULL, difference TEXT NOT NULL, state TEXT NOT NULL, checked_at REAL NOT NULL, detail TEXT NOT NULL);
        """
        )
        self.begin("migration", "system", "Opening balances from legacy projection")
        try:
            if not db.execute(
                "SELECT 1 FROM finance_migrations WHERE name='double-entry-v1'"
            ).fetchone():
                for row in db.execute("SELECT * FROM wallet_balances").fetchall():
                    self._balance_post(
                        row["user_id"],
                        row["asset"],
                        D(row["available"]),
                        D(row["reserved"]),
                        "opening:" + row["user_id"] + ":" + row["asset"],
                    )
                for row in db.execute("SELECT * FROM wallet_debts").fetchall():
                    self.post(
                        row["asset"],
                        [
                            (row["user_id"], "debt", D(row["amount"])),
                            ("provider", "clearing", -D(row["amount"])),
                        ],
                        "opening-debt:" + row["user_id"] + ":" + row["asset"],
                    )
                db.execute(
                    "INSERT INTO finance_migrations VALUES (?,?)",
                    ("double-entry-v1", time.time()),
                )
            self.commit()
        except Exception:
            self.rollback()
            raise

    def begin(
        self, kind="balance_change", actor="system", reason="Balance projection update"
    ):
        name = "finance_" + uuid.uuid4().hex if self.db.in_transaction else None
        self.db.execute("SAVEPOINT " + name if name else "BEGIN IMMEDIATE")
        self.stack.append((name, kind, actor, reason))

    def commit(self):
        name, *_ = self.stack[-1]
        self.db.execute("RELEASE SAVEPOINT " + name if name else "COMMIT")
        self.stack.pop()

    def rollback(self):
        name, *_ = self.stack.pop()
        if name:
            self.db.execute("ROLLBACK TO SAVEPOINT " + name)
            self.db.execute("RELEASE SAVEPOINT " + name)
        else:
            self.db.execute("ROLLBACK")

    def account(self, owner, asset, bucket):
        key = json.dumps([owner, asset, bucket], separators=(",", ":"))
        self.db.execute(
            "INSERT OR IGNORE INTO finance_accounts VALUES (?,?,?,?)",
            (key, owner, asset, bucket),
        )
        return key

    def post(self, asset, legs, event_key=None, kind=None, actor=None, reason=None):
        if not self.db.in_transaction:
            raise RuntimeError("Journal writes require a write transaction")
        with localcontext() as ctx:
            ctx.prec = 80
            grouped = {}
            for owner, bucket, amount in legs:
                amount = D(str(amount))
                if not amount.is_finite():
                    raise ValueError("Non-finite posting")
                key = (owner, bucket)
                grouped[key] = grouped.get(key, D(0)) + amount
            if sum(grouped.values(), D(0)) != 0:
                raise ValueError("Unbalanced postings")
            grouped = {key: value for key, value in grouped.items() if value}
            if not grouped:
                return False
            event_key = event_key or "change:" + uuid.uuid4().hex
            if self.db.execute(
                "SELECT 1 FROM finance_transactions WHERE event_key=?", (event_key,)
            ).fetchone():
                raise ValueError("Duplicate accounting event")
            meta = (
                self.stack[0][1:]
                if self.stack
                else ("balance_change", "system", "Balance projection update")
            )
            txid = uuid.uuid4().hex
            self.db.execute(
                "INSERT INTO finance_transactions VALUES (?,?,?,?,?,?,?)",
                (
                    txid,
                    event_key,
                    asset,
                    kind or meta[0],
                    actor or meta[1],
                    reason or meta[2],
                    time.time(),
                ),
            )
            for (owner, bucket), amount in grouped.items():
                self.db.execute(
                    "INSERT INTO finance_postings VALUES (?,?,?)",
                    (txid, self.account(owner, asset, bucket), str(amount)),
                )
        return True

    def bucket(self, owner, asset, bucket):
        with localcontext() as ctx:
            ctx.prec = 80
            rows = self.db.execute(
                "SELECT p.amount FROM finance_postings p JOIN finance_accounts a ON a.id=p.account_id WHERE a.owner=? AND a.asset=? AND a.bucket=?",
                (owner, asset, bucket),
            )
            value = sum((D(row[0]) for row in rows), D(0))
            return -value if bucket in {"available", "reserved"} else value

    def check(self, uid, asset, available, reserved):
        if (
            self.bucket(uid, asset, "available") != available
            or self.bucket(uid, asset, "reserved") != reserved
        ):
            raise self.error(
                "ACCOUNTING_MISMATCH",
                "Баланс не совпадает с проводками. Новые расходы заблокированы.",
                503,
            )

    def _balance_post(self, uid, asset, available_delta, reserved_delta, key=None):
        self.post(
            asset,
            [
                (uid, "available", -available_delta),
                (uid, "reserved", -reserved_delta),
                ("provider", "clearing", available_delta + reserved_delta),
            ],
            key,
        )

    def set_balance(self, uid, asset, available, reserved):
        self.begin()
        try:
            row = self.db.execute(
                "SELECT available,reserved FROM wallet_balances WHERE user_id=? AND asset=?",
                (uid, asset),
            ).fetchone()
            old_a, old_r = (D(row[0]), D(row[1])) if row else (D(0), D(0))
            self.check(uid, asset, old_a, old_r)
            with localcontext() as ctx:
                ctx.prec = 80
                self._balance_post(uid, asset, available - old_a, reserved - old_r)
            self.db.execute(
                "INSERT OR REPLACE INTO wallet_balances VALUES (?,?,?,?)",
                (uid, asset, str(available), str(reserved)),
            )
            self.commit()
        except Exception:
            self.rollback()
            raise

    def set_debt(self, uid, asset, amount):
        self.begin()
        try:
            row = self.db.execute(
                "SELECT amount FROM wallet_debts WHERE user_id=? AND asset=?",
                (uid, asset),
            ).fetchone()
            old = D(row[0]) if row else D(0)
            if self.bucket(uid, asset, "debt") != old:
                raise self.error(
                    "ACCOUNTING_MISMATCH", "Долг не совпадает с проводками", 503
                )
            if amount < 0:
                raise ValueError("Negative debt")
            self.post(
                asset,
                [(uid, "debt", amount - old), ("provider", "clearing", old - amount)],
            )
            self.db.execute(
                "INSERT OR REPLACE INTO wallet_debts VALUES (?,?,?)",
                (uid, asset, str(amount)),
            )
            self.commit()
        except Exception:
            self.rollback()
            raise

    def fee(self, asset, amount, key):
        amount = D(str(amount))
        if not amount.is_finite():
            raise ValueError("Invalid fee")
        if (
            amount
            and not self.db.execute(
                "SELECT 1 FROM finance_transactions WHERE event_key=?", (key,)
            ).fetchone()
        ):
            self.post(
                asset,
                [
                    ("provider", "fee_expense", amount),
                    ("platform", "fee_recovery", -amount),
                ],
                key,
                kind="provider_fee",
            )

    def verify(self):
        with localcontext() as ctx:
            ctx.prec = 80
            for tx in self.db.execute("SELECT id,asset FROM finance_transactions"):
                rows = self.db.execute(
                    "SELECT p.amount,a.asset FROM finance_postings p JOIN finance_accounts a ON a.id=p.account_id WHERE p.transaction_id=?",
                    (tx["id"],),
                ).fetchall()
                if (
                    any(row["asset"] != tx["asset"] for row in rows)
                    or sum((D(row["amount"]) for row in rows), D(0)) != 0
                ):
                    raise self.error(
                        "ACCOUNTING_MISMATCH", "Несбалансированные проводки", 503
                    )
        for row in self.db.execute("SELECT * FROM wallet_balances").fetchall():
            self.check(
                row["user_id"], row["asset"], D(row["available"]), D(row["reserved"])
            )
        for row in self.db.execute("SELECT * FROM wallet_debts").fetchall():
            if self.bucket(row["user_id"], row["asset"], "debt") != D(row["amount"]):
                raise self.error(
                    "ACCOUNTING_MISMATCH", "Долг не совпадает с проводками", 503
                )
        # Verify journal accounts too: a missing cache row must not conceal a liability.
        for row in self.db.execute(
            "SELECT DISTINCT owner,asset,bucket FROM finance_accounts WHERE bucket IN ('available','reserved','debt')"
        ).fetchall():
            owner, asset, bucket = row["owner"], row["asset"], row["bucket"]
            if bucket == "debt":
                cached = self.db.execute(
                    "SELECT amount FROM wallet_debts WHERE user_id=? AND asset=?",
                    (owner, asset),
                ).fetchone()
                value = D(cached[0]) if cached else D(0)
                if self.bucket(owner, asset, bucket) != value:
                    raise self.error(
                        "ACCOUNTING_MISMATCH", "Отсутствует проекция долга", 503
                    )
            else:
                cached = self.db.execute(
                    "SELECT available,reserved FROM wallet_balances WHERE user_id=? AND asset=?",
                    (owner, asset),
                ).fetchone()
                self.check(
                    owner,
                    asset,
                    D(cached[0]) if cached else D(0),
                    D(cached[1]) if cached else D(0),
                )
        return True
