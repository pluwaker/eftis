#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs::{self, File};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const PAYLOAD_ZIP: &[u8] = include_bytes!("../payload.zip");
const UNINSTALL_REG_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Eftis";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallerInfo {
    uninstall: bool,
    already_installed: bool,
    install_dir: String,
    lang: String,
}

#[derive(Clone, Serialize)]
struct ProgressPayload {
    percent: u8,
    step: String,
    log: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DonePayload {
    install_dir: String,
}

fn hidden_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

fn detect_os_lang() -> String {
    if let Ok(out) = hidden_cmd("powershell")
        .args(["-NoProfile", "-Command", "(Get-Culture).TwoLetterISOLanguageName"])
        .output()
    {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_lowercase();
        if s == "ru" || s == "uk" || s == "be" {
            return "ru".to_string();
        }
        if !s.is_empty() {
            return "en".to_string();
        }
    }
    "ru".to_string()
}

fn query_existing_install_dir() -> Option<String> {
    let out = hidden_cmd("reg")
        .args(["query", UNINSTALL_REG_KEY, "/v", "InstallLocation"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    for line in text.lines() {
        if let Some(pos) = line.find("REG_SZ") {
            let val = line[pos + 6..].trim();
            if !val.is_empty() {
                return Some(val.to_string());
            }
        }
    }
    None
}

fn default_install_dir() -> String {
    if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local_app).join("Eftis").to_string_lossy().to_string();
    }
    r"C:\Eftis".to_string()
}

fn kill_running_processes() {
    for proc_name in ["eftis.exe", "eftis-backend.exe", "eft-assistant.exe", "eft-backend.exe"] {
        let _ = hidden_cmd("taskkill")
            .args(["/F", "/T", "/IM", proc_name])
            .output();
    }
    std::thread::sleep(std::time::Duration::from_millis(350));
}

fn emit_prog(app: &AppHandle, percent: u8, step: impl Into<String>, log: impl Into<String>) {
    let _ = app.emit(
        "install-progress",
        ProgressPayload {
            percent,
            step: step.into(),
            log: log.into(),
        },
    );
}

fn ps_escape(s: &str) -> String {
    s.replace('\'', "''")
}

fn create_shortcut(lnk_path: &Path, target_exe: &Path, working_dir: &Path) -> Result<(), String> {
    if let Some(parent) = lnk_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let script = format!(
        "$ws = New-Object -ComObject WScript.Shell; \
         $s = $ws.CreateShortcut('{}'); \
         $s.TargetPath = '{}'; \
         $s.WorkingDirectory = '{}'; \
         $s.IconLocation = '{},0'; \
         $s.Description = 'Eftis'; \
         $s.Save()",
        ps_escape(&lnk_path.to_string_lossy()),
        ps_escape(&target_exe.to_string_lossy()),
        ps_escape(&working_dir.to_string_lossy()),
        ps_escape(&target_exe.to_string_lossy())
    );
    let out = hidden_cmd("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .output()
        .map_err(|e| format!("PowerShell error: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(())
}

fn register_uninstall_entry(install_dir: &Path, uninstaller_exe: &Path, main_exe: &Path) {
    let dir_str = install_dir.to_string_lossy().to_string();
    let uninst_cmd = format!("\"{}\" --uninstall", uninstaller_exe.to_string_lossy());
    let icon_str = format!("{},0", main_exe.to_string_lossy());

    let entries: [(&str, &str, &str); 7] = [
        ("DisplayName", "REG_SZ", "Eftis"),
        ("DisplayVersion", "REG_SZ", "2.0.0"),
        ("Publisher", "REG_SZ", "Eftis"),
        ("InstallLocation", "REG_SZ", &dir_str),
        ("DisplayIcon", "REG_SZ", &icon_str),
        ("UninstallString", "REG_SZ", &uninst_cmd),
        ("EstimatedSize", "REG_DWORD", "56000"),
    ];

    for (name, typ, val) in entries {
        let _ = hidden_cmd("reg")
            .args(["add", UNINSTALL_REG_KEY, "/v", name, "/t", typ, "/d", val, "/f"])
            .output();
    }
}

#[tauri::command]
fn get_installer_info() -> InstallerInfo {
    let uninstall = std::env::args().any(|a| a == "--uninstall");
    let existing = query_existing_install_dir();
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    let install_dir = if uninstall {
        existing.clone().unwrap_or_else(|| {
            exe_dir
                .map(|d| d.to_string_lossy().to_string())
                .unwrap_or_else(default_install_dir)
        })
    } else {
        existing.clone().unwrap_or_else(default_install_dir)
    };

    InstallerInfo {
        uninstall,
        already_installed: existing.is_some(),
        install_dir,
        lang: detect_os_lang(),
    }
}

#[tauri::command]
async fn browse_install_dir(app: AppHandle, current_dir: String) -> Option<String> {
    let start_path = PathBuf::from(&current_dir);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut dialog = app.dialog().file();
        if start_path.exists() {
            dialog = dialog.set_directory(&start_path);
        }
        dialog.blocking_pick_folder()
    })
    .await
    .ok()??;

    picked.into_path().ok().map(|p| {
        let mut pb = p;
        if pb.file_name().and_then(|n| n.to_str()).map(|s| s.eq_ignore_ascii_case("Eftis")) != Some(true) {
            pb = pb.join("Eftis");
        }
        pb.to_string_lossy().to_string()
    })
}

#[tauri::command]
fn run_install(
    app: AppHandle,
    install_dir: String,
    desktop_shortcut: bool,
    start_menu_shortcut: bool,
    lang: String,
) -> Result<(), String> {
    let is_en = lang == "en";
    std::thread::spawn(move || {
        let target_dir = PathBuf::from(&install_dir);
        emit_prog(
            &app,
            5,
            if is_en { "Stopping running instances..." } else { "Остановка запущенных процессов..." },
            format!("[init] Target directory: {}", target_dir.display()),
        );
        kill_running_processes();

        if let Err(e) = fs::create_dir_all(&target_dir) {
            let _ = app.emit("install-error", format!("Cannot create directory: {e}"));
            return;
        }

        let reader = Cursor::new(PAYLOAD_ZIP);
        let mut archive = match zip::ZipArchive::new(reader) {
            Ok(a) => a,
            Err(e) => {
                let _ = app.emit("install-error", format!("Corrupt installer payload: {e}"));
                return;
            }
        };

        let mut total_bytes: u64 = 0;
        for i in 0..archive.len() {
            if let Ok(f) = archive.by_index(i) {
                total_bytes += f.size();
            }
        }
        let total_bytes = total_bytes.max(1);
        let mut written_bytes: u64 = 0;

        for i in 0..archive.len() {
            let mut file = match archive.by_index(i) {
                Ok(f) => f,
                Err(e) => {
                    let _ = app.emit("install-error", format!("Archive read error: {e}"));
                    return;
                }
            };
            let rel_path = match file.enclosed_name() {
                Some(p) => p.to_path_buf(),
                None => continue,
            };
            let out_path = target_dir.join(&rel_path);
            if file.is_dir() {
                let _ = fs::create_dir_all(&out_path);
                continue;
            }
            if let Some(parent) = out_path.parent() {
                let _ = fs::create_dir_all(parent);
            }

            emit_prog(
                &app,
                10 + ((written_bytes * 65) / total_bytes) as u8,
                if is_en {
                    format!("Extracting {}...", rel_path.display())
                } else {
                    format!("Распаковка {}...", rel_path.display())
                },
                format!("[extract] {}", rel_path.display()),
            );

            let mut out_file = match File::create(&out_path) {
                Ok(f) => f,
                Err(e) => {
                    let _ = app.emit("install-error", format!("Write error ({}): {e}", out_path.display()));
                    return;
                }
            };

            let mut buf = [0u8; 65536];
            let mut last_pct = 0u8;
            loop {
                match file.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if let Err(e) = out_file.write_all(&buf[..n]) {
                            let _ = app.emit("install-error", format!("Disk write failed: {e}"));
                            return;
                        }
                        written_bytes += n as u64;
                        let pct = 10 + ((written_bytes * 65) / total_bytes) as u8;
                        if pct != last_pct {
                            last_pct = pct;
                            emit_prog(
                                &app,
                                pct,
                                if is_en {
                                    format!("Extracting {}...", rel_path.display())
                                } else {
                                    format!("Распаковка {}...", rel_path.display())
                                },
                                "",
                            );
                        }
                    }
                    Err(e) => {
                        let _ = app.emit("install-error", format!("Decompression error: {e}"));
                        return;
                    }
                }
            }
        }

        let main_exe = target_dir.join("eftis.exe");
        let uninstaller_exe = target_dir.join("uninstall.exe");
        emit_prog(
            &app,
            82,
            if is_en { "Installing uninstaller..." } else { "Сохранение деинсталлятора..." },
            format!("[uninst] {}", uninstaller_exe.display()),
        );
        if let Ok(cur_exe) = std::env::current_exe() {
            if cur_exe != uninstaller_exe {
                let _ = fs::copy(&cur_exe, &uninstaller_exe);
            }
        }

        emit_prog(
            &app,
            88,
            if is_en { "Creating shortcuts..." } else { "Создание ярлыков..." },
            "[shortcuts] Configuring Windows shortcuts",
        );

        if desktop_shortcut {
            if let Ok(profile) = std::env::var("USERPROFILE") {
                let desktop_lnk = PathBuf::from(profile).join("Desktop").join("Eftis.lnk");
                if let Err(e) = create_shortcut(&desktop_lnk, &main_exe, &target_dir) {
                    emit_prog(&app, 90, "", format!("[warn] Desktop shortcut: {e}"));
                }
            }
        }

        if start_menu_shortcut {
            if let Ok(appdata) = std::env::var("APPDATA") {
                let sm_lnk = PathBuf::from(appdata)
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs")
                    .join("Eftis.lnk");
                if let Err(e) = create_shortcut(&sm_lnk, &main_exe, &target_dir) {
                    emit_prog(&app, 92, "", format!("[warn] Start Menu shortcut: {e}"));
                }
            }
        }

        emit_prog(
            &app,
            96,
            if is_en { "Registering application..." } else { "Регистрация в Windows..." },
            "[registry] Writing Uninstall entry",
        );
        register_uninstall_entry(&target_dir, &uninstaller_exe, &main_exe);

        emit_prog(
            &app,
            100,
            if is_en { "Completed." } else { "Установка завершена." },
            "[done] Eftis ready.",
        );
        std::thread::sleep(std::time::Duration::from_millis(220));
        let _ = app.emit("install-done", DonePayload { install_dir });
    });
    Ok(())
}

