//! @feature PLAT-07 Terminals over PTY with flow control and screen text
//!
//! Owns: starting shells and scripts on pseudo-terminals, moving bytes between them and the UI
//! with back-pressure, keeping a headless copy of each screen, and ending them cleanly.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`pty_spawn`, `pty_write`,
//! `pty_resize`, `pty_kill`, `pty_ack`, `pty_screen_text`, `pty_screen_snapshot`; portable-pty
//! plus an alacritty screen model) and A5 (zsh integration is written by the UI, which passes
//! `ZDOTDIR` in `env`). services-map.md 5A.4 (output is base64 with a byte length, the UI acks in
//! batches of 5000 bytes, Rust pauses reading when too many bytes are unacknowledged).
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
//! - When the child exits, the exit watcher closes flow control and wakes a paused reader, then
//!   waits only `DRAIN_AFTER_EXIT_MS` for the reader to drain. A background process that keeps
//!   the PTY open cannot delay the exit. The exit code is collected, the history recorder saves
//!   the scrollback (PLAT-08), the session leaves the table, and `pty://exit` fires once.
//! - `pty_kill` on a terminal that already ended succeeds. A kill sends SIGHUP to the terminal's
//!   foreground process group, found with `tcgetpgrp` on the master, so `npm run dev` children
//!   stop with the shell even when job control put them in another group.
//! - `pty_spawn` fails with `pty_bad_cwd` when the folder is missing, before any process exists.
//! - A resize to zero columns or rows is rejected with `pty_bad_size`.
//! - A panic in one reader thread must not poison the table for the others: lock calls recover
//!   from poisoning.
//! - Sessions are looked up by id in a shared table behind a mutex that is never held while
//!   reading or writing a terminal.
//! - The child starts from the captured, stripped login-shell environment. The request's `env`
//!   is layered last, and the app's own process environment is never inherited.
//! - A request whose `env` carries `CONDUCTED_PATH_PREFIX` gets that folder first on its PATH, so
//!   a terminal or script runs the programs the user chose (SET-13, services-map.md 5A.8.2).
//!
//! Not this module's work:
//! - Closing the app kills every terminal. The app lifecycle lives in `lib.rs` (PLAT-27).
//! - The session launch request (kind, execution, env mode, persistence, metadata), direct script
//!   files under a projects folder, terminal naming and the terminal limit are UI work (RUN-06).
//!   This module sees only `PtySpawnRequest`.
//! - `pty_screen_snapshot` redraws the visible grid as clear-screen plus plain text. It keeps no
//!   colours, attributes or cursor position, and scrollback appears as visible lines. The full
//!   screen state is not built yet.
//! - Saving history is PLAT-08. The reader collects output into `HistoryRecorder`; the exit
//!   watcher saves it to the history folder, and `save_live_histories` saves every running
//!   terminal when the app quits. A failed save is written to the app log. The UI cannot show it
//!   yet: `PtyHandle.onExit` in platform.ts carries only the exit code.
//! - `pty-ready` is dropped by design: `pty_spawn` returns once the process exists.
//!
//! Our design choice: ids are made in Rust and are unique across restarts (start time plus a
//! counter), so the history file name can be the id. The UI stores the id in its `terminals` row.
//! Our design choice: Rust saves history when the child exits, so the UI has no persist call.
//!
//! Test first: spawn `printf` of 3 MiB with the UI never acking; the reader pauses near
//! `HIGH_WATER_BYTES`; acking everything lets it finish and `pty://exit` arrives once.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, PoisonError, mpsc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Point};
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{Config as TermConfig, Term, TermMode};
use alacritty_terminal::vte::ansi::Processor;
use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{CommandError, CommandResult, lock};
use crate::process_group;
use crate::terminal_history::{HistoryRecorder, history_dir};

#[cfg(unix)]
unsafe extern "C" {
    fn tcgetpgrp(fd: i32) -> i32;
}

/// SIGHUP reaches every process in the terminal's foreground group.
#[cfg(unix)]
const SIGHUP: i32 = 1;

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
/// How long the exit watcher waits for the reader after the child ends. A background process that
/// still holds the PTY keeps the reader open; the exit event must not wait for it.
pub const DRAIN_AFTER_EXIT_MS: u64 = 500;

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

/// The full screen state of a terminal, so a tab can redraw it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyScreenSnapshot {
    /// Escape sequences that redraw the screen when written to a fresh terminal.
    pub data: String,
    pub cols: u16,
    pub rows: u16,
    /// A full-screen program (vim, less) switched to the alternate screen.
    pub alternate_screen: bool,
    /// The program asked for bracketed paste.
    pub bracketed_paste: bool,
}

/// Back-pressure counter shared by the reader thread and `pty_ack`.
pub struct FlowControl {
    /// Bytes sent to the UI and not yet acknowledged.
    pub unacked: Mutex<usize>,
    /// Signalled when `unacked` drops below `LOW_WATER_BYTES` or the terminal is closed.
    pub below_low_water: Condvar,
    /// Set when the terminal is killed, so a paused reader wakes even without an ack.
    pub closed: AtomicBool,
}

impl Default for FlowControl {
    fn default() -> Self {
        Self::new()
    }
}

