"""Сквозной прогон замкнутого цикла «вызов → работа → отчёт» по HTTP.

Доска поднимается на временном порту со своим файлом данных и своим ключом
владельца, поэтому тест можно гонять прямо на боевой машине: `data.json` и
`owner.key` он не трогает.

Что проверяем:
  * владелец завёл задачу и позвал исполнителя — вызов дошёл сразу;
  * исполнитель подтвердил, что он на связи, и взял задачу в работу;
  * отчёт закрывает задачу, цифры (коммит, токены, секунды) сохраняются;
  * повторный вызов не создаёт второй задачи и не начинает работу заново;
  * когда в проекте есть проверяющий — отчёт уходит на проверку, возврат
    будит исполнителя, а не заводит дубль.
"""
import secrets
import sys
import tempfile
import unittest
from pathlib import Path

from aiohttp.test_utils import AioHTTPTestCase

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server  # noqa: E402


class CycleCase(AioHTTPTestCase):
    """Пустая доска, владелец и помощники для запросов от его и чужого имени."""

    async def get_application(self):
        return server.make_app()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self._puvodni = (server.DATA, server.OWNER_KEY_FILE, server.TRIGGER_CMD)
        server.DATA = str(base / "data.json")
        server.OWNER_KEY_FILE = str(base / "owner.key")
        server.TRIGGER_CMD = ""          # наружу из теста никого не будим
        server._viden.clear()
        server._cekaji.clear()
        self.owner_key = secrets.token_hex(16)
        Path(server.OWNER_KEY_FILE).write_text(self.owner_key, encoding="utf-8")
        super().setUp()

    def tearDown(self):
        super().tearDown()
        server.DATA, server.OWNER_KEY_FILE, server.TRIGGER_CMD = self._puvodni
        self.tmp.cleanup()

    # ---------------------------------------------------------- запросы
    async def ask(self, method, path, key, expect=200, **kw):
        resp = await getattr(self.client, method)(
            path, headers={"X-Board-Key": key}, **kw)
        body = await resp.text()
        self.assertEqual(resp.status, expect, f"{method.upper()} {path} → {body}")
        return await resp.json() if resp.content_type == "application/json" else body

    async def get(self, path, key, **kw):
        return await self.ask("get", path, key, **kw)

    async def post(self, path, key, **kw):
        return await self.ask("post", path, key, **kw)

    async def patch(self, path, key, **kw):
        return await self.ask("patch", path, key, **kw)

    # ---------------------------------------------------------- обвязка
    async def board(self, s_kontrolorem=False):
        """Проект с исполнителем и, если нужно, с проверяющим."""
        project = await self.post("/api/project", self.owner_key, json={
            "name": "aiMe",
            "members": [{"name": "Разраб", "kind": "agent", "job": "work"}],
        })
        worker = project["members"][0]
        checker = None
        if s_kontrolorem:
            checker = await self.post(
                f"/api/project/{project['id']}/member", self.owner_key,
                json={"name": "Контролёр", "kind": "agent", "job": "check"})
        return project, worker, checker

    async def tasks(self):
        return (await self.get("/api/state", self.owner_key))["tasks"]

    async def task(self, tid):
        for t in await self.tasks():
            if t["id"] == tid:
                return t
        self.fail(f"задача {tid} пропала с доски")

    async def member(self, pid, mid):
        state = await self.get("/api/state", self.owner_key)
        for p in state["projects"]:
            if p["id"] == pid:
                for m in p["members"]:
                    if m["id"] == mid:
                        return m
        self.fail(f"участник {mid} пропал из проекта {pid}")

    async def pozvat(self, pid, mid):
        """Владелец зовёт исполнителя и тот сразу получает вызов."""
        zov = await self.post(
            f"/api/project/{pid}/member/{mid}/ping", self.owner_key)
        self.assertTrue(zov["ok"] and zov["ping"] > 0)
        return zov["ping"]

    async def prislo(self, key, ping):
        """Вызов виден в длинном запросе немедленно, а не по таймауту."""
        call = await self.get("/api/agent/wait", key, params={"timeout": 5})
        self.assertEqual(call["ping"], ping, "исполнитель не увидел вызова")
        self.assertEqual(call["waited"], 0, "вызов дошёл не сразу")
        return call


