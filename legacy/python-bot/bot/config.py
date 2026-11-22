"""Bot konfiguratsiyasi: .env fayldan o'qiladi."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


def _parse_ids(raw: str) -> frozenset[int]:
    ids: set[int] = set()
    for chunk in raw.replace(";", ",").split(","):
        chunk = chunk.strip()
        if chunk.lstrip("-").isdigit():
            ids.add(int(chunk))
    return frozenset(ids)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)).strip())
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)).strip().replace(",", "."))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    bot_token: str = ""
    admin_ids: frozenset[int] = field(default_factory=frozenset)
    db_path: Path = BASE_DIR / "data" / "bot.db"
    default_pass_score: float = 6.0
    tz_offset: int = 5
    check_interval: int = 600
    max_attempts: int = 5
    invite_code: str = ""

    @property
    def has_token(self) -> bool:
        return bool(self.bot_token)


def load_settings() -> Settings:
    db_raw = os.getenv("DB_PATH", "data/bot.db").strip() or "data/bot.db"
    db_path = Path(db_raw)
    if not db_path.is_absolute():
        db_path = BASE_DIR / db_path

    return Settings(
        bot_token=os.getenv("BOT_TOKEN", "").strip(),
        admin_ids=_parse_ids(os.getenv("ADMIN_IDS", "")),
        db_path=db_path,
        default_pass_score=_env_float("DEFAULT_PASS_SCORE", 6.0),
        tz_offset=_env_int("TZ_OFFSET", 5),
        check_interval=max(60, _env_int("CHECK_INTERVAL", 600)),
        max_attempts=max(1, _env_int("MAX_ATTEMPTS", 5)),
        invite_code=os.getenv("INVITE_CODE", "").strip(),
    )


settings = load_settings()
