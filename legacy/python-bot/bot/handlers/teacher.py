"""Ustoz paneli: tekshirish, baholash, vazifa boshqaruvi, o'quvchilar."""
from __future__ import annotations

import asyncio
import json
import logging
from collections import Counter

from aiogram import Bot, F, Router
from aiogram.exceptions import TelegramAPIError
from aiogram.fsm.context import FSMContext
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
)

from bot.config import Settings
from bot.db import Database
from bot.keyboards import (
    BTN_PANEL,
    MENU_TEXTS,
    confirm_delete_kb,
    grade_kb,
    is_staff,
    main_menu,
    modules_admin_kb,
    panel_kb,
    pending_list_kb,
    settings_kb,
    students_kb,
    task_manage_kb,
    wizard_bonus_kb,
    wizard_confirm_kb,
    wizard_kind_kb,
    wizard_modules_kb,
)
from bot.services.notify import (
    notify_user,
    safe_send,
    send_attachment,
    submission_card_text,
)
from bot.services.submissions import grade_submission
from bot.states import Broadcast, SettingForm, TaskForm
from bot.utils import esc, fmt_dt, fmt_points, now_iso, truncate

logger = logging.getLogger(__name__)
router = Router(name="teacher")


async def _guard(target: Message | CallbackQuery, db_user: dict | None) -> bool:
    if is_staff(db_user):
        return True
    text = "⛔ Bu bo'lim faqat ustozlar uchun."
    if isinstance(target, CallbackQuery):
        await target.answer(text, show_alert=True)
    else:
        await target.answer(text, reply_markup=main_menu(staff=False))
    return False


def _panel_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="⬅️ Panel", callback_data="back:panel")]]
    )


async def _panel_state(db: Database) -> tuple[str, dict]:
    counts = await db.counts()
    text = (
        "🛠 <b>Ustoz paneli</b>\n\n"
        f"👥 Faol o'quvchilar: <b>{counts['students']}</b>\n"
        f"⏳ Tasdiq kutayotgan: <b>{counts['awaiting']}</b>\n"
        f"📥 Tekshirish kutayotgan: <b>{counts['pending']}</b>\n"
        f"📋 Faol vazifalar: <b>{counts['tasks']}</b>"
    )
    return text, counts


@router.message(F.text == BTN_PANEL)
async def open_panel(message: Message, db: Database, db_user: dict | None) -> None:
    if not await _guard(message, db_user):
        return
    text, counts = await _panel_state(db)
    await message.answer(text, reply_markup=panel_kb(counts))


