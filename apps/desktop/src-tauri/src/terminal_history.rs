//! @feature PLAT-08 Saved terminal scrollback
//!
//! Owns: writing a terminal's output to disk when it ends, reading it back after a restart, and
//! keeping the folder within its size and age limits.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`terminal_history_storage.rs`:
//! `pty_load_terminal_history`, `pty_persist_terminal_history`, the 50 MiB limit with eviction of
//! the oldest entries) and D1 (`local-storage.entries/terminal-history`, directory mode 0700).
//!
//! Must handle:
//! - Files live in `<app data>/terminal-history/<terminal id>.bin`. The folder has mode 0700 and
//!   each file mode 0600.
//! - A terminal that never received user input is not saved: a finished setup script has its log
//!   file already. The recorder tracks `has_received_input`.
//! - Each file holds at most `MAX_ENTRY_BYTES`, the newest bytes. Cutting must not start in the
//!   middle of an escape sequence: drop everything up to the first newline.
//! - Writes are atomic (temp file plus rename), so a crash never leaves a half file.
//! - Eviction runs at startup and after each save. It removes entries older than
//!   `MAX_AGE_DAYS`, then the oldest entries until the folder is under `MAX_TOTAL_BYTES`.
//! - Loading a missing file fails with `history_not_found`. A bad id (path separators, `..`)
//!   fails with `history_bad_id`, so an id can never point outside the folder.
//! - The terminal id is the PTY id from pty.rs.
//!
//! Our design choice: files are plain, not encrypted. Terminal output can hold secrets, but the
//! data folder is private to the user and an encryption key in the Keychain would add a prompt and
//! a failure mode. Revisit if shared machines matter. The 14-day age limit matches the lifetime
//! of the `terminals` table rows in migration 0001.
//!
//! Test first: saving 60 MiB of entries over three terminals leaves the folder at or under
//! 50 MiB, and the oldest terminal is the one that is gone.

use std::path::{Path, PathBuf};

use tauri::AppHandle;

use crate::error::CommandResult;
use crate::not_implemented;

/// Folder name under the app data folder.
pub const HISTORY_DIR: &str = "terminal-history";
/// Most bytes kept for one terminal.
pub const MAX_ENTRY_BYTES: usize = 5 * 1024 * 1024;
/// Most bytes kept in the whole folder.
pub const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;
/// Entries older than this are removed.
pub const MAX_AGE_DAYS: u64 = 14;

/// Collects the output of one terminal while it runs.
#[allow(dead_code)] // The fields are read once `push_output` and `save` exist.
pub struct HistoryRecorder {
    terminal_id: String,
    bytes: Vec<u8>,
    has_received_input: bool,
}

impl HistoryRecorder {
    /// An empty recorder for the given terminal id.
    pub fn new(terminal_id: String) -> Self {
        Self {
            terminal_id,
            bytes: Vec::new(),
            has_received_input: false,
        }
    }

    /// Appends output, dropping the oldest bytes past `MAX_ENTRY_BYTES`.
    pub fn push_output(&mut self, _bytes: &[u8]) -> CommandResult<()> {
        not_implemented!("PLAT-08")
    }

    /// Notes that the user typed into the terminal.
    pub fn mark_input(&mut self) {
        self.has_received_input = true;
    }

    /// Writes the entry to `dir` unless no input was received, then evicts old entries.
    pub fn save(&self, _dir: &Path) -> CommandResult<()> {
        not_implemented!("PLAT-08")
    }
}

/// `<app data>/terminal-history`, created with mode 0700 when missing.
pub fn history_dir(_app: &AppHandle) -> CommandResult<PathBuf> {
    not_implemented!("PLAT-08")
}

/// Reads one saved entry from `dir`.
pub fn load_entry(_dir: &Path, _terminal_id: &str) -> CommandResult<Vec<u8>> {
    not_implemented!("PLAT-08")
}

/// Removes entries past the age and size limits. `now_ms` is passed in so tests control time.
pub fn evict(_dir: &Path, _now_ms: i64) -> CommandResult<()> {
    not_implemented!("PLAT-08")
}

/// Returns the saved scrollback of an ended terminal as base64.
#[tauri::command]
#[allow(unused_variables)]
pub async fn pty_load_history(app: AppHandle, terminal_id: String) -> CommandResult<String> {
    not_implemented!("PLAT-08")
}