impl FlowControl {
    /// A counter with nothing sent and nothing acknowledged.
    pub fn new() -> Self {
        Self {
            unacked: Mutex::new(0),
            below_low_water: Condvar::new(),
            closed: AtomicBool::new(false),
        }
    }

    /// Adds bytes just sent to the UI.
    pub fn record_sent(&self, bytes: usize) -> CommandResult<()> {
        let mut unacked = lock(&self.unacked);
        *unacked = (*unacked).saturating_add(bytes);
        self.below_low_water.notify_all();
        Ok(())
    }

    /// Blocks the reader thread while `unacked` is at or above `HIGH_WATER_BYTES`.
    pub fn wait_for_room(&self) -> CommandResult<()> {
        let mut unacked = lock(&self.unacked);
        while *unacked >= HIGH_WATER_BYTES && !self.closed.load(Ordering::SeqCst) {
            unacked = self
                .below_low_water
                .wait(unacked)
                .unwrap_or_else(PoisonError::into_inner);
        }
        Ok(())
    }

    /// Subtracts acknowledged bytes, never going below zero, and wakes the reader when needed.
    pub fn acknowledge(&self, bytes: usize) -> CommandResult<()> {
        let mut unacked = lock(&self.unacked);
        *unacked = (*unacked).saturating_sub(bytes);
        if *unacked < LOW_WATER_BYTES {
            self.below_low_water.notify_all();
        }
        Ok(())
    }

    /// Wakes a paused reader when the terminal is going away.
    pub fn close(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.below_low_water.notify_all();
    }

    /// Whether the terminal has been closed.
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Waits until the reader is paused at the high-water mark, so a test can drive its acks from
    /// the counter instead of from the messages. Returns once the terminal closes.
    #[cfg(test)]
    fn wait_for_high_water(&self) -> CommandResult<()> {
        let mut unacked = lock(&self.unacked);
        while *unacked < HIGH_WATER_BYTES && !self.is_closed() {
            unacked = self
                .below_low_water
                .wait(unacked)
                .unwrap_or_else(PoisonError::into_inner);
        }
        Ok(())
    }

    /// Waits until bytes are sent or the terminal closes, so a test ack loop never spins.
    #[cfg(test)]
    fn wait_for_progress(&self) -> CommandResult<()> {
        let mut unacked = lock(&self.unacked);
        while *unacked == 0 && !self.is_closed() {
            unacked = self
                .below_low_water
                .wait(unacked)
                .unwrap_or_else(PoisonError::into_inner);
        }
        Ok(())
    }
}

/// A headless copy of one terminal screen, so the app can read what a terminal shows
/// (`GetTerminalOutput`) without asking the UI.
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
    pub fn feed(&mut self, bytes: &[u8]) -> CommandResult<()> {
        self.parser.advance(&mut self.term, bytes);
        Ok(())
    }

    /// Resizes the grid, keeping history.
    pub fn resize(&mut self, cols: u16, rows: u16) -> CommandResult<()> {
        if cols == 0 || rows == 0 {
            return Err(bad_size());
        }
        self.term
            .resize(TermSize::new(usize::from(cols), usize::from(rows)));
        Ok(())
    }

    /// Plain text of scrollback plus the visible screen, last `max_lines` lines, trailing blanks
    /// trimmed on each line and at the end.
    pub fn text(&self, max_lines: usize) -> CommandResult<String> {
        if max_lines == 0 {
            return Ok(String::new());
        }
        let grid = self.term.grid();
        let last_column = Column(grid.columns().saturating_sub(1));
        let text = self.term.bounds_to_string(
            Point::new(grid.topmost_line(), Column(0)),
            Point::new(grid.bottommost_line(), last_column),
        );
        let lines = trimmed_lines(&text);
        let first = lines.len().saturating_sub(max_lines);
        Ok(lines[first..].join("\n"))
    }

    /// The visible grid as clear-screen plus plain text, and the modes set by the program.
    /// Colours, attributes and cursor position are not reproduced; scrollback is replayed as
    /// visible lines.
    pub fn snapshot(&self) -> CommandResult<PtyScreenSnapshot> {
        let grid = self.term.grid();
        let cols = u16::try_from(grid.columns()).unwrap_or(u16::MAX);
        let rows = u16::try_from(grid.screen_lines()).unwrap_or(u16::MAX);
        let text = self.text(usize::MAX)?;
        let mut data = String::from("\u{1b}[2J\u{1b}[H");
        for line in text.split('\n') {
            data.push_str(line);
            data.push_str("\r\n");
        }
        Ok(PtyScreenSnapshot {
            data,
            cols,
            rows,
            alternate_screen: self.term.mode().contains(TermMode::ALT_SCREEN),
            bracketed_paste: self.term.mode().contains(TermMode::BRACKETED_PASTE),
        })
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
        let sessions = lock(&self.sessions);
        sessions
            .get(id)
            .cloned()
            .ok_or_else(|| CommandError::Failed {
                code: "pty_not_found",
                message: format!("No terminal with id {id}"),
            })
    }

    /// A new id that stays unique across restarts (time, process and a counter).
    pub fn next_id(&self) -> String {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let serial = self.next_serial.fetch_add(1, Ordering::SeqCst);
        format!("pty-{nanos:x}-{}-{serial}", std::process::id())
    }
}

