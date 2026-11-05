//! @feature PLAT-35 Install and update gh and watchexec (D024)
//!
//! Owns: the helper programs `gh` and `watchexec`: downloading the official releases, checking
//! them, keeping them up to date, removing old versions, installing the `gh stack` extension, and
//! putting the app's bin folder on PATH. The agent programs (PLAT-28) and the launch check
//! (PLAT-34) use the same folder and the same download code and add their own functions here.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A9 (binary manager: download to a
//! partial file, hash, rename into `<program>/<version>/`, a record per install, old versions
//! pruned), A6 step 11 (the bin folder is appended to PATH for terminals, scripts and agents) and C
//! (`gh` and `watchexec` sit in the bin folder; `spotlighter.sh` runs `watchexec`), services-map.md
//! 3.8 (`gh stack`) and 3.12 (Spotlight), overview.md 5. The decision is D024 in docs/decisions.md.
//!
//! Must handle:
//! - A download that fails or is cut off (the partial file is removed and the error is reported
//!   with a retry state; nothing half-written is ever run).
//! - A checksum that does not match (the file is refused, never installed).
//! - A copy chosen by the user in settings, or a failed download: the copy on PATH is used, and
//!   `source` says so. A managed copy is never installed over a user's choice.
//! - Old versions: removed after the new one verifies, moved to the Trash like other files.
//! - The `gh stack` extension is installed with `gh`, not on the first use of "Sync stack".
//! - The bin folder comes first on PATH for terminals, run scripts and agents, so both programs
//!   resolve without any install by the user.
//! - ripgrep: Conductor ships one, but the research does not show what runs it. Find the caller in
//!   the research before adding it.
//!
//! Our design choice: one version of each helper is pinned in this file when the download code is
//! built, with its checksum per CPU. No version number is written here before that.
//!
//! Test first: with a download source that serves a file with a wrong checksum,
//! `install_helper(Gh)` fails and leaves no file in the bin folder.
//!
//! @feature PLAT-34 Check the bundled helper programs at launch
//! Owns: the launch check: copying the bundled bin folder into the app data folder, running each
//! managed program to prove it works, copying a program again when it fails, and reporting the
//! programs that still fail through a command and an event.
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2
//! (`get_binary_verification_errors`), A4 (`binary_verification_errors`) and A9 (launch
//! verification: copy the resources, run each versioned binary, re-copy on failure).
//! Must handle: a source file that cannot be copied (the command returns an error); a program
//! that cannot start, exits nonzero, or does not finish within the timeout (reported after one
//! re-copy); a dev build with no bundled bin folder (nothing to verify); a destination that
//! already holds the files (the copy replaces them).
//! Our design choice: a program is verified by running it with `--version` and requiring exit 0.
//! Our design choice: only the four managed programs are run. The helper scripts are copied but
//! not executed, because they need a caller and their arguments are not a version check.
//! Test first: a bundled `gh` that exits nonzero is copied, run again after a re-copy, and
//! reported as a verification error.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::error::{CommandError, CommandResult};
use crate::not_implemented;

/// Event that carries the programs which failed the launch check.
pub const EVENT_VERIFICATION_ERRORS: &str = "programs://verification-errors";

/// Longest time a program may take to answer `--version` before it is stopped.
pub const VERIFY_TIMEOUT_MS: u64 = 5_000;

/// The programs the app manages and checks. The names match `ManagedProgram` in @conducted/shared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ManagedProgram {
    Claude,
    Codex,
    Gh,
    Watchexec,
}

impl ManagedProgram {
    /// Every program the launch check knows.
    pub const ALL: [ManagedProgram; 4] = [
        ManagedProgram::Claude,
        ManagedProgram::Codex,
        ManagedProgram::Gh,
        ManagedProgram::Watchexec,
    ];

    /// The name the program has on disk and in the Platform.
    pub fn as_str(self) -> &'static str {
        match self {
            ManagedProgram::Claude => "claude",
            ManagedProgram::Codex => "codex",
            ManagedProgram::Gh => "gh",
            ManagedProgram::Watchexec => "watchexec",
        }
    }
}

impl fmt::Display for ManagedProgram {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// One program that the launch check could not run, with the reason in plain words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationError {
    pub program: ManagedProgram,
    pub message: String,
}

