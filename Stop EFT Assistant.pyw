"""Gracefully stops a background EFT Assistant server started without a console."""

from __future__ import annotations

import json
import os
import signal
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def main() -> None:
    host = "127.0.0.1"
    port = 8745
    cfg_path = BASE_DIR / "config.json"
    if cfg_path.exists():
        try:
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
            host = cfg.get("host", host)
            port = int(cfg.get("port", port))
        except Exception:
            pass

    stopped = False
    try:
        req = urllib.request.Request(f"http://{host}:{port}/api/shutdown", data=b"{}", method="POST")
        with urllib.request.urlopen(req, timeout=2.0) as resp:
            if resp.status == 200:
                stopped = True
    except Exception:
        pass

    pid_path = BASE_DIR / "eft_assistant.pid"
    if not stopped and pid_path.exists():
        try:
            pid = int(pid_path.read_text(encoding="utf-8").strip())
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass
    if pid_path.exists():
        try:
            pid_path.unlink()
        except Exception:
            pass


if __name__ == "__main__":
    main()
