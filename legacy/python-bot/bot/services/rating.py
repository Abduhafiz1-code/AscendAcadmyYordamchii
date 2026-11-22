"""Reyting va leaderboard hisob-kitoblari."""
from __future__ import annotations

from datetime import timedelta

from bot.db import Database
from bot.utils import esc, fmt_points, medal, now_utc, truncate


def week_start_iso() -> str:
    return (now_utc() - timedelta(days=7)).isoformat(timespec="seconds")


async def build_leaderboard(db: Database, since: str | None = None) -> list[dict]:
    """Har bir o'quvchi uchun eng yaxshi ballar yig'indisi bo'yicha reyting."""
    students = await db.active_students()
    scores = await db.best_scores_all(since)
    tasks = {int(t["id"]): t for t in await db.list_tasks(active_only=True)}

    rows: list[dict] = []
    for student in students:
        best = scores.get(int(student["id"]), {})
        points = round(sum(best.values()), 2)
        passed = sum(
            1
            for task_id, score in best.items()
            if task_id in tasks and score >= float(tasks[task_id]["pass_score"])
        )
        rows.append(
            {
                "user": student,
                "points": points,
                "passed": passed,
                "solved": len(best),
            }
        )

    rows.sort(key=lambda item: (-item["points"], -item["passed"], item["user"]["full_name"].lower()))
    for index, row in enumerate(rows, start=1):
        row["rank"] = index
    return rows


def group_ranking(rows: list[dict]) -> list[dict]:
    groups: dict[str, list[float]] = {}
    for row in rows:
        group = (row["user"].get("group_name") or "Guruhsiz").strip() or "Guruhsiz"
        groups.setdefault(group, []).append(row["points"])
    result = [
        {
            "group": group,
            "points": round(sum(points) / len(points), 2),
            "members": len(points),
        }
        for group, points in groups.items()
    ]
    result.sort(key=lambda item: (-item["points"], item["group"].lower()))
    return result


async def rank_of_user(db: Database, user: dict, since: str | None = None) -> tuple[int, int, float]:
    rows = await build_leaderboard(db, since)
    for row in rows:
        if int(row["user"]["id"]) == int(user["id"]):
            return row["rank"], len(rows), row["points"]
    return 0, len(rows), 0.0


async def rating_text(db: Database, user: dict | None, period: str = "all") -> str:
    """Reyting ekrani matni: top o'quvchilar, guruhlar va o'z o'rni."""
    since = week_start_iso() if period == "week" else None
    rows = await build_leaderboard(db, since)
    title = "🏆 <b>Reyting — haftalik</b>" if period == "week" else "🏆 <b>Reyting — umumiy</b>"
    lines = [title, ""]
    if not rows:
        lines.append("Hozircha natijalar yo'q.")
        return "\n".join(lines)

    for index, row in enumerate(rows[:10]):
        student = row["user"]
        name = esc(truncate(student["full_name"] or "O'quvchi", 28))
        lines.append(
            f"{medal(index)} {name} — <b>{fmt_points(row['points'])}</b> ball"
            f" · {row['passed']} ta vazifa"
        )

    groups = group_ranking(rows)
    if groups:
        lines += ["", "📚 <b>Guruhlar reytingi</b>"]
        for index, group in enumerate(groups[:5], start=1):
            lines.append(
                f"{index}. {esc(truncate(group['group'], 24))} — "
                f"<b>{fmt_points(group['points'])}</b> o'rtacha "
                f"({group['members']} o'quvchi)"
            )

    if user:
        my_rank = next(
            (row["rank"] for row in rows if int(row["user"]["id"]) == int(user["id"])), None
        )
        if my_rank:
            lines += ["", f"🎯 Sizning o'rningiz: <b>{my_rank}/{len(rows)}</b>"]
        else:
            lines += ["", "🎯 Siz hali reytingda yo'qsiz — birinchi vazifani bajaring!"]
    return "\n".join(lines)
