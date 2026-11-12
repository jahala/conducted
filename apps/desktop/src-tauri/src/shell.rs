//! @feature PLAT-03 Shell commands: run, start, cancel
//! @feature PLAT-04 Capture the login-shell PATH at startup
//! @feature PLAT-29 Limit the paths, programs and links the webview can reach
//! @feature SET-13 Chosen program paths reach terminals and scripts
//!
//! SET-13 owns one thing here: `prefixed_path` (with `path_with_prefix`), which puts the folder
//! named by `CONDUCTED_PATH_PREFIX` first on a child's PATH. Every script run through `shell_run` and every
//! terminal started by `pty_spawn` uses it, so a chosen program shim and the bundled bin folder
//! reach both through one variable. Behaviour: services-map.md 5A.8.2 (path overrides) and
//! 5A.1.2 (the bundled bin folder on PATH).
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
//! - Quitting the app ends every command still running, from `shell_start` and `shell_run` alike
//!   (issue #639: the startup `xcodebuild -license check` outlived a quit). Each runs in its own
//!   process group, so closing the app would not reach it. Both record their group in `running`,
//!   and `lib.rs` calls `terminate_all` when the app exits: SIGTERM to every group, then SIGKILL to
//!   the groups still there after the grace period. A `shell_run` ended that way fails with
//!   `shell_cancelled`.
//! - `shell_start` returns as soon as the process is registered. The result arrives later as a
//!   `shell://done` event. The UI makes the id, because `RunningCommand.id` is read synchronously.
//! - Two `shell_start` calls with the same id: the second fails with `shell_duplicate_id`.
//! - The table of running processes is shared by many commands at once. It sits behind a mutex
//!   that is never held across an await or a blocking wait.
//! - The first app-wide `shell_login_env` call and the startup warm-up share one capture.
//! - The capture picks flags by shell name (`-ilc` for zsh and bash, `-i -l -c` for fish), reads
//!   the environment between a delimiter, and retries once with a plain login zsh (5 s, then 3 s).
//!   When both fail, the error names the cause of each.
//! - Provider keys and exported shell functions are removed from the captured environment.
//!
//! Scope (PLAT-29, native-and-sidecar-map.md A3): `shell_run` and `shell_start` first call
//! `check_program_allowed`. It resolves the program (a bare name on the PATH the child will see,
//! or the given path) and requires two things: the file name is in `ALLOWED_PROGRAMS` (git, gh,
//! gt, stat, cp, sleep, echo, true, the shell and the helper scripts for repository scripts, kill,
//! which, open, caffeinate, pmset, lsof, watchexec, xcodebuild for the Xcode licence probe,
//! osascript for its Terminal fix, and the managed agent programs claude, codex, cursor-agent,
//! opencode, pi), and the resolved file sits in a trusted program folder: the
//! system bin folders, the package-manager trees their links resolve into, the app's `bin/` and
//! the managed agent-binaries folder. A program outside the list or the folders fails with
//! `shell_program_not_allowed` and names it. The file scope and URL scopes are in `files.rs`.
//!
//! Our design choice: `ALLOWED_PROGRAMS` narrows accidents; it is not a sandbox. The shells, `cp`
//! and `open` reach any file or URL when they run, as Conductor's list does. The working folder
//! is not limited either. `pty_spawn` does not go through this check; the terminal's own scope
//! belongs to PLAT-07.
//!
//! Our design choice: the id for `shell_start` comes from the UI. The captured environment is the
//! base of every run and `ShellCommandRequest::env` is layered on top, as the Platform comment says.
//! Only the login shell, its PATH and the app's own launch `ZDOTDIR` (RUN-09) reach the UI; the
//! rest of the captured environment stays in Rust for the children.
//! - Captures are kept per working folder too (PLAT-07, services-map 5A.8.3): `shell_login_env`
//!   with a `cwd`, and a command whose `env_from_cwd` is set, start from the login shell as it sees
//!   that folder, so direnv and mise settings of a workspace apply. Callers for one folder share one
//!   capture; a failed one is not kept. A relative folder fails with `shell_bad_cwd`.
//!
//! Our design choice: the app-wide capture runs once, in the folder the app process started in,
//! and is the base of every command that does not ask for its folder's environment, git included,
//! as Conductor prepends one captured PATH to its git calls.
//!
//! Test first: starting `sleep 30` then calling `shell_cancel` ends the process and its child
//! within the grace period and delivers `shell://done` with the code `shell_cancelled`.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::error::{CommandError, CommandResult, blocking};
use crate::process_group;

/// Event delivered when a command started with `shell_start` ends.
pub const EVENT_DONE: &str = "shell://done";
/// Largest amount of stdout or stderr kept per run.
pub const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
/// Time between SIGTERM and SIGKILL when a run is cancelled or times out.
pub const KILL_GRACE_MS: u64 = 2_000;
/// How long the output readers may keep delivering after the child exits. A grandchild that holds
/// the pipe open must not keep the call waiting.
const DRAIN_AFTER_EXIT_MS: u64 = 500;
/// How long the user's own login shell may take to print its environment.
pub const PRIMARY_CAPTURE_TIMEOUT_MS: u64 = 5_000;
/// How long the plain login zsh fallback may take.
pub const FALLBACK_CAPTURE_TIMEOUT_MS: u64 = 3_000;
/// The shell used when the user's shell is unknown or the first attempt fails.
pub const FALLBACK_SHELL: &str = "/bin/zsh";
/// Provider credentials removed from the captured environment. SIDE-10 has a TypeScript copy of
/// this list; one home read by both is still to come.
pub const STRIPPED_ENV_NAMES: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CODEX_ACCESS_TOKEN",
    "CODEX_API_KEY",
    "CURSOR_API_KEY",
    "OPENAI_API_KEY",
    "CONDUCTED_CWD",
];
/// Prefixes of variables that are not values the app needs. Exported functions are one example.
pub const STRIPPED_ENV_PREFIXES: &[&str] = &["BASH_FUNC_"];

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
    /// Start from the login environment captured in `cwd` instead of the app-wide one (PLAT-07).
    #[serde(default)]
    pub env_from_cwd: bool,
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

/// The user's login shell and what it exports. Only `shell`, `path` and `zdotdir` reach the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginEnv {
    /// Absolute path of the login shell, for example `/bin/zsh`.
    pub shell: String,
    /// PATH as the login shell sees it.
    pub path: String,
    /// The `ZDOTDIR` the app itself was launched with, if any (RUN-09). The terminal shim reads the
    /// user's dotfiles from it, as zsh would. Not the captured value: a `.zshenv` that sets
    /// `ZDOTDIR` is followed by the shim itself.
    pub zdotdir: Option<String>,
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
    /// Running commands: `shell_start`'s by UI id, `shell_run`'s by `run:<n>`. Short critical
    /// sections only.
    pub running: Mutex<HashMap<String, RunningProcess>>,
    /// The number of the next `shell_run`, for its id in `running`. The UI's ids are UUIDs, so a
    /// `run:<n>` id never meets one.
    next_run: AtomicU64,
    /// Result of the one login-shell capture. The async mutex is held while capturing, so
    /// concurrent first callers wait for the same result.
    pub login_env: tauri::async_runtime::Mutex<Option<LoginEnv>>,
    /// Captures made in one working folder (PLAT-07), for `shell_login_env { cwd }` and for a
    /// command that asks for its folder's environment.
    pub folder_envs: FolderEnvs,
}

impl ShellState {
    /// A fresh id for one `shell_run` in the `running` table.
    fn run_id(&self) -> String {
        format!("run:{}", self.next_run.fetch_add(1, Ordering::Relaxed))
    }
}

/// Login-shell captures by working folder, so direnv and mise settings of a folder reach the
/// programs run there (services-map.md 5A.8.3 caches by folder). Concurrent first callers for one
/// folder share one capture. A failed capture is not kept, so the next call tries again.
#[derive(Default)]
pub struct FolderEnvs {
    cells: Mutex<HashMap<PathBuf, Arc<tokio::sync::OnceCell<LoginEnv>>>>,
}

impl FolderEnvs {
    /// The capture for `folder`, running `capture` only when none is kept.
    pub async fn get_or_capture<F, Fut>(&self, folder: &Path, capture: F) -> CommandResult<LoginEnv>
    where
        F: FnOnce(PathBuf) -> Fut,
        Fut: std::future::Future<Output = CommandResult<LoginEnv>>,
    {
        let cell = {
            let mut cells = crate::error::lock(&self.cells);
            Arc::clone(cells.entry(folder.to_path_buf()).or_default())
        };
        cell.get_or_try_init(|| capture(folder.to_path_buf()))
            .await
            .cloned()
    }
}

/// The login environment as captured in `cwd` with `shell`, kept per folder.
pub async fn capture_in_folder(
    envs: &FolderEnvs,
    cwd: &str,
    shell: String,
) -> CommandResult<LoginEnv> {
    let folder = PathBuf::from(cwd);
    if !folder.is_absolute() {
        return Err(CommandError::Failed {
            code: "shell_bad_cwd",
            message: format!("The working folder must be an absolute path: {cwd}"),
        });
    }
    envs.get_or_capture(&folder, |folder| {
        blocking("login_env_failed", move || {
            capture_with_shell(&shell, &folder)
        })
    })
    .await
}

/// Bytes a reader thread kept and whether it stopped at the limit.
#[derive(Default)]
struct Captured {
    bytes: Vec<u8>,
    overflowed: bool,
}

/// What one run produced before the caller turns it into `ShellOutput` or an error.
struct Finished {
    output: ShellOutput,
    timed_out: bool,
    overflowed: bool,
}

/// A message from a reader thread or the waiter thread.
enum WaitEvent {
    Exited(Option<ExitStatus>),
    Overflow,
    /// One output reader saw its pipe close.
    ReaderDone,
}

fn lock_running(
    running: &Mutex<HashMap<String, RunningProcess>>,
) -> MutexGuard<'_, HashMap<String, RunningProcess>> {
    running
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn duplicate_id_error(id: &str) -> CommandError {
    CommandError::Failed {
        code: "shell_duplicate_id",
        message: format!("A command with id \"{id}\" is already running."),
    }
}

/// Reserves an id before its process exists. The pid stays 0 until `set_running_pid`.
pub fn reserve_running(
    running: &Mutex<HashMap<String, RunningProcess>>,
    id: String,
) -> CommandResult<()> {
    let mut table = lock_running(running);
    if table.contains_key(&id) {
        return Err(duplicate_id_error(&id));
    }
    table.insert(
        id,
        RunningProcess {
            pid: 0,
            cancel_requested: false,
        },
    );
    Ok(())
}

