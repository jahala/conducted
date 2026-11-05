//! @feature PLAT-03 Shell commands: run, start, cancel
//! @feature PLAT-04 Capture the login-shell PATH at startup
//! @feature PLAT-29 Limit the paths, programs and links the webview can reach
//!
//! Owns: running one-shot programs for the UI (git, gh, scripts) with a timeout and a cancel that
//! kills the whole process group, and capturing the user's login-shell PATH once.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`execute_shell_command`,
//! `execute_shell_command_cancellable`, `cancel_shell_command` kills the process group) and
//! B3 (login shell capture). frontend.md "Who runs git": the UI runs git through these
//! commands with the captured login-shell PATH prepended.
//!
//! Must handle:
//! - Programs run with arguments as given, never through a shell string.
//! - The child gets its own process group, so cancel and timeout reach grandchildren too.
//! - A timeout and a cancel both end in the same kill sequence: SIGTERM, a short grace period,
//!   then SIGKILL. The result tells the two apart (`shell_timeout`, `shell_cancelled`).
//! - A process killed by a signal reports exit code 128 plus the signal number.
//! - Output is captured up to `MAX_OUTPUT_BYTES` per stream. Past that the process is killed and
//!   the call fails with `shell_output_too_large` instead of growing memory without bound.
//! - Cancelling an id that already finished, or never existed, is a no-op that succeeds.
//! - `shell_start` returns as soon as the process is registered. The result arrives later as a
//!   `shell://done` event. The UI makes the id, because `RunningCommand.id` is read synchronously.
//! - Two `shell_start` calls with the same id: the second fails with `shell_duplicate_id`.
//! - The table of running processes is shared by many commands at once. It sits behind a mutex
//!   that is never held across an await or a blocking wait.
//! - The first `shell_login_env` call and the startup warm-up share one capture.
//!
//! Scope (PLAT-29, native-and-sidecar-map.md A3): the first version of `shell_run` and
//! `shell_start` runs any program. `check_program_allowed` is the check both call first. It
//! compares the program's name (the file name, after resolving a bare name on PATH) with a list
//! the app builds: the programs the UI runs (git, gh, the shell for repository scripts, kill,
//! which, open, caffeinate, pmset, lsof) and the managed agent programs. A program outside the list
//! fails with `shell_program_not_allowed` and names it. The file scope and URL scopes are in
//! `files.rs`.
//!
//! Our design choice: the id for `shell_start` comes from the UI. The captured environment is the
//! base of every run and `ShellCommandRequest::env` is layered on top, as the Platform comment says.
//!
//! Test first: starting `sleep 30` then calling `shell_cancel` ends the process and its child
//! within the grace period and delivers `shell://done` with the code `shell_cancelled`.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::error::{CommandError, CommandResult};
use crate::not_implemented;

/// Event delivered when a command started with `shell_start` ends.
pub const EVENT_DONE: &str = "shell://done";
/// Largest amount of stdout or stderr kept per run.
pub const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
/// Time between SIGTERM and SIGKILL when a run is cancelled or times out.
pub const KILL_GRACE_MS: u64 = 2_000;
/// Longest the login shell may take to print its environment during capture.
pub const LOGIN_ENV_TIMEOUT_MS: u64 = 10_000;

/// What to run. Mirrors `ShellCommand` in `apps/desktop/src/platform/platform.ts`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellCommandRequest {
    /// Program to execute. A bare name is looked up on the captured login-shell PATH.
    pub program: String,
    /// Arguments passed as they are.
    pub args: Vec<String>,
    /// Working directory. Must exist and be a directory.
    pub cwd: String,
    /// Extra variables layered on top of the captured login-shell environment.
    #[serde(default)]
    pub env: Option<HashMap<String, String>>,
    /// Text written to stdin, after which stdin is closed.
    #[serde(default)]
    pub stdin: Option<String>,
    /// Kill the process group after this many milliseconds. No limit when absent.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

/// What a finished run produced. Mirrors `ShellOutput` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutput {
    /// Exit code, or 128 plus the signal number when a signal ended the process.
    pub exit_code: i32,
    /// Standard output as UTF-8, with invalid bytes replaced.
    pub stdout: String,
    /// Standard error as UTF-8, with invalid bytes replaced.
    pub stderr: String,
}

/// Payload of `shell://done`. Exactly one of `output` and `error` is set.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellDone {
    /// The id the UI passed to `shell_start`.
    pub id: String,
    pub output: Option<ShellOutput>,
    /// `{ code, message }`, see `CommandError`. Codes: `shell_cancelled`, `shell_timeout`,
    /// `shell_spawn_failed`, `shell_output_too_large`.
    pub error: Option<CommandError>,
}

/// The user's login shell and what it exports. Only `shell` and `path` reach the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginEnv {
    /// Absolute path of the login shell, for example `/bin/zsh`.
    pub shell: String,
    /// PATH as the login shell sees it.
    pub path: String,
    /// The whole environment. Never serialised: it may hold secrets.
    #[serde(skip)]
    pub vars: HashMap<String, String>,
}

/// A process the table knows about.
#[derive(Debug, Clone)]
pub struct RunningProcess {
    /// Process id of the child, which is also its process group id.
    pub pid: u32,
    /// Set by `shell_cancel` so the waiting task reports `shell_cancelled`, not a plain exit.
    pub cancel_requested: bool,
}

/// Shared state, registered once with `.manage(ShellState::default())`.
#[derive(Default)]
pub struct ShellState {
    /// Running commands by UI id. Short critical sections only.
    pub running: Mutex<HashMap<String, RunningProcess>>,
    /// Result of the one login-shell capture. The async mutex is held while capturing, so
    /// concurrent first callers wait for the same result.
    pub login_env: tauri::async_runtime::Mutex<Option<LoginEnv>>,
}

/// Checks that `program` is on the list of programs the web view may start.
pub fn check_program_allowed(_program: &str, _allowed: &[&str]) -> CommandResult<()> {
    not_implemented!("PLAT-29")
}

/// Runs a program to completion and returns its output.
#[tauri::command]
#[allow(unused_variables)]
pub async fn shell_run(
    state: State<'_, ShellState>,
    command: ShellCommandRequest,
) -> CommandResult<ShellOutput> {
    not_implemented!("PLAT-03")
}

/// Starts a program and returns at once. The result arrives as `shell://done`.
#[tauri::command]
#[allow(unused_variables)]
pub async fn shell_start(
    app: AppHandle,
    state: State<'_, ShellState>,
    id: String,
    command: ShellCommandRequest,
) -> CommandResult<()> {
    not_implemented!("PLAT-03")
}

/// Kills the process group of a command started with `shell_start`.
#[tauri::command]
#[allow(unused_variables)]
pub async fn shell_cancel(state: State<'_, ShellState>, id: String) -> CommandResult<()> {
    not_implemented!("PLAT-03")
}

/// Returns the login shell and its PATH, capturing them on the first call.
#[tauri::command]
#[allow(unused_variables)]
pub async fn shell_login_env(state: State<'_, ShellState>) -> CommandResult<LoginEnv> {
    not_implemented!("PLAT-04")
}

/// Runs `$SHELL -ilc` once and reads the environment it exports. `shell_login_env` calls this,
/// and `run()` starts it on a background task at launch so the first git call does not wait.
/// A broken dotfile must not hang the app, so the capture is bounded by `LOGIN_ENV_TIMEOUT_MS`
/// and fails with `login_env_failed` when the shell prints nothing usable.
pub fn capture_login_env() -> CommandResult<LoginEnv> {
    not_implemented!("PLAT-04")
}
