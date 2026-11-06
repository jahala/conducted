//! @feature PLAT-09 Sidecar launcher: spawn, socket relay, restart, parent watchdog
//! @feature SIDE-22 Slash command cache that works before a chat starts
//! @feature SIDE-23 Sidecar packaging: version flag, one program per CPU
//! @feature AGENT-18 Bundled skill that teaches agents the app
//!
//! Owns: starting the Bun-compiled sidecar program, relaying its newline-delimited JSON between
//! its Unix socket and the webview, restarting it when it dies, and making sure it never outlives
//! the app.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A6 (launch and supervision) and
//! A4 (`rpc_from_sidecar`). Observed: the sidecar prints `SOCKET_PATH=<path>` on stdout, Rust
//! connects to that Unix socket, each line from it becomes an event, `rpc_to_sidecar` writes a
//! line, the sidecar polls its parent pid every 2 s and exits when the parent changed, Rust kills
//! orphaned sidecars with SIGKILL, and a sidecar log lives in the temp folder.
//!
//! Must handle:
//! - `sidecar_ensure_started` is idempotent and safe to call from several places at once: the
//!   second caller waits for the first start and gets the same result. State is behind one async
//!   mutex that is held during the start sequence only.
//! - Start sequence: kill orphans from an earlier crash, resolve the binary, check its version
//!   (SIDE-23), spawn `conducted-sidecar sidecar` with the environment below, read stdout until
//!   `SOCKET_PATH=` (fail with `sidecar_handshake_timeout` after `HANDSHAKE_TIMEOUT_MS`, or at once
//!   with `sidecar_exited_early` when the sidecar ends first), connect with retries, start the
//!   reader and writer threads.
//! - Lines are relayed verbatim. A line is never split or merged. A line longer than
//!   `MAX_LINE_BYTES` is dropped with a log entry instead of exhausting memory.
//! - `sidecar_send` while the sidecar is starting waits for the start. While it is restarting or
//!   stopped it fails with `sidecar_not_running`. The UI resends after `sidecar://restart`
//!   because the sidecar replays unacknowledged events on reconnect.
//! - When a start finishes, `start_locked` emits `sidecar://ready`. Returning from
//!   `sidecar_ensure_started` carries the same signal, so a caller can use either one.
//! - Writes are serialised through one queue, so two sends never interleave inside a line.
//! - Only the newest process generation may change state. An exit report from an older process
//!   (late wait result, late socket close) is dropped by comparing generation numbers.
//! - Restart policy: after an unexpected exit, restart with backoff `RESTART_BACKOFF_MS`, at most
//!   `MAX_RESTARTS_PER_WINDOW` times in `RESTART_WINDOW_MS`. Each exit emits `sidecar://restart`
//!   with `willRetry`. After the limit the phase becomes `Stopped` and the next
//!   `sidecar_ensure_started` starts fresh.
//! - Quitting the app calls `shutdown` from `app_quit` and from the `RunEvent::Exit` handler:
//!   it drops the writer, sends SIGTERM to the sidecar's process group, waits briefly, then sends
//!   SIGKILL. The reader thread closes the socket when the sidecar's end closes. A restart that
//!   was waiting out its backoff does not start.
//! - stdout and stderr are read to the end whatever they hold: a byte that is not UTF-8 is
//!   replaced, and a line over `MAX_LINE_BYTES` is dropped, so a full pipe never blocks the
//!   sidecar.
//! - Parent watchdog: Rust sets `CONDUCTED_PARENT_PID` to its own pid. The sidecar polls it and
//!   exits when the pid is gone or reused (SIDE-19). Rust covers the other direction: at start it
//!   scans the process table for an orphan (parent pid 1) whose executable is the sidecar binary
//!   and kills it with SIGKILL. A sidecar that still has a live parent belongs to another running
//!   app and is left alone.
//! - stdout and stderr go to a log file: `<app data>/logs/sidecar-<pid>.log`, mode 0600. Each line
//!   passes through the app log's redaction first, because the log export bundles this file. The
//!   logger (PLAT-18) owns the file's lifetime: at start the launcher removes logs by age and size
//!   and keeps the five newest, and it cuts a log to its newest third when it reaches its cap.
//!   `sidecar_log_path` returns the current one. D026 routes these lines into the app log files
//!   with a sidecar tag; that routing (PLAT-18) is not built yet, so this file is their current
//!   home.
//!
//! Our design choice: the restart loop in Rust (Conductor has none: the UI calls ensure again).
//! Our design choice: no HTTP health endpoint and no bearer token. A child that is alive and
//! connected is healthy, and the socket is private to the user (mode 0600 in a 0700 folder).
//! Our design choice: environment variables are fixed here and must match packages/sidecar and
//! docs/plans/tauri-commands.md ("Sidecar launch"). We set the variables the sidecar reads today
//! (the parent pid, the outbox root, the log folder and the bin folder) plus the app version and
//! log level its logger reads (SIDE-18). Agent binary folders, ACP provider folder and Cursor
//! store arrive with the features that read them (PLAT-28, SIDE-15, AGENT-09). SIDE-22
//! (`CONDUCTED_COMPLETIONS_DIR`) adds its variable when its resolver stops being a placeholder.
//! AGENT-18 sets `CONDUCTED_SKILL_PLUGIN_DIR` to the bundled skill folder when the build ships
//! one. There is no database path (the app owns the database) and no logger token or folder
//! (D026, D028).
//! Packaging the sidecar needs `bundle.externalBin` in tauri.conf.json, which requires the
//! compiled file to exist at build time. In development `CONDUCTED_SIDECAR_BIN` points at a
//! binary or a wrapper script.
//!
//! Test first: a fake sidecar script that prints `SOCKET_PATH=...` is read by `spawn_sidecar`;
//! the writer sends one line per message, and the framer splits replies and drops an overlong
//! line.

use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Read, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::net::UnixStream;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::error::{CommandError, CommandResult, blocking};
use crate::logger;
use crate::not_implemented;
use crate::process_group;
use crate::shell::KILL_GRACE_MS;

/// Event carrying one line from the sidecar, as a plain string.
pub const EVENT_LINE: &str = "sidecar://line";
/// Event fired when a start has connected to the sidecar and the relay is up.
pub const EVENT_READY: &str = "sidecar://ready";
/// Event fired when the sidecar process ends or is restarted. Payload: `SidecarRestart`.
pub const EVENT_RESTART: &str = "sidecar://restart";
/// Longest accepted line from the sidecar.
pub const MAX_LINE_BYTES: usize = 32 * 1024 * 1024;
/// Time allowed between spawn and the `SOCKET_PATH=` line.
pub const HANDSHAKE_TIMEOUT_MS: u64 = 30_000;
/// Time allowed between the handshake and a successful socket connection.
pub const CONNECT_TIMEOUT_MS: u64 = 5_000;
/// Pause before each successive restart. The last value repeats.
pub const RESTART_BACKOFF_MS: [u64; 4] = [250, 1_000, 3_000, 10_000];
/// Restarts allowed inside the window before the launcher gives up.
pub const MAX_RESTARTS_PER_WINDOW: u32 = 5;
/// Length of the restart-counting window.
pub const RESTART_WINDOW_MS: u64 = 60_000;
/// Sidecar log files kept.
pub const LOGS_KEPT: usize = 5;
/// Environment variable that names a binary or wrapper script instead of the bundled program.
pub const ENV_SIDECAR_BIN: &str = "CONDUCTED_SIDECAR_BIN";
/// Environment variable that tells the sidecar where to keep its slash-command snapshots.
pub const ENV_COMPLETIONS_DIR: &str = "CONDUCTED_COMPLETIONS_DIR";
/// Environment variable that tells the sidecar where the bundled skill folder is.
pub const ENV_SKILL_PLUGIN_DIR: &str = "CONDUCTED_SKILL_PLUGIN_DIR";
/// Folder name of the bundled skill plugin inside the app's resources.
pub const SKILL_PLUGIN_FOLDER: &str = "conducted-skill";

/// Why a sidecar process ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SidecarExitReason {
    /// The process exited or was killed by a signal.
    Exited,
    /// The socket closed while the process stayed alive.
    SocketClosed,
}

/// Payload of `sidecar://restart`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarRestart {
    pub reason: SidecarExitReason,
    /// Exit code when the process exited by itself.
    pub exit_code: Option<i32>,
    /// Restarts counted in the current window, including this one.
    pub restart_count: u32,
    /// False when the limit was reached and the launcher stopped.
    pub will_retry: bool,
}

