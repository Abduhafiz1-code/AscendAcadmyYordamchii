"""O'quvchi bo'limi: vazifalar, topshirish, natijalar, reyting."""
from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from bot.config import Settings
from bot.db import Database
from bot.keyboards import (
    BTN_RATING,
    BTN_RESULTS,
    BTN_TASKS,
    MENU_TEXTS,
    cancel_kb,
    is_staff,
    main_menu,
    modules_kb,
    rating_period_kb,
    task_kb,
    tasks_kb,
)
from bot.services.rating import rank_of_user, rating_text
from bot.services.submissions import (
    handle_answer,
    handle_not_done,
    handle_quiz_answer,
    submission_status_label,
)
from bot.services.tasks import (
    TaskState,
    build_states,
    module_progress,
    parse_options,
    states_for_module,
    unlock_new_tasks,
)
from bot.states import Submit
from bot.utils import esc, fmt_dt, fmt_points, progress_bar, truncate

logger = logging.getLogger(__name__)
router = Router(name="student")


def _is_student(user: dict | None) -> bool:
    return bool(user and user.get("status") == "active")


async def _deny(target: Message | CallbackQuery) -> None:
    text = "Iltimos, avval ro'yxatdan o'ting: /start"
    if isinstance(target, CallbackQuery):
        await target.answer(text, show_alert=True)
    else:
        await target.answer(text)


async def _states(db: Database, user: dict) -> list[TaskState]:
    return await build_states(db, user)


def _deadline_text(state: TaskState) -> str:
    access = state.access or {}
    deadline = access.get("deadline_at")
    if deadline:
        return f"⏰ Muddat: <b>{fmt_dt(deadline)}</b>"
    if int(state.task.get("deadline_days") or 0) > 0:
        return f"⏰ Muddat: vazifa ochilgandan {state.task['deadline_days']} kun"
    return "⏰ Muddat: belgilanmagan"


def _task_card(task: dict, state: TaskState, module_title: str, max_attempts: int) -> str:
    kind_label = {"quiz": "test", "text": "yozma javob", "manual": "fayl / rasm"}.get(
        task["kind"], task["kind"]
    )
    if state.passed:
        status = "✅ Bajarilgan"
    elif state.pending:
        status = "⏳ Ustoz tekshiruvida"
    elif state.unlocked:
        status = "🔓 Ochiq"
    else:
        status = "🔒 Yopiq"

    lines = [
        f"📝 <b>{esc(task['title'])}</b>",
        f"📦 Modul: {esc(module_title)}",
        f"🧾 Tur: {esc(kind_label)} · o'tish balli <b>{fmt_points(task['pass_score'])}</b>/10",
        f"📌 Holat: {status}",
        f"🏅 Eng yaxshi natija: <b>{fmt_points(state.best)}</b>/10",
        f"🔁 Urinishlar: {state.attempts}/{max_attempts}",
        _deadline_text(state),
    ]
    if task["is_bonus"]:
        lines.append("🎁 Bu qo'shimcha (bonus) vazifa")
    if task.get("description"):
        lines += ["", esc(task["description"])]
    if not state.unlocked:
        lines += ["", "🔒 <i>Bu vazifa yopiq. Avval oldingi vazifani yakunlang.</i>"]
    elif state.pending:
        lines += ["", "⏳ <i>Javobingiz ustozda. Natijani kuting.</i>"]
    elif not state.passed and state.attempts >= max_attempts:
        lines += ["", "⚠️ <i>Urinishlar tugadi. Ustoz bilan bog'laning.</i>"]
    return "\n".join(lines)


# ------------------------------------------------------------------ menyu
@router.message(F.text == BTN_TASKS)
async def show_modules(message: Message, db: Database, db_user: dict | None) -> None:
    if not _is_student(db_user):
        await _deny(message)
        return
    states = await _states(db, db_user)  # type: ignore[arg-type]
    if not states:
        await message.answer(
            "📚 Hozircha vazifalar yo'q.\nUstoz vazifa qo'shgach, shu yerda ko'rinadi."
        )
        return
    progress = module_progress(states)
    modules = [m for m in await db.list_modules() if int(m["id"]) in progress]
    done = sum(1 for state in states if state.passed)
    text = (
        "📚 <b>Vazifalarim</b>\n\n"
        f"✅ Bajarilgan: <b>{done}/{len(states)}</b>\n"
        f"{progress_bar(done, len(states))}\n\n"
        "Modulni tanlang:"
    )
    await message.answer(text, reply_markup=modules_kb(modules, progress))


