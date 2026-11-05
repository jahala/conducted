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
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

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
}

fn lock_running(
    running: &Mutex<HashMap<String, RunningProcess>>,
) -> MutexGuard<'_, HashMap<String, RunningProcess>> {
    running
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Reserves an id for a running process. An id that is already present is an error.
pub fn register_running(
    running: &Mutex<HashMap<String, RunningProcess>>,
    id: String,
    pid: u32,
) -> CommandResult<()> {
    let mut table = lock_running(running);
    if table.contains_key(&id) {
        return Err(CommandError::Failed {
            code: "shell_duplicate_id",
            message: format!("A command with id \"{id}\" is already running."),
        });
    }
    table.insert(
        id,
        RunningProcess {
            pid,
            cancel_requested: false,
        },
    );
    Ok(())
}

/// Marks a run as cancelled and returns the process group to signal. `None` means no such run.
pub fn request_cancel(running: &Mutex<HashMap<String, RunningProcess>>, id: &str) -> Option<u32> {
    let mut table = lock_running(running);
    table.get_mut(id).map(|process| {
        process.cancel_requested = true;
        process.pid
    })
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
    }
    command.process_group(0);
    Ok(command)
}

fn spawn_child(
    request: &ShellCommandRequest,
    base_env: &HashMap<String, String>,
) -> CommandResult<Child> {
    let mut command = build_command(request, base_env)?;
    command.spawn().map_err(|error| CommandError::Failed {
        code: "shell_spawn_failed",
        message: format!("Could not start {}: {error}", request.program),
    })
}

/// Reads one stream, keeping at most `limit` bytes. Past the limit it tells the controller.
fn read_stream<R: Read>(
    mut reader: R,
    limit: usize,
    overflow: &mpsc::Sender<WaitEvent>,
) -> Captured {
    let mut captured = Captured::default();
    let mut buffer = [0u8; 16 * 1024];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return captured,
            Ok(read) => {
                if captured.bytes.len() + read > limit {
                    let room = limit.saturating_sub(captured.bytes.len());
                    captured.bytes.extend_from_slice(&buffer[..room]);
                    captured.overflowed = true;
                    let _ = overflow.send(WaitEvent::Overflow);
                    return captured;
                }
                captured.bytes.extend_from_slice(&buffer[..read]);
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return captured,
        }
    }
}