#[tauri::command]
fn run_uninstall(app: AppHandle, install_dir: String, remove_user_data: bool, lang: String) -> Result<(), String> {
    let is_en = lang == "en";
    std::thread::spawn(move || {
        let target_dir = PathBuf::from(&install_dir);
        emit_prog(
            &app,
            15,
            if is_en { "Stopping running instances..." } else { "Остановка процессов Eftis..." },
            "[uninstall] Stopping running processes",
        );
        kill_running_processes();

        emit_prog(
            &app,
            40,
            if is_en { "Removing shortcuts..." } else { "Удаление ярлыков..." },
            "[uninstall] Removing shortcuts",
        );
        if let Ok(profile) = std::env::var("USERPROFILE") {
            let _ = fs::remove_file(PathBuf::from(profile).join("Desktop").join("Eftis.lnk"));
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            let _ = fs::remove_file(
                PathBuf::from(&appdata)
                    .join("Microsoft")
                    .join("Windows")
                    .join("Start Menu")
                    .join("Programs")
                    .join("Eftis.lnk"),
            );
            if remove_user_data {
                emit_prog(
                    &app,
                    55,
                    if is_en { "Removing user data..." } else { "Удаление пользовательских данных..." },
                    "[uninstall] Removing AppData/com.eftis.app",
                );
                let _ = fs::remove_dir_all(PathBuf::from(&appdata).join("com.eftis.app"));
            }
        }

        emit_prog(
            &app,
            75,
            if is_en { "Removing registry entry..." } else { "Удаление записи из реестра..." },
            "[uninstall] Cleaning registry",
        );
        let _ = hidden_cmd("reg")
            .args(["delete", UNINSTALL_REG_KEY, "/f"])
            .output();

        emit_prog(
            &app,
            90,
            if is_en { "Removing application files..." } else { "Удаление файлов программы..." },
            format!("[uninstall] Cleaning {}", target_dir.display()),
        );
        let _ = fs::remove_file(target_dir.join("eftis.exe"));
        let _ = fs::remove_file(target_dir.join("eftis-backend.exe"));

        // Schedule delayed cleanup of uninstall.exe and folder after process exits
        let uninst_exe = target_dir.join("uninstall.exe");
        let cmd_str = format!(
            "ping 127.0.0.1 -n 3 > nul & del /f /q \"{}\" & rmdir \"{}\"",
            uninst_exe.display(),
            target_dir.display()
        );
        let mut c = Command::new("cmd");
        c.args(["/C", &cmd_str]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        c.creation_flags(CREATE_NO_WINDOW);
        let _ = c.spawn();

        emit_prog(
            &app,
            100,
            if is_en { "Uninstall complete." } else { "Удаление завершено." },
            "[done] Eftis removed.",
        );
        std::thread::sleep(std::time::Duration::from_millis(200));
        let _ = app.emit("install-done", DonePayload { install_dir });
    });
    Ok(())
}

#[tauri::command]
fn launch_app(app: AppHandle, install_dir: String) -> Result<(), String> {
    let exe = PathBuf::from(&install_dir).join("eftis.exe");
    if !exe.is_file() {
        return Err(format!("Executable not found: {}", exe.display()));
    }
    Command::new(&exe)
        .current_dir(&install_dir)
        .spawn()
        .map_err(|e| format!("Failed to launch Eftis: {e}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn minimize_window(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
}

#[tauri::command]
fn close_window(app: AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_installer_info,
            browse_install_dir,
            run_install,
            run_uninstall,
            launch_app,
            minimize_window,
            close_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running Eftis setup");
}