/// Records the pid of a reserved run and reports whether a cancel arrived while it was reserved.
fn set_running_pid(running: &Mutex<HashMap<String, RunningProcess>>, id: &str, pid: u32) -> bool {
    let mut table = lock_running(running);
    match table.get_mut(id) {
        Some(process) => {
            process.pid = pid;
            process.cancel_requested
        }
        // The entry vanished, which must not happen; stop the run rather than leave it untracked.
        None => true,
    }
}

/// Reserves an id and records the pid at once, for tests that start a process by hand.
#[cfg(test)]
fn register_running(
    running: &Mutex<HashMap<String, RunningProcess>>,
    id: String,
    pid: u32,
) -> CommandResult<()> {
    reserve_running(running, id.clone())?;
    let _ = set_running_pid(running, &id, pid);
    Ok(())
}

/// Reserves `id`, spawns the process, and records its pid. A duplicate id never reaches the
/// spawner, and a failed spawn releases the reservation so the id can be tried again.
fn begin_running(
    running: &Mutex<HashMap<String, RunningProcess>>,
    id: &str,
    spawn: impl FnOnce() -> CommandResult<Child>,
) -> CommandResult<(Child, bool)> {
    reserve_running(running, id.to_string())?;
    let child = match spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = remove_finished(running, id);
            return Err(error);
        }
    };
    let cancelled = set_running_pid(running, id, child.id());
    Ok((child, cancelled))
}

/// Marks a run as cancelled and returns the process group to signal. `None` means no such run, or
/// a reservation whose process has not started yet.
pub fn request_cancel(running: &Mutex<HashMap<String, RunningProcess>>, id: &str) -> Option<u32> {
    let mut table = lock_running(running);
    table.get_mut(id).and_then(|process| {
        process.cancel_requested = true;
        (process.pid != 0).then_some(process.pid)
    })
}

/// Ends every registered run for good, for the moment the app quits: SIGTERM to each process
/// group at once, then SIGKILL to the groups still alive after `grace`. Every run is marked as
/// cancelled, so a run that ends meanwhile reports `shell_cancelled`. A reservation whose process
/// has not started yet has no group to signal. Returns how many groups were signalled.
pub fn terminate_all(running: &Mutex<HashMap<String, RunningProcess>>, grace: Duration) -> usize {
    let pids: Vec<u32> = {
        let mut table = lock_running(running);
        table
            .values_mut()
            .filter_map(|process| {
                process.cancel_requested = true;
                (process.pid != 0).then_some(process.pid)
            })
            .collect()
    };
    let signalled: Vec<u32> = pids
        .into_iter()
        .filter(|pid| process_group::signal_group(*pid, process_group::SIGTERM))
        .collect();
    let deadline = Instant::now() + grace;
    while Instant::now() < deadline
        && signalled
            .iter()
            .any(|pid| process_group::group_exists(*pid))
    {
        thread::sleep(Duration::from_millis(20));
    }
    for pid in &signalled {
        if process_group::group_exists(*pid) {
            let _ = process_group::signal_group(*pid, process_group::SIGKILL);
        }
    }
    signalled.len()
}

/// Removes a finished run and reports whether a cancel was requested for it.
fn remove_finished(running: &Mutex<HashMap<String, RunningProcess>>, id: &str) -> bool {
    let mut table = lock_running(running);
    table
        .remove(id)
        .map(|process| process.cancel_requested)
        .unwrap_or(false)
}

fn cancelled_error() -> CommandError {
    CommandError::Failed {
        code: "shell_cancelled",
        message: "The command was cancelled.".to_string(),
    }
}

fn timeout_error(timeout_ms: Option<u64>) -> CommandError {
    CommandError::Failed {
        code: "shell_timeout",
        message: match timeout_ms {
            Some(ms) => format!("The command timed out after {ms} ms."),
            None => "The command timed out.".to_string(),
        },
    }
}

fn output_too_large_error() -> CommandError {
    CommandError::Failed {
        code: "shell_output_too_large",
        message: format!("The command wrote more than {MAX_OUTPUT_BYTES} bytes to one stream."),
    }
}

/// Puts `prefix` first on `path`. An empty prefix leaves the path alone; an empty path becomes
/// the prefix. The prefix may name more than one folder, as a PATH entry may.
pub fn path_with_prefix(prefix: &str, path: &str) -> String {
    if prefix.is_empty() {
        return path.to_string();
    }
    if path.is_empty() {
        return prefix.to_string();
    }
    format!("{prefix}:{path}")
}

/// The PATH a child gets when its env overlay carries `CONDUCTED_PATH_PREFIX`: the prefix first,
/// then the overlay's PATH, or the base PATH when the overlay has none. None without the variable.
/// `shell_run` and `pty_spawn` both use it, so the rule has one home.
pub fn prefixed_path(
    overlay: &HashMap<String, String>,
    base_env: &HashMap<String, String>,
) -> Option<String> {
    let prefix = overlay.get("CONDUCTED_PATH_PREFIX")?;
    let path = overlay
        .get("PATH")
        .or_else(|| base_env.get("PATH"))
        .map(String::as_str)
        .unwrap_or("");
    Some(path_with_prefix(prefix, path))
}

/// Finds a bare program name on the PATH the child will see.
fn resolve_program(program: &str, path: Option<&str>) -> CommandResult<PathBuf> {
    if program.contains('/') {
        return Ok(PathBuf::from(program));
    }
    if let Some(path) = path {
        for dir in path.split(':') {
            let dir = if dir.is_empty() { "." } else { dir };
            let candidate = Path::new(dir).join(program);
            let Ok(metadata) = std::fs::metadata(&candidate) else {
                continue;
            };
            if metadata.is_file() && metadata.permissions().mode() & 0o111 != 0 {
                return Ok(candidate);
            }
        }
    }
    Err(CommandError::Failed {
        code: "shell_spawn_failed",
        message: format!("Program not found on PATH: {program}"),
    })
}

/// Builds the child process. Arguments are passed as they are; nothing is parsed by a shell.
fn build_command(
    request: &ShellCommandRequest,
    base_env: &HashMap<String, String>,
    program_roots: &[PathBuf],
) -> CommandResult<Command> {
    let cwd = Path::new(&request.cwd);
    if !cwd.is_dir() {
        return Err(CommandError::Failed {
            code: "shell_bad_cwd",
            message: format!("Working directory does not exist: {}", request.cwd),
        });
    }

    let overlay_path = request.env.as_ref().and_then(|env| env.get("PATH"));
    let path = overlay_path
        .or_else(|| base_env.get("PATH"))
        .map(String::as_str);
    let program = resolve_program(&request.program, path)?;
    check_program_allowed(&request.program, ALLOWED_PROGRAMS, program_roots, path)?;

    let mut command = Command::new(program);
    command
        .args(&request.args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.env_clear();
    for (key, value) in base_env {
        command.env(key, value);
    }
    if let Some(env) = &request.env {
        for (key, value) in env {
            command.env(key, value);
        }
        if let Some(path) = prefixed_path(env, base_env) {
            command.env("PATH", path);
        }
    }
    command.process_group(0);
    Ok(command)
}

fn spawn_child(
    request: &ShellCommandRequest,
    base_env: &HashMap<String, String>,
    program_roots: &[PathBuf],
) -> CommandResult<Child> {
    let mut command = build_command(request, base_env, program_roots)?;
    command.spawn().map_err(|error| CommandError::Failed {
        code: "shell_spawn_failed",
        message: format!("Could not start {}: {error}", request.program),
    })
}

/// Reads one stream into the shared buffer, keeping at most `limit` bytes. Past the limit it tells
/// the controller. A reader may outlive the leader when a grandchild keeps the pipe open, so it
/// writes into shared state instead of returning its buffer from `join`.
fn read_stream<R: Read>(
    mut reader: R,
    limit: usize,
    overflow: &mpsc::Sender<WaitEvent>,
    captured: &Mutex<Captured>,
) {
    let mut buffer = [0u8; 16 * 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return,
            Ok(read) => {
                let overflowed = {
                    let mut captured = captured
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if captured.bytes.len() + read > limit {
                        let room = limit.saturating_sub(captured.bytes.len());
                        captured.bytes.extend_from_slice(&buffer[..room]);
                        captured.overflowed = true;
                        true
                    } else {
                        captured.bytes.extend_from_slice(&buffer[..read]);
                        false
                    }
                };
                if overflowed {
                    let _ = overflow.send(WaitEvent::Overflow);
                    return;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return,
        }
    }
}

/// Ends a whole process group: SIGTERM, then SIGKILL after the grace period.
pub fn terminate_group(pid: u32) {
    process_group::terminate_group(pid, Duration::from_millis(KILL_GRACE_MS));
}

/// Waits up to `DRAIN_AFTER_EXIT_MS` for the readers to report that their pipe closed.
fn drain_readers(receiver: &mpsc::Receiver<WaitEvent>, mut remaining: usize) {
    let deadline = Instant::now() + Duration::from_millis(DRAIN_AFTER_EXIT_MS);
    while remaining > 0 {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return;
        }
        match receiver.recv_timeout(left) {
            Ok(WaitEvent::ReaderDone) => remaining -= 1,
            Ok(_) => {}
            Err(_) => return,
        }
    }
}

/// Takes what a reader kept, leaving the shared buffer empty for a reader that is still running.
fn take_captured(captured: &Mutex<Captured>) -> Captured {
    std::mem::take(
        &mut *captured
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
    )
}

fn wait_for_exit(receiver: &mpsc::Receiver<WaitEvent>) -> Option<ExitStatus> {
    loop {
        match receiver.recv() {
            Ok(WaitEvent::Exited(status)) => return status,
            Ok(_) => {}
            Err(_) => return None,
        }
    }
}

fn exit_code(status: &ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }
    if let Some(signal) = status.signal() {
        return 128 + signal;
    }
    1
}