/// Builds the program to run: the request's command, or the login shell with `-l`, with the
/// captured login-shell environment, the `TERM` defaults and the request's `env` applied in that
/// order. The app's own process environment is never inherited.
pub fn build_command(
    request: &PtySpawnRequest,
    login_shell: &str,
    base_env: &HashMap<String, String>,
) -> CommandResult<CommandBuilder> {
    let interactive = request.command.is_none();
    let mut builder = match &request.command {
        Some(command) => {
            let mut builder = CommandBuilder::new(&command.program);
            builder.args(command.args.iter());
            builder
        }
        None => {
            let mut builder = CommandBuilder::new(login_shell);
            if cfg!(target_os = "macos") {
                builder.arg("-l");
            } else {
                builder.arg("-i");
            }
            builder
        }
    };
    builder.cwd(&request.cwd);
    builder.env_clear();
    for (key, value) in base_env {
        builder.env(key, value);
    }

    let overlay = request.env.as_ref();
    let has = |key: &str| overlay.is_some_and(|env| env.contains_key(key));
    let mut defaults: Vec<(&str, String)> = Vec::new();
    if !has("TERM") {
        defaults.push(("TERM", "xterm-256color".to_string()));
    }
    if !has("COLORTERM") {
        defaults.push(("COLORTERM", "truecolor".to_string()));
    }
    if !has("SHELL") {
        defaults.push(("SHELL", login_shell.to_string()));
    }
    if !has("LANG") {
        defaults.push((
            "LANG",
            std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()),
        ));
    }
    if !has("PWD") {
        defaults.push(("PWD", request.cwd.clone()));
    }
    if cfg!(target_os = "macos") && interactive && !has("PATH") {
        defaults.push(("PATH", String::new()));
    }
    if login_shell.ends_with("zsh") && !has("DISABLE_AUTO_UPDATE") {
        defaults.push(("DISABLE_AUTO_UPDATE", "true".to_string()));
    }
    for (key, value) in defaults {
        builder.env(key, value);
    }
    if let Some(env) = overlay {
        for (key, value) in env {
            builder.env(key, value);
        }
        if let Some(path) = crate::shell::prefixed_path(env, base_env) {
            builder.env("PATH", path);
        }
    }
    Ok(builder)
}

/// Reads the terminal until end of file, pausing at the flow-control high-water mark.
/// `on_chunk` returns false when output can no longer be delivered.
pub fn pump_output<R: Read>(
    reader: &mut R,
    flow: &FlowControl,
    mut on_chunk: impl FnMut(&[u8]) -> bool,
) -> CommandResult<()> {
    let mut buffer = vec![0u8; READ_CHUNK_BYTES];
    loop {
        flow.wait_for_room()?;
        match reader.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(read) => {
                // Count the bytes before they leave. The UI's ack can come back before this thread
                // runs its next line, and an ack that finds nothing counted is lost for good.
                flow.record_sent(read)?;
                if !on_chunk(&buffer[..read]) {
                    return Ok(());
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(CommandError::Io(error)),
        }
    }
}

/// A terminal process and its handles, before the reader and exit threads are attached.
pub struct SpawnedTerminal {
    pub session: Arc<PtySession>,
    pub child: Box<dyn Child + Send + Sync>,
    pub reader: Box<dyn Read + Send>,
}

/// Opens a pseudo-terminal and starts the request's process on it.
pub fn spawn_terminal(
    request: &PtySpawnRequest,
    login_shell: &str,
    base_env: &HashMap<String, String>,
    id: String,
) -> CommandResult<SpawnedTerminal> {
    validate_cwd(&request.cwd)?;
    if request.cols == 0 || request.rows == 0 {
        return Err(bad_size());
    }

    let command = build_command(request, login_shell, base_env)?;
    let system = portable_pty::native_pty_system();
    let pair = system
        .openpty(PtySize {
            rows: request.rows,
            cols: request.cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| CommandError::Failed {
            code: "pty_spawn_failed",
            message: error.to_string(),
        })?;
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| CommandError::Failed {
            code: "pty_spawn_failed",
            message: error.to_string(),
        })?;
    let pid = child.process_id();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| CommandError::Failed {
            code: "pty_spawn_failed",
            message: error.to_string(),
        })?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| CommandError::Failed {
            code: "pty_spawn_failed",
            message: error.to_string(),
        })?;
    let killer = child.clone_killer();
    drop(pair.slave);

    let session = Arc::new(PtySession {
        id: id.clone(),
        cwd: request.cwd.clone(),
        pid,
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
        mirror: Arc::new(Mutex::new(ScreenMirror::new(request.cols, request.rows))),
        flow: Arc::new(FlowControl::new()),
        history: Arc::new(Mutex::new(HistoryRecorder::new(id))),
    });

    Ok(SpawnedTerminal {
        session,
        child,
        reader,
    })
}

