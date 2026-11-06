//! The Rust shell. A thin toolbox for the web UI: windows, terminals, shell commands, files,
//! the sidecar process and macOS features. Product logic lives in TypeScript.
//! Research: docs/research/conductor/native-and-sidecar-map.md section A.
//! Command names and events: docs/plans/tauri-commands.md. Each module registers its commands
//! here in `generate_handler!` and its shared state with `.manage(...)`. State is created once
//! and handed to commands through `tauri::State`, so no module keeps global variables.
//!
//! @feature PLAT-32 System facts: macOS version and the build's CPU
//! Owns: `system_info`, which reports the macOS version from `sw_vers`, the Mac's own CPU from
//! `sysctl`, and the CPU this build was compiled for.
//! Behaviour: ui-map.md 1.3 (the macOS version warning), 7.4 (the wrong-CPU build screen),
//! services-map.md 1.1 (system facts).
//! Test first: `plat_32_reports_the_running_macos_version` reads the version `sw_vers` reports.
//!
//! @feature PLAT-27 Startup hardening: file limit, panics in the log, one instance
//! Owns: the startup steps `run` takes before the window is usable: set the login-shell PATH, raise
//! the open-file limit, send Rust panics to the app log, allow one running copy of the app, and end
//! every terminal when the app closes.
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`lib.rs` raises the
//! file-descriptor limit and installs a panic hook), A4 (closing the app ends its terminals), A5
//! ("Failed to raise file descriptor limit") and A6 (the login-shell PATH is repaired before the
//! runtime starts).
//! Must handle: a limit that cannot be raised (a logged warning, the app still starts); a limit
//! already above the wanted one (left alone); a panic on any thread (message, location and a
//! backtrace go to the log before the process ends; with `panic = "abort"` in release builds the
//! hook is the only record); a second launch (the first window comes to the front and the second
//! process exits); a panic while the log is not ready (printed to stderr).
//! Our design choice: the soft limit rises to `WANTED_SOFT_LIMIT` (10,240) when it is lower, capped
//! by the hard limit. A higher limit is left alone.
//! Our design choice: the research shows no single-instance guard in Conductor. We add one with a
//! lock file in the app data folder because two copies would share one database and one sidecar
//! socket folder. The lock is our own, so no extra crate is needed.
//! Test first: `raise_file_limit` returns a soft limit at least as high as the one before the call.

pub mod attachments;
pub mod binaries;
pub mod db;
pub mod deep_link;
pub mod error;
pub mod file_search;
pub mod files;
pub mod http;
pub mod keychain;
pub mod logger;
pub mod menu;
pub mod navigation;
pub mod notifications;
pub mod open_with;
pub mod permissions;
mod process_group;
pub mod pty;
pub mod resource_usage;
pub mod shell;
pub mod sidecar;
pub mod speech;
pub mod terminal_history;
pub mod updater;

use std::fs::{self, File, OpenOptions};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::io::AsRawFd;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::mpsc::TrySendError;

use error::{CommandError, CommandResult};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// The soft open-file limit the app asks for. A higher limit is left alone.
const WANTED_SOFT_LIMIT: u64 = 10_240;

#[cfg(target_os = "macos")]
const RLIMIT_NOFILE: i32 = 8;
#[cfg(not(target_os = "macos"))]
const RLIMIT_NOFILE: i32 = 7;

/// `struct rlimit` on macOS and 64-bit Unix: two unsigned 64-bit fields.
#[repr(C)]
struct FileLimit {
    soft: u64,
    hard: u64,
}

unsafe extern "C" {
    fn getrlimit(resource: i32, limits: *mut FileLimit) -> i32;
    fn setrlimit(resource: i32, limits: *const FileLimit) -> i32;
}

/// The soft and hard open-file limits of this process.
fn read_file_limit() -> CommandResult<(u64, u64)> {
    let mut limits = FileLimit { soft: 0, hard: 0 };
    // SAFETY: getrlimit fills one `struct rlimit` and reads nothing else.
    if unsafe { getrlimit(RLIMIT_NOFILE, &mut limits) } != 0 {
        return Err(CommandError::Io(std::io::Error::last_os_error()));
    }
    Ok((limits.soft, limits.hard))
}

