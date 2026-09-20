import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


worker = load_module("board_worker", "worker.py")
cycle = load_module("task_cycle", "task_cycle.py")


class SelectionTests(unittest.TestCase):
    def test_only_active_stage_and_own_member_are_selected(self):
        project = {
            "id": "p1", "name": "aiMe",
            "members": [{"id": "me", "name": "NightWorkrr"}],
            "roadmap": [
                {"id": "active", "status": "active"},
                {"id": "later", "status": "planned"},
            ],
        }
        state = {"projects": [project], "tasks": [
            {"id": "planned", "project": "p1", "stage": "later", "status": "todo"},
            {"id": "foreign", "project": "p1", "stage": "active", "status": "todo", "member": "other"},
            {"id": "mine", "project": "p1", "stage": "active", "status": "todo", "member": "me"},
        ]}
        self.assertEqual(worker.next_work_task(state, project, "me")["id"], "mine")


class TransitionTests(unittest.TestCase):
    @staticmethod
    def task(max_attempts=3):
        return {
            "id": "t1", "status": "doing", "done": False,
            "attempts": 0, "max_attempts": max_attempts, "started_at": 10,
        }

    def test_failed_review_requeues_then_pass_closes(self):
        task = self.task()
        cycle.submit_candidate(task, {"report": "implemented", "commit": "abc"}, 20)
        self.assertEqual((task["status"], task["attempts"]), ("review", 1))

        cycle.apply_review(task, False, "test failed", 30)
        self.assertEqual((task["status"], task["verification_report"]), ("todo", "test failed"))

        task["status"] = "doing"
        task["started_at"] = 40
        cycle.submit_candidate(task, {"report": "fixed", "commit": "def"}, 50)
        cycle.apply_review(task, True, "all checks pass", 60)
        self.assertEqual((task["status"], task["done"], task["attempts"]), ("done", True, 2))

    def test_attempt_limit_blocks_the_task(self):
        task = self.task(max_attempts=1)
        cycle.submit_candidate(task, {"report": "candidate"}, 20)
        cycle.apply_review(task, False, "still broken", 30)
        self.assertEqual((task["status"], task["done"]), ("blocked", False))

    def test_interrupted_execution_is_retried_then_blocked(self):
        task = self.task(max_attempts=2)
        cycle.return_for_retry(task, "agent crashed")
        self.assertEqual((task["status"], task["attempts"]), ("todo", 1))
        task["status"] = "doing"
        cycle.return_for_retry(task, "agent crashed again")
        self.assertEqual((task["status"], task["attempts"]), ("blocked", 2))


if __name__ == "__main__":
    unittest.main()