/// Runs a spawned child to completion, with a timeout and an output limit.
fn drive_with_limit(
    mut child: Child,
    stdin_text: Option<String>,
    timeout_ms: Option<u64>,
    limit: usize,
) -> CommandResult<Finished> {
    let pid = child.id();

    let stdin_pipe = child.stdin.take();
    let writer = match (stdin_pipe, stdin_text) {
        (Some(mut pipe), Some(text)) => Some(thread::spawn(move || {
            let _ = pipe.write_all(text.as_bytes());
            let _ = pipe.flush();
        })),
        (Some(pipe), None) => {
            drop(pipe);
            None
        }
        (None, _) => None,
    };

    let (sender, receiver) = mpsc::channel::<WaitEvent>();
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let reader_count = stdout_pipe.is_some() as usize + stderr_pipe.is_some() as usize;
    let stdout_captured = Arc::new(Mutex::new(Captured::default()));
    let stderr_captured = Arc::new(Mutex::new(Captured::default()));
    if let Some(pipe) = stdout_pipe {
        let sender = sender.clone();
        let captured = Arc::clone(&stdout_captured);
        let _ = thread::spawn(move || {
            read_stream(pipe, limit, &sender, captured.as_ref());
            let _ = sender.send(WaitEvent::ReaderDone);
        });
    }
    if let Some(pipe) = stderr_pipe {
        let sender = sender.clone();
        let captured = Arc::clone(&stderr_captured);
        let _ = thread::spawn(move || {
            read_stream(pipe, limit, &sender, captured.as_ref());
            let _ = sender.send(WaitEvent::ReaderDone);
        });
    }

    let waiter = thread::spawn(move || {
        let status = child.wait().ok();
        let _ = sender.send(WaitEvent::Exited(status));
    });

    let deadline = timeout_ms.map(|ms| Instant::now() + Duration::from_millis(ms));
    let mut timed_out = false;
    let mut readers_done = 0usize;
    let status = loop {
        let received = match deadline {
            Some(deadline) => {
                let remaining = deadline.saturating_duration_since(Instant::now());
                match receiver.recv_timeout(remaining) {
                    Ok(event) => Ok(event),
                    Err(RecvTimeoutError::Timeout) => {
                        timed_out = true;
                        terminate_group(pid);
                        break wait_for_exit(&receiver);
                    }
                    Err(RecvTimeoutError::Disconnected) => Err(()),
                }
            }
            None => match receiver.recv() {
                Ok(event) => Ok(event),
                Err(_) => Err(()),
            },
        };
        match received {
            Ok(WaitEvent::Exited(status)) => break status,
            Ok(WaitEvent::Overflow) => terminate_group(pid),
            Ok(WaitEvent::ReaderDone) => readers_done += 1,
            Err(()) => {
                terminate_group(pid);
                break None;
            }
        }
    };

    let _ = waiter.join();
    drain_readers(&receiver, reader_count.saturating_sub(readers_done));
    let stdout = take_captured(stdout_captured.as_ref());
    let stderr = take_captured(stderr_captured.as_ref());
    // The stdin writer can block the same way a reader can when a grandchild holds the pipe. The
    // child is already gone, so letting the thread finish by itself is enough.
    drop(writer);

    let status = status.ok_or_else(|| CommandError::Failed {
        code: "shell_wait_failed",
        message: "The command's exit status could not be read.".to_string(),
    })?;

    Ok(Finished {
        output: ShellOutput {
            exit_code: exit_code(&status),
            stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
            stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
        },
        timed_out,
        overflowed: stdout.overflowed || stderr.overflowed,
    })
}

/// Runs a program to completion under `id` in the `running` table, so quitting the app ends it
/// as it ends `shell_start`'s commands. A run ended that way fails with `shell_cancelled`.
fn run_blocking(
    running: &Mutex<HashMap<String, RunningProcess>>,
    id: &str,
    request: &ShellCommandRequest,
    base_env: &HashMap<String, String>,
    program_roots: &[PathBuf],
) -> CommandResult<Finished> {
    let (child, cancelled_now) = begin_running(running, id, || {
        spawn_child(request, base_env, program_roots)
    })?;
    if cancelled_now {
        // The app began quitting while the id was reserved and nothing could be signalled yet.
        terminate_group(child.id());
    }
    let result = drive_with_limit(
        child,
        request.stdin.clone(),
        request.timeout_ms,
        MAX_OUTPUT_BYTES,
    );
    let cancelled = remove_finished(running, id);
    let finished = result?;
    if cancelled {
        return Err(cancelled_error());
    }
    Ok(finished)
}

/// Turns a finished one-shot run into its output, or the error the UI reads.
fn run_output(finished: Finished, timeout_ms: Option<u64>) -> CommandResult<ShellOutput> {
    if finished.timed_out {
        return Err(timeout_error(timeout_ms));
    }
    if finished.overflowed {
        return Err(output_too_large_error());
    }
    Ok(finished.output)
}

/// Removes a finished run from the table, reads its cancel flag, and builds the `shell://done`
/// payload. Keeping the two steps together is what makes a cancel reach the event.
fn finish_run(
    running: &Mutex<HashMap<String, RunningProcess>>,
    id: String,
    result: CommandResult<Finished>,
    timeout_ms: Option<u64>,
) -> ShellDone {
    let cancelled = remove_finished(running, &id);
    shell_done(id, result, cancelled, timeout_ms)
}

/// Turns one finished run into the payload of `shell://done`.
fn shell_done(
    id: String,
    result: CommandResult<Finished>,
    cancelled: bool,
    timeout_ms: Option<u64>,
) -> ShellDone {
    match result {
        Err(error) => ShellDone {
            id,
            output: None,
            error: Some(error),
        },
        Ok(_) if cancelled => ShellDone {
            id,
            output: None,
            error: Some(cancelled_error()),
        },
        Ok(finished) if finished.timed_out => ShellDone {
            id,
            output: None,
            error: Some(timeout_error(timeout_ms)),
        },
        Ok(finished) if finished.overflowed => ShellDone {
            id,
            output: None,
            error: Some(output_too_large_error()),
        },
        Ok(finished) => ShellDone {
            id,
            output: Some(finished.output),
            error: None,
        },
    }
}

/// Returns the environment a new process starts from: the capture made in the command's folder
/// when it asks for one, the app-wide capture otherwise.
async fn captured_env(
    state: &ShellState,
    command: &ShellCommandRequest,
) -> CommandResult<HashMap<String, String>> {
    let login = if command.env_from_cwd {
        capture_in_folder(&state.folder_envs, &command.cwd, login_shell()).await?
    } else {
        app_login_env(state).await?
    };
    Ok(login.vars)
}

/// One way to ask a login shell for its environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureCommand {
    pub program: String,
    pub args: Vec<String>,
}

/// A fresh delimiter per capture, so a variable whose value contains an older one cannot confuse
/// the parse.
fn new_marker() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    format!("__CONDUCTED_ENV_{}_{nanos}__", std::process::id())
}

/// Prints the marker, the NUL-separated environment, then the marker again.
fn capture_script(marker: &str) -> String {
    format!(
        "cd \"$CONDUCTED_CWD\" || exit 1; printf '%s' '{marker}'; env -0; printf '%s' '{marker}'"
    )
}

/// Picks the flags Conductor uses for each shell. Unknown shells use the plain login zsh.
pub fn capture_command_for(shell_path: &str, marker: &str) -> CaptureCommand {
    let name = Path::new(shell_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    match name {
        "zsh" | "bash" => CaptureCommand {
            program: shell_path.to_string(),
            args: vec!["-ilc".to_string(), capture_script(marker)],
        },
        "fish" => CaptureCommand {
            program: shell_path.to_string(),
            args: vec![
                "-i".to_string(),
                "-l".to_string(),
                "-c".to_string(),
                capture_script(marker),
            ],
        },
        _ => fallback_capture_command(marker),
    }
}

/// Runs a plain login zsh, which loads the login profile but no interactive rc file.
pub fn fallback_capture_command(marker: &str) -> CaptureCommand {
    fallback_capture_command_at(FALLBACK_SHELL, marker)
}

/// The plain login shell to use, named, so a test can pass a fixture.
fn fallback_capture_command_at(program: &str, marker: &str) -> CaptureCommand {
    CaptureCommand {
        program: program.to_string(),
        args: vec!["-lc".to_string(), capture_script(marker)],
    }
}

/// Reads the `env -0` dump between the two marker strings.
pub fn parse_env_dump(output: &str, marker: &str) -> CommandResult<HashMap<String, String>> {
    let Some(start) = output.find(marker) else {
        return Err(login_env_error(
            "The login shell printed no environment marker.".to_string(),
        ));
    };
    let body_start = start + marker.len();
    let Some(end) = output[body_start..].find(marker).map(|at| body_start + at) else {
        return Err(login_env_error(
            "The login shell's environment dump ended early.".to_string(),
        ));
    };
    let mut vars = HashMap::new();
    for entry in output[body_start..end].split('\0') {
        let Some((name, value)) = entry.split_once('=') else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        vars.insert(name.to_string(), value.to_string());
    }
    Ok(vars)
}

/// Removes provider keys, exported functions and the capture's own working-directory variable.
pub fn strip_provider_secrets(vars: HashMap<String, String>) -> HashMap<String, String> {
    vars.into_iter()
        .filter(|(name, _)| {
            !STRIPPED_ENV_NAMES.contains(&name.as_str())
                && !STRIPPED_ENV_PREFIXES
                    .iter()
                    .any(|prefix| name.starts_with(*prefix))
        })
        .collect()
}

fn login_env_error(message: String) -> CommandError {
    CommandError::Failed {
        code: "login_env_failed",
        message,
    }
}

/// Runs one capture attempt and returns its environment, or an error when it fails, prints nothing
/// usable, or outlives its timeout.
fn run_capture(
    command: &CaptureCommand,
    cwd: &Path,
    marker: &str,
    timeout: Duration,
) -> CommandResult<HashMap<String, String>> {
    let mut child = Command::new(&command.program)
        .args(&command.args)
        .current_dir(cwd)
        .env("CONDUCTED_CWD", cwd)
        .env("DISABLE_AUTO_UPDATE", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|error| {
            login_env_error(format!(
                "Could not start the login shell {}: {error}",
                command.program
            ))
        })?;

    let pid = child.id();
    let mut stdout = child.stdout.take().ok_or_else(|| {
        login_env_error("The login shell's output could not be read.".to_string())
    })?;
    let (sender, receiver) = mpsc::channel();
    let _ = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        let _ = sender.send(bytes);
    });

    let deadline = Instant::now() + timeout;
    let finished = loop {
        match child.try_wait() {
            Ok(Some(_)) => break true,
            Ok(None) if Instant::now() >= deadline => {
                terminate_group(pid);
                let _ = child.wait();
                break false;
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                terminate_group(pid);
                let _ = child.wait();
                break false;
            }
        }
    };
    if !finished {
        return Err(login_env_error(format!(
            "{} did not finish within {} ms.",
            command.program,
            timeout.as_millis()
        )));
    }

    let mut collected = receiver
        .recv_timeout(Duration::from_millis(DRAIN_AFTER_EXIT_MS))
        .ok();
    if collected.is_none() {
        // A grandchild can keep the pipe open past the shell's exit. End the group so the reader
        // sees EOF, then give it one more bounded wait.
        terminate_group(pid);
        collected = receiver
            .recv_timeout(Duration::from_millis(DRAIN_AFTER_EXIT_MS))
            .ok();
    }
    let bytes = collected.ok_or_else(|| {
        login_env_error("The login shell's output could not be read.".to_string())
    })?;

    let output = String::from_utf8_lossy(&bytes);
    let vars = parse_env_dump(&output, marker)?;
    Ok(strip_provider_secrets(vars))
}

/// Captures with `shell_path`, falling back to the plain login zsh once when needed.
pub fn capture_with_shell(shell_path: &str, cwd: &Path) -> CommandResult<LoginEnv> {
    capture_with_shell_and_fallback(shell_path, cwd, FALLBACK_SHELL)
}

