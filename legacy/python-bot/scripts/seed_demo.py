"""Demo modul va vazifalarni bazaga qo'shadi.

Ishlatish:
    python scripts/seed_demo.py           # demo ma'lumot qo'shadi
    python scripts/seed_demo.py --force   # mavjud demo bo'lsa ham qayta qo'shadi
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from bot.config import load_settings  # noqa: E402
from bot.db import Database  # noqa: E402

MODULE_TITLE = "Matematika — asoslar (demo)"


async def seed() -> None:
    settings = load_settings()
    db = Database(settings.db_path)
    await db.connect()
    try:
        force = "--force" in sys.argv
        existing = await db.list_modules(active_only=False)
        if any(module["title"] == MODULE_TITLE for module in existing) and not force:
            print("ℹ️  Demo modul allaqachon mavjud. Qayta qo'shish uchun --force ishlatilsin.")
            return

        module_id = await db.create_module(
            MODULE_TITLE,
            "Ushbu modul bot imkoniyatlarini sinab ko'rish uchun yaratilgan.",
        )

        quiz_options = [
            {"k": "A", "t": "3", "c": False},
            {"k": "B", "t": "4", "c": True},
            {"k": "C", "t": "5", "c": False},
            {"k": "D", "t": "6", "c": False},
        ]
        task1 = await db.create_task(
            module_id=module_id,
            title="1-dars: 2 + 2 = ?",
            description="To'g'ri javobni tanlang. To'g'ri javob 10 ball beradi.",
            kind="quiz",
            options=json.dumps(quiz_options, ensure_ascii=False),
            pass_score=6,
            sort_order=1,
            deadline_days=3,
        )
        task2 = await db.create_task(
            module_id=module_id,
            title="2-dars: To'rtburchak yuzasi",
            description=(
                "To'rtburchakning yuzasi qanday topiladi? Formulani yozing.\n"
                "Masalan: S = a * b"
            ),
            kind="text",
            answer_key="uzunlik*eni|a*b|s=a*b|yuza+ko'paytirish",
            pass_score=6,
            sort_order=2,
            deadline_days=3,
        )
        await db.create_task(
            module_id=module_id,
            title="3-dars: Daftar ishi",
            description=(
                "Daftaringizga 5 ta misol yechib, rasmga oling va yuboring.\n"
                "Bu vazifani ustoz qo'lda tekshiradi."
            ),
            kind="manual",
            pass_score=6,
            sort_order=3,
            deadline_days=5,
        )
        last = await db.last_task(module_id)
        await db.create_task(
            module_id=module_id,
            title="🎁 Bonus: tez hisob",
            description="Qo'shimcha vazifa: 7 * 8 nechchi?",
            kind="quiz",
            options=json.dumps(
                [
                    {"k": "A", "t": "54", "c": False},
                    {"k": "B", "t": "56", "c": True},
                    {"k": "C", "t": "64", "c": False},
                ],
                ensure_ascii=False,
            ),
            pass_score=6,
            sort_order=4,
            unlock_after=int(last["id"]) if last else None,
            is_bonus=1,
            deadline_days=0,
        )
        print(f"✅ Demo modul qo'shildi (#{module_id}).")
        print(f"   Vazifalar: 4 ta (2 ta test, 1 ta yozma, 1 ta qo'lda) + bonus.")
        print("   Botda «📚 Vazifalarim» bo'limidan tekshirib ko'ring.")
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(seed())
