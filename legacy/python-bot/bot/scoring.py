"""Javoblarni avtomatik tekshirish va 0.5–10 ball hisoblash.

Javob kaliti formati
--------------------
* Muqobil javoblar  -> yangi qator yoki `|` bilan ajratiladi.
* Bitta javobdagi bir nechta kalit so'z -> `+` bilan yoziladi.

Misol:
    4|to'rt|4 ta          # shu javoblardan biri bo'lsa - to'liq to'g'ri
    fotosintez+xlorofill  # ikkala so'z ham javobda bo'lishi kerak
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

MIN_POINTS = 0.5
MAX_POINTS = 10.0

_APOSTROPHES = "'’‘ʻ`´＇"
_VARIANT_SPLIT = re.compile(r"[|\n]+")


@dataclass(frozen=True)
class CheckResult:
    ratio: float
    score: float
    matched: int
    total: int
    matched_keywords: tuple[str, ...] = ()


def normalize(text: str | None) -> str:
    """Matnni solishtirish uchun bir xil ko'rinishga keltiradi."""
    text = unicodedata.normalize("NFKC", text or "").lower()
    for ch in _APOSTROPHES:
        text = text.replace(ch, "'")
    text = text.replace("_", " ")
    text = re.sub(r"[^\w'\s]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def parse_variants(answer_key: str | None) -> list[list[str]]:
    variants: list[list[str]] = []
    for chunk in _VARIANT_SPLIT.split(answer_key or ""):
        chunk = chunk.strip()
        if not chunk or chunk.startswith("#"):
            continue
        keywords = [normalize(part) for part in chunk.split("+")]
        keywords = [kw for kw in keywords if kw]
        if keywords:
            variants.append(keywords)
    return variants


def _contains(answer: str, keyword: str) -> bool:
    if keyword.isdigit():
        return keyword in answer.split()
    if len(keyword) <= 2:
        return re.search(rf"(?<!\w){re.escape(keyword)}(?!\w)", answer) is not None
    return keyword in answer


def score_from_ratio(ratio: float, min_points: float = MIN_POINTS, max_points: float = MAX_POINTS) -> float:
    """Nisbatni 0.5 qadam bilan 0.5–10 oraliqdagi ballga aylantiradi."""
    ratio = max(0.0, min(1.0, ratio))
    raw = max_points * ratio
    raw = round(raw * 2) / 2
    return round(max(min_points, min(max_points, raw)), 2)


def check_answer(answer: str | None, answer_key: str | None) -> CheckResult:
    """Yozma javobni kalit bilan solishtiradi."""
    normalized = normalize(answer)
    variants = parse_variants(answer_key)
    if not normalized or not variants:
        return CheckResult(0.0, 0.0, 0, 0, ())

    best_ratio = 0.0
    best_matched = 0
    best_total = len(variants[0])
    best_keywords: tuple[str, ...] = ()

    for keywords in variants:
        matched = [kw for kw in keywords if _contains(normalized, kw)]
        ratio = len(matched) / len(keywords)
        if ratio > best_ratio:
            best_ratio = ratio
            best_matched = len(matched)
            best_total = len(keywords)
            best_keywords = tuple(matched)

    return CheckResult(
        ratio=round(best_ratio, 3),
        score=score_from_ratio(best_ratio),
        matched=best_matched,
        total=best_total,
        matched_keywords=best_keywords,
    )
