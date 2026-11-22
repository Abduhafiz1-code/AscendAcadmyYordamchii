"""Vazifalar ochilishi, reyting va dispatcher smoke-testlari."""
import os
import tempfile
import unittest

from bot.config import Settings
from bot.db import Database
from bot.main import build_dispatcher
from bot.services.rating import build_leaderboard
from bot.services.tasks import build_states


class FlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Database(os.path.join(self.tmp.name, "test.db"))
        await self.db.connect()

        self.student = await self.db.create_user(1001, "student1", "Ali Valiyev")
        await self.db.update_user(
            self.student["id"], status="active", group_name="Frontend-101"
        )
        self.student = await self.db.get_user(1001)

        self.module_id = await self.db.create_module("Matematika")
        self.task1 = await self.db.create_task(
            module_id=self.module_id,
            title="1-vazifa",
            kind="text",
            answer_key="4",
            pass_score=6,
            sort_order=1,
            deadline_days=2,
        )
        self.task2 = await self.db.create_task(
            module_id=self.module_id,
            title="2-vazifa",
            kind="text",
            answer_key="5",
            pass_score=6,
            sort_order=2,
        )
        self.bonus = await self.db.create_task(
            module_id=self.module_id,
            title="Bonus",
            kind="text",
            answer_key="6",
            pass_score=6,
            sort_order=3,
            is_bonus=1,
            unlock_after=self.task2,
        )

    async def asyncTearDown(self):
        await self.db.close()
        self.tmp.cleanup()

    async def _states(self):
        return await build_states(self.db, self.student)

    async def test_first_task_open_rest_locked(self):
        states = await self._states()
        by_id = {s.task["id"]: s for s in states}
        self.assertTrue(by_id[self.task1].unlocked)
        self.assertFalse(by_id[self.task2].unlocked)
        self.assertFalse(by_id[self.bonus].unlocked)

    async def test_deadline_created_on_first_open(self):
        await self._states()
        access = await self.db.get_access(self.student["id"], self.task1)
        self.assertIsNotNone(access)
        self.assertIsNotNone(access["deadline_at"])
        self.assertIsNone((await self.db.get_access(self.student["id"], self.task2)))

    async def test_passing_unlocks_next_then_bonus(self):
        await self.db.add_submission(
            self.task1, self.student["id"], "auto_passed", score=10, auto_score=10
        )
        states = await self._states()
        by_id = {s.task["id"]: s for s in states}
        self.assertTrue(by_id[self.task2].unlocked)
        self.assertFalse(by_id[self.bonus].unlocked)

        await self.db.add_submission(
            self.task2, self.student["id"], "auto_passed", score=9, auto_score=9
        )
        states = await self._states()
        by_id = {s.task["id"]: s for s in states}
        self.assertTrue(by_id[self.bonus].unlocked)

    async def test_failed_does_not_unlock(self):
        await self.db.add_submission(
            self.task1, self.student["id"], "auto_failed", score=0.5
        )
        states = await self._states()
        by_id = {s.task["id"]: s for s in states}
        self.assertFalse(by_id[self.task2].unlocked)

    async def test_best_score_counts_once(self):
        await self.db.add_submission(
            self.task1, self.student["id"], "auto_passed", score=7
        )
        await self.db.add_submission(
            self.task1, self.student["id"], "auto_passed", score=10
        )
        best = await self.db.best_scores(self.student["id"])
        self.assertEqual(best[self.task1], 10)

        rows = await build_leaderboard(self.db)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["points"], 10)
        self.assertEqual(rows[0]["passed"], 1)

    async def test_bonus_points_in_leaderboard(self):
        await self.db.add_submission(
            self.task1, self.student["id"], "auto_passed", score=10
        )
        await self.db.add_submission(
            self.task2, self.student["id"], "auto_passed", score=10
        )
        await self.db.add_submission(
            self.bonus, self.student["id"], "auto_passed", score=10
        )
        rows = await build_leaderboard(self.db)
        self.assertEqual(rows[0]["points"], 30)
        self.assertEqual(rows[0]["passed"], 3)

    async def test_awaiting_student_not_in_rating(self):
        await self.db.create_user(1002, "student2", "Hali tasdiqlanmagan")
        rows = await build_leaderboard(self.db)
        names = [row["user"]["tg_id"] for row in rows]
        self.assertNotIn(1002, names)


class DispatcherTests(unittest.IsolatedAsyncioTestCase):
    async def test_dispatcher_builds(self):
        tmp = tempfile.TemporaryDirectory()
        db = Database(os.path.join(tmp.name, "test.db"))
        await db.connect()
        try:
            settings = Settings(bot_token="123456:TEST", admin_ids=frozenset({1}))
            dispatcher = build_dispatcher(db, settings)
            self.assertIn("message", dispatcher.observers)
            self.assertTrue(dispatcher.sub_routers)
        finally:
            await db.close()
            tmp.cleanup()


if __name__ == "__main__":
    unittest.main()
