#!/usr/bin/env python3
"""Коннектор доски задач для агента: MCP-сервер поверх stdio.

Даёт агенту ровно те действия, из которых складывается цикл:
посмотреть состояние, взять задачу в работу, отчитаться, завести новую,
двинуть этап роудмапа. Ничего лишнего — чем меньше ручек, тем меньше
шансов, что агент запутается.

Протокол простой (JSON-RPC построчно), поэтому обходимся стандартной
библиотекой: на сервере с гигабайтом памяти лишние зависимости ни к чему.

Запуск: python3 mcp_board.py    (адрес доски — в BOARD_URL)
"""
import base64
import json
import os
import time
import sys
import urllib.error
import urllib.parse
import urllib.request

BOARD = os.environ.get("BOARD_URL", "http://127.0.0.1:8095").rstrip("/")
# личный ключ исполнителя: по нему доска понимает, кто именно пришёл
KEY = os.environ.get("BOARD_KEY", "")
VERSION = "1.1.0"


# ---------------------------------------------------------------- HTTP доски

def call(path, method="GET", body=None, timeout=20):
    req = urllib.request.Request(
        BOARD + path,
        data=json.dumps(body).encode() if body is not None else None,
        # помечаемся, чтобы доска не будила агента на его же записи
        headers={
            "Content-Type": "application/json",
            # помечаемся, чтобы доска не будила агента на его же записи
            "X-Actor": "agent",
            **({"X-Board-Key": KEY} if KEY else {}),
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def state():
    return call("/api/state")


_me = {}


def me():
    """Свой id на доске, если ключ выдан. Без ключа работаем как раньше."""
    if not _me:
        try:
            _me.update(call("/api/whoami").get("who") or {"kind": "anon"})
        except (urllib.error.URLError, urllib.error.HTTPError):
            _me.update({"kind": "anon"})
    return _me


def find_member(st, name_or_id):
    """Участник по id, имени или нику — в любом проекте."""
    key = (name_or_id or "").strip().lower().lstrip("@")
    if not key:
        return None
    for p in st["projects"]:
        for m in p["members"]:
            if (m["id"] == name_or_id
                    or m["name"].lower() == key
                    or (m.get("handle") or "").lower().lstrip("@") == key):
                return m
    return None


def find_project(st, name_or_id):
    key = (name_or_id or "").strip().lower()
    for p in st["projects"]:
        if p["id"] == name_or_id or p["name"].lower() == key:
            return p
    return None


def find_stage(project, name_or_id):
    key = (name_or_id or "").strip().lower()
    for stage in project.get("roadmap", []):
        if stage["id"] == name_or_id or stage["title"].lower() == key:
            return stage
    return None


# ---------------------------------------------------------------- действия

def tool_overview(args):
    """Сводка: что горит, какие этапы в работе, чем занят агент."""
    st = state()
    lines = []
    ja = st.get("me") or {}
    # владелец мог позвать: покажем это первой строкой, чтобы не пропустить
    if ja.get("ping"):
        pred = int(time.time()) - int(ja["ping"])
        kdy = f"{pred // 60} мин назад" if pred >= 60 else "только что"
        lines.append(f"⚑ Владелец звал тебя ({kdy}) — посмотри задачи и отзовись отчётом.\n")
    lines.append(f"Открытых задач: {st['counts']['all']}, на сегодня: {st['counts']['today']}")
    for p in st["projects"]:
        if not p["count"] and not p.get("roadmap"):
            continue
        roles = ", ".join(f"{m['name']} — {m['role'] or 'без роли'}" for m in p["members"])
        busy = {}
        for t in st["tasks"]:
            if t.get("member") and not t.get("done") and t["project"] == p["id"]:
                busy[t["member"]] = busy.get(t["member"], 0) + 1
        lines.append(f"\n{p['name']} ({p['count']} открытых){' · ' + roles if roles else ''}")
        for m in p["members"]:
            n = busy.get(m["id"], 0)
            delo = "проверяет работу" if m.get("job") == "check" else "исполнитель"
            lines.append(f"  участник {m['name']} [{m['id']}], {delo}"
                         + (f", открытых задач {n}" if n else ", свободен"))
        if p.get("path"):
            lines.append(f"  исходники: {p['path']}")
        elif p.get("repo"):
            lines.append(f"  репозиторий: {p['repo']} (локальной копии нет — клонируй в ~/projects)")
        for stage in p.get("roadmap", []):
            pr = stage.get("progress") or {}
            mark = {"planned": "запланирован", "active": "в работе", "done": "готово"}[stage["status"]]
            done, total = pr.get("done", 0), pr.get("total", 0)
            lines.append(f"  этап «{stage['title']}» — {mark}, задач {done} из {total}"
                         + (f", срок {stage['date']}" if stage.get("date") else ""))
    muj = (st.get("me") or {}).get("id")
    kontrola = [t for t in st["tasks"] if t.get("status") == "review"]
    moje = [t for t in kontrola if not t.get("checker") or t["checker"] == muj]
    if moje:
        lines.append("\nЖдут твоей проверки (board_to_check → board_review):")
        for t in moje:
            lines.append(f"  {t['title']} [id {t['id']}]"
                         + (f" — {t.get('url')}" if t.get("url") else ""))
    vrat = [t for t in st["tasks"]
            if (t.get("check") or {}).get("status") == "fail" and t.get("member") == muj]
    if vrat:
        lines.append("\nВернули на доработку:")
        for t in vrat:
            lines.append(f"  {t['title']} — {(t.get('check') or {}).get('why', '')} [id {t['id']}]")
    doing = [t for t in st["tasks"] if t.get("status") in ("doing", "review", "blocked")]
    if doing:
        lines.append("\nСейчас в работе:")
        for t in doing:
            label = {"doing": "в работе", "review": "на проверке", "blocked": "заблокирована"}[t["status"]]
            lines.append(f"  {t['title']} ({label}) — {t.get('report') or 'отчёта пока нет'} [id {t['id']}]")
    return "\n".join(lines)


def tool_next_task(args):
    """Следующая незанятая задача: сначала из активных этапов, потом по флажку."""
    st = state()
    project = find_project(st, args.get("project")) if args.get("project") else None
    active_stages = {s["id"] for p in st["projects"] for s in p.get("roadmap", [])
                     if s["status"] == "active" and (not project or p["id"] == project["id"])}

    def rank(t):
        return (
            0 if t.get("member") else 1,      # назначенное мне важнее ничейного
            0 if t.get("stage") in active_stages else 1,
            0 if t.get("flagged") else 1,
            t.get("due") or "9999-99-99",
        )

    mine = me().get("id") if me().get("kind") == "member" else None
    free = [t for t in st["tasks"]
            if t.get("status") == "todo"
            and (not project or t["project"] == project["id"])
            and t.get("stage") in active_stages
            # чужое не трогаем: задача либо ничья, либо назначена мне
            and (not t.get("member") or t["member"] == mine)]
    if not free:
        return "Свободных задач нет — можно ничего не делать."
    t = sorted(free, key=rank)[0]
    p = next((x for x in st["projects"] if x["id"] == t["project"]), None)
    stage = find_stage(p, t.get("stage")) if p and t.get("stage") else None
    return json.dumps({
        "id": t["id"],
        "title": t["title"],
        "note": t.get("note"),
        "project": p["name"] if p else None,
        "stage": stage["title"] if stage else None,
        "due": t.get("due"),
        "flagged": t.get("flagged"),
    }, ensure_ascii=False, indent=1)


def tool_take(args):
    """Взять задачу в работу, чтобы второй проход её не подобрал."""
    t = call(f"/api/task/{args['id']}", "PATCH", {"status": "doing"})
    return f"Взято в работу: {t['title']}"


def tool_report(args):
    """Записать отчёт и, если работа закончена, сдать её на проверку.

    Заодно фиксируем цену работы: коммит, токены, потраченные минуты.
    Время посчитается само, если не передать."""
    body = {"report": args["report"]}
    for key in ("commit", "tokens", "seconds"):
        if args.get(key) is not None:
            body[key] = args[key]
    if args.get("done"):
        t = call(f"/api/task/{args['id']}/submit", "POST", body)
        return f"Отправлено на проверку (попытка {t['attempts']}): {t['title']}"
    t = call(f"/api/task/{args['id']}", "PATCH", body)
    return f"Обновлено: {t['title']}"


def tool_return(args):
    """Вернуть незавершённую задачу в очередь с честным объяснением."""
    t = call(f"/api/task/{args['id']}/return", "POST", {"report": args["report"]})
    if t["status"] == "blocked":
        return f"Заблокировано после лимита попыток: {t['title']}"
    return f"Возвращено в очередь (попытка {t['attempts']}): {t['title']}"


def tool_next_review(args):
    """Следующая сданная задача для независимой проверки."""
    st = state()
    project = find_project(st, args.get("project")) if args.get("project") else None
    tasks = [t for t in st["tasks"] if t.get("status") == "review"
             and (not project or t["project"] == project["id"])]
    if not tasks:
        return "Задач на проверке нет."
    t = sorted(tasks, key=lambda x: x.get("submitted_at") or 0)[0]
    p = next((x for x in st["projects"] if x["id"] == t["project"]), None)
    return json.dumps({
        "id": t["id"], "title": t["title"], "note": t.get("note"),
        "report": t.get("report"), "commit": t.get("commit"),
        "attempt": t.get("attempts", 1), "max_attempts": t.get("max_attempts", 3),
        "project": p["name"] if p else None, "path": p.get("path") if p else None,
        "repo": p.get("repo") if p else None,
    }, ensure_ascii=False, indent=1)


def tool_review(args):
    """Вердикт по задаче. Скрин — путь к файлу: доска сохранит его у себя
    и покажет владельцу рядом с задачей."""
    prijato = args.get("passed")
    if prijato is None:
        prijato = args.get("ok")
    telo = {"passed": bool(prijato),
            "report": args.get("report") or args.get("why") or ""}
    shot = (args.get("shot") or "").strip()
    if shot:
        if shot.startswith(("http://", "https://")):
            telo["shot"] = shot
        elif os.path.exists(shot):
            with open(shot, "rb") as f:
                telo["shot"] = base64.b64encode(f.read()).decode()
        else:
            return f"Скрин не найден: {shot}"
    t = call(f"/api/task/{args['id']}/review", "POST", telo)
    result = {"done": "Принято", "todo": "Возвращено на повтор",
              "doing": "Возвращено исполнителю",
              "blocked": "Заблокировано после лимита попыток"}[t["status"]]
    return f"{result}: {t['title']}"


def tool_add_task(args):
    st = state()
    p = find_project(st, args.get("project", "")) or (st["projects"][0] if st["projects"] else None)
    if not p:
        return "На доске нет ни одного проекта — задачу некуда класть."
    stage = find_stage(p, args.get("stage")) if args.get("stage") else None
    member = find_member(st, args.get("member"))
    t = call("/api/task", "POST", {
        "title": args["title"],
        "note": args.get("note", ""),
        "project": p["id"],
        "stage": stage["id"] if stage else None,
        "member": member["id"] if member else None,
        "flagged": bool(args.get("flagged")),
        "due": args.get("due"),
    })
    where = f"{p['name']}" + (f" → {stage['title']}" if stage else "")
    who = f", исполнитель {member['name']}" if member else ""
    return f"Добавлено в {where}: {t['title']}{who} [id {t['id']}]"


def tool_set_goal(args):
    """Цель, поставленная человеком словами: заводим активный этап."""
    out = call("/api/goal", "POST", {"text": args["text"], "project": args.get("project")})
    return f"Цель принята: «{out['stage']['title']}» (этап {out['stage']['id']})"


def tool_split_goal(args):
    """Разбор цели на задачи: заводим пачкой, чтобы не дёргать по одной."""
    st = state()
    p = find_project(st, args.get("project", "")) or st["projects"][0]
    stage = find_stage(p, args.get("stage")) if args.get("stage") else None
    items = []
    for item in args["items"]:
        item = {"title": item} if isinstance(item, str) else dict(item)
        # исполнителя можно указать у каждой задачи отдельно
        who = find_member(st, item.pop("member", None))
        if who:
            item["member"] = who["id"]
        items.append(item)
    out = call("/api/tasks", "POST", {
        "project": p["id"],
        "stage": stage["id"] if stage else None,
        "parent": args.get("parent"),
        "member": (find_member(st, args.get("member")) or {}).get("id"),
        "items": items,
    })
    where = p["name"] + (f" → {stage['title']}" if stage else "")
    return f"Заведено задач: {out['created']} в {where}"


def tool_stage_status(args):
    st = state()
    p = find_project(st, args["project"])
    if not p:
        return "Проект не найден"
    stage = find_stage(p, args["stage"])
    if not stage:
        return "Этап не найден"
    call(f"/api/project/{p['id']}/stage/{stage['id']}", "PATCH", {"status": args["status"]})
    return f"Этап «{stage['title']}» теперь {args['status']}"


def tool_add_stage(args):
    """Завести модуль/этап роудмапа — агенту это нужно, чтобы раскладывать
    работу самому, а не ждать, пока владелец нарежет."""
    st = state()
    p = find_project(st, args.get("project")) if args.get("project") else None
    if not p:
        return "Укажи проект: board_overview покажет, какие есть"
    stage = call(f"/api/project/{p['id']}/stage", "POST", {
        "title": args["title"],
        "module": args.get("module") or "",
        "note": args.get("note") or "",
        "date": args.get("date") or None,
        "status": args.get("status") or "planned",
    })
    return f"Этап «{stage['title']}» заведён в проекте {p['name']} [id {stage['id']}]"


def tool_to_check(args):
    """Что ждёт моей проверки: задачи, которые исполнитель сдал."""
    st = state()
    muj = me().get("id")
    jmena = {m["id"]: m["name"] for p in st["projects"] for m in p["members"]}
    cesty = {p["id"]: p for p in st["projects"]}
    rows = []
    for t in st["tasks"]:
        if t.get("status") != "review":
            continue
        if t.get("checker") and muj and t["checker"] != muj:
            continue
        p = cesty.get(t["project"]) or {}
        rows.append({
            "id": t["id"],
            "title": t["title"],
            "project": p.get("name"),
            "path": p.get("path") or "",
            "url": t.get("url") or "",
            "report": t.get("report") or "",
            "author": jmena.get(t.get("member"), ""),
        })
    if not rows:
        return "На проверке ничего нет."
    return json.dumps(rows, ensure_ascii=False, indent=1)


# ------------------------------------------------------------ телеграм-боты
#
# Бот, подключённый к доске токеном, слушается через неё: доска знает токен,
# агент — только имя участника. Так токен не разъезжается по конфигам.

def find_bot(name):
    """Подключённый бот по имени участника, нику или id."""
    bots = call("/api/bots").get("bots", [])
    key = (name or "").strip().lower().lstrip("@")
    if not key:
        return bots[0] if len(bots) == 1 else None
    for b in bots:
        if key in (b["member"], b["title"].lower(), (b.get("username") or "").lower()):
            return b
    return None


def tool_inbox(args):
    """Что владелец написал агенту."""
    r = call(f"/api/agent/inbox?since={int(args.get('since') or 0)}")
    zpravy = r.get("items") or []
    if not zpravy:
        return "Новых сообщений нет."
    return "\n".join(f"[{time.strftime('%H:%M', time.localtime(z['at']))}] владелец: {z['text']}"
                     for z in zpravy)


def tool_say(args):
    """Ответить владельцу в чат доски."""
    text = (args.get("text") or "").strip()
    if not text:
        return "Нечего отправлять."
    call("/api/agent/say", "POST", {"text": text})
    return "Отправлено владельцу."


def tool_wait(args):
    """Ждать вызова с доски. Возвращает управление, когда позвали или вышло время."""
    limit = int(args.get("timeout") or 60)
    r = call(f"/api/agent/wait?timeout={limit}", timeout=limit + 15)
    if r.get("ping"):
        return ("Тебя позвали. Посмотри board_inbox — может, владелец написал, "
                "и доску: board_overview, board_next_task. Ответить можно board_say.")
    return f"Тишина {r.get('waited', limit)} с. Можно подождать ещё раз или заняться своими делами."


def tool_bot_list(_args):
    bots = call("/api/bots").get("bots", [])
    if not bots:
        return ("Ни один бот не подключён. Владелец добавляет их на доске: "
                "участник → «Управление ботом» → токен от @BotFather.")
    return "\n".join(
        f"• {b['title']} @{b.get('username', '')} — {b['project']}"
        + (f", {b['role']}" if b.get("role") else "")
        for b in bots
    )


def tool_bot_send(args):
    bot = find_bot(args.get("bot"))
    if not bot:
        return "Не понял, от какого бота писать. Список — board_bot_list."
    params = {"chat_id": args["chat"], "text": args["text"]}
    if args.get("html"):
        params["parse_mode"] = "HTML"
    out = call(f"/api/bot/{bot['member']}/call", "POST",
               {"method": "sendMessage", "params": params})
    mid = (out.get("result") or {}).get("message_id")
    return f"@{bot.get('username', '')} написал в {args['chat']} (сообщение {mid})"


def tool_bot_call(args):
    bot = find_bot(args.get("bot"))
    if not bot:
        return "Не понял, каким ботом рулить. Список — board_bot_list."
    out = call(f"/api/bot/{bot['member']}/call", "POST",
               {"method": args["method"], "params": args.get("params") or {}})
    return json.dumps(out.get("result"), ensure_ascii=False, indent=2)[:3000]


# ------------------------------------------- личка от имени хозяина аккаунта
#
# Бот боту не пишет — Телеграм запрещает. Поэтому промты другим ботам уходят
# с аккаунта владельца: доска зовёт userbot.py, тот отправляет и ждёт ответ.

def tool_dm_ask(args):
    out = call("/api/dm/ask", "POST", {
        "to": args["to"], "text": args["text"], "wait": args.get("wait", 90)})
    reply = out.get("reply")
    if not reply:
        return out.get("note") or "Ответа не дождались"
    text = reply.get("text") or ""
    if reply.get("media") and not text:
        text = "(прислал файл или картинку — забери из чата)"
    return f"{args['to']} ответил:\n{text[:3000]}"


def tool_dm_send(args):
    out = call("/api/dm/send", "POST", {"to": args["to"], "text": args["text"]})
    return f"Отправлено в {args['to']} (сообщение {out.get('message_id')})"


def tool_dm_read(args):
    peer = args["to"]
    out = call(f"/api/dm?to={urllib.parse.quote(peer)}&n={int(args.get('count', 5))}")
    rows = []
    for m in out.get("messages", []):
        who = "я" if m["mine"] else peer
        rows.append(f"{who}: {(m.get('text') or '').strip()[:400]}")
    return "\n".join(rows) or "Переписка пустая"


TOOLS = [
    {
        "name": "board_overview",
        "description": "Состояние доски: проекты, этапы роудмапа с прогрессом, что сейчас в работе.",
        "inputSchema": {"type": "object", "properties": {}},
        "run": tool_overview,
    },
    {
        "name": "board_next_task",
        "description": "Выдать следующую свободную задачу. Приоритет: активный этап, флажок, срок.",
        "inputSchema": {"type": "object", "properties": {
            "project": {"type": "string", "description": "Название проекта, необязательно"}}},
        "run": tool_next_task,
    },
    {
        "name": "board_take",
        "description": "Взять задачу в работу по её id (статус «в работе»).",
        "inputSchema": {"type": "object", "properties": {
            "id": {"type": "string"}}, "required": ["id"]},
        "run": tool_take,
    },
    {
        "name": "board_report",
        "description": "Записать отчёт; done=true сдаёт результат на независимую проверку, но не закрывает сразу.",
        "inputSchema": {"type": "object", "properties": {
            "id": {"type": "string"},
            "report": {"type": "string", "description": "Что сделано, что осталось, ссылка"},
            "commit": {"type": "string", "description": "Хеш коммита, если работа в коде"},
            "tokens": {"type": "integer", "description": "Сколько токенов ушло на задачу"},
            "seconds": {"type": "integer", "description": "Сколько секунд заняло; можно не слать"},
            "done": {"type": "boolean", "description": "true — сдать задачу на проверку"}},
            "required": ["id", "report"]},
        "run": tool_report,
    },
    {
        "name": "board_next_review",
        "description": "Выдать следующую задачу, которую исполнитель сдал на проверку.",
        "inputSchema": {"type": "object", "properties": {
            "project": {"type": "string", "description": "Название проекта, необязательно"}}},
        "run": tool_next_review,
    },
    {
        "name": "board_return",
        "description": "Вернуть задачу из работы в очередь, если выполнить её сейчас не получилось.",
        "inputSchema": {"type": "object", "properties": {
            "id": {"type": "string"},
            "report": {"type": "string", "description": "Почему задача не завершена и что нужно для следующей попытки"}},
            "required": ["id", "report"]},
        "run": tool_return,
    },
    {
        "name": "board_review",
        "description": ("Записать независимую проверку: принять задачу или вернуть на повтор. "
                        "Если задача про интерфейс — открой страницу, сними скрин "
                        "и приложи его путь в shot."),
        "inputSchema": {"type": "object", "properties": {
            "id": {"type": "string"},
            "passed": {"type": "boolean"},
            "report": {"type": "string", "description": "Что именно проверено и почему результат принят/отклонён"},
            "shot": {"type": "string", "description": "Путь к скриншоту или ссылка на него"}},
            "required": ["id", "passed", "report"]},
        "run": tool_review,
    },
    {
        "name": "board_add_task",
        "description": "Завести задачу в проекте, при желании под этапом роудмапа.",
        "inputSchema": {"type": "object", "properties": {
            "title": {"type": "string"},
            "project": {"type": "string"},
            "stage": {"type": "string"},
            "note": {"type": "string"},
            "due": {"type": "string", "description": "ГГГГ-ММ-ДД"},
            "member": {"type": "string", "description": "Кому поручить: имя, ник или id участника"},
            "flagged": {"type": "boolean"}},
            "required": ["title"]},
        "run": tool_add_task,
    },
    {
        "name": "board_set_goal",
        "description": "Принять цель, сформулированную словами, и завести её активным этапом.",
        "inputSchema": {"type": "object", "properties": {
            "text": {"type": "string", "description": "Первая строка — заголовок, остальное примечание"},
            "project": {"type": "string"}}, "required": ["text"]},
        "run": tool_set_goal,
    },
    {
        "name": "board_split_goal",
        "description": "Разложить цель на конкретные задачи и завести их пачкой под этапом.",
        "inputSchema": {"type": "object", "properties": {
            "project": {"type": "string"},
            "stage": {"type": "string", "description": "Этап-цель, к которому крепим задачи"},
            "parent": {"type": "string", "description": "Родительская задача, если дробим её"},
            "member": {"type": "string", "description": "Кому поручить всю пачку"},
            "items": {"type": "array", "items": {"type": "object", "properties": {
                "title": {"type": "string"}, "note": {"type": "string"},
                "member": {"type": "string", "description": "Исполнитель именно этой задачи"}}}}},
            "required": ["items"]},
        "run": tool_split_goal,
    },
    {
        "name": "board_stage_status",
        "description": "Сменить статус этапа роудмапа: planned, active или done.",
        "inputSchema": {"type": "object", "properties": {
            "project": {"type": "string"},
            "stage": {"type": "string"},
            "status": {"type": "string", "enum": ["planned", "active", "done"]}},
            "required": ["project", "stage", "status"]},
        "run": tool_stage_status,
    },
    {
        "name": "board_add_stage",
        "description": "Завести модуль (этап роудмапа) в проекте.",
        "inputSchema": {"type": "object", "properties": {
            "project": {"type": "string"},
            "title": {"type": "string", "description": "Название модуля/этапа"},
            "module": {"type": "string", "description": "К какому модулю относится, если дробишь"},
            "note": {"type": "string"},
            "date": {"type": "string", "description": "Срок, ГГГГ-ММ-ДД"},
            "status": {"type": "string", "enum": ["planned", "active", "done"]}},
            "required": ["project", "title"]},
        "run": tool_add_stage,
    },
    {
        "name": "board_to_check",
        "description": "Задачи, сданные исполнителем и ждущие твоей проверки.",
        "inputSchema": {"type": "object", "properties": {}},
        "run": tool_to_check,
    },
    {
        "name": "board_inbox",
        "description": "Прочитать, что владелец написал в чате доски.",
        "inputSchema": {"type": "object", "properties": {
            "since": {"type": "integer", "description": "показывать сообщения новее этого времени"}}},
        "run": tool_inbox,
    },
    {
        "name": "board_say",
        "description": "Ответить владельцу в чат доски: что сделал, что нужно, чем занят.",
        "inputSchema": {"type": "object", "properties": {
            "text": {"type": "string"}}, "required": ["text"]},
        "run": tool_say,
    },
    {
        "name": "board_wait",
        "description": "Подождать вызова с доски: зависаем на минуту и просыпаемся, когда владелец позвал.",
        "inputSchema": {"type": "object", "properties": {
            "timeout": {"type": "integer", "description": "сколько секунд ждать, по умолчанию 60"}}},
        "run": tool_wait,
    },
    {
        "name": "board_bot_list",
        "description": "Какими телеграм-ботами доска умеет управлять прямо сейчас.",
        "inputSchema": {"type": "object", "properties": {}},
        "run": tool_bot_list,
    },
    {
        "name": "board_bot_send",
        "description": "Написать сообщение от имени подключённого бота.",
        "inputSchema": {"type": "object", "properties": {
            "bot": {"type": "string", "description": "Имя участника, ник бота или id; можно опустить, если бот один"},
            "chat": {"type": "string", "description": "id чата или @канал"},
            "text": {"type": "string"},
            "html": {"type": "boolean", "description": "Разметка HTML"}},
            "required": ["chat", "text"]},
        "run": tool_bot_send,
    },
    {
        "name": "board_bot_call",
        "description": ("Любой метод Bot API от имени подключённого бота: setMyCommands, "
                        "sendPhoto, setChatMenuButton и прочее. Входящие не читаем — "
                        "getUpdates и вебхуки доска не отдаёт."),
        "inputSchema": {"type": "object", "properties": {
            "bot": {"type": "string"},
            "method": {"type": "string", "description": "Например sendPhoto"},
            "params": {"type": "object", "description": "Поля метода как в документации Bot API"}},
            "required": ["method"]},
        "run": tool_bot_call,
    },
    {
        "name": "board_dm_ask",
        "description": ("Написать другому боту в личку от имени владельца и дождаться "
                        "ответа. Так агент пользуется чужими ботами: бот боту писать "
                        "не может, а аккаунт может."),
        "inputSchema": {"type": "object", "properties": {
            "to": {"type": "string", "description": "@ник бота или id чата"},
            "text": {"type": "string", "description": "Промт целиком"},
            "wait": {"type": "integer", "description": "Сколько секунд ждать ответ, по умолчанию 90"}},
            "required": ["to", "text"]},
        "run": tool_dm_ask,
    },
    {
        "name": "board_dm_send",
        "description": "Просто отправить сообщение в личку от имени владельца, не ожидая ответа.",
        "inputSchema": {"type": "object", "properties": {
            "to": {"type": "string"}, "text": {"type": "string"}},
            "required": ["to", "text"]},
        "run": tool_dm_send,
    },
    {
        "name": "board_dm_read",
        "description": "Последние сообщения переписки владельца с ботом или человеком.",
        "inputSchema": {"type": "object", "properties": {
            "to": {"type": "string"},
            "count": {"type": "integer", "description": "Сколько сообщений, по умолчанию 5"}},
            "required": ["to"]},
        "run": tool_dm_read,
    },
]


# ---------------------------------------------------------------- MCP stdio

def reply(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle(msg):
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
        # представляемся доске: кто подключился и какой моделью работает —
        # владелец увидит это в карточке участника
        klient = msg.get("params", {}).get("clientInfo", {}) or {}
        try:
            call("/api/agent/hello", "POST", {
                "client": " ".join(x for x in (klient.get("name"), klient.get("version")) if x)
                or os.environ.get("BOARD_CLIENT", ""),
                "model": os.environ.get("BOARD_MODEL", ""),
                # BOARD_AVATAR — ссылка на картинку агента, если она есть
                "avatar": os.environ.get("BOARD_AVATAR", ""),
                # BOARD_HOOK — адрес, по которому доска может разбудить агента
                "hook": os.environ.get("BOARD_HOOK", ""),
                # BOARD_ACCOUNT / BOARD_PLAN / BOARD_PLAN_UNTIL — что показать в карточке
                "account": os.environ.get("BOARD_ACCOUNT", ""),
                "plan": os.environ.get("BOARD_PLAN", ""),
                "plan_until": os.environ.get("BOARD_PLAN_UNTIL", ""),
            })
        except Exception:
            pass  # не смогли представиться — работать это не мешает
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": msg.get("params", {}).get("protocolVersion", "2024-11-05"),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "board", "version": VERSION},
        }}
    if method in ("notifications/initialized", "notifications/cancelled"):
        return None
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "tools": [{k: t[k] for k in ("name", "description", "inputSchema")} for t in TOOLS]}}
    if method == "tools/call":
        params = msg.get("params", {})
        tool = next((t for t in TOOLS if t["name"] == params.get("name")), None)
        if not tool:
            return {"jsonrpc": "2.0", "id": mid,
                    "error": {"code": -32601, "message": "Нет такого инструмента"}}
        try:
            text = tool["run"](params.get("arguments") or {})
            is_error = False
        except urllib.error.HTTPError as exc:
            text, is_error = f"Доска ответила {exc.code}: {exc.reason}", True
        except Exception as exc:  # сеть отвалилась, доска не поднята и т.п.
            text, is_error = f"Не получилось: {exc}", True
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "content": [{"type": "text", "text": text}], "isError": is_error}}
    if mid is None:
        return None
    return {"jsonrpc": "2.0", "id": mid,
            "error": {"code": -32601, "message": f"Метод {method} не поддержан"}}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        out = handle(msg)
        if out is not None:
            reply(out)


if __name__ == "__main__":
    main()
