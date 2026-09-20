"""Чистые переходы состояний замкнутого цикла задач."""


def submit_candidate(task: dict, body: dict, now: int) -> dict:
    task["report"] = body["report"].strip()
    if "commit" in body:
        task["commit"] = (body["commit"] or "").strip()
    for key in ("tokens", "seconds"):
        if body.get(key) is not None:
            try:
                task[key] = max(0, int(body[key]))
            except (TypeError, ValueError):
                pass
    task["attempts"] = int(task.get("attempts") or 0) + 1
    task["status"] = "review"
    task["done"] = False
    task["submitted_at"] = now
    task["verification_report"] = ""
    return task


def apply_review(task: dict, passed: bool, report: str, now: int) -> dict:
    task["verification_report"] = report.strip()
    if passed:
        task["status"] = "done"
        task["done"] = True
        task["done_at"] = now
        if not task.get("seconds") and task.get("started_at"):
            task["seconds"] = max(0, now - task["started_at"])
    elif int(task.get("attempts") or 0) >= int(task.get("max_attempts") or 3):
        task["status"] = "blocked"
        task["done"] = False
        task["done_at"] = None
    else:
        task["status"] = "todo"
        task["done"] = False
        task["done_at"] = None
        task["started_at"] = None
    return task


def return_for_retry(task: dict, report: str) -> dict:
    task["report"] = report.strip()
    task["attempts"] = int(task.get("attempts") or 0) + 1
    task["done"] = False
    task["done_at"] = None
    task["started_at"] = None
    if task["attempts"] >= int(task.get("max_attempts") or 3):
        task["status"] = "blocked"
    else:
        task["status"] = "todo"
    return task
