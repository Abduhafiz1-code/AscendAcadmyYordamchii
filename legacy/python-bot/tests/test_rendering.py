"""Xabarlar va klaviaturalar renderini tekshirish (HTML, uzunlik, callback)."""
import os
import tempfile
import unittest

from bot.db import Database
from bot.handlers.student import _task_card
from bot.keyboards import pending_list_kb, task_kb
from bot.services.notify import submission_card_text
from bot.services.rating import rating_text
from bot.services.tasks import build_states


def all_buttons(keyboard):
    for row in keyboard.inline_keyboard:
        for button in row:
            yield button


class RenderingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Database(os.path.join(self.tmp.name, "test.db"))
        await self.db.connect()
        self.student = await self.db.create_user(1001, "student", "Ali <b>Valiyev</b>")
        await self.db.update_user(
            self.student["id"], status="active", group_name="G1"
        )
        self.student = await self.db.get_user(1001)
        self.module_id = await self.db.create_module("M1")
        self.task_id = await self.db.create_task(
            module_id=self.module_id,
            title="Vazifa <1>",
            description="Tavsif & izoh",
            kind="text",
            answer_key="4",
            pass_score=6,
            sort_order=1,
            deadline_days=2,
        )
        self.task = await self.db.get_task(self.task_id)

    async def asyncTearDown(self):
        await self.db.close()
        self.tmp.cleanup()

    async def test_task_card_and_keyboard(self):
        state = (await build_states(self.db, self.student))[0]
        text = _task_card(self.task, state, "M1", 5)
        self.assertIn("Vazifa &lt;1&gt;", text)
        self.assertIn("Tavsif &amp; izoh", text)
        self.assertIn("Ochiq", text)
        self.assertLess(len(text), 4096)

        keyboard = task_kb(self.task, state, [])
        for button in all_buttons(keyboard):
            self.assertLessEqual(len(button.callback_data.encode()), 64)
        labels = [button.text for button in all_buttons(keyboard)]
        self.assertTrue(any("Javob yuborish" in label for label in labels))

    async def test_submission_card_escapes_user_input(self):
        submission_id = await self.db.add_submission(
            self.task_id,
            self.student["id"],
            "teacher_review",
            answer_text="<script>alert(1)</script> & 4",
            auto_ratio=0.5,
        )
        submission = await self.db.get_submission_full(submission_id)
        text = submission_card_text(submission, "Qo'lda tekshirish")
        self.assertIn("&lt;script&gt;", text)
        self.assertNotIn("<script>", text)
        self.assertIn("&amp;", text)
        self.assertLess(len(text), 4096)

    async def test_long_answer_truncated(self):
        submission_id = await self.db.add_submission(
            self.task_id,
            self.student["id"],
            "teacher_review",
            answer_text="a" * 5000,
        )
        submission = await self.db.get_submission_full(submission_id)
        text = submission_card_text(submission)
        self.assertLess(len(text), 1600)

    async def test_rating_text(self):
        await self.db.add_submission(
            self.task_id, self.student["id"], "auto_passed", score=8
        )
        text = await rating_text(self.db, self.student, "all")
        self.assertIn("🥇", text)
        self.assertIn("Ali", text)
        self.assertIn("G1", text)
        self.assertLess(len(text), 4096)

    async def test_pending_keyboard_callback_length(self):
        for index in range(20):
            await self.db.add_submission(
                self.task_id,
                self.student["id"],
                "teacher_review",
                answer_text=f"javob {index}",
            )
        rows = await self.db.pending_submissions(limit=20)
        keyboard = pending_list_kb(rows)
        for button in all_buttons(keyboard):
            self.assertLessEqual(len(button.callback_data.encode()), 64)


if __name__ == "__main__":
    unittest.main()
