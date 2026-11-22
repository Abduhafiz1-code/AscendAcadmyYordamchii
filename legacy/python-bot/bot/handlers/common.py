"""Asosiy oqim: /start, ro'yxatdan o'tish, yordam, bekor qilish."""
from __future__ import annotations

import logging

from aiogram import F, Router
from aiogram.filters import BaseFilter, Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message, ReplyKeyboardRemove

from bot.config import Settings
from bot.db import Database
from bot.keyboards import (
    BTN_HOME,
    MENU_TEXTS,
    approve_kb,
    code_kb,
    is_staff,
    main_menu,
    phone_kb,
)
from bot.services.notify import notify_teachers
from bot.states import Reg
from bot.utils import esc, now_iso

logger = logging.getLogger(__name__)
router = Router(name="common")

WELCOME_STAFF = (
    "👋 Assalomu alaykum, <b>{name}</b>!\n\n"
    "Siz <b>ustoz</b> sifatida tizimdasiz.\n"
    "«🛠 Ustoz paneli» orqali vazifalarni boshqaring va o'quvchilar ishlarini tekshiring."
)

WELCOME_STUDENT = (
    "👋 Assalomu alaykum, <b>{name}</b>!\n\n"
    "Men <b>Ascend Academy</b> yordamchi ustoziman.\n"
    "Vazifalarni tekshiraman, ball qo'yaman va reytingni yuritaman.\n\n"
    "«📚 Vazifalarim» bo'limidan boshlang."
)

INTRO = (
    "🎓 <b>Ascend Academy — yordamchi ustoz</b>\n\n"
    "Ro'yxatdan o'tish uchun bir necha savolga javob bering.\n\n"
)


async def _resolve_user(message: Message, db: Database, settings: Settings) -> dict:
    tg = message.from_user
    assert tg is not None
    user = await db.get_user(tg.id)
    if user is None:
        # full_name ro'yxatdan o'tish yakunlanganda to'ldiriladi —
        # shu sababli bu yerda bo'sh qoldiriladi.
        user = await db.create_user(tg.id, tg.username, "")
    if tg.id in settings.admin_ids and (user["role"] != "admin" or user["status"] != "active"):
        await db.update_user(
            user["id"],
            role="admin",
            status="active",
            full_name=user.get("full_name") or (tg.full_name or ""),
            verified_at=user.get("verified_at") or now_iso(),
        )
        user = await db.get_user(tg.id) or user
    return user


def _staff_menu(user: dict):
    return main_menu(staff=is_staff(user))


async def _notify_new_student(db: Database, bot, user: dict) -> None:
    text = (
        "🆕 <b>Yangi o'quvchi so'rovi</b>\n\n"
        f"👤 {esc(user['full_name'])}\n"
        f"📚 Guruh: {esc(user.get('group_name') or '—')}\n"
        f"📱 Telefon: {esc(user.get('phone') or '—')}\n"
        f"🔗 Username: @{esc(user.get('username') or '—')}\n"
        f"🆔 Telegram ID: <code>{user['tg_id']}</code>\n\n"
        "O'quvchi ekanligini tasdiqlaysizmi?"
    )
    await notify_teachers(bot, db, text, approve_kb(int(user["id"])))


