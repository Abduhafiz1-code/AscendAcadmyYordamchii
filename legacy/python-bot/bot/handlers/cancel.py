"""Har qanday bosqichda ishlaydigan bekor qilish (birinchi router)."""
from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from bot.keyboards import BTN_CANCEL, is_staff, main_menu

router = Router(name="cancel")


@router.message(Command("bekor", "cancel"))
@router.message(F.text == BTN_CANCEL)
async def cancel(message: Message, state: FSMContext, db_user: dict | None) -> None:
    await state.clear()
    if db_user and db_user.get("status") == "active":
        await message.answer(
            "Bekor qilindi. Asosiy menyu:",
            reply_markup=main_menu(staff=is_staff(db_user)),
        )
    else:
        await message.answer("Bekor qilindi.")
