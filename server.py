"""Задачи в стиле «Напоминаний» Apple — мини-аппа Телеграма.

Структура: проект → участники проекта → задачи. Участник это не обязательно
телеграм-бот: может быть ИИ-агент, сервис или человек, у каждого своя роль.
Задача принадлежит проекту и может быть закреплена за участником.

Хранилище простое: один JSON-файл. Задач тут сотни, не миллионы,
поэтому база была бы лишней сложностью.

API минимальный, чтобы им мог пользоваться агент:
  GET    /api/state                    — всё сразу: сводка, проекты, задачи
  POST   /api/task                     — {title, note, url, project, member, stage, due, time, flagged}
  PATCH  /api/task/<id>                — {title, note, status, member, stage, report, commit,
                                          tokens, seconds, due, time, flagged}
  POST   /api/task/<id>/toggle         — отметить/снять отметку
  DELETE /api/task/<id>
  POST   /api/project                  — {name, color, note, repo, path, members:[…]}
  PATCH  /api/project/<id>             — {name, color, note, repo, path}
  DELETE /api/project/<id>
  POST   /api/project/<id>/member      — {name, handle, role, kind}
  PATCH  /api/project/<id>/member/<mid> — {name, handle, role, kind}
  DELETE /api/project/<id>/member/<mid>
  POST   /api/goal                     — {text, project} — цель словами: заводит активный этап
  POST   /api/tasks                    — {project, stage, parent, items:[{title,…}]} — пачкой
  POST   /api/project/<id>/git         — {repo, branch} — подключить репозиторий
  GET    /api/project/<id>/git         — ветка, последний коммит, есть ли правки
  POST   /api/project/<id>/stage       — {title, date, status, note}
  PATCH  /api/project/<id>/stage/<sid> — {title, date, status, note}
  DELETE /api/project/<id>/stage/<sid>
"""
import json
import os
import shlex
import subprocess
import threading
import time
import uuid
from datetime import date

from aiohttp import web

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data.json")

# Разбудить агента сразу, как только человек поставил цель или задачу.
# Ждать расписания незачем: работа появилась — иди работай.
TRIGGER_CMD = os.environ.get("LOOP_TRIGGER_CMD", "")
TRIGGER_GAP = int(os.environ.get("LOOP_TRIGGER_GAP", "60"))   # не чаще раза в минуту
_last_trigger = 0.0
_trigger_lock = threading.Lock()


def wake_agent(reason):
    """Пинок агенту. Тихий: доска не должна падать из-за недоступного сервера."""
    if not TRIGGER_CMD:
        return
    global _last_trigger
    with _trigger_lock:
        if time.time() - _last_trigger < TRIGGER_GAP:
            return
        _last_trigger = time.time()

    def run():
        try:
            subprocess.run(shlex.split(TRIGGER_CMD), timeout=60,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            print(f"[loop] разбудили агента: {reason}", flush=True)
        except Exception as exc:
            print(f"[loop] разбудить не вышло: {exc}", flush=True)

    threading.Thread(target=run, daemon=True).start()


def by_agent(request):
    """Записи самого агента не будят его же — иначе получится вечный круг."""
    return request.headers.get("X-Actor", "").lower() == "agent"


KINDS = ("bot", "agent", "service", "human")
STAGES = ("planned", "active", "done")
TASK_STATUS = ("todo", "doing", "done")

DEFAULT = {"projects": [], "tasks": []}

# Настройки бота, который сидит у владельца в личке. Сама доска их только
# хранит и показывает — исполняет бот, когда его подключат к личке через
# режим «Бизнес» в Телеграме.
ASSISTANT = {
    "mode": "personal",                      # personal | support
    "business": {"connected": False, "account": "", "since": None},
    "autoreply": {"on": False, "text": "", "away_after": 0},
    "watch": {"deleted": True, "edited": True},
    "digest": {"on": False, "at": "21:00"},
    "replies": [],                           # заготовки: {id, title, text}
    "support": {"hours": "", "sla": 0, "escalate": ""},
}


def fallback_project(state):
    """Куда падает задача, если проект не указан: первый в списке."""
    return state["projects"][0]["id"] if state["projects"] else None


def load():
    if not os.path.exists(DATA):
        save(DEFAULT)
        return json.loads(json.dumps(DEFAULT))
    with open(DATA, encoding="utf-8") as f:
        return migrate(json.load(f))


def migrate(state):
    """Ранние версии знали только списки, потом только телеграм-ботов."""
    changed = False
    if "projects" not in state:
        state["projects"] = [dict(l, members=[]) for l in state.pop("lists", [])]
        for t in state.get("tasks", []):
            t["project"] = t.pop("list", "inbox")
        changed = True
    if "assistant" not in state:
        state["assistant"] = json.loads(json.dumps(ASSISTANT))
        changed = True
    for key, value in ASSISTANT.items():
        state["assistant"].setdefault(key, json.loads(json.dumps(value)))
        if isinstance(value, dict):
            for k2, v2 in value.items():
                state["assistant"][key].setdefault(k2, v2)
    for p in state["projects"]:
        p.setdefault("note", "")
        p.setdefault("repo", "")   # ссылка на репозиторий проекта
        p.setdefault("path", "")   # где исходники лежат у агента на сервере
        if "bots" in p:
            p["members"] = [
                dict(b, role=b.get("role", ""), kind=b.get("kind", "bot"))
                for b in p.pop("bots")
            ]
            changed = True
        p.setdefault("members", [])
        p.setdefault("roadmap", [])
    for t in state["tasks"]:
        if "bot" in t:
            t["member"] = t.pop("bot")
            changed = True
        t.setdefault("member", None)
        if "status" not in t:
            # раньше был только флаг «сделано», теперь три состояния
            t["status"] = "done" if t.get("done") else "todo"
            changed = True
        t.setdefault("stage", None)
        t.setdefault("parent", None)
        t.setdefault("report", "")
        t.setdefault("commit", "")     # чем закончилась работа
        t.setdefault("tokens", 0)      # сколько токенов ушло
        t.setdefault("seconds", 0)     # сколько времени заняло
        t.setdefault("started_at", None)
    if changed:
        save(state)
    return state


def save(state):
    tmp = DATA + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, DATA)