/// Copies the bundled bin folder into the app data folder and checks each managed program.
///
/// A program that fails is copied once more from the bundle and run again. Programs that still
/// fail are returned in the list, newest run first. A missing source folder means a dev build
/// with no bundled programs, so the list is empty. A copy that cannot be made is an error.
pub fn verify_bundled_programs(
    source: &Path,
    destination: &Path,
) -> CommandResult<Vec<VerificationError>> {
    copy_bin_folder(source, destination)?;
    let mut errors = Vec::new();
    for program in ManagedProgram::ALL {
        let from = source.join(program.as_str());
        if !from.is_file() {
            continue;
        }
        let to = destination.join(program.as_str());
        let first = match run_program(&to) {
            Ok(()) => continue,
            Err(first) => first,
        };
        copy_entry(&from, &to)?;
        if let Err(second) = run_program(&to) {
            errors.push(VerificationError {
                program,
                message: format!(
                    "The bundled {program} program could not be verified: {first}. After copying it again: {second}."
                ),
            });
        }
    }
    Ok(errors)
}

/// Runs the launch check and returns the programs that failed it.
pub fn verification_errors(app: &AppHandle) -> CommandResult<Vec<VerificationError>> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| CommandError::Failed {
            code: "binary_resources_dir_failed",
            message: format!("Could not find the app resources folder: {error}"),
        })?;
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| CommandError::Failed {
            code: "binary_data_dir_failed",
            message: format!("Could not find the app data folder: {error}"),
        })?;
    verify_bundled_programs(&resources.join("bin"), &data.join("bin"))
}

/// Runs the launch check and reports its result to the UI on the verification event.
pub fn emit_verification_errors(app: &AppHandle) -> CommandResult<()> {
    let errors = verification_errors(app)?;
    app.emit(EVENT_VERIFICATION_ERRORS, &errors)
        .map_err(|error| CommandError::Failed {
            code: "binary_verification_event_failed",
            message: format!("Could not report the programs that failed verification: {error}"),
        })
}

/// Lists the programs that failed the launch check.
#[tauri::command]
pub fn programs_verification_errors(app: AppHandle) -> CommandResult<Vec<VerificationError>> {
    verification_errors(&app)
}

fn copy_bin_folder(source: &Path, destination: &Path) -> CommandResult<()> {
    if !source.is_dir() {
        return Ok(());
    }
    fs::create_dir_all(destination).map_err(|error| copy_failed(source, destination, error))?;
    for entry in fs::read_dir(source).map_err(|error| copy_failed(source, destination, error))? {
        let entry = entry.map_err(|error| copy_failed(source, destination, error))?;
        copy_entry(&entry.path(), &destination.join(entry.file_name()))?;
    }
    Ok(())
}

fn copy_entry(from: &Path, to: &Path) -> CommandResult<()> {
    let metadata = fs::metadata(from).map_err(|error| copy_failed(from, to, error))?;
    if metadata.is_dir() {
        fs::create_dir_all(to).map_err(|error| copy_failed(from, to, error))?;
        for entry in fs::read_dir(from).map_err(|error| copy_failed(from, to, error))? {
            let entry = entry.map_err(|error| copy_failed(from, to, error))?;
            copy_entry(&entry.path(), &to.join(entry.file_name()))?;
        }
        return Ok(());
    }
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).map_err(|error| copy_failed(from, to, error))?;
    }
    fs::copy(from, to).map_err(|error| copy_failed(from, to, error))?;
    fs::set_permissions(to, metadata.permissions())
        .map_err(|error| copy_failed(from, to, error))?;
    Ok(())
}

fn copy_failed(from: &Path, to: &Path, error: std::io::Error) -> CommandError {
    CommandError::Failed {
        code: "binary_copy_failed",
        message: format!(
            "Could not copy {} to {}: {error}",
            from.display(),
            to.display()
        ),
    }
}

fn run_program(path: &Path) -> Result<(), String> {
    run_program_with_timeout(path, Duration::from_millis(VERIFY_TIMEOUT_MS))
}

