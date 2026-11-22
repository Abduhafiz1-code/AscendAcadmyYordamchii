"""Topshiriqlarni qabul qilish, avtomatik tekshirish va baholash."""
from __future__ import annotations

import logging

from aiogram import Bot

from bot.config import Settings
from bot.db import Database
from bot.keyboards import STATUS_ICONS
from bot.scoring import check_answer
from bot.services.notify import notify_user, send_submission_card
from bot.services.tasks import parse_options, unlock_new_tasks
from bot.utils import esc, fmt_points, now_iso

logger = logging.getLogger(__name__)

QUIZ_MAX_ATTEMPTS = 3


async def handle_quiz_answer(
    bot: Bot, db: Database, settings: Settings, user: dict, task: dict, option_key: str
) -> dict:
    """Test variantiga javob. Har doim 0.5–10 ball oralig'ida."""
    task_id = int(task["id"])
    options = parse_options(task)
    chosen = next((option for option in options if str(option["k"]) == str(option_key)), None)
    if not chosen:
        return {"status": "error", "text": "❌ Bu variant topilmadi. Qaytadan urinib ko'ring."}

    answer_text = f"{chosen['k']}) {chosen['t']}"
    if chosen.get("c"):
        await db.add_submission(
            task_id,
            int(user["id"]),
            "auto_passed",
            answer_text=answer_text,
            auto_score=10.0,
            auto_ratio=1.0,
            score=10.0,
            feedback="Test: to'g'ri javob",
        )
        return {
            "status": "auto_passed",
            "score": 10.0,
            "text": (
                "✅ <b>To'g'ri javob!</b>\n"
                "🏅 Ball: <b>10/10</b>\n\n"
                "Keyingi vazifa ochilishi mumkin — «📚 Vazifalarim» bo'limini tekshiring."
            ),
        }

    submission_id = await db.add_submission(
        task_id,
        int(user["id"]),
        "auto_failed",
        answer_text=answer_text,
        auto_score=0.5,
        auto_ratio=0.0,
        score=0.5,
        feedback="Test: noto'g'ri javob",
    )
    failed = await db.failed_quiz_attempts(int(user["id"]), task_id)
    if failed >= QUIZ_MAX_ATTEMPTS:
        await db.update_submission(
            submission_id,
            status="teacher_review",
            score=None,
            feedback=f"{QUIZ_MAX_ATTEMPTS} marta xato javob",
        )
        await send_submission_card(
            bot, db, submission_id, reason=f"{QUIZ_MAX_ATTEMPTS} marta xato javob — qo'lda baholang"
        )
        return {
            "status": "teacher_review",
            "text": (
                "❌ <b>Noto'g'ri javob.</b>\n\n"
                f"Urinishlar tugadi ({QUIZ_MAX_ATTEMPTS} marta). Javobingiz ustozga yuborildi, "
                "ustoz yakuniy ballni qo'yadi."
            ),
        }

    left = QUIZ_MAX_ATTEMPTS - failed
    return {
        "status": "auto_failed",
        "score": 0.5,
        "text": (
            "❌ <b>Noto'g'ri javob.</b>\n"
            f"🔁 Qolgan urinishlar: <b>{left}</b>\n\n"
            "Yana urinib ko'ring."
        ),
    }


async def handle_answer(
    bot: Bot,
    db: Database,
    settings: Settings,
    user: dict,
    task: dict,
    answer_text: str | None = None,
    file_id: str | None = None,
    file_type: str | None = None,
) -> dict:
    """Yozma javob yoki faylni qabul qiladi (testdan tashqari vazifalar)."""
    task_id = int(task["id"])
    text = (answer_text or "").strip()
    kind = task.get("kind")

    needs_manual = kind == "manual" or bool(file_id) or not text
    if needs_manual:
        submission_id = await db.add_submission(
            task_id,
            int(user["id"]),
            "teacher_review",
            answer_text=text or None,
            file_id=file_id,
            file_type=file_type,
            feedback="Qo'lda tekshirish",
        )
        await send_submission_card(bot, db, submission_id, reason="Qo'lda tekshirish kerak")
        return {
            "status": "teacher_review",
            "text": (
                "📨 <b>Javobingiz qabul qilindi.</b>\n\n"
                "Bu vazifani ustoz qo'lda tekshiradi va ball qo'yadi. "
                "Natija shu chatga yuboriladi."
            ),
        }

    result = check_answer(text, task.get("answer_key"))
    pass_score = float(task["pass_score"])
    passed = result.score >= pass_score
    feedback = f"{result.matched}/{result.total} kalit so'z topildi"

    submission_id = await db.add_submission(
        task_id,
        int(user["id"]),
        "auto_passed" if passed else "teacher_review",
        answer_text=text,
        auto_score=result.score,
        auto_ratio=result.ratio,
        score=result.score if passed else None,
        feedback=feedback,
    )

    if passed:
        bonus_line = ""
        if result.score < 10:
            bonus_line = (
                "\n🔄 Ballni yaxshilash uchun qayta topshirishingiz mumkin — "
                "eng yaxshi natijangiz hisoblanadi."
            )
        return {
            "status": "auto_passed",
            "score": result.score,
            "submission_id": submission_id,
            "text": (
                "✅ <b>To'g'ri!</b>\n"
                f"🏅 Ball: <b>{fmt_points(result.score)}/10</b>\n"
                f"📊 Aniqlik: {round(result.ratio * 100)}% ({feedback})"
                f"{bonus_line}"
            ),
        }

    await send_submission_card(
        bot,
        db,
        submission_id,
        reason=f"Avtomatik tekshiruv: {feedback} — qo'lda baholang",
    )
    return {
        "status": "teacher_review",
        "submission_id": submission_id,
        "text": (
            "👀 <b>Javob to'liq to'g'ri emas.</b>\n"
            f"📊 Aniqlik: {round(result.ratio * 100)}% ({feedback})\n\n"
            "Javobingiz ustozga yuborildi — u yakuniy ballni qo'yadi."
        ),
    }