/// The same capture with the fallback named, so tests can supply a fixture instead of the user's
/// own `zsh`.
fn capture_with_shell_and_fallback(
    shell_path: &str,
    cwd: &Path,
    fallback_shell: &str,
) -> CommandResult<LoginEnv> {
    capture_with_timeouts(
        shell_path,
        cwd,
        fallback_shell,
        Duration::from_millis(PRIMARY_CAPTURE_TIMEOUT_MS),
        Duration::from_millis(FALLBACK_CAPTURE_TIMEOUT_MS),
    )
}

/// The capture with both time limits named: `primary` bounds the user's own shell and `fallback`
/// bounds the plain login zsh that runs when the first attempt fails.
fn capture_with_timeouts(
    shell_path: &str,
    cwd: &Path,
    fallback_shell: &str,
    primary: Duration,
    fallback: Duration,
) -> CommandResult<LoginEnv> {
    let known = matches!(
        Path::new(shell_path)
            .file_name()
            .and_then(|name| name.to_str()),
        Some("zsh" | "bash" | "fish")
    );

    let primary_error = if known {
        let marker = new_marker();
        let command = capture_command_for(shell_path, &marker);
        match run_capture(&command, cwd, &marker, primary) {
            Ok(vars) => {
                return Ok(login_env_from(
                    shell_path.to_string(),
                    vars,
                    launch_zdotdir(std::env::var_os("ZDOTDIR")),
                ));
            }
            Err(error) => Some(error),
        }
    } else {
        None
    };

    let marker = new_marker();
    let command = fallback_capture_command_at(fallback_shell, &marker);
    // When both shells fail, the error names both causes: the user's own shell is the one to fix.
    let vars =
        run_capture(&command, cwd, &marker, fallback).map_err(
            |fallback_error| match primary_error {
                Some(primary_error) => login_env_error(format!(
                    "{shell_path}: {primary_error} Then {fallback_shell}: {fallback_error}"
                )),
                None => fallback_error,
            },
        )?;
    Ok(login_env_from(
        fallback_shell.to_string(),
        vars,
        launch_zdotdir(std::env::var_os("ZDOTDIR")),
    ))
}

fn login_env_from(
    shell: String,
    vars: HashMap<String, String>,
    zdotdir: Option<String>,
) -> LoginEnv {
    let path = vars.get("PATH").cloned().unwrap_or_default();
    LoginEnv {
        shell,
        path,
        zdotdir,
        vars,
    }
}

/// The app's own `ZDOTDIR`, as the UI receives it. Empty or not text means none, as zsh reads it.
fn launch_zdotdir(value: Option<std::ffi::OsString>) -> Option<String> {
    value
        .and_then(|value| value.into_string().ok())
        .filter(|value| !value.is_empty())
}

/// The user's shell, defaulting to zsh when the variable is missing or names a program that is
/// not there.
fn login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|path| path.starts_with('/') && Path::new(path).is_file())
        .unwrap_or_else(|| FALLBACK_SHELL.to_string())
}

/// The PATH a successful capture would repair, or None when the shell printed nothing usable.
fn path_to_repair(login: &LoginEnv) -> Option<&str> {
    (!login.path.is_empty()).then_some(login.path.as_str())
}

/// Replaces this process's PATH with the one the login shell prints, so every child the app starts
/// inherits it (native-and-sidecar-map A6 step 11).
fn repair_process_path(login: &LoginEnv) {
    let Some(path) = path_to_repair(login) else {
        return;
    };
    // SAFETY: no other thread of this app mutates the process environment. Other threads may read
    // it while this runs (child spawns and PTY readers), and the Rust lock does not cover libc
    // `getenv`. Setting PATH before the Tauri runtime starts is PLAT-27's startup work; until then
    // this write is the one known race in the capture.
    unsafe {
        std::env::set_var("PATH", path);
    }
}

/// Starts the one capture on a background task at launch, so the first git call does not wait.
pub fn start_background_capture(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<ShellState>();
        let _ = app_login_env(&state).await;
    });
}

/// Programs the web view may start. The resolved file must also sit in a trusted folder.
pub const ALLOWED_PROGRAMS: &[&str] = &[
    "git",
    "gh",
    "gt",
    "stat",
    "cp",
    "sleep",
    "echo",
    "true",
    "sh",
    "bash",
    "zsh",
    "kill",
    "which",
    "open",
    "lsof",
    "caffeinate",
    "pmset",
    "watchexec",
    "xcodebuild",
    "osascript",
    "ssh",
    "ssh-keygen",
    "checkpointer.sh",
    "spotlighter.sh",
    "git-busy-check.sh",
    "claude",
    "codex",
    "cursor-agent",
    "opencode",
    "pi",
];

/// The folders a program may live in: the system bin folders, the package-manager trees whose
/// links point into their own installation folders, and the app's own bin folders.
pub fn program_roots<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut roots = vec![
        PathBuf::from("/bin"),
        PathBuf::from("/sbin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/usr/sbin"),
    ];
    #[cfg(target_os = "macos")]
    {
        roots.push(PathBuf::from("/opt/homebrew"));
        roots.push(PathBuf::from("/usr/local"));
        roots.push(PathBuf::from("/opt/local"));
    }
    let resolver = app.path();
    if let Ok(dir) = resolver.resource_dir() {
        roots.push(dir.join("bin"));
    }
    if let Ok(dir) = resolver.app_data_dir() {
        let programs = crate::binaries::ProgramDirs::in_app_data(&dir);
        roots.push(programs.bin);
        roots.push(programs.binaries);
    }
    roots
}

/// Resolves `.` and `..` without touching the file system.
fn normalize_lexically(path: &Path) -> PathBuf {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                resolved.pop();
            }
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved
}

/// The real path when it exists, so a link inside a trusted folder is compared by its target.
fn canonical_or_lexical(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| {
        let absolute = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .map(|dir| dir.join(path))
                .unwrap_or_else(|_| path.to_path_buf())
        };
        normalize_lexically(&absolute)
    })
}

/// True when `path` is `root` itself or lies below it. Components are compared, so `/usr/bin-old`
/// does not match `/usr/bin`.
fn is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

/// Checks that `program` is on the list of programs the web view may start and that the file it
/// resolves to sits in one of `program_roots`. A bare name is resolved on `path`, the PATH the
/// child will see, so a file beside a repository cannot pass as a system program.
pub fn check_program_allowed(
    program: &str,
    allowed: &[&str],
    program_roots: &[PathBuf],
    path: Option<&str>,
) -> CommandResult<()> {
    let resolved = resolve_program(program, path)?;
    let name = resolved
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(program);
    if !allowed.contains(&name) {
        return Err(CommandError::Failed {
            code: "shell_program_not_allowed",
            message: format!("The window may not run this program: {program}"),
        });
    }
    let real = canonical_or_lexical(&resolved);
    let trusted = program_roots
        .iter()
        .any(|root| is_within(&real, &canonical_or_lexical(root)));
    if trusted {
        return Ok(());
    }
    Err(CommandError::Failed {
        code: "shell_program_not_allowed",
        message: format!(
            "The window may not run a program from this folder: {}",
            resolved.display()
        ),
    })
}

/// Runs a program to completion and returns its output.
#[tauri::command]
pub async fn shell_run(
    app: AppHandle,
    state: State<'_, ShellState>,
    command: ShellCommandRequest,
) -> CommandResult<ShellOutput> {
    let base_env = captured_env(&state, &command).await?;
    let roots = program_roots(&app);
    let timeout_ms = command.timeout_ms;
    let id = state.run_id();
    let joined = blocking("shell_wait_failed", move || {
        let state = app.state::<ShellState>();
        run_blocking(&state.running, &id, &command, &base_env, &roots)
    })
    .await?;

    run_output(joined, timeout_ms)
}

/// Starts a program and returns at once. The result arrives as `shell://done`.
#[tauri::command]
pub async fn shell_start<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, ShellState>,
    id: String,
    mut command: ShellCommandRequest,
) -> CommandResult<()> {
    let base_env = captured_env(&state, &command).await?;
    let roots = program_roots(&app);
    // Reserve the id first. A duplicate must fail before any process with side effects starts.
    let (child, cancelled_now) = begin_running(&state.running, &id, || {
        spawn_child(&command, &base_env, &roots)
    })?;
    let pid = child.id();

    let stdin = command.stdin.take();
    let timeout_ms = command.timeout_ms;
    // `shell_start` already returns once the process is registered. The result reaches the UI as a
    // `shell://done` event, so the task runs detached and its handle is dropped on purpose.
    drop(tauri::async_runtime::spawn_blocking(move || {
        if cancelled_now {
            // A cancel arrived while the id was reserved and nothing could be signalled yet.
            terminate_group(pid);
        }
        let result = drive_with_limit(child, stdin, timeout_ms, MAX_OUTPUT_BYTES);
        let state = app.state::<ShellState>();
        let done = finish_run(&state.running, id, result, timeout_ms);
        if let Ok(json) = serde_json::to_string(&done) {
            let _ = app.emit_str(EVENT_DONE, json);
        }
    }));
    Ok(())
}

/// Kills the process group of a command started with `shell_start`.
#[tauri::command]
pub async fn shell_cancel(state: State<'_, ShellState>, id: String) -> CommandResult<()> {
    let Some(pid) = request_cancel(&state.running, &id) else {
        return Ok(());
    };
    blocking("shell_cancel_failed", move || {
        terminate_group(pid);
        Ok(())
    })
    .await
}

/// Returns the login shell and its PATH. With `cwd`, as the login shell sees them in that folder,
/// captured once per folder (PLAT-07). Without it, the app-wide capture from startup.
#[tauri::command]
pub async fn shell_login_env(
    state: State<'_, ShellState>,
    cwd: Option<String>,
) -> CommandResult<LoginEnv> {
    match cwd {
        Some(cwd) => capture_in_folder(&state.folder_envs, &cwd, login_shell()).await,
        None => app_login_env(&state).await,
    }
}

/// The app-wide capture, made on the first call. Later calls reuse the same answer, so the UI and
/// the startup warm-up never run the shell twice.
pub async fn app_login_env(state: &ShellState) -> CommandResult<LoginEnv> {
    let mut cached = state.login_env.lock().await;
    if let Some(login) = cached.as_ref() {
        return Ok(login.clone());
    }
    let login = blocking("login_env_failed", capture_login_env).await?;
    repair_process_path(&login);
    *cached = Some(login.clone());
    Ok(login)
}

