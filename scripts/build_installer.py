"""Build custom Tauri v2 Eftis installer (Eftis-Setup-2.0.0-x64.exe)."""

from __future__ import annotations

import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET_TRIPLE = "x86_64-pc-windows-msvc"
MAIN_EXE = ROOT / "src-tauri" / "target" / "release" / "eftis.exe"
SIDECAR_EXE = ROOT / "src-tauri" / "binaries" / f"eftis-backend-{TARGET_TRIPLE}.exe"
INSTALLER_DIR = ROOT / "installer"
INSTALLER_TAURI = INSTALLER_DIR / "src-tauri"
PAYLOAD_ZIP = INSTALLER_TAURI / "payload.zip"
SETUP_EXE = INSTALLER_TAURI / "target" / "release" / "eftis-setup.exe"
OUT_DIR = ROOT / "dist-installer"
FINAL_INSTALLER = OUT_DIR / "Eftis-Setup-2.0.0-x64.exe"


def run(cmd: list[str], cwd: Path) -> None:
    print(f"[build_installer] $ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(cwd), check=True)


def main() -> None:
    npm_bin = shutil.which("npm.cmd") or shutil.which("npm")
    cargo_bin = shutil.which("cargo.exe") or shutil.which("cargo")
    if not npm_bin:
        raise FileNotFoundError("npm not found in PATH")
    if not cargo_bin:
        raise FileNotFoundError("cargo not found in PATH")

    # 1. Build Python sidecar
    run([sys.executable, str(ROOT / "scripts" / "build_backend.py")], ROOT)
    if not SIDECAR_EXE.is_file():
        raise FileNotFoundError(f"Missing sidecar: {SIDECAR_EXE}")

    # 2. Build frontend + main Tauri binary (without NSIS)
    run([npm_bin, "run", "tauri", "build", "--", "--no-bundle"], ROOT)
    if not MAIN_EXE.is_file():
        raise FileNotFoundError(f"Missing main binary: {MAIN_EXE}")

    # 3. Sync icons & logo into installer
    inst_icons = INSTALLER_TAURI / "icons"
    inst_icons.mkdir(parents=True, exist_ok=True)
    for ico_name in ("icon.ico", "icon.png", "32x32.png", "128x128.png"):
        src_ico = ROOT / "src-tauri" / "icons" / ico_name
        if src_ico.is_file():
            shutil.copy2(src_ico, inst_icons / ico_name)
    shutil.copy2(ROOT / "src" / "assets" / "logo.png", INSTALLER_DIR / "ui" / "logo.png")

    # 4. Pack payload.zip
    print(f"[build_installer] Packing {PAYLOAD_ZIP}...")
    with zipfile.ZipFile(PAYLOAD_ZIP, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        zf.write(MAIN_EXE, arcname="eftis.exe")
        zf.write(SIDECAR_EXE, arcname="eftis-backend.exe")
    print(f"[build_installer] Payload size: {PAYLOAD_ZIP.stat().st_size / (1024 * 1024):.2f} MiB")

    # 5. Compile custom Tauri setup executable
    run([cargo_bin, "build", "--release"], INSTALLER_TAURI)
    if not SETUP_EXE.is_file():
        raise FileNotFoundError(f"Missing setup executable: {SETUP_EXE}")

    # 6. Copy final installer to dist-installer/
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SETUP_EXE, FINAL_INSTALLER)
    size_mb = FINAL_INSTALLER.stat().st_size / (1024 * 1024)
    print(f"[build_installer] Ready: {FINAL_INSTALLER} ({size_mb:.2f} MiB)")


if __name__ == "__main__":
    main()