/// Starts the reader thread and the exit watcher for a new session. The reader honours flow
/// control, feeds the mirror and the history recorder, then sends chunks on `output`. The
/// watcher closes flow control, waits briefly for the reader, collects the exit status, asks the
/// history recorder to save (PLAT-08), removes the session and emits `pty://exit`.
pub fn start_io_threads(
    app: &AppHandle,
    _state: &PtyState,
    session: Arc<PtySession>,
    output: Channel<PtyChunk>,
    mut child: Box<dyn Child + Send + Sync>,
    mut reader: Box<dyn Read + Send>,
) -> CommandResult<()> {
    let reader_session = Arc::clone(&session);
    let (reader_done_tx, reader_done_rx) = mpsc::channel();
    std::thread::spawn(move || {
        let flow = Arc::clone(&reader_session.flow);
        let mirror = Arc::clone(&reader_session.mirror);
        let history = Arc::clone(&reader_session.history);
        let _ = pump_output(&mut reader, &flow, |bytes| {
            {
                let mut mirror = lock(&mirror);
                let _ = mirror.feed(bytes);
            }
            {
                lock(&history).push_output(bytes);
            }
            output
                .send(PtyChunk {
                    data: encode_base64(bytes),
                    byte_length: bytes.len(),
                })
                .is_ok()
        });
        let _ = reader_done_tx.send(());
    });

    let app = app.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        // A terminal nobody acks can have its reader paused at the high-water mark. Closing the
        // flow wakes it, so it drains to end of file and the exit event is not lost.
        session.flow.close();
        // A background process can hold the PTY open after the child ends. Wait for the reader
        // only briefly, then report the exit regardless.
        let _ = reader_done_rx.recv_timeout(Duration::from_millis(DRAIN_AFTER_EXIT_MS));
        let (exit_code, signal) = exit_details(status);

        let saved = history_dir(&app).and_then(|dir| lock(&session.history).save(&dir));
        if let Err(error) = saved {
            let message = format!(
                "could not save the history of terminal {}: {error}",
                session.id
            );
            crate::log_or_stderr(&app, "error", &message);
        }

        let state = app.state::<PtyState>();
        lock(&state.sessions).remove(&session.id);

        let _ = app.emit(
            EVENT_EXIT,
            PtyExit {
                id: session.id.clone(),
                exit_code,
                signal,
            },
        );
    });

    Ok(())
}

/// Saves the history of every terminal still running into `dir` (PLAT-08). The app calls this
/// when it quits, before it ends the terminals, because their exit watchers may not get to run
/// before the process ends. Returns one line per terminal whose history could not be saved.
pub fn save_live_histories(state: &PtyState, dir: &std::path::Path) -> Vec<String> {
    let sessions: Vec<Arc<PtySession>> = lock(&state.sessions).values().cloned().collect();
    sessions
        .iter()
        .filter_map(|session| {
            lock(&session.history)
                .save(dir)
                .err()
                .map(|error| format!("{}: {error}", session.id))
        })
        .collect()
}

/// Starts a terminal. Output arrives on `on_output`; the end arrives as `pty://exit`.
#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    request: PtySpawnRequest,
    on_output: Channel<PtyChunk>,
) -> CommandResult<PtySpawned> {
    // The captured login-shell environment is the base of every child. It is already stripped of
    // provider keys and exported functions. The same capture names the user's login shell, so
    // there is one source of truth for both.
    let login = crate::shell::shell_login_env(app.state::<crate::shell::ShellState>()).await?;
    let spawned = spawn_terminal(&request, &login.shell, &login.vars, state.next_id())?;
    let id = spawned.session.id.clone();
    let pid = spawned.session.pid;
    lock(&state.sessions).insert(id.clone(), Arc::clone(&spawned.session));

    start_io_threads(
        &app,
        &state,
        spawned.session,
        on_output,
        spawned.child,
        spawned.reader,
    )?;
    Ok(PtySpawned { id, pid })
}

/// Sends keystrokes or pasted text to the terminal.
#[tauri::command]
pub async fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> CommandResult<()> {
    let session = state.get(&id)?;
    {
        let mut history = lock(&session.history);
        history.mark_input();
    }
    let mut writer = lock(&session.writer);
    writer
        .write_all(data.as_bytes())
        .map_err(|error| CommandError::Failed {
            code: "pty_write_failed",
            message: error.to_string(),
        })?;
    writer.flush().map_err(|error| CommandError::Failed {
        code: "pty_write_failed",
        message: error.to_string(),
    })
}

/// Tells the terminal its new size in columns and rows.
#[tauri::command]
pub async fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> CommandResult<()> {
    if cols == 0 || rows == 0 {
        return Err(bad_size());
    }
    let session = state.get(&id)?;
    {
        let master = lock(&session.master);
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| CommandError::Failed {
                code: "pty_resize_failed",
                message: error.to_string(),
            })?;
    }
    let mut mirror = lock(&session.mirror);
    mirror.resize(cols, rows)
}

/// Ends the terminal's process. Killing an id that already ended is a no-op that succeeds.
#[tauri::command]
pub async fn pty_kill(state: State<'_, PtyState>, id: String) -> CommandResult<()> {
    kill_if_live(&state, &id)
}

/// Ends a live terminal, or succeeds when it already ended.
fn kill_if_live(state: &PtyState, id: &str) -> CommandResult<()> {
    if let Ok(session) = state.get(id) {
        kill_session(&session);
    }
    Ok(())
}