fn run_program_with_timeout(path: &Path, timeout: Duration) -> Result<(), String> {
    let mut child = Command::new(path)
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("it could not be started: {error}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => return Err(format!("it exited with {status}")),
            Ok(None) => {
                if started.elapsed() >= timeout {
                    let stopped = child.kill();
                    let reaped = child.wait();
                    return Err(match (stopped, reaped) {
                        (Ok(()), Ok(_)) => {
                            format!("it did not finish within {} ms", timeout.as_millis())
                        }
                        (Err(kill_error), _) => format!(
                            "it did not finish within {} ms and could not be stopped: {kill_error}",
                            timeout.as_millis()
                        ),
                        (Ok(()), Err(wait_error)) => format!(
                            "it did not finish within {} ms and could not be collected: {wait_error}",
                            timeout.as_millis()
                        ),
                    });
                }
                thread::sleep(Duration::from_millis(10));
            }
            Err(error) => return Err(format!("its status could not be read: {error}")),
        }
    }
}

/// The helper programs the app installs besides the agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HelperProgram {
    Gh,
    Watchexec,
}

/// Where the program in use came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HelperSource {
    /// The copy the app downloaded.
    Managed,
    /// A copy on the user's PATH, chosen in settings or used after a failed download.
    UserPath,
}

/// A helper program that can run.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedHelper {
    pub program: HelperProgram,
    pub path: PathBuf,
    pub version: String,
    pub source: HelperSource,
}

/// The folder that holds the helper programs and the scripts (`CONDUCTED_BIN_DIR`).
pub fn helper_bin_dir(_app: &AppHandle) -> CommandResult<PathBuf> {
    not_implemented!("PLAT-35")
}

/// Downloads, checks and installs the pinned version of a helper, then removes older versions.
pub async fn install_helper(
    _app: &AppHandle,
    _program: HelperProgram,
) -> CommandResult<ResolvedHelper> {
    not_implemented!("PLAT-35")
}

/// Installs the `gh stack` extension with the given `gh`.
pub async fn install_gh_stack_extension(_gh_path: &Path) -> CommandResult<()> {
    not_implemented!("PLAT-35")
}

/// Picks the copy to run: the user's choice, else the managed copy, else the copy on PATH.
pub fn resolve_helper(
    _app: &AppHandle,
    _program: HelperProgram,
    _user_choice: Option<&Path>,
) -> CommandResult<ResolvedHelper> {
    not_implemented!("PLAT-35")
}

/// Returns `path` with the helper bin folder in front, for terminals, scripts and agents.
pub fn path_with_helpers(_bin_dir: &Path, _path: &str) -> CommandResult<String> {
    not_implemented!("PLAT-35")
}

