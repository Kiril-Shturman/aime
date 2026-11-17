"""Durable, deduplicated Telegram notifications for WPay users."""

import asyncio
import html
import json
import time
import uuid

from aiohttp import ClientSession, ClientTimeout


DEFAULT_EVENTS = {
    "deposit": ("Пополнения", True),
    "withdrawal": ("Выводы", True),
    "kyc": ("Верификация", True),
    "card": ("Карты", True),
    "card_operation": ("Операции по картам", True),
    "card_otp": ("Коды 3DS", True),
    "sbp": ("СБП", True),
    "qr": ("Оплата QR", True),
}


def prepare(ledger):
    ledger.db.executescript(
        """
        CREATE TABLE IF NOT EXISTS notification_settings (
          event_type TEXT PRIMARY KEY, label TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1, updated_at REAL NOT NULL,
          updated_by TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS notification_outbox (
          notification_id TEXT PRIMARY KEY, source_key TEXT UNIQUE NOT NULL,
          user_id TEXT NOT NULL, event_type TEXT NOT NULL, title TEXT NOT NULL,
          message TEXT NOT NULL, button_text TEXT, button_url TEXT,
          status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
          next_attempt_at REAL NOT NULL DEFAULT 0, last_error TEXT,
          created_at REAL NOT NULL, sent_at REAL, updated_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS notification_outbox_pending
          ON notification_outbox(status,next_attempt_at,created_at);
        CREATE INDEX IF NOT EXISTS notification_outbox_user
          ON notification_outbox(user_id,created_at);
        """
    )
    stamp = time.time()
    ledger.db.executemany(
        "INSERT OR IGNORE INTO notification_settings VALUES (?,?,?,?,?)",
        [(key, label, int(enabled), stamp, "system")
         for key, (label, enabled) in DEFAULT_EVENTS.items()],
    )


def enqueue(ledger, source_key, user_id, event_type, title, message,
            button_text="Открыть WPay", button_url=None):
    """Queue in the caller's current transaction; source_key makes retries harmless."""
    if not user_id or not str(user_id).startswith("tg:"):
        return False
    if event_type not in DEFAULT_EVENTS:
        raise ValueError("Unknown notification event type")
    setting = ledger.db.execute(
        "SELECT enabled FROM notification_settings WHERE event_type=?", (event_type,)
    ).fetchone()
    if setting and not setting[0]:
        return False
    stamp = time.time()
    cursor = ledger.db.execute(
        "INSERT OR IGNORE INTO notification_outbox "
        "(notification_id,source_key,user_id,event_type,title,message,button_text,button_url,"
        "status,attempts,next_attempt_at,created_at,updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("notice-" + uuid.uuid4().hex, str(source_key)[:300], str(user_id), event_type,
         str(title)[:200], str(message)[:3500], str(button_text)[:64] if button_text else None,
         str(button_url)[:2048] if button_url else None, "queued", 0, 0, stamp, stamp),
    )
    return cursor.rowcount > 0


def snapshot(ledger):
    counts = {row["status"]: row["count"] for row in ledger.db.execute(
        "SELECT status,COUNT(*) AS count FROM notification_outbox GROUP BY status"
    )}
    settings = [dict(row) for row in ledger.db.execute(
        "SELECT event_type,label,enabled,updated_at,updated_by FROM notification_settings ORDER BY rowid"
    )]
    recent = [dict(row) for row in ledger.db.execute(
        "SELECT notification_id,user_id,event_type,title,message,status,attempts,last_error,"
        "created_at,sent_at,updated_at FROM notification_outbox ORDER BY created_at DESC LIMIT 100"
    )]
    eligible = ledger.db.execute(
        "SELECT COUNT(*) FROM wallet_accounts WHERE user_id LIKE 'tg:%' "
        "AND bot_started_at IS NOT NULL AND bot_blocked_at IS NULL AND status='active'"
    ).fetchone()[0]
    return {"settings": settings, "counts": counts, "recent": recent, "eligible_users": eligible}


