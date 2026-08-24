#!/usr/bin/env python3
"""Личный аккаунт владельца как исполнитель: пишет в лс другим ботам.

Зачем это вообще есть. Бот боту написать не может — Телеграм отвечает
USER_BOT_TO_BOT_DISABLED, и обойти это нечем. Завести разговор с ботом умеет
только живой аккаунт. Поэтому рядом с доской живёт маленький клиент на
Telethon: доска отдаёт ему промт, он отправляет его от имени владельца и
приносит ответ обратно.

Команды:
  python3 userbot.py code +79990000000      — запросить код входа
  python3 userbot.py enter 12345 [пароль]   — ввести код (и пароль двухфакторки)
  python3 userbot.py who                    — кто залогинен
  python3 userbot.py send @bot "текст"
  python3 userbot.py read @bot [сколько]
  python3 userbot.py ask  @bot "текст" [сек]  — написать и дождаться ответа

api_id и api_hash берутся с my.telegram.org и лежат в userbot.env рядом.
Сессия — userbot.session: это доступ к аккаунту, права 600, в гит не ходит.
"""
import json
import os
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
SESSION = os.path.join(ROOT, "userbot.session")
ENV = os.path.join(ROOT, "userbot.env")
PENDING = os.path.join(ROOT, "userbot.pending")


def creds():
    """api_id/api_hash: из окружения или из userbot.env вида КЛЮЧ=значение."""
    data = {}
    if os.path.exists(ENV):
        with open(ENV, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    data[k.strip()] = v.strip()
    api_id = os.environ.get("TG_API_ID") or data.get("TG_API_ID")
    api_hash = os.environ.get("TG_API_HASH") or data.get("TG_API_HASH")
    if not api_id or not api_hash:
        die("нет TG_API_ID/TG_API_HASH — возьми их на my.telegram.org "
            f"и положи в {ENV}")
    return int(api_id), api_hash


def die(text):
    print(json.dumps({"ok": False, "error": text}, ensure_ascii=False))
    sys.exit(1)


def out(**data):
    print(json.dumps({"ok": True, **data}, ensure_ascii=False))


def client():
    try:
        from telethon.sync import TelegramClient
    except ImportError:
        die("не установлен telethon: pip3 install --user telethon")
    api_id, api_hash = creds()
    cl = TelegramClient(SESSION, api_id, api_hash)
    cl.connect()
    if not cl.is_user_authorized():
        die("аккаунт не залогинен: python3 userbot.py login")
    os.chmod(SESSION, 0o600)
    return cl


def fresh_client():
    """Клиент без проверки авторизации — им и логинимся."""
    from telethon.sync import TelegramClient
    api_id, api_hash = creds()
    cl = TelegramClient(SESSION, api_id, api_hash)
    cl.connect()
    return cl


def cmd_code(phone):
    """Шаг первый: попросить Телеграм прислать код."""
    cl = fresh_client()
    sent = cl.send_code_request(phone)
    with open(PENDING, "w", encoding="utf-8") as f:
        json.dump({"phone": phone, "hash": sent.phone_code_hash}, f)
    os.chmod(PENDING, 0o600)
    out(sent=True, note="код ушёл в Телеграм")


def cmd_enter(code, password=None):
    """Шаг второй: ввести код. Пробелы внутри кода не мешают —
    их специально ставят, чтобы Телеграм не аннулировал код, замеченный
    в переписке."""
    from telethon.errors import SessionPasswordNeededError
    if not os.path.exists(PENDING):
        die("сначала запроси код: userbot.py code +7…")
    with open(PENDING, encoding="utf-8") as f:
        pending = json.load(f)
    cl = fresh_client()
    try:
        cl.sign_in(pending["phone"], "".join(ch for ch in code if ch.isdigit()),
                   phone_code_hash=pending["hash"])
    except SessionPasswordNeededError:
        if not password:
            die("включена двухфакторка: userbot.py enter <код> <пароль>")
        cl.sign_in(password=password)
    me = cl.get_me()
    os.chmod(SESSION, 0o600)
    os.remove(PENDING)
    out(id=me.id, name=me.first_name, username=me.username)


def cmd_who():
    cl = client()
    me = cl.get_me()
    out(id=me.id, name=me.first_name, username=me.username)


def cmd_send(peer, text):
    cl = client()
    msg = cl.send_message(peer, text)
    out(peer=peer, message_id=msg.id)


def cmd_read(peer, count=5):
    cl = client()
    items = []
    for m in cl.iter_messages(peer, limit=int(count)):
        items.append({
            "id": m.id,
            "mine": bool(m.out),
            "date": m.date.isoformat() if m.date else None,
            "text": m.message or "",
        })
    out(peer=peer, messages=list(reversed(items)))


def cmd_ask(peer, text, wait=90):
    """Отправить промт и дождаться ответа.

    Боты-нейросети часто дописывают ответ в одно и то же сообщение, поэтому
    сначала ждём появления ответа, а потом — пока он перестанет меняться."""
    cl = client()
    sent = cl.send_message(peer, text)
    deadline = time.time() + float(wait)
    reply, stable_since, last_text = None, None, None

    while time.time() < deadline:
        time.sleep(2)
        fresh = [m for m in cl.iter_messages(peer, min_id=sent.id, limit=10)
                 if not m.out]
        if fresh:
            reply = fresh[0]                       # самый свежий ответ
            if reply.message != last_text:
                last_text, stable_since = reply.message, time.time()
            elif stable_since and time.time() - stable_since >= 4:
                break                              # дописывать перестал
    if not reply:
        out(peer=peer, sent=sent.id, reply=None,
            note=f"за {int(wait)} с ответа не было")
        return
    out(peer=peer, sent=sent.id, reply={
        "id": reply.id,
        "text": reply.message or "",
        "media": bool(reply.media),
    })


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    cmd, rest = args[0], args[1:]
    if cmd == "code" and rest:
        cmd_code(rest[0])
    elif cmd == "enter" and rest:
        cmd_enter(rest[0], rest[1] if len(rest) > 1 else None)
    elif cmd == "who":
        cmd_who()
    elif cmd == "send" and len(rest) >= 2:
        cmd_send(rest[0], rest[1])
    elif cmd == "read" and rest:
        cmd_read(rest[0], rest[1] if len(rest) > 1 else 5)
    elif cmd == "ask" and len(rest) >= 2:
        cmd_ask(rest[0], rest[1], rest[2] if len(rest) > 2 else 90)
    else:
        die("не понял команду, смотри заголовок файла")


if __name__ == "__main__":
    main()
