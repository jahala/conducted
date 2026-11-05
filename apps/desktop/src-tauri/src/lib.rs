//! The Rust shell. A thin toolbox for the web UI: windows, terminals, shell commands, files,
//! the sidecar process and macOS features. Product logic lives in TypeScript.
//! Research: docs/research/conductor/native-and-sidecar-map.md section A.
//! Command names and events: docs/plans/tauri-commands.md. Each module registers its commands
//! here in `generate_handler!` and its shared state with `.manage(...)`. State is created once
//! and handed to commands through `tauri::State`, so no module keeps global variables.
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

use error::CommandResult;
use serde::Serialize;
use tauri::AppHandle;

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

/// Quits the app now. The UI calls this after it handled `app://quit-requested` (confirmed with
/// the user and flushed its work), so nothing here asks again.
#[tauri::command]
fn app_quit(app: AppHandle) -> CommandResult<()> {
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
            shell::start_background_capture(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health,
            app_info,
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
        .run(tauri::generate_context!())
        .expect("error while running Conducted");
}
