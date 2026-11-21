"""Launch script for the local Escape from Tarkov personal assistant."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import sys
import threading
import webbrowser
from pathlib import Path

from backend.db import AssistantDB
from backend.log_watcher import ReadOnlyEftWatcher
from backend.server import AppContext, run_server
from backend.tarkov_data import TarkovDataStore

BASE_DIR = Path(__file__).resolve().parent
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", BASE_DIR))


def load_config(data_dir: Path = BASE_DIR) -> tuple[Path, dict]:
    data_dir.mkdir(parents=True, exist_ok=True)
    cfg_path = data_dir / "config.json"
    defaults = {
        "host": "127.0.0.1",
        "port": 8745,
        "default_game_mode": "regular",
        "language": "ru",
        "watch_logs": True,
        "watch_screenshots": True,
        "eft_logs_dir": "",
        "eft_screenshots_dir": "",
        "auto_open_browser": True,
        "cache_ttl_minutes": 60,
    }
    if cfg_path.exists():
        try:
            loaded = json.loads(cfg_path.read_text(encoding="utf-8"))
            defaults.update(loaded)
        except Exception:
            pass
    else:
        cfg_path.write_text(json.dumps(defaults, ensure_ascii=False, indent=2), encoding="utf-8")
    return cfg_path, defaults


def _ensure_stdio_streams(data_dir: Path = BASE_DIR) -> None:
    """Redirect stdout/stderr to a log file when launched windowless (pythonw.exe)."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    log_path = data_dir / "eft_assistant.log"
    try:
        if log_path.exists() and log_path.stat().st_size > 1_048_576:
            log_path.write_text("", encoding="utf-8")
        stream = open(log_path, "a", encoding="utf-8", buffering=1)
        if sys.stdout is None:
            sys.stdout = stream
        if sys.stderr is None:
            sys.stderr = stream
    except Exception:
        pass


def _is_port_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.6):
            return True
    except OSError:
        return False


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--data-dir", default="")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--open", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args, _ = parser.parse_known_args(argv)
    return args


def _seed_bundled_cache(data_dir: Path) -> Path:
    cache_dir = data_dir / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    bundled_rel = RESOURCE_DIR / "cache" / "wiki_quest_relations.json"
    target_rel = cache_dir / "wiki_quest_relations.json"
    if bundled_rel.is_file() and not target_rel.exists():
        try:
            shutil.copy2(bundled_rel, target_rel)
        except Exception:
            pass
    return cache_dir


def main(force_open_browser: bool = False) -> None:
    args = _parse_args()
    data_dir = Path(args.data_dir).resolve() if args.data_dir else BASE_DIR
    _ensure_stdio_streams(data_dir)
    cfg_path, config = load_config(data_dir)
    host = config.get("host", "127.0.0.1")
    port = int(args.port) if args.port is not None else int(config.get("port", 8745))
    config["port"] = port
    url = f"http://{host}:{port}/"
    should_open = (force_open_browser or args.open or config.get("auto_open_browser", True)) and not args.no_browser

    if port > 0 and _is_port_open(host, port):
        print(f"[EFT Assistant] Сервер уже запущен: {url}", flush=True)
        if should_open:
            webbrowser.open(url)
        return

    db = AssistantDB(data_dir / "eft_assistant.db")
    cache_dir = _seed_bundled_cache(data_dir)
    data_store = TarkovDataStore(
        cache_dir=cache_dir,
        ttl_minutes=int(config.get("cache_ttl_minutes", 15)),
    )

    default_mode = config.get("default_game_mode", "pve")
    default_lang = config.get("language", "ru")
    print(f"[EFT Assistant] Загрузка и кеширование базы ({default_mode}, {default_lang}) из json.tarkov.dev...", flush=True)
    try:
        data_store.get_mode_data(default_mode, lang=default_lang)
        print("[EFT Assistant] База данных успешно загружена.", flush=True)
    except Exception as exc:
        print(f"[EFT Assistant] Предупреждение при загрузке данных: {exc}", flush=True)

    # Reconcile default mode immediately; reconcile secondary mode in background so startup is fast
    try:
        m_tasks = data_store.get_mode_data(default_mode, lang=default_lang).get("tasks", {})
        rec = db.reconcile_quest_progress(default_mode, m_tasks)
        if rec.get("restoredFromHistory") or rec.get("inferredPrereqs"):
            print(f"[EFT Assistant] Синхронизация {default_mode.upper()}: восстановлено {rec['restoredFromHistory']} выполненных квестов, вычислено {rec['inferredPrereqs']} пререквизитов.", flush=True)
    except Exception:
        pass

    other_mode = "regular" if default_mode == "pve" else "pve"

    def _reconcile_other() -> None:
        try:
            o_tasks = data_store.get_mode_data(other_mode, lang=default_lang).get("tasks", {})
            db.reconcile_quest_progress(other_mode, o_tasks)
        except Exception:
            pass

    threading.Thread(target=_reconcile_other, daemon=True).start()

    watcher = ReadOnlyEftWatcher(db=db, data_store=data_store, config=config)
    watcher.start()

    frontend_dir = RESOURCE_DIR / "frontend"
    ctx = AppContext(
        config_path=cfg_path,
        config=config,
        db=db,
        data_store=data_store,
        watcher=watcher,
        frontend_dir=frontend_dir,
    )
    server = run_server(ctx)
    actual_port = int(server.server_address[1])
    url = f"http://{host}:{actual_port}/"
    pid_path = data_dir / "eft_assistant.pid"
    try:
        pid_path.write_text(str(os.getpid()), encoding="utf-8")
    except Exception:
        pass

    def _graceful_sigterm(_signum: int, _frame: object) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    try:
        signal.signal(signal.SIGTERM, _graceful_sigterm)
    except Exception:
        pass

    print(f"READY_PORT:{actual_port}", flush=True)
    print(f"[EFT Assistant] Локальный дашборд запущен: {url}", flush=True)
    print("[EFT Assistant] Режим безопасности: Read-Only к логам/скриншотам, без изменений файлов игры.", flush=True)

    if should_open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[EFT Assistant] Остановка...")
    finally:
        watcher.stop()
        server.server_close()
        try:
            if pid_path.exists() and pid_path.read_text(encoding="utf-8").strip() == str(os.getpid()):
                pid_path.unlink()
        except Exception:
            pass


if __name__ == "__main__":
    main()

