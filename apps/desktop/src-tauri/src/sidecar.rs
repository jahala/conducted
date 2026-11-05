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
//! - Start sequence: kill orphans from an earlier crash, resolve the binary, spawn
//!   `conducted-sidecar sidecar` with the environment below, read stdout until `SOCKET_PATH=`
//!   (fail with `sidecar_handshake_timeout` after `HANDSHAKE_TIMEOUT_MS`), connect with retries,
//!   start the reader and writer tasks.
//! - Lines are relayed verbatim. A line is never split or merged. A line longer than
//!   `MAX_LINE_BYTES` is dropped with a log entry instead of exhausting memory.
//! - `sidecar_send` while the sidecar is starting waits for the start. While it is restarting or
//!   stopped it fails with `sidecar_not_running`. The UI resends after `sidecar://restart`
//!   because the sidecar replays unacknowledged events on reconnect.
//! - Writes are serialised through one queue, so two sends never interleave inside a line.
//! - Only the newest process generation may change state. An exit report from an older process
//!   (late wait result, late socket close) is dropped by comparing generation numbers.
//! - Restart policy: after an unexpected exit, restart with backoff `RESTART_BACKOFF_MS`, at most
//!   `MAX_RESTARTS_PER_WINDOW` times in `RESTART_WINDOW_MS`. Each exit emits `sidecar://restart`
//!   with `willRetry`. After the limit the phase becomes `Stopped` and the next
//!   `sidecar_ensure_started` starts fresh.
//! - Quitting the app closes the socket, sends SIGTERM, waits briefly, then SIGKILL.
//! - Parent watchdog: Rust sets `CONDUCTED_PARENT_PID` to its own pid. The sidecar polls it and
//!   exits when the pid is gone or reused (SIDE-19). Rust covers the other direction: at start it
//!   scans the process table for `conducted-sidecar sidecar` processes whose parent is not this
//!   app and kills them.
//! - stdout and stderr go to a log file: `<app data>/logs/sidecar-<pid>.log`, mode 0600. The
//!   five newest logs are kept, the rest are removed at start. `sidecar_log_path` returns the
//!   current one.
//!
//! Our design choice: the restart loop in Rust (Conductor has none: the UI calls ensure again).
//! Our design choice: no HTTP health endpoint and no bearer token. A child that is alive and
//! connected is healthy, and the socket is private to the user (mode 0600 in a 0700 folder).
//! Our design choice: environment variables for the sidecar are fixed here and must match
//! packages/sidecar, as fixed in docs/plans/tauri-commands.md ("Sidecar launch"): `CONDUCTED_PARENT_PID`,
//! `CONDUCTED_OUTBOX_ROOT`, `CONDUCTED_LOG_DIR`, `CONDUCTED_BIN_DIR`, `CONDUCTED_APP_VERSION`. Packaging the sidecar
//! needs `bundle.externalBin` in tauri.conf.json, which requires the compiled file to exist at
//! build time, so it is added when the sidecar build exists. In development
//! `CONDUCTED_SIDECAR_BIN` points at a binary or a wrapper script.
//!
//! Folders for the sidecar (see "Sidecar launch" in docs/plans/tauri-commands.md):
//! - SIDE-22: `completions_dir` is a folder in the app data folder, created at mode 0700, passed as
//!   `CONDUCTED_COMPLETIONS_DIR`. The sidecar keeps its slash-command snapshots there.
//! - AGENT-18: `skill_plugin_dir` is the bundled skill folder inside the app's resources, passed as
//!   `CONDUCTED_SKILL_PLUGIN_DIR`. A dev run without a bundle gets no variable, not an empty one.
//! - SIDE-23: `check_binary_version` runs `<sidecar> --version` before the first start and fails
//!   with `sidecar_version_mismatch` when the answer is not this app's version. A release build runs
//!   the CPU's file from `bundle.externalBin`.
//!
//! Test first: with a fake sidecar script that prints `SOCKET_PATH=...` and echoes lines,
//! `sidecar_send("a")` produces `sidecar://line` with `a`; killing the script emits
//! `sidecar://restart` and a later send reaches the new process.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::error::{CommandError, CommandResult};
use crate::not_implemented;

/// Event carrying one line from the sidecar, as a plain string.
pub const EVENT_LINE: &str = "sidecar://line";
/// Event fired when the sidecar process ends or is restarted. Payload: `SidecarRestart`.
pub const EVENT_RESTART: &str = "sidecar://restart";
/// Longest accepted line from the sidecar.
pub const MAX_LINE_BYTES: usize = 32 * 1024 * 1024;
/// Time allowed between spawn and the `SOCKET_PATH=` line.
pub const HANDSHAKE_TIMEOUT_MS: u64 = 30_000;
/// Pause before each successive restart. The last value repeats.
pub const RESTART_BACKOFF_MS: [u64; 4] = [250, 1_000, 3_000, 10_000];
/// Restarts allowed inside the window before the launcher gives up.
pub const MAX_RESTARTS_PER_WINDOW: u32 = 5;
/// Length of the restart-counting window.
pub const RESTART_WINDOW_MS: u64 = 60_000;
/// Sidecar log files kept.
pub const LOGS_KEPT: usize = 5;

