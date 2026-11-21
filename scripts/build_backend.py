"""Build standalone Python sidecar executable for Tauri using PyInstaller."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET_TRIPLE = "x86_64-pc-windows-msvc"
BIN_DIR = ROOT / "src-tauri" / "binaries"
OUT_EXE = BIN_DIR / f"eftis-backend-{TARGET_TRIPLE}.exe"


def main() -> None:
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    stale = BIN_DIR / f"eft-backend-{TARGET_TRIPLE}.exe"
    if stale.exists():
        stale.unlink()

    build_work = ROOT / "build" / "pyinstaller_work"
    build_dist = ROOT / "build" / "pyinstaller_dist"
    spec_dir = ROOT / "build"

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--noconsole",
        "--name",
        "eftis-backend",
        "--distpath",
        str(build_dist),
        "--workpath",
        str(build_work),
        "--specpath",
        str(spec_dir),
    ]

    wiki_rel = ROOT / "cache" / "wiki_quest_relations.json"
    if wiki_rel.is_file():
        cmd.extend(["--add-data", f"{wiki_rel};cache"])

    cmd.append(str(ROOT / "run.py"))

    print("[build_backend] Running PyInstaller...")
    subprocess.run(cmd, cwd=str(ROOT), check=True)

    built = build_dist / "eftis-backend.exe"
    if not built.is_file():
        raise FileNotFoundError(f"Expected built executable not found: {built}")

    shutil.copy2(built, OUT_EXE)
    print(f"[build_backend] Sidecar ready: {OUT_EXE} ({OUT_EXE.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
