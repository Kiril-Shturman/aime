"""Restart-safe read-only provider reconciliation; never replays monetary POSTs."""

import asyncio
import json
import os
import time
import uuid
from wallet_inbox import fetch_pages, apply_pages, process as process_inbox
from wallet_user_ops import sync_invoices, sync_transfers
from wallet_withdrawals import reconcile as sync_withdrawals
from wallet_finance import coverage


def prepare(ledger):
    ledger.db.executescript(
        """
      CREATE TABLE IF NOT EXISTS finance_worker_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS finance_worker_lease (id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_deposit_sync_cursor (user_id TEXT PRIMARY KEY,offset INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_deposit_requests (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,network TEXT NOT NULL,body TEXT NOT NULL,created_at REAL NOT NULL);
    """
    )


class Worker:
    def __init__(self, ledger, provider, money, error):
        self.ledger, self.provider, self.money, self.error, self.owner = (
            ledger,
            provider,
            money,
            error,
            uuid.uuid4().hex,
        )

    def state(self, key, value):
        self.ledger.db.execute(
            "INSERT OR REPLACE INTO finance_worker_state VALUES (?,?)",
            (key, str(value)),
        )

    async def step(self):
        ledger = self.ledger
        ledger.begin("worker_lease", "worker", "Acquire reconciliation lease")
        try:
            lease = ledger.db.execute(
                "SELECT * FROM finance_worker_lease WHERE id=1"
            ).fetchone()
            if (
                lease
                and lease["owner"] != self.owner
                and lease["expires_at"] > time.time()
            ):
                ledger.commit()
                return False
            ledger.db.execute(
                "INSERT OR REPLACE INTO finance_worker_lease VALUES (1,?,?)",
                (self.owner, time.time() + 300),
            )
            ledger.commit()
        except Exception:
            ledger.rollback()
            raise
        try:
            await sync_invoices(ledger, self.provider)
            await sync_transfers(ledger, self.provider, self.money, self.error)
            await sync_withdrawals(ledger, self.provider, self.money, self.error)
            quotes = ledger.db.execute(
                "SELECT spend_id FROM wallet_quotes WHERE state IN ('reserved','processing','completed')"
            ).fetchall()
            for start in range(0, len(quotes), 100):
                ids = {row["spend_id"] for row in quotes[start : start + 100]}
                result = await self.provider.call(
                    "getQrPayments", {"spend_ids": ",".join(sorted(ids)), "count": 100}
                )
                for item in result.get("items", []):
                    if item.get("spend_id") in ids:
                        ledger.payment(item)
            last = ledger.db.execute(
                "SELECT value FROM finance_worker_state WHERE key='last_client'"
            ).fetchone()
            clients = ledger.db.execute(
                "SELECT user_id,client_ref FROM wallet_accounts a WHERE user_id>? AND (EXISTS(SELECT 1 FROM wallet_addresses d WHERE d.user_id=a.user_id) OR EXISTS(SELECT 1 FROM wallet_deposit_requests r WHERE r.user_id=a.user_id)) ORDER BY user_id LIMIT 10",
                (last[0] if last else "",),
            ).fetchall()
            if not clients:
                self.state("last_client", "")
            for account in clients:
                progress = ledger.db.execute(
                    "SELECT offset FROM wallet_deposit_sync_cursor WHERE user_id=?",
                    (account["user_id"],),
                ).fetchone()
                offset = progress[0] if progress else 0
                for _ in range(2):
                    result = await self.provider.call(
                        "getDeposits",
                        {
                            "client_ref": account["client_ref"],
                            "count": 1000,
                            "offset": offset,
                        },
                    )
                    rows = result.get("items", [])
                    ledger.begin("deposit_poll", "worker", "Recover client deposits")
                    try:
                        for item in rows:
                            if item.get("client_ref") == account["client_ref"]:
                                ledger.deposit(item)
                        offset = offset + 1000 if rows else 0
                        ledger.db.execute(
                            "INSERT OR REPLACE INTO wallet_deposit_sync_cursor VALUES (?,?)",
                            (account["user_id"], offset),
                        )
                        ledger.commit()
                    except Exception:
                        ledger.rollback()
                        raise
                    if not rows:
                        break
                self.state("last_client", account["user_id"])
            pages = await fetch_pages(ledger, self.provider, self.error)
            apply_pages(ledger, pages, self.money, self.error)
            inbox = ledger.db.execute(
                "SELECT * FROM wallet_webhook_inbox WHERE processed_at IS NULL AND signature_valid=1 AND origin='webhook' AND next_attempt_at<=? ORDER BY id LIMIT 100",
                (time.time(),),
            ).fetchall()
            for row in inbox:
                try:
                    await process_inbox(
                        ledger, self.provider, row, self.money, self.error
                    )
                except Exception:
                    pass  # Durable error/backoff is stored by the inbox processor.
            await coverage(ledger, self.provider, self.error)
            self.state("last_success", time.time())
            self.state("last_error", "")
            return True
        except Exception as error:
            self.state("last_error", str(error)[:1000])
            raise
        finally:
            ledger.db.execute(
                "DELETE FROM finance_worker_lease WHERE owner=?", (self.owner,)
            )

    async def run(self):
        interval = max(1, int(os.environ.get("WPAY_FINANCE_INTERVAL", "30")))
        while True:
            try:
                await self.step()
                delay = interval
            except asyncio.CancelledError:
                raise
            except Exception as error:
                try:
                    delay = max(interval, int(getattr(error, "retry_after", 0) or 0))
                except (TypeError, ValueError):
                    delay = interval
            await asyncio.sleep(delay)
