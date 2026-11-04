//! The Rust shell. A thin toolbox for the web UI: windows, terminals, shell commands, files,
//! the sidecar process and macOS features. Product logic lives in TypeScript.
//! Research: docs/research/conductor/native-and-sidecar-map.md section A.

pub mod db;
pub mod error;

use error::CommandResult;

/// Liveness check used by the UI at startup and by the scaffold's smoke test.
#[tauri::command]
fn health() -> CommandResult<&'static str> {
    Ok("ok")
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
        .invoke_handler(tauri::generate_handler![health])
        .run(tauri::generate_context!())
        .expect("error while running Conducted");
}
