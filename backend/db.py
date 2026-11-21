"""SQLite persistence for personal quest progress, history, stash assets, and timers."""

from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class AssistantDB:
    """Thread-safe local SQLite storage with persistent connection and batch transactions."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._batch_depth = 0
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    @contextmanager
    def batch(self) -> Iterator[None]:
        """Execute multiple DB writes inside a single SQLite transaction."""
        with self._lock:
            if self._batch_depth == 0:
                with self._conn:
                    self._batch_depth += 1
                    try:
                        yield
                    finally:
                        self._batch_depth -= 1
            else:
                self._batch_depth += 1
                try:
                    yield
                finally:
                    self._batch_depth -= 1

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        if self._batch_depth > 0:
            yield self._conn
        else:
            with self._conn:
                yield self._conn

    def _init_schema(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=NORMAL;

                CREATE TABLE IF NOT EXISTS quest_progress (
                    game_mode TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('locked', 'active', 'completed', 'failed')),
                    source TEXT NOT NULL DEFAULT 'manual',
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (game_mode, task_id)
                );

                CREATE TABLE IF NOT EXISTS quest_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_mode TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    task_name TEXT NOT NULL,
                    trader_name TEXT NOT NULL DEFAULT '',
                    event_type TEXT NOT NULL,
                    xp INTEGER NOT NULL DEFAULT 0,
                    source TEXT NOT NULL DEFAULT 'manual',
                    occurred_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS raid_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_mode TEXT NOT NULL,
                    map_id TEXT NOT NULL DEFAULT '',
                    map_name TEXT NOT NULL DEFAULT '',
                    raid_type TEXT NOT NULL DEFAULT 'PMC',
                    started_at TEXT NOT NULL,
                    ended_at TEXT,
                    duration_sec INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS stash_assets (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_mode TEXT NOT NULL,
                    category TEXT NOT NULL DEFAULT 'item',
                    item_id TEXT DEFAULT '',
                    name TEXT NOT NULL,
                    quantity REAL NOT NULL DEFAULT 1,
                    manual_unit_price REAL,
                    notes TEXT NOT NULL DEFAULT '',
                    relevance_override TEXT NOT NULL DEFAULT 'auto',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS hideout_levels (
                    game_mode TEXT NOT NULL,
                    station_id TEXT NOT NULL,
                    level INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (game_mode, station_id)
                );

                CREATE TABLE IF NOT EXISTS log_mail_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_mode TEXT NOT NULL,
                    msg_id TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 1,
                    msg_type INTEGER NOT NULL DEFAULT 0,
                    occurred_at TEXT NOT NULL,
                    imported_to_stash INTEGER NOT NULL DEFAULT 0,
                    UNIQUE (game_mode, msg_id, item_id)
                );

                CREATE TABLE IF NOT EXISTS stash_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_mode TEXT NOT NULL,
                    total_rub REAL NOT NULL,
                    liquid_rub REAL NOT NULL,
                    items_rub REAL NOT NULL,
                    recorded_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS cultist_timers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_mode TEXT NOT NULL,
                    duration_hours INTEGER NOT NULL,
                    started_at TEXT NOT NULL,
                    ends_at TEXT NOT NULL,
                    note TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS tracked_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    game_mode TEXT NOT NULL,
                    item_id TEXT NOT NULL DEFAULT '',
                    name TEXT NOT NULL,
                    short_name TEXT NOT NULL DEFAULT '',
                    icon_link TEXT NOT NULL DEFAULT '',
                    current_qty INTEGER NOT NULL DEFAULT 0,
                    target_qty INTEGER NOT NULL DEFAULT 1,
                    fir_only INTEGER NOT NULL DEFAULT 0,
                    category_tag TEXT NOT NULL DEFAULT 'general',
                    notes TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS watcher_state (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                """
            )
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(stash_assets)").fetchall()}
            if "relevance_override" not in cols:
                conn.execute("ALTER TABLE stash_assets ADD COLUMN relevance_override TEXT NOT NULL DEFAULT 'auto'")

    # --- Quest Progress & History ---

    def get_quest_statuses(self, game_mode: str) -> dict[str, dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT task_id, status, source, updated_at FROM quest_progress WHERE game_mode = ?",
                (game_mode,),
            ).fetchall()
        return {
            r["task_id"]: {
                "status": r["status"],
                "source": r["source"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        }

    def set_quest_status(
        self,
        game_mode: str,
        task_id: str,
        status: str,
        task_name: str = "",
        trader_name: str = "",
        xp: int = 0,
        source: str = "manual",
        occurred_at: str | None = None,
        record_history: bool = True,
    ) -> bool:
        now = occurred_at or utc_now_iso()
        with self._lock, self._connect() as conn:
            existing = conn.execute(
                "SELECT status, source, updated_at FROM quest_progress WHERE game_mode = ? AND task_id = ?",
                (game_mode, task_id),
            ).fetchone()
            prev_status = existing["status"] if existing else None
            prev_source = existing["source"] if existing else None
            prev_updated = existing["updated_at"] if existing else ""

            # State transition guards for automated sources (log/inferred)
            if source != "manual" and existing:
                # 1. Manual user edits are sacred; automated logs never overwrite them
                if prev_source == "manual":
                    return False
                # 2. In EFT story quests, once completed, a quest NEVER reverts to active, failed, or locked
                if prev_status == "completed" and status in ("active", "failed", "locked", "available"):
                    return False
                # 3. An older log event must never overwrite a newer state (unless completing an active quest)
                if prev_updated and now < prev_updated and status != "completed":
                    return False

            conn.execute(
                """
                INSERT INTO quest_progress (game_mode, task_id, status, source, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(game_mode, task_id) DO UPDATE SET
                    status = excluded.status,
                    source = excluded.source,
                    updated_at = excluded.updated_at
                """,
                (game_mode, task_id, status, source, now),
            )

            if record_history and prev_status != status and status in ("active", "completed", "failed"):
                # Do not record spurious 'active' event if task is already completed
                if status == "active" and prev_status == "completed":
                    return True
                # Avoid duplicate history entry if same timestamp & task & event exist (log replay)
                dup = conn.execute(
                    """
                    SELECT 1 FROM quest_history
                    WHERE game_mode = ? AND task_id = ? AND event_type = ? AND occurred_at = ?
                    """,
                    (game_mode, task_id, status, now),
                ).fetchone()
                if not dup:
                    conn.execute(
                        """
                        INSERT INTO quest_history (game_mode, task_id, task_name, trader_name, event_type, xp, source, occurred_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (game_mode, task_id, task_name or task_id, trader_name, status, xp, source, now),
                    )
            return True

    def reconcile_quest_progress(
        self,
        game_mode: str,
        tasks_dict: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, int]:
        """Reconcile quest_progress against quest_history and transitive prerequisite deduction.

        1. Fix tasks falsely marked 'active' or 'locked' when history proves they were completed.
        2. Infer completion of all prerequisite story quests upstream of any active/completed quest.
        """
        now = utc_now_iso()
        restored_from_history = 0
        inferred_prereqs = 0

        with self._lock, self._connect() as conn:
            # 1. Any task with a 'completed' event in history must be 'completed' in quest_progress
            hist_completed_rows = conn.execute(
                """
                SELECT task_id, MAX(occurred_at) as last_completed_at
                FROM quest_history
                WHERE game_mode = ? AND event_type = 'completed'
                GROUP BY task_id
                """,
                (game_mode,),
            ).fetchall()

            for hr in hist_completed_rows:
                tid = hr["task_id"]
                last_at = hr["last_completed_at"] or now
                curr = conn.execute(
                    "SELECT status, source FROM quest_progress WHERE game_mode = ? AND task_id = ?",
                    (game_mode, tid),
                ).fetchone()

                if not curr:
                    conn.execute(
                        """
                        INSERT INTO quest_progress (game_mode, task_id, status, source, updated_at)
                        VALUES (?, ?, 'completed', 'history', ?)
                        """,
                        (game_mode, tid, last_at),
                    )
                    restored_from_history += 1
                elif curr["status"] != "completed" and curr["source"] != "manual":
                    conn.execute(
                        """
                        UPDATE quest_progress
                        SET status = 'completed', source = 'history', updated_at = ?
                        WHERE game_mode = ? AND task_id = ?
                        """,
                        (last_at, game_mode, tid),
                    )
                    restored_from_history += 1

            # 2. Transitive prerequisite deduction
            if tasks_dict:
                completed_or_active = set()
                curr_progress = conn.execute(
                    "SELECT task_id, status FROM quest_progress WHERE game_mode = ?",
                    (game_mode,),
                ).fetchall()
                for r in curr_progress:
                    if r["status"] in ("active", "completed"):
                        completed_or_active.add(r["task_id"])

                to_infer = set()

                def _mark_upstream(tid: str, visiting: set[str]) -> None:
                    if tid in visiting or tid not in tasks_dict:
                        return
                    visiting.add(tid)
                    tk = tasks_dict[tid]
                    # Check taskRequirements if present, else fallback to prereqs
                    reqs = tk.get("taskRequirements")
                    if reqs:
                        for req in reqs:
                            pid = req.get("task")
                            req_statuses = req.get("status") or ["complete"]
                            if pid and pid in tasks_dict and any(s.lower() in ("complete", "completed") for s in req_statuses):
                                to_infer.add(pid)
                                _mark_upstream(pid, visiting)
                    else:
                        for pid in tk.get("prereqs") or []:
                            if pid in tasks_dict:
                                to_infer.add(pid)
                                _mark_upstream(pid, visiting)
                    visiting.remove(tid)

                for tid in list(completed_or_active):
                    _mark_upstream(tid, set())

                for pid in to_infer:
                    curr = conn.execute(
                        "SELECT status, source FROM quest_progress WHERE game_mode = ? AND task_id = ?",
                        (game_mode, pid),
                    ).fetchone()
                    if not curr:
                        conn.execute(
                            """
                            INSERT INTO quest_progress (game_mode, task_id, status, source, updated_at)
                            VALUES (?, ?, 'completed', 'inferred', ?)
                            """,
                            (game_mode, pid, now),
                        )
                        inferred_prereqs += 1
                    elif curr["status"] != "completed" and curr["source"] != "manual":
                        conn.execute(
                            """
                            UPDATE quest_progress
                            SET status = 'completed', source = 'inferred', updated_at = ?
                            WHERE game_mode = ? AND task_id = ?
                            """,
                            (now, game_mode, pid),
                        )
                        inferred_prereqs += 1

        return {
            "restoredFromHistory": restored_from_history,
            "inferredPrereqs": inferred_prereqs,
        }

    def clear_quest_status(self, game_mode: str, task_id: str) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "DELETE FROM quest_progress WHERE game_mode = ? AND task_id = ?",
                (game_mode, task_id),
            )

    def get_quest_history(self, game_mode: str, limit: int = 200) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, task_id, task_name, trader_name, event_type, xp, source, occurred_at
                FROM quest_history
                WHERE game_mode = ?
                ORDER BY occurred_at DESC, id DESC
                LIMIT ?
                """,
                (game_mode, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    # --- Raids ---

    def record_raid(
        self,
        game_mode: str,
        map_id: str,
        map_name: str,
        raid_type: str,
        started_at: str,
        ended_at: str | None = None,
        duration_sec: int = 0,
    ) -> int:
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO raid_history (game_mode, map_id, map_name, raid_type, started_at, ended_at, duration_sec)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (game_mode, map_id, map_name, raid_type, started_at, ended_at, duration_sec),
            )
            return int(cur.lastrowid)

    def finish_raid(self, raid_id: int, ended_at: str, duration_sec: int) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                "UPDATE raid_history SET ended_at = ?, duration_sec = ? WHERE id = ?",
                (ended_at, duration_sec, raid_id),
            )

    def get_recent_raids(self, game_mode: str, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, map_id, map_name, raid_type, started_at, ended_at, duration_sec
                FROM raid_history
                WHERE game_mode = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (game_mode, limit),
            ).fetchall()
        return [dict(r) for r in rows]

    # --- Cultist Timers ---

    def add_cultist_timer(self, game_mode: str, duration_hours: int, note: str = "") -> int:
        now = datetime.now(timezone.utc)
        ends = datetime.fromtimestamp(now.timestamp() + duration_hours * 3600, tz=timezone.utc)
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO cultist_timers (game_mode, duration_hours, started_at, ends_at, note)
                VALUES (?, ?, ?, ?, ?)
                """,
                (game_mode, duration_hours, now.isoformat(timespec="seconds"), ends.isoformat(timespec="seconds"), note),
            )
            return int(cur.lastrowid)

    def list_cultist_timers(self, game_mode: str) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, duration_hours, started_at, ends_at, note
                FROM cultist_timers
                WHERE game_mode = ?
                ORDER BY id DESC
                LIMIT 10
                """,
                (game_mode,),
            ).fetchall()
        return [dict(r) for r in rows]

    def delete_cultist_timer(self, timer_id: int) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM cultist_timers WHERE id = ?", (timer_id,))

    # --- Custom Tracked Item Counter ---

    def list_tracked_items(self, game_mode: str) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, item_id, name, short_name, icon_link,
                       current_qty, target_qty, fir_only, category_tag, notes, updated_at
                FROM tracked_items
                WHERE game_mode = ?
                ORDER BY (current_qty >= target_qty) ASC, id DESC
                """,
                (game_mode,),
            ).fetchall()
        return [dict(r) for r in rows]

    def upsert_tracked_item(
        self,
        game_mode: str,
        name: str,
        target_qty: int = 1,
        current_qty: int = 0,
        item_id: str = "",
        short_name: str = "",
        icon_link: str = "",
        fir_only: bool = False,
        category_tag: str = "general",
        notes: str = "",
        row_id: int | None = None,
    ) -> int:
        clean_name = str(name or "").strip()
        if not clean_name:
            raise ValueError("Item name must not be empty")
        t_qty = max(1, int(target_qty or 1))
        c_qty = max(0, int(current_qty or 0))
        fir_int = 1 if fir_only else 0
        now = utc_now_iso()
        with self._lock, self._connect() as conn:
            if row_id is not None:
                conn.execute(
                    """
                    UPDATE tracked_items
                    SET item_id = ?, name = ?, short_name = ?, icon_link = ?,
                        current_qty = ?, target_qty = ?, fir_only = ?,
                        category_tag = ?, notes = ?, updated_at = ?
                    WHERE id = ? AND game_mode = ?
                    """,
                    (
                        item_id,
                        clean_name,
                        short_name,
                        icon_link,
                        c_qty,
                        t_qty,
                        fir_int,
                        category_tag or "general",
                        notes,
                        now,
                        row_id,
                        game_mode,
                    ),
                )
                return int(row_id)
            cur = conn.execute(
                """
                INSERT INTO tracked_items (
                    game_mode, item_id, name, short_name, icon_link,
                    current_qty, target_qty, fir_only, category_tag, notes, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    game_mode,
                    item_id,
                    clean_name,
                    short_name,
                    icon_link,
                    c_qty,
                    t_qty,
                    fir_int,
                    category_tag or "general",
                    notes,
                    now,
                ),
            )
            return int(cur.lastrowid)

    def adjust_tracked_item(
        self,
        game_mode: str,
        row_id: int,
        delta: int | None = None,
        current_qty: int | None = None,
        target_qty: int | None = None,
    ) -> dict[str, Any] | None:
        now = utc_now_iso()
        with self._lock, self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, item_id, name, short_name, icon_link,
                       current_qty, target_qty, fir_only, category_tag, notes, updated_at
                FROM tracked_items
                WHERE id = ? AND game_mode = ?
                """,
                (row_id, game_mode),
            ).fetchone()
            if not row:
                return None
            next_current = int(row["current_qty"])
            next_target = int(row["target_qty"])
            if delta is not None:
                next_current = max(0, next_current + int(delta))
            elif current_qty is not None:
                next_current = max(0, int(current_qty))
            if target_qty is not None:
                next_target = max(1, int(target_qty))
            conn.execute(
                """
                UPDATE tracked_items
                SET current_qty = ?, target_qty = ?, updated_at = ?
                WHERE id = ? AND game_mode = ?
                """,
                (next_current, next_target, now, row_id, game_mode),
            )
            updated = conn.execute(
                """
                SELECT id, item_id, name, short_name, icon_link,
                       current_qty, target_qty, fir_only, category_tag, notes, updated_at
                FROM tracked_items
                WHERE id = ? AND game_mode = ?
                """,
                (row_id, game_mode),
            ).fetchone()
        return dict(updated) if updated else None

    def delete_tracked_item(self, game_mode: str, row_id: int) -> None:
        with self._lock, self._connect() as conn:
            conn.execute("DELETE FROM tracked_items WHERE id = ? AND game_mode = ?", (row_id, game_mode))

    def clear_completed_tracked_items(self, game_mode: str) -> int:
        with self._lock, self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM tracked_items WHERE game_mode = ? AND current_qty >= target_qty",
                (game_mode,),
            )
            return int(cur.rowcount or 0)

    # --- Watcher / Generic KV State ---

    def get_state(self, key: str, default: Any = None) -> Any:
        with self._lock, self._connect() as conn:
            row = conn.execute("SELECT value FROM watcher_state WHERE key = ?", (key,)).fetchone()
        if not row:
            return default
        try:
            return json.loads(row["value"])
        except Exception:
            return row["value"]

    def set_state(self, key: str, value: Any) -> None:
        encoded = json.dumps(value, ensure_ascii=False)
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO watcher_state (key, value) VALUES (?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """,
                (key, encoded),
            )