/// The soft limit to set, or `None` when the current limit is already high enough. A requested
/// limit above the hard limit is capped by the hard limit.
fn next_soft_limit(current: u64, hard: u64, wanted: u64) -> Option<u64> {
    if current >= wanted {
        return None;
    }
    let target = wanted.min(hard);
    (target > current).then_some(target)
}

/// Raises the soft limit of open files towards the hard limit. Returns the new soft limit.
pub fn raise_file_limit() -> CommandResult<u64> {
    let (current, hard) = read_file_limit()?;
    let Some(target) = next_soft_limit(current, hard, WANTED_SOFT_LIMIT) else {
        return Ok(current);
    };
    let limits = FileLimit { soft: target, hard };
    // SAFETY: setrlimit reads one `struct rlimit`; the new soft limit is at most the hard limit.
    if unsafe { setrlimit(RLIMIT_NOFILE, &limits) } != 0 {
        return Err(CommandError::Io(std::io::Error::last_os_error()));
    }
    Ok(target)
}

/// The login-shell PATH, when the capture produced one.
fn apply_login_path<F: FnOnce(&str)>(login: &shell::LoginEnv, set_path: F) -> bool {
    let Some(path) = (!login.path.is_empty()).then_some(login.path.as_str()) else {
        return false;
    };
    set_path(path);
    true
}

/// A shell state that already holds the startup capture, so the first later call reuses it and
/// does not write the process environment after the runtime has started.
fn shell_state_with_login(login: shell::LoginEnv) -> shell::ShellState {
    let state = shell::ShellState::default();
    *state.login_env.blocking_lock() = Some(login);
    state
}

/// Captures the login-shell PATH and applies it before the Tauri runtime starts. The capture is
/// kept in the shell state, so no later call repeats the environment write.
fn prepare_shell_state() -> shell::ShellState {
    match shell::capture_login_env() {
        Ok(login) => {
            apply_login_path(&login, |path| {
                // SAFETY: this runs before the Tauri runtime starts, so no other thread reads or
                // writes the process environment while PATH changes.
                unsafe { std::env::set_var("PATH", path) };
            });
            shell_state_with_login(login)
        }
        Err(error) => {
            eprintln!("could not read the login-shell PATH: {error}");
            shell::ShellState::default()
        }
    }
}

/// Queues one Rust log record through the writer that `logger.rs` owns. Returns false when the
/// writer is not running, so the caller can fall back to stderr.
fn queue_rust_log(state: &logger::LoggerState, level: &str, message: &str) -> bool {
    let Some(allowed) = logger::level_allows(state.level.load(Ordering::Relaxed), level) else {
        return false;
    };
    if !allowed {
        return true;
    }
    let sender = match state.sender.lock() {
        Ok(sender) => sender.clone(),
        Err(_) => return false,
    };
    let Some(sender) = sender else {
        return false;
    };
    let record = logger::LogRecord {
        level: level.to_string(),
        message: message.to_string(),
        data: None,
    };
    match sender.try_send(record) {
        Ok(()) => true,
        Err(TrySendError::Full(_)) => {
            state.dropped.fetch_add(1, Ordering::Relaxed);
            true
        }
        Err(TrySendError::Disconnected(_)) => false,
    }
}

/// One line for a panic: the message, where it happened and a backtrace.
fn panic_log_message(payload: &str, location: Option<(&str, u32, u32)>, backtrace: &str) -> String {
    let place = location
        .map(|(file, line, column)| format!("{file}:{line}:{column}"))
        .unwrap_or_else(|| "an unknown location".to_string());
    format!("panic at {place}: {payload}\nbacktrace:\n{backtrace}")
}

/// Sends panics to the app log (`logger.rs`) instead of only to stderr.
pub fn install_panic_hook(app: &AppHandle) -> CommandResult<()> {
    let app = app.clone();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let text = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or("the panic had no text");
        let location = info
            .location()
            .map(|location| (location.file(), location.line(), location.column()));
        let backtrace = std::backtrace::Backtrace::force_capture().to_string();
        let message = panic_log_message(text, location, &backtrace);
        let state = app.state::<logger::LoggerState>();
        if !queue_rust_log(&state, "error", &message) {
            eprintln!("{message}");
        }
        previous(info);
    }));
    Ok(())
}