def find_project(state, pid):
    for p in state["projects"]:
        if p["id"] == pid:
            return p
    raise web.HTTPNotFound()


def is_today(task):
    due = task.get("due")
    return bool(due) and due <= date.today().isoformat()


def counts(state):
    open_tasks = [t for t in state["tasks"] if not t.get("done")]
    return {
        "today": sum(1 for t in open_tasks if is_today(t)),
        "planned": sum(1 for t in open_tasks if t.get("due")),
        "all": len(open_tasks),
        "flagged": sum(1 for t in open_tasks if t.get("flagged")),
        "done": sum(1 for t in state["tasks"] if t.get("done")),
    }


async def get_state(request):
    state = load()
    per_project = {}
    for t in state["tasks"]:
        if not t.get("done"):
            per_project[t["project"]] = per_project.get(t["project"], 0) + 1

    # у каждого этапа считаем, сколько его задач закрыто: «3 из 10»
    per_stage = {}
    for t in state["tasks"]:
        if not t.get("stage"):
            continue
        got = per_stage.setdefault(t["stage"], {"done": 0, "total": 0})
        got["total"] += 1
        if t.get("done"):
            got["done"] += 1

    projects = []
    for p in state["projects"]:
        roadmap = [dict(st, progress=per_stage.get(st["id"], {"done": 0, "total": 0}))
                   for st in p["roadmap"]]
        projects.append(dict(p, roadmap=roadmap, count=per_project.get(p["id"], 0)))
    return web.json_response(
        {"projects": projects, "tasks": state["tasks"], "counts": counts(state)}
    )


def make_member(body):
    handle = (body.get("handle") or "").strip()
    if handle and not handle.startswith("@"):
        handle = "@" + handle
    name = (body.get("name") or handle or "").strip()
    kind = body.get("kind") if body.get("kind") in KINDS else ("bot" if handle else "agent")
    return {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "handle": handle,
        "role": (body.get("role") or "").strip(),
        "kind": kind,
        "avatar": None,
    }


async def add_task(request):
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        raise web.HTTPBadRequest(text="title required")
    state = load()
    known = {p["id"] for p in state["projects"]}
    project = body.get("project") if body.get("project") in known else fallback_project(state)
    if not project:
        raise web.HTTPBadRequest(text="сначала заведи проект")
    members = {m["id"] for p in state["projects"] if p["id"] == project for m in p["members"]}
    task = {
        "id": uuid.uuid4().hex[:12],
        "title": title,
        "note": (body.get("note") or "").strip(),
        "project": project,
        "member": body.get("member") if body.get("member") in members else None,
        "stage": body.get("stage") or None,
        "parent": body.get("parent") or None,
        "status": body.get("status") if body.get("status") in TASK_STATUS else "todo",
        "report": (body.get("report") or "").strip(),
        "commit": "",
        "tokens": 0,
        "seconds": 0,
        "started_at": None,
        "url": (body.get("url") or "").strip(),
        "due": body.get("due") or None,
        "time": body.get("time") or None,
        "flagged": bool(body.get("flagged")),
        "done": False,
        "created": int(time.time()),
    }
    state["tasks"].insert(0, task)
    save(state)
    if not by_agent(request):
        wake_agent(f"новая задача: {task['title']}")
    return web.json_response(task)


