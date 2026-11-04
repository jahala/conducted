//! @feature PLAT-18 App log files and log export
//!
//! Owns: writing the UI's and the shell's log lines to files on disk, keeping those files within
//! a size and age limit, and bundling them for a bug report.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A7 (app-logger: an in-memory ring
//! buffer of UI, Rust and sidecar logs with optional disk persistence and export;
//! `submit_app_logs`, `export_app_logs`) and D1 (`logs/` in the data dir). ui-map.md describes the
//! diagnostics page that offers the export.
//!
//! Must handle:
//! - `log_write` is called often and from the UI thread's point of view must be instant. It puts
//!   the record on a channel and returns. One writer thread owns the file.
//! - Records are one JSON object per line: time (ms since epoch), level, source (`ui`), message,
//!   optional data. Unknown levels fail with `log_bad_level`.
//! - Secrets must not reach disk. Any data key that matches token, secret, password, key or
//!   authorization (case-insensitive) is replaced by `"[redacted]"` before writing.
//! - A single message is cut at `MAX_MESSAGE_BYTES`, data at `MAX_DATA_BYTES`, with a marker.
//! - Files: `<app data>/logs/app-YYYY-MM-DD.ndjson`, mode 0600. A day's file rolls over at
//!   `MAX_FILE_BYTES`. Files older than `KEEP_DAYS` days are removed at start and at rollover.
//! - If the writer cannot write (disk full), it drops records and counts them. The next
//!   successful write adds one `logs dropped: N` record. The app keeps running.
//! - `logs_export` collects the app logs of the kept days plus the newest sidecar log into one
//!   file in `<app data>/exports/`, and returns its path. Exports older than 7 days are removed.
//!   The export runs on the blocking pool and does not stop the writer.
//! - The writer flushes on app exit so the last lines before a crash are on disk.
//!
//! Our design choice: Rust writes the files directly. Conductor runs a separate logger process
//! with an in-memory buffer and an HTTP port; a local-only app does not need either. The sidecar
//! keeps its own log (sidecar.rs), and the export includes it.
//! Our design choice: no remote export of any kind.
//!
//! Test first: a record with `{ "apiToken": "abc" }` in its data is written with
//! `"apiToken":"[redacted]"`, and `logs_export` returns a file that contains that record.

use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::error::CommandResult;
use crate::not_implemented;

/// Days of log files kept.
pub const KEEP_DAYS: u64 = 14;
/// A day's file rolls over at this size.
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// Longest message kept in one record.
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;
/// Largest data value kept in one record.
pub const MAX_DATA_BYTES: usize = 64 * 1024;

/// One log record from the UI. Mirrors the arguments of `AppInfo.writeLog` in platform.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRecord {
    /// `error`, `warn`, `info` or `debug`.
    pub level: String,
    pub message: String,
    /// Any JSON value the caller wants to keep with the message.
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

/// Shared state, registered once with `.manage(LoggerState::default())`.
pub struct LoggerState {
    /// Queue into the writer thread. Records sent when the queue is full are dropped and counted.
    pub sender: std::sync::Mutex<Option<std::sync::mpsc::SyncSender<LogRecord>>>,
}

impl Default for LoggerState {
    fn default() -> Self {
        Self {
            sender: std::sync::Mutex::new(None),
        }
    }
}

/// Starts the writer thread and removes expired files. Called once from `run()`.
pub fn start_writer(_app: &AppHandle, _state: &LoggerState) -> CommandResult<()> {
    not_implemented!("PLAT-18")
}

/// Queues one record for writing.
#[tauri::command]
#[allow(unused_variables)]
pub async fn log_write(state: State<'_, LoggerState>, record: LogRecord) -> CommandResult<()> {
    not_implemented!("PLAT-18")
}

/// Bundles the logs into one file and returns its path.
#[tauri::command]
#[allow(unused_variables)]
pub async fn logs_export(app: AppHandle) -> CommandResult<String> {
    not_implemented!("PLAT-18")
}