/// A running sidecar.
#[derive(Clone)]
pub struct SidecarHandle {
    pub pid: u32,
    /// Which start this is. Grows by one per start. Used to drop late reports from old processes.
    pub generation: u64,
    pub socket_path: PathBuf,
    pub log_path: PathBuf,
    /// Lines to write to the socket. One writer thread drains it in order.
    pub outgoing: mpsc::Sender<String>,
}

/// Where the launcher is in its life.
pub enum SidecarPhase {
    Stopped,
    Starting,
    Running(SidecarHandle),
    /// Waiting out a backoff before the next start. `attempt` counts restarts in this window.
    Restarting {
        attempt: u32,
    },
}

/// Shared state, registered once with `.manage(SidecarState::default())`.
pub struct SidecarState {
    /// The phase and the generation counter. Held during start and for short updates only.
    pub inner: tauri::async_runtime::Mutex<SidecarInner>,
}

/// The mutable part of `SidecarState`.
pub struct SidecarInner {
    pub phase: SidecarPhase,
    /// Generation of the most recent start.
    pub generation: u64,
    /// Start times (ms since epoch) of restarts inside the current window.
    pub recent_restarts_ms: Vec<i64>,
    /// The newest log path, kept after the process stops so the UI can still open it.
    pub last_log_path: Option<PathBuf>,
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            inner: tauri::async_runtime::Mutex::new(SidecarInner {
                phase: SidecarPhase::Stopped,
                generation: 0,
                recent_restarts_ms: Vec::new(),
                last_log_path: None,
            }),
        }
    }
}

/// The folder for the sidecar's saved slash-command lists. Created when missing.
pub fn completions_dir(_app: &AppHandle) -> CommandResult<PathBuf> {
    not_implemented!("SIDE-22")
}

/// The bundled skill folder, or `None` when the build has none (a dev run).
pub fn skill_plugin_dir<R: Runtime>(app: &AppHandle<R>) -> CommandResult<Option<PathBuf>> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| CommandError::Failed {
            code: "sidecar_resources_dir_failed",
            message: format!("Could not find the app resources folder: {error}"),
        })?;
    Ok(find_skill_plugin_dir(&resources))
}

/// The bundled skill folder under a resources folder, when that folder exists.
fn find_skill_plugin_dir(resources: &Path) -> Option<PathBuf> {
    let folder = resources.join(SKILL_PLUGIN_FOLDER);
    folder.is_dir().then_some(folder)
}

/// Program name the bundled sidecar prints for `--version`. The one home for the name on this
/// side; a contract test compares it with packages/sidecar's `SIDECAR_PROGRAM_NAME`.
pub const SIDECAR_PROGRAM_NAME: &str = "conducted-sidecar";

/// The exact line `<sidecar> --version` must print for `app_version`.
pub fn expected_version_line(app_version: &str) -> String {
    format!("{SIDECAR_PROGRAM_NAME} {app_version}")
}

/// Runs `<binary> --version` and checks that it names `app_version`.
pub async fn check_binary_version(binary: &Path, app_version: &str) -> CommandResult<()> {
    let binary = binary.to_path_buf();
    let app_version = app_version.to_string();
    blocking("sidecar_version_check_failed", move || {
        check_version_blocking(&binary, &app_version)
    })
    .await
}

/// Runs the version command and compares the one line it prints with the app version.
fn check_version_blocking(binary: &Path, app_version: &str) -> CommandResult<()> {
    let output = std::process::Command::new(binary)
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| CommandError::Failed {
            code: "sidecar_version_check_failed",
            message: format!("Could not run {} --version: {error}", binary.display()),
        })?;
    if !output.status.success() {
        return Err(CommandError::Failed {
            code: "sidecar_version_check_failed",
            message: format!(
                "{} --version exited with {}.",
                binary.display(),
                output.status
            ),
        });
    }
    let answer = String::from_utf8_lossy(&output.stdout);
    let answer = answer.trim();
    let expected = expected_version_line(app_version);
    if answer != expected {
        return Err(CommandError::Failed {
            code: "sidecar_version_mismatch",
            message: format!(
                "The sidecar at {} reports \"{answer}\"; this app is version {app_version}.",
                binary.display()
            ),
        });
    }
    Ok(())
}

/// Finds the sidecar program: `CONDUCTED_SIDECAR_BIN` when set, otherwise the bundled one in
/// `<resources>/bin/` (or beside the app executable for a release build). Fails with
/// `sidecar_binary_missing`.
pub fn resolve_binary<R: Runtime>(app: &AppHandle<R>) -> CommandResult<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(explicit) = explicit_sidecar_bin() {
        candidates.push(explicit);
    }
    if let Ok(resources) = app.path().resource_dir() {
        candidates.push(resources.join("bin").join(SIDECAR_PROGRAM_NAME));
        candidates.push(resources.join(SIDECAR_PROGRAM_NAME));
    }
    let executable_folder = std::env::current_exe()
        .ok()
        .and_then(|executable| executable.parent().map(Path::to_path_buf));
    if let Some(folder) = executable_folder {
        candidates.push(folder.join(SIDECAR_PROGRAM_NAME));
    }
    pick_executable(&candidates).ok_or_else(|| CommandError::Failed {
        code: "sidecar_binary_missing",
        message: format!(
            "The sidecar program was not found. Looked for {}.",
            candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ),
    })
}

/// Returns the first candidate that exists as a file.
pub fn pick_executable(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find(|path| path.is_file()).cloned()
}

fn explicit_sidecar_bin() -> Option<PathBuf> {
    std::env::var(ENV_SIDECAR_BIN)
        .ok()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// One row of the process table, from `ps -axo stat=,pid=,ppid=,ucomm=,args=`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessRow {
    pub pid: u32,
    pub ppid: u32,
    pub ucomm: String,
    pub args: String,
}

/// Kills sidecars left behind by an earlier crash. Only an orphan (parent pid 1) whose executable
/// is the resolved sidecar binary is killed. A process that still has a live parent belongs to
/// another running app and is left alone.
pub fn kill_orphans(binary: &Path) -> CommandResult<u32> {
    let output = Command::new("ps")
        .args(["-axo", "stat=,pid=,ppid=,ucomm=,args="])
        .output()
        .map_err(|error| CommandError::Failed {
            code: "sidecar_ps_failed",
            message: format!("Could not read the process table: {error}"),
        })?;
    if !output.status.success() {
        return Err(CommandError::Failed {
            code: "sidecar_ps_failed",
            message: format!("ps exited with {}.", output.status),
        });
    }
    let table = String::from_utf8_lossy(&output.stdout);
    let rows = parse_process_table(&table);
    let own_pid = std::process::id();
    let paths = [binary.to_path_buf()];
    let mut killed = 0;
    for pid in orphan_pids(&rows, own_pid, &paths) {
        if process_group::signal_group(pid, process_group::SIGKILL) {
            killed += 1;
        }
    }
    Ok(killed)
}

/// Parses the output of `ps -axo stat=,pid=,ppid=,ucomm=,args=`.
pub fn parse_process_table(table: &str) -> Vec<ProcessRow> {
    table.lines().filter_map(parse_process_row).collect()
}

fn parse_process_row(line: &str) -> Option<ProcessRow> {
    let mut parts = line.split_whitespace();
    let _stat = parts.next()?;
    let pid = parts.next()?.parse().ok()?;
    let ppid = parts.next()?.parse().ok()?;
    let ucomm = parts.next()?.to_string();
    let args = parts.collect::<Vec<_>>().join(" ");
    Some(ProcessRow {
        pid,
        ppid,
        ucomm,
        args,
    })
}

/// True for an orphaned sidecar this app started: parent pid 1, the `sidecar` mode argument, and
/// an executable (the first argument) that resolves to one of `paths`. A sidecar with a live
/// parent is another app's and is not matched. A `--version` probe has no mode argument either.
pub fn is_sidecar_process(row: &ProcessRow, paths: &[PathBuf]) -> bool {
    if row.ppid != 1 {
        return false;
    }
    if !row.args.split_whitespace().any(|token| token == "sidecar") {
        return false;
    }
    let Some(executable) = row.args.split_whitespace().next() else {
        return false;
    };
    let executable = Path::new(executable);
    if !executable.is_absolute() {
        return false;
    }
    paths.iter().any(|known| same_executable(executable, known))
}

