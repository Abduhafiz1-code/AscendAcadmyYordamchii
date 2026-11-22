"""Muddat nazorati: eslatmalar va muddati o'tgan vazifalarni ustozga yuborish."""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from aiogram import Bot

from bot.config import Settings
from bot.db import Database
from bot.services.notify import notify_user, send_submission_card
from bot.utils import esc, now_utc, parse_iso

logger = logging.getLogger(__name__)

REMIND_BEFORE = timedelta(hours=24)


async def check_deadlines(bot: Bot, db: Database, settings: Settings) -> None:
    rows = await db.access_rows()
    if not rows:
        return

    best_all = await db.best_scores_all()
    now = now_utc()

    for row in rows:
        deadline = parse_iso(row.get("deadline_at"))
        if not deadline:
            continue
        user_id = int(row["user_id"])
        task_id = int(row["task_id"])
        best = best_all.get(user_id, {}).get(task_id, 0)
        passed = best >= float(row["pass_score"])

        if passed:
            if not row["missing_reported"]:
                await db.mark_access(user_id, task_id, missing_reported=1)
            continue

        if deadline <= now:
            if row["missing_reported"]:
                continue
            if await db.pending_for_task(user_id, task_id):
                await db.mark_access(user_id, task_id, missing_reported=1)
                continue

            submission_id = await db.add_submission(
                task_id,
                user_id,
                "not_done",
                feedback="Muddat o'tdi",
            )
            await db.mark_access(user_id, task_id, missing_reported=1)
            await send_submission_card(
                bot, db, submission_id, reason="Muddat o'tdi — vazifa bajarilmagan"
            )
            student = await db.get_user_by_id(user_id)
            if student:
                await notify_user(
                    bot,
                    student,
                    (
                        "⏰ <b>Vazifa muddati o'tdi</b>\n\n"
                        f"📝 {esc(row['task_title'])}\n"
                        "Vazifa ustozga yuborildi. Ustoz bilan bog'laning."
                    ),
                )
            continue

        if not row["reminded"] and deadline - now <= REMIND_BEFORE:
            await db.mark_access(user_id, task_id, reminded=1)
            student = await db.get_user_by_id(user_id)
            if student:
                await notify_user(
                    bot,
                    student,
                    (
                        "🔔 <b>Eslatma</b>\n\n"
                        f"📝 Vazifa: <b>{esc(row['task_title'])}</b>\n"
                        "⏰ Muddat 24 soat ichida tugaydi. Ulgurib topshiring!"
                    ),
                )


async def deadline_worker(bot: Bot, db: Database, settings: Settings) -> None:
    while True:
        try:
            await check_deadlines(bot, db, settings)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Muddat tekshiruvida xatolik")
        await asyncio.sleep(settings.check_interval)