async def handle_not_done(bot: Bot, db: Database, user: dict, task: dict) -> bool:
    """O'quvchi vazifani bajara olmasa — haqiqiy ustozga yuboriladi."""
    task_id = int(task["id"])
    if await db.pending_for_task(int(user["id"]), task_id):
        return False
    submission_id = await db.add_submission(
        task_id,
        int(user["id"]),
        "not_done",
        feedback="O'quvchi vazifani bajara olmadi",
    )
    await db.mark_access(int(user["id"]), task_id, missing_reported=1)
    await send_submission_card(bot, db, submission_id, reason="O'quvchi vazifani bajarmadi")
    return True


async def grade_submission(
    bot: Bot,
    db: Database,
    submission_id: int,
    score: float | None,
    teacher: dict,
    retry: bool = False,
    max_attempts: int = 5,
) -> dict | None:
    """Ustoz bahosi yoki qayta topshirishga ruxsat."""
    submission = await db.get_submission_full(submission_id)
    if not submission:
        return None
    student = await db.get_user_by_id(int(submission["user_pk"]))
    if not student:
        return None

    if retry:
        await db.update_submission(
            submission_id,
            status="rejected",
            score=None,
            feedback="Ustoz qayta topshirishga ruxsat berdi",
            checked_by=int(teacher["id"]),
            checked_at=now_iso(),
        )
        text = (
            "🔁 <b>Qayta topshirishga ruxsat berildi</b>\n\n"
            f"📝 Vazifa: <b>{esc(submission['task_title'])}</b>\n"
            "«📚 Vazifalarim» bo'limidan qayta topshirishingiz mumkin."
        )
        await notify_user(bot, student, text)
        return {"status": "retry", "student_text": text}

    score = max(0.0, min(10.0, float(score or 0)))
    passed = score >= float(submission["pass_score"])
    await db.update_submission(
        submission_id,
        status="graded",
        score=score,
        feedback="Ustoz baholadi",
        checked_by=int(teacher["id"]),
        checked_at=now_iso(),
    )

    titles = await unlock_new_tasks(db, student)
    lines = [
        "✅ <b>Ustoz baholadi</b>",
        "",
        f"📝 Vazifa: <b>{esc(submission['task_title'])}</b>",
        f"🏅 Ball: <b>{fmt_points(score)}/10</b>",
        "🎯 Natija: " + ("o'tdingiz ✅" if passed else "o'tish ballidan past ⚠️"),
    ]
    if titles:
        lines += ["", "🎉 <b>Yangi vazifa ochildi:</b>"]
        lines += [f"• {esc(title)}" for title in titles]
    if not passed:
        remaining = max(
            0,
            max_attempts
            - (await db.attempt_counts(int(student["id"]))).get(int(submission["task_id"]), 0),
        )
        if remaining:
            lines += ["", f"🔁 Qayta urinish uchun imkoniyat: <b>{remaining}</b>"]
    text = "\n".join(lines)
    await notify_user(bot, student, text)
    return {"status": "graded", "student_text": text, "passed": passed}


def submission_status_label(status: str) -> str:
    labels = {
        "auto_passed": "Avtomatik o'tdi",
        "graded": "Ustoz baholadi",
        "auto_failed": "Xato javob",
        "teacher_review": "Ustoz tekshiruvida",
        "not_done": "Bajarilmagan",
        "rejected": "Qayta topshirish",
    }
    return f"{STATUS_ICONS.get(status, '•')} {labels.get(status, status)}"