const LOCK_EX: i32 = 2;
const LOCK_NB: i32 = 4;

unsafe extern "C" {
    fn flock(fd: i32, operation: i32) -> i32;
}

/// The file whose lock proves this process is the one running copy. The lock is released when the
/// file is dropped or the process exits.
struct InstanceLock {
    _file: File,
}

/// Takes the instance lock, or returns `None` when another process holds it.
fn try_instance_lock(path: &Path) -> CommandResult<Option<InstanceLock>> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| CommandError::Failed {
            code: "instance_lock_failed",
            message: format!("Could not create {}: {error}", parent.display()),
        })?;
    }
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| CommandError::Failed {
            code: "instance_lock_failed",
            message: format!("Could not open {}: {error}", path.display()),
        })?;
    // SAFETY: flock reads only the open file descriptor and the operation flags.
    if unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) } == 0 {
        return Ok(Some(InstanceLock { _file: file }));
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::WouldBlock {
        return Ok(None);
    }
    Err(CommandError::Io(error))
}

/// Asks macOS to bring the running copy of the app to the front.
fn focus_running_instance(identifier: &str) {
    match std::process::Command::new("/usr/bin/open")
        .args(["-b", identifier])
        .status()
    {
        Ok(status) if status.success() => {}
        Ok(status) => {
            eprintln!("could not bring the running copy to the front: open exited with {status}")
        }
        Err(error) => eprintln!("could not bring the running copy to the front: {error}"),
    }
}

/// Makes a second launch focus the first window and exit.
pub fn guard_single_instance(app: &AppHandle) -> CommandResult<()> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| CommandError::Failed {
            code: "instance_lock_failed",
            message: format!("Could not find the app data folder: {error}"),
        })?;
    let path = dir.join("conducted.instance.lock");
    match try_instance_lock(&path)? {
        Some(lock) => {
            app.manage(lock);
            Ok(())
        }
        None => {
            focus_running_instance(app.config().identifier.as_str());
            std::process::exit(0);
        }
    }
}

/// SIGHUP ends a terminal's foreground process group.
const SIGHUP: i32 = 1;

/// Ends every terminal the app started. Returns one line per terminal that could not be killed.
fn terminate_terminals(state: &pty::PtyState) -> Vec<String> {
    let sessions: Vec<std::sync::Arc<pty::PtySession>> = {
        let table = state
            .sessions
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        table.values().cloned().collect()
    };
    let mut failures = Vec::new();
    for session in sessions {
        session.flow.close();
        if let Some(pid) = session.pid {
            process_group::signal_group(pid, SIGHUP);
        }
        let mut killer = session
            .killer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Err(error) = killer.kill() {
            failures.push(format!("{}: {error}", session.id));
        }
    }
    failures
}

/// Liveness check used by the UI at startup and by the scaffold's smoke test.
#[tauri::command]
fn health() -> CommandResult<&'static str> {
    Ok("ok")
}

/// Which kind of build is running. Mirrors `AppInfo.channel` in platform.ts.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BuildChannel {
    /// A debug build, such as `tauri dev`.
    Dev,
    /// A release build.
    Release,
}

/// Payload of `app_info`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfoPayload {
    /// Version from `tauri.conf.json`.
    pub version: String,
    pub channel: BuildChannel,
}

/// Version and build channel, read once by the UI at startup.
#[tauri::command]
fn app_info(app: AppHandle) -> CommandResult<AppInfoPayload> {
    Ok(AppInfoPayload {
        version: app.package_info().version.to_string(),
        channel: if cfg!(debug_assertions) {
            BuildChannel::Dev
        } else {
            BuildChannel::Release
        },
    })
}

/// A CPU architecture, as `platform.ts` spells it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum CpuArchitecture {
    #[serde(rename = "arm64")]
    Arm64,
    #[serde(rename = "x86_64")]
    X86_64,
}

/// Payload of `system_info`. Mirrors `SystemInfo` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoPayload {
    /// The macOS version, for example "15.4.1".
    pub os_version: String,
    /// The CPU of the Mac. Under Rosetta this is still arm64 on Apple silicon.
    pub machine_arch: CpuArchitecture,
    /// The CPU this build was compiled for.
    pub build_arch: CpuArchitecture,
}