/// Compares two executable paths. `ps` reports the path the kernel resolved, so a symlinked path
/// and its target are equal. Paths that cannot be resolved are compared as written.
fn same_executable(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

/// The sidecar pids that belong to an earlier run: an orphan that this app did not start.
pub fn orphan_pids(rows: &[ProcessRow], own_pid: u32, paths: &[PathBuf]) -> Vec<u32> {
    rows.iter()
        .filter(|row| row.pid != own_pid)
        .filter(|row| is_sidecar_process(row, paths))
        .map(|row| row.pid)
        .collect()
}

/// Reads the handshake line. `SOCKET_PATH=` followed by the socket path is the only handshake.
pub fn parse_handshake(line: &str) -> Option<PathBuf> {
    line.strip_prefix("SOCKET_PATH=")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

/// Waits for the stdout reader to send the socket path, or fails with a named timeout.
fn read_handshake(receiver: &Receiver<PathBuf>, timeout: Duration) -> CommandResult<PathBuf> {
    receiver.recv_timeout(timeout).map_err(|error| match error {
        RecvTimeoutError::Timeout => CommandError::Failed {
            code: "sidecar_handshake_timeout",
            message: format!(
                "The sidecar did not print SOCKET_PATH within {} ms.",
                timeout.as_millis()
            ),
        },
        // The stdout reader ended, so the sidecar closed its output before the handshake.
        RecvTimeoutError::Disconnected => CommandError::Failed {
            code: "sidecar_exited_early",
            message: "The sidecar ended before it printed SOCKET_PATH. Its log has the reason."
                .to_string(),
        },
    })
}

/// Splits a byte stream into lines. A line over the limit is dropped and the rest of that line is
/// discarded, so memory stays bounded.
pub struct LineFramer {
    max: usize,
    pending: Vec<u8>,
    overflow: bool,
    dropped: bool,
}

impl LineFramer {
    pub fn new(max: usize) -> Self {
        Self {
            max,
            pending: Vec::new(),
            overflow: false,
            dropped: false,
        }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<String> {
        let mut lines = Vec::new();
        let mut rest = bytes;
        loop {
            match rest.iter().position(|byte| *byte == b'\n') {
                Some(index) => {
                    if !self.overflow {
                        self.pending.extend_from_slice(&rest[..index]);
                        if self.pending.len() <= self.max {
                            lines.push(String::from_utf8_lossy(&self.pending).into_owned());
                        } else {
                            self.dropped = true;
                        }
                    }
                    self.pending.clear();
                    self.overflow = false;
                    rest = &rest[index + 1..];
                }
                None => {
                    if !self.overflow {
                        if self.pending.len() + rest.len() > self.max {
                            self.pending.clear();
                            self.overflow = true;
                            self.dropped = true;
                        } else {
                            self.pending.extend_from_slice(rest);
                        }
                    }
                    return lines;
                }
            }
        }
    }

    /// True when a line was dropped since the last call. Clears the flag.
    pub fn take_dropped(&mut self) -> bool {
        let dropped = self.dropped;
        self.dropped = false;
        dropped
    }
}

/// One restart decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RestartPlan {
    pub delay_ms: u64,
    pub restart_count: u32,
    pub will_retry: bool,
}

/// Records one restart and decides whether and after how long to try again.
pub fn plan_restart(recent: &mut Vec<i64>, now_ms: i64) -> RestartPlan {
    let cutoff = now_ms.saturating_sub(RESTART_WINDOW_MS as i64);
    recent.retain(|time| *time > cutoff);
    recent.push(now_ms);
    let restart_count = recent.len() as u32;
    if restart_count > MAX_RESTARTS_PER_WINDOW {
        return RestartPlan {
            delay_ms: 0,
            restart_count,
            will_retry: false,
        };
    }
    let index = (restart_count.saturating_sub(1) as usize).min(RESTART_BACKOFF_MS.len() - 1);
    RestartPlan {
        delay_ms: RESTART_BACKOFF_MS[index],
        restart_count,
        will_retry: true,
    }
}

/// The folders the sidecar reads at start: the parent pid, the outbox root, the log folder, the
/// bin folder and, when the build has one, the bundled skill plugin folder (AGENT-18). The
/// launcher creates the folders it owns before the spawn, and `launch_environment` adds the app
/// version and log level. Agent binaries, ACP providers and the Cursor store wait for the
/// features that read them. There is no database path and no logger token or folder (D026, D028).
pub fn sidecar_environment(
    pid: u32,
    data_dir: &Path,
    skill_plugin_dir: Option<&Path>,
) -> Vec<(String, String)> {
    let log_dir = data_dir.join("logs");
    let bin_dir = data_dir.join("bin");
    let outbox_root = data_dir.join("sidecar-v2-session-event-outbox");
    let text = |path: &Path| path.to_string_lossy().into_owned();
    let mut environment = vec![
        ("CONDUCTED_PARENT_PID".to_string(), pid.to_string()),
        ("CONDUCTED_OUTBOX_ROOT".to_string(), text(&outbox_root)),
        ("CONDUCTED_LOG_DIR".to_string(), text(&log_dir)),
        ("CONDUCTED_BIN_DIR".to_string(), text(&bin_dir)),
    ];
    if let Some(folder) = skill_plugin_dir {
        environment.push((ENV_SKILL_PLUGIN_DIR.to_string(), text(folder)));
    }
    environment
}

/// The full environment of a launch: the folders above plus the app version and log level that the
/// sidecar's logger reads (SIDE-18).
pub fn launch_environment(
    pid: u32,
    data_dir: &Path,
    app_version: &str,
    log_level: &str,
    skill_plugin_dir: Option<&Path>,
) -> Vec<(String, String)> {
    let mut environment = sidecar_environment(pid, data_dir, skill_plugin_dir);
    environment.push(("CONDUCTED_APP_VERSION".to_string(), app_version.to_string()));
    environment.push(("CONDUCTED_LOG_LEVEL".to_string(), log_level.to_string()));
    environment
}

/// Spawns the process, performs the handshake and connects the socket. The caller starts the relay
/// threads, so only one start runs at a time while the state lock is held.
pub async fn start_process<R: Runtime>(
    app: &AppHandle<R>,
    binary: &Path,
    generation: u64,
) -> CommandResult<StartedSidecar> {
    let app = app.clone();
    let binary = binary.to_path_buf();
    blocking("sidecar_start_task_failed", move || {
        blocking_start(&app, &binary, generation)
    })
    .await
}

pub struct StartedSidecar {
    pub pid: u32,
    pub socket_path: PathBuf,
    pub log_path: PathBuf,
    pub stream: UnixStream,
    pub child: Child,
    pub log: Arc<Mutex<File>>,
}

fn blocking_start<R: Runtime>(
    app: &AppHandle<R>,
    binary: &Path,
    _generation: u64,
) -> CommandResult<StartedSidecar> {
    kill_orphans(binary)?;
    let data_dir = app_data_dir(app)?;
    let app_version = app.package_info().version.to_string();
    let log_level = {
        let state = app.state::<logger::LoggerState>();
        logger::level_name(state.level.load(std::sync::atomic::Ordering::Relaxed))
    };
    let skill_dir = skill_plugin_dir(app)?;
    let environment = launch_environment(
        std::process::id(),
        &data_dir,
        &app_version,
        log_level,
        skill_dir.as_deref(),
    );
    for (key, value) in &environment {
        // The skill folder ships with the app, so the launcher must not create or chmod it.
        if is_folder_variable(key) && key != ENV_SKILL_PLUGIN_DIR {
            ensure_dir(Path::new(value), 0o700)?;
        }
    }
    let log_dir = data_dir.join("logs");
    let mut spawned = spawn_sidecar(
        binary,
        &environment,
        &log_dir,
        Duration::from_millis(HANDSHAKE_TIMEOUT_MS),
    )?;
    logger::prune_sidecar_logs(&log_dir, SystemTime::now(), logger::SIDECAR_MAX_BYTES);
    logger::keep_newest_sidecar_logs(&log_dir, LOGS_KEPT);
    let stream = match connect_with_retries(
        &spawned.socket_path,
        Duration::from_millis(CONNECT_TIMEOUT_MS),
    ) {
        Ok(stream) => stream,
        Err(error) => {
            process_group::terminate_group(spawned.pid, Duration::from_millis(500));
            let _ = spawned.child.wait();
            return Err(error);
        }
    };
    Ok(StartedSidecar {
        pid: spawned.pid,
        socket_path: spawned.socket_path,
        log_path: spawned.log_path,
        stream,
        child: spawned.child,
        log: spawned.log,
    })
}

fn is_folder_variable(key: &str) -> bool {
    key.ends_with("_DIR") || key.ends_with("_ROOT")
}

fn app_data_dir<R: Runtime>(app: &AppHandle<R>) -> CommandResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|error| CommandError::Failed {
            code: "sidecar_data_dir_failed",
            message: format!("Could not find the app data folder: {error}"),
        })
}

fn ensure_dir(path: &Path, mode: u32) -> CommandResult<PathBuf> {
    fs::create_dir_all(path).map_err(|error| CommandError::Failed {
        code: "sidecar_folder_failed",
        message: format!("Could not create {}: {error}", path.display()),
    })?;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|error| {
        CommandError::Failed {
            code: "sidecar_folder_failed",
            message: format!(
                "Could not set the permissions of {}: {error}",
                path.display()
            ),
        }
    })?;
    Ok(path.to_path_buf())
}

