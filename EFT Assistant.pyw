"""Windowless launcher for EFT Assistant (runs without opening a console window)."""

from __future__ import annotations

import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

import run  # noqa: E402

if __name__ == "__main__":
    run.main(force_open_browser=True)
