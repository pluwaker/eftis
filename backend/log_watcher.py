"""Strictly Read-Only EFT log & screenshot watcher (inspired by TarkovMonitor)."""

from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .db import AssistantDB
from .tarkov_data import TarkovDataStore

LOG_HEADER_RE = re.compile(
    r"^(?P<date>\d{4}-\d{2}-\d{2})\s+(?P<time>\d{2}:\d{2}:\d{2}\.\d{3})(?:\s+[+-]\d{2}:\d{2})?\|[^|]+\|[^|]+\|(?P<msg>.+)$"
)
SESSION_MODE_RE = re.compile(r"Session mode:\s*(?P<mode>[^\s|]+)")
SCENE_PATH_RE = re.compile(r"scene preset path:(?P<scene>maps/[a-zA-Z0-9_]+\.bundle)")
LOCATION_RE = re.compile(r"Location:\s*(?P<map>[^,]+)")
SCREENSHOT_RE = re.compile(
    r"\d{4}-\d{2}-\d{2}\[\d{2}-\d{2}\]_?(?P<x>-?\d+\.\d{2}),\s*(?P<y>-?\d+\.\d{2}),\s*(?P<z>-?\d+\.\d{2})_"
    r"(?P<rx>-?\d+\.\d+),\s*(?P<ry>-?\d+\.\d+),\s*(?P<rz>-?\d+\.\d+),\s*(?P<rw>-?\d+\.\d+)\s*\(\d+\)\.png$",
    re.IGNORECASE,
)

TASK_STATUS_MAP = {
    10: "active",     # TaskStarted
    11: "failed",     # TaskFailed
    12: "completed",  # TaskFinished
}


def resolve_logs_dir(raw_path: str) -> str:
    """Resolve Logs folder even if user passed game root or build directory."""
    if not raw_path:
        return ""
    p = Path(raw_path.strip().strip('"'))
    for cand in (p, p / "Logs", p / "build" / "Logs"):
        if cand.exists() and cand.is_dir():
            if any(d.is_dir() and d.name.startswith("log_") for d in cand.iterdir()):
                return str(cand)
    for cand in (p / "Logs", p / "build" / "Logs", p):
        if cand.exists() and cand.is_dir():
            return str(cand)
    return str(p)


def _steam_library_paths() -> list[Path]:
    libs: list[Path] = []
    steam_roots = [
        Path(r"C:\Program Files (x86)\Steam"),
        Path(r"C:\Program Files\Steam"),
    ]
    try:
        import winreg  # type: ignore

        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            for sub in (r"Software\Valve\Steam", r"SOFTWARE\WOW6432Node\Valve\Steam"):
                try:
                    with winreg.OpenKey(hive, sub) as k:
                        sp, _ = winreg.QueryValueEx(k, "SteamPath")
                        if sp:
                            steam_roots.insert(0, Path(sp))
                except OSError:
                    continue
    except Exception:
        pass

    seen: set[str] = set()
    for root in steam_roots:
        vdf = root / "steamapps" / "libraryfolders.vdf"
        if vdf.exists():
            try:
                txt = vdf.read_text(encoding="utf-8", errors="ignore")
                for m in re.finditer(r'"path"\s+"([^"]+)"', txt, re.IGNORECASE):
                    lp = Path(m.group(1).replace("\\\\", "\\"))
                    key = str(lp).lower()
                    if key not in seen:
                        seen.add(key)
                        libs.append(lp)
            except Exception:
                pass
        key = str(root).lower()
        if root.exists() and key not in seen:
            seen.add(key)
            libs.append(root)
    return libs