#[cfg(test)]
mod tests {
    use super::*;
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
                "conducted-plat-34-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test folder");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn folder(&self, name: &str) -> PathBuf {
            let path = self.path.join(name);
            fs::create_dir_all(&path).expect("create test folder");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_script(folder: &Path, name: &str, body: &str) -> PathBuf {
        let path = folder.join(name);
        fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("write script");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).expect("make it executable");
        path
    }

    fn error_code(error: CommandError) -> &'static str {
        match error {
            CommandError::Failed { code, .. } => code,
            _ => "other",
        }
    }

    #[test]
    fn plat_34_copies_the_bundled_bin_folder() {
        let folder = TempDir::new();
        let source = folder.folder("source");
        let destination = folder.folder("destination");
        write_script(&source, "gh", "exit 0");
        fs::write(source.join("checkpointer.sh"), "echo checkpoint").expect("write script");

        let errors = verify_bundled_programs(&source, &destination).expect("verification");

        assert!(errors.is_empty());
        assert_eq!(
            fs::read_to_string(destination.join("checkpointer.sh")).expect("copied script"),
            "echo checkpoint"
        );
        assert!(destination.join("gh").is_file());
    }

    #[test]
    fn plat_34_runs_each_bundled_program() {
        let folder = TempDir::new();
        let source = folder.folder("source");
        let destination = folder.folder("destination");
        let runs = folder.path().join("runs");
        let log = runs.display();
        write_script(&source, "gh", &format!("echo gh >> \"{log}\""));
        write_script(
            &source,
            "watchexec",
            &format!("echo watchexec >> \"{log}\""),
        );

        let errors = verify_bundled_programs(&source, &destination).expect("verification");

        assert!(errors.is_empty());
        let mut lines: Vec<String> = fs::read_to_string(&runs)
            .expect("run log")
            .lines()
            .map(str::to_string)
            .collect();
        lines.sort();
        assert_eq!(lines, vec!["gh".to_string(), "watchexec".to_string()]);
    }

    #[test]
    fn plat_34_recopies_a_failing_program_and_runs_it_again() {
        let folder = TempDir::new();
        let source = folder.folder("source");
        let destination = folder.folder("destination");
        let counter = folder.path().join("count");
        let count = counter.display();
        write_script(
            &source,
            "gh",
            &format!(
                "count=$(cat \"{count}\" 2>/dev/null || echo 0)\ncount=$((count + 1))\necho \"$count\" > \"{count}\"\nif [ \"$count\" -lt 2 ]; then exit 1; fi\nexit 0"
            ),
        );

        let errors = verify_bundled_programs(&source, &destination).expect("verification");

        assert!(errors.is_empty());
        assert_eq!(fs::read_to_string(&counter).expect("count"), "2\n");
    }

    #[test]
    fn plat_34_reports_a_program_that_still_fails() {
        let folder = TempDir::new();
        let source = folder.folder("source");
        let destination = folder.folder("destination");
        let counter = folder.path().join("count");
        let count = counter.display();
        write_script(
            &source,
            "gh",
            &format!(
                "count=$(cat \"{count}\" 2>/dev/null || echo 0)\ncount=$((count + 1))\necho \"$count\" > \"{count}\"\nexit 3"
            ),
        );

        let errors = verify_bundled_programs(&source, &destination).expect("verification");

        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].program, ManagedProgram::Gh);
        assert!(
            errors[0].message.contains("gh"),
            "the message names the program"
        );
        assert!(
            errors[0].message.contains("exited with"),
            "the message has the reason"
        );
        assert_eq!(fs::read_to_string(&counter).expect("count"), "2\n");
    }

    #[test]
    fn plat_34_reports_a_program_that_cannot_start() {
        let folder = TempDir::new();
        let source = folder.folder("source");
        let destination = folder.folder("destination");
        let path = source.join("gh");
        fs::write(&path, "#!/bin/sh\nexit 0\n").expect("write script");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).expect("make it plain");

        let errors = verify_bundled_programs(&source, &destination).expect("verification");

        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].program, ManagedProgram::Gh);
        assert!(errors[0].message.contains("could not be started"));
    }

    #[test]
    fn plat_34_a_missing_bundle_lists_no_errors() {
        let folder = TempDir::new();
        let source = folder.path().join("no-such-bundle");
        let destination = folder.folder("destination");

        let errors = verify_bundled_programs(&source, &destination).expect("verification");

        assert!(errors.is_empty());
    }

    #[test]
    fn plat_34_stops_a_program_that_does_not_finish() {
        let folder = TempDir::new();
        let program = write_script(folder.path(), "slow", "exec sleep 5");

        let error = run_program_with_timeout(&program, Duration::from_millis(25))
            .expect_err("the program outlives the timeout");

        assert!(
            error.contains("did not finish within 25 ms"),
            "the error was {error}"
        );
    }

    #[test]
    fn plat_34_verification_error_serialises_with_the_program_name() {
        let error = VerificationError {
            program: ManagedProgram::Gh,
            message: "could not be verified".to_string(),
        };

        let value = serde_json::to_value(&error).expect("serialise the error");

        assert_eq!(value["program"], "gh");
        assert_eq!(value["message"], "could not be verified");
    }

    #[test]
    fn plat_34_the_event_name_is_the_one_the_platform_listens_for() {
        assert_eq!(EVENT_VERIFICATION_ERRORS, "programs://verification-errors");
    }

    #[test]
    fn plat_34_a_copy_that_cannot_be_made_is_an_error() {
        let folder = TempDir::new();
        let source = folder.folder("source");
        let destination = folder.path().join("not-a-folder");
        fs::write(&destination, "a file stands where the folder should be").expect("write blocker");
        write_script(&source, "gh", "exit 0");

        let error = verify_bundled_programs(&source, &destination).expect_err("the copy fails");

        assert_eq!(error_code(error), "binary_copy_failed");
    }
}
