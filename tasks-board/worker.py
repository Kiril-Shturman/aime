#!/usr/bin/env python3
"""Замкнутый конвейер доски: исполнитель -> проверяющий -> следующая задача."""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


def fetch_state(board_url: str, board_key: str) -> dict:
    request = urllib.request.Request(
        board_url.rstrip("/") + "/api/state",
        headers={"X-Board-Key": board_key},
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def post_json(board_url: str, board_key: str, path: str, body: dict) -> dict:
    request = urllib.request.Request(
        board_url.rstrip("/") + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Board-Key": board_key,
                 "X-Actor": "agent"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def patch_json(board_url: str, board_key: str, path: str, body: dict) -> dict:
    request = urllib.request.Request(
        board_url.rstrip("/") + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "X-Board-Key": board_key,
                 "X-Actor": "agent"},
        method="PATCH",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def find_project(state: dict, wanted: str) -> dict | None:
    key = wanted.strip().lower()
    return next((p for p in state["projects"]
                 if p["id"] == wanted or p["name"].lower() == key), None)


def member_id(project: dict, wanted: str) -> str | None:
    key = wanted.strip().lower().lstrip("@")
    for member in project.get("members", []):
        if (member["id"] == wanted or member["name"].lower() == key
                or (member.get("handle") or "").lower().lstrip("@") == key):
            return member["id"]
    return None


def takes_tasks(state: dict, project: dict, worker_member: str | None) -> bool:
    """Владелец мог выключить приём новых задач — тогда конвейер стоит."""
    for member in project.get("members", []):
        if member["id"] == worker_member:
            return member.get("auto", True)
    return True


def next_work_task(state: dict, project: dict, worker_member: str | None) -> dict | None:
    if not takes_tasks(state, project, worker_member):
        return None
    active = {stage["id"] for stage in project.get("roadmap", [])
              if stage.get("status") == "active"}
    candidates = [task for task in state["tasks"]
                  if task.get("project") == project["id"]
                  and task.get("stage") in active
                  and task.get("status") == "todo"
                  and (not task.get("member") or task.get("member") == worker_member)]
    if not candidates:
        return None
    return sorted(candidates, key=lambda task: (
        0 if task.get("member") else 1,
        0 if task.get("flagged") else 1,
        task.get("due") or "9999-99-99",
        task.get("created") or 0,
    ))[0]


def next_review_task(state: dict, project: dict) -> dict | None:
    candidates = [task for task in state["tasks"]
                  if task.get("project") == project["id"]
                  and task.get("status") == "review"]
    return min(candidates, key=lambda task: task.get("submitted_at") or 0) if candidates else None


def openclaw_binary(explicit: str | None) -> str:
    if explicit:
        return explicit
    found = shutil.which("openclaw")
    if found:
        return found
    fallback = Path.home() / ".npm-global/bin/openclaw"
    if fallback.exists():
        return str(fallback)
    raise FileNotFoundError("openclaw CLI не найден")


def session_snapshot(agent: str, session: str) -> dict:
    """Read safe live counters from OpenClaw without exposing prompts or commands."""
    key = f"agent:{agent}:{session}"
    store = Path.home() / ".openclaw" / "agents" / agent / "sessions" / "sessions.json"
    try:
        item = json.loads(store.read_text(encoding="utf-8")).get(key) or {}
    except (OSError, ValueError, TypeError):
        return {}
    step = trajectory_step(item.get("sessionFile"))
    updated_ms = int(item.get("updatedAt") or 0)
    return {
        "tokens": max(0, int(item.get("totalTokens") or 0)),
        "last_activity_at": updated_ms // 1000 if updated_ms else 0,
        "step": step,
        "status": item.get("status") or "",
    }


def trajectory_step(session_file: str | None) -> str:
    """Turn the last trajectory event into a human label; never return its content."""
    if not session_file:
        return ""
    try:
        with open(session_file, "rb") as source:
            source.seek(0, os.SEEK_END)
            size = source.tell()
            source.seek(max(0, size - 131072))
            lines = source.read().decode("utf-8", "replace").splitlines()
    except OSError:
        return ""
    labels = {
        "apply_patch": "Вносит изменения в код",
        "exec_command": "Проверяет проект и выполняет команды",
        "bash": "Проверяет проект и выполняет команды",
        "web": "Изучает документацию",
        "browser": "Проверяет интерфейс",
        "view_image": "Проверяет изображение",
        "message": "Готовит отчёт",
    }
    for line in reversed(lines):
        try:
            message = json.loads(line).get("message") or {}
        except (ValueError, TypeError):
            continue
        role = message.get("role")
        if role == "toolResult":
            return "Анализирует результат проверки"
        if role != "assistant":
            continue
        for part in reversed(message.get("content") or []):
            if not isinstance(part, dict):
                continue
            if part.get("type") in ("toolCall", "tool_use"):
                name = part.get("name") or part.get("toolName") or ""
                return labels.get(name, "Работает с инструментами")
            if part.get("type") in ("text", "thinking"):
                return "Анализирует задачу"
    return ""


def run_agent(binary: str, agent: str, session: str, prompt: str, timeout: int,
              heartbeat=None) -> bool:
    command = [binary, "agent", "--agent", agent, "--session-key",
               f"agent:{agent}:{session}", "--message", prompt,
               "--thinking", "high", "--timeout", str(timeout)]
    started = time.monotonic()
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as output_file:
        try:
            process = subprocess.Popen(command, text=True, stdout=output_file,
                                       stderr=subprocess.STDOUT)
        except OSError as exc:
            print(f"[worker] не удалось запустить сессию {session}: {exc}", file=sys.stderr)
            return False
        while True:
            try:
                returncode = process.wait(timeout=15)
                break
            except subprocess.TimeoutExpired:
                if heartbeat:
                    try:
                        heartbeat(session_snapshot(agent, session))
                    except Exception as exc:
                        print(f"[worker] heartbeat не записан: {exc}", file=sys.stderr)
                if time.monotonic() - started > timeout + 30:
                    process.kill()
                    process.wait()
                    print(f"[worker] сессия {session} превысила лимит времени", file=sys.stderr)
                    return False
        if heartbeat:
            try:
                heartbeat(session_snapshot(agent, session))
            except Exception as exc:
                print(f"[worker] финальный heartbeat не записан: {exc}", file=sys.stderr)
        output_file.seek(0)
        output = output_file.read().strip()
    if output:
        print(output[-4000:], flush=True)
    if returncode:
        print(f"[worker] сессия {session} завершилась с кодом {returncode}", file=sys.stderr)
    return returncode == 0


def execution_prompt(project: dict, task: dict) -> str:
    return f"""Ты исполнитель замкнутого цикла доски.
Проект: {project['name']}
Исходники: {project.get('path') or 'не указаны'}
Репозиторий: {project.get('repo') or 'не указан'}
Задача id: {task['id']}
Название: {task['title']}
Описание и критерии: {task.get('note') or 'нет отдельного описания'}
Предыдущая проверка: {task.get('verification_report') or 'это первая попытка'}

Работай только над этой задачей. Воркер уже перевёл её в статус «В работе»,
повторно вызывать board_take не нужно. Изучи проект, реализуй результат,
запусти подходящие тесты. Для кода работай в
отдельной ветке, сделай commit и push. Затем вызови board_report с done=true,
точным отчётом, хешем коммита и результатами тестов: это отправит результат на
проверку, но не закроет задачу. Если объективно выполнить нельзя, не изображай
успех: вызови board_return с конкретной причиной. Не бери следующую задачу.
"""


def review_prompt(project: dict, task: dict) -> str:
    return f"""Ты независимый проверяющий. Ничего не исправляй и не меняй в исходниках.
Проект: {project['name']}
Исходники: {project.get('path') or 'не указаны'}
Репозиторий: {project.get('repo') or 'не указан'}
Задача id: {task['id']}
Название: {task['title']}
Критерии: {task.get('note') or 'проверь заявленный результат по названию задачи'}
Отчёт исполнителя: {task.get('report') or 'отчёта нет'}
Коммит: {task.get('commit') or 'не указан'}
Попытка: {task.get('attempts', 1)}/{task.get('max_attempts', 3)}

Проверь фактический результат: diff/коммит, отсутствие посторонних изменений,
сборку, тесты и критерии карточки. Не доверяй одному тексту отчёта. Затем ровно
один раз вызови board_review для этого id: passed=true только если всё реально
проходит; иначе passed=false и перечисли конкретные дефекты и команду/проверку,
на которой результат сломался. Не выполняй и не исправляй задачу сам.
"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--board-url", default=os.environ.get("BOARD_URL", "http://127.0.0.1:8095"))
    parser.add_argument("--project", default=os.environ.get("WORKER_PROJECT", "aiMe"))
    parser.add_argument("--member", default=os.environ.get("WORKER_MEMBER", "NightWorkrr"))
    parser.add_argument("--agent", default=os.environ.get("WORKER_AGENT", "main"))
    parser.add_argument("--openclaw", default=os.environ.get("OPENCLAW_BIN"))
    parser.add_argument("--board-key-file", default=os.environ.get(
        "BOARD_KEY_FILE", str(Path(__file__).with_name("owner.key"))))
    parser.add_argument("--limit", type=int, default=int(os.environ.get("WORKER_LIMIT", "3")))
    parser.add_argument("--timeout", type=int, default=int(os.environ.get("WORKER_TIMEOUT", "1800")))
    parser.add_argument("--lock", default=os.environ.get("WORKER_LOCK", "/tmp/aime-board-worker.lock"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    lock = open(args.lock, "w", encoding="utf-8")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("[worker] другой проход уже работает")
        return 0

    try:
        board_key = Path(args.board_key_file).read_text(encoding="utf-8").strip()
    except OSError as exc:
        print(f"[worker] не удалось прочитать ключ доски: {exc}", file=sys.stderr)
        return 2
    if not board_key:
        print("[worker] ключ доски пуст", file=sys.stderr)
        return 2
    binary = openclaw_binary(args.openclaw) if not args.dry_run else "openclaw"
    completed = 0
    actions = 0
    max_actions = max(3, args.limit * 8)
    while completed < args.limit and actions < max_actions:
        state = fetch_state(args.board_url, board_key)
        project = find_project(state, args.project)
        if not project:
            print(f"[worker] проект {args.project!r} не найден", file=sys.stderr)
            return 2
        reviewer_task = next_review_task(state, project)
        if reviewer_task:
            print(f"[worker] проверка: {reviewer_task['title']} [{reviewer_task['id']}]")
            if args.dry_run:
                return 0
            run_agent(binary, args.agent, "board-reviewer",
                      review_prompt(project, reviewer_task), args.timeout)
            actions += 1
            after = fetch_state(args.board_url, board_key)
            updated = next((t for t in after["tasks"] if t["id"] == reviewer_task["id"]), {})
            if updated.get("status") == "done":
                completed += 1
            elif updated.get("status") == "review":
                print("[worker] проверяющий не изменил статус, проход остановлен", file=sys.stderr)
                break
            continue

        worker_member = member_id(project, args.member)
        task = next_work_task(state, project, worker_member)
        if not task:
            print("[worker] подходящих задач нет")
            break
        print(f"[worker] выполнение: {task['title']} [{task['id']}]")
        if args.dry_run:
            return 0
        task = patch_json(args.board_url, board_key, f"/api/task/{task['id']}",
                          {"status": "doing"})
        session_name = "board-executor"
        session_key = f"agent:{args.agent}:{session_name}"
        run_started = int(task.get("started_at") or time.time())
        before = session_snapshot(args.agent, session_name)
        baseline_tokens = int(before.get("tokens") or 0)
        last_activity = run_started
        last_step = "Запускает рабочую сессию"
        patch_json(args.board_url, board_key, f"/api/task/{task['id']}", {
            "session_key": session_key,
            "progress_step": last_step,
            "progress_updated_at": last_activity,
            "run_status": "active",
        })

        def heartbeat(snapshot: dict) -> None:
            nonlocal last_activity, last_step
            activity = int(snapshot.get("last_activity_at") or 0)
            # Не принимаем хвост предыдущего запуска этой постоянной сессии.
            if activity >= run_started:
                last_activity = activity
                last_step = snapshot.get("step") or last_step
            silence = max(0, int(time.time()) - last_activity)
            run_status = "stalled" if silence >= 600 else "warning" if silence >= 120 else "active"
            patch_json(args.board_url, board_key, f"/api/task/{task['id']}", {
                "tokens": max(0, int(snapshot.get("tokens") or 0) - baseline_tokens),
                "progress_step": last_step,
                "progress_updated_at": last_activity,
                "session_key": session_key,
                "run_status": run_status,
            })

        succeeded = run_agent(binary, args.agent, "board-executor",
                              execution_prompt(project, task), args.timeout,
                              heartbeat=heartbeat)
        actions += 1
        after = fetch_state(args.board_url, board_key)
        updated = next((t for t in after["tasks"] if t["id"] == task["id"]), {})
        if updated.get("status") == "done":
            completed += 1
        elif updated.get("status") == "doing":
            reason = ("Сессия исполнителя завершилась с ошибкой до сдачи результата."
                      if not succeeded else
                      "Исполнитель завершил сессию, но не сдал результат на проверку.")
            post_json(args.board_url, board_key, f"/api/task/{task['id']}/return",
                      {"report": reason})
        elif updated.get("status") == task.get("status"):
            print("[worker] исполнитель не изменил статус, проход остановлен", file=sys.stderr)
            break
        time.sleep(1)

    print(f"[worker] проход завершён: принято задач {completed}, действий {actions}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