/// Why a sidecar process ended.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SidecarExitReason {
    /// The process exited or was killed by a signal.
    Exited,
    /// The socket closed while the process stayed alive.
    SocketClosed,
    /// The app asked for it (quit, or a restart requested by the UI).
    Requested,
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
pub struct SidecarHandle {
    pub pid: u32,
    /// Which start this is. Grows by one per start. Used to drop late reports from old processes.
    pub generation: u64,
    pub socket_path: PathBuf,
    pub log_path: PathBuf,
    /// Lines to write to the socket. One writer task drains it in order.
    pub outgoing: tauri::async_runtime::Sender<String>,
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
}

impl Default for SidecarState {
    fn default() -> Self {
        Self {
            inner: tauri::async_runtime::Mutex::new(SidecarInner {
                phase: SidecarPhase::Stopped,
                generation: 0,
                recent_restarts_ms: Vec::new(),
            }),
        }
    }
}

/// Environment variable that tells the sidecar where to keep its slash-command snapshots.
pub const ENV_COMPLETIONS_DIR: &str = "CONDUCTED_COMPLETIONS_DIR";
/// Environment variable that tells the sidecar where the bundled skill folder is.
pub const ENV_SKILL_PLUGIN_DIR: &str = "CONDUCTED_SKILL_PLUGIN_DIR";

/// The folder for the sidecar's saved slash-command lists. Created when missing.
pub fn completions_dir(_app: &AppHandle) -> CommandResult<PathBuf> {
    not_implemented!("SIDE-22")
}

/// The bundled skill folder, or `None` when the build has none (a dev run).
pub fn skill_plugin_dir(_app: &AppHandle) -> CommandResult<Option<PathBuf>> {
    not_implemented!("AGENT-18")
}

/// Runs `<binary> --version` and checks that it names `app_version`.
pub async fn check_binary_version(binary: &Path, app_version: &str) -> CommandResult<()> {
    let binary = binary.to_path_buf();
    let app_version = app_version.to_string();
    tauri::async_runtime::spawn_blocking(move || check_version_blocking(&binary, &app_version))
        .await
        .map_err(|error| CommandError::Failed {
            code: "sidecar_version_check_failed",
            message: format!("The sidecar version check task failed: {error}"),
        })?
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
    let expected = format!("conducted-sidecar {app_version}");
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
/// `<resources>/bin/`. Fails with `sidecar_binary_missing`.
pub fn resolve_binary(_app: &AppHandle) -> CommandResult<PathBuf> {
    not_implemented!("PLAT-09")
}

/// Kills sidecar processes left behind by an earlier crash of the app. Matches the program name
/// and the `sidecar` argument, and skips the process this app owns.
pub fn kill_orphans() -> CommandResult<u32> {
    not_implemented!("PLAT-09")
}

/// Spawns the process, performs the handshake, connects the socket and starts the relay tasks.
/// Called with the state lock held, so only one start runs at a time.
pub async fn start_process(
    _app: &AppHandle,
    _inner: &mut SidecarInner,
) -> CommandResult<SidecarHandle> {
    not_implemented!("PLAT-09")
}

/// Handles the end of a process: drops the report when `generation` is not the newest, emits
/// `sidecar://restart`, and schedules the next start according to the restart policy.
pub async fn on_process_ended(
    _app: &AppHandle,
    _state: &SidecarState,
    _generation: u64,
    _reason: SidecarExitReason,
    _exit_code: Option<i32>,
) -> CommandResult<()> {
    not_implemented!("PLAT-09")
}

/// Stops the process for good: used when the app quits.
pub async fn shutdown(_state: &SidecarState) -> CommandResult<()> {
    not_implemented!("PLAT-09")
}

/// Starts the sidecar if it is not running. Returns when the socket is connected.
#[tauri::command]
#[allow(unused_variables)]
pub async fn sidecar_ensure_started(
    app: AppHandle,
    state: State<'_, SidecarState>,
) -> CommandResult<()> {
    not_implemented!("PLAT-09")
}

/// Writes one line to the sidecar. The line must not contain a newline; one is added.
#[tauri::command]
#[allow(unused_variables)]
pub async fn sidecar_send(state: State<'_, SidecarState>, line: String) -> CommandResult<()> {
    not_implemented!("PLAT-09")
}

/// Path of the current sidecar log file.
#[tauri::command]
#[allow(unused_variables)]
pub async fn sidecar_log_path(state: State<'_, SidecarState>) -> CommandResult<String> {
    not_implemented!("PLAT-09")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
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
}
