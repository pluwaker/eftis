#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct BackendHandle {
    port: u16,
    child: Option<Child>,
    logs: Vec<String>,
}

struct AppState {
    backend: Arc<Mutex<BackendHandle>>,
}

#[tauri::command]
fn get_backend_port(state: tauri::State<AppState>) -> u16 {
    state.backend.lock().map(|b| b.port).unwrap_or(0)
}

#[tauri::command]
fn get_backend_logs(state: tauri::State<AppState>) -> Vec<String> {
    state.backend.lock().map(|b| b.logs.clone()).unwrap_or_default()
}

fn push_backend_log(handle: &Arc<Mutex<BackendHandle>>, app: &AppHandle, line: String) {
    if let Ok(mut guard) = handle.lock() {
        guard.logs.push(line.clone());
        if guard.logs.len() > 300 {
            let drain = guard.logs.len() - 300;
            guard.logs.drain(0..drain);
        }
    }
    let _ = app.emit("backend-log", line);
}

fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8745)
}

fn spawn_backend(data_dir: &PathBuf, handle: &Arc<Mutex<BackendHandle>>, app: &AppHandle) -> (u16, Option<Child>) {
    let data_dir_str = data_dir.to_string_lossy().to_string();
    let port = pick_free_port();
    let port_str = port.to_string();

    #[cfg(debug_assertions)]
    let mut cmd = {
        let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("project root")
            .to_path_buf();
        let run_py = project_root.join("run.py");
        let mut c = Command::new("python");
        c.arg(run_py)
            .arg("--port")
            .arg(&port_str)
            .arg("--no-browser")
            .arg("--data-dir")
            .arg(&data_dir_str)
            .current_dir(project_root);
        c
    };

    #[cfg(not(debug_assertions))]
    let mut cmd = {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        let sidecar = exe_dir.join("eftis-backend.exe");
        push_backend_log(handle, app, format!("[spawn] {} --port {} --data-dir {}", sidecar.display(), port_str, data_dir_str));
        let mut c = Command::new(sidecar);
        c.arg("--port")
            .arg(&port_str)
            .arg("--no-browser")
            .arg("--data-dir")
            .arg(&data_dir_str);
        c
    };

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = match cmd.spawn() {
        Ok(ch) => ch,
        Err(e) => {
            push_backend_log(handle, app, format!("[spawn-error] {}", e));
            return (port, None);
        }
    };

    if let Some(stdout) = child.stdout.take() {
        let h = Arc::clone(handle);
        let a = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                push_backend_log(&h, &a, format!("[stdout] {}", line));
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let h = Arc::clone(handle);
        let a = app.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                push_backend_log(&h, &a, format!("[stderr] {}", line));
            }
        });
    }

    (port, Some(child))
}

fn stop_backend(backend: &Arc<Mutex<BackendHandle>>) {
    if let Ok(mut guard) = backend.lock() {
        let port = guard.port;
        if port > 0 {
            if let Ok(mut stream) = TcpStream::connect_timeout(
                &format!("127.0.0.1:{}", port).parse().unwrap(),
                Duration::from_millis(350),
            ) {
                use std::io::Write;
                let req = format!(
                    "POST /api/shutdown HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}",
                    port
                );
                let _ = stream.write_all(req.as_bytes());
            }
        }
        if let Some(mut ch) = guard.child.take() {
            std::thread::sleep(Duration::from_millis(250));
            let _ = ch.kill();
            let _ = ch.wait();
        }
    }
}

fn main() {
    let backend_arc = Arc::new(Mutex::new(BackendHandle {
        port: 0,
        child: None,
        logs: Vec::new(),
    }));
    let backend_for_setup = Arc::clone(&backend_arc);
    let backend_for_exit = Arc::clone(&backend_arc);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .manage(AppState {
            backend: backend_arc,
        })
        .invoke_handler(tauri::generate_handler![get_backend_port, get_backend_logs])
        .setup(move |app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = std::fs::create_dir_all(&data_dir);

            // One-time migration from legacy com.eft.assistant data directory
            if !data_dir.join("eft_assistant.db").exists() {
                if let Some(legacy_dir) = data_dir.parent().map(|p| p.join("com.eft.assistant")) {
                    if legacy_dir.join("eft_assistant.db").is_file() {
                        let _ = std::fs::copy(legacy_dir.join("eft_assistant.db"), data_dir.join("eft_assistant.db"));
                        if legacy_dir.join("config.json").is_file() && !data_dir.join("config.json").exists() {
                            let _ = std::fs::copy(legacy_dir.join("config.json"), data_dir.join("config.json"));
                        }
                    }
                }
            }

            let (port, child) = spawn_backend(&data_dir, &backend_for_setup, app.handle());
            if let Ok(mut guard) = backend_for_setup.lock() {
                guard.port = port;
                guard.child = child;
            }

            let show_item = MenuItem::with_id(app, "show", "Открыть Eftis", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("default icon"))
                .tooltip("Eftis")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(move |_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                stop_backend(&backend_for_exit);
            }
        });
}
