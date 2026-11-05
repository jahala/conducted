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
//! - The capture picks flags by shell name (`-ilc` for zsh and bash, `-i -l -c` for fish), reads
//!   the environment between a delimiter, and retries once with a plain login zsh (5 s, then 3 s).
//! - Provider keys and exported shell functions are removed from the captured environment.
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
use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::error::{CommandError, CommandResult};
use crate::not_implemented;

/// Event delivered when a command started with `shell_start` ends.
pub const EVENT_DONE: &str = "shell://done";
/// Largest amount of stdout or stderr kept per run.
pub const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
/// Time between SIGTERM and SIGKILL when a run is cancelled or times out.
pub const KILL_GRACE_MS: u64 = 2_000;
/// How long the user's own login shell may take to print its environment.
pub const PRIMARY_CAPTURE_TIMEOUT_MS: u64 = 5_000;
/// How long the plain login zsh fallback may take.
pub const FALLBACK_CAPTURE_TIMEOUT_MS: u64 = 3_000;
/// The shell used when the user's shell is unknown or the first attempt fails.
pub const FALLBACK_SHELL: &str = "/bin/zsh";
/// Provider credentials removed from the captured environment. Kept in step with SIDE-10.
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
    CaptureCommand {
        program: FALLBACK_SHELL.to_string(),
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
        .spawn()
        .map_err(|error| {
            login_env_error(format!(
                "Could not start the login shell {}: {error}",
                command.program
            ))
        })?;

    let mut stdout = child.stdout.take().ok_or_else(|| {
        login_env_error("The login shell's output could not be read.".to_string())
    })?;
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        bytes
    });

    let deadline = Instant::now() + timeout;
    let finished = loop {
        match child.try_wait() {
            Ok(Some(_)) => break true,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break false;
            }
        }
    };
    let bytes = reader.join().unwrap_or_default();
    if !finished {
        return Err(login_env_error(format!(
            "{} did not finish within {} ms.",
            command.program,
            timeout.as_millis()
        )));
    }

    let output = String::from_utf8_lossy(&bytes);
    let vars = parse_env_dump(&output, marker)?;
    Ok(strip_provider_secrets(vars))
}

/// Captures with `shell_path`, falling back to the plain login zsh once when needed.
pub fn capture_with_shell(shell_path: &str, cwd: &Path) -> CommandResult<LoginEnv> {
    let known = matches!(
        Path::new(shell_path)
            .file_name()
            .and_then(|name| name.to_str()),
        Some("zsh" | "bash" | "fish")
    );

    if known {
        let marker = new_marker();
        let command = capture_command_for(shell_path, &marker);
        if let Ok(vars) = run_capture(
            &command,
            cwd,
            &marker,
            Duration::from_millis(PRIMARY_CAPTURE_TIMEOUT_MS),
        ) {
            return Ok(login_env_from(shell_path.to_string(), vars));
        }
    }

    let marker = new_marker();
    let fallback = fallback_capture_command(&marker);
    let vars = run_capture(
        &fallback,
        cwd,
        &marker,
        Duration::from_millis(FALLBACK_CAPTURE_TIMEOUT_MS),
    )?;
    Ok(login_env_from(FALLBACK_SHELL.to_string(), vars))
}

fn login_env_from(shell: String, vars: HashMap<String, String>) -> LoginEnv {
    let path = vars.get("PATH").cloned().unwrap_or_default();
    LoginEnv { shell, path, vars }
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
    // SAFETY: the capture runs once at startup and the value is only read by child processes
    // afterwards. No other thread of this app mutates the process environment.
    unsafe {
        std::env::set_var("PATH", path);
    }
}

/// Starts the one capture on a background task at launch, so the first git call does not wait.
pub fn start_background_capture(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<ShellState>();
        let _ = shell_login_env(state).await;
    });
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

/// Returns the login shell and its PATH, capturing them on the first call. Later calls reuse the
/// same answer, so the UI and the startup warm-up never run the shell twice.
#[tauri::command]
pub async fn shell_login_env(state: State<'_, ShellState>) -> CommandResult<LoginEnv> {
    let mut cached = state.login_env.lock().await;
    if let Some(login) = cached.as_ref() {
        return Ok(login.clone());
    }
    let login = tauri::async_runtime::spawn_blocking(capture_login_env)
        .await
        .map_err(|error| login_env_error(format!("The capture task failed: {error}")))??;
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

    fn error_code(error: CommandError) -> String {
        match error {
            CommandError::Failed { code, .. } => code.to_string(),
            other => other.to_string(),
        }
    }

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
    }

    #[test]
    fn plat_04_repairs_path_only_from_a_usable_capture() {
        let empty = LoginEnv {
            shell: "/bin/zsh".to_string(),
            path: String::new(),
            vars: HashMap::new(),
        };
        assert_eq!(path_to_repair(&empty), None);

        let usable = LoginEnv {
            shell: "/bin/zsh".to_string(),
            path: "/opt/homebrew/bin:/usr/bin:/bin".to_string(),
            vars: HashMap::new(),
        };
        assert_eq!(
            path_to_repair(&usable),
            Some("/opt/homebrew/bin:/usr/bin:/bin")
        );
    }

    #[test]
    fn plat_04_captures_the_login_shell_path_and_environment() {
        let cwd = std::env::temp_dir();
        let login = capture_with_shell("/bin/zsh", &cwd).expect("zsh exists on macOS");
        assert_eq!(login.shell, "/bin/zsh");
        assert!(!login.path.is_empty());
        assert_eq!(login.vars.get("PATH"), Some(&login.path));
        assert!(login.vars.len() > 1, "the capture keeps more than PATH");
    }

    #[test]
    fn plat_04_falls_back_when_the_shell_is_unknown() {
        let cwd = std::env::temp_dir();
        let login = capture_with_shell("/nonexistent/shell", &cwd).expect("the fallback runs");
        assert_eq!(login.shell, FALLBACK_SHELL);
        assert!(!login.path.is_empty());
    }
}
