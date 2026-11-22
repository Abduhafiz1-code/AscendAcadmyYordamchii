"""Vazifalar holati: ochilish ketma-ketligi, modul progressi, bonus vazifalar."""
from __future__ import annotations

import json
from dataclasses import dataclass

from bot.db import Database


@dataclass
class TaskState:
    task: dict
    unlocked: bool
    passed: bool
    best: float | None
    attempts: int
    pending: bool
    access: dict | None


def parse_options(task: dict) -> list[dict]:
    raw = task.get("options")
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    return [
        option
        for option in data
        if isinstance(option, dict) and option.get("k") and option.get("t")
    ]


def parse_answer_key(task: dict) -> str:
    return task.get("answer_key") or ""


def _passed(task_id: int | None, best: dict[int, float], tasks_by_id: dict[int, dict]) -> bool:
    if task_id is None:
        return False
    score = best.get(task_id)
    task = tasks_by_id.get(task_id)
    return score is not None and task is not None and score >= float(task["pass_score"])


async def build_states(db: Database, user: dict, ensure_access: bool = True) -> list[TaskState]:
    """Foydalanuvchi uchun barcha vazifalar holatini hisoblab qaytaradi."""
    user_id = int(user["id"])
    tasks = await db.list_tasks(active_only=True)
    if not tasks:
        return []

    best = await db.best_scores(user_id)
    attempts = await db.attempt_counts(user_id)
    pending_ids = await db.pending_task_ids(user_id)
    access = await db.access_map(user_id)
    tasks_by_id = {int(task["id"]): task for task in tasks}

    grouped: dict[int, list[dict]] = {}
    for task in tasks:
        grouped.setdefault(int(task["module_id"]), []).append(task)

    states: list[TaskState] = []
    for module_tasks in grouped.values():
        module_tasks.sort(key=lambda t: (int(t["sort_order"]), int(t["id"])))
        previous: dict | None = None
        for task in module_tasks:
            task_id = int(task["id"])
            is_bonus = bool(task["is_bonus"])
            unlock_after = task.get("unlock_after")

            if is_bonus:
                unlocked = unlock_after is None or _passed(int(unlock_after), best, tasks_by_id)
            else:
                unlocked = previous is None or _passed(int(previous["id"]), best, tasks_by_id)
                if unlocked and unlock_after is not None:
                    unlocked = _passed(int(unlock_after), best, tasks_by_id)
                previous = task

            state = TaskState(
                task=task,
                unlocked=unlocked,
                passed=_passed(task_id, best, tasks_by_id),
                best=best.get(task_id),
                attempts=attempts.get(task_id, 0),
                pending=task_id in pending_ids,
                access=access.get(task_id),
            )
            if unlocked and ensure_access and state.access is None:
                created = await db.ensure_access(user_id, task_id, int(task["deadline_days"] or 0))
                if created:
                    state.access = created
            states.append(state)
    return states


def module_progress(states: list[TaskState]) -> dict[int, tuple[int, int]]:
    progress: dict[int, list[int]] = {}
    for state in states:
        module_id = int(state.task["module_id"])
        entry = progress.setdefault(module_id, [0, 0])
        entry[1] += 1
        if state.passed:
            entry[0] += 1
    return {module_id: (done, total) for module_id, (done, total) in progress.items()}


def states_for_module(states: list[TaskState], module_id: int) -> list[TaskState]:
    return [state for state in states if int(state.task["module_id"]) == module_id]


async def unlock_new_tasks(db: Database, user: dict) -> list[str]:
    """Baholangandan keyin yangi ochilgan vazifalar nomini qaytaradi."""
    before = await db.access_map(int(user["id"]))
    states = await build_states(db, user, ensure_access=True)
    titles: list[str] = []
    for state in states:
        task_id = int(state.task["id"])
        if state.unlocked and task_id not in before and not state.passed:
            titles.append(state.task["title"])
    return titles


async def find_state(db: Database, user: dict, task_id: int) -> TaskState | None:
    for state in await build_states(db, user):
        if int(state.task["id"]) == task_id:
            return state
    return None