async def patch_task(request):
    body = await request.json()
    state = load()
    for t in state["tasks"]:
        if t["id"] != request.match_info["tid"]:
            continue
        for key in ("title", "note", "report", "url", "commit"):
            if key in body:
                t[key] = (body[key] or "").strip()
        for key in ("tokens", "seconds"):
            if key in body and body[key] is not None:
                try:
                    t[key] = max(0, int(body[key]))
                except (TypeError, ValueError):
                    pass
        for key in ("due", "time", "stage", "member", "parent"):
            if key in body:
                t[key] = body[key] or None
        if "flagged" in body:
            t["flagged"] = bool(body["flagged"])
        if body.get("status") in TASK_STATUS:
            t["status"] = body["status"]
            t["done"] = t["status"] == "done"
            now = int(time.time())
            if t["status"] == "doing" and not t.get("started_at"):
                t["started_at"] = now          # засекаем, когда взяли в работу
            t["done_at"] = now if t["done"] else None
            # если исполнитель не сказал, сколько заняло, считаем сами
            if t["done"] and not t.get("seconds") and t.get("started_at"):
                t["seconds"] = max(0, now - t["started_at"])
        save(state)
        return web.json_response(t)
    raise web.HTTPNotFound()


async def toggle_task(request):
    state = load()
    for t in state["tasks"]:
        if t["id"] == request.match_info["tid"]:
            t["done"] = not t.get("done")
            t["status"] = "done" if t["done"] else "todo"
            t["done_at"] = int(time.time()) if t["done"] else None
            save(state)
            return web.json_response(t)
    raise web.HTTPNotFound()


async def delete_task(request):
    state = load()
    before = len(state["tasks"])
    state["tasks"] = [t for t in state["tasks"] if t["id"] != request.match_info["tid"]]
    if len(state["tasks"]) == before:
        raise web.HTTPNotFound()
    save(state)
    return web.json_response({"ok": True})


async def add_project(request):
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        raise web.HTTPBadRequest(text="name required")
    state = load()
    project = {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "color": body.get("color") or "#ff9f0a",
        "note": (body.get("note") or "").strip(),
        "repo": (body.get("repo") or "").strip(),
        "path": (body.get("path") or "").strip(),
        "members": [make_member(m) for m in body.get("members", [])],
        "roadmap": [],
    }
    state["projects"].append(project)
    save(state)
    return web.json_response(project)


async def patch_project(request):
    body = await request.json()
    state = load()
    p = find_project(state, request.match_info["pid"])
    for key in ("name", "color", "note", "repo", "path"):
        if key in body:
            p[key] = (body[key] or "").strip() if isinstance(body[key], str) else body[key]
    save(state)
    return web.json_response(p)


async def delete_project(request):
    pid = request.match_info["pid"]
    state = load()
    find_project(state, pid)
    state["projects"] = [p for p in state["projects"] if p["id"] != pid]
    state["tasks"] = [t for t in state["tasks"] if t["project"] != pid]
    save(state)
    return web.json_response({"ok": True})


async def add_member(request):
    body = await request.json()
    state = load()
    p = find_project(state, request.match_info["pid"])
    member = make_member(body)
    if not member["name"]:
        raise web.HTTPBadRequest(text="name required")
    p["members"].append(member)
    save(state)
    return web.json_response(member)


async def patch_member(request):
    body = await request.json()
    state = load()
    p = find_project(state, request.match_info["pid"])
    for m in p["members"]:
        if m["id"] != request.match_info["mid"]:
            continue
        if "handle" in body:
            handle = (body["handle"] or "").strip()
            if handle and not handle.startswith("@"):
                handle = "@" + handle
            m["handle"] = handle
        for key in ("name", "role"):
            if key in body:
                m[key] = (body[key] or "").strip()
        if body.get("kind") in KINDS:
            m["kind"] = body["kind"]
        save(state)
        return web.json_response(m)
    raise web.HTTPNotFound()