@router.callback_query(F.data == "back:modules")
async def back_modules(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not _is_student(db_user):
        await _deny(callback)
        return
    states = await _states(db, db_user)  # type: ignore[arg-type]
    progress = module_progress(states)
    modules = [m for m in await db.list_modules() if int(m["id"]) in progress]
    done = sum(1 for state in states if state.passed)
    text = (
        "📚 <b>Vazifalarim</b>\n\n"
        f"✅ Bajarilgan: <b>{done}/{len(states)}</b>\n"
        f"{progress_bar(done, len(states))}\n\n"
        "Modulni tanlang:"
    )
    await callback.message.edit_text(text, reply_markup=modules_kb(modules, progress))  # type: ignore[union-attr]
    await callback.answer()


async def _render_module(
    callback: CallbackQuery, db: Database, db_user: dict, module_id: int
) -> bool:
    module = await db.get_module(module_id)
    if not module:
        await callback.answer("Modul topilmadi", show_alert=True)
        return False
    states = states_for_module(await _states(db, db_user), module_id)
    if not states:
        await callback.answer("Bu modulda vazifa yo'q", show_alert=True)
        return False
    done = sum(1 for state in states if state.passed)
    text = (
        f"📦 <b>{esc(module['title'])}</b>\n"
        f"{progress_bar(done, len(states))} {done}/{len(states)}\n"
    )
    if module.get("description"):
        text += f"\n{esc(module['description'])}\n"
    text += "\nVazifani tanlang:"
    await callback.message.edit_text(text, reply_markup=tasks_kb(states, module_id))  # type: ignore[union-attr]
    return True


@router.callback_query(F.data.startswith("mod:"))
async def open_module(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not _is_student(db_user):
        await _deny(callback)
        return
    module_id = int(callback.data.split(":")[1])  # type: ignore[union-attr]
    await _render_module(callback, db, db_user, module_id)  # type: ignore[arg-type]
    await callback.answer()


@router.callback_query(F.data.startswith("task:"))
async def open_task(
    callback: CallbackQuery, db: Database, db_user: dict | None, settings: Settings
) -> None:
    if not _is_student(db_user):
        await _deny(callback)
        return
    task_id = int(callback.data.split(":")[1])  # type: ignore[union-attr]
    task = await db.get_task(task_id)
    if not task:
        await callback.answer("Vazifa topilmadi", show_alert=True)
        return
    states = await _states(db, db_user)  # type: ignore[arg-type]
    state = next((s for s in states if int(s.task["id"]) == task_id), None)
    if state is None:
        await callback.answer("Vazifa faol emas", show_alert=True)
        return
    module = await db.get_module(int(task["module_id"]))
    text = _task_card(task, state, module["title"] if module else "—", settings.max_attempts)
    await callback.message.edit_text(  # type: ignore[union-attr]
        text, reply_markup=task_kb(task, state, parse_options(task))
    )
    await callback.answer()


@router.callback_query(F.data.startswith("back:module:"))
async def back_module(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not _is_student(db_user):
        await _deny(callback)
        return
    module_id = int(callback.data.split(":")[2])  # type: ignore[union-attr]
    await _render_module(callback, db, db_user, module_id)  # type: ignore[arg-type]
    await callback.answer()


# ------------------------------------------------------------------ test javobi
@router.callback_query(F.data.startswith("q:"))
async def quiz_answer(
    callback: CallbackQuery, db: Database, db_user: dict | None, settings: Settings, bot
) -> None:
    if not _is_student(db_user):
        await _deny(callback)
        return
    _, raw_task_id, option_key = callback.data.split(":")  # type: ignore[union-attr]
    task_id = int(raw_task_id)
    task = await db.get_task(task_id)
    if not task or task["kind"] != "quiz":
        await callback.answer("Vazifa topilmadi", show_alert=True)
        return

    state = next((s for s in await _states(db, db_user) if int(s.task["id"]) == task_id), None)  # type: ignore[arg-type]
    if state is None or not state.unlocked:
        await callback.answer("Bu vazifa yopiq", show_alert=True)
        return
    if state.passed:
        await callback.answer("Bu vazifani allaqachon bajargansiz ✅", show_alert=True)
        return
    if state.pending:
        await callback.answer("Javobingiz ustozda. Natijani kuting.", show_alert=True)
        return
    if state.attempts >= settings.max_attempts:
        await callback.answer("Urinishlar tugadi. Ustoz bilan bog'laning.", show_alert=True)
        return

    result = await handle_quiz_answer(bot, db, settings, db_user, task, option_key)  # type: ignore[arg-type]
    text = result["text"]
    if result["status"] == "auto_passed":
        titles = await unlock_new_tasks(db, db_user)  # type: ignore[arg-type]
        if titles:
            text += "\n\n🎉 <b>Yangi vazifa ochildi:</b>\n" + "\n".join(f"• {esc(t)}" for t in titles)
    await callback.message.edit_text(  # type: ignore[union-attr]
        text,
        reply_markup=tasks_kb(
            states_for_module(await _states(db, db_user), int(task["module_id"])),  # type: ignore[arg-type]
            int(task["module_id"]),
        ),
    )
    await callback.answer()


# ------------------------------------------------------------------ yozma javob / fayl
@router.callback_query(F.data.startswith("s:"))
async def begin_submission(
    callback: CallbackQuery,
    state: FSMContext,
    db: Database,
    db_user: dict | None,
    settings: Settings,
) -> None:
    if not _is_student(db_user):
        await _deny(callback)
        return
    task_id = int(callback.data.split(":")[1])  # type: ignore[union-attr]
    task = await db.get_task(task_id)
    if not task:
        await callback.answer("Vazifa topilmadi", show_alert=True)
        return
    if task["kind"] == "quiz":
        await callback.answer("Bu test vazifasi — variantlardan birini tanlang.", show_alert=True)
        return
    task_state = next((s for s in await _states(db, db_user) if int(s.task["id"]) == task_id), None)  # type: ignore[arg-type]
    if task_state is None or not task_state.unlocked:
        await callback.answer("Bu vazifa yopiq", show_alert=True)
        return
    if task_state.pending:
        await callback.answer("Javobingiz ustozda. Natijani kuting.", show_alert=True)
        return
    if task_state.attempts >= settings.max_attempts:
        await callback.answer("Urinishlar tugadi. Ustoz bilan bog'laning.", show_alert=True)
        return

    await state.set_state(Submit.answer)
    await state.update_data(task_id=task_id)
    hint = (
        "Javobni matn ko'rinishida yozing — kalit so'zlar asosida avtomatik tekshiriladi."
        if task["kind"] == "text"
        else "Javobni matn, rasm yoki fayl ko'rinishida yuboring — ustoz qo'lda tekshiradi."
    )
    await callback.message.answer(  # type: ignore[union-attr]
        f"✍️ <b>{esc(task['title'])}</b>\n\n{hint}\n\nBekor qilish: /bekor",
        reply_markup=cancel_kb(),
    )
    await callback.answer()


@router.message(Submit.answer)
async def receive_answer(
    message: Message,
    state: FSMContext,
    db: Database,
    db_user: dict | None,
    settings: Settings,
    bot,
) -> None:
    if message.text in MENU_TEXTS:
        await state.clear()
        await message.answer(
            "Javob yuborilmadi — bekor qilindi.",
            reply_markup=main_menu(staff=is_staff(db_user)),
        )
        return
    if not _is_student(db_user):
        await state.clear()
        await _deny(message)
        return

    data = await state.get_data()
    task_id = int(data.get("task_id") or 0)
    task = await db.get_task(task_id)
    if not task:
        await state.clear()
        await message.answer("Vazifa topilmadi. «📚 Vazifalarim» dan qayta tanlang.")
        return

    answer_text = (message.text or message.caption or "").strip() or None
    if answer_text and answer_text.startswith("/"):
        await message.answer(
            "Javobni matn, rasm yoki fayl ko'rinishida yuboring. Bekor qilish: /bekor"
        )
        return
    if answer_text and len(answer_text) > 2000:
        await message.answer(
            "Javob juda uzun (2000 belgidan oshdi). Iltimos, qisqartirib yuboring."
        )
        return

    file_id = None
    file_type = None
    if message.photo:
        file_id, file_type = message.photo[-1].file_id, "photo"
    elif message.document:
        file_id, file_type = message.document.file_id, "document"
    elif message.voice:
        file_id, file_type = message.voice.file_id, "voice"
    elif message.video:
        file_id, file_type = message.video.file_id, "video"
    elif message.audio:
        file_id, file_type = message.audio.file_id, "audio"

    if not answer_text and not file_id:
        await message.answer("Javobni matn, rasm yoki fayl ko'rinishida yuboring.")
        return

    result = await handle_answer(
        bot, db, settings, db_user, task, answer_text, file_id, file_type  # type: ignore[arg-type]
    )
    await state.clear()

    text = result["text"]
    if result["status"] == "auto_passed":
        titles = await unlock_new_tasks(db, db_user)  # type: ignore[arg-type]
        if titles:
            text += "\n\n🎉 <b>Yangi vazifa ochildi:</b>\n" + "\n".join(f"• {esc(t)}" for t in titles)
    await message.answer(text, reply_markup=main_menu(staff=is_staff(db_user)))


@router.callback_query(F.data.startswith("cant:"))
async def cant_do(callback: CallbackQuery, db: Database, db_user: dict | None, bot) -> None:
    if not _is_student(db_user):
        await _deny(callback)
        return
    task_id = int(callback.data.split(":")[1])  # type: ignore[union-attr]
    task = await db.get_task(task_id)
    if not task:
        await callback.answer("Vazifa topilmadi", show_alert=True)
        return
    state = next((s for s in await _states(db, db_user) if int(s.task["id"]) == task_id), None)  # type: ignore[arg-type]
    if state is None or not state.unlocked:
        await callback.answer("Bu vazifa yopiq", show_alert=True)
        return
    if state.passed:
        await callback.answer("Bu vazifa allaqachon bajarilgan ✅", show_alert=True)
        return
    created = await handle_not_done(bot, db, db_user, task)  # type: ignore[arg-type]
    if not created:
        await callback.answer("Bu vazifa bo'yicha so'rov allaqachon yuborilgan", show_alert=True)
        return
    await callback.message.edit_text(  # type: ignore[union-attr]
        (
            "⚠️ <b>Vazifa bajarmagan sifatida belgilandi</b>\n\n"
            f"📝 {esc(task['title'])}\n\n"
            "Ma'lumot ustozga yuborildi. Ustoz siz bilan bog'lanadi."
        )
    )
    await callback.answer("Ustozga yuborildi")


# ------------------------------------------------------------------ reyting
@router.message(F.text == BTN_RATING)
async def rating_message(message: Message, db: Database, db_user: dict | None) -> None:
    if not _is_student(db_user):
        await _deny(message)
        return
    text = await rating_text(db, db_user, "all")
    await message.answer(text, reply_markup=rating_period_kb("all"))


@router.callback_query(F.data.startswith("rating:"))
async def rating_callback(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not _is_student(db_user):
        await _deny(callback)
        return
    period = callback.data.split(":")[1]  # type: ignore[union-attr]
    text = await rating_text(db, db_user, period)
    await callback.message.edit_text(text, reply_markup=rating_period_kb(period))  # type: ignore[union-attr]
    await callback.answer()


# ------------------------------------------------------------------ natijalar
@router.message(F.text == BTN_RESULTS)
async def my_results(message: Message, db: Database, db_user: dict | None) -> None:
    if not _is_student(db_user):
        await _deny(message)
        return
    states = await _states(db, db_user)  # type: ignore[arg-type]
    submissions = await db.user_submissions(int(db_user["id"]), limit=8)  # type: ignore[index]

    passed_states = [state for state in states if state.passed]
    best_scores = [state.best for state in states if state.best is not None]
    total_points = round(sum(best_scores), 2)
    average = round(sum(best_scores) / len(best_scores), 1) if best_scores else 0

    rank = 0
    total_students = 0
    if db_user and db_user.get("role") == "student":  # type: ignore[union-attr]
        rank, total_students, _ = await rank_of_user(db, db_user)  # type: ignore[arg-type]

    lines = [
        "📊 <b>Natijalarim</b>",
        "",
        f"🏅 Jami ball: <b>{fmt_points(total_points)}</b>",
        f"✅ Bajarilgan vazifalar: <b>{len(passed_states)}/{len(states)}</b>",
        f"📈 O'rtacha natija: <b>{fmt_points(average)}</b>/10",
    ]
    if rank:
        lines.append(f"🎯 Reytingdagi o'rnim: <b>{rank}/{total_students}</b>")
    if submissions:
        lines += ["", "🕘 <b>Oxirgi topshiriqlar</b>"]
        for submission in submissions:
            score = submission.get("score")
            score_text = f"{fmt_points(score)}/10" if score is not None else "—"
            lines.append(
                f"{submission_status_label(submission['status'])} · "
                f"{esc(truncate(submission['task_title'], 30))} · {score_text} · "
                f"{fmt_dt(submission['created_at'])}"
            )
    await message.answer("\n".join(lines))