/// One spawned sidecar whose handshake has been read. The caller owns the child and must stop it.
pub struct SpawnedSidecar {
    pub pid: u32,
    pub socket_path: PathBuf,
    pub log_path: PathBuf,
    pub child: Child,
    pub log: Arc<Mutex<File>>,
}

/// Spawns one sidecar and reads its handshake.
fn spawn_sidecar(
    binary: &Path,
    environment: &[(String, String)],
    log_dir: &Path,
    timeout: Duration,
) -> CommandResult<SpawnedSidecar> {
    let mut command = Command::new(binary);
    command
        .arg("sidecar")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    for (key, value) in environment {
        command.env(key, value);
    }
    let mut child = command.spawn().map_err(|error| CommandError::Failed {
        code: "sidecar_spawn_failed",
        message: format!("Could not start {}: {error}", binary.display()),
    })?;
    let pid = child.id();
    let log_path = log_dir.join(format!("sidecar-{pid}.log"));
    let log = match open_log_file(&log_path) {
        Ok(file) => Arc::new(Mutex::new(file)),
        Err(error) => {
            process_group::terminate_group(pid, Duration::from_millis(500));
            let _ = child.wait();
            return Err(CommandError::Failed {
                code: "sidecar_log_failed",
                message: format!("Could not create {}: {error}", log_path.display()),
            });
        }
    };

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            process_group::terminate_group(pid, Duration::from_millis(500));
            let _ = child.wait();
            return Err(CommandError::Failed {
                code: "sidecar_pipe_failed",
                message: "The sidecar has no stdout pipe.".to_string(),
            });
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            process_group::terminate_group(pid, Duration::from_millis(500));
            let _ = child.wait();
            return Err(CommandError::Failed {
                code: "sidecar_pipe_failed",
                message: "The sidecar has no stderr pipe.".to_string(),
            });
        }
    };
    let (handshake_sender, handshake_receiver) = mpsc::channel::<PathBuf>();

    let stdout_log = Arc::clone(&log);
    thread::spawn(move || {
        drain_lines(stdout, &stdout_log, "stdout", |line| {
            if let Some(path) = parse_handshake(line) {
                // The receiver is gone once the handshake finished or timed out. A second
                // handshake line then has nowhere to go and is not an error.
                let _ = handshake_sender.send(path);
                return true;
            }
            false
        });
    });

    let stderr_log = Arc::clone(&log);
    thread::spawn(move || {
        drain_lines(stderr, &stderr_log, "stderr", |_| false);
    });

    match read_handshake(&handshake_receiver, timeout) {
        Ok(socket_path) => Ok(SpawnedSidecar {
            pid,
            socket_path,
            log_path,
            child,
            log,
        }),
        Err(error) => {
            process_group::terminate_group(pid, Duration::from_millis(500));
            let _ = child.wait();
            Err(error)
        }
    }
}

/// Reads a child's output pipe to the end, one line at a time, and writes each line to the log
/// unless `consume` takes it. Bytes that are not UTF-8 are replaced and a line over
/// `MAX_LINE_BYTES` is dropped with a log entry, so the pipe is always emptied. A pipe nobody
/// empties fills up and blocks the sidecar.
fn drain_lines<R: Read>(
    mut reader: R,
    log: &Arc<Mutex<File>>,
    stream: &str,
    mut consume: impl FnMut(&str) -> bool,
) {
    let mut framer = LineFramer::new(MAX_LINE_BYTES);
    let mut buffer = [0u8; 16 * 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return,
            Ok(read) => {
                for line in framer.push(&buffer[..read]) {
                    let line = line.trim_end_matches('\r');
                    if !line.is_empty() && !consume(line) {
                        log_line(log, stream, line);
                    }
                }
                if framer.take_dropped() {
                    log_line(log, stream, "A line was dropped because it was too long.");
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => {
                log_line(log, stream, &format!("The pipe could not be read: {error}"));
                return;
            }
        }
    }
}

fn connect_with_retries(path: &Path, timeout: Duration) -> CommandResult<UnixStream> {
    let deadline = Instant::now() + timeout;
    loop {
        match UnixStream::connect(path) {
            Ok(stream) => return Ok(stream),
            Err(_) if Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(20));
            }
            Err(error) => {
                return Err(CommandError::Failed {
                    code: "sidecar_connect_failed",
                    message: format!("Could not connect to {}: {error}", path.display()),
                });
            }
        }
    }
}

fn open_log_file(path: &Path) -> std::io::Result<File> {
    let file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(file)
}

fn log_line(log: &Arc<Mutex<File>>, stream: &str, line: &str) {
    log_line_with_cap(log, stream, line, logger::SIDECAR_MAX_BYTES);
}

fn log_line_with_cap(log: &Arc<Mutex<File>>, stream: &str, line: &str, max_bytes: u64) {
    let Ok(mut file) = log.lock() else {
        eprintln!("sidecar: the log lock is poisoned");
        return;
    };
    // The export bundles this file for a bug report, so key shapes are cut out as the app log does.
    let line = logger::redact_text(line);
    if let Err(error) = writeln!(file, "[{stream}] {line}") {
        eprintln!("sidecar: could not write its log: {error}");
        return;
    }
    if let Err(error) = file.flush() {
        eprintln!("sidecar: could not flush its log: {error}");
        return;
    }
    if let Err(error) = logger::cap_sidecar_log(&mut file, max_bytes) {
        eprintln!("sidecar: could not cap its log: {error}");
    }
}

/// The newest sidecar log, used to keep the failure screen useful when a start fails.
fn latest_log_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let data_dir = app_data_dir(app).ok()?;
    let mut files = logger::sidecar_log_files(&data_dir.join("logs"));
    files.sort_by_key(|entry| std::cmp::Reverse(entry.1));
    files.into_iter().next().map(|(path, _)| path)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Starts one process and makes it the current one. The caller holds the state lock.
async fn start_locked<R: Runtime>(
    app: &AppHandle<R>,
    inner: &mut SidecarInner,
) -> CommandResult<SidecarHandle> {
    let binary = resolve_binary(app)?;
    let version = app.package_info().version.to_string();
    check_binary_version(&binary, &version).await?;
    inner.phase = SidecarPhase::Starting;
    inner.generation += 1;
    let generation = inner.generation;
    let started = match start_process(app, &binary, generation).await {
        Ok(started) => started,
        Err(error) => {
            if let Some(path) = latest_log_path(app) {
                inner.last_log_path = Some(path);
            }
            inner.phase = SidecarPhase::Stopped;
            return Err(error);
        }
    };
    attach_relay(app, inner, started, generation)
}

/// Makes a connected process the running one: starts the reader that turns socket lines into
/// `sidecar://line`, the writer that drains `sidecar_send`, and the supervisor that waits for the
/// process to end, then announces `sidecar://ready`. The caller holds the state lock.
fn attach_relay<R: Runtime>(
    app: &AppHandle<R>,
    inner: &mut SidecarInner,
    started: StartedSidecar,
    generation: u64,
) -> CommandResult<SidecarHandle> {
    let reader_stream = match started.stream.try_clone() {
        Ok(stream) => stream,
        Err(error) => {
            inner.last_log_path = Some(started.log_path.clone());
            let mut child = started.child;
            process_group::terminate_group(child.id(), Duration::from_millis(KILL_GRACE_MS));
            let _ = child.wait();
            inner.phase = SidecarPhase::Stopped;
            return Err(CommandError::Failed {
                code: "sidecar_socket_failed",
                message: format!("Could not share the sidecar socket: {error}"),
            });
        }
    };
    inner.last_log_path = Some(started.log_path.clone());
    let (outgoing, receiver) = mpsc::channel::<String>();
    let handle = SidecarHandle {
        pid: started.pid,
        generation,
        socket_path: started.socket_path.clone(),
        log_path: started.log_path.clone(),
        outgoing,
    };
    inner.phase = SidecarPhase::Running(handle.clone());
    spawn_reader(
        app.clone(),
        generation,
        reader_stream,
        Arc::clone(&started.log),
    );
    spawn_writer(started.stream, receiver);
    spawn_supervisor(app.clone(), generation, started.child);
    let _ = app.emit(EVENT_READY, ());
    Ok(handle)
}

