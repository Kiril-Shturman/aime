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
import json
import os
import sys
import urllib.error
import urllib.request

BOARD = os.environ.get("BOARD_URL", "http://127.0.0.1:8095").rstrip("/")
# личный ключ исполнителя: по нему доска понимает, кто именно пришёл
KEY = os.environ.get("BOARD_KEY", "")
VERSION = "1.0.0"


# ---------------------------------------------------------------- HTTP доски

def call(path, method="GET", body=None):
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
    with urllib.request.urlopen(req, timeout=20) as resp:
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
    lines = [f"Открытых задач: {st['counts']['all']}, на сегодня: {st['counts']['today']}"]
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
            lines.append(f"  участник {m['name']} [{m['id']}]"
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
    doing = [t for t in st["tasks"] if t.get("status") == "doing"]
    if doing:
        lines.append("\nСейчас в работе:")
        for t in doing:
            lines.append(f"  {t['title']} — {t.get('report') or 'отчёта пока нет'} [id {t['id']}]")
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
    """Записать отчёт и, если работа закончена, закрыть задачу.

    Заодно фиксируем цену работы: коммит, токены, потраченные минуты.
    Время посчитается само, если не передать."""
    body = {"report": args["report"]}
    for key in ("commit", "tokens", "seconds"):
        if args.get(key) is not None:
            body[key] = args[key]
    if args.get("done"):
        body["status"] = "done"
    t = call(f"/api/task/{args['id']}", "PATCH", body)
    return f"{'Закрыто' if t['status'] == 'done' else 'Обновлено'}: {t['title']}"


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
        "description": "Записать отчёт по задаче и при необходимости закрыть её.",
        "inputSchema": {"type": "object", "properties": {
            "id": {"type": "string"},
            "report": {"type": "string", "description": "Что сделано, что осталось, ссылка"},
            "commit": {"type": "string", "description": "Хеш коммита, если работа в коде"},
            "tokens": {"type": "integer", "description": "Сколько токенов ушло на задачу"},
            "seconds": {"type": "integer", "description": "Сколько секунд заняло; можно не слать"},
            "done": {"type": "boolean", "description": "true — закрыть задачу"}},
            "required": ["id", "report"]},
        "run": tool_report,
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
]


# ---------------------------------------------------------------- MCP stdio

def reply(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle(msg):
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
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