/// Wakes the reader, signals the terminal's foreground process group, then ends the child.
fn kill_session(session: &PtySession) {
    session.flow.close();
    #[cfg(unix)]
    {
        // Under job control the foreground group is not the shell's own group. A dev server the
        // user started is there, so signal that group first and fall back to the child's group.
        let foreground = {
            let master = lock(&session.master);
            foreground_group(&**master)
        };
        if let Some(pgrp) = foreground.or(session.pid) {
            let _ = process_group::signal_group(pgrp, SIGHUP);
        }
    }
    let mut killer = lock(&session.killer);
    let _ = killer.kill();
}

/// The foreground process group of the terminal behind the master, when the platform reports one.
#[cfg(unix)]
fn foreground_group(master: &(dyn MasterPty + Send)) -> Option<u32> {
    let fd = master.as_raw_fd()?;
    // SAFETY: tcgetpgrp reads the foreground group of the terminal open on `fd`. The fd stays
    // open for as long as the master is held by the caller.
    let pgrp = unsafe { tcgetpgrp(fd) };
    (pgrp > 0).then_some(pgrp as u32)
}

/// Reports bytes the UI has rendered, which lets a paused reader continue.
#[tauri::command]
pub async fn pty_ack(state: State<'_, PtyState>, id: String, bytes: usize) -> CommandResult<()> {
    if let Ok(session) = state.get(&id) {
        session.flow.acknowledge(bytes)?;
    }
    Ok(())
}

/// Returns the last `max_lines` lines of the terminal as plain text.
#[tauri::command]
pub async fn pty_screen_text(
    state: State<'_, PtyState>,
    id: String,
    max_lines: usize,
) -> CommandResult<String> {
    let session = state.get(&id)?;
    let mirror = lock(&session.mirror);
    mirror.text(max_lines)
}

/// Returns clear-screen plus plain screen text and the modes, so a tab redraws on the right
/// screen. Colours, attributes and cursor position are not included.
#[tauri::command]
pub async fn pty_screen_snapshot(
    state: State<'_, PtyState>,
    id: String,
) -> CommandResult<PtyScreenSnapshot> {
    let session = state.get(&id)?;
    let mirror = lock(&session.mirror);
    mirror.snapshot()
}

/// Fails with `pty_bad_cwd` unless the working folder exists and is a folder.
fn validate_cwd(cwd: &str) -> CommandResult<()> {
    let metadata = std::fs::metadata(cwd).map_err(|_| CommandError::Failed {
        code: "pty_bad_cwd",
        message: format!("Terminal working directory is unavailable: {cwd}"),
    })?;
    if !metadata.is_dir() {
        return Err(CommandError::Failed {
            code: "pty_bad_cwd",
            message: format!("Terminal working directory is not a folder: {cwd}"),
        });
    }
    Ok(())
}

fn bad_size() -> CommandError {
    CommandError::Failed {
        code: "pty_bad_size",
        message: "A terminal needs at least one column and one row.".to_string(),
    }
}

fn trim_trailing_spaces(line: &str) -> &str {
    line.trim_end()
}

fn trimmed_lines(text: &str) -> Vec<&str> {
    let mut lines: Vec<&str> = text.split('\n').map(trim_trailing_spaces).collect();
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    lines
}

fn exit_details(status: std::io::Result<portable_pty::ExitStatus>) -> (Option<i32>, Option<i32>) {
    match status {
        Ok(status) => match status.signal() {
            Some(name) => (None, signal_number(name)),
            None => (Some(status.exit_code() as i32), None),
        },
        Err(_) => (None, None),
    }
}

