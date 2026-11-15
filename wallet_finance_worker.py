"""Restart-safe read-only provider reconciliation; never replays monetary POSTs."""

import asyncio
import json
import os
import time
import uuid
from wallet_inbox import fetch_pages, apply_pages, process as process_inbox
from wallet_user_ops import sync_invoices, sync_transfers, apply_transfer
from wallet_withdrawals import reconcile as sync_withdrawals
from wallet_finance import coverage


def prepare(ledger):
    ledger.db.executescript(
        """
      CREATE TABLE IF NOT EXISTS wallet_poll_schedule (kind TEXT NOT NULL,entity TEXT NOT NULL,next_at REAL NOT NULL,PRIMARY KEY(kind,entity));
      CREATE TABLE IF NOT EXISTS finance_worker_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS finance_worker_lease (id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,expires_at REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_deposit_sync_cursor (user_id TEXT PRIMARY KEY,offset INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS wallet_deposit_requests (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,network TEXT NOT NULL,body TEXT NOT NULL,created_at REAL NOT NULL);
    """
    )


class BudgetExhausted(Exception):
    pass


class BudgetProvider:
    """Cycle quota plus durable per-method backoff. No financial POSTs allowed."""

    def __init__(self, worker):
        self.worker = worker
        self.total = 0
        self.counts = {}

    async def call(self, method, data=None, post=False):
        if post:
            raise RuntimeError("Worker cannot submit POSTs")
        worker = self.worker
        row = worker.ledger.db.execute(
            "SELECT value FROM finance_worker_state WHERE key=?", ("backoff:" + method,)
        ).fetchone()
        if (
            self.total >= 24
            or self.counts.get(method, 0) >= 4
            or (row and float(row[0]) > time.time())
        ):
            raise BudgetExhausted(method)
        self.total += 1
        self.counts[method] = self.counts.get(method, 0) + 1
        try:
            result = await worker.provider.call(method, data, post=False)
            worker.state("failures:" + method, 0)
            return result
        except Exception as error:
            old = worker.ledger.db.execute(
                "SELECT value FROM finance_worker_state WHERE key=?",
                ("failures:" + method,),
            ).fetchone()
            failures = min(8, int(old[0]) + 1 if old else 1)
            try:
                retry = float(getattr(error, "retry_after", 0) or 0)
            except (TypeError, ValueError):
                retry = 0
            worker.state("failures:" + method, failures)
            worker.state(
                "backoff:" + method,
                time.time() + max(retry, min(3600, 30 * 2**failures)),
            )
            raise


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
            provider = BudgetProvider(self)
            errors = []

            def finish():
                pending = ledger.db.execute(
                    "SELECT error FROM wallet_webhook_inbox WHERE processed_at IS NULL AND signature_valid=1 AND origin='webhook' AND error IS NOT NULL LIMIT 1"
                ).fetchone()
                if pending:
                    errors.append("inbox pending retry: " + pending["error"])
                detail = "; ".join(errors)[:1000]
                self.state("last_cycle_calls", provider.total)
                self.state("last_cycle_errors", detail)
                self.state("last_attempt", time.time())
                self.state("health", "degraded" if errors else "healthy")
                self.state("last_error", detail)
                if not errors:
                    self.state("last_success", time.time())

            async def phase(task, critical=None):
                try:
                    return await task
                except BudgetExhausted as error:
                    if critical:
                        errors.append(
                            critical + ": deferred by budget/backoff " + str(error)
                        )
                    return None
                except Exception as error:
                    errors.append((critical + ": " if critical else "") + str(error))
                    return None

            # Journal, inbox and coverage have priority over bulk status polling.
            pages = await phase(
                fetch_pages(ledger, provider, self.error, max_pages=2),
                critical="journal",
            )
            if pages is not None:
                apply_pages(ledger, pages, self.money, self.error)
            # Terminal transfer changes are signalled by the immutable journal.
            journal = ledger.db.execute(
                "SELECT j.id,j.body FROM wallet_provider_journal j LEFT JOIN finance_provider_effects e ON e.row_id=j.id WHERE e.row_id IS NULL AND json_extract(j.body,'$.type') IN ('transfer','transfer_revoked') AND EXISTS(SELECT 1 FROM wallet_user_transfers t WHERE t.spend_id=json_extract(j.body,'$.details.spend_id')) ORDER BY j.id LIMIT 1000"
            ).fetchall()

            async def journal_transfers():
                entries = {}
                for row in journal:
                    item = json.loads(row["body"])
                    if item.get("type") in {"transfer", "transfer_revoked"}:
                        spend = (item.get("details") or {}).get("spend_id")
                        if (
                            spend
                            and ledger.db.execute(
                                "SELECT 1 FROM wallet_user_transfers WHERE spend_id=?",
                                (spend,),
                            ).fetchone()
                        ):
                            entries.setdefault(spend, []).append(row["id"])
                ids = list(entries)
                for start in range(0, min(len(ids), 200), 100):
                    group = ids[start : start + 100]
                    result = await provider.call(
                        "getTransfers", {"spend_id": ",".join(group), "count": 100}
                    )
                    for item in result.get("items", []):
                        if item.get("spend_id") not in group:
                            continue
                        ledger.begin(
                            "transfer_journal",
                            "provider",
                            "Journal-triggered status refresh",
                        )
                        try:
                            apply_transfer(ledger, item, self.money, self.error)
                            for rid in entries[item["spend_id"]]:
                                ledger.db.execute(
                                    "INSERT OR IGNORE INTO finance_provider_effects VALUES (?,?,?)",
                                    (rid, "transfer_status", time.time()),
                                )
                            ledger.commit()
                        except Exception:
                            ledger.rollback()
                            raise

            await phase(journal_transfers(), critical="transfer journal")
            inbox = ledger.db.execute(
                "SELECT * FROM wallet_webhook_inbox WHERE processed_at IS NULL AND signature_valid=1 AND origin='webhook' AND next_attempt_at<=? ORDER BY id LIMIT 4",
                (time.time(),),
            ).fetchall()
            for row in inbox:
                await phase(
                    process_inbox(ledger, provider, row, self.money, self.error),
                    critical="inbox",
                )
            await phase(coverage(ledger, provider, self.error), critical="coverage")
            await phase(sync_invoices(ledger, provider, background=True))
            # Apply newly owned invoice rows without waiting for the next cycle.
            apply_pages(ledger, [], self.money, self.error)
            await phase(
                sync_transfers(
                    ledger, provider, self.money, self.error, background=True
                )
            )
            await phase(
                sync_withdrawals(
                    ledger, provider, self.money, self.error, background=True
                )
            )
            quotes = ledger.db.execute(
                "SELECT spend_id FROM wallet_quotes WHERE state IN ('reserved','processing','completed') AND spend_id NOT IN (SELECT entity FROM wallet_poll_schedule WHERE kind='qr' AND next_at>?) ORDER BY COALESCE((SELECT next_at FROM wallet_poll_schedule WHERE kind='qr' AND entity=spend_id),0) LIMIT 200",
                (time.time(),),
            ).fetchall()
            for start in range(0, len(quotes), 100):
                ids = {row["spend_id"] for row in quotes[start : start + 100]}
                result = await provider.call(
                    "getQrPayments", {"spend_ids": ",".join(sorted(ids)), "count": 100}
                )
                for item in result.get("items", []):
                    if item.get("spend_id") in ids:
                        ledger.payment(item)
                        delay = 3600 if item.get("status") == "completed" else 60
                        ledger.db.execute(
                            "INSERT OR REPLACE INTO wallet_poll_schedule VALUES ('qr',?,?)",
                            (item["spend_id"], time.time() + delay),
                        )
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
                    result = await provider.call(
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
            finish()
            return True
        except BudgetExhausted:
            finish()
            return True
        except Exception as error:
            self.state("health", "degraded")
            self.state("last_attempt", time.time())
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
