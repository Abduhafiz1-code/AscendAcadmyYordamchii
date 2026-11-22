"""Servislar integratsiyasi: avtomatik tekshirish, baholash, muddat nazorati.

Tarmoqqa chiqmaydigan FakeBot ishlatiladi.
"""
import json
import os
import tempfile
import unittest
from datetime import timedelta

from bot.config import Settings
from bot.db import Database
from bot.services.scheduler import check_deadlines
from bot.services.submissions import grade_submission, handle_answer, handle_not_done
from bot.services.tasks import build_states
from bot.utils import now_utc


class FakeBot:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_message(self, chat_id, text, reply_markup=None, parse_mode="HTML"):
        self.sent.append(
            {"chat_id": int(chat_id), "text": text, "markup": reply_markup, "parse_mode": parse_mode}
        )
        return None

    async def send_photo(self, chat_id, photo):
        self.sent.append({"chat_id": int(chat_id), "photo": photo})
        return None

    send_document = send_photo
    send_voice = send_photo
    send_video = send_photo
    send_audio = send_photo

    def to(self, chat_id: int) -> list[dict]:
        return [item for item in self.sent if item["chat_id"] == chat_id]


class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Database(os.path.join(self.tmp.name, "test.db"))
        await self.db.connect()
        self.settings = Settings(default_pass_score=6, max_attempts=5)
        self.bot = FakeBot()

        self.teacher = await self.db.create_user(9001, "teacher", "Ustoz")
        await self.db.update_user(self.teacher["id"], role="teacher", status="active")
        self.student = await self.db.create_user(1001, "student", "Ali")
        await self.db.update_user(
            self.student["id"], status="active", group_name="G1"
        )
        self.student = await self.db.get_user(1001)
        self.teacher = await self.db.get_user(9001)

        self.module_id = await self.db.create_module("M1")
        self.text_task_id = await self.db.create_task(
            module_id=self.module_id,
            title="Fotosintez",
            kind="text",
            answer_key="fotosintez+xlorofill",
            pass_score=6,
            sort_order=1,
        )
        self.next_task_id = await self.db.create_task(
            module_id=self.module_id,
            title="Keyingi",
            kind="text",
            answer_key="5",
            pass_score=6,
            sort_order=2,
        )
        self.text_task = await self.db.get_task(self.text_task_id)
        self.next_task = await self.db.get_task(self.next_task_id)

    async def asyncTearDown(self):
        await self.db.close()
        self.tmp.cleanup()

    # ------------------------------------------------------------------ avtomatik tekshirish
    async def test_text_full_answer_scores_ten(self):
        result = await handle_answer(
            self.bot, self.db, self.settings, self.student, self.text_task,
            "Fotosintez xlorofill yordamida sodir bo'ladi",
        )
        self.assertEqual(result["status"], "auto_passed")
        self.assertEqual(result["score"], 10.0)

        rows = await self.db.user_submissions(self.student["id"])
        self.assertEqual(rows[0]["status"], "auto_passed")
        self.assertEqual(rows[0]["score"], 10.0)
        self.assertEqual(self.bot.to(9001), [])  # ustozga yuborilmadi

    async def test_text_partial_answer_goes_to_teacher(self):
        result = await handle_answer(
            self.bot, self.db, self.settings, self.student, self.text_task,
            "Fotosintez deb ataladi",
        )
        self.assertEqual(result["status"], "teacher_review")
        self.assertTrue(self.bot.to(9001))
        self.assertIn("Sabab", self.bot.to(9001)[0]["text"])

        rows = await self.db.user_submissions(self.student["id"])
        self.assertIsNone(rows[0]["score"])
        self.assertEqual(rows[0]["status"], "teacher_review")

    async def test_manual_file_goes_to_teacher(self):
        result = await handle_answer(
            self.bot, self.db, self.settings, self.student, self.text_task,
            None, "file-id", "photo",
        )
        self.assertEqual(result["status"], "teacher_review")
        self.assertTrue(self.bot.to(9001))

    async def test_not_done_creates_case(self):
        created = await handle_not_done(self.bot, self.db, self.student, self.text_task)
        self.assertTrue(created)
        again = await handle_not_done(self.bot, self.db, self.student, self.text_task)
        self.assertFalse(again)
        pending = await self.db.pending_submissions()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["status"], "not_done")

    # ------------------------------------------------------------------ baholash
    async def test_teacher_grade_unlocks_next_and_notifies(self):
        await handle_answer(
            self.bot, self.db, self.settings, self.student, self.text_task,
            "faqat fotosintez",  # qisman
        )
        pending = await self.db.pending_submissions()
        submission_id = pending[0]["id"]

        result = await grade_submission(
            self.bot, self.db, submission_id, 8.0, self.teacher
        )
        self.assertIsNotNone(result)
        saved = await self.db.get_submission(submission_id)
        self.assertEqual(saved["status"], "graded")
        self.assertEqual(saved["score"], 8.0)

        student_messages = self.bot.to(1001)
        self.assertTrue(any("8" in message.get("text", "") for message in student_messages))

        states = {state.task["id"]: state for state in await build_states(self.db, self.student)}
        self.assertTrue(states[self.next_task_id].unlocked)

    async def test_teacher_retry_resets_status(self):
        await handle_not_done(self.bot, self.db, self.student, self.text_task)
        pending = await self.db.pending_submissions()
        result = await grade_submission(
            self.bot, self.db, pending[0]["id"], None, self.teacher, retry=True
        )
        self.assertEqual(result["status"], "retry")
        saved = await self.db.get_submission(pending[0]["id"])
        self.assertEqual(saved["status"], "rejected")

    async def test_score_clamped(self):
        await handle_not_done(self.bot, self.db, self.student, self.text_task)
        pending = await self.db.pending_submissions()
        await grade_submission(self.bot, self.db, pending[0]["id"], 25, self.teacher)
        saved = await self.db.get_submission(pending[0]["id"])
        self.assertEqual(saved["score"], 10.0)

    # ------------------------------------------------------------------ muddat nazorati
    async def _set_deadline(self, task_id: int, delta: timedelta) -> None:
        access = await self.db.get_access(self.student["id"], task_id)
        if access is None:
            await self.db.ensure_access(self.student["id"], task_id, 1)
        deadline = (now_utc() + delta).isoformat(timespec="seconds")
        await self.db.execute(
            "UPDATE task_access SET deadline_at = ?, reminded = 0, missing_reported = 0 "
            "WHERE user_id = ? AND task_id = ?",
            (deadline, self.student["id"], task_id),
        )

    async def test_overdue_task_reported_once(self):
        await build_states(self.db, self.student)
        await self._set_deadline(self.text_task_id, timedelta(hours=-2))

        await check_deadlines(self.bot, self.db, self.settings)
        pending = await self.db.pending_submissions()
        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["status"], "not_done")
        self.assertTrue(self.bot.to(9001))
        self.assertTrue(
            any("muddati" in message.get("text", "").lower() for message in self.bot.to(1001))
        )

        sent_before = len(self.bot.sent)
        await check_deadlines(self.bot, self.db, self.settings)
        self.assertEqual(len(self.bot.sent), sent_before)

    async def test_passed_task_not_reported_overdue(self):
        await self.db.add_submission(
            self.text_task_id, self.student["id"], "auto_passed", score=9
        )
        await build_states(self.db, self.student)
        await self._set_deadline(self.text_task_id, timedelta(hours=-2))

        await check_deadlines(self.bot, self.db, self.settings)
        self.assertEqual(await self.db.pending_submissions(), [])

    async def test_reminder_before_deadline(self):
        await build_states(self.db, self.student)
        await self._set_deadline(self.text_task_id, timedelta(hours=12))

        await check_deadlines(self.bot, self.db, self.settings)
        messages = self.bot.to(1001)
        self.assertTrue(any("Eslatma" in message.get("text", "") for message in messages))
        access = await self.db.get_access(self.student["id"], self.text_task_id)
        self.assertEqual(access["reminded"], 1)

    # ------------------------------------------------------------------ test savoli
    async def test_quiz_correct_and_wrong(self):
        from bot.services.submissions import handle_quiz_answer

        options = [
            {"k": "A", "t": "4", "c": True},
            {"k": "B", "t": "5", "c": False},
        ]
        quiz_id = await self.db.create_task(
            module_id=self.module_id,
            title="Test",
            kind="quiz",
            options=json.dumps(options),
            pass_score=6,
            sort_order=3,
        )
        quiz = await self.db.get_task(quiz_id)

        correct = await handle_quiz_answer(
            self.bot, self.db, self.settings, self.student, quiz, "A"
        )
        self.assertEqual(correct["status"], "auto_passed")

        await self.db.create_user(1002, "student2", "Vali")
        student2 = await self.db.get_user(1002)
        await self.db.update_user(student2["id"], status="active")
        student2 = await self.db.get_user(1002)

        wrong = await handle_quiz_answer(
            self.bot, self.db, self.settings, student2, quiz, "B"
        )
        self.assertEqual(wrong["status"], "auto_failed")
        self.assertEqual(wrong["score"], 0.5)


if __name__ == "__main__":
    unittest.main()