/// Runs the user's login shell once and reads the environment it exports. `shell_login_env` calls
/// this, and `start_background_capture` starts it at launch so the first git call does not wait.
/// A broken dotfile must not hang the app: the first attempt is bounded by 5 s, then a plain login
/// zsh gets 3 s. It fails with `login_env_failed` when no shell prints anything usable.
pub fn capture_login_env() -> CommandResult<LoginEnv> {
    let shell = login_shell();
    let cwd = std::env::current_dir().unwrap_or_else(|_| Path::new("/").to_path_buf());
    capture_with_shell(&shell, &cwd)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;

    #[test]
    fn plat_04_capture_uses_per_shell_flags_and_a_delimiter() {
        let zsh = capture_command_for("/bin/zsh", "MARK");
        assert_eq!(zsh.program, "/bin/zsh");
        assert_eq!(zsh.args[0], "-ilc");
        assert!(zsh.args[1].contains("env -0"));
        assert_eq!(zsh.args[1].matches("MARK").count(), 2);

        let bash = capture_command_for("/bin/bash", "MARK");
        assert_eq!(bash.args[0], "-ilc");

        let fish = capture_command_for("/opt/homebrew/bin/fish", "MARK");
        assert_eq!(
            fish.args,
            vec![
                "-i".to_string(),
                "-l".to_string(),
                "-c".to_string(),
                capture_script("MARK"),
            ]
        );
    }

    #[test]
    fn plat_04_an_unknown_shell_uses_the_plain_login_zsh() {
        let command = capture_command_for("/bin/tcsh", "MARK");
        assert_eq!(command.program, FALLBACK_SHELL);
        assert_eq!(
            command.args,
            vec!["-lc".to_string(), capture_script("MARK")]
        );
    }

    #[test]
    fn plat_04_parses_the_environment_between_the_delimiters() {
        let output = "startup noise\nMARKA=1\0B=two\nlines\0bad\0C=\0MARKtrailing";
        let vars = parse_env_dump(output, "MARK").expect("the dump is readable");
        assert_eq!(vars.get("A").map(String::as_str), Some("1"));
        assert_eq!(vars.get("B").map(String::as_str), Some("two\nlines"));
        assert_eq!(vars.get("C").map(String::as_str), Some(""));
        assert!(!vars.contains_key("bad"));
        assert!(!vars.contains_key("trailing"));
    }

    #[test]
    fn plat_04_a_missing_delimiter_fails_with_login_env_failed() {
        let error = parse_env_dump("no marker here", "MARK").expect_err("the dump is incomplete");
        assert_eq!(error_code(error), "login_env_failed");
    }

    #[test]
    fn plat_04_strips_provider_keys_and_exported_functions() {
        let vars = HashMap::from([
            ("PATH".to_string(), "/bin:/usr/bin".to_string()),
            ("ANTHROPIC_API_KEY".to_string(), "secret".to_string()),
            ("OPENAI_API_KEY".to_string(), "secret".to_string()),
            ("BASH_FUNC_thing%%".to_string(), "() { :; }".to_string()),
            ("CONDUCTED_CWD".to_string(), "/tmp".to_string()),
        ]);
        let stripped = strip_provider_secrets(vars);
        assert_eq!(
            stripped.get("PATH").map(String::as_str),
            Some("/bin:/usr/bin")
        );
        assert!(!stripped.contains_key("ANTHROPIC_API_KEY"));
        assert!(!stripped.contains_key("OPENAI_API_KEY"));
        assert!(!stripped.contains_key("BASH_FUNC_thing%%"));
        assert!(!stripped.contains_key("CONDUCTED_CWD"));
    }

    #[test]
    fn plat_04_capture_timeouts_are_five_and_three_seconds() {
        assert_eq!(PRIMARY_CAPTURE_TIMEOUT_MS, 5_000);
        assert_eq!(FALLBACK_CAPTURE_TIMEOUT_MS, 3_000);

        // The default capture applies them. Two shells that never answer are given up on after
        // the primary limit and the fallback limit. The runs go side by side to keep the wait
        // near five seconds. The outer bound only catches a hang.
        let primary_limit = Duration::from_millis(PRIMARY_CAPTURE_TIMEOUT_MS);
        let fallback_limit = Duration::from_millis(FALLBACK_CAPTURE_TIMEOUT_MS);
        let slack = Duration::from_secs(8);
        let silent = "#!/bin/sh\nsleep 30\n";
        let slow_primary_dir = TempProgramDir::new();
        let slow_primary = write_script(slow_primary_dir.path(), "zsh", silent);
        let answering = write_script(slow_primary_dir.path(), "fallback-shell", FIXTURE_SHELL);
        let slow_fallback_dir = TempProgramDir::new();
        let broken_primary = write_script(
            slow_fallback_dir.path(),
            "zsh",
            "#!/bin/sh\nprintf 'no marker'\n",
        );
        let silent_fallback = write_script(slow_fallback_dir.path(), "fallback-shell", silent);

        std::thread::scope(|scope| {
            let primary_run = scope.spawn(|| {
                let started = Instant::now();
                let login = capture_with_shell_and_fallback(
                    slow_primary.to_str().expect("the path is UTF-8"),
                    slow_primary_dir.path(),
                    answering.to_str().expect("the path is UTF-8"),
                )
                .expect("the fallback answers once the primary is given up on");
                (login.shell, started.elapsed())
            });
            let fallback_run = scope.spawn(|| {
                let started = Instant::now();
                let error = capture_with_shell_and_fallback(
                    broken_primary.to_str().expect("the path is UTF-8"),
                    slow_fallback_dir.path(),
                    silent_fallback.to_str().expect("the path is UTF-8"),
                )
                .expect_err("a fallback that never answers fails the capture");
                (error_code(error), started.elapsed())
            });

            let (shell, took) = primary_run.join().expect("the primary run finishes");
            assert_eq!(shell, answering.to_str().expect("the path is UTF-8"));
            assert!(
                took >= primary_limit,
                "gave up on the primary after {took:?}"
            );
            assert!(
                took < primary_limit + slack,
                "waited {took:?} for the primary"
            );

            let (code, took) = fallback_run.join().expect("the fallback run finishes");
            assert_eq!(code, "login_env_failed");
            assert!(
                took >= fallback_limit,
                "gave up on the fallback after {took:?}"
            );
            assert!(
                took < fallback_limit + slack,
                "waited {took:?} for the fallback"
            );
        });
    }

    #[test]
    fn plat_04_a_shell_slower_than_its_primary_timeout_is_given_up_on() {
        // The primary shell would answer after 3 s. Its limit is 150 ms and the fallback's limit
        // is long, so only the primary limit decides which shell answers.
        let dir = TempProgramDir::new();
        let slow = write_script(
            dir.path(),
            "zsh",
            "#!/bin/sh\nsleep 3\nexec /bin/sh -c \"$2\"\n",
        );
        let fallback = write_script(dir.path(), "fallback-shell", FIXTURE_SHELL);
        let started = Instant::now();
        let login = capture_with_timeouts(
            slow.to_str().expect("the path is UTF-8"),
            dir.path(),
            fallback.to_str().expect("the path is UTF-8"),
            Duration::from_millis(150),
            Duration::from_secs(30),
        )
        .expect("the fallback answers");
        assert_eq!(login.shell, fallback.to_str().expect("the path is UTF-8"));
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "the slow shell was waited for: {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn plat_04_a_fallback_slower_than_its_own_timeout_fails_the_capture() {
        // The fallback would answer after 3 s. Its limit is 150 ms while the primary's limit is
        // long, so only the fallback limit ends the wait.
        let dir = TempProgramDir::new();
        let broken = write_script(dir.path(), "zsh", "#!/bin/sh\nprintf 'no marker'\n");
        let slow = write_script(
            dir.path(),
            "fallback-shell",
            "#!/bin/sh\nsleep 3\nexec /bin/sh -c \"$2\"\n",
        );
        let started = Instant::now();
        let error = capture_with_timeouts(
            broken.to_str().expect("the path is UTF-8"),
            dir.path(),
            slow.to_str().expect("the path is UTF-8"),
            Duration::from_secs(30),
            Duration::from_millis(150),
        )
        .expect_err("the slow fallback times out");
        assert_eq!(error_code(error), "login_env_failed");
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "the slow fallback was waited for: {:?}",
            started.elapsed()
        );
    }

    #[test]
    fn run_09_hands_the_ui_the_zdotdir_the_app_was_launched_with() {
        use std::ffi::OsString;
        assert_eq!(
            launch_zdotdir(Some(OsString::from("/Users/me/.config/zsh"))),
            Some("/Users/me/.config/zsh".to_string())
        );
        assert_eq!(launch_zdotdir(Some(OsString::new())), None);
        assert_eq!(launch_zdotdir(None), None);

        let vars = HashMap::from([("PATH".to_string(), "/usr/bin".to_string())]);
        let login = login_env_from(
            "/bin/zsh".to_string(),
            vars,
            Some("/Users/me/dotfiles".to_string()),
        );
        let json = serde_json::to_value(&login).expect("a login env serialises");
        assert_eq!(
            json,
            serde_json::json!({
                "shell": "/bin/zsh",
                "path": "/usr/bin",
                "zdotdir": "/Users/me/dotfiles"
            })
        );
    }

    #[test]
    fn plat_04_repairs_path_only_from_a_usable_capture() {
        let empty = LoginEnv {
            shell: "/bin/zsh".to_string(),
            path: String::new(),
            zdotdir: None,
            vars: HashMap::new(),
        };
        assert_eq!(path_to_repair(&empty), None);

        let usable = LoginEnv {
            shell: "/bin/zsh".to_string(),
            path: "/opt/homebrew/bin:/usr/bin:/bin".to_string(),
            zdotdir: None,
            vars: HashMap::new(),
        };
        assert_eq!(
            path_to_repair(&usable),
            Some("/opt/homebrew/bin:/usr/bin:/bin")
        );
    }

    const FIXTURE_SHELL: &str = "#!/bin/sh\nexec /bin/sh -c \"$2\"\n";

    fn fixture_dir() -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or(0);
        let dir =
            std::env::temp_dir().join(format!("conducted-plat-04-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("the fixture folder is made");
        dir
    }

    fn write_script(dir: &Path, name: &str, body: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, body).expect("the fixture script is written");
        let mut permissions = std::fs::metadata(&path)
            .expect("the fixture script exists")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&path, permissions).expect("the fixture script is executable");
        path
    }

    #[test]
    fn plat_07_a_folder_is_captured_once_and_another_folder_on_its_own() {
        let envs = FolderEnvs::default();
        let runs = std::sync::atomic::AtomicUsize::new(0);
        let capture = |folder: PathBuf| {
            runs.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async move {
                Ok(LoginEnv {
                    shell: "/bin/zsh".to_string(),
                    path: folder.to_string_lossy().into_owned(),
                    zdotdir: None,
                    vars: HashMap::new(),
                })
            }
        };

        let first = tauri::async_runtime::block_on(envs.get_or_capture(Path::new("/a"), capture))
            .expect("the first capture");
        let again = tauri::async_runtime::block_on(envs.get_or_capture(Path::new("/a"), capture))
            .expect("the cached capture");
        let other = tauri::async_runtime::block_on(envs.get_or_capture(Path::new("/b"), capture))
            .expect("the other folder");

        assert_eq!((first.path.as_str(), again.path.as_str()), ("/a", "/a"));
        assert_eq!(other.path, "/b");
        assert_eq!(runs.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    #[test]
    fn plat_07_a_failed_folder_capture_is_tried_again() {
        let envs = FolderEnvs::default();
        let failed = tauri::async_runtime::block_on(envs.get_or_capture(Path::new("/a"), |_| {
            std::future::ready(Err(login_env_error("first try".to_string())))
        }));
        assert!(failed.is_err());

        let second = tauri::async_runtime::block_on(envs.get_or_capture(Path::new("/a"), |_| {
            std::future::ready(Ok(LoginEnv {
                shell: "/bin/zsh".to_string(),
                path: "/second".to_string(),
                zdotdir: None,
                vars: HashMap::new(),
            }))
        }))
        .expect("the second try runs");
        assert_eq!(second.path, "/second");
    }

    #[test]
    fn plat_07_a_folder_capture_sees_that_folder() {
        let dir = TempProgramDir::new();
        let folder = dir.path().join("project");
        std::fs::create_dir(&folder).expect("the project folder");
        let shell = write_script(dir.path(), "zsh", FIXTURE_SHELL);
        let envs = FolderEnvs::default();

        let login = tauri::async_runtime::block_on(capture_in_folder(
            &envs,
            folder.to_str().expect("the path is UTF-8"),
            shell.to_str().expect("the path is UTF-8").to_string(),
        ))
        .expect("the fixture shell prints the environment");

        let pwd = login.vars.get("PWD").expect("the shell reports its folder");
        assert_eq!(
            std::fs::canonicalize(pwd).expect("PWD exists"),
            std::fs::canonicalize(&folder).expect("the folder exists")
        );
    }

    #[test]
    fn plat_07_a_command_that_asks_starts_from_its_folder_capture() {
        let state = ShellState::default();
        let mut command = request("/usr/bin/env", &[]);
        command.env_from_cwd = true;
        let folder = PathBuf::from(&command.cwd);
        tauri::async_runtime::block_on(state.folder_envs.get_or_capture(&folder, |_| {
            std::future::ready(Ok(LoginEnv {
                shell: "/bin/zsh".to_string(),
                path: "/folder/bin".to_string(),
                zdotdir: None,
                vars: HashMap::from([("FROM_FOLDER".to_string(), "yes".to_string())]),
            }))
        }))
        .expect("the folder capture is kept");

        let env = tauri::async_runtime::block_on(captured_env(&state, &command))
            .expect("the command's base environment");

        assert_eq!(env.get("FROM_FOLDER").map(String::as_str), Some("yes"));
    }

    #[test]
    fn plat_07_a_relative_folder_is_refused() {
        let envs = FolderEnvs::default();
        let error = tauri::async_runtime::block_on(capture_in_folder(
            &envs,
            "relative/folder",
            "/bin/zsh".to_string(),
        ))
        .expect_err("a relative folder is refused");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "shell_bad_cwd",
                ..
            }
        ));
    }

    #[test]
    fn plat_04_captures_the_login_shell_path_and_environment() {
        let dir = fixture_dir();
        let shell = write_script(&dir, "zsh", FIXTURE_SHELL);
        let login = capture_with_shell(shell.to_str().expect("the path is UTF-8"), &dir)
            .expect("the fixture shell prints the environment");
        assert_eq!(login.shell, shell.to_str().expect("the path is UTF-8"));
        assert!(!login.path.is_empty());
        assert_eq!(login.vars.get("PATH"), Some(&login.path));
        assert!(login.vars.len() > 1, "the capture keeps more than PATH");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn plat_04_falls_back_when_the_shell_is_unknown() {
        let dir = fixture_dir();
        let fallback = write_script(&dir, "fallback-shell", FIXTURE_SHELL);
        let login = capture_with_shell_and_fallback(
            "/nonexistent/shell",
            &dir,
            fallback.to_str().expect("the path is UTF-8"),
        )
        .expect("the fallback fixture runs");
        assert_eq!(login.shell, fallback.to_str().expect("the path is UTF-8"));
        assert!(!login.path.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn plat_04_a_failed_capture_names_why_both_shells_failed() {
        let dir = TempProgramDir::new();
        let broken = write_script(dir.path(), "zsh", "#!/bin/sh\nprintf 'no marker'\n");
        let silent = write_script(dir.path(), "fallback-shell", "#!/bin/sh\nsleep 30\n");

        let error = capture_with_timeouts(
            broken.to_str().expect("the path is UTF-8"),
            dir.path(),
            silent.to_str().expect("the path is UTF-8"),
            Duration::from_secs(30),
            Duration::from_millis(150),
        )
        .expect_err("neither shell prints an environment");

        let message = error.to_string();
        assert!(
            message.contains("printed no environment marker"),
            "the user's shell is named: {message}"
        );
        assert!(
            message.contains("did not finish within 150 ms"),
            "the fallback is named: {message}"
        );
        assert_eq!(error_code(error), "login_env_failed");
    }

    #[test]
    fn plat_04_a_broken_primary_shell_falls_back_to_the_given_shell() {
        let dir = fixture_dir();
        let primary = write_script(&dir, "zsh", "#!/bin/sh\nprintf 'no marker'\n");
        let fallback = write_script(&dir, "fallback-shell", FIXTURE_SHELL);
        let login = capture_with_shell_and_fallback(
            primary.to_str().expect("the path is UTF-8"),
            &dir,
            fallback.to_str().expect("the path is UTF-8"),
        )
        .expect("the fallback fixture runs");
        assert_eq!(login.shell, fallback.to_str().expect("the path is UTF-8"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn plat_04_a_capture_that_outlives_its_timeout_is_killed() {
        let dir = fixture_dir();
        let marker = dir.join("finished");
        let body = format!("#!/bin/sh\nsleep 0.4\ntouch '{}'\n", marker.display());
        let shell = write_script(&dir, "slow", &body);
        let command = CaptureCommand {
            program: shell.to_str().expect("the path is UTF-8").to_string(),
            args: Vec::new(),
        };
        let started = Instant::now();
        let error = run_capture(&command, &dir, "MARK", Duration::from_millis(80))
            .expect_err("the slow capture times out");
        assert_eq!(error_code(error), "login_env_failed");
        assert!(started.elapsed() < Duration::from_secs(5));
        thread::sleep(Duration::from_millis(500));
        assert!(
            !marker.exists(),
            "the capture's child must be killed at the timeout"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    fn test_env() -> HashMap<String, String> {
        let mut env = HashMap::new();
        env.insert(
            "PATH".to_string(),
            "/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
        );
        env
    }

    fn test_program_roots() -> Vec<PathBuf> {
        vec![
            PathBuf::from("/bin"),
            PathBuf::from("/sbin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/opt/homebrew"),
            PathBuf::from("/usr/local"),
            PathBuf::from("/opt/local"),
        ]
    }

    /// A folder under the run's temp folder that removes itself, so a test leaves nothing behind.
    struct TempProgramDir {
        path: PathBuf,
    }

    impl TempProgramDir {
        fn new() -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-plat-29-{}-{counter}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create the test folder");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempProgramDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn request(program: &str, args: &[&str]) -> ShellCommandRequest {
        ShellCommandRequest {
            program: program.to_string(),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            env: None,
            stdin: None,
            timeout_ms: Some(10_000),
            env_from_cwd: false,
        }
    }

    fn error_code(error: CommandError) -> String {
        match error {
            CommandError::Failed { code, .. } => code.to_string(),
            other => other.to_string(),
        }
    }

    fn process_exists(pid: i32) -> bool {
        Command::new("/bin/kill")
            .arg("-0")
            .arg(pid.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }

    #[test]
    fn plat_03_runs_a_command_and_returns_its_output() {
        let finished = run_in(
            &ShellState::default(),
            &request("/bin/sh", &["-c", "printf 'hello'"]),
        )
        .expect("the command runs");
        assert_eq!(finished.output.stdout, "hello");
        assert_eq!(finished.output.exit_code, 0);
        assert!(!finished.timed_out);
        assert!(!finished.overflowed);
    }

    #[test]
    fn plat_03_a_non_zero_exit_is_still_an_ok_result() {
        let finished = run_in(
            &ShellState::default(),
            &request("/bin/sh", &["-c", "printf 'oops' >&2; exit 3"]),
        )
        .expect("the command runs");
        assert_eq!(finished.output.exit_code, 3);
        assert_eq!(finished.output.stderr, "oops");
    }

    #[test]
    fn plat_03_arguments_are_not_parsed_by_a_shell() {
        let value = "a b $HOME 'quoted'";
        let finished = run_in(&ShellState::default(), &request("/bin/echo", &[value]))
            .expect("the command runs");
        assert_eq!(finished.output.stdout, format!("{value}\n"));
    }

    #[test]
    fn plat_03_cwd_env_and_stdin_are_honoured() {
        let dir = std::env::temp_dir();
        let mut command = request(
            "/bin/sh",
            &["-c", "pwd; cat; printf '%s' \"$CONDUCTED_TEST\""],
        );
        command.cwd = dir.to_string_lossy().into_owned();
        command.stdin = Some("from stdin".to_string());
        command.env = Some(HashMap::from([(
            "CONDUCTED_TEST".to_string(),
            "value".to_string(),
        )]));

        let finished = run_in(&ShellState::default(), &command).expect("the command runs");
        let expected_dir = dir.canonicalize().expect("the temp folder exists");
        assert_eq!(
            finished.output.stdout,
            format!("{}\nfrom stdinvalue", expected_dir.display())
        );
    }

    #[test]
    fn plat_03_a_signalled_process_reports_128_plus_the_signal() {
        let finished = run_in(
            &ShellState::default(),
            &request("/bin/sh", &["-c", "kill -TERM $$"]),
        )
        .expect("the command runs");
        assert_eq!(finished.output.exit_code, 128 + 15);
    }

    #[test]
    fn plat_03_a_timeout_ends_the_process_group_with_shell_timeout() {
        let mut command = request("/bin/sh", &["-c", "sleep 30 & wait"]);
        command.timeout_ms = Some(150);
        let started = Instant::now();
        let finished = run_in(&ShellState::default(), &command).expect("the command runs");
        assert!(finished.timed_out);
        assert!(started.elapsed() < Duration::from_secs(10));

        let done = shell_done("timeout".into(), Ok(finished), false, command.timeout_ms);
        assert!(done.output.is_none());
        assert_eq!(done.error.map(error_code).as_deref(), Some("shell_timeout"));
    }

    #[test]
    fn plat_03_run_reports_a_timeout_as_an_error() {
        let mut command = request("/bin/sh", &["-c", "sleep 30"]);
        command.timeout_ms = Some(120);
        let finished = run_in(&ShellState::default(), &command).expect("the command runs");
        let error = run_output(finished, command.timeout_ms).expect_err("a timeout is an error");
        assert_eq!(error_code(error), "shell_timeout");
    }

    #[test]
    fn plat_03_output_past_the_limit_kills_the_command_and_reports_it() {
        let child = spawn_child(
            &request(
                "/bin/sh",
                &["-c", "while true; do printf '0123456789'; done"],
            ),
            &test_env(),
            &test_program_roots(),
        )
        .expect("the command starts");
        let started = Instant::now();
        let finished = drive_with_limit(child, None, Some(5_000), 1024).expect("the command ends");
        assert!(finished.overflowed);
        assert!(started.elapsed() < Duration::from_secs(10));

        let done = shell_done("large".into(), Ok(finished), false, None);
        assert!(done.output.is_none());
        assert_eq!(
            done.error.map(error_code).as_deref(),
            Some("shell_output_too_large")
        );
    }

    #[test]
    fn plat_03_a_duplicate_id_is_refused() {
        let running = Mutex::new(HashMap::new());
        register_running(&running, "same".into(), 111).expect("the first id is new");
        let error =
            register_running(&running, "same".into(), 222).expect_err("the second id is taken");
        assert_eq!(error_code(error), "shell_duplicate_id");
    }

    #[test]
    fn plat_03_a_duplicate_id_never_reaches_the_spawner() {
        let running = Mutex::new(HashMap::new());
        register_running(&running, "same".into(), 111).expect("the first id is new");
        let mut spawned = false;
        let error = begin_running(&running, "same", || -> CommandResult<Child> {
            spawned = true;
            Err(CommandError::Failed {
                code: "unused",
                message: "the spawner must not run".to_string(),
            })
        })
        .expect_err("the duplicate id is refused");
        assert_eq!(error_code(error), "shell_duplicate_id");
        assert!(!spawned, "a duplicate id must not start a process");
    }

    #[test]
    fn plat_03_a_failed_spawn_releases_the_id() {
        let running = Mutex::new(HashMap::new());
        let error = begin_running(&running, "run", || -> CommandResult<Child> {
            Err(CommandError::Failed {
                code: "shell_spawn_failed",
                message: "not started".to_string(),
            })
        })
        .expect_err("the spawn fails");
        assert_eq!(error_code(error), "shell_spawn_failed");
        register_running(&running, "run".into(), 9).expect("the id was released");
    }

    #[test]
    fn plat_03_a_successful_spawn_records_its_pid() {
        let running = Mutex::new(HashMap::new());
        let (mut child, cancelled) = begin_running(&running, "run", || {
            Command::new("/bin/sh")
                .arg("-c")
                .arg("exit 0")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .process_group(0)
                .spawn()
                .map_err(|error| CommandError::Failed {
                    code: "shell_spawn_failed",
                    message: error.to_string(),
                })
        })
        .expect("the child starts");
        assert!(!cancelled);
        let pid = child.id();
        assert_eq!(
            lock_running(&running).get("run").map(|process| process.pid),
            Some(pid)
        );
        let _ = child.wait();
        let _ = remove_finished(&running, "run");
    }

    #[test]
    fn plat_03_a_cancel_while_reserved_is_remembered() {
        let running = Mutex::new(HashMap::new());
        reserve_running(&running, "run".into()).expect("the id is new");
        assert_eq!(
            request_cancel(&running, "run"),
            None,
            "there is no process to signal yet"
        );
        assert!(
            set_running_pid(&running, "run", 4242),
            "the cancel must be remembered when the pid arrives"
        );
        let _ = remove_finished(&running, "run");
    }

    #[test]
    fn plat_03_finish_run_carries_the_cancel_to_the_done_payload() {
        let running = Mutex::new(HashMap::new());
        register_running(&running, "run".into(), 4242).expect("the id is new");
        assert_eq!(request_cancel(&running, "run"), Some(4242));
        let finished = Finished {
            output: ShellOutput {
                exit_code: 143,
                stdout: String::new(),
                stderr: String::new(),
            },
            timed_out: false,
            overflowed: false,
        };
        let done = finish_run(&running, "run".into(), Ok(finished), None);
        assert!(done.output.is_none());
        assert_eq!(
            done.error.map(error_code).as_deref(),
            Some("shell_cancelled")
        );
        assert!(lock_running(&running).is_empty());
    }

    #[test]
    fn plat_03_finish_run_reports_a_timeout() {
        let running = Mutex::new(HashMap::new());
        register_running(&running, "run".into(), 4242).expect("the id is new");
        let finished = Finished {
            output: ShellOutput {
                exit_code: 128 + 15,
                stdout: String::new(),
                stderr: String::new(),
            },
            timed_out: true,
            overflowed: false,
        };
        let done = finish_run(&running, "run".into(), Ok(finished), Some(150));
        assert!(done.output.is_none());
        assert_eq!(done.error.map(error_code).as_deref(), Some("shell_timeout"));
        assert!(lock_running(&running).is_empty());
    }

    #[test]
    fn plat_03_the_shared_group_helper_signals_a_real_group() {
        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg("sleep 30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0)
            .spawn()
            .expect("the child starts");
        let pid = child.id();
        assert!(
            !process_group::signal_group(0, 0),
            "group 0 would signal the caller's own group"
        );
        assert!(process_group::group_exists(pid));
        assert!(process_group::signal_group(pid, process_group::SIGTERM));
        let _ = child.wait();
        let deadline = Instant::now() + Duration::from_secs(5);
        while process_group::group_exists(pid) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            !process_group::group_exists(pid),
            "the group must end when its leader does"
        );
    }

    #[test]
    fn plat_03_a_grandchild_holding_the_pipe_does_not_block_the_result() {
        let command = request("/bin/sh", &["-c", "sleep 30 & echo $!; echo done"]);
        let started = Instant::now();
        let finished = run_in(&ShellState::default(), &command).expect("the command ends");
        assert!(finished.output.stdout.contains("done"));
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "a grandchild that keeps the pipe open must not hold the call"
        );
        if let Some(grandchild) = finished.output.stdout.lines().next() {
            let _ = Command::new("/bin/kill")
                .arg("-KILL")
                .arg(grandchild.trim())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
    }

    #[test]
    fn plat_03_cancelling_an_unknown_id_is_a_no_op() {
        let running = Mutex::new(HashMap::new());
        assert!(request_cancel(&running, "missing").is_none());
    }

    #[test]
    fn plat_03_cancel_ends_the_process_and_its_child() {
        let mut child = spawn_child(
            &request("/bin/sh", &["-c", "sleep 30 & echo $!; wait"]),
            &test_env(),
            &test_program_roots(),
        )
        .expect("the shell starts");
        let pid = child.id();
        let stdout = child.stdout.take().expect("stdout is piped");
        let mut reader = std::io::BufReader::new(stdout);
        let mut line = String::new();
        reader.read_line(&mut line).expect("the child pid is read");
        let grandchild: i32 = line.trim().parse().expect("the child pid is a number");

        let running = Mutex::new(HashMap::new());
        register_running(&running, "sleep".into(), pid).expect("the id is new");
        let cancel_pid = request_cancel(&running, "sleep").expect("the run is registered");
        assert_eq!(cancel_pid, pid);
        terminate_group(cancel_pid);
        let _ = child.wait();
        assert!(remove_finished(&running, "sleep"));

        let deadline = Instant::now() + Duration::from_secs(5);
        while process_exists(grandchild) && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            !process_exists(grandchild),
            "the child of a cancelled command must end too"
        );
    }

    #[test]
    fn plat_03_a_cancelled_run_reports_shell_cancelled() {
        let command = request("/bin/sh", &["-c", "sleep 30"]);
        let child =
            spawn_child(&command, &test_env(), &test_program_roots()).expect("the command starts");
        let pid = child.id();
        let running = Mutex::new(HashMap::new());
        register_running(&running, "run".into(), pid).expect("the id is new");
        assert_eq!(request_cancel(&running, "run"), Some(pid));
        terminate_group(pid);

        let finished =
            drive_with_limit(child, None, None, MAX_OUTPUT_BYTES).expect("the command ends");
        let cancelled = remove_finished(&running, "run");
        let done = shell_done("run".into(), Ok(finished), cancelled, None);
        assert!(done.output.is_none());
        assert_eq!(
            done.error.map(error_code).as_deref(),
            Some("shell_cancelled")
        );
    }

    /// Runs a one-shot command the way `shell_run` does, over the app's shell state.
    fn run_in(state: &ShellState, command: &ShellCommandRequest) -> CommandResult<Finished> {
        run_blocking(
            &state.running,
            &state.run_id(),
            command,
            &test_env(),
            &test_program_roots(),
        )
    }

    #[test]
    fn plat_03_quitting_ends_a_one_shot_command_and_its_children() {
        let state = Arc::new(ShellState::default());
        let shared = Arc::clone(&state);
        let run =
            thread::spawn(move || run_in(&shared, &request("/bin/sh", &["-c", "sleep 30 & wait"])));
        // The run registers its process group once it has started; this catches a run that never
        // does, and is not a way to wait.
        let deadline = Instant::now() + Duration::from_secs(10);
        let pid = loop {
            let started = lock_running(&state.running)
                .values()
                .map(|process| process.pid)
                .find(|pid| *pid != 0);
            if let Some(pid) = started {
                break pid;
            }
            assert!(
                Instant::now() < deadline,
                "the one-shot command never appeared in the table that quitting ends"
            );
            thread::sleep(Duration::from_millis(10));
        };

        let signalled = terminate_all(&state.running, Duration::from_secs(5));
        let result = run.join().expect("the run's thread finishes");

        assert_eq!(signalled, 1);
        assert!(
            !process_group::group_exists(pid),
            "the command and its child must end with the app"
        );
        assert_eq!(
            result.err().map(error_code).as_deref(),
            Some("shell_cancelled")
        );
        assert!(
            lock_running(&state.running).is_empty(),
            "a finished run leaves the table"
        );
    }

    #[test]
    fn plat_03_quitting_ends_every_running_command_and_its_children() {
        let first = spawn_child(
            &request("/bin/sh", &["-c", "sleep 30"]),
            &test_env(),
            &test_program_roots(),
        )
        .expect("the first command starts");
        let second = spawn_child(
            &request("/bin/sh", &["-c", "sleep 30 & wait"]),
            &test_env(),
            &test_program_roots(),
        )
        .expect("the second command starts");
        let (first_pid, second_pid) = (first.id(), second.id());
        // The app's own waiter threads reap a finished command; these stand in for them.
        let reapers: Vec<_> = [first, second]
            .into_iter()
            .map(|mut child| thread::spawn(move || child.wait()))
            .collect();
        let running = Mutex::new(HashMap::new());
        register_running(&running, "first".into(), first_pid).expect("the id is new");
        register_running(&running, "second".into(), second_pid).expect("the id is new");
        reserve_running(&running, "reserved".into()).expect("the id is new");

        let signalled = terminate_all(&running, Duration::from_secs(5));
        for reaper in reapers {
            reaper
                .join()
                .expect("the reaper finishes")
                .expect("the command ends");
        }

        assert_eq!(signalled, 2, "the reservation has no group to signal");
        assert!(!process_group::group_exists(first_pid));
        assert!(
            !process_group::group_exists(second_pid),
            "the command's child must end with it"
        );
        assert!(remove_finished(&running, "first"));
        assert!(remove_finished(&running, "reserved"));
    }

    #[test]
    fn plat_29_allows_a_named_program_and_its_absolute_path() {
        let path = Some("/usr/bin:/bin:/usr/sbin:/sbin");
        check_program_allowed("git", ALLOWED_PROGRAMS, &test_program_roots(), path)
            .expect("a bare name is allowed");
        check_program_allowed(
            "/usr/bin/git",
            ALLOWED_PROGRAMS,
            &test_program_roots(),
            path,
        )
        .expect("an absolute path with an allowed file name is allowed");
        check_program_allowed(
            "/opt/homebrew/bin/gh",
            ALLOWED_PROGRAMS,
            &test_program_roots(),
            path,
        )
        .expect("a managed program path is allowed");
    }

    /// The `program: "<value>"` literals in the UI's TypeScript, skipping test files: those talk
    /// to the in-memory Platform and never reach this allowlist.
    fn ui_program_literals(dir: &Path, found: &mut Vec<String>) {
        let entries = std::fs::read_dir(dir).expect("the UI source folder is readable");
        for entry in entries {
            let path = entry.expect("the folder entry is readable").path();
            if path.is_dir() {
                ui_program_literals(&path, found);
                continue;
            }
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("");
            let is_source = matches!(
                path.extension().and_then(|extension| extension.to_str()),
                Some("ts" | "tsx")
            );
            if !is_source || name.contains(".test.") {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("the source file is readable");
            found.extend(program_literal_values(&source));
        }
    }

    /// Every `program: "<value>"` in one source file.
    fn program_literal_values(source: &str) -> Vec<String> {
        let mut values = Vec::new();
        let mut rest = source;
        while let Some(at) = rest.find("program:") {
            rest = &rest[at + "program:".len()..];
            let Some(quoted) = rest.trim_start().strip_prefix('"') else {
                continue;
            };
            let Some(end) = quoted.find('"') else {
                continue;
            };
            values.push(quoted[..end].to_string());
            rest = &quoted[end..];
        }
        values
    }

    /// The allowlist holds names; a program the UI names by path (`/bin/echo`) is checked by
    /// its file name, as `check_program_allowed` does.
    fn program_file_name(program: &str) -> &str {
        Path::new(program)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(program)
    }

    #[test]
    fn git_16_allows_the_xcode_licence_programs() {
        for program in ["xcodebuild", "osascript"] {
            assert!(
                ALLOWED_PROGRAMS.contains(&program),
                "the Xcode licence flow starts {program}"
            );
        }
    }

    #[test]
    fn git_16_every_program_the_ui_starts_is_allowed() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src");
        let mut programs = Vec::new();
        ui_program_literals(&src, &mut programs);
        assert!(
            programs.iter().any(|program| program.as_str() == "git"),
            "the scan reads the UI source at {src:?}"
        );
        for program in &programs {
            assert!(
                ALLOWED_PROGRAMS.contains(&program_file_name(program)),
                "the UI starts {program}, which the allowlist refuses"
            );
        }
        // These reach the shell through a variable, so the literal scan cannot see them.
        for program in [
            "zsh",
            "checkpointer.sh",
            "spotlighter.sh",
            "git-busy-check.sh",
        ] {
            assert!(
                ALLOWED_PROGRAMS.contains(&program),
                "the UI starts {program}, which the allowlist refuses"
            );
        }
    }

    #[test]
    fn plat_29_rejects_a_program_outside_the_list_and_names_it() {
        let error = check_program_allowed(
            "/usr/bin/curl",
            ALLOWED_PROGRAMS,
            &test_program_roots(),
            None,
        )
        .expect_err("a program outside the list is refused");
        assert_eq!(error_code(error), "shell_program_not_allowed");
        let message = match check_program_allowed(
            "curl",
            ALLOWED_PROGRAMS,
            &test_program_roots(),
            Some("/usr/bin:/bin"),
        ) {
            Err(CommandError::Failed { message, .. }) => message,
            other => panic!("unexpected result: {other:?}"),
        };
        assert!(message.contains("curl"), "the error names the program");
    }

    #[test]
    fn plat_29_rejects_an_allowed_name_in_an_untrusted_folder() {
        use std::os::unix::fs::PermissionsExt;

        let folder = TempProgramDir::new();
        let program = folder.path().join("git");
        std::fs::write(&program, "#!/bin/sh\nexit 0\n").expect("write the fake program");
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755))
            .expect("make it executable");
        let folder_text = folder.path().to_string_lossy().into_owned();
        let program_text = program.to_string_lossy().into_owned();

        let by_path =
            check_program_allowed(&program_text, ALLOWED_PROGRAMS, &test_program_roots(), None)
                .expect_err("a path in a folder outside the trusted ones is refused");
        assert_eq!(error_code(by_path), "shell_program_not_allowed");

        let by_path_lookup = check_program_allowed(
            "git",
            ALLOWED_PROGRAMS,
            &test_program_roots(),
            Some(&folder_text),
        )
        .expect_err("a bare name found in an untrusted folder is refused");
        assert_eq!(error_code(by_path_lookup), "shell_program_not_allowed");
    }

    #[test]
    fn plat_29_spawning_a_program_outside_the_list_is_refused() {
        let error = spawn_child(
            &request("/usr/bin/curl", &["--version"]),
            &test_env(),
            &test_program_roots(),
        )
        .expect_err("the program never starts");
        assert_eq!(error_code(error), "shell_program_not_allowed");
    }

    #[test]
    fn plat_03_quitting_kills_a_command_that_ignores_sigterm() {
        let mut child = spawn_child(
            &request(
                "/bin/sh",
                &["-c", "trap '' TERM; echo ready; while :; do sleep 1; done"],
            ),
            &test_env(),
            &test_program_roots(),
        )
        .expect("the command starts");
        let pid = child.id();
        // Wait for the trap to be in place, or SIGTERM would end the shell before it ignores it.
        let stdout = child.stdout.take().expect("stdout is piped");
        let mut line = String::new();
        std::io::BufReader::new(stdout)
            .read_line(&mut line)
            .expect("the ready line is read");
        assert_eq!(line.trim(), "ready");
        let reaper = thread::spawn(move || child.wait());
        let running = Mutex::new(HashMap::new());
        register_running(&running, "stubborn".into(), pid).expect("the id is new");

        terminate_all(&running, Duration::from_millis(300));
        let status = reaper
            .join()
            .expect("the reaper finishes")
            .expect("the command ends");

        assert_eq!(status.signal(), Some(9), "SIGKILL ended it after the grace");
        assert!(!process_group::group_exists(pid));
    }

    #[test]
    fn set_13_a_script_path_prefix_goes_first_on_path() {
        let mut command = request("/bin/sh", &["-c", "true"]);
        command.env = Some(HashMap::from([(
            "CONDUCTED_PATH_PREFIX".to_string(),
            "/data/bin-overrides/abc".to_string(),
        )]));

        let built = build_command(&command, &test_env(), &test_program_roots())
            .expect("the command is built");

        let path = built
            .get_envs()
            .find(|(key, _)| *key == "PATH")
            .and_then(|(_, value)| value);
        assert_eq!(
            path,
            Some(std::ffi::OsStr::new(
                "/data/bin-overrides/abc:/usr/bin:/bin:/usr/sbin:/sbin"
            ))
        );
    }

    #[test]
    fn set_13_the_path_prefix_joins_a_path_without_doubling_the_colon() {
        assert_eq!(
            path_with_prefix("/shims/abc", "/usr/bin"),
            "/shims/abc:/usr/bin"
        );
        assert_eq!(path_with_prefix("/shims/abc", ""), "/shims/abc");
        assert_eq!(path_with_prefix("", "/usr/bin"), "/usr/bin");
    }

    #[test]
    fn set_13_prefixed_path_prefers_the_overlay_path_and_needs_the_variable() {
        let base = HashMap::from([("PATH".to_string(), "/usr/bin".to_string())]);
        let with_path = HashMap::from([
            (
                "CONDUCTED_PATH_PREFIX".to_string(),
                "/shims/abc".to_string(),
            ),
            ("PATH".to_string(), "/opt/bin".to_string()),
        ]);
        let without_path = HashMap::from([(
            "CONDUCTED_PATH_PREFIX".to_string(),
            "/shims/abc".to_string(),
        )]);
        let without_prefix = HashMap::from([("PATH".to_string(), "/opt/bin".to_string())]);

        assert_eq!(
            prefixed_path(&with_path, &base),
            Some("/shims/abc:/opt/bin".to_string())
        );
        assert_eq!(
            prefixed_path(&without_path, &base),
            Some("/shims/abc:/usr/bin".to_string())
        );
        assert_eq!(prefixed_path(&without_prefix, &base), None);
    }

    #[test]
    fn plat_25_the_bundle_ships_every_helper_script_the_window_may_run() {
        // The UI runs the scripts from `<resources>/bin` and the sidecar from the copy PLAT-34
        // makes of it, so the bundle must carry each script the program list allows.
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        let config: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(manifest.join("tauri.conf.json")).expect("read the config"),
        )
        .expect("the config is JSON");
        let resources = config["bundle"]["resources"]
            .as_object()
            .expect("the bundle maps its resources");
        let source = resources
            .iter()
            .find_map(|(source, target)| (target == "bin/").then_some(source))
            .expect("the bundle ships a bin folder");
        let folder = manifest.join(source.strip_suffix("/*").unwrap_or(source));

        let scripts: Vec<&str> = ALLOWED_PROGRAMS
            .iter()
            .copied()
            .filter(|name| name.ends_with(".sh"))
            .collect();
        assert!(!scripts.is_empty(), "the program list names the scripts");
        for script in scripts {
            let metadata = std::fs::metadata(folder.join(script))
                .unwrap_or_else(|error| panic!("{script} is not in the bundled folder: {error}"));
            assert!(
                metadata.permissions().mode() & 0o111 != 0,
                "{script} is not executable"
            );
        }
    }
}
