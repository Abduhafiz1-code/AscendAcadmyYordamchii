"""Administrator paneli: ustozlarni qo'shish, umumiy statistika."""
from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, InlineKeyboardButton, InlineKeyboardMarkup, Message

from bot.db import Database
from bot.keyboards import MENU_TEXTS, admin_kb, main_menu
from bot.services.notify import notify_user
from bot.states import AdminForm
from bot.utils import esc, now_iso

logger = logging.getLogger(__name__)
router = Router(name="admin")


def _is_admin(user: dict | None) -> bool:
    return bool(user and user.get("role") == "admin" and user.get("status") == "active")


async def _deny(target: Message | CallbackQuery) -> None:
    text = "⛔ Bu bo'lim faqat administrator uchun."
    if isinstance(target, CallbackQuery):
        await target.answer(text, show_alert=True)
    else:
        await target.answer(text)


async def _admin_text(db: Database) -> str:
    counts = await db.counts()
    teachers = await db.teachers()
    return (
        "👑 <b>Administrator paneli</b>\n\n"
        f"👥 O'quvchilar: <b>{counts['students']}</b>\n"
        f"⏳ Tasdiq kutayotgan: <b>{counts['awaiting']}</b>\n"
        f"👨‍🏫 Ustozlar: <b>{len(teachers)}</b>\n"
        f"📋 Faol vazifalar: <b>{counts['tasks']}</b>\n"
        f"📥 Tekshirish kutayotgan: <b>{counts['pending']}</b>"
    )


@router.message(Command("admin"))
async def admin_panel(message: Message, db: Database, db_user: dict | None) -> None:
    if not _is_admin(db_user):
        await _deny(message)
        return
    await message.answer(await _admin_text(db), reply_markup=admin_kb())


@router.callback_query(F.data == "adm:panel")
async def admin_panel_cb(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not _is_admin(db_user):
        await _deny(callback)
        return
    await callback.message.edit_text(await _admin_text(db), reply_markup=admin_kb())  # type: ignore[union-attr]
    await callback.answer()


@router.callback_query(F.data == "adm:addteacher")
async def add_teacher_start(callback: CallbackQuery, state: FSMContext, db_user: dict | None) -> None:
    if not _is_admin(db_user):
        await _deny(callback)
        return
    await state.set_state(AdminForm.teacher_id)
    await callback.message.edit_text(  # type: ignore[union-attr]
        "👨‍🏫 <b>Ustoz qo'shish</b>\n\n"
        "Ustozning Telegram ID sini yuboring.\n"
        "Ustoz avval botga /start yuborgan bo'lishi kerak.\n\n"
        "ID ni bilish uchun ustoz /id buyrug'ini yuboradi."
    )
    await callback.answer()


@router.message(AdminForm.teacher_id, ~F.text.in_(MENU_TEXTS))
async def add_teacher(message: Message, state: FSMContext, db: Database, db_user: dict | None, bot) -> None:
    if not _is_admin(db_user):
        return
    raw = (message.text or "").strip()
    if not raw.isdigit():
        await message.answer("Telegram ID faqat raqamlardan iborat bo'ladi.")
        return
    target = await db.get_user(int(raw))
    if not target:
        await message.answer(
            "❌ Bu ID bazada topilmadi.\n"
            "Ustoz avval botga /start yuborishi kerak."
        )
        return
    full_name = target.get("full_name") or ""
    if not full_name:
        try:
            chat = await bot.get_chat(int(raw))
            full_name = chat.full_name or ""
        except Exception:  # TelegramAPIError va boshqalar
            full_name = f"Ustoz {raw}"
    await db.update_user(
        target["id"],
        role="teacher",
        status="active",
        full_name=full_name,
        verified_at=now_iso(),
    )
    await state.clear()
    await notify_user(
        bot,
        target,
        (
            "🎉 <b>Siz ustoz sifatida tasdiqlandingiz!</b>\n\n"
            "Endi «🛠 Ustoz paneli» bo'limi mavjud: vazifa qo'shish, "
            "o'quvchilarni tasdiqlash va ishlarni baholash."
        ),
        reply_markup=main_menu(staff=True),
    )
    await message.answer(
        f"✅ {esc(target['full_name'])} ustoz sifatida qo'shildi.",
        reply_markup=InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text="⬅️ Admin panel", callback_data="adm:panel")]]
        ),
    )


@router.callback_query(F.data == "adm:teachers")
async def list_teachers(callback: CallbackQuery, db: Database, db_user: dict | None) -> None:
    if not _is_admin(db_user):
        await _deny(callback)
        return
    teachers = await db.teachers()
    if not teachers:
        text = "👨‍🏫 Hozircha ustoz qo'shilmagan."
    else:
        lines = ["👨‍🏫 <b>Ustozlar</b>", ""]
        for index, teacher in enumerate(teachers, start=1):
            role = "👑 admin" if teacher["role"] == "admin" else "ustoz"
            lines.append(
                f"{index}. {esc(teacher['full_name'] or '—')} · {role} · "
                f"<code>{teacher['tg_id']}</code>"
            )
        text = "\n".join(lines)
    await callback.message.edit_text(  # type: ignore[union-attr]
        text,
        reply_markup=InlineKeyboardMarkup(
            inline_keyboard=[[InlineKeyboardButton(text="⬅️ Admin panel", callback_data="adm:panel")]]
        ),
    )
    await callback.answer()
