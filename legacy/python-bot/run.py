"""Botni ishga tushirish: python run.py"""
import asyncio
import sys

from bot.main import main

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nBot to'xtatildi.")
        sys.exit(0)