@router.callback_query(F.data == "back:panel")
async def back_to_panel(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    text, counts = await _panel_state(db)
    await callback.message.edit_text(text, reply_markup=panel_kb(counts))  # type: ignore[union-attr]
    await callback.answer()


# ------------------------------------------------------------------ tekshirish
@router.callback_query(F.data == "panel:pending")
async def pending_list(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    rows = await db.pending_submissions(limit=20)
    if not rows:
        await callback.message.edit_text(  # type: ignore[union-attr]
            "📥 <b>Tekshirish</b>\n\nHozircha tekshiriladigan ish yo'q. ✅",
            reply_markup=_panel_kb(),
        )
    else:
        await callback.message.edit_text(  # type: ignore[union-attr]
            f"📥 <b>Tekshirish</b>\n\n{len(rows)} ta ish kutmoqda. Tanlang:",
            reply_markup=pending_list_kb(rows),
        )
    await callback.answer()


@router.callback_query(F.data.startswith("sub:"))
async def submission_detail(callback: CallbackQuery, db: Database, db_user: dict | None, bot: Bot) -> None:
    if not await _guard(callback, db_user):
        return
    submission_id = int(callback.data.split(":")[1])  # type: ignore[union-attr]
    submission = await db.get_submission_full(submission_id)
    if not submission:
        await callback.answer("Topshiriq topilmadi", show_alert=True)
        return
    if submission["status"] not in ("teacher_review", "not_done"):
        await callback.answer("Bu ish allaqachon baholangan", show_alert=True)
        return
    if submission.get("file_id"):
        await send_attachment(bot, callback.from_user.id, submission)
    await callback.message.answer(  # type: ignore[union-attr]
        submission_card_text(submission),
        reply_markup=grade_kb(submission_id),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("g:"))
async def grade(
    callback: CallbackQuery, db: Database, db_user: dict | None, bot: Bot, settings: Settings
) -> None:
    if not await _guard(callback, db_user):
        return
    parts = callback.data.split(":")  # type: ignore[union-attr]
    submission_id = int(parts[1])
    action = parts[2]
    submission = await db.get_submission_full(submission_id)
    if not submission:
        await callback.answer("Topshiriq topilmadi", show_alert=True)
        return
    if submission["status"] not in ("teacher_review", "not_done"):
        await callback.answer("Bu ish allaqachon baholangan", show_alert=True)
        return

    if action == "retry":
        result = await grade_submission(
            bot, db, submission_id, None, db_user, retry=True, max_attempts=settings.max_attempts  # type: ignore[arg-type]
        )
        footer = f"🔁 Qayta topshirishga ruxsat berildi — {esc(db_user['full_name'])}"  # type: ignore[index]
    else:
        try:
            score = float(action)
        except ValueError:
            await callback.answer("Ball noto'g'ri", show_alert=True)
            return
        result = await grade_submission(
            bot, db, submission_id, score, db_user, max_attempts=settings.max_attempts  # type: ignore[arg-type]
        )
        footer = f"✅ Baholandi: <b>{fmt_points(score)}/10</b> — {esc(db_user['full_name'])}"  # type: ignore[index]

    if not result:
        await callback.answer("Xatolik: ma'lumot topilmadi", show_alert=True)
        return
    updated = await db.get_submission_full(submission_id)
    try:
        await callback.message.edit_text(  # type: ignore[union-attr]
            (submission_card_text(updated) if updated else "") + "\n\n" + footer
        )
    except TelegramAPIError:
        pass
    await callback.answer("Saqlandi ✅")


# ------------------------------------------------------------------ o'quvchilar
@router.callback_query(F.data == "panel:students")
async def students_panel(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    awaiting = await db.awaiting_users()
    active = await db.active_students()
    scores = await db.best_scores_all()
    points = {user_id: round(sum(items.values()), 2) for user_id, items in scores.items()}

    lines = [
        "👥 <b>O'quvchilar</b>",
        "",
        f"✅ Faol: <b>{len(active)}</b>",
        f"⏳ Tasdiq kutayotgan: <b>{len(awaiting)}</b>",
    ]
    if active:
        top = sorted(active, key=lambda u: -points.get(int(u["id"]), 0))[:12]
        lines += ["", "🏅 <b>Eng faol o'quvchilar</b>"]
        for index, student in enumerate(top, start=1):
            lines.append(
                f"{index}. {esc(truncate(student['full_name'], 26))} · "
                f"{esc(student.get('group_name') or '—')} · "
                f"<b>{fmt_points(points.get(int(student['id']), 0))}</b> ball"
            )
    await callback.message.edit_text("\n".join(lines), reply_markup=_panel_kb())  # type: ignore[union-attr]

    if awaiting:
        await callback.message.answer(  # type: ignore[union-attr]
            f"⏳ <b>Tasdiq kutayotganlar</b> ({len(awaiting)})\n\n"
            "Quyidagi o'quvchilarni tasdiqlaysizmi?",
            reply_markup=students_kb(awaiting),
        )
    await callback.answer()


@router.callback_query(F.data.startswith("u:"))
async def approve_user(callback: CallbackQuery, db: Database, db_user: dict | None, bot: Bot) -> None:
    if not await _guard(callback, db_user):
        return
    parts = callback.data.split(":")  # type: ignore[union-attr]
    approved = parts[1] == "ok"
    user_id = int(parts[2])
    target = await db.get_user_by_id(user_id)
    if not target:
        await callback.answer("Foydalanuvchi topilmadi", show_alert=True)
        return
    if target["status"] == "active":
        await callback.answer("Allaqachon tasdiqlangan", show_alert=True)
        return

    if approved:
        await db.update_user(
            user_id, role="student", status="active", verified_at=now_iso()
        )
        await notify_user(
            bot,
            target,
            (
                "✅ <b>Hisobingiz tasdiqlandi!</b>\n\n"
                f"👤 {esc(target['full_name'])}\n"
                f"📚 Guruh: {esc(target.get('group_name') or '—')}\n\n"
                "Endi «📚 Vazifalarim» bo'limidan vazifalarni bajarishingiz mumkin. Omad!"
            ),
            reply_markup=main_menu(staff=False),
        )
        footer = f"✅ Tasdiqlandi — {esc(db_user['full_name'])}"  # type: ignore[index]
    else:
        await db.update_user(user_id, status="rejected")
        await notify_user(
            bot,
            target,
            (
                "❌ <b>So'rovingiz rad etildi.</b>\n\n"
                "Sabab bo'yicha ustoz bilan bog'laning. Qayta so'rov uchun /start yuboring."
            ),
        )
        footer = f"❌ Rad etildi — {esc(db_user['full_name'])}"  # type: ignore[index]

    try:
        await callback.message.edit_text(  # type: ignore[union-attr]
            f"👤 {esc(target['full_name'])}\n{footer}"
        )
    except TelegramAPIError:
        pass
    await callback.answer("Bajarildi")


# ------------------------------------------------------------------ reyting (ustoz ko'rinishi)
@router.callback_query(F.data == "panel:rating")
async def panel_rating(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    from bot.services.rating import rating_text

    text = await rating_text(db, None, "all")
    await callback.message.edit_text(text, reply_markup=_panel_kb())  # type: ignore[union-attr]
    await callback.answer()


# ------------------------------------------------------------------ vazifalar ro'yxati
@router.callback_query(F.data == "panel:tasks")
async def tasks_panel(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    modules = await db.list_modules(active_only=False)
    if not modules:
        await callback.message.edit_text(  # type: ignore[union-attr]
            "📋 <b>Vazifalar</b>\n\nHozircha modul yo'q. «➕ Yangi vazifa» orqali qo'shing.",
            reply_markup=_panel_kb(),
        )
        await callback.answer()
        return
    tasks = await db.list_tasks(active_only=False)
    counts = Counter(int(task["module_id"]) for task in tasks)
    await callback.message.edit_text(  # type: ignore[union-attr]
        "📋 <b>Vazifalar</b>\n\nModulni tanlang:",
        reply_markup=modules_admin_kb(modules, counts),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("tm:"))
async def module_tasks(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    module_id = int(callback.data.split(":")[1])  # type: ignore[union-attr]
    module = await db.get_module(module_id)
    if not module:
        await callback.answer("Modul topilmadi", show_alert=True)
        return
    tasks = await db.list_tasks(module_id=module_id, active_only=False)
    rows: list[list[InlineKeyboardButton]] = []
    for task in tasks:
        icon = "✅" if task["is_active"] else "⏸"
        prefix = "🎁 " if task["is_bonus"] else ""
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"{icon} {prefix}{truncate(task['title'], 36)}",
                    callback_data=f"tt:{task['id']}",
                )
            ]
        )
    rows.append([InlineKeyboardButton(text="⬅️ Modullar", callback_data="panel:tasks")])
    text = f"📦 <b>{esc(module['title'])}</b>\n\nVazifalar: {len(tasks)}"
    await callback.message.edit_text(text, reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))  # type: ignore[union-attr]
    await callback.answer()


def _task_admin_text(task: dict, module_title: str) -> str:
    kind_label = {"quiz": "test", "text": "yozma javob", "manual": "qo'lda tekshirish"}.get(
        task["kind"], task["kind"]
    )
    bonus_label = "ha" if task["is_bonus"] else "yo'q"
    deadline_label = (
        f"{task['deadline_days']} kun" if task["deadline_days"] else "yo'q"
    )
    lines = [
        f"📝 <b>{esc(task['title'])}</b>",
        f"📦 Modul: {esc(module_title)}",
        f"🧾 Tur: {esc(kind_label)}",
        f"🎯 O'tish balli: <b>{fmt_points(task['pass_score'])}</b>/10",
        f"📌 Holat: {'✅ faol' if task['is_active'] else '⏸ faolsiz'}",
        f"🎁 Qo'shimcha: {bonus_label}",
        f"⏰ Muddat: {deadline_label}",
        f"🕒 Qo'shilgan: {fmt_dt(task['created_at'])}",
    ]
    if task.get("description"):
        lines += ["", esc(truncate(task["description"], 700))]
    return "\n".join(lines)


@router.callback_query(F.data.startswith("tt:"))
async def task_manage(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    parts = callback.data.split(":")  # type: ignore[union-attr]
    task_id = int(parts[1])
    action = parts[2] if len(parts) > 2 else None
    task = await db.get_task(task_id)
    if not task:
        await callback.answer("Vazifa topilmadi", show_alert=True)
        return
    module = await db.get_module(int(task["module_id"]))
    module_title = module["title"] if module else "—"

    if action == "tog":
        await db.update_task(task_id, is_active=0 if task["is_active"] else 1)
        task = await db.get_task(task_id) or task
        await callback.message.edit_text(  # type: ignore[union-attr]
            _task_admin_text(task, module_title), reply_markup=task_manage_kb(task)
        )
        await callback.answer("Yangilandi")
        return

    if action == "del":
        await callback.message.edit_text(  # type: ignore[union-attr]
            f"🗑 <b>O'chirishni tasdiqlaysizmi?</b>\n\n📝 {esc(task['title'])}\n\n"
            "Vazifa va unga tegishli barcha topshiriqlar o'chiriladi.",
            reply_markup=confirm_delete_kb(task_id),
        )
        await callback.answer()
        return

    if action == "delok":
        await db.delete_task(task_id)
        await callback.message.edit_text(  # type: ignore[union-attr]
            f"🗑 Vazifa o'chirildi: <b>{esc(task['title'])}</b>",
            reply_markup=InlineKeyboardMarkup(
                inline_keyboard=[
                    [InlineKeyboardButton(text="⬅️ Modul", callback_data=f"tm:{task['module_id']}")]
                ]
            ),
        )
        await callback.answer("O'chirildi")
        return

    await callback.message.edit_text(  # type: ignore[union-attr]
        _task_admin_text(task, module_title), reply_markup=task_manage_kb(task)
    )
    await callback.answer()


# ------------------------------------------------------------------ yangi vazifa ustasi
@router.callback_query(F.data == "panel:new")
async def new_task_start(callback: CallbackQuery, state: FSMContext, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    await state.clear()
    modules = await db.list_modules(active_only=False)
    await callback.message.edit_text(  # type: ignore[union-attr]
        "➕ <b>Yangi vazifa</b>\n\n1️⃣ Modulni tanlang yoki yangi modul yarating:",
        reply_markup=wizard_modules_kb(modules),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("nt:mod:"))
async def new_task_module(callback: CallbackQuery, state: FSMContext, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    value = callback.data.split(":", 2)[2]  # type: ignore[union-attr]
    if value == "new":
        await state.set_state(TaskForm.module)
        await callback.message.edit_text(  # type: ignore[union-attr]
            "📦 Yangi modul nomini yozing (masalan: <i>Matematika — 1-chorak</i>):"
        )
        await callback.answer()
        return

    module = await db.get_module(int(value))
    if not module:
        await callback.answer("Modul topilmadi", show_alert=True)
        return
    await state.update_data(module_id=int(module["id"]), module_title=module["title"])
    await state.set_state(TaskForm.title)
    await callback.message.edit_text(  # type: ignore[union-attr]
        f"📦 Modul: <b>{esc(module['title'])}</b>\n\n2️⃣ Vazifa nomini yozing:"
    )
    await callback.answer()


@router.message(TaskForm.module, ~F.text.in_(MENU_TEXTS))
async def new_task_module_name(message: Message, state: FSMContext, db: Database, db_user: dict | None) -> None:
    if not is_staff(db_user):
        return
    title = (message.text or "").strip()
    if title.startswith("/"):
        await message.answer("Modul nomini yozing yoki /bekor yuboring.")
        return
    if len(title) < 2:
        await message.answer("Modul nomini yozing (kamida 2 belgi).")
        return
    module_id = await db.create_module(title[:80])
    await state.update_data(module_id=module_id, module_title=title[:80])
    await state.set_state(TaskForm.title)
    await message.answer(
        f"📦 Modul yaratildi: <b>{esc(title[:80])}</b>\n\n2️⃣ Vazifa nomini yozing:"
    )


@router.message(TaskForm.title, ~F.text.in_(MENU_TEXTS))
async def new_task_title(message: Message, state: FSMContext, db_user: dict | None) -> None:
    if not is_staff(db_user):
        return
    title = (message.text or "").strip()
    if title.startswith("/"):
        await message.answer("Vazifa nomini yozing yoki /bekor yuboring.")
        return
    if len(title) < 3:
        await message.answer("Vazifa nomini yozing (kamida 3 belgi).")
        return
    await state.update_data(title=title[:120])
    await state.set_state(TaskForm.description)
    await message.answer(
        "3️⃣ Vazifa shartini / tavsifini yozing.\n\n"
        "O'quvchi nima qilishi kerakligini aniq yozing.\n"
        "/skip — tavsifsiz davom etish."
    )


@router.message(TaskForm.description, ~F.text.in_(MENU_TEXTS))
async def new_task_description(message: Message, state: FSMContext, db_user: dict | None) -> None:
    if not is_staff(db_user):
        return
    text = (message.text or "").strip()
    if text.startswith("/") and text.lower() not in {"/skip", "/bekor"}:
        await message.answer("Tavsifni yozing, /skip yuboring yoki /bekor bilan chiqing.")
        return
    description = "" if text.lower() in {"/skip", "skip"} else text[:1500]
    await state.update_data(description=description)
    await state.set_state(TaskForm.kind)
    await message.answer("4️⃣ Vazifa turini tanlang:", reply_markup=wizard_kind_kb())


@router.callback_query(F.data.startswith("nt:kind:"))
async def new_task_kind(callback: CallbackQuery, state: FSMContext, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    kind = callback.data.split(":", 2)[2]  # type: ignore[union-attr]
    if kind not in {"quiz", "text", "manual"}:
        await callback.answer("Noto'g'ri tur", show_alert=True)
        return
    await state.update_data(kind=kind)

    if kind == "quiz":
        await state.set_state(TaskForm.options)
        await callback.message.edit_text(  # type: ignore[union-attr]
            "5️⃣ Test variantlarini yuboring — har biri <b>yangi qatorda</b>.\n"
            "To'g'ri javob oldiga <code>*</code> belgisini qo'ying.\n\n"
            "Misol:\n"
            "<code>* 4\n5\n6\n3</code>\n\n"
            "Kamida 2 ta variant va aynan 1 ta to'g'ri javob bo'lishi kerak."
        )
    elif kind == "text":
        await state.set_state(TaskForm.answer_key)
        await callback.message.edit_text(  # type: ignore[union-attr]
            "5️⃣ <b>Namuna javob(lar)ni</b> yuboring — har biri yangi qatorda.\n\n"
            "• Muqobil javoblar: yangi qator yoki <code>|</code> bilan.\n"
            "• Bitta javobda bir nechta kalit so'z: <code>+</code> bilan.\n\n"
            "Misol:\n"
            "<code>4|to'rt|4 ta</code>\n"
            "<code>fotosintez+xlorofill</code>\n\n"
            "O'quvchi javobi kalitlarga mos kelsa, bot avtomatik ball qo'yadi."
        )
    else:
        await state.set_state(TaskForm.pass_score)
        await callback.message.edit_text(  # type: ignore[union-attr]
            "5️⃣ O'tish ballini kiriting (0.5–10).\n"
            "Standart qiymat uchun /skip yuboring."
        )
    await callback.answer()


@router.message(TaskForm.options, ~F.text.in_(MENU_TEXTS))
async def new_task_options(message: Message, state: FSMContext, db_user: dict | None) -> None:
    if not is_staff(db_user):
        return
    raw_text = (message.text or "").strip()
    if raw_text.startswith("/"):
        await message.answer("Variantlarni yuboring yoki /bekor bilan chiqing.")
        return
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    options: list[dict] = []
    correct_count = 0
    for line in lines:
        is_correct = line.startswith("*")
        label = line.lstrip("*").strip()
        if not label:
            continue
        options.append(
            {
                "k": chr(ord("A") + len(options)),
                "t": label[:80],
                "c": is_correct,
            }
        )
        correct_count += int(is_correct)

    if len(options) < 2 or correct_count != 1:
        await message.answer(
            "❌ Format noto'g'ri.\n\n"
            "Kamida 2 ta variant va aynan 1 ta <code>*</code> bilan belgilangan to'g'ri javob kerak.\n"
            "Misol:\n<code>* 4\n5\n6\n3</code>"
        )
        return

    await state.update_data(options=json.dumps(options, ensure_ascii=False))
    await state.set_state(TaskForm.pass_score)
    await message.answer(
        f"✅ {len(options)} ta variant qabul qilindi.\n\n"
        "6️⃣ O'tish ballini kiriting (0.5–10). Standart uchun /skip."
    )


@router.message(TaskForm.answer_key, ~F.text.in_(MENU_TEXTS))
async def new_task_answer_key(message: Message, state: FSMContext, db_user: dict | None) -> None:
    if not is_staff(db_user):
        return
    key = (message.text or "").strip()
    if key.startswith("/"):
        await message.answer("Kalit so'zlarni yuboring yoki /bekor bilan chiqing.")
        return
    if len(key) < 1:
        await message.answer("Namuna javobni yozing.")
        return
    await state.update_data(answer_key=key[:1000])
    await state.set_state(TaskForm.pass_score)
    await message.answer(
        "6️⃣ O'tish ballini kiriting (0.5–10). Standart uchun /skip yuboring."
    )


@router.message(TaskForm.pass_score, ~F.text.in_(MENU_TEXTS))
async def new_task_pass_score(
    message: Message, state: FSMContext, db_user: dict | None, settings: Settings
) -> None:
    if not is_staff(db_user):
        return
    text = (message.text or "").strip().lower()
    if text.startswith("/") and text not in {"/skip", "/bekor"}:
        await message.answer("Ballni kiriting, /skip yuboring yoki /bekor bilan chiqing.")
        return
    if text in {"/skip", "skip"}:
        pass_score = settings.default_pass_score
    else:
        try:
            pass_score = float(text.replace(",", "."))
        except ValueError:
            await message.answer("Ballni raqam bilan kiriting (masalan: 6 yoki 7.5).")
            return
        if not 0.5 <= pass_score <= 10:
            await message.answer("Ball 0.5 dan 10 gacha bo'lishi kerak.")
            return
    await state.update_data(pass_score=pass_score)
    await state.set_state(TaskForm.deadline)
    await message.answer(
        "7️⃣ Vazifa muddatini <b>kunlarda</b> kiriting (masalan: 3).\n"
        "Muddat kerak bo'lmasa /skip yuboring."
    )


@router.message(TaskForm.deadline, ~F.text.in_(MENU_TEXTS))
async def new_task_deadline(message: Message, state: FSMContext, db_user: dict | None) -> None:
    if not is_staff(db_user):
        return
    text = (message.text or "").strip().lower()
    if text.startswith("/") and text not in {"/skip", "/bekor"}:
        await message.answer("Kun sonini kiriting, /skip yuboring yoki /bekor bilan chiqing.")
        return
    if text in {"/skip", "skip", "0"}:
        days = 0
    else:
        try:
            days = int(text)
        except ValueError:
            await message.answer("Kun sonini kiriting (masalan: 3) yoki /skip.")
            return
        if not 0 <= days <= 365:
            await message.answer("Muddat 0–365 kun oralig'ida bo'lishi kerak.")
            return
    await state.update_data(deadline_days=days)
    await state.set_state(TaskForm.bonus)
    await message.answer(
        "8️⃣ Bu vazifa <b>qo'shimcha (bonus)</b> vazifami?\n\n"
        "🎁 Bonus vazifa modulning oxirgi vazifasi bajarilgandan keyin ochiladi.",
        reply_markup=wizard_bonus_kb(),
    )


@router.callback_query(F.data.startswith("nt:bonus:"))
async def new_task_bonus(callback: CallbackQuery, state: FSMContext, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    is_bonus = callback.data.split(":", 2)[2] == "1"  # type: ignore[union-attr]
    await state.update_data(is_bonus=int(is_bonus))
    data = await state.get_data()
    if not data.get("module_id") or not data.get("title"):
        await callback.answer("Ma'lumotlar yo'qolgan. Qaytadan boshlang.", show_alert=True)
        return

    kind_label = {"quiz": "test", "text": "yozma javob", "manual": "qo'lda tekshirish"}.get(
        data.get("kind", "text"), data.get("kind")
    )
    extra = ""
    if data.get("kind") == "quiz" and data.get("options"):
        try:
            opts = json.loads(data["options"])
            extra = "\n🔤 Variantlar: " + ", ".join(f"{o['k']}) {esc(o['t'])}" for o in opts)
        except (ValueError, TypeError, KeyError):
            extra = ""

    bonus_text = "ha" if is_bonus else "yo'q"
    summary = (
        "🧾 <b>Tekshirib ko'ring</b>\n\n"
        f"📦 Modul: <b>{esc(data.get('module_title') or '—')}</b>\n"
        f"📝 Nomi: <b>{esc(data.get('title') or '—')}</b>\n"
        f"🧾 Tur: {esc(kind_label)}\n"
        f"🎯 O'tish balli: <b>{fmt_points(data.get('pass_score'))}</b>\n"
        f"⏰ Muddat: {data.get('deadline_days') or 0} kun\n"
        f"🎁 Bonus: {bonus_text}"
        f"{extra}\n\n"
        "Saqlaymizmi?"
    )
    await state.set_state(TaskForm.confirm)
    await callback.message.edit_text(summary, reply_markup=wizard_confirm_kb())  # type: ignore[union-attr]
    await callback.answer()


@router.callback_query(F.data == "nt:save")
async def new_task_save(callback: CallbackQuery, state: FSMContext, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    data = await state.get_data()
    module_id = data.get("module_id")
    title = data.get("title")
    if not module_id or not title:
        await callback.answer("Ma'lumot yo'qolgan, qaytadan boshlang", show_alert=True)
        await state.clear()
        return

    is_bonus = int(data.get("is_bonus", 0))
    sort_order = await db.next_sort_order(int(module_id))
    unlock_after = None
    if is_bonus:
        last = await db.last_task(int(module_id))
        unlock_after = int(last["id"]) if last else None

    task_id = await db.create_task(
        module_id=int(module_id),
        title=title,
        description=data.get("description", ""),
        kind=data.get("kind", "text"),
        answer_key=data.get("answer_key"),
        options=data.get("options"),
        pass_score=float(data.get("pass_score") or 6),
        sort_order=sort_order,
        unlock_after=unlock_after,
        is_bonus=is_bonus,
        deadline_days=int(data.get("deadline_days") or 0),
        created_by=int(db_user["id"]),  # type: ignore[index]
    )
    await state.clear()

    module = await db.get_module(int(module_id))
    text = (
        "✅ <b>Vazifa qo'shildi!</b>\n\n"
        f"📦 Modul: <b>{esc(module['title'] if module else '—')}</b>\n"
        f"📝 {esc(title)}\n"
        f"🆔 #{task_id}\n\n"
        "O'quvchilarga xabar berish uchun «📢 Xabar yuborish» dan foydalanishingiz mumkin."
    )
    try:
        await callback.message.edit_text(text, reply_markup=_panel_kb())  # type: ignore[union-attr]
    except TelegramAPIError:
        await callback.message.answer(text, reply_markup=_panel_kb())  # type: ignore[union-attr]
    await callback.answer("Saqlandi ✅")


@router.callback_query(F.data == "nt:cancel")
async def new_task_cancel(callback: CallbackQuery, state: FSMContext, db: Database, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    await state.clear()
    text, counts = await _panel_state(db)
    await callback.message.edit_text(text, reply_markup=panel_kb(counts))  # type: ignore[union-attr]
    await callback.answer("Bekor qilindi")


@router.message(TaskForm.kind, ~F.text.in_(MENU_TEXTS))
async def kind_hint(message: Message, db_user: dict | None) -> None:
    if not is_staff(db_user):
        return
    await message.answer(
        "Iltimos, vazifa turini pastdagi tugmalardan tanlang:", reply_markup=wizard_kind_kb()
    )


@router.message(TaskForm.bonus, ~F.text.in_(MENU_TEXTS))
async def bonus_hint(message: Message, db_user: dict | None) -> None:
    if not is_staff(db_user):
        return
    await message.answer(
        "Iltimos, pastdagi tugmalardan birini tanlang:", reply_markup=wizard_bonus_kb()
    )


@router.message(TaskForm.confirm, ~F.text.in_(MENU_TEXTS))
async def confirm_hint(message: Message, db_user: dict | None) -> None:
    if not is_staff(db_user):
        return
    await message.answer(
        "Vazifani saqlash yoki bekor qilish uchun tugmalardan foydalaning:",
        reply_markup=wizard_confirm_kb(),
    )


# ------------------------------------------------------------------ sozlamalar
async def _settings_text(db: Database, settings: Settings) -> str:
    code = await db.get_setting("invite_code", settings.invite_code) or "—"
    pass_score = await db.get_setting("default_pass_score", str(settings.default_pass_score))
    return (
        "⚙️ <b>Sozlamalar</b>\n\n"
        f"🔑 O'quv kodi: <code>{esc(code)}</code>\n"
        f"🎯 Standart o'tish balli: <b>{esc(pass_score)}</b>\n"
        f"⏱ Muddat tekshiruvi: har <b>{settings.check_interval // 60}</b> daqiqa\n"
        f"🔁 Maksimal urinishlar: <b>{settings.max_attempts}</b>\n\n"
        "O'quv kodi — o'quvchilar ro'yxatdan o'tishda kiritib, darhol tasdiqlanishi uchun."
    )


@router.callback_query(F.data == "panel:settings")
async def settings_panel(callback: CallbackQuery, db: Database, db_user: dict | None, settings: Settings) -> None:
    if not await _guard(callback, db_user):
        return
    await callback.message.edit_text(  # type: ignore[union-attr]
        await _settings_text(db, settings), reply_markup=settings_kb()
    )
    await callback.answer()


@router.callback_query(F.data == "st:code")
async def set_code_start(callback: CallbackQuery, state: FSMContext, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    await state.set_state(SettingForm.invite_code)
    await callback.message.edit_text(  # type: ignore[union-attr]
        "🔑 Yangi o'quv kodini yozing.\n\n"
        "Kodni o'chirish uchun <code>-</code> yuboring."
    )
    await callback.answer()


@router.message(SettingForm.invite_code, ~F.text.in_(MENU_TEXTS))
async def set_code(message: Message, state: FSMContext, db: Database, db_user: dict | None, settings: Settings) -> None:
    if not is_staff(db_user):
        return
    code = (message.text or "").strip()
    if code.startswith("/"):
        await message.answer("Kodni yozing yoki /bekor bilan chiqing.")
        return
    if code == "-":
        await db.set_setting("invite_code", "")
        code_text = "o'chirildi"
    elif len(code) > 40:
        await message.answer("Kod juda uzun (40 belgidan oshmasin).")
        return
    else:
        await db.set_setting("invite_code", code)
        code_text = f"<code>{esc(code)}</code>"
    await state.clear()
    await message.answer(
        f"✅ O'quv kodi {code_text}.\n\n" + await _settings_text(db, settings),
        reply_markup=settings_kb(),
    )


# ------------------------------------------------------------------ ommaviy xabar
@router.callback_query(F.data == "panel:broadcast")
async def broadcast_start(callback: CallbackQuery, state: FSMContext, db_user: dict | None) -> None:
    if not await _guard(callback, db_user):
        return
    await state.set_state(Broadcast.text)
    await callback.message.edit_text(  # type: ignore[union-attr]
        "📢 <b>Ommaviy xabar</b>\n\n"
        "Barcha faol o'quvchilarga yuboriladigan xabarni yozing.\n"
        "Bekor qilish: /bekor"
    )
    await callback.answer()


@router.message(Broadcast.text, ~F.text.in_(MENU_TEXTS))
async def broadcast_send(message: Message, state: FSMContext, db: Database, db_user: dict | None, settings: Settings, bot: Bot) -> None:
    if not is_staff(db_user):
        return
    text = (message.text or "").strip()
    if text.startswith("/"):
        await message.answer("Xabar matnini yozing yoki /bekor bilan chiqing.")
        return
    if not text:
        await message.answer("Xabar matnini yozing.")
        return
    await state.clear()
    students = await db.active_students()
    sent = 0
    for student in students:
        if await safe_send(
            bot,
            int(student["tg_id"]),
            f"📢 Ustoz xabari:\n\n{text}",
            parse_mode=None,
        ):
            sent += 1
        await asyncio.sleep(0.05)
    text_out, counts = await _panel_state(db)
    await message.answer(
        f"✅ Xabar yuborildi: <b>{sent}/{len(students)}</b> o'quvchiga.\n\n{text_out}",
        reply_markup=panel_kb(counts),
    )