class FullCycleTests(CycleCase):
    async def test_call_work_report_closes_the_task(self):
        project, worker, _ = await self.board()

        # вызов: владелец завёл задачу и позвал исполнителя
        task = await self.post("/api/task", self.owner_key, json={
            "title": "Проверить полный цикл", "note": "автотест",
            "project": project["id"], "member": worker["id"]})
        self.assertEqual(task["status"], "todo")
        self.assertEqual(task["member"], worker["id"])
        ping = await self.pozvat(project["id"], worker["id"])
        await self.prislo(worker["key"], ping)

        # подтверждение: исполнитель на связи и берёт задачу
        hello = await self.post("/api/agent/connect", worker["key"],
                                json={"model": "test-model"})
        self.assertTrue(hello["connected"])
        card = await self.member(project["id"], worker["id"])
        self.assertEqual(card["model"], "test-model")
        self.assertTrue(card["connected"])

        vzal = await self.patch(f"/api/task/{task['id']}", worker["key"],
                                json={"status": "doing"})
        self.assertEqual(vzal["status"], "doing")
        self.assertTrue(vzal["started_at"], "не засекли начало работы")

        # подтверждение словами: владелец видит ответ в переписке
        await self.post("/api/agent/say", worker["key"],
                        json={"text": "взял в работу"})
        chat = await self.get(f"/api/agents/{worker['id']}/chat", self.owner_key)
        self.assertEqual(chat["items"][-1]["from"], "agent")
        self.assertEqual(chat["items"][-1]["text"], "взял в работу")

        # отчёт: задача закрыта, цифры на месте
        hotovo = await self.patch(f"/api/task/{task['id']}", worker["key"], json={
            "status": "done", "report": "цикл проверен автотестом",
            "commit": "deadbee", "tokens": 1200, "seconds": 42})
        self.assertEqual(hotovo["status"], "done")
        self.assertTrue(hotovo["done"])
        self.assertEqual(hotovo["report"], "цикл проверен автотестом")
        self.assertEqual((hotovo["commit"], hotovo["tokens"], hotovo["seconds"]),
                         ("deadbee", 1200, 42))
        self.assertTrue(hotovo["done_at"])

        state = await self.get("/api/state", self.owner_key)
        self.assertEqual(state["counts"]["done"], 1)
        self.assertEqual(state["counts"]["all"], 0)

    async def test_second_call_does_not_duplicate_work(self):
        project, worker, _ = await self.board()
        task = await self.post("/api/task", self.owner_key, json={
            "title": "Единственная задача", "project": project["id"],
            "member": worker["id"]})

        ping = await self.pozvat(project["id"], worker["id"])
        await self.prislo(worker["key"], ping)
        vzal = await self.patch(f"/api/task/{task['id']}", worker["key"],
                                json={"status": "doing"})
        zacatek, pokusy = vzal["started_at"], vzal["attempts"]

        # позвали второй раз, пока работа идёт
        ping2 = await self.pozvat(project["id"], worker["id"])
        self.assertGreaterEqual(ping2, ping)
        await self.prislo(worker["key"], ping2)
        znovu = await self.patch(f"/api/task/{task['id']}", worker["key"],
                                 json={"status": "doing"})
        self.assertEqual(znovu["started_at"], zacatek, "работа началась заново")
        self.assertEqual(znovu["attempts"], pokusy, "попытка посчиталась дважды")
        self.assertEqual(len(await self.tasks()), 1, "вызов завёл вторую задачу")

        # отчёт — и ещё один вызов уже после него
        await self.patch(f"/api/task/{task['id']}", worker["key"], json={
            "status": "done", "report": "сделано", "seconds": 7})
        ping3 = await self.pozvat(project["id"], worker["id"])
        await self.prislo(worker["key"], ping3)
        self.assertEqual(len(await self.tasks()), 1, "вызов после отчёта завёл дубль")
        zavrena = await self.task(task["id"])
        self.assertEqual((zavrena["status"], zavrena["attempts"]), ("done", pokusy))

        # закрытую задачу нельзя ни сдать ещё раз, ни вернуть в очередь
        await self.post(f"/api/task/{task['id']}/submit", worker["key"],
                        expect=409, json={"report": "повторная сдача"})
        await self.post(f"/api/task/{task['id']}/return", worker["key"],
                        expect=409, json={"report": "повторный возврат"})
        self.assertEqual((await self.task(task["id"]))["status"], "done")

    async def test_report_goes_through_review_and_rework_wakes_the_worker(self):
        project, worker, checker = await self.board(s_kontrolorem=True)
        task = await self.post("/api/task", self.owner_key, json={
            "title": "Задача с проверкой", "project": project["id"],
            "member": worker["id"]})

        # здесь владелец никого не зовёт: исполнитель пришёл за работой сам,
        # поэтому отметки вызова у него ещё нет — и её появление потом
        # однозначно означает «позвали на доработку»
        self.assertEqual(
            (await self.member(project["id"], worker["id"])).get("ping", 0), 0)
        await self.patch(f"/api/task/{task['id']}", worker["key"],
                         json={"status": "doing"})

        # отчёт уходит не в «готово», а проверяющему — и тот сразу позван
        sdano = await self.post(f"/api/task/{task['id']}/submit", worker["key"],
                                json={"report": "первая версия", "commit": "aaa1111"})
        self.assertEqual(sdano["status"], "review")
        self.assertEqual(sdano["checker"], checker["id"])
        self.assertEqual(sdano["attempts"], 1)
        await self.prislo(checker["key"], (await self.member(
            project["id"], checker["id"]))["ping"])

        # вернули на доработку: задача та же, исполнитель снова позван
        vraceno = await self.post(f"/api/task/{task['id']}/review", checker["key"],
                                  json={"ok": False, "why": "нет теста"})
        self.assertEqual(vraceno["status"], "todo")
        self.assertIsNone(vraceno["started_at"])
        self.assertEqual(vraceno["verification_report"], "нет теста")
        self.assertEqual(len(await self.tasks()), 1, "возврат завёл дубль")
        karta = await self.member(project["id"], worker["id"])
        self.assertGreater(karta.get("ping", 0), 0,
                           "исполнителя не позвали на доработку")
        await self.prislo(worker["key"], karta["ping"])

        # вторая попытка проходит проверку и закрывает задачу
        await self.patch(f"/api/task/{task['id']}", worker["key"],
                         json={"status": "doing"})
        await self.post(f"/api/task/{task['id']}/submit", worker["key"],
                        json={"report": "тест добавлен", "commit": "bbb2222"})
        prijato = await self.post(f"/api/task/{task['id']}/review", checker["key"],
                                  json={"ok": True, "why": "проверил, работает"})
        self.assertEqual(prijato["status"], "done")
        self.assertTrue(prijato["done"])
        self.assertEqual(prijato["attempts"], 2)
        self.assertEqual(len(await self.tasks()), 1)


if __name__ == "__main__":
    unittest.main()
