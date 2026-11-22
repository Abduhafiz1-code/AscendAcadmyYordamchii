"""Barcha klaviaturalar va menyu matnlari."""
from __future__ import annotations

from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)

from bot.utils import truncate

BTN_TASKS = "📚 Vazifalarim"
BTN_RATING = "🏆 Reyting"
BTN_RESULTS = "📊 Natijalarim"
BTN_HELP = "ℹ️ Yordam"
BTN_PANEL = "🛠 Ustoz paneli"
BTN_HOME = "🏠 Asosiy menyu"
BTN_CANCEL = "❌ Bekor qilish"

MENU_TEXTS = {BTN_TASKS, BTN_RATING, BTN_RESULTS, BTN_HELP, BTN_PANEL, BTN_HOME, BTN_CANCEL}

STATUS_ICONS = {
    "auto_passed": "✅",
    "graded": "✅",
    "auto_failed": "❌",
    "teacher_review": "👀",
    "not_done": "⚠️",
    "rejected": "🔁",
}


def is_staff(user: dict | None) -> bool:
    return bool(
        user
        and user.get("role") in ("teacher", "admin")
        and user.get("status") == "active"
    )


def main_menu(staff: bool = False) -> ReplyKeyboardMarkup:
    rows = [
        [KeyboardButton(text=BTN_TASKS), KeyboardButton(text=BTN_RATING)],
        [KeyboardButton(text=BTN_RESULTS), KeyboardButton(text=BTN_HELP)],
    ]
    if staff:
        rows.append([KeyboardButton(text=BTN_PANEL)])
    return ReplyKeyboardMarkup(keyboard=rows, resize_keyboard=True)


def phone_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📱 Telefon raqamni yuborish", request_contact=True)],
            [KeyboardButton(text="⏭ O'tkazib yuborish")],
        ],
        resize_keyboard=True,
        one_time_keyboard=True,
    )


def code_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="⏳ Ustoz tasdiqlashini so'rash", callback_data="reg:request")]]
    )


def cancel_kb() -> ReplyKeyboardMarkup:
    return ReplyKeyboardMarkup(keyboard=[[KeyboardButton(text=BTN_CANCEL)]], resize_keyboard=True)


def modules_kb(modules: list[dict], progress: dict[int, tuple[int, int]]) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    for module in modules:
        done, total = progress.get(int(module["id"]), (0, 0))
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"📦 {truncate(module['title'], 38)} · {done}/{total}",
                    callback_data=f"mod:{module['id']}",
                )
            ]
        )
    if not rows:
        rows.append([InlineKeyboardButton(text="Hozircha modul yo'q", callback_data="noop")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def tasks_kb(states: list, module_id: int) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    for state in states:
        task = state.task
        if state.passed:
            icon = "✅"
        elif state.pending:
            icon = "⏳"
        elif state.unlocked:
            icon = "🎁" if task["is_bonus"] else "🔓"
        else:
            icon = "🔒"
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"{icon} {truncate(task['title'], 42)}",
                    callback_data=f"task:{task['id']}",
                )
            ]
        )
    rows.append([InlineKeyboardButton(text="⬅️ Modullar", callback_data="back:modules")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def task_kb(task: dict, state, options: list[dict]) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    if state.unlocked and not state.passed and not state.pending:
        if task["kind"] == "quiz" and options:
            for option in options:
                rows.append(
                    [
                        InlineKeyboardButton(
                            text=f"{option['k']}) {truncate(str(option['t']), 40)}",
                            callback_data=f"q:{task['id']}:{option['k']}",
                        )
                    ]
                )
        else:
            rows.append(
                [InlineKeyboardButton(text="✍️ Javob yuborish", callback_data=f"s:{task['id']}")]
            )
        rows.append(
            [InlineKeyboardButton(text="❌ Topshira olmadim", callback_data=f"cant:{task['id']}")]
        )
    rows.append(
        [
            InlineKeyboardButton(
                text="⬅️ Ortga", callback_data=f"back:module:{task['module_id']}"
            )
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def grade_kb(submission_id: int) -> InlineKeyboardMarkup:
    scores = ["10", "9", "8", "7", "6", "5", "4", "3", "2", "1", "0.5", "0"]
    rows: list[list[InlineKeyboardButton]] = []
    for i in range(0, len(scores), 4):
        rows.append(
            [
                InlineKeyboardButton(
                    text=f"{score}", callback_data=f"g:{submission_id}:{score}"
                )
                for score in scores[i : i + 4]
            ]
        )
    rows.append(
        [
            InlineKeyboardButton(
                text="🔁 Qayta topshirishga ruxsat", callback_data=f"g:{submission_id}:retry"
            )
        ]
    )
    return InlineKeyboardMarkup(inline_keyboard=rows)


def panel_kb(counts: dict[str, int]) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"📥 Tekshirish ({counts.get('pending', 0)})", callback_data="panel:pending"
                )
            ],
            [
                InlineKeyboardButton(text="➕ Yangi vazifa", callback_data="panel:new"),
                InlineKeyboardButton(text="📋 Vazifalar", callback_data="panel:tasks"),
            ],
            [
                InlineKeyboardButton(
                    text=f"👥 O'quvchilar ({counts.get('awaiting', 0)} so'rov)",
                    callback_data="panel:students",
                ),
                InlineKeyboardButton(text="🏆 Reyting", callback_data="panel:rating"),
            ],
            [
                InlineKeyboardButton(text="📢 Xabar yuborish", callback_data="panel:broadcast"),
                InlineKeyboardButton(text="⚙️ Sozlamalar", callback_data="panel:settings"),
            ],
        ]
    )