/// The macOS version from `sw_vers -productVersion`.
fn read_os_version() -> CommandResult<String> {
    let version = command_stdout("/usr/bin/sw_vers", &["-productVersion"])?;
    let looks_like_a_version = version
        .split('.')
        .next()
        .is_some_and(|major| !major.is_empty() && major.chars().all(|c| c.is_ascii_digit()));
    if !looks_like_a_version {
        return Err(CommandError::Failed {
            code: "system_info_failed",
            message: format!("sw_vers returned an unexpected version: {version:?}."),
        });
    }
    Ok(version)
}

/// Runs a program and returns its trimmed stdout. A non-zero exit is an error.
fn command_stdout(program: &str, args: &[&str]) -> CommandResult<String> {
    let output = std::process::Command::new(program)
        .args(args)
        .output()
        .map_err(CommandError::Io)?;
    if !output.status.success() {
        return Err(CommandError::Failed {
            code: "system_info_failed",
            message: format!(
                "{program} failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ),
        });
    }
    let text = String::from_utf8(output.stdout).map_err(|_| CommandError::Failed {
        code: "system_info_failed",
        message: format!("{program} wrote text that is not UTF-8."),
    })?;
    Ok(text.trim().to_string())
}

/// One `sysctl` key, or `None` when the key does not exist (Intel has no `hw.optional.arm64`).
fn read_sysctl(name: &str) -> CommandResult<Option<String>> {
    let output = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", name])
        .output()
        .map_err(CommandError::Io)?;
    if !output.status.success() {
        return Ok(None);
    }
    let text = String::from_utf8(output.stdout).map_err(|_| CommandError::Failed {
        code: "system_info_failed",
        message: format!("sysctl {name} wrote text that is not UTF-8."),
    })?;
    Ok(Some(text.trim().to_string()))
}

/// The Mac's own CPU. `hw.optional.arm64` is 1 on Apple silicon even under Rosetta, so the
/// machine reports arm64 while an x86_64 build can still be running on it.
fn machine_architecture() -> CommandResult<CpuArchitecture> {
    let arm64_supported = read_sysctl("hw.optional.arm64")?;
    let machine = read_sysctl("hw.machine")?;
    parse_machine_arch(arm64_supported.as_deref(), machine.as_deref()).ok_or_else(|| {
        CommandError::Failed {
            code: "system_info_failed",
            message: format!("The CPU architecture is not known; hw.machine was {machine:?}."),
        }
    })
}

/// Reads the two `sysctl` answers. Kept separate so the Rosetta case is tested without a Mac.
fn parse_machine_arch(
    arm64_supported: Option<&str>,
    machine: Option<&str>,
) -> Option<CpuArchitecture> {
    if arm64_supported.map(str::trim) == Some("1") {
        return Some(CpuArchitecture::Arm64);
    }
    match machine.map(str::trim) {
        Some("arm64") | Some("aarch64") => Some(CpuArchitecture::Arm64),
        Some("x86_64") => Some(CpuArchitecture::X86_64),
        _ => None,
    }
}

/// The CPU this build was compiled for. An x86_64 build can run on an arm64 Mac under Rosetta.
fn build_architecture() -> CpuArchitecture {
    if cfg!(target_arch = "aarch64") {
        CpuArchitecture::Arm64
    } else {
        CpuArchitecture::X86_64
    }
}

/// The macOS version, the Mac's CPU and this build's CPU, read by the UI when it needs them.
#[tauri::command]
fn system_info() -> CommandResult<SystemInfoPayload> {
    Ok(SystemInfoPayload {
        os_version: read_os_version()?,
        machine_arch: machine_architecture()?,
        build_arch: build_architecture(),
    })
}

/// Quits the app now. The UI calls this after it handled `app://quit-requested` (confirmed with
/// the user and flushed its work), so nothing here asks again. The sidecar is stopped first, so it
/// cannot outlive the app.
#[tauri::command]
async fn app_quit(app: AppHandle, state: State<'_, sidecar::SidecarState>) -> CommandResult<()> {
    sidecar::shutdown(&state).await?;
    app.exit(0);
    Ok(())
}

/// Tells the menu the UI listens for quit requests. A quit asked for earlier is delivered now.
#[tauri::command]
async fn set_quit_handler_ready(
    app: AppHandle,
    state: State<'_, menu::MenuState>,
) -> CommandResult<()> {
    menu::mark_quit_handler_ready(&app, state.inner())
}

/// Opens or closes the main window's web inspector. The `devtools` feature keeps this available in
/// release builds too.
#[tauri::command]
fn window_toggle_inspector(app: AppHandle) -> CommandResult<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Err(CommandError::Failed {
            code: "window_missing",
            message: "The main window is not open.".to_string(),
        });
    };
    if window.is_devtools_open() {
        window.close_devtools();
    } else {
        window.open_devtools();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = raise_file_limit() {
        eprintln!("could not raise the open-file limit: {error}");
    }
    let shell_state = prepare_shell_state();
    tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations(db::DB_URL, db::migrations())
                .build(),
        )
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .manage(shell_state)
        .manage(pty::PtyState::default())
        .manage(sidecar::SidecarState::default())
        .manage(notifications::NotificationState::default())
        .manage(speech::SpeechState::default())
        .manage(updater::UpdaterState::default())
        .manage(resource_usage::ResourceUsageState::default())
        .manage(menu::MenuState::default())
        .manage(logger::LoggerState::default())
        .manage(http::HttpState::default())
        .menu(|app| {
            let state = app.state::<menu::MenuState>();
            menu::build_menu(app, state.inner())
        })
        .on_menu_event(|app, event| {
            let item_id = event.id().0.as_str();
            if let Err(error) = menu::handle_menu_event(app, item_id) {
                eprintln!("could not route the menu item {item_id}: {error}");
            }
        })
        .manage(binaries::BinariesState::default())
        .manage(binaries::ProgramsState::default())
        .setup(|app| {
            if let Err(error) = guard_single_instance(app.handle()) {
                eprintln!("could not check for another running copy: {error}");
            }
            install_panic_hook(app.handle())?;
            let logger_state = app.state::<logger::LoggerState>();
            logger::start_writer(app.handle(), &logger_state)?;
            navigation::install_guard(app.handle())?;
            deep_link::register(app.handle())?;
            shell::start_background_capture(app.handle().clone());
            binaries::start_verification(app.handle().clone());
            binaries::prepare_on_launch(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health,
            app_info,
            system_info,
            permissions::full_disk_access_check,
            permissions::full_disk_access_open_settings,
            app_quit,
            set_quit_handler_ready,
            window_toggle_inspector,
            db::db_version_check,
            logger::log_write,
            logger::log_set_level,
            logger::logs_export,
            resource_usage::resource_usage,
            shell::shell_run,
            shell::shell_start,
            shell::shell_cancel,
            shell::shell_login_env,
            files::fs_read_text,
            files::fs_write_text_atomic,
            files::fs_stat,
            files::fs_mkdirp,
            files::fs_read_dir,
            files::fs_trash,
            files::fs_paths,
            http::http_fetch,
            http::http_download,
            http::http_cancel,
            file_search::search_list_tree,
            file_search::search_fuzzy,
            file_search::search_grep,
            file_search::search_list_artifacts,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            pty::pty_ack,
            pty::pty_screen_text,
            pty::pty_screen_snapshot,
            terminal_history::pty_load_history,
            sidecar::sidecar_ensure_started,
            sidecar::sidecar_send,
            sidecar::sidecar_log_path,
            keychain::keychain_get,
            keychain::keychain_set,
            keychain::keychain_delete,
            notifications::notify,
            notifications::set_dock_badge,
            notifications::notification_take_pending,
            open_with::reveal_in_finder,
            open_with::open_with,
            open_with::installed_apps,
            speech::speech_available,
            speech::speech_start,
            speech::speech_stop,
            speech::speech_cancel,
            updater::updater_check,
            updater::updater_install,
            updater::updater_relaunch,
            attachments::attachment_materialize,
            attachments::image_resize,
            menu::menu_set_shortcuts,
            binaries::programs_verification_errors,
            binaries::programs_state,
            binaries::program_install,
            binaries::program_redownload,
            binaries::program_remove,
            binaries::programs_prefetch,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Conducted")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Agent program downloads stop, also those waiting to retry (PLAT-28).
                app.state::<binaries::ProgramsState>().cancel_all();
                // Terminals run in their own process groups, so they would outlive the app.
                let terminal_failures = terminate_terminals(&app.state::<pty::PtyState>());
                if !terminal_failures.is_empty() {
                    eprintln!(
                        "could not end every terminal on exit: {}",
                        terminal_failures.join(", ")
                    );
                }
                // Commands started with `shell_start` run in their own process groups, so they
                // would outlive the app. End them before the sidecar.
                shell::terminate_all(
                    &app.state::<shell::ShellState>().running,
                    std::time::Duration::from_millis(shell::KILL_GRACE_MS),
                );
                let state = app.state::<sidecar::SidecarState>();
                // The app is closing, so only stderr is left to report a failed stop.
                if let Err(error) = tauri::async_runtime::block_on(sidecar::shutdown(&state)) {
                    eprintln!("could not stop the sidecar on exit: {error}");
                }
            }
        });
}

