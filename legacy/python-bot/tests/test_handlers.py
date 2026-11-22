"""Handlerlar darajasidagi oqim testlari (aiogram update'siz, stub obyektlar bilan)."""
import json
import os
import tempfile
import unittest
from types import SimpleNamespace

from bot.config import Settings
from bot.db import Database
from bot.handlers import common, student, teacher
from bot.states import Reg


class StubState:
    def __init__(self):
        self.data: dict = {}
        self.state = None

    async def update_data(self, **kwargs):
        self.data.update(kwargs)

    async def get_data(self):
        return dict(self.data)

    async def set_state(self, state):
        self.state = state

    async def clear(self):
        self.data.clear()
        self.state = None


class StubMessage:
    def __init__(self, text=None, user=None, caption=None):
        self.text = text
        self.caption = caption
        self.from_user = user
        self.chat = SimpleNamespace(id=(user.id if user else 0))
        self.photo = None
        self.document = None
        self.voice = None
        self.video = None
        self.audio = None
        self.sent: list[dict] = []

    async def answer(self, text, reply_markup=None, **kwargs):
        self.sent.append({"text": text, "markup": reply_markup})
        return self

    async def edit_text(self, text, reply_markup=None, **kwargs):
        self.sent.append({"text": text, "markup": reply_markup})
        return self


class StubCallback:
    def __init__(self, data, user, message=None):
        self.data = data
        self.from_user = user
        self.message = message or StubMessage(user=user)
        self.answers: list = []

    async def answer(self, text=None, show_alert=False):
        self.answers.append(text)


class StubBot:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_message(self, chat_id, text, reply_markup=None, parse_mode="HTML"):
        self.sent.append({"chat_id": int(chat_id), "text": text})
        return None

    async def send_photo(self, chat_id, photo):
        self.sent.append({"chat_id": int(chat_id), "photo": photo})
        return None

    send_document = send_photo
    send_voice = send_photo
    send_video = send_photo
    send_audio = send_photo


def tg_user(user_id: int, name: str = "Ali Valiyev"):
    return SimpleNamespace(id=user_id, username=f"user{user_id}", full_name=name)


class HandlerFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Database(os.path.join(self.tmp.name, "test.db"))
        await self.db.connect()
        self.settings = Settings(default_pass_score=6, max_attempts=5)
        self.bot = StubBot()

        self.teacher = await self.db.create_user(9001, "teacher", "Ustoz Karimov")
        await self.db.update_user(self.teacher["id"], role="teacher", status="active")
        self.teacher = await self.db.get_user(9001)

        self.module_id = await self.db.create_module("Matematika")
        self.text_task_id = await self.db.create_task(
            module_id=self.module_id,
            title="Yozma vazifa",
            kind="text",
            answer_key="4|to'rt",
            pass_score=6,
            sort_order=1,
        )
        self.quiz_task_id = await self.db.create_task(
            module_id=self.module_id,
            title="Test vazifa",
            kind="quiz",
            options=json.dumps(
                [
                    {"k": "A", "t": "3", "c": False},
                    {"k": "B", "t": "4", "c": True},
                ]
            ),
            pass_score=6,
            sort_order=2,
        )

    async def asyncTearDown(self):
        await self.db.close()
        self.tmp.cleanup()

    async def _make_active_student(self, tg_id: int = 1001, name: str = "Ali Valiyev") -> dict:
        await self.db.create_user(tg_id, f"student{tg_id}", name)
        user = await self.db.get_user(tg_id)
        await self.db.update_user(user["id"], status="active", group_name="G1")
        return await self.db.get_user(tg_id)

    # ------------------------------------------------------------------ ro'yxatdan o'tish
    async def test_registration_request_and_teacher_approval(self):
        state = StubState()
        tg = tg_user(5001)
        await common.start(StubMessage(user=tg, text="/start"), state, self.db, self.settings, None, self.bot)
        self.assertEqual(state.state, Reg.name)

        await common.reg_name(StubMessage(text="Ali Valiyev", user=tg), state)
        await common.reg_group(StubMessage(text="Frontend-101", user=tg), state)
        await common.reg_phone_text(
            StubMessage(text="⏭ O'tkazib yuborish", user=tg), state, self.db, self.settings
        )
        self.assertEqual(state.state, Reg.code)

        db_user = await self.db.get_user(5001)
        callback = StubCallback("reg:request", tg, StubMessage(user=tg))
        await common.reg_request(callback, state, self.db, self.bot, db_user)

        created = await self.db.get_user(5001)
        self.assertEqual(created["status"], "awaiting")
        self.assertEqual(created["group_name"], "Frontend-101")
        self.assertTrue(any(msg["chat_id"] == 9001 for msg in self.bot.sent))

        # Ustoz tasdiqlaydi
        approve = StubCallback(f"u:ok:{created['id']}", tg_user(9001, "Ustoz"))
        await teacher.approve_user(approve, self.db, self.teacher, self.bot)
        approved = await self.db.get_user(5001)
        self.assertEqual(approved["status"], "active")
        self.assertEqual(approved["role"], "student")
        self.assertTrue(any(msg["chat_id"] == 5001 for msg in self.bot.sent))

    # ------------------------------------------------------------------ o'quvchi vazifalari
    async def test_student_views_tasks_and_solves_quiz(self):
        user = await self._make_active_student()
        tg = tg_user(1001)
        # Test vazifasi ikkinchi bo'lgani uchun avval birinchi vazifani yakunlaymiz.
        await self.db.add_submission(
            self.text_task_id, user["id"], "auto_passed", score=10
        )

        listing = StubMessage(user=tg)
        await student.show_modules(listing, self.db, user)
        self.assertTrue(listing.sent)
        self.assertIn("Vazifalarim", listing.sent[0]["text"])

        task_cb = StubCallback(f"task:{self.quiz_task_id}", tg)
        await student.open_task(task_cb, self.db, user, self.settings)
        self.assertIn("Test vazifa", task_cb.message.sent[-1]["text"])

        answer_cb = StubCallback(f"q:{self.quiz_task_id}:B", tg)
        await student.quiz_answer(answer_cb, self.db, user, self.settings, self.bot)
        self.assertTrue(answer_cb.message.sent)
        self.assertIn("To'g'ri", answer_cb.message.sent[-1]["text"])

        best = await self.db.best_scores(user["id"])
        self.assertEqual(best[self.quiz_task_id], 10.0)

    async def test_student_submits_text_answer(self):
        user = await self._make_active_student()
        tg = tg_user(1001)
        state = StubState()

        begin = StubCallback(f"s:{self.text_task_id}", tg)
        await student.begin_submission(begin, state, self.db, user, self.settings)
        self.assertEqual(state.data.get("task_id"), self.text_task_id)

        message = StubMessage(text="Javob: 4", user=tg)
        await student.receive_answer(message, state, self.db, user, self.settings, self.bot)
        self.assertIsNone(state.state)
        self.assertIn("To'g'ri", message.sent[-1]["text"])

        best = await self.db.best_scores(user["id"])
        self.assertEqual(best[self.text_task_id], 10.0)

    async def test_wrong_text_answer_sent_to_teacher(self):
        user = await self._make_active_student()
        tg = tg_user(1001)
        state = StubState()
        begin = StubCallback(f"s:{self.text_task_id}", tg)
        await student.begin_submission(begin, state, self.db, user, self.settings)

        message = StubMessage(text="Bilmayman", user=tg)
        await student.receive_answer(message, state, self.db, user, self.settings, self.bot)
        self.assertIn("ustozga", message.sent[-1]["text"].lower())
        pending = await self.db.pending_submissions()
        self.assertEqual(len(pending), 1)
        self.assertTrue(any(msg["chat_id"] == 9001 for msg in self.bot.sent))

    # ------------------------------------------------------------------ ustoz baholashi
    async def test_teacher_panel_grading_flow(self):
        user = await self._make_active_student()
        submission_id = await self.db.add_submission(
            self.text_task_id,
            user["id"],
            "teacher_review",
            answer_text="javob",
            auto_ratio=0.5,
        )

        panel = StubMessage(user=tg_user(9001, "Ustoz"))
        await teacher.open_panel(panel, self.db, self.teacher)
        self.assertIn("Ustoz paneli", panel.sent[0]["text"])

        pending_cb = StubCallback("panel:pending", tg_user(9001, "Ustoz"))
        await teacher.pending_list(pending_cb, self.db, self.teacher)
        self.assertIn("Tekshirish", pending_cb.message.sent[-1]["text"])

        detail_cb = StubCallback(f"sub:{submission_id}", tg_user(9001, "Ustoz"))
        await teacher.submission_detail(detail_cb, self.db, self.teacher, self.bot)
        self.assertIn("Yangi ish", detail_cb.message.sent[-1]["text"])

        grade_cb = StubCallback(f"g:{submission_id}:8", tg_user(9001, "Ustoz"))
        await teacher.grade(grade_cb, self.db, self.teacher, self.bot, self.settings)
        saved = await self.db.get_submission(submission_id)
        self.assertEqual(saved["status"], "graded")
        self.assertEqual(saved["score"], 8.0)

    # ------------------------------------------------------------------ vazifa qo'shish ustasi
    async def test_task_wizard_creates_quiz_task(self):
        state = StubState()
        teacher_tg = tg_user(9001, "Ustoz")

        start_cb = StubCallback("panel:new", teacher_tg)
        await teacher.new_task_start(start_cb, state, self.db, self.teacher)

        module_cb = StubCallback(f"nt:mod:{self.module_id}", teacher_tg)
        await teacher.new_task_module(module_cb, state, self.db, self.teacher)
        self.assertIsNotNone(state.state)

        await teacher.new_task_title(
            StubMessage(text="Yangi test", user=teacher_tg), state, self.teacher
        )
        await teacher.new_task_description(
            StubMessage(text="/skip", user=teacher_tg), state, self.teacher
        )

        kind_cb = StubCallback("nt:kind:quiz", teacher_tg)
        await teacher.new_task_kind(kind_cb, state, self.teacher)

        await teacher.new_task_options(
            StubMessage(text="* 10\n11\n12", user=teacher_tg), state, self.teacher
        )
        await teacher.new_task_pass_score(
            StubMessage(text="7", user=teacher_tg), state, self.teacher, self.settings
        )
        await teacher.new_task_deadline(
            StubMessage(text="2", user=teacher_tg), state, self.teacher
        )

        bonus_cb = StubCallback("nt:bonus:0", teacher_tg)
        await teacher.new_task_bonus(bonus_cb, state, self.teacher)
        save_cb = StubCallback("nt:save", teacher_tg)
        await teacher.new_task_save(save_cb, state, self.db, self.teacher)
        self.assertIsNone(state.state)

        tasks = await self.db.list_tasks(module_id=self.module_id, active_only=False)
        created = next(task for task in tasks if task["title"] == "Yangi test")
        self.assertEqual(created["kind"], "quiz")
        self.assertEqual(created["pass_score"], 7)
        self.assertEqual(created["deadline_days"], 2)
        self.assertEqual(created["is_bonus"], 0)
        self.assertTrue(json.loads(created["options"]))

    async def test_task_wizard_creates_new_module(self):
        state = StubState()
        teacher_tg = tg_user(9001, "Ustoz")

        start_cb = StubCallback("panel:new", teacher_tg)
        await teacher.new_task_start(start_cb, state, self.db, self.teacher)
        new_module_cb = StubCallback("nt:mod:new", teacher_tg)
        await teacher.new_task_module(new_module_cb, state, self.db, self.teacher)

        await teacher.new_task_module_name(
            StubMessage(text="Yangi modul", user=teacher_tg), state, self.db, self.teacher
        )
        self.assertEqual(state.data.get("module_title"), "Yangi modul")
        modules = await self.db.list_modules(active_only=False)
        self.assertTrue(any(module["title"] == "Yangi modul" for module in modules))

    async def test_teacher_cannot_grade_twice(self):
        user = await self._make_active_student()
        submission_id = await self.db.add_submission(
            self.text_task_id, user["id"], "teacher_review", answer_text="javob"
        )
        first = StubCallback(f"g:{submission_id}:7", tg_user(9001, "Ustoz"))
        await teacher.grade(first, self.db, self.teacher, self.bot, self.settings)
        second = StubCallback(f"g:{submission_id}:10", tg_user(9001, "Ustoz"))
        await teacher.grade(second, self.db, self.teacher, self.bot, self.settings)
        saved = await self.db.get_submission(submission_id)
        self.assertEqual(saved["score"], 7.0)


if __name__ == "__main__":
    unittest.main()