async def delete_member(request):
    mid = request.match_info["mid"]
    state = load()
    p = find_project(state, request.match_info["pid"])
    p["members"] = [m for m in p["members"] if m["id"] != mid]
    for t in state["tasks"]:
        if t.get("member") == mid:
            t["member"] = None
    save(state)
    return web.json_response({"ok": True})


async def add_goal(request):
    """Цель ставится текстом. Заголовок — первая строка, остальное в примечание."""
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise web.HTTPBadRequest(text="text required")
    head, _, rest = text.partition("\n")
    state = load()
    project = None
    if body.get("project"):
        project = next((p for p in state["projects"]
                        if p["id"] == body["project"]
                        or p["name"].lower() == body["project"].strip().lower()), None)
    project = project or state["projects"][0]
    stage = {
        "id": uuid.uuid4().hex[:8],
        "title": head.strip()[:120],
        "note": rest.strip(),
        "date": body.get("date") or None,
        "status": "active",   # цель ставят, чтобы её делали, а не откладывали
    }
    project["roadmap"].append(stage)
    save(state)
    if not by_agent(request):
        wake_agent(f"новая цель: {stage['title']}")
    return web.json_response({"project": project["id"], "stage": stage})


async def add_tasks(request):
    """Разбор цели: заводим сразу пачку задач одним запросом."""
    body = await request.json()
    items = body.get("items") or []
    if not items:
        raise web.HTTPBadRequest(text="items required")
    state = load()
    known = {p["id"] for p in state["projects"]}
    project = body.get("project") if body.get("project") in known else fallback_project(state)
    if not project:
        raise web.HTTPBadRequest(text="сначала заведи проект")
    created = []
    for item in items[:20]:
        title = (item.get("title") or "").strip() if isinstance(item, dict) else str(item).strip()
        if not title:
            continue
        task = {
            "id": uuid.uuid4().hex[:12],
            "title": title,
            "note": (item.get("note") if isinstance(item, dict) else "") or "",
            "project": project,
            "stage": body.get("stage") or None,
            "parent": body.get("parent") or None,
            "member": body.get("member") or None,
            "status": "todo",
            "report": "",
            "url": "",
            "due": None,
            "time": None,
            "flagged": False,
            "done": False,
            "created": int(time.time()),
        }
        state["tasks"].insert(0, task)
        created.append(task)
    save(state)
    return web.json_response({"created": len(created), "tasks": created})


async def add_stage(request):
    body = await request.json()
    state = load()
    p = find_project(state, request.match_info["pid"])
    title = (body.get("title") or "").strip()
    if not title:
        raise web.HTTPBadRequest(text="title required")
    stage = {
        "id": uuid.uuid4().hex[:8],
        "title": title,
        "note": (body.get("note") or "").strip(),
        "date": body.get("date") or None,
        "status": body.get("status") if body.get("status") in STAGES else "planned",
    }
    p["roadmap"].append(stage)
    save(state)
    return web.json_response(stage)


async def patch_stage(request):
    body = await request.json()
    state = load()
    p = find_project(state, request.match_info["pid"])
    for st in p["roadmap"]:
        if st["id"] == request.match_info["sid"]:
            if "status" in body and body["status"] in STAGES:
                st["status"] = body["status"]
            for key in ("title", "note"):
                if key in body:
                    st[key] = (body[key] or "").strip()
            if "date" in body:
                st["date"] = body["date"] or None
            save(state)
            return web.json_response(st)
    raise web.HTTPNotFound()


async def delete_stage(request):
    state = load()
    p = find_project(state, request.match_info["pid"])
    before = len(p["roadmap"])
    sid = request.match_info["sid"]
    p["roadmap"] = [s for s in p["roadmap"] if s["id"] != sid]
    if len(p["roadmap"]) == before:
        raise web.HTTPNotFound()
    for t in state["tasks"]:
        if t.get("stage") == sid:
            t["stage"] = None
    save(state)
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- git

PROJECTS_DIR = os.environ.get("PROJECTS_DIR", os.path.expanduser("~/projects"))


def git(args, cwd=None, timeout=120):
    """Запуск git с понятным результатом: (получилось, текст)."""
    try:
        out = subprocess.run(["git"] + args, cwd=cwd, capture_output=True,
                             text=True, timeout=timeout)
        return out.returncode == 0, (out.stdout or out.stderr).strip()
    except subprocess.TimeoutExpired:
        return False, "git думал слишком долго"
    except FileNotFoundError:
        return False, "git на этой машине не установлен"