class NotificationWorker:
    def __init__(self, ledger, bot_token, app_url, interval=2, *, otp_lookup=None):
        self.ledger = ledger
        self.bot_token = bot_token
        self.app_url = app_url
        self.interval = interval
        self.otp_lookup = otp_lookup

    async def deliver_once(self, limit=25):
        if not self.bot_token:
            return 0
        rows = self.ledger.db.execute(
            "SELECT * FROM notification_outbox WHERE status IN ('queued','retry') "
            "AND next_attempt_at<=? ORDER BY created_at LIMIT ?", (time.time(), limit)
        ).fetchall()
        if not rows:
            return 0
        delivered = 0
        async with ClientSession(timeout=ClientTimeout(total=15)) as session:
            for row in rows:
                account = self.ledger.db.execute(
                    "SELECT bot_started_at,bot_blocked_at,status FROM wallet_accounts WHERE user_id=?",
                    (row["user_id"],),
                ).fetchone()
                if not account or not account["bot_started_at"] or account["bot_blocked_at"] or account["status"] != "active":
                    self.ledger.db.execute(
                        "UPDATE notification_outbox SET status='skipped',last_error=?,updated_at=? WHERE notification_id=?",
                        ("BOT_NOT_AVAILABLE", time.time(), row["notification_id"]),
                    )
                    continue
                message = html.escape(row["message"])
                is_otp = row["event_type"] == "card_otp"
                if is_otp and self.otp_lookup:
                    try:
                        code = await self.otp_lookup(row)
                    except Exception:
                        code = None
                    if code:
                        message = f"<code>{html.escape(code)}</code>\n\nКод действует две минуты с момента получения."
                payload = {
                    "chat_id": int(row["user_id"].removeprefix("tg:")),
                    "text": f"<b>{html.escape(row['title'])}</b>\n\n{message}",
                    "parse_mode": "HTML", "disable_web_page_preview": True,
                }
                url = row["button_url"] or self.app_url
                if row["button_text"] and url:
                    payload["reply_markup"] = {"inline_keyboard": [[{
                        "text": row["button_text"], "web_app": {"url": url}
                    }]]}
                error = None
                blocked = False
                try:
                    async with session.post(
                        f"https://api.telegram.org/bot{self.bot_token}/sendMessage", json=payload
                    ) as response:
                        body = await response.json(content_type=None)
                        if response.status >= 400 or not body.get("ok"):
                            error = str(body.get("description") or "Telegram error")[:300]
                            blocked = response.status == 403
                except (asyncio.TimeoutError, OSError, ValueError) as reason:
                    error = str(reason)[:300]
                if error and is_otp:
                    error = "TELEGRAM_3DS_DELIVERY_FAILED"
                stamp = time.time()
                attempts = row["attempts"] + 1
                if error:
                    status = "failed" if blocked or attempts >= 12 else "retry"
                    delay = min(3600, 2 ** min(attempts, 11))
                    self.ledger.db.execute(
                        "UPDATE notification_outbox SET status=?,attempts=?,next_attempt_at=?,last_error=?,updated_at=? WHERE notification_id=?",
                        (status, attempts, stamp + delay, error, stamp, row["notification_id"]),
                    )
                    self.ledger.bot_delivery(row["user_id"], False, blocked)
                else:
                    self.ledger.db.execute(
                        "UPDATE notification_outbox SET status='sent',attempts=?,sent_at=?,last_error=NULL,updated_at=? WHERE notification_id=?",
                        (attempts, stamp, stamp, row["notification_id"]),
                    )
                    self.ledger.bot_delivery(row["user_id"], True)
                    delivered += 1
        return delivered

    async def run(self):
        while True:
            try:
                await self.deliver_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                pass
            await asyncio.sleep(self.interval)
