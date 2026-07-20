#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Mutex, OnceLock},
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::Manager;

const BACKEND_HOST: &str = "127.0.0.1";
const DEFAULT_BACKEND_PORT: u16 = 8010;
const SIDECAR_BINARY: &str = "qigou-backend-sidecar.exe";
const BACKEND_SERVICE_ID: &str = "com.havenframe.desktop.backend";
const API_CONTRACT_VERSION: &str = "2026-07-13-model-persistence-v1";

struct BackendProcess {
    child: Child,
    executable_path: PathBuf,
}

static BACKEND_PROCESS: OnceLock<Mutex<Option<BackendProcess>>> = OnceLock::new();

fn main() {
    let app = tauri::Builder::default()
        .setup(|app| {
            if let Err(error) = ensure_backend_running(app) {
                eprintln!("Qigou backend startup warning: {error}");
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Qigou");

    app.run(|_, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            stop_backend_child();
        }
    });
}

fn ensure_backend_running(app: &tauri::App) -> Result<(), String> {
    let backend_port = configured_backend_port();
    if backend_health_ok(backend_port) {
        return Ok(());
    }

    if let Some(sidecar_path) = find_sidecar_binary(app) {
        return start_sidecar_backend(app, &sidecar_path, backend_port);
    }

    let repo_root = find_repo_root().ok_or_else(|| {
        "Could not find bundled backend sidecar or backend/main.py near the desktop executable."
            .to_string()
    })?;

    start_development_backend(&repo_root, backend_port)
}

fn start_sidecar_backend(
    app: &tauri::App,
    sidecar_path: &Path,
    backend_port: u16,
) -> Result<(), String> {
    let app_data_override = env::var_os("QIGOU_APP_DATA_DIR").filter(|value| !value.is_empty());
    let app_data_dir = match app_data_override.as_ref() {
        Some(path) => PathBuf::from(path),
        None => app
            .path()
            .app_local_data_dir()
            .map_err(|error| format!("Could not resolve LocalAppData directory: {error}"))?,
    };
    ensure_user_data_dirs(&app_data_dir)?;

    let backend_port_string = backend_port.to_string();
    let parent_pid_string = std::process::id().to_string();
    let mut command = Command::new(sidecar_path);
    command
        .args([
            "--host",
            BACKEND_HOST,
            "--port",
            backend_port_string.as_str(),
            "--parent-pid",
            parent_pid_string.as_str(),
        ])
        .env("INTERIOR_AI_STUDIO_SKIP_LOCAL_ENV", "1")
        .env("QIGOU_APP_DATA_DIR", &app_data_dir)
        .env("QIGOU_WORKSPACE_DIR", app_data_dir.join("workspace"))
        .env("QIGOU_API_HOST", BACKEND_HOST)
        .env("QIGOU_API_PORT", &backend_port_string)
        .env("QIGOU_API_PROFILE", "desktop_client")
        .env("QIGOU_SERVICE_ID", BACKEND_SERVICE_ID)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if app_data_override.is_none() {
        if let Some(parent) = app_data_dir.parent() {
            command.env("QIGOU_LEGACY_APP_DATA_DIR", parent.join("com.qigou.desktop"));
        }
    }

    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    let child = command
        .spawn()
        .map_err(|error| format!("Could not start bundled FastAPI sidecar: {error}"))?;
    BACKEND_PROCESS
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .map(|mut slot| {
            *slot = Some(BackendProcess {
                child,
                executable_path: sidecar_path.to_path_buf(),
            });
        });

    wait_for_backend(backend_port)
}

fn start_development_backend(repo_root: &Path, backend_port: u16) -> Result<(), String> {
    let python = env::var("QIGOU_PYTHON").unwrap_or_else(|_| "python".to_string());
    let backend_port_string = backend_port.to_string();
    let mut command = Command::new(python);
    command
        .args([
            "-m",
            "uvicorn",
            "backend.main:app",
            "--host",
            BACKEND_HOST,
            "--port",
            backend_port_string.as_str(),
        ])
        .current_dir(repo_root)
        .env("QIGOU_API_PROFILE", "desktop_client")
        .env("QIGOU_SERVICE_ID", BACKEND_SERVICE_ID)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);

    command
        .spawn()
        .map_err(|error| format!("Could not start FastAPI backend: {error}"))?;

    wait_for_backend(backend_port)
}

fn wait_for_backend(backend_port: u16) -> Result<(), String> {
    for _ in 0..20 {
        if backend_health_ok(backend_port) {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }

    Err("FastAPI backend was started but did not answer /health in time.".to_string())
}

fn backend_health_ok(backend_port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], backend_port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));
    let request = format!(
        "GET /health HTTP/1.1\r\nHost: {BACKEND_HOST}:{backend_port}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }

    response.contains(" 200 ")
        && response.contains("\"status\"")
        && response.contains("\"ok\"")
        && response.contains(BACKEND_SERVICE_ID)
        && response.contains(API_CONTRACT_VERSION)
}

fn configured_backend_port() -> u16 {
    env::var("QIGOU_API_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port >= 1024)
        .unwrap_or(DEFAULT_BACKEND_PORT)
}

fn find_sidecar_binary(app: &tauri::App) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join(SIDECAR_BINARY));
    }
    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join(SIDECAR_BINARY));
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn ensure_user_data_dirs(app_data_dir: &Path) -> Result<(), String> {
    for path in [
        app_data_dir.join("data"),
        app_data_dir.join("workspace"),
        app_data_dir.join("workspace").join("projects"),
        app_data_dir.join("workspace").join("outputs"),
        app_data_dir.join("workspace").join("logs"),
        app_data_dir.join("workspace").join("cache"),
        app_data_dir.join("workspace").join("temp"),
    ] {
        std::fs::create_dir_all(&path).map_err(|error| {
            format!(
                "Could not create user data directory {}: {error}",
                path.display()
            )
        })?;
    }
    Ok(())
}

fn stop_backend_child() {
    let Some(slot) = BACKEND_PROCESS.get() else {
        return;
    };
    let Ok(mut process_guard) = slot.lock() else {
        return;
    };
    if let Some(mut backend) = process_guard.take() {
        kill_child_tree(backend.child.id());
        let _ = backend.child.kill();
        let _ = backend.child.wait();
        kill_sidecar_by_exact_path(&backend.executable_path);
    }
}

#[cfg(target_os = "windows")]
fn kill_child_tree(pid: u32) {
    let mut command = Command::new("taskkill");
    command
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.creation_flags(0x08000000);
    let _ = command.status();
}

#[cfg(not(target_os = "windows"))]
fn kill_child_tree(_: u32) {}

#[cfg(target_os = "windows")]
fn kill_sidecar_by_exact_path(path: &Path) {
    let path = path.to_string_lossy().replace('\'', "''");
    let script = format!(
        "Get-CimInstance Win32_Process | Where-Object {{ $_.Name -eq '{SIDECAR_BINARY}' -and $_.ExecutablePath -eq '{path}' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force }}"
    );
    let mut command = Command::new("powershell");
    command
        .args(["-NoProfile", "-Command", &script])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.creation_flags(0x08000000);
    let _ = command.status();
}

#[cfg(not(target_os = "windows"))]
fn kill_sidecar_by_exact_path(_: &Path) {}

fn find_repo_root() -> Option<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(current_dir) = env::current_dir() {
        roots.push(current_dir);
    }
    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    roots
        .into_iter()
        .flat_map(|root| root.ancestors().map(Path::to_path_buf).collect::<Vec<_>>())
        .find(|candidate| candidate.join("backend").join("main.py").is_file())
}