#[cfg(test)]
mod system_info_tests {
    use super::*;

    #[test]
    fn plat_32_reports_the_running_macos_version() {
        let info = system_info().expect("system_info should read the Mac's version");
        let expected = command_stdout("/usr/bin/sw_vers", &["-productVersion"])
            .expect("sw_vers should report the version");
        assert_eq!(info.os_version, expected);
        assert!(
            info.os_version.split('.').count() >= 2,
            "os_version was {:?}",
            info.os_version
        );
    }

    #[test]
    fn plat_32_reports_the_cpu_this_build_was_made_for() {
        let expected = if cfg!(target_arch = "aarch64") {
            CpuArchitecture::Arm64
        } else {
            CpuArchitecture::X86_64
        };
        let info = system_info().expect("system_info should read the build CPU");
        assert_eq!(info.build_arch, expected);

        // The compiler flag above is the same source the code reads. The test executable's own
        // header is a second source: it names the CPU this very build was made for.
        let executable = std::env::current_exe().expect("the test executable has a path");
        let header = command_stdout("/usr/bin/file", &["-b", &executable.to_string_lossy()])
            .expect("file describes the test executable");
        let from_header = if header.contains("arm64") {
            CpuArchitecture::Arm64
        } else if header.contains("x86_64") {
            CpuArchitecture::X86_64
        } else {
            panic!("file did not name a supported CPU for the test executable: {header}");
        };
        assert_eq!(info.build_arch, from_header, "file said: {header}");
    }

