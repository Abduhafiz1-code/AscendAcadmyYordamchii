"""Kichik yordamchi funksiyalar: vaqt, formatlash, xavfsiz matn."""
from __future__ import annotations

import html
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=5))


def esc(value: object) -> str:
    """Telegram HTML uchun xavfsiz matn."""
    return html.escape(str(value if value is not None else ""), quote=False)


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now_utc().isoformat(timespec="seconds")


def parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def fmt_dt(value: str | None, tz_offset: int = 5) -> str:
    dt = parse_iso(value)
    if not dt:
        return "—"
    local = dt.astimezone(timezone(timedelta(hours=tz_offset)))
    return local.strftime("%d.%m.%Y %H:%M")


def fmt_date(value: str | None, tz_offset: int = 5) -> str:
    dt = parse_iso(value)
    if not dt:
        return "—"
    local = dt.astimezone(timezone(timedelta(hours=tz_offset)))
    return local.strftime("%d.%m.%Y")


def fmt_points(value: float | int | None) -> str:
    if value is None:
        return "—"
    value = float(value)
    if value == int(value):
        return str(int(value))
    return f"{value:.1f}".rstrip("0").rstrip(".")


def truncate(text: str, limit: int) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def progress_bar(done: int, total: int, width: int = 10) -> str:
    if total <= 0:
        return "░" * width
    filled = int(round(width * done / total))
    return "█" * filled + "░" * (width - filled)


def medal(index: int) -> str:
    return {0: "🥇", 1: "🥈", 2: "🥉"}.get(index, f"{index + 1}.")


def user_mention(user: dict) -> str:
    name = esc(user.get("full_name") or "Foydalanuvchi")
    username = user.get("username")
    if username:
        return f'{name} (@{esc(username)})'
    return f'<a href="tg://user?id={int(user["tg_id"])}">{name}</a>'
