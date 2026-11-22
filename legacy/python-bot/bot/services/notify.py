"""Xabarnomalar: ustozlarga, o'quvchilarga, topshiriq kartochkalari."""
from __future__ import annotations

import logging

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError

from bot.db import Database
from bot.keyboards import grade_kb
from bot.utils import esc, fmt_dt, user_mention

logger = logging.getLogger(__name__)

FILE_SENDERS = {
    "photo": ("send_photo", "photo"),
    "document": ("send_document", "document"),
    "voice": ("send_voice", "voice"),
    "video": ("send_video", "video"),
    "audio": ("send_audio", "audio"),
}


async def safe_send(
    bot: Bot, chat_id: int, text: str, reply_markup=None, parse_mode: str | None = "HTML"
) -> bool:
    try:
        await bot.send_message(
            chat_id, text, reply_markup=reply_markup, parse_mode=parse_mode
        )
        return True
    except TelegramAPIError as error:
        logger.warning("Xabar yuborilmadi (%s): %s", chat_id, error)
        return False


async def notify_teachers(bot: Bot, db: Database, text: str, reply_markup=None) -> int:
    sent = 0
    for teacher in await db.teachers():
        if await safe_send(bot, int(teacher["tg_id"]), text, reply_markup):
            sent += 1
    return sent


async def notify_students(bot: Bot, db: Database, text: str) -> int:
    sent = 0
    for student in await db.active_students():
        if await safe_send(bot, int(student["tg_id"]), text):
            sent += 1
    return sent


async def notify_user(bot: Bot, user: dict, text: str, reply_markup=None) -> bool:
    if not user:
        return False
    return await safe_send(bot, int(user["tg_id"]), text, reply_markup)


async def send_attachment(bot: Bot, chat_id: int, submission: dict) -> None:
    file_id = submission.get("file_id")
    file_type = submission.get("file_type")
    if not file_id or file_type not in FILE_SENDERS:
        return
    method_name, argument = FILE_SENDERS[file_type]
    method = getattr(bot, method_name)
    try:
        await method(chat_id=chat_id, **{argument: file_id})
    except TelegramAPIError as error:
        logger.warning("Fayl yuborilmadi (%s): %s", chat_id, error)


SUBMISSION_REASONS = {
    "teacher_review": "Avtomatik tekshiruv yetarli bo'lmadi — qo'lda baholang",
    "not_done": "O'quvchi vazifani bajarmadi",
    "auto_failed": "Bir necha marta xato javob — qo'lda baholang",
    "deadline": "Muddat o'tdi — vazifa bajarilmagan",
}


def submission_card_text(submission: dict, reason: str | None = None) -> str:
    answer = submission.get("answer_text") or ""
    if len(answer) > 800:
        answer = answer[:800] + "…"
    kind = submission.get("task_kind")
    kind_label = {"quiz": "test", "text": "yozma", "manual": "fayl/rasm"}.get(kind, kind or "—")
    lines = [
        f"📥 <b>Yangi ish #{submission['id']}</b>",
        "",
        f"👤 O'quvchi: {user_mention(submission)}",
        f"📚 Guruh: {esc(submission.get('group_name') or '—')}",
        f"📝 Vazifa: <b>{esc(submission.get('task_title') or '—')}</b>",
        f"🧾 Tur: {esc(kind_label)} · o'tish balli {esc(submission.get('pass_score'))}",
        f"🕒 Yuborilgan: {fmt_dt(submission.get('created_at'))}",
    ]
    if reason:
        lines.append(f"📌 Sabab: {esc(reason)}")
    if submission.get("auto_ratio") is not None:
        lines.append(f"🤖 Avto tekshiruv: {round(float(submission['auto_ratio']) * 100)}% mos")
    if answer:
        lines += ["", "💬 Javob:", esc(answer)]
    if submission.get("file_id"):
        lines += ["", "📎 Fayl biriktirilgan (pastda)."]
    if submission.get("status") == "not_done":
        lines += ["", "⚠️ <b>Diqqat:</b> vazifa bajarilmagan deb belgilangan."]
    return "\n".join(lines)


async def send_submission_card(bot: Bot, db: Database, submission_id: int, reason: str | None = None) -> bool:
    submission = await db.get_submission_full(submission_id)
    if not submission:
        return False
    teachers = await db.teachers()
    if not teachers:
        logger.warning("Ustozlar yo'q — #%s topshiriq yuborilmadi", submission_id)
        return False

    text = submission_card_text(submission, reason)
    keyboard = grade_kb(submission_id)
    for teacher in teachers:
        chat_id = int(teacher["tg_id"])
        await send_attachment(bot, chat_id, submission)
        await safe_send(bot, chat_id, text, keyboard)
    return True