    #[test]
    fn plat_32_reports_the_cpu_of_the_mac() {
        let info = system_info().expect("system_info should read the Mac's CPU");
        let arm64_supported =
            read_sysctl("hw.optional.arm64").expect("sysctl should answer or be absent");
        let machine = read_sysctl("hw.machine").expect("sysctl should report hw.machine");
        let expected = parse_machine_arch(arm64_supported.as_deref(), machine.as_deref())
            .expect("the Mac's CPU should be one of the two supported architectures");
        assert_eq!(info.machine_arch, expected);
    }

    #[test]
    fn plat_32_an_arm64_mac_running_an_intel_build_reports_arm64_machine() {
        assert_eq!(
            parse_machine_arch(Some("1"), Some("x86_64")),
            Some(CpuArchitecture::Arm64)
        );
    }

    #[test]
    fn plat_32_an_intel_mac_reports_x86_64_machine() {
        assert_eq!(
            parse_machine_arch(None, Some("x86_64")),
            Some(CpuArchitecture::X86_64)
        );
        assert_eq!(
            parse_machine_arch(Some("0"), Some("x86_64")),
            Some(CpuArchitecture::X86_64)
        );
    }

    #[test]
    fn plat_32_an_unknown_cpu_is_an_error_not_a_default() {
        assert_eq!(parse_machine_arch(None, Some("sparc")), None);
        assert_eq!(parse_machine_arch(None, None), None);
    }