@router.message(CommandStart())
async def start(message: Message, state: FSMContext, db: Database, settings: Settings, db_user: dict | None, bot) -> None:
    await state.clear()
    user = await _resolve_user(message, db, settings)

    if user["status"] == "active":
        text = (WELCOME_STAFF if is_staff(user) else WELCOME_STUDENT).format(
            name=esc(user["full_name"] or message.from_user.full_name)  # type: ignore[union-attr]
        )
        await message.answer(text, reply_markup=_staff_menu(user))
        return

    if user["status"] == "blocked":
        await message.answer(
            "🚫 Hisobingiz bloklangan. Ustoz bilan bog'laning.",
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    if user["status"] == "rejected":
        await message.answer(
            "❌ Ro'yxatdan o'tish so'rovingiz rad etilgan.\n"
            "Ustoz bilan bog'lanib, qaytadan so'rov yuboring: /start",
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    # awaiting
    if user["full_name"]:
        await message.answer(
            "⏳ <b>So'rovingiz ko'rib chiqilmoqda.</b>\n\n"
            "Ustoz tasdiqlagach, botdan xabar keladi.\n"
            "Agar o'quv markaz kodingiz bo'lsa, uni kiritib darhol tasdiqlanishingiz mumkin.",
            reply_markup=code_kb(),
        )
        return

    await state.set_state(Reg.name)
    await message.answer(
        INTRO + "1️⃣ <b>Ism va familiyangizni</b> yozing:",
        reply_markup=ReplyKeyboardRemove(),
    )


@router.message(Reg.name, ~F.text.in_(MENU_TEXTS))
async def reg_name(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if text.startswith("/"):
        await message.answer("Ro'yxatdan o'tishni yakunlang yoki /bekor yuboring.")
        return
    if len(text) < 3 or text.isdigit():
        await message.answer("Iltimos, ism va familiyani to'liq yozing (kamida 3 belgi).")
        return
    await state.update_data(full_name=text[:80])
    await state.set_state(Reg.group)
    await message.answer(
        "2️⃣ <b>Guruhingiz nomini</b> yozing (masalan: <i>Frontend-101</i>):"
    )


@router.message(Reg.group, ~F.text.in_(MENU_TEXTS))
async def reg_group(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()
    if text.startswith("/"):
        await message.answer("Ro'yxatdan o'tishni yakunlang yoki /bekor yuboring.")
        return
    if len(text) < 2:
        await message.answer("Guruh nomini yozing (kamida 2 belgi).")
        return
    await state.update_data(group_name=text[:40])
    await state.set_state(Reg.phone)
    await message.answer(
        "3️⃣ <b>Telefon raqamingizni</b> yuboring.\n"
        "Bu ustoz bog'lanishi uchun kerak. O'tkazib yuborishingiz ham mumkin.",
        reply_markup=phone_kb(),
    )


@router.message(Reg.phone, F.contact)
async def reg_phone_contact(message: Message, state: FSMContext, db: Database, settings: Settings) -> None:
    phone = message.contact.phone_number if message.contact else None
    await _after_phone(message, state, phone, db, settings)


@router.message(Reg.phone, F.text, ~F.text.in_(MENU_TEXTS))
async def reg_phone_text(message: Message, state: FSMContext, db: Database, settings: Settings) -> None:
    text = (message.text or "").strip()
    if text in {"⏭ O'tkazib yuborish", "/skip"}:
        await _after_phone(message, state, None, db, settings)
        return
    if text.startswith("/"):
        await message.answer("Telefon raqamini yuboring yoki /skip ni bosing.")
        return
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) < 9:
        await message.answer("Telefon raqam noto'g'ri. Qayta yuboring yoki o'tkazib yuboring.")
        return
    await _after_phone(message, state, text[:25], db, settings)


async def _after_phone(
    message: Message, state: FSMContext, phone: str | None, db: Database, settings: Settings
) -> None:
    await state.update_data(phone=phone)
    expected_code = await db.get_setting("invite_code", settings.invite_code) or ""
    await state.set_state(Reg.code)
    if expected_code:
        await message.answer(
            "4️⃣ <b>O'quv markaz kodini</b> kiriting.\n\n"
            "Kod ustoz tomonidan beriladi. Kodingiz bo'lmasa — pastdagi tugma orqali "
            "ustoz tasdiqlashini so'rang.",
            reply_markup=ReplyKeyboardRemove(),
        )
        await message.answer("Tanlang:", reply_markup=code_kb())
    else:
        await message.answer(
            "4️⃣ Ro'yxatni yakunlash uchun ustoz tasdig'i kerak.",
            reply_markup=ReplyKeyboardRemove(),
        )
        await message.answer("Pastdagi tugmani bosing:", reply_markup=code_kb())


@router.message(Reg.code, F.text, ~F.text.in_(MENU_TEXTS))
async def reg_code(message: Message, state: FSMContext, db: Database, settings: Settings, bot) -> None:
    text = (message.text or "").strip()
    expected = await db.get_setting("invite_code", settings.invite_code) or ""
    data = await state.get_data()
    attempts = int(data.get("code_attempts", 0)) + 1

    if not expected:
        await message.answer(
            "Bu bosqichda kod talab qilinmaydi. Pastdagi tugmani bosing:",
            reply_markup=code_kb(),
        )
        return

    if text.startswith("/"):
        await message.answer("Kodni yozing yoki pastdagi tugmani bosing.")
        return

    if text.upper() == expected.upper():
        await _finish_registration(message, state, db, bot, data, auto=True)
        return

    if attempts >= 3:
        await state.update_data(code_attempts=attempts)
        await message.answer(
            "❌ Kod bir necha marta noto'g'ri kiritildi.\n"
            "Pastdagi tugma orqali ustoz tasdiqlashini so'rashingiz mumkin.",
            reply_markup=code_kb(),
        )
        return

    await state.update_data(code_attempts=attempts)
    await message.answer(
        f"❌ Kod noto'g'ri. Qayta urinib ko'ring ({3 - attempts} ta imkoniyat qoldi).\n"
        "Yoki pastdagi tugma orqali ustoz tasdiqlashini so'rang.",
        reply_markup=code_kb(),
    )


@router.callback_query(F.data == "reg:request")
async def reg_request(
    callback: CallbackQuery, state: FSMContext, db: Database, bot, db_user: dict | None
) -> None:
    data = await state.get_data()
    if not data.get("full_name"):
        if db_user and db_user.get("status") == "active":
            await callback.answer("Siz allaqachon tasdiqlangansiz ✅", show_alert=True)
            return
        if db_user and db_user.get("status") == "awaiting" and db_user.get("full_name"):
            await _notify_new_student(db, bot, db_user)
            await callback.answer("So'rov qayta yuborildi ⏳", show_alert=True)
            return
        await callback.answer("Avval ro'yxatdan o'tishni boshlang: /start", show_alert=True)
        return
    await _finish_registration(callback.message, state, db, bot, data, auto=False, callback=callback)
    await callback.answer()


async def _finish_registration(
    message: Message,
    state: FSMContext,
    db: Database,
    bot,
    data: dict,
    *,
    auto: bool,
    callback: CallbackQuery | None = None,
) -> None:
    tg = message.chat.id if callback is None else callback.from_user.id
    user = await db.get_user(tg)
    if user is None:
        await message.answer("Xatolik: foydalanuvchi topilmadi. /start bilan qayta boshlang.")
        return

    await db.update_user(
        user["id"],
        full_name=data.get("full_name") or user["full_name"],
        group_name=data.get("group_name"),
        phone=data.get("phone"),
        username=user.get("username"),
        status="active" if auto else "awaiting",
        verified_at=now_iso() if auto else None,
    )
    await state.clear()
    refreshed = await db.get_user(tg) or user

    if auto:
        text = (
            "✅ <b>Ro'yxatdan o'tdingiz!</b>\n\n"
            f"👤 {esc(refreshed['full_name'])}\n"
            f"📚 Guruh: {esc(refreshed.get('group_name') or '—')}\n\n"
            "Endi vazifalarni bajarishingiz mumkin. Omad!"
        )
        await message.answer(text, reply_markup=_staff_menu(refreshed))
        return

    await message.answer(
        "⏳ <b>So'rovingiz ustozga yuborildi.</b>\n\n"
        "O'quvchi ekanligingiz tasdiqlangach, bot sizga xabar yuboradi.\n"
        "Bu odatda qisqa vaqt oladi.",
        reply_markup=ReplyKeyboardRemove(),
    )
    await _notify_new_student(db, bot, refreshed)


@router.message(Command("yordam", "help"))
@router.message(F.text == "ℹ️ Yordam")
async def help_handler(message: Message, db_user: dict | None) -> None:
    text = (
        "ℹ️ <b>Bot qanday ishlaydi?</b>\n\n"
        "📚 <b>Vazifalarim</b> — modullar bo'yicha vazifalar.\n"
        "   • ✅ bajarilgan\n"
        "   • 🔓 ochiq\n"
        "   • ⏳ ustoz tekshiruvida\n"
        "   • 🔒 yopiq (avval oldingi vazifani bajaring)\n"
        "   • 🎁 qo'shimcha (bonus) vazifa\n\n"
        "🏅 <b>Ball:</b> har bir vazifa uchun 0.5 dan 10 gacha.\n"
        "To'g'ri javob qanchalik to'liq bo'lsa, shuncha yuqori ball.\n\n"
        "👀 Agar javob to'liq bo'lmasa yoki vazifa bajarilmasa — u <b>haqiqiy ustozga</b> "
        "yuboriladi va ustoz yakuniy ballni qo'yadi.\n\n"
        "🏆 <b>Reyting</b> — har bir vazifa bo'yicha eng yaxshi natijangiz yig'iladi.\n\n"
        "❓ Savollar bo'lsa ustozga murojaat qiling."
    )
    await message.answer(text, reply_markup=_staff_menu(db_user or {}))


@router.message(Command("menu"))
@router.message(F.text == BTN_HOME)
async def home(message: Message, state: FSMContext, db_user: dict | None) -> None:
    await state.clear()
    if not db_user or db_user.get("status") != "active":
        await message.answer("Iltimos, /start buyrug'ini yuboring.")
        return
    await message.answer("🏠 Asosiy menyu", reply_markup=_staff_menu(db_user))


@router.callback_query(F.data == "noop")
async def noop(callback: CallbackQuery) -> None:
    await callback.answer()


@router.message(Command("id"))
async def my_id(message: Message) -> None:
    await message.answer(f"🆔 Sizning Telegram ID: <code>{message.from_user.id}</code>")  # type: ignore[union-attr]


class InactiveFilter(BaseFilter):
    async def __call__(self, message: Message, db_user: dict | None = None) -> bool:
        return not db_user or db_user.get("status") != "active"


@router.message(InactiveFilter())
async def inactive_fallback(message: Message, db_user: dict | None) -> None:
    status = (db_user or {}).get("status")
    if status == "awaiting":
        await message.answer(
            "⏳ <b>So'rovingiz ko'rib chiqilmoqda.</b>\n\n"
            "Ustoz tasdiqlagach xabar keladi. Kod orqali tezroq tasdiqlanish uchun /start yuboring."
        )
    elif status == "blocked":
        await message.answer("🚫 Hisobingiz bloklangan. Ustoz bilan bog'laning.")
    elif status == "rejected":
        await message.answer(
            "❌ So'rovingiz rad etilgan. Qayta yuborish uchun /start ni bosing."
        )
    else:
        await message.answer("Boshlash uchun /start buyrug'ini yuboring.")
