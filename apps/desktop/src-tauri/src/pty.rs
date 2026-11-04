//! @feature PLAT-07 Terminals over PTY with flow control and screen text
//!
//! Owns: starting shells and scripts on pseudo-terminals, moving bytes between them and the UI
//! with back-pressure, keeping a headless copy of each screen, and ending them cleanly.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`pty_spawn`, `pty_write`,
//! `pty_resize`, `pty_kill`, `pty_ack_bytes`, `pty_screen_text`; portable-pty plus an alacritty
//! screen model) and A5 (zsh integration is written by the UI, which passes `ZDOTDIR` in `env`).
//! services-map.md 5A.4 (output is base64 with a byte length, the UI acks in batches of 5000
//! bytes, Rust pauses reading when too many bytes are unacknowledged).
//!
//! Must handle:
//! - Output travels over the `Channel` passed to `pty_spawn` as base64 chunks with their raw
//!   byte length, never as JSON number arrays.
//! - Flow control: the reader thread counts bytes sent and stops reading at `HIGH_WATER_BYTES`
//!   unacknowledged. `pty_ack` lowers the count and wakes the reader below `LOW_WATER_BYTES`.
//!   A UI that never acks must not grow memory without bound: the kernel buffer fills and the
//!   child blocks, which is the intended back-pressure.
//! - One reader thread per terminal. It owns a read handle. Writes and resizes go through
//!   separate handles, each behind its own mutex, so a slow write never blocks a resize.
//! - Output is fed to the screen mirror in the reader thread, before it is sent, so
//!   `pty_screen_text` never shows less than the UI has seen.
//! - When the child exits, the reader drains what is left, the exit code is collected, history is
//!   saved (terminal_history.rs), the session leaves the table, and `pty://exit` fires once.
//! - `pty_kill` on a terminal that already ended succeeds. A kill also reaches the foreground
//!   process group, so `npm run dev` children stop with the shell.
//! - `pty_spawn` fails with `pty_bad_cwd` when the folder is missing, before any process exists.
//! - A resize to zero columns or rows is rejected with `pty_bad_size`.
//! - Closing the app kills every terminal. A panic in one reader thread must not poison the table
//!   for the others: lock calls recover from poisoning.
//! - Sessions are looked up by id in a shared table behind a mutex that is never held while
//!   reading or writing a terminal.
//!
//! Our design choice: ids are made in Rust and are unique across restarts (start time plus a
//! counter), so the history file name can be the id. The UI stores the id in its `terminals` row.
//! Our design choice: history is saved by Rust when the child exits, so the UI has no persist call.
//!
//! Test first: spawn `printf` of 3 MiB with the UI never acking; the reader pauses near
//! `HIGH_WATER_BYTES`; acking everything lets it finish and `pty://exit` arrives once.

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Condvar, Mutex, PoisonError};

use alacritty_terminal::event::VoidListener;
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{Config as TermConfig, Term};
use alacritty_terminal::vte::ansi::Processor;
use portable_pty::{ChildKiller, CommandBuilder, MasterPty};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

use crate::error::{CommandError, CommandResult};
use crate::not_implemented;
use crate::terminal_history::HistoryRecorder;

/// Event fired once when a terminal's process ends.
pub const EVENT_EXIT: &str = "pty://exit";
/// Unacknowledged bytes at which the reader thread stops reading.
pub const HIGH_WATER_BYTES: usize = 1024 * 1024;
/// Unacknowledged bytes below which a paused reader continues.
pub const LOW_WATER_BYTES: usize = 256 * 1024;
/// Size of one read from the terminal.
pub const READ_CHUNK_BYTES: usize = 64 * 1024;
/// Lines the screen mirror keeps above the visible screen.
pub const SCROLLBACK_LINES: usize = 10_000;

/// A program to run instead of the login shell. Mirrors `PtySpawn.command` in platform.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyCommand {
    pub program: String,
    pub args: Vec<String>,
}

/// Mirrors `PtySpawn` in platform.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawnRequest {
    /// Working directory. Must exist.
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    /// When absent, an interactive login shell starts.
    #[serde(default)]
    pub command: Option<PtyCommand>,
    /// Extra variables on top of the captured login-shell environment. `TERM` and `COLORTERM`
    /// default to `xterm-256color` and `truecolor` unless set here.
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
}

/// Returned by `pty_spawn`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawned {
    /// Id for every later call and for `pty://exit`. Also the history file name.
    pub id: String,
    /// Process id of the child, when the platform reports one.
    pub pid: Option<u32>,
}

/// One message on the output channel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyChunk {
    /// Raw terminal bytes, base64 encoded.
    pub data: String,
    /// Number of raw bytes. The UI sends this total back through `pty_ack`.
    pub byte_length: usize,
}

/// Payload of `pty://exit`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyExit {
    pub id: String,
    /// Exit code, or `None` when a signal ended the process.
    pub exit_code: Option<i32>,
    /// Signal number when a signal ended the process.
    pub signal: Option<i32>,
}

/// Back-pressure counter shared by the reader thread and `pty_ack`.
pub struct FlowControl {
    /// Bytes sent to the UI and not yet acknowledged.
    pub unacked: Mutex<usize>,
    /// Signalled when `unacked` drops below `LOW_WATER_BYTES` or the terminal is closed.
    pub below_low_water: Condvar,
}

impl FlowControl {
    /// Adds bytes just sent to the UI.
    pub fn record_sent(&self, _bytes: usize) -> CommandResult<()> {
        not_implemented!("PLAT-07")
    }