def repo_slug(repo):
    """git@github.com:user/aime.git → aime"""
    name = repo.rstrip("/").split("/")[-1]
    return name[:-4] if name.endswith(".git") else name


def git_status(path):
    """Что происходит в рабочей копии: ветка, последний коммит, правки."""
    if not path or not os.path.isdir(os.path.join(path, ".git")):
        return None
    ok, branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=path)
    ok2, last = git(["log", "-1", "--pretty=%h %s (%cr)"], cwd=path)
    ok3, dirty = git(["status", "--porcelain"], cwd=path)
    return {
        "path": path,
        "branch": branch if ok else "?",
        "last": last if ok2 else "",
        "dirty": len([l for l in dirty.splitlines() if l.strip()]) if ok3 else 0,
    }


async def get_git(request):
    state = load()
    p = find_project(state, request.match_info["pid"])
    return web.json_response({"repo": p.get("repo", ""), "status": git_status(p.get("path"))})


async def connect_git(request):
    """Подключение репозитория «по-нормальному»: проверяем доступ, клонируем,
    запоминаем путь. Никаких «укажи путь руками»."""
    body = await request.json()
    state = load()
    p = find_project(state, request.match_info["pid"])
    repo = (body.get("repo") or p.get("repo") or "").strip()
    branch = (body.get("branch") or "").strip()
    if not repo:
        raise web.HTTPBadRequest(text="repo required")

    def work():
        ok, out = git(["ls-remote", "--heads", repo], timeout=60)
        if not ok:
            return {"ok": False, "error": f"Нет доступа к репозиторию: {out.splitlines()[-1][:200]}"}
        heads = [l.split("refs/heads/")[-1] for l in out.splitlines() if "refs/heads/" in l]
        target = branch or ("main" if "main" in heads else heads[0] if heads else "")
        os.makedirs(PROJECTS_DIR, exist_ok=True)
        path = os.path.join(PROJECTS_DIR, repo_slug(repo))
        if os.path.isdir(os.path.join(path, ".git")):
            git(["fetch", "--quiet", "origin"], cwd=path)
            git(["checkout", target], cwd=path)
            git(["pull", "--quiet", "--ff-only"], cwd=path)
        else:
            ok, out = git(["clone", "--quiet", "--branch", target, repo, path], timeout=300)
            if not ok:
                return {"ok": False, "error": f"Клонировать не вышло: {out[:200]}"}
        return {"ok": True, "path": path, "branch": target, "branches": heads}

    result = await request.loop.run_in_executor(None, work)
    if not result.get("ok"):
        return web.json_response(result, status=400)

    p["repo"] = repo
    p["path"] = result["path"]
    save(state)
    return web.json_response({"ok": True, "repo": repo, "status": git_status(p["path"]),
                              "branches": result["branches"]})


# Кнопки вместо команд: мини-аппа дёргает те же действия, что раньше
# набирались в чате как /status и /doctor. Список закрытый — что не здесь,
# то через кнопку не запустить.
OPENCLAW = os.environ.get("OPENCLAW_BIN", "/home/ubuntu/.npm-global/bin/openclaw")
LOOP_JOB = os.environ.get("LOOP_JOB_ID", "")

COMMANDS = {
    "status":   {"label": "Статус", "argv": [OPENCLAW, "status", "--plain"]},
    "health":   {"label": "Здоровье", "argv": [OPENCLAW, "health"]},
    "models":   {"label": "Модель", "argv": [OPENCLAW, "models", "status", "--plain"]},
    "loop":     {"label": "Прогнать цикл", "argv": [OPENCLAW, "cron", "run", LOOP_JOB]},
    "cron":     {"label": "Расписание", "argv": [OPENCLAW, "cron", "status"]},
    "channels": {"label": "Каналы", "argv": [OPENCLAW, "channels", "status"]},
}


async def list_commands(request):
    return web.json_response({"commands": [{"id": k, "label": v["label"]}
                                           for k, v in COMMANDS.items()]})


async def run_command(request):
    cmd = COMMANDS.get(request.match_info["cid"])
    if not cmd or not cmd["argv"][-1]:
        raise web.HTTPNotFound()

    def run():
        try:
            out = subprocess.run(cmd["argv"], capture_output=True, text=True, timeout=120)
            text = (out.stdout or out.stderr or "").strip()
        except subprocess.TimeoutExpired:
            text = "Команда думала слишком долго и была прервана."
        except Exception as exc:
            text = f"Не получилось: {exc}"
        # выбрасываем служебный шум про плагины — человеку он ничего не говорит
        return "\n".join(l for l in text.splitlines() if "plugins.allow" not in l)[:3000] or "Пусто"

    text = await request.loop.run_in_executor(None, run)
    return web.json_response({"label": cmd["label"], "text": text})


