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
//! Owns: the three things `run` does before the window opens: raise the open-file limit, send Rust
//! panics to the app log, and allow one running copy of the app.
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`lib.rs` raises the
//! file-descriptor limit and installs a panic hook) and A5 ("Failed to raise file descriptor
//! limit").
//! Must handle: a limit that cannot be raised (a logged warning, the app still starts); a limit
//! already above the wanted one (left alone); a panic on any thread (message, location and a
//! backtrace go to the log before the process ends; with `panic = "abort"` in release builds the
//! hook is the only record); a second launch (the first window comes to the front and the second
//! process exits, which needs `tauri-plugin-single-instance` in Cargo.toml and in `run`); a panic
//! while the log is not ready (printed to stderr).
//! Our design choice: the research shows no single-instance guard in Conductor. We add one because
//! two copies would share one database and one sidecar socket folder.
//! Test first: `raise_file_limit` returns a soft limit at least as high as the one before the call.

pub mod attachments;
pub mod binaries;
pub mod db;
pub mod deep_link;
pub mod error;
pub mod file_search;
pub mod files;
pub mod keychain;
pub mod logger;
pub mod menu;
pub mod navigation;
pub mod notifications;
pub mod open_with;
mod process_group;
pub mod pty;
pub mod resource_usage;
pub mod shell;
pub mod sidecar;
pub mod speech;
pub mod terminal_history;
pub mod updater;

use error::{CommandError, CommandResult};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// Raises the soft limit of open files towards the hard limit. Returns the new soft limit.
pub fn raise_file_limit() -> CommandResult<u64> {
    not_implemented!("PLAT-27")
}

/// Sends panics to the app log (`logger.rs`) instead of only to stderr.
pub fn install_panic_hook(_app: &AppHandle) -> CommandResult<()> {
    not_implemented!("PLAT-27")
}

/// Makes a second launch focus the first window and exit.
pub fn guard_single_instance(_app: &AppHandle) -> CommandResult<()> {
    not_implemented!("PLAT-27")
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .manage(shell::ShellState::default())
        .manage(pty::PtyState::default())
        .manage(sidecar::SidecarState::default())
        .manage(notifications::NotificationState::default())
        .manage(speech::SpeechState::default())
        .manage(updater::UpdaterState::default())
        .manage(resource_usage::ResourceUsageState::default())
        .manage(menu::MenuState::default())
        .manage(logger::LoggerState::default())
        .setup(|app| {
            navigation::install_guard(app.handle())?;
            shell::start_background_capture(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health,
            app_info,
            system_info,
            app_quit,
            db::db_version_check,
            logger::log_write,
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
            file_search::search_list_tree,
            file_search::search_fuzzy,
            file_search::search_grep,
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building Conducted")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
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
}
