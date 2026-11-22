"""Botning kirish nuqtasi."""
from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import suppress

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage

from bot.config import Settings, load_settings
from bot.db import Database
from bot.handlers import admin, cancel, common, student, teacher
from bot.middlewares import UserMiddleware
from bot.services.scheduler import deadline_worker

logger = logging.getLogger(__name__)


def build_dispatcher(db: Database, settings: Settings) -> Dispatcher:
    dp = Dispatcher(storage=MemoryStorage())
    dp["db"] = db
    dp["settings"] = settings
    dp.message.outer_middleware(UserMiddleware(db))
    dp.callback_query.outer_middleware(UserMiddleware(db))
    dp.include_routers(
        cancel.router, admin.router, teacher.router, common.router, student.router
    )

    @dp.errors()
    async def on_error(event) -> bool:
        logger.exception("Update'da xatolik: %s", event.exception)
        return True

    return dp


async def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            with suppress(Exception):
                stream.reconfigure(encoding="utf-8", errors="replace")

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    )
    logging.getLogger("aiogram.event").setLevel(logging.WARNING)

    settings = load_settings()
    if not settings.has_token:
        raise SystemExit(
            "\n❌ BOT_TOKEN topilmadi.\n"
            "1) .env.example faylidan nusxa olib .env yarating: cp .env.example .env\n"
            "2) @BotFather dan token oling va .env faylidagi BOT_TOKEN ga yozing.\n"
        )

    db = Database(settings.db_path)
    await db.connect()
    if settings.invite_code and not await db.get_setting("invite_code"):
        await db.set_setting("invite_code", settings.invite_code)

    bot = Bot(settings.bot_token, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
    dispatcher = build_dispatcher(db, settings)
    worker = asyncio.create_task(deadline_worker(bot, db, settings))

    logger.info("Baza: %s", settings.db_path)
    logger.info("Bot ishga tushmoqda...")
    try:
        await bot.delete_webhook(drop_pending_updates=True)
        await dispatcher.start_polling(
            bot, allowed_updates=dispatcher.resolve_used_update_types()
        )
    finally:
        worker.cancel()
        with suppress(asyncio.CancelledError):
            await worker
        await bot.session.close()
        await db.close()
        logger.info("Bot to'xtatildi")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