fn spawn_reader<R: Runtime>(
    app: AppHandle<R>,
    generation: u64,
    mut stream: UnixStream,
    log: Arc<Mutex<File>>,
) {
    thread::spawn(move || {
        let mut framer = LineFramer::new(MAX_LINE_BYTES);
        let mut buffer = [0u8; 64 * 1024];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    for line in framer.push(&buffer[..read]) {
                        let _ = app.emit(EVENT_LINE, line);
                    }
                    if framer.take_dropped() {
                        log_line(
                            &log,
                            "relay",
                            "A sidecar line was dropped because it was too long.",
                        );
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        log_line(&log, "relay", "The sidecar socket closed.");
        tauri::async_runtime::spawn(async move {
            let state = app.state::<SidecarState>();
            let _ = on_process_ended(
                &app,
                &state,
                generation,
                SidecarExitReason::SocketClosed,
                None,
            )
            .await;
        });
    });
}

fn spawn_writer(mut stream: UnixStream, receiver: Receiver<String>) {
    thread::spawn(move || {
        let mut writer = BufWriter::new(&mut stream);
        for line in receiver {
            if writeln!(writer, "{line}").is_err() {
                break;
            }
            if writer.flush().is_err() {
                break;
            }
        }
    });
}

fn spawn_supervisor<R: Runtime>(app: AppHandle<R>, generation: u64, mut child: Child) {
    thread::spawn(move || {
        let exit_code = match child.wait() {
            Ok(status) => status.code(),
            Err(_) => None,
        };
        tauri::async_runtime::spawn(async move {
            let state = app.state::<SidecarState>();
            let _ = on_process_ended(
                &app,
                &state,
                generation,
                SidecarExitReason::Exited,
                exit_code,
            )
            .await;
        });
    });
}

/// Takes the end report of process `generation`. Only the newest running process may change
/// state: a report from an older process, or a second report for the same one, finds the phase
/// moved on and gets `None`. The running process becomes `Stopped` and its pid is returned.
fn claim_exit(inner: &mut SidecarInner, generation: u64) -> Option<u32> {
    let pid = match &inner.phase {
        SidecarPhase::Running(handle) if handle.generation == generation => handle.pid,
        _ => return None,
    };
    inner.phase = SidecarPhase::Stopped;
    Some(pid)
}

/// Handles the end of a process: drops the report when `generation` is not the newest, emits
/// `sidecar://restart`, and schedules the next start according to the restart policy.
pub async fn on_process_ended<R: Runtime>(
    app: &AppHandle<R>,
    state: &SidecarState,
    generation: u64,
    reason: SidecarExitReason,
    exit_code: Option<i32>,
) -> CommandResult<()> {
    let mut inner = state.inner.lock().await;
    let Some(pid) = claim_exit(&mut inner, generation) else {
        return Ok(());
    };
    drop(inner);
    // Clean up the whole group for both reasons: a crash can leave grandchildren behind just as a
    // closed socket can. The lock is not held while this waits, so sends and reads are not blocked.
    let _ = tauri::async_runtime::spawn_blocking(move || {
        process_group::terminate_group(pid, Duration::from_millis(KILL_GRACE_MS));
    })
    .await;
    let mut inner = state.inner.lock().await;
    if inner.generation != generation {
        return Ok(());
    }
    let plan = plan_restart(&mut inner.recent_restarts_ms, now_ms());
    inner.phase = if plan.will_retry {
        SidecarPhase::Restarting {
            attempt: plan.restart_count,
        }
    } else {
        SidecarPhase::Stopped
    };
    drop(inner);
    let payload = SidecarRestart {
        reason,
        exit_code,
        restart_count: plan.restart_count,
        will_retry: plan.will_retry,
    };
    let _ = app.emit(EVENT_RESTART, payload);
    if !plan.will_retry {
        return Ok(());
    }
    let delay = plan.delay_ms;
    let _ = tauri::async_runtime::spawn_blocking(move || {
        thread::sleep(Duration::from_millis(delay));
    })
    .await;
    let mut inner = state.inner.lock().await;
    match &inner.phase {
        SidecarPhase::Restarting { attempt } if *attempt == plan.restart_count => {}
        _ => return Ok(()),
    }
    match start_locked(app, &mut inner).await {
        Ok(_) => Ok(()),
        Err(error) => {
            inner.phase = SidecarPhase::Stopped;
            drop(inner);
            let failed = SidecarRestart {
                reason: SidecarExitReason::Exited,
                exit_code: None,
                restart_count: plan.restart_count,
                will_retry: false,
            };
            let _ = app.emit(EVENT_RESTART, failed);
            Err(error)
        }
    }
}

/// Stops the process for good: used when the app quits.
pub async fn shutdown(state: &SidecarState) -> CommandResult<()> {
    let pid = {
        let mut inner = state.inner.lock().await;
        match std::mem::replace(&mut inner.phase, SidecarPhase::Stopped) {
            SidecarPhase::Running(handle) => handle.pid,
            _ => return Ok(()),
        }
    };
    blocking("sidecar_stop_failed", move || {
        process_group::terminate_group(pid, Duration::from_millis(KILL_GRACE_MS));
        Ok(())
    })
    .await
}

/// Starts the sidecar if it is not running. Returns when the socket is connected.
#[tauri::command]
pub async fn sidecar_ensure_started<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, SidecarState>,
) -> CommandResult<()> {
    let mut inner = state.inner.lock().await;
    if matches!(&inner.phase, SidecarPhase::Running(_)) {
        return Ok(());
    }
    start_locked(&app, &mut inner).await?;
    Ok(())
}

/// Writes one line to the sidecar. The line must not contain a newline; one is added.
#[tauri::command]
pub async fn sidecar_send(state: State<'_, SidecarState>, line: String) -> CommandResult<()> {
    if line.contains('\n') || line.contains('\r') {
        return Err(CommandError::Failed {
            code: "sidecar_bad_line",
            message: "A sidecar line must not contain a newline.".to_string(),
        });
    }
    let inner = state.inner.lock().await;
    match &inner.phase {
        SidecarPhase::Running(handle) => {
            handle
                .outgoing
                .send(line)
                .map_err(|_| CommandError::Failed {
                    code: "sidecar_write_failed",
                    message: "The sidecar socket is closed.".to_string(),
                })
        }
        _ => Err(CommandError::Failed {
            code: "sidecar_not_running",
            message: "The sidecar is not running.".to_string(),
        }),
    }
}

