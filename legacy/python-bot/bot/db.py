"""SQLite ma'lumotlar bazasi qatlami (aiosqlite)."""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from typing import Any, Iterable

import aiosqlite

from bot.utils import now_iso, now_utc

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_id       INTEGER NOT NULL UNIQUE,
    full_name   TEXT NOT NULL DEFAULT '',
    username    TEXT,
    phone       TEXT,
    group_name  TEXT,
    role        TEXT NOT NULL DEFAULT 'student',     -- student | teacher | admin
    status      TEXT NOT NULL DEFAULT 'awaiting',    -- awaiting | active | rejected | blocked
    created_at  TEXT NOT NULL,
    verified_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, status);

CREATE TABLE IF NOT EXISTS modules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    description TEXT,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    module_id     INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    kind          TEXT NOT NULL DEFAULT 'text',      -- quiz | text | manual
    answer_key    TEXT,
    options       TEXT,                              -- JSON: [{"k":"A","t":"...","c":true}]
    pass_score    REAL NOT NULL DEFAULT 6,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    unlock_after  INTEGER,
    is_bonus      INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1,
    deadline_days INTEGER NOT NULL DEFAULT 0,
    created_by    INTEGER,
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_module ON tasks(module_id, sort_order);

CREATE TABLE IF NOT EXISTS submissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    answer_text TEXT,
    file_id     TEXT,
    file_type   TEXT,
    auto_score  REAL,
    auto_ratio  REAL,
    score       REAL,
    status      TEXT NOT NULL,   -- auto_passed | auto_failed | teacher_review | graded | not_done | rejected
    feedback    TEXT,
    checked_by  INTEGER,
    created_at  TEXT NOT NULL,
    checked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sub_user ON submissions(user_id, task_id);
CREATE INDEX IF NOT EXISTS idx_sub_status ON submissions(status, created_at);

CREATE TABLE IF NOT EXISTS task_access (
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    opened_at        TEXT NOT NULL,
    deadline_at      TEXT,
    reminded         INTEGER NOT NULL DEFAULT 0,
    missing_reported INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, task_id)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