def detect_eft_paths() -> tuple[str, str]:
    """Best-effort Read-Only detection of EFT Logs and Screenshots folders on Windows."""
    logs_dir = ""
    candidates: list[Path] = [
        Path(r"C:\Battlestate Games\EFT"),
        Path(r"C:\Battlestate Games\Escape from Tarkov"),
        Path(r"D:\Battlestate Games\EFT"),
        Path(r"D:\Games\Escape from Tarkov"),
    ]
    for lib in _steam_library_paths():
        candidates.append(lib / "steamapps" / "common" / "Escape from Tarkov")

    try:
        import winreg  # type: ignore

        reg_paths = [
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\EscapeFromTarkov",
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\EscapeFromTarkov",
            r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 3932890",
            r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Steam App 3932890",
        ]
        for rp in reg_paths:
            for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                try:
                    with winreg.OpenKey(hive, rp) as key:
                        install_loc, _ = winreg.QueryValueEx(key, "InstallLocation")
                        if install_loc:
                            candidates.insert(0, Path(install_loc))
                except OSError:
                    continue
    except Exception:
        pass

    for c in candidates:
        resolved = resolve_logs_dir(str(c))
        rp = Path(resolved)
        if rp.exists() and rp.is_dir() and any(d.is_dir() and d.name.startswith("log_") for d in rp.iterdir()):
            logs_dir = str(rp)
            break

    home = Path(os.path.expanduser("~"))
    screenshots_dir = ""
    for sc in (
        home / "Documents" / "Escape From Tarkov" / "Screenshots",
        home / "OneDrive" / "Documents" / "Escape From Tarkov" / "Screenshots",
        home / "OneDrive" / "Документы" / "Escape From Tarkov" / "Screenshots",
    ):
        if sc.exists():
            screenshots_dir = str(sc)
            break
    return logs_dir, screenshots_dir


def quaternion_to_yaw_deg(x: float, z: float, y: float, w: float) -> float:
    siny_cosp = 2.0 * (w * z + x * y)
    cosy_cosp = 1.0 - 2.0 * (y * y + z * z)
    return math.degrees(math.atan2(siny_cosp, cosy_cosp))


def _map_session_mode(raw: str) -> str:
    return "pve" if raw.strip().lower() == "pve" else "regular"