/// Path of the current sidecar log file.
#[tauri::command]
pub async fn sidecar_log_path(state: State<'_, SidecarState>) -> CommandResult<String> {
    let inner = state.inner.lock().await;
    if let SidecarPhase::Running(handle) = &inner.phase {
        return Ok(handle.log_path.to_string_lossy().into_owned());
    }
    match &inner.last_log_path {
        Some(path) => Ok(path.to_string_lossy().into_owned()),
        None => Err(CommandError::Failed {
            code: "sidecar_not_running",
            message: "The sidecar has not started yet.".to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;
    use std::io::{BufRead, BufReader};
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixListener;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A folder that removes itself, so a test leaves nothing behind.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-side-23-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test folder");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    /// A relay attached to a stand-in sidecar over a mock app: a socket pair for the sidecar's
    /// end and a `sleep` process in its own group for the sidecar itself. It stops the process on
    /// drop, so a failed assertion leaves nothing running.
    struct AttachedRelay {
        app: tauri::App<tauri::test::MockRuntime>,
        handle: SidecarHandle,
        sidecar_end: UnixStream,
        ready: Receiver<()>,
        lines: Receiver<String>,
        _folder: TempDir,
    }

    impl AttachedRelay {
        fn new() -> Self {
            use tauri::Listener;
            let folder = TempDir::new();
            let app = tauri::test::mock_app();
            app.manage(SidecarState::default());
            let (ready_sender, ready) = mpsc::channel::<()>();
            app.handle().listen(EVENT_READY, move |_| {
                let _ = ready_sender.send(());
            });
            let (line_sender, lines) = mpsc::channel::<String>();
            app.handle().listen(EVENT_LINE, move |event| {
                let _ = line_sender.send(event.payload().to_string());
            });
            let (relay_end, sidecar_end) = UnixStream::pair().expect("make a socket pair");
            let child = Command::new("sleep")
                .arg("30")
                .process_group(0)
                .spawn()
                .expect("start a stand-in sidecar");
            let log_path = folder.path().join("sidecar.log");
            let log = Arc::new(Mutex::new(open_log_file(&log_path).expect("open the log")));
            let started = StartedSidecar {
                pid: child.id(),
                socket_path: folder.path().join("relay.sock"),
                log_path,
                stream: relay_end,
                child,
                log,
            };
            let handle = {
                let state = app.state::<SidecarState>();
                tauri::async_runtime::block_on(async {
                    let mut inner = state.inner.lock().await;
                    attach_relay(app.handle(), &mut inner, started, 1)
                })
                .expect("the relay attaches")
            };
            Self {
                app,
                handle,
                sidecar_end,
                ready,
                lines,
                _folder: folder,
            }
        }
    }

    impl Drop for AttachedRelay {
        fn drop(&mut self) {
            let state = self.app.state::<SidecarState>();
            if let Err(error) = tauri::async_runtime::block_on(shutdown(&state)) {
                eprintln!("could not stop the stand-in sidecar: {error}");
            }
        }
    }

    fn script(folder: &TempDir, name: &str, body: &str) -> PathBuf {
        let path = folder.path().join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("make it executable");
        path
    }

    fn check(binary: &Path, version: &str) -> CommandResult<()> {
        tauri::async_runtime::block_on(check_binary_version(binary, version))
    }

    fn error_code(error: CommandError) -> &'static str {
        match error {
            CommandError::Failed { code, .. } => code,
            _ => "other",
        }
    }

    fn write_log(folder: &TempDir, name: &str) -> PathBuf {
        let path = folder.path().join(name);
        fs::write(&path, "line\n").expect("write log");
        path
    }

    /// Writes a log with a known modified time, so "the newest" is not a guess.
    fn write_log_at(folder: &TempDir, name: &str, seconds: u64) -> PathBuf {
        let path = folder.path().join(name);
        let file = fs::File::create(&path).expect("write log");
        let modified = UNIX_EPOCH + Duration::from_secs(seconds);
        file.set_modified(modified).expect("set log time");
        path
    }

    /// The environment variable names `packages/sidecar` reads, from its TypeScript source.
    fn sidecar_env_names() -> String {
        fn collect(dir: &Path, text: &mut String) {
            let Ok(entries) = fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    collect(&path, text);
                } else if path.extension().and_then(|extension| extension.to_str()) == Some("ts")
                    && !path
                        .file_name()
                        .and_then(|name| name.to_str())
                        .is_some_and(|name| name.ends_with(".test.ts"))
                {
                    text.push_str(&fs::read_to_string(&path).expect("read sidecar source"));
                }
            }
        }
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../packages/sidecar/src");
        let mut text = String::new();
        collect(&source, &mut text);
        text
    }

    #[test]
    fn side_23_a_matching_version_passes() {
        let folder = TempDir::new();
        let binary = script(&folder, "sidecar", "printf 'conducted-sidecar 0.1.0\\n'");
        check(&binary, "0.1.0").expect("the version matches");
    }

    #[test]
    fn side_23_a_different_version_is_a_mismatch() {
        let folder = TempDir::new();
        let binary = script(&folder, "sidecar", "printf 'conducted-sidecar 0.0.9\\n'");
        let error = check(&binary, "0.1.0").expect_err("the version differs");
        assert_eq!(error_code(error), "sidecar_version_mismatch");
    }

    #[test]
    fn side_23_a_wrong_program_name_is_a_mismatch() {
        let folder = TempDir::new();
        let binary = script(&folder, "sidecar", "printf 'some-other-sidecar 0.1.0\\n'");
        let error = check(&binary, "0.1.0").expect_err("the program name differs");
        assert_eq!(error_code(error), "sidecar_version_mismatch");
    }

    #[test]
    fn side_23_a_missing_binary_fails_the_check() {
        let folder = TempDir::new();
        let binary = folder.path().join("missing");
        let error = check(&binary, "0.1.0").expect_err("the binary does not exist");
        assert_eq!(error_code(error), "sidecar_version_check_failed");
    }

    #[test]
    fn side_23_a_command_that_fails_fails_the_check() {
        let folder = TempDir::new();
        let binary = script(&folder, "sidecar", "exit 2");
        let error = check(&binary, "0.1.0").expect_err("the command refused");
        assert_eq!(error_code(error), "sidecar_version_check_failed");
    }

    #[test]
    fn plat_09_parse_handshake_reads_the_socket_path() {
        let path = parse_handshake("SOCKET_PATH=/tmp/conducted-sidecar-7.sock");
        assert_eq!(path, Some(PathBuf::from("/tmp/conducted-sidecar-7.sock")));
    }

    #[test]
    fn plat_09_a_line_without_the_prefix_is_not_a_handshake() {
        assert_eq!(parse_handshake("HTTP_PORT=1234"), None);
        assert_eq!(parse_handshake("SOCKET_PATH="), None);
    }

    #[test]
    fn plat_09_pick_executable_uses_the_first_existing_file() {
        let folder = TempDir::new();
        let missing = folder.path().join("missing");
        let present = write_log(&folder, "present");
        assert_eq!(pick_executable(&[missing, present.clone()]), Some(present));
    }

    #[test]
    fn plat_09_pick_executable_reports_nothing_when_all_are_missing() {
        assert_eq!(pick_executable(&[PathBuf::from("/no/such/file")]), None);
    }

    #[test]
    fn plat_09_line_framer_splits_on_newlines() {
        let mut framer = LineFramer::new(16);
        assert_eq!(framer.push(b"a\nb"), vec!["a".to_string()]);
        assert_eq!(framer.push(b"\n"), vec!["b".to_string()]);
    }

    #[test]
    fn plat_09_line_framer_drops_an_overlong_line() {
        let mut framer = LineFramer::new(4);
        assert_eq!(framer.push(b"12345\nok\n"), vec!["ok".to_string()]);
    }

    #[test]
    fn plat_09_line_framer_keeps_a_line_at_the_limit() {
        let mut framer = LineFramer::new(4);
        assert_eq!(framer.push(b"1234\n"), vec!["1234".to_string()]);
        assert!(!framer.take_dropped());
    }

    #[test]
    fn plat_09_line_framer_reports_a_dropped_line() {
        let mut framer = LineFramer::new(4);
        assert!(framer.push(b"12345\n").is_empty());
        assert!(framer.take_dropped());
        assert!(!framer.take_dropped());
    }

    #[test]
    fn plat_09_restart_backs_off_then_stops_after_five_in_one_window() {
        let mut recent = Vec::new();
        let first = plan_restart(&mut recent, 1_000_000);
        assert_eq!(first.delay_ms, RESTART_BACKOFF_MS[0]);
        assert!(first.will_retry);
        let mut last = first;
        for _ in 2..=5 {
            last = plan_restart(&mut recent, 1_000_000);
        }
        assert_eq!(last.restart_count, MAX_RESTARTS_PER_WINDOW);
        assert_eq!(
            last.delay_ms,
            RESTART_BACKOFF_MS[RESTART_BACKOFF_MS.len() - 1]
        );
        let stopped = plan_restart(&mut recent, 1_000_000);
        assert!(!stopped.will_retry);
    }

    #[test]
    fn plat_09_restart_window_forgets_old_restarts() {
        let mut recent = Vec::new();
        for _ in 0..MAX_RESTARTS_PER_WINDOW {
            plan_restart(&mut recent, 1_000_000);
        }
        let after_window = plan_restart(&mut recent, 1_000_000 + RESTART_WINDOW_MS as i64 + 1);
        assert!(after_window.will_retry);
        assert_eq!(after_window.restart_count, 1);
    }

    fn row(pid: u32, ppid: u32, name: &str, args: &str) -> ProcessRow {
        ProcessRow {
            pid,
            ppid,
            ucomm: name.to_string(),
            args: args.to_string(),
        }
    }

    #[test]
    fn plat_09_orphan_matching_kills_only_a_parentless_sidecar() {
        let folder = TempDir::new();
        let sidecar = script(&folder, "conducted-sidecar", "exit 0");
        let other = script(&folder, "other-program", "exit 0");
        let rows = vec![
            row(
                100,
                1,
                "conducted-sidecar",
                &format!("{} sidecar", sidecar.display()),
            ),
            row(
                101,
                1,
                "other-program",
                &format!("{} sidecar", other.display()),
            ),
            row(
                102,
                1,
                "conducted-sidecar",
                &format!("{} --version", sidecar.display()),
            ),
            row(
                200,
                42,
                "conducted-sidecar",
                &format!("{} sidecar", sidecar.display()),
            ),
        ];
        let paths = vec![sidecar];
        assert_eq!(orphan_pids(&rows, 42, &paths), vec![100]);
    }

    #[test]
    fn plat_09_a_sidecar_of_another_running_app_is_not_killed() {
        let folder = TempDir::new();
        let sidecar = script(&folder, "conducted-sidecar", "exit 0");
        let rows = vec![row(
            200,
            42,
            "conducted-sidecar",
            &format!("{} sidecar", sidecar.display()),
        )];
        let paths = vec![sidecar];
        assert!(orphan_pids(&rows, 1, &paths).is_empty());
    }

    #[test]
    fn plat_09_a_bun_process_with_the_sidecar_word_is_not_killed() {
        let folder = TempDir::new();
        let sidecar = script(&folder, "conducted-sidecar", "exit 0");
        let rows = vec![row(300, 1, "bun", "/usr/bin/bun run sidecar")];
        let paths = vec![sidecar];
        assert!(orphan_pids(&rows, 1, &paths).is_empty());
    }

    #[test]
    fn plat_09_parse_process_table_reads_the_columns() {
        let table = "S  100  1  conducted-sidecar  /x/conducted-sidecar sidecar\n";
        let rows = parse_process_table(table);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, 100);
        assert_eq!(rows[0].ppid, 1);
        assert_eq!(rows[0].ucomm, "conducted-sidecar");
    }

    #[test]
    fn plat_09_log_files_keep_the_newest_five() {
        let folder = TempDir::new();
        for index in 0..7u64 {
            write_log_at(&folder, &format!("sidecar-{index}.log"), 1_000 + index);
        }
        let removed = logger::keep_newest_sidecar_logs(folder.path(), LOGS_KEPT);
        assert_eq!(removed, 2);
        for index in 2..7 {
            assert!(
                folder.path().join(format!("sidecar-{index}.log")).is_file(),
                "sidecar-{index}.log is among the newest five"
            );
        }
        for index in 0..2 {
            assert!(
                !folder.path().join(format!("sidecar-{index}.log")).exists(),
                "sidecar-{index}.log was the oldest and should be removed"
            );
        }
    }

    #[test]
    fn plat_09_log_files_ignore_other_files() {
        let folder = TempDir::new();
        write_log(&folder, "notes.txt");
        write_log(&folder, "app-2026-11-05.ndjson");
        assert_eq!(logger::keep_newest_sidecar_logs(folder.path(), 0), 0);
        assert!(folder.path().join("notes.txt").is_file());
        assert!(folder.path().join("app-2026-11-05.ndjson").is_file());
    }

    #[test]
    fn plat_09_log_file_is_owner_only() {
        let folder = TempDir::new();
        let path = folder.path().join("sidecar-9.log");
        let _file = open_log_file(&path).expect("create log");
        let mode = fs::metadata(&path).expect("stat log").permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn plat_09_an_older_log_file_with_open_permissions_becomes_owner_only() {
        let folder = TempDir::new();
        let path = folder.path().join("sidecar-10.log");
        fs::write(&path, "old\n").expect("write log");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("open it up");
        let _file = open_log_file(&path).expect("reopen log");
        let mode = fs::metadata(&path).expect("stat log").permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn plat_09_the_sidecar_environment_names_every_folder() {
        let data = Path::new("/tmp/conducted-data");
        let environment = sidecar_environment(42, data, None);
        let map: HashMap<&str, &str> = environment
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();
        assert_eq!(map.get("CONDUCTED_PARENT_PID"), Some(&"42"));
        assert_eq!(
            map.get("CONDUCTED_LOG_DIR"),
            Some(&"/tmp/conducted-data/logs")
        );
        assert_eq!(
            map.get("CONDUCTED_BIN_DIR"),
            Some(&"/tmp/conducted-data/bin")
        );
        assert_eq!(
            map.get("CONDUCTED_OUTBOX_ROOT"),
            Some(&"/tmp/conducted-data/sidecar-v2-session-event-outbox")
        );
        assert!(!map.contains_key("CONDUCTED_DB_PATH"));
        assert!(!map.contains_key("CONDUCTED_LOGGER_TOKEN"));
        assert!(!map.contains_key("CONDUCTED_LOGGER_DIR"));
    }

    #[test]
    fn plat_18_the_launch_environment_adds_the_app_version_and_log_level() {
        let environment =
            launch_environment(42, Path::new("/tmp/conducted-data"), "1.2.3", "debug", None);
        let map: HashMap<&str, &str> = environment
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();
        assert_eq!(map.get("CONDUCTED_PARENT_PID"), Some(&"42"));
        assert_eq!(map.get("CONDUCTED_APP_VERSION"), Some(&"1.2.3"));
        assert_eq!(map.get("CONDUCTED_LOG_LEVEL"), Some(&"debug"));
    }

    #[test]
    fn plat_09_the_launcher_sets_only_variables_the_sidecar_reads() {
        let source = sidecar_env_names();
        assert!(
            source.contains("CONDUCTED_BIN_DIR"),
            "the sidecar source was not found"
        );
        let environment = sidecar_environment(42, Path::new("/tmp/conducted-data"), None);
        let keys: Vec<&str> = environment.iter().map(|(key, _)| key.as_str()).collect();
        for key in [
            "CONDUCTED_PARENT_PID",
            "CONDUCTED_OUTBOX_ROOT",
            "CONDUCTED_LOG_DIR",
            "CONDUCTED_BIN_DIR",
        ] {
            assert!(keys.contains(&key), "the launcher does not set {key}");
        }
        for key in &keys {
            assert!(
                source.contains(&format!("\"{key}\"")),
                "the launcher sets {key}, but packages/sidecar never reads it"
            );
        }
    }

    #[test]
    fn agent_18_finds_the_bundled_skill_folder_only_when_it_exists() {
        let folder = TempDir::new();
        assert_eq!(find_skill_plugin_dir(folder.path()), None);
        let skill = folder.path().join(SKILL_PLUGIN_FOLDER);
        fs::create_dir_all(skill.join(".claude-plugin")).expect("create skill folder");
        assert_eq!(find_skill_plugin_dir(folder.path()), Some(skill));
    }

    #[test]
    fn agent_18_the_launch_environment_gives_the_sidecar_the_skill_folder() {
        let folder = TempDir::new();
        let environment = launch_environment(
            42,
            Path::new("/tmp/conducted-data"),
            "1.2.3",
            "debug",
            Some(folder.path()),
        );
        let map: HashMap<&str, &str> = environment
            .iter()
            .map(|(key, value)| (key.as_str(), value.as_str()))
            .collect();
        let expected = folder.path().to_string_lossy().into_owned();
        assert_eq!(
            map.get(ENV_SKILL_PLUGIN_DIR).copied(),
            Some(expected.as_str())
        );
        let source = sidecar_env_names();
        assert!(
            source.contains(&format!("\"{ENV_SKILL_PLUGIN_DIR}\"")),
            "the launcher sets {ENV_SKILL_PLUGIN_DIR}, but packages/sidecar never reads it"
        );
    }

    #[test]
    fn agent_18_a_build_without_the_skill_folder_sets_no_variable() {
        let environment = sidecar_environment(42, Path::new("/tmp/conducted-data"), None);
        assert!(
            !environment
                .iter()
                .any(|(key, _)| key == ENV_SKILL_PLUGIN_DIR)
        );
    }

    #[test]
    fn agent_18_the_bundled_skill_has_a_plugin_manifest_and_a_guide() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join(SKILL_PLUGIN_FOLDER);
        let manifest = fs::read_to_string(root.join(".claude-plugin").join("plugin.json"))
            .expect("the bundled skill has a plugin manifest");
        let parsed: serde_json::Value =
            serde_json::from_str(&manifest).expect("the plugin manifest is JSON");
        assert_eq!(parsed["name"], "conducted");
        let guide = fs::read_to_string(root.join("skills").join("conducted").join("SKILL.md"))
            .expect("the bundled skill has a guide");
        assert!(
            guide.lines().count() >= 150,
            "the guide is too short to teach the app"
        );
        assert!(guide.contains("CONDUCTED_WORKSPACE_PATH"));
        assert!(
            !guide.contains("CONDUCTOR_"),
            "the guide must name only CONDUCTED_* variables (D027)"
        );
    }

    #[test]
    fn plat_09_read_handshake_times_out_with_a_named_error() {
        let (_sender, receiver) = mpsc::channel::<PathBuf>();
        let error =
            read_handshake(&receiver, Duration::from_millis(20)).expect_err("nothing was sent");
        assert_eq!(error_code(error), "sidecar_handshake_timeout");
    }

    #[test]
    fn plat_09_a_fake_sidecar_prints_its_socket_path() {
        let folder = TempDir::new();
        let socket = folder.path().join("fake.sock");
        let binary = script(
            &folder,
            "fake-sidecar",
            &format!(
                "if [ \"$1\" = sidecar ]; then printf 'SOCKET_PATH={}\\n'; exec sleep 30; fi; exit 64",
                socket.display()
            ),
        );
        let mut spawned = spawn_sidecar(&binary, &[], folder.path(), Duration::from_secs(2))
            .expect("read the handshake");
        assert_eq!(spawned.socket_path, socket);
        assert!(spawned.log_path.is_file());
        process_group::terminate_group(spawned.pid, Duration::from_millis(500));
        let _ = spawned.child.wait();
    }

    #[test]
    fn plat_09_a_start_announces_ready_on_the_documented_event() {
        assert_eq!(EVENT_READY, "sidecar://ready");
        let relay = AttachedRelay::new();
        relay
            .ready
            .recv_timeout(Duration::from_secs(5))
            .expect("attaching the relay announces sidecar://ready");
    }

    #[test]
    fn plat_09_the_relay_carries_lines_both_ways() {
        let mut relay = AttachedRelay::new();
        relay
            .ready
            .recv_timeout(Duration::from_secs(5))
            .expect("the relay is up");

        // A line the sidecar writes reaches the window on sidecar://line, as a JSON string.
        writeln!(relay.sidecar_end, "{{\"jsonrpc\":\"2.0\"}}").expect("the sidecar writes a line");
        let heard = relay
            .lines
            .recv_timeout(Duration::from_secs(5))
            .expect("the line reaches the window");
        assert_eq!(heard, "\"{\\\"jsonrpc\\\":\\\"2.0\\\"}\"");

        // A line the window sends reaches the sidecar's socket, one line per message.
        relay
            .handle
            .outgoing
            .send("from the window".to_string())
            .expect("queue a line for the sidecar");
        relay
            .sidecar_end
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("set a read timeout");
        let mut reader = BufReader::new(&relay.sidecar_end);
        let mut received = String::new();
        reader
            .read_line(&mut received)
            .expect("the sidecar reads a line");
        assert_eq!(received, "from the window\n");
    }

    #[test]
    fn plat_09_shutdown_stops_a_running_sidecar() {
        let mut child = Command::new("sleep")
            .arg("30")
            .process_group(0)
            .spawn()
            .expect("start a fake sidecar");
        let pid = child.id();
        let reaper = std::thread::spawn(move || child.wait());
        let (outgoing, _receiver) = mpsc::channel::<String>();
        let state = SidecarState {
            inner: tauri::async_runtime::Mutex::new(SidecarInner {
                phase: SidecarPhase::Running(SidecarHandle {
                    pid,
                    generation: 1,
                    socket_path: PathBuf::from("/tmp/conducted-fake.sock"),
                    log_path: PathBuf::from("/tmp/conducted-fake.log"),
                    outgoing,
                }),
                generation: 1,
                recent_restarts_ms: Vec::new(),
                last_log_path: None,
            }),
        };
        tauri::async_runtime::block_on(shutdown(&state)).expect("shutdown");
        let status = reaper
            .join()
            .expect("the reaper finishes")
            .expect("wait for the fake sidecar");
        assert!(!status.success(), "the fake sidecar was stopped");
        assert!(!process_group::group_exists(pid));
    }

    #[test]
    fn plat_09_the_writer_sends_one_line_per_message() {
        let folder = TempDir::new();
        let socket = folder.path().join("relay.sock");
        let listener = UnixListener::bind(&socket).expect("bind socket");
        let client = UnixStream::connect(&socket).expect("connect");
        let (server, _) = listener.accept().expect("accept");
        server
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("set timeout");
        let (sender, receiver) = mpsc::channel::<String>();
        spawn_writer(client, receiver);
        sender.send("first".to_string()).expect("send first");
        sender.send("second".to_string()).expect("send second");
        drop(sender);
        let mut reader = BufReader::new(server);
        let mut line = String::new();
        reader.read_line(&mut line).expect("read first");
        assert_eq!(line.as_str(), "first\n");
        line.clear();
        reader.read_line(&mut line).expect("read second");
        assert_eq!(line.as_str(), "second\n");
    }

    #[test]
    fn plat_09_a_closed_output_before_the_handshake_is_not_called_a_timeout() {
        let (sender, receiver) = mpsc::channel::<PathBuf>();
        drop(sender);
        let error = read_handshake(&receiver, Duration::from_secs(30))
            .expect_err("the stdout reader is gone");
        assert_eq!(error_code(error), "sidecar_exited_early");
    }

    #[test]
    fn plat_09_a_sidecar_that_exits_before_the_handshake_fails_at_once() {
        let folder = TempDir::new();
        let binary = script(&folder, "crashing-sidecar", "exit 3");
        let error = match spawn_sidecar(&binary, &[], folder.path(), Duration::from_secs(30)) {
            Ok(_) => panic!("the sidecar never printed a handshake"),
            Err(error) => error,
        };
        assert_eq!(error_code(error), "sidecar_exited_early");
    }

    #[test]
    fn plat_09_output_that_is_not_utf8_does_not_stop_the_handshake() {
        let folder = TempDir::new();
        let socket = folder.path().join("odd.sock");
        let binary = script(
            &folder,
            "odd-sidecar",
            &format!(
                "printf '\\377\\376 junk\\n'; printf 'SOCKET_PATH={}\\n'; exec sleep 30",
                socket.display()
            ),
        );
        let mut spawned = spawn_sidecar(&binary, &[], folder.path(), Duration::from_secs(5))
            .expect("the handshake follows the odd bytes");
        assert_eq!(spawned.socket_path, socket);
        process_group::terminate_group(spawned.pid, Duration::from_millis(500));
        let _ = spawned.child.wait();
    }

    #[test]
    fn plat_09_a_sidecar_log_line_is_redacted_before_it_reaches_disk() {
        let folder = TempDir::new();
        let path = folder.path().join("sidecar-1.log");
        let log = Arc::new(Mutex::new(open_log_file(&path).expect("create log")));

        log_line(
            &log,
            "stderr",
            "agent said: invalid key sk-fake for task-queue",
        );

        let written = fs::read_to_string(&path).expect("read log");
        assert_eq!(
            written,
            "[stderr] agent said: invalid key sk-[redacted] for task-queue\n"
        );
    }

    #[test]
    fn plat_18_a_sidecar_log_is_cut_when_it_reaches_its_cap() {
        let folder = TempDir::new();
        let path = folder.path().join("sidecar-1.log");
        let log = Arc::new(Mutex::new(open_log_file(&path).expect("create log")));
        for _ in 0..10 {
            log_line_with_cap(&log, "stdout", &"x".repeat(20), 300);
        }
        let length = fs::metadata(&path).expect("stat log").len();
        assert!(length <= 100, "kept {length} bytes");
    }

    #[test]
    fn plat_09_drain_lines_replaces_bytes_that_are_not_utf8_and_reads_on() {
        let folder = TempDir::new();
        let log_path = folder.path().join("sidecar-1.log");
        let log = Arc::new(Mutex::new(open_log_file(&log_path).expect("create log")));
        let input: &[u8] = b"first\n\xff\xfe odd\r\nlast\n";
        let mut taken = Vec::new();
        drain_lines(input, &log, "stderr", |line| {
            taken.push(line.to_string());
            line == "first"
        });
        assert_eq!(
            taken,
            vec![
                "first".to_string(),
                "\u{fffd}\u{fffd} odd".to_string(),
                "last".to_string()
            ]
        );
        let written = fs::read_to_string(&log_path).expect("read log");
        assert_eq!(written, "[stderr] \u{fffd}\u{fffd} odd\n[stderr] last\n");
    }

    fn running_inner(pid: u32, generation: u64) -> SidecarInner {
        let (outgoing, _receiver) = mpsc::channel::<String>();
        SidecarInner {
            phase: SidecarPhase::Running(SidecarHandle {
                pid,
                generation,
                socket_path: PathBuf::from("/tmp/conducted-fake.sock"),
                log_path: PathBuf::from("/tmp/conducted-fake.log"),
                outgoing,
            }),
            generation,
            recent_restarts_ms: Vec::new(),
            last_log_path: None,
        }
    }

    #[test]
    fn plat_09_only_the_newest_process_may_end_the_running_phase() {
        let mut inner = running_inner(4242, 2);
        assert_eq!(claim_exit(&mut inner, 1), None, "an older process is late");
        assert!(matches!(inner.phase, SidecarPhase::Running(_)));
        assert_eq!(claim_exit(&mut inner, 2), Some(4242));
        assert!(matches!(inner.phase, SidecarPhase::Stopped));
        assert_eq!(
            claim_exit(&mut inner, 2),
            None,
            "the socket report after the exit report finds nothing to end"
        );
    }

    #[test]
    fn plat_09_shutdown_cancels_a_restart_that_is_waiting() {
        let state = SidecarState {
            inner: tauri::async_runtime::Mutex::new(SidecarInner {
                phase: SidecarPhase::Restarting { attempt: 1 },
                generation: 1,
                recent_restarts_ms: Vec::new(),
                last_log_path: None,
            }),
        };
        tauri::async_runtime::block_on(shutdown(&state)).expect("shutdown");
        let inner = tauri::async_runtime::block_on(state.inner.lock());
        assert!(matches!(inner.phase, SidecarPhase::Stopped));
    }
}