/// The signal number in portable-pty's signal text. On macOS that text comes from `strsignal`, for
/// example "Terminated: 15", or reads "Signal 15" when the system has no description. A plain
/// name such as "SIGTERM" is read too.
fn signal_number(text: &str) -> Option<i32> {
    let last_word = text.rsplit([':', ' ']).next().unwrap_or(text);
    if let Ok(number) = last_word.trim().parse() {
        return Some(number);
    }
    let name = text.strip_prefix("SIG").unwrap_or(text);
    match name {
        "HUP" => Some(1),
        "INT" => Some(2),
        "QUIT" => Some(3),
        "KILL" => Some(9),
        "PIPE" => Some(13),
        "TERM" => Some(15),
        other => other.parse().ok(),
    }
}

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub(crate) fn encode_base64(bytes: &[u8]) -> String {
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = chunk.get(1).copied();
        let third = chunk.get(2).copied();
        encoded.push(BASE64_ALPHABET[usize::from(first >> 2)] as char);
        encoded.push(
            BASE64_ALPHABET[usize::from((first & 0b0000_0011) << 4 | second.unwrap_or(0) >> 4)]
                as char,
        );
        match second {
            Some(second) => encoded.push(
                BASE64_ALPHABET[usize::from((second & 0b0000_1111) << 2 | third.unwrap_or(0) >> 6)]
                    as char,
            ),
            None => encoded.push('='),
        }
        match third {
            Some(third) => encoded.push(BASE64_ALPHABET[usize::from(third & 0b0011_1111)] as char),
            None => encoded.push('='),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use std::ffi::{OsStr, OsString};
    use std::io::{Cursor, Read, Write};
    use std::sync::mpsc;
    use std::time::Duration;

    use super::*;

    fn temp_cwd() -> String {
        std::env::temp_dir().to_string_lossy().into_owned()
    }

    /// A stand-in for the captured, stripped login-shell environment.
    fn captured_env() -> HashMap<String, String> {
        HashMap::from([
            (
                "PATH".to_string(),
                "/opt/homebrew/bin:/usr/bin:/bin".to_string(),
            ),
            ("HOME".to_string(), "/Users/test".to_string()),
        ])
    }

    fn empty_env() -> HashMap<String, String> {
        HashMap::new()
    }

    #[test]
    fn plat_07_flow_control_pauses_at_high_water_and_wakes_below_low() {
        let flow = Arc::new(FlowControl::new());
        flow.record_sent(HIGH_WATER_BYTES).unwrap();

        let (done_tx, done_rx) = mpsc::channel();
        let waiting = Arc::clone(&flow);
        let waiter = std::thread::spawn(move || {
            waiting.wait_for_room().unwrap();
            done_tx.send(()).unwrap();
        });

        assert!(
            done_rx.recv_timeout(Duration::from_millis(100)).is_err(),
            "a reader at the high-water mark must wait for an ack"
        );

        flow.acknowledge(HIGH_WATER_BYTES - LOW_WATER_BYTES + 1)
            .unwrap();
        done_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("an ack below the low-water mark must wake the reader");
        waiter.join().unwrap();
        assert_eq!(*flow.unacked.lock().unwrap(), LOW_WATER_BYTES - 1);
    }

    #[test]
    fn plat_07_acknowledging_more_than_sent_does_not_go_below_zero() {
        let flow = FlowControl::new();
        flow.record_sent(10).unwrap();
        flow.acknowledge(99).unwrap();
        assert_eq!(*flow.unacked.lock().unwrap(), 0);
    }

    #[test]
    fn plat_07_an_ack_that_arrives_before_the_next_read_is_not_lost() {
        let flow = FlowControl::new();
        let mut source = Cursor::new(vec![b'x'; 1000]);
        pump_output(&mut source, &flow, |bytes| {
            // A fast UI acknowledges a chunk while the reader thread is still inside the send.
            flow.acknowledge(bytes.len()).unwrap();
            true
        })
        .unwrap();
        assert_eq!(*flow.unacked.lock().unwrap(), 0);
    }

    #[test]
    fn plat_07_kill_wakes_a_paused_reader() {
        let flow = Arc::new(FlowControl::new());
        flow.record_sent(HIGH_WATER_BYTES).unwrap();
        let waiting = Arc::clone(&flow);
        let waiter = std::thread::spawn(move || waiting.wait_for_room());
        flow.close();
        waiter.join().unwrap().unwrap();
    }

    #[test]
    fn plat_07_reader_pauses_before_three_megabytes_and_finishes_after_acking() {
        let flow = Arc::new(FlowControl::new());
        let total = 3 * 1024 * 1024;
        let reading = Arc::clone(&flow);
        let reader = std::thread::spawn(move || {
            let mut source = Cursor::new(vec![b'x'; total]);
            let mut sent = 0usize;
            pump_output(&mut source, &reading, |bytes| {
                sent += bytes.len();
                true
            })
            .unwrap();
            reading.close();
            sent
        });

        // The reader blocks once it has sent the high-water mark. Waiting on the counter, rather
        // than on the messages, keeps the acks from racing the reader's `record_sent`.
        flow.wait_for_high_water()
            .expect("the reader reaches the high-water mark");
        assert!(
            *flow.unacked.lock().unwrap() >= HIGH_WATER_BYTES,
            "the reader must pause at the high-water mark before it has read everything"
        );

        while !flow.is_closed() {
            let unacked = *flow.unacked.lock().unwrap();
            if unacked > 0 {
                flow.acknowledge(unacked).unwrap();
            } else {
                flow.wait_for_progress().unwrap();
            }
        }

        let sent = reader.join().unwrap();
        assert_eq!(sent, total);
        let remaining = *flow.unacked.lock().unwrap();
        flow.acknowledge(remaining).unwrap();
        assert_eq!(*flow.unacked.lock().unwrap(), 0);
    }

    #[test]
    fn plat_07_screen_mirror_keeps_text_scrollback_and_modes() {
        let mut mirror = ScreenMirror::new(20, 4);
        mirror.feed(b"hello\r\nworld   \r\n").unwrap();
        assert_eq!(mirror.text(10).unwrap(), "hello\nworld");
        assert_eq!(mirror.text(1).unwrap(), "world");

        let snapshot = mirror.snapshot().unwrap();
        assert_eq!(snapshot.cols, 20);
        assert_eq!(snapshot.rows, 4);
        assert!(snapshot.data.starts_with("\u{1b}[2J"));
        assert!(snapshot.data.contains("hello"));
        assert!(!snapshot.alternate_screen);
        assert!(!snapshot.bracketed_paste);

        mirror.feed(b"\x1b[?1049h").unwrap();
        assert!(mirror.snapshot().unwrap().alternate_screen);
        mirror.feed(b"\x1b[?2004h").unwrap();
        assert!(mirror.snapshot().unwrap().bracketed_paste);
        mirror.feed(b"\x1b[?1049l").unwrap();
        assert!(!mirror.snapshot().unwrap().alternate_screen);
    }

    #[test]
    fn plat_07_screen_mirror_resizes_and_rejects_zero() {
        let mut mirror = ScreenMirror::new(10, 2);
        assert!(matches!(
            mirror.resize(0, 2),
            Err(CommandError::Failed {
                code: "pty_bad_size",
                ..
            })
        ));
        mirror.feed(b"abc").unwrap();
        mirror.resize(30, 6).unwrap();
        let snapshot = mirror.snapshot().unwrap();
        assert_eq!(snapshot.cols, 30);
        assert_eq!(snapshot.rows, 6);
    }

    #[test]
    fn plat_07_screen_text_is_trimmed_and_limited_to_the_last_lines() {
        let mut mirror = ScreenMirror::new(12, 3);
        mirror.feed(b"one   \r\ntwo\r\nthree\r\n   \r\n").unwrap();
        assert_eq!(mirror.text(10).unwrap(), "one\ntwo\nthree");
        assert_eq!(mirror.text(2).unwrap(), "two\nthree");
        assert_eq!(mirror.text(0).unwrap(), "");
    }

    #[test]
    fn plat_07_interactive_shell_uses_login_arguments_and_a_fresh_path() {
        let request = PtySpawnRequest {
            cwd: temp_cwd(),
            cols: 80,
            rows: 24,
            command: None,
            env: None,
        };
        let command = build_command(&request, "/bin/zsh", &captured_env()).unwrap();
        assert_eq!(command.get_argv()[0], OsString::from("/bin/zsh"));
        assert_eq!(
            command.get_env("SHELL"),
            Some(OsStr::new("/bin/zsh")),
            "the shell is passed to the program"
        );
        assert_eq!(
            command.get_env("HOME"),
            Some(OsStr::new("/Users/test")),
            "the captured environment is the base"
        );
        assert_eq!(command.get_env("TERM"), Some(OsStr::new("xterm-256color")));
        assert_eq!(command.get_env("COLORTERM"), Some(OsStr::new("truecolor")));
        assert_eq!(
            command
                .get_cwd()
                .map(|cwd| cwd.to_string_lossy().into_owned()),
            Some(request.cwd)
        );
        if cfg!(target_os = "macos") {
            assert_eq!(command.get_argv().get(1), Some(&OsString::from("-l")));
            assert_eq!(command.get_env("PATH"), Some(OsStr::new("")));
            assert_eq!(
                command.get_env("DISABLE_AUTO_UPDATE"),
                Some(OsStr::new("true"))
            );
        } else {
            assert_eq!(command.get_argv().get(1), Some(&OsString::from("-i")));
        }
    }

    #[test]
    fn plat_07_direct_command_keeps_path_and_layers_the_request_env() {
        let request = PtySpawnRequest {
            cwd: temp_cwd(),
            cols: 80,
            rows: 24,
            command: Some(PtyCommand {
                program: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), "printf hi".to_string()],
            }),
            env: Some(HashMap::from([
                ("TERM".to_string(), "screen".to_string()),
                ("FOO".to_string(), "bar".to_string()),
            ])),
        };
        let command = build_command(&request, "/bin/zsh", &captured_env()).unwrap();
        assert_eq!(command.get_argv()[0], OsString::from("/bin/sh"));
        assert_eq!(command.get_argv()[1], OsString::from("-c"));
        assert_eq!(
            command.get_env("TERM"),
            Some(OsStr::new("screen")),
            "the request env wins over the default"
        );
        assert_eq!(command.get_env("FOO"), Some(OsStr::new("bar")));
        assert_eq!(
            command.get_env("PATH"),
            Some(OsStr::new("/opt/homebrew/bin:/usr/bin:/bin")),
            "a direct script keeps the exact captured PATH"
        );
        assert_eq!(command.get_env("HOME"), Some(OsStr::new("/Users/test")));
    }

    #[test]
    fn set_13_a_direct_command_puts_the_chosen_path_shims_first() {
        let request = PtySpawnRequest {
            cwd: temp_cwd(),
            cols: 80,
            rows: 24,
            command: Some(PtyCommand {
                program: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), "printf hi".to_string()],
            }),
            env: Some(HashMap::from([(
                "CONDUCTED_PATH_PREFIX".to_string(),
                "/data/bin-overrides/abc".to_string(),
            )])),
        };
        let command = build_command(&request, "/bin/zsh", &captured_env()).unwrap();

        assert_eq!(
            command.get_env("PATH"),
            Some(OsStr::new(
                "/data/bin-overrides/abc:/opt/homebrew/bin:/usr/bin:/bin"
            ))
        );
        assert_eq!(
            command.get_env("CONDUCTED_PATH_PREFIX"),
            Some(OsStr::new("/data/bin-overrides/abc"))
        );
    }

    #[test]
    fn set_13_an_interactive_terminal_puts_the_shim_before_the_login_path() {
        let request = PtySpawnRequest {
            cwd: temp_cwd(),
            cols: 80,
            rows: 24,
            command: None,
            env: Some(HashMap::from([(
                "CONDUCTED_PATH_PREFIX".to_string(),
                "/data/bin-overrides/abc".to_string(),
            )])),
        };
        let command = build_command(&request, "/bin/zsh", &captured_env()).unwrap();

        assert_eq!(
            command.get_env("PATH"),
            Some(OsStr::new(
                "/data/bin-overrides/abc:/opt/homebrew/bin:/usr/bin:/bin"
            ))
        );
    }

    #[test]
    fn plat_07_direct_command_does_not_inherit_the_app_environment() {
        let request = PtySpawnRequest {
            cwd: temp_cwd(),
            cols: 80,
            rows: 24,
            command: Some(PtyCommand {
                program: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), "printf hi".to_string()],
            }),
            env: None,
        };
        let command = build_command(&request, "/bin/zsh", &empty_env()).unwrap();
        assert_eq!(
            command.get_env("PATH"),
            None,
            "the app's process environment must not leak into the child"
        );
    }

    #[test]
    fn plat_07_spawn_rejects_a_missing_working_folder() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let missing = std::env::temp_dir().join(format!("conducted-plat-07-{nanos}"));
        let error = validate_cwd(&missing.to_string_lossy()).unwrap_err();
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "pty_bad_cwd",
                ..
            }
        ));
    }

    #[test]
    fn plat_07_spawn_starts_a_command_and_returns_its_exit() {
        let request = PtySpawnRequest {
            cwd: temp_cwd(),
            cols: 80,
            rows: 24,
            command: Some(PtyCommand {
                program: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), "printf hello".to_string()],
            }),
            env: None,
        };
        let mut spawned =
            spawn_terminal(&request, "/bin/zsh", &empty_env(), "spawn-test".to_string()).unwrap();
        let mut output = [0u8; 256];
        let read = spawned.reader.read(&mut output).unwrap();
        let text = String::from_utf8_lossy(&output[..read]);
        assert!(text.contains("hello"), "the command output was {text:?}");
        let status = spawned.child.wait().unwrap();
        assert_eq!(status.exit_code(), 0);
    }

    #[test]
    fn plat_07_write_resize_and_kill_reach_the_process() {
        let request = PtySpawnRequest {
            cwd: temp_cwd(),
            cols: 80,
            rows: 24,
            command: Some(PtyCommand {
                program: "/bin/cat".to_string(),
                args: Vec::new(),
            }),
            env: None,
        };
        let mut spawned =
            spawn_terminal(&request, "/bin/zsh", &empty_env(), "io-test".to_string()).unwrap();

        {
            let mut writer = spawned.session.writer.lock().unwrap();
            writer.write_all(b"ping\n").unwrap();
            writer.flush().unwrap();
        }
        let mut buffer = [0u8; 64];
        let read = spawned.reader.read(&mut buffer).unwrap();
        let echoed = String::from_utf8_lossy(&buffer[..read]);
        assert!(echoed.contains("ping"), "the terminal echoed {echoed:?}");

        {
            let master = spawned.session.master.lock().unwrap();
            master
                .resize(PtySize {
                    rows: 40,
                    cols: 100,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .unwrap();
            let size = master.get_size().unwrap();
            assert_eq!(size.cols, 100);
            assert_eq!(size.rows, 40);
        }

        spawned.session.killer.lock().unwrap().kill().unwrap();
        let status = spawned.child.wait().unwrap();
        assert!(!status.success(), "a killed terminal did not exit normally");
    }

    #[test]
    fn plat_07_kill_of_an_ended_terminal_succeeds() {
        let state = PtyState::default();
        kill_if_live(&state, "already-ended").expect("killing an ended terminal is a no-op");
    }

    #[test]
    #[cfg(unix)]
    fn plat_07_kill_signals_the_foreground_group_and_ends_the_child() {
        let request = PtySpawnRequest {
            cwd: temp_cwd(),
            cols: 80,
            rows: 24,
            command: Some(PtyCommand {
                program: "/bin/sh".to_string(),
                args: vec!["-c".to_string(), "sleep 30".to_string()],
            }),
            env: None,
        };
        let mut spawned =
            spawn_terminal(&request, "/bin/zsh", &empty_env(), "kill-test".to_string()).unwrap();
        let foreground = {
            let master = spawned.session.master.lock().unwrap();
            foreground_group(&**master)
        };
        assert!(
            foreground.is_some(),
            "the terminal reports a foreground process group"
        );

        kill_session(&spawned.session);
        let status = spawned.child.wait().unwrap();
        assert!(!status.success(), "a killed terminal did not exit normally");
    }

    #[test]
    fn plat_07_terminal_ids_are_unique() {
        let state = PtyState::default();
        let first = state.next_id();
        let second = state.next_id();
        assert_ne!(first, second);
        assert!(first.starts_with("pty-"));
    }

    #[test]
    fn plat_07_output_chunks_are_base64_encoded() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        assert_eq!(encode_base64(b"hello"), "aGVsbG8=");
    }

    #[test]
    fn plat_07_a_signal_exit_reports_the_signal_number() {
        use std::os::unix::process::CommandExt;

        // A real child ended by SIGTERM, read through portable-pty's own exit status.
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("30")
            .process_group(0)
            .spawn()
            .expect("start sleep");
        assert!(process_group::signal_group(
            child.id(),
            process_group::SIGTERM
        ));
        let status = child.wait().expect("the child ends");

        let (exit_code, signal) = exit_details(Ok(portable_pty::ExitStatus::from(status)));

        assert_eq!(exit_code, None);
        assert_eq!(signal, Some(15));
    }
}