    /// Blocks the reader thread while `unacked` is at or above `HIGH_WATER_BYTES`.
    pub fn wait_for_room(&self) -> CommandResult<()> {
        not_implemented!("PLAT-07")
    }

    /// Subtracts acknowledged bytes, never going below zero, and wakes the reader when needed.
    pub fn acknowledge(&self, _bytes: usize) -> CommandResult<()> {
        not_implemented!("PLAT-07")
    }
}

/// A headless copy of one terminal screen, so the app can read what a terminal shows
/// (`GetTerminalOutput`) without asking the UI.
#[allow(dead_code)] // The fields are read once `feed` and `text` exist.
pub struct ScreenMirror {
    term: Term<VoidListener>,
    parser: Processor,
}

impl ScreenMirror {
    /// An empty screen of the given size with `SCROLLBACK_LINES` of history.
    pub fn new(cols: u16, rows: u16) -> Self {
        let size = TermSize::new(usize::from(cols), usize::from(rows));
        let config = TermConfig {
            scrolling_history: SCROLLBACK_LINES,
            ..TermConfig::default()
        };
        Self {
            term: Term::new(config, &size, VoidListener),
            parser: Processor::new(),
        }
    }

    /// Feeds terminal output through the escape-sequence parser into the grid.
    pub fn feed(&mut self, _bytes: &[u8]) -> CommandResult<()> {
        not_implemented!("PLAT-07")
    }

    /// Resizes the grid, keeping history.
    pub fn resize(&mut self, _cols: u16, _rows: u16) -> CommandResult<()> {
        not_implemented!("PLAT-07")
    }

    /// Plain text of scrollback plus the visible screen, last `max_lines` lines, trailing blanks
    /// trimmed on each line and at the end.
    pub fn text(&self, _max_lines: usize) -> CommandResult<String> {
        not_implemented!("PLAT-07")
    }
}

/// One running terminal. Every field is safe to touch from several threads.
pub struct PtySession {
    pub id: String,
    pub cwd: String,
    pub pid: Option<u32>,
    /// Resize and size queries.
    pub master: Mutex<Box<dyn MasterPty + Send>>,
    /// Keystrokes and pastes go here. Dropping it sends end-of-file to the child.
    pub writer: Mutex<Box<dyn Write + Send>>,
    /// Ends the child without needing the thread that waits on it.
    pub killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pub mirror: Arc<Mutex<ScreenMirror>>,
    pub flow: Arc<FlowControl>,
    /// Collects output for the saved scrollback.
    pub history: Arc<Mutex<HistoryRecorder>>,
}

/// Shared state, registered once with `.manage(PtyState::default())`.
#[derive(Default)]
pub struct PtyState {
    /// Live terminals by id.
    pub sessions: Mutex<HashMap<String, Arc<PtySession>>>,
    /// Counter that, with the start time, makes ids unique across restarts.
    pub next_serial: AtomicU64,
}

impl PtyState {
    /// Finds a live terminal. Fails with `pty_not_found` for an unknown or ended id.
    pub fn get(&self, id: &str) -> CommandResult<Arc<PtySession>> {
        let sessions = self.sessions.lock().unwrap_or_else(PoisonError::into_inner);
        sessions
            .get(id)
            .cloned()
            .ok_or_else(|| CommandError::Failed {
                code: "pty_not_found",
                message: format!("No terminal with id {id}"),
            })
    }
}

/// Builds the program to run: the request's command, or the login shell with `-l`, with the
/// captured login-shell environment, the request's `env` and the `TERM` defaults applied.
pub fn build_command(
    _request: &PtySpawnRequest,
    _login_shell: &str,
) -> CommandResult<CommandBuilder> {
    not_implemented!("PLAT-07")
}

/// Starts the reader thread and the exit watcher for a new session. The reader honours flow
/// control, feeds the mirror and the history recorder, then sends chunks on `output`. The
/// watcher collects the exit status, saves history, removes the session and emits `pty://exit`.
pub fn start_io_threads(
    _app: &AppHandle,
    _state: &PtyState,
    _session: Arc<PtySession>,
    _output: Channel<PtyChunk>,
) -> CommandResult<()> {
    not_implemented!("PLAT-07")
}

/// Starts a terminal. Output arrives on `on_output`; the end arrives as `pty://exit`.
#[tauri::command]
#[allow(unused_variables)]
pub async fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    request: PtySpawnRequest,
    on_output: Channel<PtyChunk>,
) -> CommandResult<PtySpawned> {
    not_implemented!("PLAT-07")
}

/// Sends keystrokes or pasted text to the terminal.
#[tauri::command]
#[allow(unused_variables)]
pub async fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> CommandResult<()> {
    not_implemented!("PLAT-07")
}

/// Tells the terminal its new size in columns and rows.
#[tauri::command]
#[allow(unused_variables)]
pub async fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> CommandResult<()> {
    not_implemented!("PLAT-07")
}

/// Ends the terminal's process.
#[tauri::command]
#[allow(unused_variables)]
pub async fn pty_kill(state: State<'_, PtyState>, id: String) -> CommandResult<()> {
    not_implemented!("PLAT-07")
}

/// Reports bytes the UI has rendered, which lets a paused reader continue.
#[tauri::command]
#[allow(unused_variables)]
pub async fn pty_ack(state: State<'_, PtyState>, id: String, bytes: usize) -> CommandResult<()> {
    not_implemented!("PLAT-07")
}

/// Returns the last `max_lines` lines of the terminal as plain text.
#[tauri::command]
#[allow(unused_variables)]
pub async fn pty_screen_text(
    state: State<'_, PtyState>,
    id: String,
    max_lines: usize,
) -> CommandResult<String> {
    not_implemented!("PLAT-07")
}