def approve_kb(user_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Tasdiqlash", callback_data=f"u:ok:{user_id}"),
                InlineKeyboardButton(text="❌ Rad etish", callback_data=f"u:no:{user_id}"),
            ]
        ]
    )


def pending_list_kb(rows: list[dict]) -> InlineKeyboardMarkup:
    buttons: list[list[InlineKeyboardButton]] = []
    for row in rows:
        label = f"#{row['id']} · {truncate(row['full_name'], 18)} · {truncate(row['task_title'], 24)}"
        buttons.append([InlineKeyboardButton(text=label, callback_data=f"sub:{row['id']}")])
    buttons.append([InlineKeyboardButton(text="⬅️ Panel", callback_data="back:panel")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def students_kb(users: list[dict]) -> InlineKeyboardMarkup:
    buttons: list[list[InlineKeyboardButton]] = []
    for user in users:
        buttons.append(
            [
                InlineKeyboardButton(
                    text=f"✅ {truncate(user['full_name'], 22)}",
                    callback_data=f"u:ok:{user['id']}",
                ),
                InlineKeyboardButton(text="❌", callback_data=f"u:no:{user['id']}"),
            ]
        )
    buttons.append([InlineKeyboardButton(text="⬅️ Panel", callback_data="back:panel")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def modules_admin_kb(modules: list[dict], counts: dict[int, int]) -> InlineKeyboardMarkup:
    rows = [
        [
            InlineKeyboardButton(
                text=f"📦 {truncate(m['title'], 32)} ({counts.get(int(m['id']), 0)})",
                callback_data=f"tm:{m['id']}",
            )
        ]
        for m in modules
    ]
    rows.append([InlineKeyboardButton(text="⬅️ Panel", callback_data="back:panel")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def task_manage_kb(task: dict) -> InlineKeyboardMarkup:
    toggle = "▶️ Faollashtirish" if not task["is_active"] else "⏸ Faolsizlantirish"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text=toggle, callback_data=f"tt:{task['id']}:tog"),
                InlineKeyboardButton(text="🗑 O'chirish", callback_data=f"tt:{task['id']}:del"),
            ],
            [
                InlineKeyboardButton(
                    text="⬅️ Modul", callback_data=f"tm:{task['module_id']}"
                )
            ],
        ]
    )


def confirm_delete_kb(task_id: int) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🗑 Ha, o'chirish", callback_data=f"tt:{task_id}:delok"),
                InlineKeyboardButton(text="⬅️ Yo'q", callback_data=f"tt:{task_id}"),
            ]
        ]
    )


def wizard_modules_kb(modules: list[dict]) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text=f"📦 {truncate(m['title'], 36)}", callback_data=f"nt:mod:{m['id']}")]
        for m in modules
    ]
    rows.append([InlineKeyboardButton(text="➕ Yangi modul", callback_data="nt:mod:new")])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def wizard_kind_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🔤 Test (variantli)", callback_data="nt:kind:quiz")],
            [InlineKeyboardButton(text="✍️ Yozma javob (avtomatik)", callback_data="nt:kind:text")],
            [InlineKeyboardButton(text="👀 Qo'lda tekshirish (fayl/rasm)", callback_data="nt:kind:manual")],
        ]
    )


def wizard_bonus_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🎁 Ha, qo'shimcha", callback_data="nt:bonus:1"),
                InlineKeyboardButton(text="📚 Yo'q, oddiy", callback_data="nt:bonus:0"),
            ]
        ]
    )


def wizard_confirm_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="✅ Saqlash", callback_data="nt:save")],
            [InlineKeyboardButton(text="❌ Bekor qilish", callback_data="nt:cancel")],
        ]
    )


def rating_period_kb(period: str) -> InlineKeyboardMarkup:
    all_label = "• Umumiy •" if period == "all" else "Umumiy"
    week_label = "• Haftalik •" if period == "week" else "Haftalik"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text=all_label, callback_data="rating:all"),
                InlineKeyboardButton(text=week_label, callback_data="rating:week"),
            ]
        ]
    )


def settings_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="🔑 O'quv kodini o'zgartirish", callback_data="st:code")],
            [InlineKeyboardButton(text="📢 Xabar yuborish", callback_data="panel:broadcast")],
            [InlineKeyboardButton(text="⬅️ Panel", callback_data="back:panel")],
        ]
    )


def admin_kb() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="➕ Ustoz qo'shish", callback_data="adm:addteacher")],
            [InlineKeyboardButton(text="👨‍🏫 Ustozlar ro'yxati", callback_data="adm:teachers")],
        ]
    )