fn signal_group(pid: u32, signal: &str) {
    let _ = Command::new("/bin/kill")
        .arg("-s")
        .arg(signal)
        .arg(format!("-{pid}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn group_exists(pid: u32) -> bool {
    Command::new("/bin/kill")
        .arg("-0")
        .arg(format!("-{pid}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// Ends a whole process group: SIGTERM, then SIGKILL after the grace period.
pub fn terminate_group(pid: u32) {
    signal_group(pid, "TERM");
    let deadline = Instant::now() + Duration::from_millis(KILL_GRACE_MS);
    while Instant::now() < deadline {
        if !group_exists(pid) {
            return;
        }
        thread::sleep(Duration::from_millis(20));
    }
    signal_group(pid, "KILL");
}

fn wait_for_exit(receiver: &mpsc::Receiver<WaitEvent>) -> Option<ExitStatus> {
    loop {
        match receiver.recv() {
            Ok(WaitEvent::Exited(status)) => return status,
            Ok(WaitEvent::Overflow) => {}
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
    let stdout_reader = child.stdout.take().map(|pipe| {
        let sender = sender.clone();
        thread::spawn(move || read_stream(pipe, limit, &sender))
    });
    let stderr_reader = child.stderr.take().map(|pipe| {
        let sender = sender.clone();
        thread::spawn(move || read_stream(pipe, limit, &sender))
    });

    let waiter = thread::spawn(move || {
        let status = child.wait().ok();
        let _ = sender.send(WaitEvent::Exited(status));
    });

    let deadline = timeout_ms.map(|ms| Instant::now() + Duration::from_millis(ms));
    let mut timed_out = false;
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
            Err(()) => {
                terminate_group(pid);
                break None;
            }
        }
    };

    let _ = waiter.join();
    let stdout = stdout_reader
        .map(|reader| reader.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = stderr_reader
        .map(|reader| reader.join().unwrap_or_default())
        .unwrap_or_default();
    if let Some(writer) = writer {
        let _ = writer.join();
    }

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

fn run_blocking(
    request: &ShellCommandRequest,
    base_env: &HashMap<String, String>,
) -> CommandResult<Finished> {
    let child = spawn_child(request, base_env)?;
    drive_with_limit(
        child,
        request.stdin.clone(),
        request.timeout_ms,
        MAX_OUTPUT_BYTES,
    )
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

/// Returns the environment a new process starts from.
async fn captured_env(state: &State<'_, ShellState>) -> CommandResult<HashMap<String, String>> {
    let login = shell_login_env(state.clone()).await?;
    Ok(login.vars)
}

/// Checks that `program` is on the list of programs the web view may start.
pub fn check_program_allowed(_program: &str, _allowed: &[&str]) -> CommandResult<()> {
    not_implemented!("PLAT-29")
}

/// Runs a program to completion and returns its output.
#[tauri::command]
pub async fn shell_run(
    state: State<'_, ShellState>,
    command: ShellCommandRequest,
) -> CommandResult<ShellOutput> {
    let base_env = captured_env(&state).await?;
    let timeout_ms = command.timeout_ms;
    let joined = tauri::async_runtime::spawn_blocking(move || run_blocking(&command, &base_env))
        .await
        .map_err(|error| CommandError::Failed {
            code: "shell_wait_failed",
            message: format!("The command task failed: {error}"),
        })??;

    run_output(joined, timeout_ms)
}

/// Starts a program and returns at once. The result arrives as `shell://done`.
#[tauri::command]
pub async fn shell_start(
    app: AppHandle,
    state: State<'_, ShellState>,
    id: String,
    mut command: ShellCommandRequest,
) -> CommandResult<()> {
    let base_env = captured_env(&state).await?;
    let child = spawn_child(&command, &base_env)?;
    let pid = child.id();

    if let Err(error) = register_running(&state.running, id.clone(), pid) {
        let mut rejected = child;
        let _ = tauri::async_runtime::spawn_blocking(move || {
            terminate_group(pid);
            let _ = rejected.wait();
        });
        return Err(error);
    }

    let stdin = command.stdin.take();
    let timeout_ms = command.timeout_ms;
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let result = drive_with_limit(child, stdin, timeout_ms, MAX_OUTPUT_BYTES);
        let state = app.state::<ShellState>();
        let cancelled = remove_finished(&state.running, &id);
        let done = shell_done(id, result, cancelled, timeout_ms);
        if let Ok(json) = serde_json::to_string(&done) {
            let _ = app.emit_str(EVENT_DONE, json);
        }
    });
    Ok(())
}

/// Kills the process group of a command started with `shell_start`.
#[tauri::command]
pub async fn shell_cancel(state: State<'_, ShellState>, id: String) -> CommandResult<()> {
    let Some(pid) = request_cancel(&state.running, &id) else {
        return Ok(());
    };
    tauri::async_runtime::spawn_blocking(move || terminate_group(pid))
        .await
        .map_err(|error| CommandError::Failed {
            code: "shell_cancel_failed",
            message: format!("The cancellation task failed: {error}"),
        })?;
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;

    fn test_env() -> HashMap<String, String> {
        let mut env = HashMap::new();
        env.insert(
            "PATH".to_string(),
            "/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
        );
        env
    }

    fn request(program: &str, args: &[&str]) -> ShellCommandRequest {
        ShellCommandRequest {
            program: program.to_string(),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            cwd: std::env::temp_dir().to_string_lossy().into_owned(),
            env: None,
            stdin: None,
            timeout_ms: Some(10_000),
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
        let finished = run_blocking(&request("/bin/sh", &["-c", "printf 'hello'"]), &test_env())
            .expect("the command runs");
        assert_eq!(finished.output.stdout, "hello");
        assert_eq!(finished.output.exit_code, 0);
        assert!(!finished.timed_out);
        assert!(!finished.overflowed);
    }

    #[test]
    fn plat_03_a_non_zero_exit_is_still_an_ok_result() {
        let finished = run_blocking(
            &request("/bin/sh", &["-c", "printf 'oops' >&2; exit 3"]),
            &test_env(),
        )
        .expect("the command runs");
        assert_eq!(finished.output.exit_code, 3);
        assert_eq!(finished.output.stderr, "oops");
    }

    #[test]
    fn plat_03_arguments_are_not_parsed_by_a_shell() {
        let value = "a b $HOME 'quoted'";
        let finished =
            run_blocking(&request("/bin/echo", &[value]), &test_env()).expect("the command runs");
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

        let finished = run_blocking(&command, &test_env()).expect("the command runs");
        let expected_dir = dir.canonicalize().expect("the temp folder exists");
        assert_eq!(
            finished.output.stdout,
            format!("{}\nfrom stdinvalue", expected_dir.display())
        );
    }

    #[test]
    fn plat_03_a_signalled_process_reports_128_plus_the_signal() {
        let finished = run_blocking(&request("/bin/sh", &["-c", "kill -TERM $$"]), &test_env())
            .expect("the command runs");
        assert_eq!(finished.output.exit_code, 128 + 15);
    }

    #[test]
    fn plat_03_a_timeout_ends_the_process_group_with_shell_timeout() {
        let mut command = request("/bin/sh", &["-c", "sleep 30 & wait"]);
        command.timeout_ms = Some(150);
        let started = Instant::now();
        let finished = run_blocking(&command, &test_env()).expect("the command runs");
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
        let finished = run_blocking(&command, &test_env()).expect("the command runs");
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
    fn plat_03_cancelling_an_unknown_id_is_a_no_op() {
        let running = Mutex::new(HashMap::new());
        assert!(request_cancel(&running, "missing").is_none());
    }

    #[test]
    fn plat_03_cancel_ends_the_process_and_its_child() {
        let mut child = spawn_child(
            &request("/bin/sh", &["-c", "sleep 30 & echo $!; wait"]),
            &test_env(),
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
        let child = spawn_child(&command, &test_env()).expect("the command starts");
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
}