"""

USER_FIELDS = {"full_name", "username", "phone", "group_name", "role", "status", "verified_at"}
TASK_FIELDS = {
    "module_id", "title", "description", "kind", "answer_key", "options", "pass_score",
    "sort_order", "unlock_after", "is_bonus", "is_active", "deadline_days",
}
SUBMISSION_FIELDS = {"score", "status", "feedback", "checked_by", "checked_at", "auto_score", "auto_ratio"}


class Database:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self._conn: aiosqlite.Connection | None = None

    # ------------------------------------------------------------------ connection
    async def connect(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self.path))
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA busy_timeout = 5000")
        await self._conn.executescript(SCHEMA)
        await self._conn.commit()

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database.connect() chaqirilmagan")
        return self._conn

    async def fetchone(self, sql: str, params: Iterable[Any] = ()) -> dict | None:
        cur = await self.conn.execute(sql, tuple(params))
        try:
            row = await cur.fetchone()
        finally:
            await cur.close()
        return dict(row) if row else None

    async def fetchall(self, sql: str, params: Iterable[Any] = ()) -> list[dict]:
        cur = await self.conn.execute(sql, tuple(params))
        try:
            rows = await cur.fetchall()
        finally:
            await cur.close()
        return [dict(row) for row in rows]

    async def execute(self, sql: str, params: Iterable[Any] = ()) -> int:
        cur = await self.conn.execute(sql, tuple(params))
        await self.conn.commit()
        last_id = cur.lastrowid or 0
        await cur.close()
        return int(last_id)

    # ------------------------------------------------------------------ users
    async def get_user(self, tg_id: int) -> dict | None:
        return await self.fetchone("SELECT * FROM users WHERE tg_id = ?", (tg_id,))

    async def get_user_by_id(self, user_id: int) -> dict | None:
        return await self.fetchone("SELECT * FROM users WHERE id = ?", (user_id,))

    async def create_user(self, tg_id: int, username: str | None, full_name: str = "") -> dict:
        await self.execute(
            "INSERT OR IGNORE INTO users (tg_id, username, full_name, created_at) VALUES (?, ?, ?, ?)",
            (tg_id, username, full_name, now_iso()),
        )
        user = await self.get_user(tg_id)
        assert user is not None
        return user

    async def update_user(self, user_id: int, **fields: Any) -> None:
        data = {k: v for k, v in fields.items() if k in USER_FIELDS}
        if not data:
            return
        sets = ", ".join(f"{key} = ?" for key in data)
        await self.execute(f"UPDATE users SET {sets} WHERE id = ?", (*data.values(), user_id))

    async def teachers(self) -> list[dict]:
        return await self.fetchall(
            "SELECT * FROM users WHERE role IN ('teacher', 'admin') AND status = 'active'"
        )

    async def active_students(self) -> list[dict]:
        return await self.fetchall(
            "SELECT * FROM users WHERE role = 'student' AND status = 'active' ORDER BY full_name"
        )

    async def awaiting_users(self) -> list[dict]:
        return await self.fetchall(
            "SELECT * FROM users WHERE status = 'awaiting' ORDER BY created_at"
        )

    async def all_students(self) -> list[dict]:
        return await self.fetchall(
            "SELECT * FROM users WHERE role = 'student' AND status != 'blocked' ORDER BY created_at DESC"
        )

    async def counts(self) -> dict[str, int]:
        row = await self.fetchone(
            """
            SELECT
              (SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'active') AS students,
              (SELECT COUNT(*) FROM users WHERE role = 'student' AND status = 'awaiting') AS awaiting,
              (SELECT COUNT(*) FROM users WHERE role IN ('teacher', 'admin') AND status = 'active') AS teachers,
              (SELECT COUNT(*) FROM tasks WHERE is_active = 1) AS tasks,
              (SELECT COUNT(*) FROM submissions WHERE status IN ('teacher_review', 'not_done')) AS pending
            """
        )
        return {k: int(v or 0) for k, v in (row or {}).items()}

    # ------------------------------------------------------------------ modules
    async def list_modules(self, active_only: bool = True) -> list[dict]:
        sql = "SELECT * FROM modules"
        if active_only:
            sql += " WHERE is_active = 1"
        sql += " ORDER BY id"
        return await self.fetchall(sql)

    async def get_module(self, module_id: int) -> dict | None:
        return await self.fetchone("SELECT * FROM modules WHERE id = ?", (module_id,))

    async def create_module(self, title: str, description: str = "") -> int:
        return await self.execute(
            "INSERT INTO modules (title, description, created_at) VALUES (?, ?, ?)",
            (title, description, now_iso()),
        )

    # ------------------------------------------------------------------ tasks
    async def list_tasks(self, module_id: int | None = None, active_only: bool = True) -> list[dict]:
        sql = "SELECT * FROM tasks WHERE 1 = 1"
        params: list[Any] = []
        if module_id is not None:
            sql += " AND module_id = ?"
            params.append(module_id)
        if active_only:
            sql += " AND is_active = 1"
        sql += " ORDER BY module_id, sort_order, id"
        return await self.fetchall(sql, params)

    async def get_task(self, task_id: int) -> dict | None:
        return await self.fetchone("SELECT * FROM tasks WHERE id = ?", (task_id,))

    async def create_task(self, **fields: Any) -> int:
        data = {
            "module_id": fields.pop("module_id"),
            "title": fields.pop("title"),
            "description": fields.pop("description", ""),
            "kind": fields.pop("kind", "text"),
            "answer_key": fields.pop("answer_key", None),
            "options": fields.pop("options", None),
            "pass_score": fields.pop("pass_score", 6),
            "sort_order": fields.pop("sort_order", 0),
            "unlock_after": fields.pop("unlock_after", None),
            "is_bonus": fields.pop("is_bonus", 0),
            "deadline_days": fields.pop("deadline_days", 0),
            "created_by": fields.pop("created_by", None),
            "created_at": now_iso(),
        }
        columns = ", ".join(data)
        placeholders = ", ".join("?" for _ in data)
        return await self.execute(
            f"INSERT INTO tasks ({columns}) VALUES ({placeholders})", tuple(data.values())
        )

    async def update_task(self, task_id: int, **fields: Any) -> None:
        data = {k: v for k, v in fields.items() if k in TASK_FIELDS}
        if not data:
            return
        sets = ", ".join(f"{key} = ?" for key in data)
        await self.execute(f"UPDATE tasks SET {sets} WHERE id = ?", (*data.values(), task_id))

    async def delete_task(self, task_id: int) -> None:
        await self.execute("DELETE FROM tasks WHERE id = ?", (task_id,))

    async def next_sort_order(self, module_id: int) -> int:
        row = await self.fetchone(
            "SELECT COALESCE(MAX(sort_order), 0) AS mx FROM tasks WHERE module_id = ?", (module_id,)
        )
        return int(row["mx"]) + 1 if row else 1

    async def last_task(self, module_id: int) -> dict | None:
        return await self.fetchone(
            "SELECT * FROM tasks WHERE module_id = ? AND is_bonus = 0 ORDER BY sort_order DESC, id DESC LIMIT 1",
            (module_id,),
        )

    # ------------------------------------------------------------------ submissions
    async def add_submission(
        self,
        task_id: int,
        user_id: int,
        status: str,
        *,
        answer_text: str | None = None,
        file_id: str | None = None,
        file_type: str | None = None,
        auto_score: float | None = None,
        auto_ratio: float | None = None,
        score: float | None = None,
        feedback: str | None = None,
    ) -> int:
        return await self.execute(
            """
            INSERT INTO submissions
                (task_id, user_id, answer_text, file_id, file_type, auto_score, auto_ratio,
                 score, status, feedback, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                task_id, user_id, answer_text, file_id, file_type, auto_score, auto_ratio,
                score, status, feedback, now_iso(),
            ),
        )

    async def get_submission(self, submission_id: int) -> dict | None:
        return await self.fetchone("SELECT * FROM submissions WHERE id = ?", (submission_id,))

    async def get_submission_full(self, submission_id: int) -> dict | None:
        return await self.fetchone(
            """
            SELECT s.*, t.title AS task_title, t.kind AS task_kind, t.pass_score,
                   t.module_id, u.tg_id, u.full_name, u.group_name, u.username, u.id AS user_pk
            FROM submissions s
            JOIN tasks t ON t.id = s.task_id
            JOIN users u ON u.id = s.user_id
            WHERE s.id = ?
            """,
            (submission_id,),
        )

    async def update_submission(self, submission_id: int, **fields: Any) -> None:
        data = {k: v for k, v in fields.items() if k in SUBMISSION_FIELDS}
        if not data:
            return
        sets = ", ".join(f"{key} = ?" for key in data)
        await self.execute(f"UPDATE submissions SET {sets} WHERE id = ?", (*data.values(), submission_id))

    async def best_scores(self, user_id: int) -> dict[int, float]:
        rows = await self.fetchall(
            """
            SELECT task_id, MAX(score) AS best
            FROM submissions
            WHERE user_id = ? AND status IN ('auto_passed', 'graded') AND score IS NOT NULL
            GROUP BY task_id
            """,
            (user_id,),
        )
        return {int(r["task_id"]): float(r["best"]) for r in rows}

    async def best_scores_all(self, since: str | None = None) -> dict[int, dict[int, float]]:
        sql = """
            SELECT user_id, task_id, MAX(score) AS best
            FROM submissions
            WHERE status IN ('auto_passed', 'graded') AND score IS NOT NULL
        """
        params: list[Any] = []
        if since:
            sql += " AND created_at >= ?"
            params.append(since)
        sql += " GROUP BY user_id, task_id"
        rows = await self.fetchall(sql, params)
        result: dict[int, dict[int, float]] = {}
        for row in rows:
            result.setdefault(int(row["user_id"]), {})[int(row["task_id"])] = float(row["best"])
        return result

    async def attempt_counts(self, user_id: int) -> dict[int, int]:
        rows = await self.fetchall(
            """
            SELECT task_id, COUNT(*) AS cnt
            FROM submissions
            WHERE user_id = ? AND status IN ('auto_passed', 'auto_failed', 'teacher_review', 'graded', 'not_done')
            GROUP BY task_id
            """,
            (user_id,),
        )
        return {int(r["task_id"]): int(r["cnt"]) for r in rows}

    async def failed_quiz_attempts(self, user_id: int, task_id: int) -> int:
        row = await self.fetchone(
            "SELECT COUNT(*) AS cnt FROM submissions WHERE user_id = ? AND task_id = ? AND status = 'auto_failed'",
            (user_id, task_id),
        )
        return int(row["cnt"]) if row else 0

    async def pending_task_ids(self, user_id: int) -> set[int]:
        rows = await self.fetchall(
            """
            SELECT DISTINCT task_id FROM submissions
            WHERE user_id = ? AND status IN ('teacher_review', 'not_done')
            """,
            (user_id,),
        )
        return {int(r["task_id"]) for r in rows}

    async def pending_submissions(self, limit: int = 20) -> list[dict]:
        return await self.fetchall(
            """
            SELECT s.id, s.status, s.created_at, s.score, s.answer_text,
                   t.title AS task_title, u.full_name, u.group_name, u.tg_id
            FROM submissions s
            JOIN tasks t ON t.id = s.task_id
            JOIN users u ON u.id = s.user_id
            WHERE s.status IN ('teacher_review', 'not_done')
            ORDER BY s.created_at
            LIMIT ?
            """,
            (limit,),
        )

    async def pending_count(self) -> int:
        row = await self.fetchone(
            "SELECT COUNT(*) AS cnt FROM submissions WHERE status IN ('teacher_review', 'not_done')"
        )
        return int(row["cnt"]) if row else 0

    async def user_submissions(self, user_id: int, limit: int = 10) -> list[dict]:
        return await self.fetchall(
            """
            SELECT s.*, t.title AS task_title
            FROM submissions s
            JOIN tasks t ON t.id = s.task_id
            WHERE s.user_id = ?
            ORDER BY s.created_at DESC, s.id DESC
            LIMIT ?
            """,
            (user_id, limit),
        )

    async def submissions_for_task(self, user_id: int, task_id: int) -> list[dict]:
        return await self.fetchall(
            "SELECT * FROM submissions WHERE user_id = ? AND task_id = ? ORDER BY created_at",
            (user_id, task_id),
        )

    # ------------------------------------------------------------------ access / deadlines
    async def get_access(self, user_id: int, task_id: int) -> dict | None:
        return await self.fetchone(
            "SELECT * FROM task_access WHERE user_id = ? AND task_id = ?", (user_id, task_id)
        )

    async def access_map(self, user_id: int) -> dict[int, dict]:
        rows = await self.fetchall("SELECT * FROM task_access WHERE user_id = ?", (user_id,))
        return {int(r["task_id"]): r for r in rows}

    async def ensure_access(self, user_id: int, task_id: int, deadline_days: int) -> dict | None:
        """Vazifa birinchi marta ochilganda muddatni belgilaydi. Yangi bo'lsa — qaytaradi."""
        existing = await self.get_access(user_id, task_id)
        if existing:
            return None
        deadline_at = None
        if deadline_days > 0:
            deadline_at = (now_utc() + timedelta(days=int(deadline_days))).isoformat(timespec="seconds")
        await self.execute(
            """
            INSERT OR IGNORE INTO task_access (user_id, task_id, opened_at, deadline_at)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, task_id, now_iso(), deadline_at),
        )
        return await self.get_access(user_id, task_id)

    async def access_rows(self) -> list[dict]:
        return await self.fetchall(
            """
            SELECT ta.*, t.title AS task_title, t.pass_score, t.deadline_days,
                   u.tg_id, u.full_name, u.id AS user_pk
            FROM task_access ta
            JOIN tasks t ON t.id = ta.task_id
            JOIN users u ON u.id = ta.user_id
            WHERE ta.deadline_at IS NOT NULL
              AND u.role = 'student' AND u.status = 'active'
              AND t.is_active = 1
            """
        )

    async def mark_access(self, user_id: int, task_id: int, **fields: Any) -> None:
        allowed = {k: v for k, v in fields.items() if k in {"reminded", "missing_reported"}}
        if not allowed:
            return
        sets = ", ".join(f"{key} = ?" for key in allowed)
        await self.execute(
            f"UPDATE task_access SET {sets} WHERE user_id = ? AND task_id = ?",
            (*allowed.values(), user_id, task_id),
        )

    async def pending_for_task(self, user_id: int, task_id: int) -> bool:
        row = await self.fetchone(
            """
            SELECT 1 AS x FROM submissions
            WHERE user_id = ? AND task_id = ? AND status IN ('teacher_review', 'not_done')
            LIMIT 1
            """,
            (user_id, task_id),
        )
        return row is not None

    # ------------------------------------------------------------------ settings
    async def get_setting(self, key: str, default: str | None = None) -> str | None:
        row = await self.fetchone("SELECT value FROM settings WHERE key = ?", (key,))
        return row["value"] if row and row["value"] is not None else default

    async def set_setting(self, key: str, value: str) -> None:
        await self.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