class ReadOnlyEftWatcher:
    """Polls EFT Logs and Screenshots folders in strictly Read-Only mode."""

    def __init__(self, db: AssistantDB, data_store: TarkovDataStore, config: dict[str, Any]) -> None:
        self.db = db
        self.data_store = data_store
        self.config = config
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._offsets: dict[str, int] = {}
        self._seen_screenshots: set[str] = set()
        self._active_mode: str = config.get("default_game_mode", "regular")
        self._active_map_id: str = ""
        self._active_map_name: str = ""
        self._raid_started_at: str | None = None
        self._active_raid_id: int | None = None
        self._last_error: str = ""

    def get_paths(self) -> tuple[str, str]:
        auto_logs, auto_screens = detect_eft_paths()
        raw_logs = (self.config.get("eft_logs_dir") or "").strip()
        logs = resolve_logs_dir(raw_logs) if raw_logs else auto_logs
        screens = (self.config.get("eft_screenshots_dir") or "").strip() or auto_screens
        return logs, screens

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._prime_initial_state()
        self._thread = threading.Thread(target=self._loop, name="eft-ro-watcher", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def status(self) -> dict[str, Any]:
        logs_dir, screens_dir = self.get_paths()
        return {
            "watchLogs": bool(self.config.get("watch_logs", True)),
            "watchScreenshots": bool(self.config.get("watch_screenshots", True)),
            "logsDir": logs_dir,
            "logsDirExists": bool(logs_dir and Path(logs_dir).exists()),
            "screenshotsDir": screens_dir,
            "screenshotsDirExists": bool(screens_dir and Path(screens_dir).exists()),
            "detectedMode": self._active_mode,
            "activeMapId": self._active_map_id,
            "activeMapName": self._active_map_name,
            "raidStartedAt": self._raid_started_at,
            "lastPin": self.db.get_state("last_player_pin"),
            "lastError": self._last_error,
        }

    def _latest_log_folder(self, logs_dir: str) -> Path | None:
        p = Path(logs_dir)
        if not p.exists():
            return None
        folders = [d for d in p.iterdir() if d.is_dir() and d.name.startswith("log_")]
        if not folders:
            return None
        folders.sort(key=lambda d: d.name, reverse=True)
        return folders[0]

    def _prime_initial_state(self) -> None:
        logs_dir, screens_dir = self.get_paths()
        if screens_dir and Path(screens_dir).exists():
            for f in Path(screens_dir).glob("*.png"):
                self._seen_screenshots.add(f.name)
        if logs_dir and Path(logs_dir).exists():
            folder = self._latest_log_folder(logs_dir)
            if folder:
                for lf in folder.iterdir():
                    if lf.is_file() and ("application" in lf.name.lower() or "output" in lf.name.lower()):
                        try:
                            text = lf.read_text(encoding="utf-8", errors="ignore")
                            for m in SESSION_MODE_RE.finditer(text):
                                self._active_mode = _map_session_mode(m.group("mode"))
                        except Exception:
                            pass
                # Do not skip the current session's log: leaving _offsets empty
                # lets the first _poll_logs() pass parse whatever notifications have
                # already been written in the current game session.

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                if self.config.get("watch_logs", True):
                    self._poll_logs()
                if self.config.get("watch_screenshots", True):
                    self._poll_screenshots()
                self._last_error = ""
            except Exception as exc:
                self._last_error = str(exc)
            self._stop.wait(2.5)

    def _poll_logs(self) -> None:
        logs_dir, _ = self.get_paths()
        if not logs_dir:
            return
        folder = self._latest_log_folder(logs_dir)
        if not folder:
            return

        for lf in folder.iterdir():
            if not lf.is_file():
                continue
            lname = lf.name.lower()
            if not (lname.endswith(".log") and ("application" in lname or "notifications" in lname or "output" in lname)):
                continue

            key = str(lf)
            size = lf.stat().st_size
            prev = self._offsets.get(key, 0)
            if size < prev:
                prev = 0
            if size == prev:
                continue

            with open(lf, "r", encoding="utf-8", errors="ignore") as f:
                f.seek(prev)
                chunk = f.read()
                self._offsets[key] = f.tell()

            if chunk:
                entries = self._extract_entries(chunk)
                with self.db.batch():
                    self._apply_entries(entries, is_initial_replay=False)

    @staticmethod
    def _extract_entries(chunk: str) -> list[tuple[str, str, dict[str, Any] | None]]:
        entries: list[tuple[str, str, dict[str, Any] | None]] = []
        lines = chunk.splitlines()
        i = 0
        n = len(lines)
        while i < n:
            line = lines[i]
            m = LOG_HEADER_RE.match(line)
            if not m:
                i += 1
                continue

            # Retain millisecond precision so chronological sorting is stable
            ts_iso = f"{m.group('date')}T{m.group('time')}"
            msg = m.group("msg")

            j = i + 1
            buf = []
            while j < n and not LOG_HEADER_RE.match(lines[j]):
                buf.append(lines[j])
                j += 1

            json_obj: dict[str, Any] | None = None
            if buf:
                raw_buf = "\n".join(buf).strip()
                if raw_buf.startswith("{") and raw_buf.endswith("}"):
                    try:
                        json_obj = json.loads(raw_buf)
                    except Exception:
                        pass

            entries.append((ts_iso, msg, json_obj))
            i = j
        return entries

    def _apply_entries(
        self,
        entries: list[tuple[str, str, dict[str, Any] | None]],
        is_initial_replay: bool = False,
    ) -> None:
        # Cache mode task maps during replay to avoid repeated lookups
        tasks_cache: dict[str, dict[str, Any]] = {}
        for ts_iso, msg, json_obj in entries:
            if "Session mode:" in msg:
                mm = SESSION_MODE_RE.search(msg)
                if mm:
                    self._active_mode = _map_session_mode(mm.group("mode"))
                continue

            if not is_initial_replay:
                if "scene preset path:" in msg:
                    sm = SCENE_PATH_RE.search(msg)
                    if sm:
                        self._set_active_map(scene_path=sm.group("scene"))
                elif "TRACE-NetworkGameCreate profileStatus" in msg:
                    lm = LOCATION_RE.search(msg)
                    if lm:
                        self._set_active_map(name_id=lm.group("map").strip())
                elif "GameStarted" in msg:
                    self._raid_started_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
                    self._active_raid_id = self.db.record_raid(
                        self._active_mode,
                        self._active_map_id,
                        self._active_map_name or "Рейд",
                        "PVE" if self._active_mode == "pve" else "PMC",
                        self._raid_started_at,
                    )
                elif "Got notification | UserMatchOver" in msg or "Network game matching aborted" in msg:
                    self._close_active_raid()

            if "Got notification | ChatMessageReceived" in msg and json_obj:
                inner = json_obj.get("message") or {}
                mtype = int(inner.get("type") or 0)
                mode = self._active_mode

                if mtype in TASK_STATUS_MAP:
                    tpl = str(inner.get("templateId") or "")
                    task_id = tpl.split(" ")[0].strip()
                    if not task_id:
                        continue
                    if mode not in tasks_cache:
                        try:
                            tasks_cache[mode] = self.data_store.get_mode_data(mode)["tasks"]
                        except Exception:
                            tasks_cache[mode] = {}
                    tk = tasks_cache[mode].get(task_id)
                    tk_name = tk["name"] if tk else ""
                    trader_name = tk["traderName"] if tk else ""
                    xp = tk["experience"] if tk else 0
                    if not tk_name:
                        tk_name = self.data_store.lookup_task_name(task_id, mode) or f"Квест {task_id[:8]}"

                    status = TASK_STATUS_MAP[mtype]
                    self.db.set_quest_status(
                        game_mode=mode,
                        task_id=task_id,
                        status=status,
                        task_name=tk_name,
                        trader_name=trader_name,
                        xp=xp,
                        source="log",
                        occurred_at=ts_iso,
                        record_history=True,
                    )

    def _set_active_map(self, scene_path: str = "", name_id: str = "") -> None:
        try:
            data = self.data_store.get_mode_data(self._active_mode)
            mid = ""
            if scene_path:
                mid = data["maps_by_scene"].get(scene_path, "")
            if not mid and name_id:
                mid = data["maps_by_name_id"].get(name_id, "")
            if mid and mid in data["maps"]:
                self._active_map_id = mid
                self._active_map_name = data["maps"][mid]["name"]
        except Exception:
            pass

    def _close_active_raid(self) -> None:
        if self._active_raid_id is not None and self._raid_started_at:
            try:
                now = datetime.now(timezone.utc)
                started = datetime.fromisoformat(self._raid_started_at)
                dur = max(0, int((now - started).total_seconds()))
                self.db.finish_raid(self._active_raid_id, now.isoformat(timespec="seconds"), dur)
            except Exception:
                pass
        self._active_raid_id = None
        self._raid_started_at = None

    def _poll_screenshots(self) -> None:
        _, screens_dir = self.get_paths()
        if not screens_dir:
            return
        p = Path(screens_dir)
        if not p.exists():
            return

        for f in sorted(p.glob("*.png"), key=lambda x: x.stat().st_mtime):
            if f.name in self._seen_screenshots:
                continue
            self._seen_screenshots.add(f.name)
            m = SCREENSHOT_RE.search(f.name)
            if not m:
                continue
            x = float(m.group("x"))
            y = float(m.group("y"))
            z = float(m.group("z"))
            rx = float(m.group("rx"))
            ry = float(m.group("ry"))
            rz = float(m.group("rz"))
            rw = float(m.group("rw"))
            yaw = quaternion_to_yaw_deg(rx, ry, rz, rw)

            map_id = self._active_map_id
            uv = None
            if map_id:
                uv = self.data_store.project_world_coords(self._active_mode, map_id, x, z)

            self.db.set_state(
                "last_player_pin",
                {
                    "filename": f.name,
                    "mapId": map_id,
                    "mapName": self._active_map_name,
                    "x": x,
                    "y": y,
                    "z": z,
                    "yaw": round(yaw, 1),
                    "uv": uv,
                    "capturedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                },
            )

    def import_historical_logs(self) -> dict[str, Any]:
        """One-click Read-Only scan of existing local log folders to backfill quest history."""
        logs_dir, _ = self.get_paths()
        if not logs_dir or not Path(logs_dir).exists():
            return {"ok": False, "importedEvents": 0, "error": "Папка Logs не найдена"}

        folders = sorted(
            [d for d in Path(logs_dir).iterdir() if d.is_dir() and d.name.startswith("log_")],
            key=lambda d: d.name,
        )
        if not folders:
            return {"ok": False, "importedEvents": 0, "error": f"В папке {logs_dir} нет подпапок log_*"}

        before_reg = len(self.db.get_quest_history("regular", limit=10000))
        before_pve = len(self.db.get_quest_history("pve", limit=10000))

        # Preload both modes so task lookups during replay are instant
        for gm in ("regular", "pve"):
            try:
                self.data_store.get_mode_data(gm)
            except Exception:
                pass

        with self.db.batch():
            for folder in folders:
                combined: list[tuple[str, int, str, dict[str, Any] | None]] = []
                for lf in sorted(folder.iterdir(), key=lambda x: x.name):
                    if not lf.is_file():
                        continue
                    lname = lf.name.lower()
                    if not lname.endswith(".log"):
                        continue
                    is_app = "application" in lname
                    is_notif = "notifications" in lname
                    is_output = "output" in lname
                    if not (is_app or is_notif or is_output):
                        continue
                    txt = lf.read_text(encoding="utf-8", errors="ignore")
                    prio = 0 if is_app else 1
                    for ts_iso, msg, json_obj in self._extract_entries(txt):
                        is_relevant = (
                            "Session mode:" in msg
                            or "ChatMessageReceived" in msg
                            or "scene preset path:" in msg
                            or "TRACE-NetworkGameCreate" in msg
                            or "GameStarted" in msg
                            or "UserMatchOver" in msg
                        )
                        if not is_relevant:
                            continue
                        combined.append((ts_iso, prio, msg, json_obj))

                combined.sort(key=lambda item: (item[0], item[1]))
                entries = [(ts, msg, obj) for ts, _, msg, obj in combined]
                self._apply_entries(entries, is_initial_replay=True)

            # Reconcile progress after replay (recovers completed from history and infers prerequisite story quests)
            reconciled = {}
            for gm in ("regular", "pve"):
                try:
                    tasks_dict = self.data_store.get_mode_data(gm).get("tasks", {})
                    reconciled[gm] = self.db.reconcile_quest_progress(gm, tasks_dict)
                except Exception:
                    pass

        after_reg = len(self.db.get_quest_history("regular", limit=10000))
        after_pve = len(self.db.get_quest_history("pve", limit=10000))
        reg_added = after_reg - before_reg
        pve_added = after_pve - before_pve
        saved_counts = {
            "regular": len(self.db.get_quest_statuses("regular")),
            "pve": len(self.db.get_quest_statuses("pve")),
        }
        return {
            "ok": True,
            "logsDir": logs_dir,
            "foldersScanned": len(folders),
            "importedEvents": reg_added + pve_added,
            "byMode": {"regular": reg_added, "pve": pve_added},
            "savedCounts": saved_counts,
            "reconciled": reconciled,
            "activeMode": self._active_mode,
        }
