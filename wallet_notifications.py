"""Durable, deduplicated Telegram notifications for WPay users."""

import asyncio
import html
import json
import re
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


TEMPLATE_DEFAULT = {"title": "{title}", "message": "{message}", "button_text": "Открыть WPay"}
TEMPLATE_LIMITS = {"title": 200, "message": 3500, "button_text": 64}
NOTIFICATION_TEXTS = {
    "deposit": ("Пополнение зачислено", "На баланс{network_suffix} зачислено {amount} {asset}."),
    "withdrawal.aura": ("Вывод средств", "Статус вывода: {status}.{amount_suffix}"),
    "withdrawal.goswap": ("Вывод средств", "Статус вывода {amount} {asset}: {status}."),
    "kyc.pending": ("Верификация обновлена", "Документы приняты, проверка продолжается."),
    "kyc.verified": ("Верификация пройдена", "Личность подтверждена. Теперь доступны функции, требующие KYC."),
    "kyc.rejected": ("Верификация обновлена", "Проверка отклонена. Откройте WPay, чтобы посмотреть статус и повторить действие."),
    "card.status": ("Обновление карты", "Статус карты изменён: {status}."),
    "card.opened": ("Обновление карты", "Карта выпущена и появилась в WPay."),
    "card.failed": ("Обновление карты", "Выпустить карту не удалось. Средства будут обработаны по статусу заявки."),
    "card.cancelled": ("Обновление карты", "Карта закрыта."),
    "card.delivery": ("Обновление карты", "Статус доставки физической карты: {delivery_status}."),
    "card.frozen": ("Обновление карты", "Карта заморожена."),
    "card_operation": ("Операция по карте", "{operation_name}: {amount} USDT. Статус: {status}.{merchant_suffix}"),
    "card_otp": ("Код 3DS для карты", "{code}\n\nКод действует две минуты с момента получения."),
    "sbp": ("Покупка через СБП", "Статус покупки через СБП: {status}.{amount_suffix}"),
    "qr.aura": ("Оплата по QR", "Статус оплаты QR: {status}.{amount_suffix}"),
    "qr.goswap": ("Оплата по QR", "Статус оплаты: {status}."),
}
TEMPLATE_TOKEN = re.compile(r"\{([a-z_]+)\}")


def render_template(template, title, message, variables=None):
    values = {"title": str(title), "message": str(message), **(variables or {})}
    return TEMPLATE_TOKEN.sub(lambda token: values.get(token[1], ""), template)