    /// The command names listed in `lib.rs`'s `tauri::generate_handler!` block.
    fn registered_command_names(lib_source: &str) -> std::collections::HashSet<String> {
        let block = lib_source
            .split("tauri::generate_handler![")
            .nth(1)
            .and_then(|rest| rest.split("])").next())
            .expect("lib.rs registers its commands in tauri::generate_handler!");
        block
            .split(|character: char| {
                character == ',' || character.is_whitespace() || character == '#'
            })
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .map(|name| name.rsplit("::").next().unwrap_or(name).to_string())
            .collect()
    }

    /// The function names that carry the `tauri::command` attribute in one source file.
    fn command_function_names(source: &str) -> Vec<String> {
        let marker = format!("#[tauri::{}]", "command");
        let mut names = Vec::new();
        let mut rest = source;
        while let Some(index) = rest.find(&marker) {
            rest = &rest[index + marker.len()..];
            let Some(function_index) = rest.find("fn ") else {
                break;
            };
            let after = &rest[function_index + 3..];
            let name: String = after
                .chars()
                .take_while(|character| character.is_alphanumeric() || *character == '_')
                .collect();
            if !name.is_empty() {
                names.push(name);
            }
            rest = after;
        }
        names
    }

    #[test]
    fn plat_34_every_tauri_command_is_registered() {
        let source_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let lib_source = std::fs::read_to_string(source_dir.join("lib.rs")).expect("read lib.rs");
        let registered = registered_command_names(&lib_source);
        assert!(!registered.is_empty(), "the handler list was found");

        let mut missing = Vec::new();
        for entry in std::fs::read_dir(&source_dir).expect("list the crate's source files") {
            let path = entry.expect("read a source entry").path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("rs") {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("read a source file");
            for name in command_function_names(&source) {
                if !registered.contains(&name) {
                    missing.push(format!(
                        "{name} ({})",
                        path.file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_default()
                    ));
                }
            }
        }
        missing.sort();
        assert!(
            missing.is_empty(),
            "these commands never reach generate_handler!: {missing:?}"
        );
    }

    #[test]
    fn plat_34_the_registration_guard_flags_a_forgotten_command() {
        let marker = format!("#[tauri::{}]", "command");
        let source = format!("{marker}\npub fn listed() {{}}\n{marker}\npub fn forgotten() {{}}");
        let registered = registered_command_names("tauri::generate_handler![listed])");

        let missing: Vec<String> = command_function_names(&source)
            .into_iter()
            .filter(|name| !registered.contains(name))
            .collect();

        assert_eq!(missing, vec!["forgotten".to_string()]);
    }
}

#[cfg(test)]
mod startup_tests {
    use super::*;
    use std::collections::HashMap;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    fn unique_temp_dir() -> std::path::PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!("conducted-plat-27-{}-{nanos}", std::process::id()))
    }

    #[test]
    fn plat_27_raise_file_limit_returns_a_soft_limit_at_least_as_high() {
        let (before, _) = read_file_limit().expect("the open-file limit can be read");
        let after = raise_file_limit().expect("the open-file limit is raised");
        assert!(
            after >= before,
            "the soft limit went from {before} to {after}"
        );
    }

    #[test]
    fn plat_27_a_low_soft_limit_rises_to_the_wanted_limit() {
        assert_eq!(next_soft_limit(256, 65_536, 10_240), Some(10_240));
    }

    #[test]
    fn plat_27_a_soft_limit_already_above_the_wanted_one_is_left_alone() {
        assert_eq!(next_soft_limit(10_240, 65_536, 10_240), None);
        assert_eq!(next_soft_limit(1_048_576, u64::MAX, 10_240), None);
    }

    #[test]
    fn plat_27_the_hard_limit_caps_the_raise() {
        assert_eq!(next_soft_limit(256, 4_096, 10_240), Some(4_096));
        assert_eq!(next_soft_limit(4_096, 4_096, 10_240), None);
    }

    #[test]
    fn plat_27_the_login_path_is_applied_before_the_runtime_starts() {
        let login = shell::LoginEnv {
            shell: "/bin/zsh".to_string(),
            path: "/opt/homebrew/bin:/usr/bin".to_string(),
            vars: HashMap::new(),
        };
        let mut applied = None;
        assert!(apply_login_path(&login, |path| {
            applied = Some(path.to_string());
        }));
        assert_eq!(applied.as_deref(), Some("/opt/homebrew/bin:/usr/bin"));

        let empty = shell::LoginEnv {
            path: String::new(),
            ..login
        };
        assert!(!apply_login_path(&empty, |_| panic!(
            "an empty PATH must not replace the process one"
        )));
    }

    #[test]
    fn plat_27_the_startup_capture_is_reused_by_later_callers() {
        let login = shell::LoginEnv {
            shell: "/bin/zsh".to_string(),
            path: "/usr/local/bin:/usr/bin".to_string(),
            vars: HashMap::new(),
        };
        let expected = login.path.clone();
        let state = shell_state_with_login(login);
        let cached = state.login_env.blocking_lock();
        assert_eq!(
            cached.as_ref().map(|login| login.path.as_str()),
            Some(expected.as_str())
        );
    }

    #[test]
    fn plat_27_a_panic_record_names_the_message_place_and_backtrace() {
        let message = panic_log_message("boom", Some(("src/lib.rs", 12, 3)), "0: frame");
        assert!(message.contains("src/lib.rs:12:3"), "was {message:?}");
        assert!(message.contains("boom"), "was {message:?}");
        assert!(message.contains("backtrace:"), "was {message:?}");
        assert!(message.contains("0: frame"), "was {message:?}");

        let without_place = panic_log_message("boom", None, "0: frame");
        assert!(
            without_place.contains("an unknown location"),
            "was {without_place:?}"
        );
    }

    #[test]
    fn plat_27_a_panic_message_reaches_the_log_queue() {
        let state = logger::LoggerState::default();
        let (sender, receiver) = std::sync::mpsc::sync_channel(4);
        *state.sender.lock().expect("the sender lock is usable") = Some(sender);

        assert!(queue_rust_log(
            &state,
            "error",
            "panic at src/lib.rs:1:1: boom"
        ));

        let record = receiver.recv().expect("the panic record is queued");
        assert_eq!(record.level, "error");
        assert!(record.message.contains("boom"), "was {:?}", record.message);
    }

    #[test]
    fn plat_27_a_panic_before_the_log_starts_is_not_queued() {
        let state = logger::LoggerState::default();
        assert!(!queue_rust_log(
            &state,
            "error",
            "panic before the log is ready"
        ));
    }

    #[test]
    fn plat_27_a_second_copy_cannot_take_the_instance_lock() {
        let dir = unique_temp_dir();
        let path = dir.join("conducted.instance.lock");
        let first = try_instance_lock(&path)
            .expect("the lock can be opened")
            .expect("the first copy takes the lock");
        let second = try_instance_lock(&path).expect("the second lock call runs");
        assert!(second.is_none(), "a second copy must not take the lock");

        drop(first);
        let third = try_instance_lock(&path)
            .expect("the lock can be taken again")
            .expect("the lock is free after the first copy ends");
        drop(third);

        fs::remove_file(&path).expect("the lock file is removed");
        fs::remove_dir(&dir).expect("the lock folder is removed");
    }

    #[test]
    fn plat_27_closing_the_app_ends_every_terminal() {
        let state = pty::PtyState::default();
        let request = pty::PtySpawnRequest {
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            cols: 80,
            rows: 24,
            command: Some(pty::PtyCommand {
                program: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), "sleep 30".to_string()],
            }),
            env: None,
        };
        let mut spawned = pty::spawn_terminal(
            &request,
            "/bin/sh",
            &HashMap::new(),
            "plat-27-terminal".to_string(),
        )
        .expect("a terminal starts");
        let id = spawned.session.id.clone();
        state
            .sessions
            .lock()
            .expect("the session table is usable")
            .insert(id, std::sync::Arc::clone(&spawned.session));

        let failures = terminate_terminals(&state);
        assert!(failures.is_empty(), "failed to end: {failures:?}");

        let deadline = Instant::now() + Duration::from_secs(5);
        let status = loop {
            if let Some(status) = spawned
                .child
                .try_wait()
                .expect("the terminal can be polled")
            {
                break status;
            }
            assert!(
                Instant::now() < deadline,
                "the terminal still runs after the app closes"
            );
            std::thread::sleep(Duration::from_millis(10));
        };
        assert!(
            !status.success(),
            "a terminal ended by the close must not succeed"
        );
    }
}