# ------------------------------------------------------------ бот в личке

async def get_assistant(request):
    return web.json_response(load()["assistant"])


async def patch_assistant(request):
    """Частичное обновление: вложенные словари сливаем, а не затираем."""
    body = await request.json()
    state = load()
    a = state["assistant"]
    for key, value in body.items():
        if key not in ASSISTANT or key == "replies":
            continue
        if isinstance(value, dict) and isinstance(a.get(key), dict):
            a[key].update(value)
        else:
            a[key] = value
    save(state)
    return web.json_response(a)


async def add_reply(request):
    """Заготовка ответа: короткое название и текст, который бот вставит."""
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise web.HTTPBadRequest(text="text required")
    state = load()
    reply = {
        "id": uuid.uuid4().hex[:8],
        "title": (body.get("title") or text[:24]).strip(),
        "text": text,
    }
    state["assistant"]["replies"].append(reply)
    save(state)
    return web.json_response(reply)


async def delete_reply(request):
    state = load()
    replies = state["assistant"]["replies"]
    left = [r for r in replies if r["id"] != request.match_info["rid"]]
    if len(left) == len(replies):
        raise web.HTTPNotFound()
    state["assistant"]["replies"] = left
    save(state)
    return web.json_response({"ok": True})


async def spa(request):
    # Отдаёт статику из static/ если файл существует, иначе index.html
    # (SPA-фолбэк для клиентского роутера).
    tail = request.match_info.get("tail", "")
    if tail:
        path = os.path.join(ROOT, "static", tail)
        # Не выпускаем за пределы static/
        if os.path.commonpath([os.path.abspath(path), os.path.abspath(os.path.join(ROOT, "static"))]) == os.path.abspath(os.path.join(ROOT, "static")):
            if os.path.isfile(path):
                # у собранных файлов хеш в имени, их можно кэшировать надолго
                headers = ({"Cache-Control": "public, max-age=31536000, immutable"}
                           if tail.startswith("assets/") else None)
                return web.FileResponse(path, headers=headers)
    # а вот index.html кэшировать нельзя: вебвью Телеграма держит его мёртвой
    # хваткой и после выкатки показывает старую сборку
    return web.FileResponse(os.path.join(ROOT, "static", "index.html"),
                            headers={"Cache-Control": "no-store"})


def make_app():
    app = web.Application()
    app.router.add_get("/api/state", get_state)
    app.router.add_get("/api/assistant", get_assistant)
    app.router.add_patch("/api/assistant", patch_assistant)
    app.router.add_post("/api/assistant/reply", add_reply)
    app.router.add_delete("/api/assistant/reply/{rid}", delete_reply)
    app.router.add_get("/api/commands", list_commands)
    app.router.add_post("/api/command/{cid}", run_command)
    app.router.add_post("/api/task", add_task)
    app.router.add_patch("/api/task/{tid}", patch_task)
    app.router.add_post("/api/task/{tid}/toggle", toggle_task)
    app.router.add_delete("/api/task/{tid}", delete_task)
    app.router.add_post("/api/project", add_project)
    app.router.add_patch("/api/project/{pid}", patch_project)
    app.router.add_delete("/api/project/{pid}", delete_project)
    app.router.add_post("/api/project/{pid}/member", add_member)
    app.router.add_patch("/api/project/{pid}/member/{mid}", patch_member)
    app.router.add_delete("/api/project/{pid}/member/{mid}", delete_member)
    app.router.add_post("/api/goal", add_goal)
    app.router.add_post("/api/tasks", add_tasks)
    app.router.add_get("/api/project/{pid}/git", get_git)
    app.router.add_post("/api/project/{pid}/git", connect_git)
    app.router.add_post("/api/project/{pid}/stage", add_stage)
    app.router.add_patch("/api/project/{pid}/stage/{sid}", patch_stage)
    app.router.add_delete("/api/project/{pid}/stage/{sid}", delete_stage)
    os.makedirs(os.path.join(ROOT, "avatars"), exist_ok=True)
    app.router.add_static("/avatars", os.path.join(ROOT, "avatars"))
    app.router.add_get("/{tail:.*}", spa)
    return app


if __name__ == "__main__":
    web.run_app(make_app(), host="0.0.0.0", port=int(os.environ.get("PORT", 8095)))