def save_template(ledger, event_type, template, actor):
    if event_type not in NOTIFICATION_TEXTS and event_type not in DEFAULT_EVENTS:
        raise ValueError("Неизвестное событие уведомлений")
    if template is None:
        ledger.db.execute("DELETE FROM notification_templates WHERE event_type=?", (event_type,))
        return
    if not isinstance(template, dict) or template.keys() != TEMPLATE_DEFAULT.keys():
        raise ValueError("Некорректный шаблон уведомления")
    allowed = {"{title}", "{message}"} | {token[0] for token in TEMPLATE_TOKEN.finditer(NOTIFICATION_TEXTS.get(event_type, ("", ""))[1])}
    if event_type == "card_otp" and "{code}" in template["title"]:
        raise ValueError("Код можно вставить только в текст сообщения")
    for field, limit in TEMPLATE_LIMITS.items():
        value = template[field]
        if not isinstance(value, str) or len(value) > limit or (field != "button_text" and not value.strip()):
            raise ValueError("Проверьте текст и длину полей шаблона")
        if any(token not in allowed for token in re.findall(r"\{[^{}]+\}", value)):
            raise ValueError("В шаблоне есть неизвестная переменная")
        if field == "button_text" and TEMPLATE_TOKEN.search(value):
            raise ValueError("Текст кнопки задаётся без переменных")
    if event_type == "card_otp" and sum(template["message"].count(token) for token in ("{message}", "{code}")) != 1:
        raise ValueError("Добавьте {code} или {message}, чтобы сохранить код 3DS")
    ledger.db.execute(
        "INSERT INTO notification_templates VALUES (?,?,?,?) ON CONFLICT(event_type) "
        "DO UPDATE SET template=excluded.template,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
        (event_type, json.dumps(template, ensure_ascii=False), time.time(), actor),
    )


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
        CREATE TABLE IF NOT EXISTS notification_templates (
          event_type TEXT PRIMARY KEY, template TEXT NOT NULL,
          updated_at REAL NOT NULL, updated_by TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS notification_outbox_pending
          ON notification_outbox(status,next_attempt_at,created_at);
        CREATE INDEX IF NOT EXISTS notification_outbox_user
          ON notification_outbox(user_id,created_at);
        """
    )
    if "otp_body_template" not in {row[1] for row in ledger.db.execute("PRAGMA table_info(notification_outbox)")}:
        ledger.db.execute("ALTER TABLE notification_outbox ADD COLUMN otp_body_template TEXT")
    stamp = time.time()
    ledger.db.executemany(
        "INSERT OR IGNORE INTO notification_settings VALUES (?,?,?,?,?)",
        [(key, label, int(enabled), stamp, "system")
         for key, (label, enabled) in DEFAULT_EVENTS.items()],
    )


def enqueue(ledger, source_key, user_id, event_type, title, message,
            button_text="Открыть WPay", button_url=None, *, variables=None, variant=None):
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
    custom = ledger.db.execute(
        "SELECT template FROM notification_templates WHERE event_type IN (?,?) "
        "ORDER BY event_type=? DESC LIMIT 1", (event_type, variant, variant)
    ).fetchone()
    otp_body_template = None
    if custom:
        template = json.loads(custom[0])
        original_title = title
        title = render_template(template["title"], title, message, variables)
        button_text = template["button_text"]
        if event_type == "card_otp":
            # Freeze the template with the queued row without persisting the code.
            otp_body_template = re.sub(r"\{title\}", lambda _: str(original_title), template["message"])
            if "{code}" not in otp_body_template:
                message = render_template(otp_body_template, original_title, message)
        else:
            message = render_template(template["message"], original_title, message, variables)
    stamp = time.time()
    cursor = ledger.db.execute(
        "INSERT OR IGNORE INTO notification_outbox "
        "(notification_id,source_key,user_id,event_type,title,message,button_text,button_url,"
        "status,attempts,next_attempt_at,created_at,updated_at,otp_body_template) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("notice-" + uuid.uuid4().hex, str(source_key)[:300], str(user_id), event_type,
         str(title)[:200], str(message)[:3500], str(button_text)[:64] if button_text else None,
         str(button_url)[:2048] if button_url else None, "queued", 0, 0, stamp, stamp, otp_body_template),
    )
    return cursor.rowcount > 0


def snapshot(ledger):
    counts = {row["status"]: row["count"] for row in ledger.db.execute(
        "SELECT status,COUNT(*) AS count FROM notification_outbox GROUP BY status"
    )}
    settings = [dict(row) for row in ledger.db.execute(
        "SELECT event_type,label,enabled,updated_at,updated_by FROM notification_settings ORDER BY rowid"
    )]
    templates = {
        row[0]: json.loads(row[1])
        for row in ledger.db.execute("SELECT event_type,template FROM notification_templates")
    }
    for setting in settings:
        event_type = setting["event_type"]
        setting["template"] = templates.get(event_type)
        setting["variants"] = [
            {"key": key, "default": {"title": title, "message": message,
                                     "button_text": TEMPLATE_DEFAULT["button_text"]},
             "template": templates.get(key), "inherited": key != event_type and key not in templates and event_type in templates}
            for key, (title, message) in NOTIFICATION_TEXTS.items()
            if key.split(".", 1)[0] == event_type
        ]
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
                        actual = f"<code>{html.escape(code)}</code>\n\nКод действует две минуты с момента получения."
                        template = row["otp_body_template"]
                        if template and "{code}" in template:
                            message = html.escape(template).replace("{code}", f"<code>{html.escape(code)}</code>")
                        else:
                            message = html.escape(template).replace("{message}", actual) if template else actual
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
