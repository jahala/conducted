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
//! @feature PLAT-28 Agent program manager: download, verify, update, prune
//! Owns: the agent programs `claude` and `codex`: reading the pinned release feed, downloading a
//! program with a SHA-256 and progress, clearing its quarantine flag, writing its install
//! metadata, writing its shim in the app's bin folder, moving old versions to the Trash, and
//! retrying a failed download. Commands: `programs_state`, `program_install`,
//! `program_redownload`, `program_remove` and `programs_prefetch`. `setup` in lib.rs runs the same
//! prefetch at launch through `prepare_on_launch`.
//! Behaviour: native-and-sidecar-map.md A2 (`lib.rs` prepares the agent programs at startup), A6
//! and A9 (pinned versions, metadata, shims, retry state, pruning); services-map.md 5A.8.1
//! (states, Retry).
//! Must handle:
//! - A failed download. A failure a retry can fix (network, timeout, server error, wrong checksum)
//!   shows Retrying with the attempt and the time of the next one, and runs again after that
//!   wait. After the last attempt, or at once for a failure that repeats the same way (no feed, a
//!   version this app does not pin), it shows Failed with the error.
//! - A checksum that does not match: refused, never installed.
//! - A second install of a program already installing: joined, no second download.
//! - Install of a program whose pinned version is installed and still matches its metadata: Ready
//!   at once, no download. Re-download always downloads.
//! - Remove while an install runs: the install is cancelled and the remove waits until it has
//!   stopped, so nothing is written after the folder goes to the Trash and Missing is the last
//!   state.
//! - An old version that cannot be moved to the Trash: the new version stays Ready and its status
//!   carries the error.
//! - A status the window cannot receive: a command returns the error; a background install keeps
//!   it on the stored status, so `programs_state` returns it.
//! - A missing release feed: a named error, never an invented URL.
//! - The app exits: running installs are cancelled, also while they wait to retry.
//!
//! Not built yet: nothing writes the release feed. The official download URL and SHA-256 of each
//! pinned version are not in the repo, so every install fails with `program_release_missing`
//! until a producer supplies them (an open PLAT-28 item). The shim is written, but putting the bin
//! folder on PATH is PLAT-35 (`path_with_helpers`). User-chosen program paths are SET-13
//! (`programs_sync_path_overrides`). The sidecar does not look for the managed copy yet, so
//! `sidecar.rs` sets no agent binaries folder for it (open PLAT-28 items).
//! Our design choice: five attempts, one second after the first failure and doubling after each
//! further one (`RetryPolicy::APP`). The research shows the retry state, not its numbers.
//! Our design choice: the release feed is a JSON file at `agent-binaries/manifest.json` in the
//! app data folder.
//! Test first: installing a program writes its metadata, points the bin shim at it and prunes the
//! old version.
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
//! already holds the files (the copy replaces them); a destination program that is still running
//! from an earlier launch (the new copy is written to a sibling temporary file and renamed over
//! the old one, so the running program keeps its own file and the write never hits "text file
//! busy").
//! Our design choice: a program is verified by running it with `--version` and requiring exit 0.
//! Our design choice: only the four managed programs are run. The helper scripts are copied but
//! not executed, because they need a caller and their arguments are not a version check.
//! Our design choice: the check runs once at launch on a worker thread and its result lives in
//! `BinariesState`; the command reads that result instead of copying and running again. Until the
//! launch check finishes, the command answers with an empty list.
//! Our design choice: every launch copies the whole bin folder. The source markers, quarantine
//! strip and unknown-file removal in A9 are not built yet, so a launch copies the 308 MB every
//! time (PLAT-34's later items).
//! Our design choice: the research and the issue call the pair `get_binary_verification_errors`
//! and `binary_verification_errors`; our names are `programs_verification_errors` and
//! `programs://verification-errors`, as recorded in docs/plans/tauri-commands.md.
//! Test first: a bundled `gh` that exits nonzero is copied, run again after a re-copy, and
//! reported as a verification error.

use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::io::Read;
use std::os::unix::fs::symlink;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio_util::sync::CancellationToken;

use crate::error::{CommandError, CommandResult};
use crate::files;
use crate::not_implemented;
use crate::process_group;

/// Event that carries the programs which failed the launch check.
pub const EVENT_VERIFICATION_ERRORS: &str = "programs://verification-errors";

/// Longest time a program may take to answer `--version` before it is stopped.
pub const VERIFY_TIMEOUT_MS: u64 = 5_000;

/// The programs the app manages and checks. The names match `ManagedProgram` in @conducted/shared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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

    /// The agent programs the program manager downloads (D021). The helpers are PLAT-35.
    pub const AGENTS: [ManagedProgram; 2] = [ManagedProgram::Claude, ManagedProgram::Codex];

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
/// A program that fails is copied once more from the bundle and run again. A missing source
/// folder means a dev build with no bundled programs, so the list is empty. A copy that cannot be
/// made is an error.
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

/// The whole check failed before it could name a program: the app folders could not be found or
/// the copy itself failed. Kept apart from `VerificationError` because it names no program.
#[derive(Debug, Clone)]
struct StoredFailure {
    code: &'static str,
    message: String,
}

impl StoredFailure {
    fn from_error(error: &CommandError) -> Self {
        match error {
            CommandError::Failed { code, message } => Self {
                code,
                message: message.clone(),
            },
            other => Self {
                code: "binary_verification_failed",
                message: other.to_string(),
            },
        }
    }

    fn to_error(&self) -> CommandError {
        CommandError::Failed {
            code: self.code,
            message: self.message.clone(),
        }
    }
}

/// What the launch check produced. `None` in `errors` means the check has not finished yet.
#[derive(Debug, Default)]
struct VerificationOutcome {
    errors: Option<Vec<VerificationError>>,
    failure: Option<StoredFailure>,
}

/// The launch check's result, managed once by `lib.rs` and read by the command.
///
/// One thread runs the check at a time: `claim_run` returns true for the first caller only. The
/// command never starts a check, so asking it during launch cannot copy or run anything.
#[derive(Debug, Default)]
pub struct BinariesState {
    outcome: Mutex<VerificationOutcome>,
    started: AtomicBool,
}

impl BinariesState {
    fn claim_run(&self) -> bool {
        !self.started.swap(true, Ordering::AcqRel)
    }

    fn finish(&self, result: &CommandResult<Vec<VerificationError>>) {
        let mut outcome = lock_outcome(&self.outcome);
        match result {
            Ok(errors) => outcome.errors = Some(errors.clone()),
            Err(error) => outcome.failure = Some(StoredFailure::from_error(error)),
        }
    }

    fn snapshot(&self) -> CommandResult<Vec<VerificationError>> {
        let outcome = lock_outcome(&self.outcome);
        if let Some(failure) = &outcome.failure {
            return Err(failure.to_error());
        }
        Ok(outcome.errors.clone().unwrap_or_default())
    }
}

/// A lock whose owner panicked is still readable, so a later command gets the last result.
fn lock_outcome(outcome: &Mutex<VerificationOutcome>) -> MutexGuard<'_, VerificationOutcome> {
    outcome
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Starts the launch check once, on a worker thread, and reports its result on the event.
///
/// Called from `setup` in `lib.rs`. If the check has already started, this does nothing. A check
/// that fails before it can name a program is kept in the state, and the command returns the
/// error; the event carries per-program results only.
pub fn start_verification(app: AppHandle) {
    {
        let state = app.state::<BinariesState>();
        if !state.claim_run() {
            return;
        }
    }
    thread::spawn(move || {
        let result = launch_verification(&app);
        report_verification(&app, &result);
    });
}

/// Keeps the launch result for the command and, when the check ran, tells the window which
/// programs failed. A check that could not run emits nothing: the command returns its error.
fn report_verification<R: Runtime>(
    app: &AppHandle<R>,
    result: &CommandResult<Vec<VerificationError>>,
) {
    app.state::<BinariesState>().finish(result);
    if let Ok(errors) = result
        && let Err(error) = app.emit(EVENT_VERIFICATION_ERRORS, errors)
    {
        eprintln!("could not report the programs that failed verification: {error}");
    }
}

/// Runs the launch check against the app's resource and data folders.
fn launch_verification(app: &AppHandle) -> CommandResult<Vec<VerificationError>> {
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

/// Lists the programs that failed the launch check. Answers from the launch result and never
/// copies or runs a program itself. An empty list before the launch check has finished.
#[tauri::command]
pub fn programs_verification_errors(
    state: State<'_, BinariesState>,
) -> CommandResult<Vec<VerificationError>> {
    state.snapshot()
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
    copy_file(from, to, &metadata)
}

/// Copies one file through a sibling temporary file and renames it into place.
///
/// Writing straight onto a program that is running fails with "text file busy" on macOS. The
/// rename replaces the directory entry instead, so a running program keeps the file it started
/// from and the new copy appears at once.
fn copy_file(from: &Path, to: &Path, metadata: &fs::Metadata) -> CommandResult<()> {
    let temporary = temporary_copy_path(to);
    fs::copy(from, &temporary).map_err(|error| copy_failed(from, &temporary, error))?;
    fs::set_permissions(&temporary, metadata.permissions())
        .map_err(|error| copy_failed(from, &temporary, error))?;
    fs::rename(&temporary, to).map_err(|error| rename_failed(from, to, &temporary, error))
}

fn rename_failed(from: &Path, to: &Path, temporary: &Path, error: std::io::Error) -> CommandError {
    match fs::remove_file(temporary) {
        Ok(()) => copy_failed(from, to, error),
        Err(cleanup_error) => CommandError::Failed {
            code: "binary_copy_failed",
            message: format!(
                "Could not copy {} to {}: {error}. The temporary copy {} could not be removed either: {cleanup_error}",
                from.display(),
                to.display(),
                temporary.display()
            ),
        },
    }
}

/// A sibling of `to` that no other copy uses, so two copies cannot meet in the same temporary file.
fn temporary_copy_path(to: &Path) -> PathBuf {
    static COPY_COUNTER: AtomicU64 = AtomicU64::new(0);
    let counter = COPY_COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = to
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    to.with_file_name(format!(".{name}.copy-{}-{counter}", std::process::id()))
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
        .process_group(0)
        .spawn()
        .map_err(|error| format!("it could not be started: {error}"))?;
    let pid = child.id();
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(status)) => return Err(format!("it exited with {status}")),
            Ok(None) => {
                if started.elapsed() >= timeout {
                    process_group::terminate_group(
                        pid,
                        Duration::from_millis(crate::shell::KILL_GRACE_MS),
                    );
                    let reaped = child.wait();
                    let base = format!("it did not finish within {} ms", timeout.as_millis());
                    return Err(match reaped {
                        Ok(_) => base,
                        Err(wait_error) => {
                            format!("{base} and could not be collected: {wait_error}")
                        }
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

// ------------------------------------------------------------------ PLAT-28 agent programs

/// Event carrying one program's status, including download progress.
pub const EVENT_PROGRAM_STATUS: &str = "programs://status";

/// The version this app pins for each agent program. These are the versions Conductor 0.92.1 pins
/// (native-and-sidecar-map.md A9, "Pinned versions in this build"). A release feed must serve them.
pub fn pinned_version(program: ManagedProgram) -> Option<&'static str> {
    match program {
        ManagedProgram::Claude => Some("2.1.308"),
        ManagedProgram::Codex => Some("0.164.0"),
        _ => None,
    }
}

/// One state of an agent program download, as the UI shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProgramState {
    Missing,
    Queued,
    Downloading,
    Verifying,
    Retrying,
    Ready,
    Failed,
}

/// One program's install state. Mirrors `ProgramStatus` in platform.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramStatus {
    pub program: ManagedProgram,
    pub state: ProgramState,
    pub version: Option<String>,
    pub bytes_downloaded: u64,
    pub bytes_total: Option<u64>,
    pub attempt: u32,
    pub next_attempt_at: Option<u64>,
    pub error: Option<String>,
    pub path: Option<String>,
}

impl ProgramStatus {
    fn missing(program: ManagedProgram) -> Self {
        Self {
            program,
            state: ProgramState::Missing,
            version: None,
            bytes_downloaded: 0,
            bytes_total: None,
            attempt: 0,
            next_attempt_at: None,
            error: None,
            path: None,
        }
    }

    /// An installed copy found on disk.
    fn installed(program: ManagedProgram, version: &str, binary: &Path) -> Self {
        Self {
            state: ProgramState::Ready,
            version: Some(version.to_string()),
            path: Some(binary.to_string_lossy().into_owned()),
            ..Self::missing(program)
        }
    }
}

/// One downloadable file of a release, named by CPU. Nothing produces the feed yet (see the
/// PLAT-28 header); it is read from `agent-binaries/manifest.json` in the app data folder.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

/// One pinned agent program and its per-CPU files.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramRelease {
    pub version: String,
    pub darwin_arm64: ReleaseAsset,
    pub darwin_x64: ReleaseAsset,
}

/// The release feed the program manager reads: one pinned release per agent program.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub struct ReleaseManifest {
    pub claude: Option<ProgramRelease>,
    pub codex: Option<ProgramRelease>,
}

impl ReleaseManifest {
    fn release(&self, program: ManagedProgram) -> Option<&ProgramRelease> {
        match program {
            ManagedProgram::Claude => self.claude.as_ref(),
            ManagedProgram::Codex => self.codex.as_ref(),
            _ => None,
        }
    }
}

fn asset_for(release: &ProgramRelease) -> &ReleaseAsset {
    if cfg!(target_arch = "aarch64") {
        &release.darwin_arm64
    } else {
        &release.darwin_x64
    }
}

/// The folder layout the manager owns: `agent-binaries/<program>/<version>/` and the PATH shims.
#[derive(Debug, Clone, Default)]
pub struct ProgramDirs {
    pub binaries: PathBuf,
    pub bin: PathBuf,
}

impl ProgramDirs {
    pub fn in_app_data(data: &Path) -> Self {
        Self {
            binaries: data.join("agent-binaries"),
            bin: data.join("bin"),
        }
    }

    fn manifest(&self) -> PathBuf {
        self.binaries.join("manifest.json")
    }

    fn program(&self, program: ManagedProgram) -> PathBuf {
        self.binaries.join(program.as_str())
    }

    fn binary(&self, program: ManagedProgram, version: &str) -> PathBuf {
        self.program(program).join(version).join(program.as_str())
    }

    fn metadata(&self, program: ManagedProgram, version: &str) -> PathBuf {
        self.binaries
            .join(".meta")
            .join(format!("{}-{version}.json", program.as_str()))
    }

    fn shim(&self, program: ManagedProgram) -> PathBuf {
        self.bin.join(program.as_str())
    }
}

/// How often a failed download is tried, and how long the manager waits between tries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    /// Attempts in all, the first one included.
    pub attempts: u32,
    /// The wait after the first failure. It doubles after each further failure.
    pub first_delay_ms: u64,
}

impl RetryPolicy {
    /// Our design choice: five attempts, one second after the first failure and doubling after
    /// that. The research shows the retry state (A9), not its numbers.
    pub const APP: RetryPolicy = RetryPolicy {
        attempts: 5,
        first_delay_ms: 1_000,
    };

    /// The wait before the next attempt, after `failures` failed ones.
    fn delay_ms(self, failures: u32) -> u64 {
        self.first_delay_ms
            .saturating_mul(1u64 << failures.saturating_sub(1).min(5))
    }
}

/// True when trying again can help: the network, the server or a corrupt download. A missing feed,
/// a version the app does not pin or a refused URL fails the same way every time.
fn retry_can_fix(error: &CommandError) -> bool {
    match error {
        CommandError::Failed { code, .. } => matches!(
            *code,
            "http_timeout" | "http_request_failed" | "http_status" | "http_checksum_mismatch"
        ),
        _ => false,
    }
}

/// Install a program, or use the copy already installed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallMode {
    /// Use the installed pinned version when its metadata still matches; download only without one.
    Install,
    /// Download the pinned version again, replacing the installed copy.
    Redownload,
}

/// Where the manager reports a status. The app sends it to the window on `EVENT_PROGRAM_STATUS`.
pub trait StatusSink: Send + Sync + 'static {
    fn send(&self, status: &ProgramStatus) -> CommandResult<()>;
}

impl<R: Runtime> StatusSink for AppHandle<R> {
    fn send(&self, status: &ProgramStatus) -> CommandResult<()> {
        self.emit(EVENT_PROGRAM_STATUS, status)
            .map_err(|error| CommandError::Failed {
                code: "program_status_not_sent",
                message: format!(
                    "Could not tell the window about {}: {error}",
                    status.program
                ),
            })
    }
}

/// Moves a path to the Trash. The app passes `files::trash_path`.
pub type Trash = Arc<dyn Fn(&Path) -> CommandResult<()> + Send + Sync>;

/// What an install needs from outside: the folders, the download's hosts and stall timeout, the
/// retry policy and the Trash. The app builds it from its data folder; a test passes its own.
#[derive(Clone)]
pub struct InstallContext {
    pub dirs: ProgramDirs,
    pub allowed_hosts: &'static [&'static str],
    pub stall_timeout: Duration,
    pub retry: RetryPolicy,
    pub trash: Trash,
}

impl InstallContext {
    fn for_app<R: Runtime>(app: &AppHandle<R>) -> CommandResult<Self> {
        let data = app
            .path()
            .app_data_dir()
            .map_err(|error| CommandError::Failed {
                code: "program_data_dir_failed",
                message: format!("Could not find the app data folder: {error}"),
            })?;
        Ok(Self {
            dirs: ProgramDirs::in_app_data(&data),
            allowed_hosts: crate::http::ALLOWED_HOSTS,
            stall_timeout: Duration::from_millis(crate::http::DOWNLOAD_STALL_TIMEOUT_MS),
            retry: RetryPolicy::APP,
            trash: Arc::new(files::trash_path),
        })
    }
}

/// One running install: its id, so only its own task clears it, and the token that stops it.
struct Run {
    id: u64,
    cancel: CancellationToken,
}

#[derive(Default)]
struct ProgramsInner {
    statuses: Mutex<HashMap<ManagedProgram, ProgramStatus>>,
    runs: Mutex<HashMap<ManagedProgram, Run>>,
    next_run: AtomicU64,
    /// One lock per program. An install holds it for its whole run and a remove holds it while it
    /// removes, so the two never write the program's files or status at the same time.
    slots: Mutex<HashMap<ManagedProgram, Arc<tokio::sync::Mutex<()>>>>,
}

/// The program manager's state, shared by the commands and the background installs.
#[derive(Clone, Default)]
pub struct ProgramsState {
    inner: Arc<ProgramsInner>,
}

impl ProgramsState {
    /// Every managed agent's status, Claude first. A program with no record is missing.
    pub fn snapshot(&self) -> Vec<ProgramStatus> {
        ManagedProgram::AGENTS
            .iter()
            .map(|program| self.status(*program))
            .collect()
    }

    /// One program's status. A program with no record is missing.
    pub fn status(&self, program: ManagedProgram) -> ProgramStatus {
        self.inner
            .statuses
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&program)
            .cloned()
            .unwrap_or_else(|| ProgramStatus::missing(program))
    }

    /// Stores a status and sends it. The store is updated first, so the command can read back
    /// every state the window was told about. A send that fails is returned to the caller.
    fn publish(&self, sink: &dyn StatusSink, status: ProgramStatus) -> CommandResult<()> {
        self.inner
            .statuses
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(status.program, status.clone());
        sink.send(&status)
    }

    /// Adds an error a background install could not send to the program's stored status, after
    /// the error the status already carries, so the next `programs_state` returns both.
    fn keep_error(&self, program: ManagedProgram, error: &CommandError) {
        let mut statuses = self
            .inner
            .statuses
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let status = statuses
            .entry(program)
            .or_insert_with(|| ProgramStatus::missing(program));
        status.error = Some(match status.error.take() {
            Some(earlier) => format!("{earlier} {error}"),
            None => error.to_string(),
        });
    }

    /// Claims the program for a new install. None when an install of it is already running, so
    /// the caller joins that one. A cancelled run no longer counts.
    fn begin(&self, program: ManagedProgram) -> Option<(u64, CancellationToken)> {
        let mut runs = self
            .inner
            .runs
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if runs
            .get(&program)
            .is_some_and(|run| !run.cancel.is_cancelled())
        {
            return None;
        }
        let id = self.inner.next_run.fetch_add(1, Ordering::Relaxed);
        let cancel = CancellationToken::new();
        runs.insert(
            program,
            Run {
                id,
                cancel: cancel.clone(),
            },
        );
        Some((id, cancel))
    }

    /// Ends the run `id`. A newer run of the same program is left alone.
    fn finish(&self, program: ManagedProgram, id: u64) {
        let mut runs = self
            .inner
            .runs
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if runs.get(&program).is_some_and(|run| run.id == id) {
            runs.remove(&program);
        }
    }

    fn is_installing(&self, program: ManagedProgram) -> bool {
        self.inner
            .runs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&program)
            .is_some_and(|run| !run.cancel.is_cancelled())
    }

    fn cancel(&self, program: ManagedProgram) {
        if let Some(run) = self
            .inner
            .runs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&program)
        {
            run.cancel.cancel();
        }
    }

    /// Stops every running install, including one waiting out its retry delay. `lib.rs` calls it
    /// when the app exits.
    pub fn cancel_all(&self) {
        for run in self
            .inner
            .runs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
        {
            run.cancel.cancel();
        }
    }

    fn slot(&self, program: ManagedProgram) -> Arc<tokio::sync::Mutex<()>> {
        self.inner
            .slots
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(program)
            .or_default()
            .clone()
    }
}

/// Reads the release feed. A missing feed is a named error: the app never invents a download.
pub fn read_release_manifest(path: &Path) -> CommandResult<ReleaseManifest> {
    let text = fs::read_to_string(path).map_err(|error| CommandError::Failed {
        code: "program_release_missing",
        message: format!(
            "The agent program release feed {} could not be read: {error}",
            path.display()
        ),
    })?;
    serde_json::from_str(&text).map_err(|error| CommandError::Failed {
        code: "program_release_invalid",
        message: format!("The agent program release feed could not be understood: {error}"),
    })
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

/// The status after a failed attempt. While attempts remain and a retry can fix the error, it is
/// Retrying with the time of the next attempt; otherwise it is Failed.
fn failed_status(
    previous: &ProgramStatus,
    error: &CommandError,
    retry: RetryPolicy,
    now: u64,
) -> ProgramStatus {
    let attempt = previous.attempt.saturating_add(1);
    let retrying = attempt < retry.attempts && retry_can_fix(error);
    ProgramStatus {
        state: if retrying {
            ProgramState::Retrying
        } else {
            ProgramState::Failed
        },
        attempt,
        next_attempt_at: retrying.then(|| now.saturating_add(retry.delay_ms(attempt))),
        error: Some(error.to_string()),
        ..previous.clone()
    }
}

fn sha256_of_file(path: &Path) -> CommandResult<String> {
    let mut file = fs::File::open(path).map_err(|error| CommandError::Failed {
        code: "program_read_failed",
        message: format!("Could not read {}: {error}", path.display()),
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| CommandError::Failed {
                code: "program_read_failed",
                message: format!("Could not read {}: {error}", path.display()),
            })?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn modified_ms(path: &Path) -> CommandResult<u64> {
    let modified = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map_err(|error| CommandError::Failed {
            code: "program_metadata_failed",
            message: format!("Could not read when {} changed: {error}", path.display()),
        })?;
    modified
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .map_err(|error| CommandError::Failed {
            code: "program_metadata_failed",
            message: format!(
                "The time of {} is before the epoch: {error}",
                path.display()
            ),
        })
}

/// Removes the quarantine flag macOS puts on downloaded files, so the program can run.
fn strip_quarantine(path: &Path) -> CommandResult<()> {
    let output = Command::new("xattr")
        .arg("-d")
        .arg("com.apple.quarantine")
        .arg(path)
        .output()
        .map_err(|error| CommandError::Failed {
            code: "program_quarantine_failed",
            message: format!(
                "Could not clear the quarantine flag from {}: {error}",
                path.display()
            ),
        })?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    // A file without the flag answers "No such xattr"; there is nothing to clear.
    if stderr.contains("No such xattr") {
        return Ok(());
    }
    Err(CommandError::Failed {
        code: "program_quarantine_failed",
        message: format!(
            "Could not clear the quarantine flag from {}: {}",
            path.display(),
            stderr.trim()
        ),
    })
}

/// Runs `remove` on `path` when something is there, a dangling link included. Nothing there is
/// fine. A path that cannot be read fails with `code`.
fn remove_if_present(
    path: &Path,
    code: &'static str,
    remove: impl FnOnce(&Path) -> CommandResult<()>,
) -> CommandResult<()> {
    match fs::symlink_metadata(path) {
        Ok(_) => remove(path),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::Failed {
            code,
            message: format!("Could not read {}: {error}", path.display()),
        }),
    }
}

fn remove_link(link: &Path, code: &'static str) -> CommandResult<()> {
    fs::remove_file(link).map_err(|error| CommandError::Failed {
        code,
        message: format!("Could not remove {}: {error}", link.display()),
    })
}

fn install_bin_shim(bin_dir: &Path, program: ManagedProgram, binary: &Path) -> CommandResult<()> {
    fs::create_dir_all(bin_dir).map_err(|error| CommandError::Failed {
        code: "program_bin_dir_failed",
        message: format!("Could not make {}: {error}", bin_dir.display()),
    })?;
    let link = bin_dir.join(program.as_str());
    remove_if_present(&link, "program_bin_shim_failed", |link| {
        remove_link(link, "program_bin_shim_failed")
    })?;
    symlink(binary, &link).map_err(|error| CommandError::Failed {
        code: "program_bin_shim_failed",
        message: format!(
            "Could not point {} at {}: {error}",
            link.display(),
            binary.display()
        ),
    })
}

/// Removes every version of a program except the one in use, through the given Trash.
fn prune_versions(
    program_dir: &Path,
    keep: &str,
    trash: &dyn Fn(&Path) -> CommandResult<()>,
) -> CommandResult<()> {
    let entries = match fs::read_dir(program_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(CommandError::Failed {
                code: "program_prune_failed",
                message: format!("Could not list {}: {error}", program_dir.display()),
            });
        }
    };
    for entry in entries {
        let entry = entry.map_err(|error| CommandError::Failed {
            code: "program_prune_failed",
            message: format!(
                "Could not read an entry of {}: {error}",
                program_dir.display()
            ),
        })?;
        let is_dir = entry.file_type().map_err(|error| CommandError::Failed {
            code: "program_prune_failed",
            message: format!(
                "Could not read an entry of {}: {error}",
                program_dir.display()
            ),
        })?;
        if is_dir.is_dir() && entry.file_name().to_string_lossy() != keep {
            trash(&entry.path())?;
        }
    }
    Ok(())
}

/// True when an installed program still has the size and modified time its metadata recorded.
/// A file that changed since it was installed is not trusted.
fn metadata_matches(binary: &Path, metadata_path: &Path) -> bool {
    let Ok(text) = fs::read_to_string(metadata_path) else {
        return false;
    };
    let Ok(metadata) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    let Some(size) = metadata["size"].as_u64() else {
        return false;
    };
    let Some(verified_mtime) = metadata["verifiedMtimeUnixMs"].as_u64() else {
        return false;
    };
    let Ok(actual_size) = fs::metadata(binary).map(|actual| actual.len()) else {
        return false;
    };
    let Ok(actual_mtime) = modified_ms(binary) else {
        return false;
    };
    actual_size == size && actual_mtime == verified_mtime
}

/// The installed copy of the pinned version, when its metadata still matches the file on disk.
fn installed_copy(dirs: &ProgramDirs, program: ManagedProgram) -> Option<(&'static str, PathBuf)> {
    let version = pinned_version(program)?;
    let binary = dirs.binary(program, version);
    metadata_matches(&binary, &dirs.metadata(program, version)).then_some((version, binary))
}

/// Marks an installed pinned program ready, so a restart shows the copy on disk. A program that
/// already has a state, or is installing, is left alone.
fn hydrate_from_disk(
    dirs: &ProgramDirs,
    state: &ProgramsState,
    sink: &dyn StatusSink,
) -> CommandResult<()> {
    for program in ManagedProgram::AGENTS {
        if state.status(program).state != ProgramState::Missing || state.is_installing(program) {
            continue;
        }
        if let Some((version, binary)) = installed_copy(dirs, program) {
            state.publish(sink, ProgramStatus::installed(program, version, &binary))?;
        }
    }
    Ok(())
}

/// What `finish_install` did besides installing. The new version is in place and usable either
/// way; an old version it could not move to the Trash is reported here, not as a failed install.
#[derive(Debug)]
pub struct Installed {
    pub prune_error: Option<CommandError>,
}

/// Makes a downloaded file the program's current version: checks it against the feed's SHA-256,
/// clears quarantine, records its metadata, points the PATH shim at it and removes older versions.
pub fn finish_install(
    program: ManagedProgram,
    version: &str,
    binary: &Path,
    sha256: &str,
    dirs: &ProgramDirs,
    trash: &dyn Fn(&Path) -> CommandResult<()>,
) -> CommandResult<Installed> {
    use std::os::unix::fs::PermissionsExt;

    let actual = sha256_of_file(binary)?;
    if actual != sha256 {
        return Err(CommandError::Failed {
            code: "program_checksum_mismatch",
            message: format!("The downloaded program has the SHA-256 {actual}, not {sha256}."),
        });
    }
    strip_quarantine(binary)?;
    fs::set_permissions(binary, fs::Permissions::from_mode(0o755)).map_err(|error| {
        CommandError::Failed {
            code: "program_install_failed",
            message: format!("Could not make {} runnable: {error}", binary.display()),
        }
    })?;
    let metadata_path = dirs.metadata(program, version);
    if let Some(metadata_dir) = metadata_path.parent() {
        fs::create_dir_all(metadata_dir).map_err(|error| CommandError::Failed {
            code: "program_metadata_failed",
            message: format!("Could not make {}: {error}", metadata_dir.display()),
        })?;
    }
    let size = fs::metadata(binary)
        .map(|metadata| metadata.len())
        .map_err(|error| CommandError::Failed {
            code: "program_metadata_failed",
            message: format!("Could not read {}: {error}", binary.display()),
        })?;
    let metadata = serde_json::json!({
        "sha256": sha256,
        "size": size,
        "downloadedAtUnixMs": now_ms(),
        "verifiedMtimeUnixMs": modified_ms(binary)?,
    });
    fs::write(&metadata_path, metadata.to_string()).map_err(|error| CommandError::Failed {
        code: "program_metadata_failed",
        message: format!("Could not write {}: {error}", metadata_path.display()),
    })?;
    install_bin_shim(&dirs.bin, program, binary)?;
    Ok(Installed {
        prune_error: prune_versions(&dirs.program(program), version, trash).err(),
    })
}

/// One attempt: reads the feed, downloads the pinned version with progress and installs it.
/// Returns the Ready status. `status` carries the attempt count into each status it sends.
async fn download_and_finish(
    ctx: &InstallContext,
    state: &ProgramsState,
    sink: &dyn StatusSink,
    program: ManagedProgram,
    status: &ProgramStatus,
    cancel: &CancellationToken,
) -> CommandResult<ProgramStatus> {
    let manifest = read_release_manifest(&ctx.dirs.manifest())?;
    let release = manifest
        .release(program)
        .ok_or_else(|| CommandError::Failed {
            code: "program_release_missing",
            message: format!("The release feed has no {program} program."),
        })?;
    let pinned = pinned_version(program).ok_or_else(|| CommandError::Failed {
        code: "program_not_managed",
        message: format!("{program} is not an agent program this app manages."),
    })?;
    if release.version != pinned {
        return Err(CommandError::Failed {
            code: "program_version_not_pinned",
            message: format!(
                "The release feed offers {program} {}, but this app pins {pinned}.",
                release.version
            ),
        });
    }
    let asset = asset_for(release);
    let target = ctx.dirs.binary(program, pinned);
    if let Some(target_dir) = target.parent() {
        fs::create_dir_all(target_dir).map_err(|error| CommandError::Failed {
            code: "program_install_failed",
            message: format!("Could not make {}: {error}", target_dir.display()),
        })?;
    }

    let mut downloading = ProgramStatus {
        state: ProgramState::Downloading,
        version: Some(pinned.to_string()),
        bytes_downloaded: 0,
        bytes_total: Some(asset.size),
        next_attempt_at: None,
        error: None,
        ..status.clone()
    };
    state.publish(sink, downloading.clone())?;
    let outcome = crate::http::download_request(
        ctx.allowed_hosts,
        &asset.url,
        &target,
        Some(asset.sha256.as_str()),
        ctx.stall_timeout,
        cancel.clone(),
        |received, total| {
            downloading.bytes_downloaded = received;
            downloading.bytes_total = total.or(Some(asset.size));
            state.publish(sink, downloading.clone())
        },
    )
    .await?;

    let verifying = ProgramStatus {
        state: ProgramState::Verifying,
        bytes_downloaded: outcome.size_bytes,
        ..downloading
    };
    state.publish(sink, verifying)?;

    let dirs = ctx.dirs.clone();
    let trash = Arc::clone(&ctx.trash);
    let expected = asset.sha256.clone();
    let binary = target.clone();
    // Hashing a program of a few hundred MB blocks, so it runs off the async workers.
    let installed = crate::error::blocking("program_install_failed", move || {
        finish_install(program, pinned, &binary, &expected, &dirs, &*trash)
    })
    .await?;

    Ok(ProgramStatus {
        program,
        state: ProgramState::Ready,
        version: Some(pinned.to_string()),
        bytes_downloaded: outcome.size_bytes,
        bytes_total: Some(outcome.size_bytes),
        attempt: 0,
        next_attempt_at: None,
        error: installed.prune_error.map(|error| error.to_string()),
        path: Some(target.to_string_lossy().into_owned()),
    })
}

/// Installs one program and ends Ready or Failed. A failure a retry can fix is tried again after
/// the policy's wait, with Retrying shown meanwhile. A cancelled run stops without a final status:
/// whoever cancelled it reports the program's state. Returns an error only for a status it could
/// not send.
pub async fn run_install(
    ctx: &InstallContext,
    state: &ProgramsState,
    sink: &dyn StatusSink,
    program: ManagedProgram,
    mode: InstallMode,
    cancel: &CancellationToken,
) -> CommandResult<()> {
    if mode == InstallMode::Install
        && let Some((version, binary)) = installed_copy(&ctx.dirs, program)
    {
        return state.publish(sink, ProgramStatus::installed(program, version, &binary));
    }
    let mut status = ProgramStatus {
        attempt: 0,
        next_attempt_at: None,
        error: None,
        ..state.status(program)
    };
    loop {
        let failure = match download_and_finish(ctx, state, sink, program, &status, cancel).await {
            Ok(ready) => return state.publish(sink, ready),
            Err(_) if cancel.is_cancelled() => return Ok(()),
            Err(error) => error,
        };
        status = failed_status(&status, &failure, ctx.retry, now_ms());
        state.publish(sink, status.clone())?;
        let Some(next_attempt_at) = status.next_attempt_at else {
            return Ok(());
        };
        let wait = Duration::from_millis(next_attempt_at.saturating_sub(now_ms()));
        tokio::select! {
            _ = cancel.cancelled() => return Ok(()),
            _ = tokio::time::sleep(wait) => {}
        }
    }
}

/// Starts an install in the background and shows the program Queued, or joins the install that
/// is already running. Returns the new run's task, or None when it joined.
fn start_install(
    ctx: InstallContext,
    state: &ProgramsState,
    sink: Arc<dyn StatusSink>,
    program: ManagedProgram,
    mode: InstallMode,
) -> CommandResult<Option<tauri::async_runtime::JoinHandle<()>>> {
    let Some((id, cancel)) = state.begin(program) else {
        return Ok(None);
    };
    let queued = ProgramStatus {
        state: ProgramState::Queued,
        attempt: 0,
        next_attempt_at: None,
        error: None,
        ..state.status(program)
    };
    if let Err(error) = state.publish(sink.as_ref(), queued) {
        state.finish(program, id);
        return Err(error);
    }
    let manager = state.clone();
    Ok(Some(tauri::async_runtime::spawn(async move {
        let slot = manager.slot(program);
        let held = slot.lock().await;
        if !cancel.is_cancelled()
            && let Err(error) =
                run_install(&ctx, &manager, sink.as_ref(), program, mode, &cancel).await
        {
            manager.keep_error(program, &error);
        }
        // The run ends before the lock is released, so an install that starts next is a new run.
        manager.finish(program, id);
        drop(held);
    })))
}

/// Moves a program's versions to the Trash, removes its PATH shim and reports it Missing. A
/// running install is cancelled first, and the remove waits until that run has stopped, so the
/// install never writes into the trashed folder or reports a state after Missing.
pub async fn remove_program(
    ctx: &InstallContext,
    state: &ProgramsState,
    sink: &dyn StatusSink,
    program: ManagedProgram,
) -> CommandResult<()> {
    state.cancel(program);
    let slot = state.slot(program);
    let _held = slot.lock().await;
    remove_if_present(
        &ctx.dirs.program(program),
        "program_remove_failed",
        |folder| (ctx.trash)(folder),
    )?;
    remove_if_present(&ctx.dirs.shim(program), "program_remove_failed", |link| {
        remove_link(link, "program_remove_failed")
    })?;
    state.publish(sink, ProgramStatus::missing(program))
}

/// Shows the installed copies, then starts an install of every agent program that is not ready.
/// Returns the tasks it started.
fn prefetch(
    ctx: &InstallContext,
    state: &ProgramsState,
    sink: Arc<dyn StatusSink>,
) -> CommandResult<Vec<tauri::async_runtime::JoinHandle<()>>> {
    hydrate_from_disk(&ctx.dirs, state, sink.as_ref())?;
    let mut started = Vec::new();
    for program in ManagedProgram::AGENTS {
        if state.status(program).state == ProgramState::Ready {
            continue;
        }
        if let Some(task) = start_install(
            ctx.clone(),
            state,
            Arc::clone(&sink),
            program,
            InstallMode::Install,
        )? {
            started.push(task);
        }
    }
    Ok(started)
}

/// Prepares the agent programs at launch (A2: `lib.rs` prepares the agent binaries at startup).
/// Called from `setup` in `lib.rs`; the installs run in the background. It never stops the app
/// from starting: a failure is kept on each agent's status, where the Agents page reads it.
pub fn prepare_on_launch<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<ProgramsState>();
    let prepared = InstallContext::for_app(app)
        .and_then(|ctx| prefetch(&ctx, state.inner(), Arc::new(app.clone())).map(|_| ()));
    keep_launch_error(prepared, state.inner());
}

/// Keeps a failed launch preparation on every agent's status, so the window can read why.
fn keep_launch_error(prepared: CommandResult<()>, state: &ProgramsState) {
    if let Err(error) = prepared {
        for program in ManagedProgram::AGENTS {
            state.keep_error(program, &error);
        }
    }
}

fn require_agent(program: ManagedProgram) -> CommandResult<()> {
    if ManagedProgram::AGENTS.contains(&program) {
        return Ok(());
    }
    Err(CommandError::Failed {
        code: "program_not_managed",
        message: format!("{program} is not an agent program this app manages."),
    })
}

/// Returns the install state of Claude Code and Codex, including a copy already on disk.
#[tauri::command]
pub fn programs_state(
    app: AppHandle,
    state: State<'_, ProgramsState>,
) -> CommandResult<Vec<ProgramStatus>> {
    let ctx = InstallContext::for_app(&app)?;
    hydrate_from_disk(&ctx.dirs, state.inner(), &app)?;
    Ok(state.snapshot())
}

/// Installs an agent program, or shows the matching copy already installed. A program already
/// installing joins that install.
#[tauri::command]
pub fn program_install(
    app: AppHandle,
    state: State<'_, ProgramsState>,
    program: ManagedProgram,
) -> CommandResult<()> {
    require_agent(program)?;
    let ctx = InstallContext::for_app(&app)?;
    start_install(
        ctx,
        state.inner(),
        Arc::new(app),
        program,
        InstallMode::Install,
    )?;
    Ok(())
}

/// Downloads the current version again, replacing the installed copy.
#[tauri::command]
pub fn program_redownload(
    app: AppHandle,
    state: State<'_, ProgramsState>,
    program: ManagedProgram,
) -> CommandResult<()> {
    require_agent(program)?;
    let ctx = InstallContext::for_app(&app)?;
    start_install(
        ctx,
        state.inner(),
        Arc::new(app),
        program,
        InstallMode::Redownload,
    )?;
    Ok(())
}

/// Moves an installed agent program to the Trash and reports it missing. Cancels and waits for a
/// running install of it first.
#[tauri::command]
pub async fn program_remove(
    app: AppHandle,
    state: State<'_, ProgramsState>,
    program: ManagedProgram,
) -> CommandResult<()> {
    require_agent(program)?;
    let ctx = InstallContext::for_app(&app)?;
    remove_program(&ctx, state.inner(), &app, program).await
}

/// Downloads, in the background, the agent programs that are not ready. Until an update feed
/// carries the next versions (PLAT-28's update manifest item), these are the versions this app
/// pins.
#[tauri::command]
pub fn programs_prefetch(app: AppHandle, state: State<'_, ProgramsState>) -> CommandResult<()> {
    let ctx = InstallContext::for_app(&app)?;
    prefetch(&ctx, state.inner(), Arc::new(app.clone()))?;
    Ok(())
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
    fn plat_34_replaces_a_stale_copy_in_the_destination() {
        let folder = TempDir::new();
        let source = folder.folder("source");
        let destination = folder.folder("destination");
        write_script(&source, "gh", "exit 0");
        let stale = destination.join("gh");
        fs::write(&stale, "#!/bin/sh\nexit 7\n").expect("seed a stale copy");
        fs::set_permissions(&stale, fs::Permissions::from_mode(0o755)).expect("make it executable");

        let errors = verify_bundled_programs(&source, &destination).expect("verification");

        assert!(
            errors.is_empty(),
            "the replaced copy answers the version check"
        );
        assert_eq!(
            fs::read_to_string(destination.join("gh")).expect("replaced program"),
            "#!/bin/sh\nexit 0\n"
        );
        let leftovers: Vec<String> = fs::read_dir(&destination)
            .expect("list the destination")
            .map(|entry| {
                entry
                    .expect("read an entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .filter(|name| name.contains(".copy-"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "no temporary copy is left: {leftovers:?}"
        );
    }

    #[test]
    fn plat_34_replaces_a_copy_that_is_still_running() {
        let folder = TempDir::new();
        let source = folder.folder("source");
        let destination = folder.folder("destination");
        write_script(&source, "gh", "exit 0");
        // A copy of a real program, because macOS refuses writes to a running Mach-O binary.
        let old = destination.join("gh");
        fs::copy("/bin/sleep", &old).expect("place a real program in the destination");
        let mut running = Command::new(&old)
            .arg("2")
            .spawn()
            .expect("start the old copy");

        let errors = verify_bundled_programs(&source, &destination).expect("verification");

        assert!(errors.is_empty(), "the new copy answers the version check");
        assert_eq!(
            fs::read_to_string(destination.join("gh")).expect("replaced program"),
            "#!/bin/sh\nexit 0\n"
        );
        assert!(
            running
                .try_wait()
                .expect("read the old copy's state")
                .is_none(),
            "renaming the new copy must leave the running one alone"
        );
        running.kill().expect("stop the old copy");
        running.wait().expect("collect the old copy");
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
    fn plat_34_stops_the_children_a_program_started() {
        let folder = TempDir::new();
        let started = folder.path().join("child-started");
        let ran = folder.path().join("child-ran");
        let program = write_script(
            folder.path(),
            "spawner",
            &format!(
                "( sleep 0.5; echo ran > \"{}\" ) &\necho started > \"{}\"\nwait",
                ran.display(),
                started.display()
            ),
        );

        let error = run_program_with_timeout(&program, Duration::from_millis(200))
            .expect_err("the program outlives the timeout");

        assert!(
            error.contains("did not finish within 200 ms"),
            "the error was {error}"
        );
        assert!(
            started.is_file(),
            "the child must have started before the timeout"
        );
        thread::sleep(Duration::from_millis(700));
        assert!(
            !ran.exists(),
            "the whole process group must be stopped, not only the parent"
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
    fn plat_34_the_command_reads_the_launch_result() {
        let state = BinariesState::default();
        let error = VerificationError {
            program: ManagedProgram::Gh,
            message: "the bundled gh exited with 3".to_string(),
        };
        state.finish(&Ok(vec![error.clone()]));

        assert_eq!(state.snapshot().expect("the launch result"), vec![error]);
    }

    #[test]
    fn plat_34_the_command_reports_a_failed_launch_check() {
        let state = BinariesState::default();
        state.finish(&Err(CommandError::Failed {
            code: "binary_copy_failed",
            message: "Could not copy the bundled programs.".to_string(),
        }));

        let error = state
            .snapshot()
            .expect_err("the launch failure is handed on");

        assert_eq!(error_code(error), "binary_copy_failed");
    }

    #[test]
    fn plat_34_starts_the_launch_check_once() {
        let state = BinariesState::default();

        assert!(state.claim_run(), "the first caller starts the check");
        assert!(!state.claim_run(), "a later caller does not start it again");
    }

    #[test]
    fn plat_34_the_event_name_is_the_one_the_platform_listens_for() {
        let adapter = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/platform/tauri.ts");
        let source = fs::read_to_string(&adapter).expect("read the Tauri adapter");
        // The adapter names this key twice: once in COMMANDS (the command) and once in EVENTS (the
        // event this test is about), so the search starts at the EVENTS map.
        let events = source
            .split_once("export const EVENTS = {")
            .map(|(_, rest)| rest)
            .expect("the adapter declares its EVENTS map");
        let listened = events
            .lines()
            .find_map(|line| {
                line.trim()
                    .strip_prefix("programsVerificationErrors:")
                    .map(|rest| {
                        rest.trim()
                            .trim_end_matches(',')
                            .trim_matches('"')
                            .to_string()
                    })
            })
            .expect("the adapter's EVENTS names programsVerificationErrors");
        assert_eq!(listened, EVENT_VERIFICATION_ERRORS);
        assert_eq!(EVENT_VERIFICATION_ERRORS, "programs://verification-errors");
    }

    /// A mock app with the launch state managed, and a channel that receives every payload sent on
    /// the verification event.
    fn app_listening_for_the_event() -> (
        tauri::App<tauri::test::MockRuntime>,
        std::sync::mpsc::Receiver<String>,
    ) {
        use tauri::Listener;
        let app = tauri::test::mock_app();
        app.manage(BinariesState::default());
        let (sender, events) = std::sync::mpsc::channel::<String>();
        app.handle()
            .listen(EVENT_VERIFICATION_ERRORS, move |event| {
                let _ = sender.send(event.payload().to_string());
            });
        (app, events)
    }

    #[test]
    fn plat_34_a_finished_check_emits_the_failed_programs_on_that_event() {
        let (app, events) = app_listening_for_the_event();
        let failure = VerificationError {
            program: ManagedProgram::Gh,
            message: "the bundled gh exited with 3".to_string(),
        };

        report_verification(app.handle(), &Ok(vec![failure.clone()]));

        let payload = events
            .recv_timeout(Duration::from_secs(5))
            .expect("the failed program is announced");
        let parsed: serde_json::Value =
            serde_json::from_str(&payload).expect("the payload is JSON");
        assert_eq!(
            parsed,
            serde_json::json!([{"program": "gh", "message": "the bundled gh exited with 3"}])
        );
        assert_eq!(
            app.state::<BinariesState>()
                .snapshot()
                .expect("the command reads the same result"),
            vec![failure]
        );
    }

    #[test]
    fn plat_34_a_check_that_could_not_run_emits_nothing_and_keeps_its_error() {
        let (app, events) = app_listening_for_the_event();

        report_verification(
            app.handle(),
            &Err(CommandError::Failed {
                code: "binary_copy_failed",
                message: "Could not copy the bundled programs.".to_string(),
            }),
        );
        // Events arrive in the order they were sent, so if the report had emitted anything it
        // would come before this marker.
        app.handle()
            .emit(EVENT_VERIFICATION_ERRORS, "marker")
            .expect("emit the marker");

        let first = events
            .recv_timeout(Duration::from_secs(5))
            .expect("the marker arrives");
        assert_eq!(first, "\"marker\"");
        let error = app
            .state::<BinariesState>()
            .snapshot()
            .expect_err("the command hands the failure on");
        assert_eq!(error_code(error), "binary_copy_failed");
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

    fn release_asset() -> ReleaseAsset {
        ReleaseAsset {
            url: "https://example.invalid/claude".to_string(),
            sha256: "a".repeat(64),
            size: 3,
        }
    }

    fn release(version: &str) -> ProgramRelease {
        ProgramRelease {
            version: version.to_string(),
            darwin_arm64: release_asset(),
            darwin_x64: release_asset(),
        }
    }

    #[test]
    fn plat_28_reports_claude_and_codex_as_missing_before_an_install() {
        let statuses = ProgramsState::default().snapshot();

        assert_eq!(
            statuses
                .iter()
                .map(|status| (status.program, status.state))
                .collect::<Vec<_>>(),
            vec![
                (ManagedProgram::Claude, ProgramState::Missing),
                (ManagedProgram::Codex, ProgramState::Missing),
            ]
        );
    }

    #[test]
    fn plat_28_a_release_is_read_from_the_feed_and_must_match_the_pinned_version() {
        let folder = TempDir::new();
        let path = folder.path().join("manifest.json");
        let manifest = ReleaseManifest {
            claude: Some(release("2.1.308")),
            codex: Some(release("0.164.0")),
        };
        fs::write(&path, serde_json::to_string(&manifest).expect("serialise")).expect("write feed");

        let read = read_release_manifest(&path).expect("read feed");

        assert_eq!(
            read.release(ManagedProgram::Claude)
                .map(|release| release.version.as_str()),
            Some("2.1.308")
        );
        assert_eq!(pinned_version(ManagedProgram::Claude), Some("2.1.308"));
        assert_eq!(pinned_version(ManagedProgram::Gh), None);
    }

    #[test]
    fn plat_28_a_missing_release_feed_is_a_named_error() {
        let folder = TempDir::new();
        let error = read_release_manifest(&folder.path().join("missing.json"))
            .expect_err("there is no feed");

        assert_eq!(error_code(error), "program_release_missing");
    }

    #[test]
    fn plat_28_a_second_install_of_the_same_program_is_joined() {
        let state = ProgramsState::default();

        let first = state.begin(ManagedProgram::Claude);
        assert!(first.is_some(), "the first install runs");
        assert!(
            state.begin(ManagedProgram::Claude).is_none(),
            "a second install of the same program joins the first"
        );
        assert!(
            state.begin(ManagedProgram::Codex).is_some(),
            "another program runs alone"
        );

        let (id, _cancel) = first.expect("the first run");
        state.finish(ManagedProgram::Claude, id);
        assert!(
            state.begin(ManagedProgram::Claude).is_some(),
            "a finished install allows a new one"
        );
    }

    #[test]
    fn plat_28_a_failed_download_keeps_its_retry_state() {
        let previous = ProgramStatus::missing(ManagedProgram::Claude);
        let error = CommandError::Failed {
            code: "http_timeout",
            message: "The download did not answer.".to_string(),
        };

        let failed = failed_status(&previous, &error, RetryPolicy::APP, 7);

        assert_eq!(failed.state, ProgramState::Retrying);
        assert_eq!(failed.attempt, 1);
        assert_eq!(
            failed.error.as_deref(),
            Some("The download did not answer.")
        );
        assert!(failed.next_attempt_at.is_some());
        assert_eq!(failed.next_attempt_at, Some(1_007));
    }

    #[test]
    fn plat_28_the_sha256_of_a_file_is_its_reported_hash() {
        let folder = TempDir::new();
        let path = folder.path().join("file");
        fs::write(&path, b"abc").expect("write file");

        assert_eq!(
            sha256_of_file(&path).expect("hash"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn plat_28_install_writes_metadata_points_the_shim_and_prunes_the_old_version() {
        let folder = TempDir::new();
        let data = folder.folder("data");
        let dirs = ProgramDirs::in_app_data(&data);
        let current = dirs.binaries.join("claude").join("2.1.308");
        fs::create_dir_all(&current).expect("make the version folder");
        let binary = current.join("claude");
        fs::write(&binary, b"abc").expect("write the program");
        let old = dirs.binaries.join("claude").join("2.1.307");
        fs::create_dir_all(&old).expect("make the old folder");
        fs::write(old.join("claude"), b"old").expect("write the old program");
        let trash = folder.folder("trash");

        let installed = finish_install(
            ManagedProgram::Claude,
            "2.1.308",
            &binary,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            &dirs,
            &|path| {
                let name = path
                    .file_name()
                    .expect("a name")
                    .to_string_lossy()
                    .into_owned();
                fs::rename(path, trash.join(name)).map_err(CommandError::Io)
            },
        )
        .expect("install");
        assert!(
            installed.prune_error.is_none(),
            "the old version was trashed"
        );

        let metadata = fs::read_to_string(dirs.binaries.join(".meta").join("claude-2.1.308.json"))
            .expect("metadata");
        let metadata: serde_json::Value = serde_json::from_str(&metadata).expect("metadata json");
        assert_eq!(metadata["size"], 3u64);
        assert_eq!(
            metadata["sha256"],
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            fs::read_link(dirs.bin.join("claude")).expect("bin shim"),
            binary
        );
        assert!(!old.exists(), "the old version was pruned");
        assert!(
            trash.join("2.1.307").is_dir(),
            "the old version went to Trash"
        );
    }

    #[test]
    fn plat_28_metadata_accepts_the_installed_file_and_rejects_a_changed_one() {
        let folder = TempDir::new();
        let data = folder.folder("data");
        let dirs = ProgramDirs::in_app_data(&data);
        let current = dirs.binaries.join("claude").join("2.1.308");
        fs::create_dir_all(&current).expect("make the version folder");
        let binary = current.join("claude");
        fs::write(&binary, b"abc").expect("write the program");
        let trash = folder.folder("trash");
        finish_install(
            ManagedProgram::Claude,
            "2.1.308",
            &binary,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            &dirs,
            &|path| {
                let name = path
                    .file_name()
                    .expect("a name")
                    .to_string_lossy()
                    .into_owned();
                fs::rename(path, trash.join(name)).map_err(CommandError::Io)
            },
        )
        .expect("install");
        let metadata = dirs.binaries.join(".meta").join("claude-2.1.308.json");

        assert!(metadata_matches(&binary, &metadata));

        fs::write(&binary, b"a changed program").expect("change the program");
        assert!(!metadata_matches(&binary, &metadata));
    }

    #[test]
    fn plat_28_a_file_without_a_quarantine_flag_installs() {
        let folder = TempDir::new();
        let path = folder.path().join("claude");
        fs::write(&path, b"program").expect("write program");

        strip_quarantine(&path).expect("nothing to clear");
    }

    #[test]
    fn plat_28_a_status_serialises_the_way_the_platform_reads_it() {
        let status = ProgramStatus {
            state: ProgramState::Downloading,
            version: Some("2.1.308".to_string()),
            bytes_downloaded: 5,
            bytes_total: Some(10),
            attempt: 1,
            next_attempt_at: Some(7),
            error: Some("cut off".to_string()),
            path: Some("/app/claude".to_string()),
            ..ProgramStatus::missing(ManagedProgram::Claude)
        };

        let value = serde_json::to_value(&status).expect("serialise the status");

        assert_eq!(value["program"], "claude");
        assert_eq!(value["state"], "downloading");
        assert_eq!(value["bytesDownloaded"], 5u64);
        assert_eq!(value["bytesTotal"], 10u64);
        assert_eq!(value["nextAttemptAt"], 7u64);
        assert_eq!(value["path"], "/app/claude");
    }

    #[test]
    fn plat_28_the_event_name_is_the_one_the_platform_listens_for() {
        let adapter = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/platform/tauri.ts");
        let source = fs::read_to_string(adapter).expect("read the Tauri adapter");
        let events = source
            .split_once("export const EVENTS = {")
            .map(|(_, rest)| rest)
            .expect("the adapter declares its EVENTS map");
        let listened = events
            .lines()
            .find_map(|line| {
                line.trim().strip_prefix("programsStatus:").map(|rest| {
                    rest.trim()
                        .trim_end_matches(',')
                        .trim_matches('"')
                        .to_string()
                })
            })
            .expect("the adapter's EVENTS names programsStatus");
        assert_eq!(listened, EVENT_PROGRAM_STATUS);
        assert_eq!(EVENT_PROGRAM_STATUS, "programs://status");
    }

    // ------------------------------------------------------------ PLAT-28 installs, end to end

    /// Records every status the manager sends and hands each one to the test as it arrives.
    struct Recorder {
        sent: Mutex<Vec<ProgramStatus>>,
        arrivals: std::sync::mpsc::Sender<ProgramStatus>,
    }

    impl Recorder {
        fn new() -> (Arc<Self>, std::sync::mpsc::Receiver<ProgramStatus>) {
            let (arrivals, receiver) = std::sync::mpsc::channel();
            let recorder = Self {
                sent: Mutex::new(Vec::new()),
                arrivals,
            };
            (Arc::new(recorder), receiver)
        }

        fn sent(&self, program: ManagedProgram) -> Vec<ProgramStatus> {
            self.sent
                .lock()
                .expect("read the record")
                .iter()
                .filter(|status| status.program == program)
                .cloned()
                .collect()
        }

        /// The states sent for `program`, with repeats in a row (download progress) folded.
        fn states(&self, program: ManagedProgram) -> Vec<ProgramState> {
            let mut states: Vec<ProgramState> = self
                .sent(program)
                .iter()
                .map(|status| status.state)
                .collect();
            states.dedup();
            states
        }

        fn first(&self, program: ManagedProgram, state: ProgramState) -> ProgramStatus {
            self.sent(program)
                .into_iter()
                .find(|status| status.state == state)
                .expect("the state was sent")
        }
    }

    impl StatusSink for Recorder {
        fn send(&self, status: &ProgramStatus) -> CommandResult<()> {
            self.sent
                .lock()
                .expect("record the status")
                .push(status.clone());
            self.arrivals
                .send(status.clone())
                .expect("the test still listens");
            Ok(())
        }
    }

    /// A window that takes `allowed` statuses and then refuses every one.
    struct RefusingSink {
        allowed: Mutex<u32>,
    }

    impl StatusSink for RefusingSink {
        fn send(&self, _status: &ProgramStatus) -> CommandResult<()> {
            let mut allowed = self.allowed.lock().expect("read the allowance");
            if *allowed == 0 {
                return Err(CommandError::Failed {
                    code: "test_window_gone",
                    message: "The test window is gone.".to_string(),
                });
            }
            *allowed -= 1;
            Ok(())
        }
    }

    fn wait_for(
        arrivals: &std::sync::mpsc::Receiver<ProgramStatus>,
        matches: impl Fn(&ProgramStatus) -> bool,
    ) -> ProgramStatus {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let status = arrivals.recv_timeout(left).expect("the status arrives");
            if matches(&status) {
                return status;
            }
        }
    }

    /// One answer of the local test server.
    enum Answer {
        /// A status code and a body.
        Body(u16, &'static [u8]),
        /// Says when the request arrived, then holds it open until the test releases it.
        Hold {
            arrived: std::sync::mpsc::Sender<()>,
            release: std::sync::mpsc::Receiver<()>,
        },
    }

    fn read_request_head(stream: &mut std::net::TcpStream) {
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("set the read timeout");
        let mut head = Vec::new();
        let mut buffer = [0u8; 1024];
        while !head.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = stream.read(&mut buffer).expect("read the request");
            assert!(read > 0, "the request ended before its head");
            head.extend_from_slice(&buffer[..read]);
        }
    }

    /// Answers one request per answer, in order, then stops listening. The thread returns how many
    /// requests it answered.
    fn serve(answers: Vec<Answer>) -> (String, thread::JoinHandle<usize>) {
        use std::io::Write;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind the test server");
        let address = listener.local_addr().expect("read the test address");
        let server = thread::spawn(move || {
            let mut served = 0;
            for answer in answers {
                let (mut stream, _) = listener.accept().expect("accept a request");
                read_request_head(&mut stream);
                served += 1;
                match answer {
                    Answer::Body(status, body) => {
                        let head = format!(
                            "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            body.len()
                        );
                        stream.write_all(head.as_bytes()).expect("write the head");
                        stream.write_all(body).expect("write the body");
                    }
                    Answer::Hold { arrived, release } => {
                        arrived.send(()).expect("tell the test");
                        release.recv().expect("the test releases the request");
                    }
                }
            }
            served
        });
        (format!("http://{address}/program"), server)
    }

    fn sha_hex(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    fn claude_version() -> &'static str {
        pinned_version(ManagedProgram::Claude).expect("Claude is pinned")
    }

    fn trash_into(folder: PathBuf) -> Trash {
        Arc::new(move |path: &Path| {
            let name = path.file_name().expect("a name").to_owned();
            fs::rename(path, folder.join(name)).map_err(CommandError::Io)
        })
    }

    fn install_context(folder: &TempDir, retry: RetryPolicy) -> InstallContext {
        InstallContext {
            dirs: ProgramDirs::in_app_data(&folder.folder("data")),
            allowed_hosts: &["127.0.0.1"],
            stall_timeout: Duration::from_secs(10),
            retry,
            trash: trash_into(folder.folder("trash")),
        }
    }

    const NO_WAIT: RetryPolicy = RetryPolicy {
        attempts: 3,
        first_delay_ms: 0,
    };

    /// A feed that offers `version` of Claude at `url`, with the size and hash of `body`.
    fn write_feed(dirs: &ProgramDirs, version: &str, url: &str, body: &[u8]) {
        let asset = ReleaseAsset {
            url: url.to_string(),
            sha256: sha_hex(body),
            size: body.len() as u64,
        };
        let manifest = ReleaseManifest {
            claude: Some(ProgramRelease {
                version: version.to_string(),
                darwin_arm64: asset.clone(),
                darwin_x64: asset,
            }),
            codex: None,
        };
        fs::create_dir_all(&dirs.binaries).expect("make the binaries folder");
        fs::write(
            dirs.manifest(),
            serde_json::to_string(&manifest).expect("serialise the feed"),
        )
        .expect("write the feed");
    }

    /// Puts `body` on disk as the installed pinned Claude, the way a finished install leaves it.
    fn install_on_disk(ctx: &InstallContext, body: &[u8]) -> PathBuf {
        let binary = ctx.dirs.binary(ManagedProgram::Claude, claude_version());
        fs::create_dir_all(binary.parent().expect("a version folder"))
            .expect("make the version folder");
        fs::write(&binary, body).expect("write the program");
        finish_install(
            ManagedProgram::Claude,
            claude_version(),
            &binary,
            &sha_hex(body),
            &ctx.dirs,
            &*ctx.trash,
        )
        .expect("install on disk");
        binary
    }

    fn install_claude(
        ctx: &InstallContext,
        state: &ProgramsState,
        sink: &dyn StatusSink,
        mode: InstallMode,
    ) {
        tauri::async_runtime::block_on(run_install(
            ctx,
            state,
            sink,
            ManagedProgram::Claude,
            mode,
            &CancellationToken::new(),
        ))
        .expect("every status was sent");
    }

    #[test]
    fn plat_28_a_failed_download_is_tried_again_and_then_installs() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let (url, server) = serve(vec![Answer::Body(500, b""), Answer::Body(200, b"abc")]);
        write_feed(&ctx.dirs, claude_version(), &url, b"abc");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_claude(&ctx, &state, recorder.as_ref(), InstallMode::Install);

        assert_eq!(server.join().expect("the server ends"), 2);
        assert_eq!(
            recorder.states(ManagedProgram::Claude),
            vec![
                ProgramState::Downloading,
                ProgramState::Retrying,
                ProgramState::Downloading,
                ProgramState::Verifying,
                ProgramState::Ready,
            ]
        );
        let retrying = recorder.first(ManagedProgram::Claude, ProgramState::Retrying);
        assert_eq!(retrying.attempt, 1);
        assert!(retrying.next_attempt_at.is_some());
        assert!(
            retrying
                .error
                .as_deref()
                .is_some_and(|error| error.contains("500")),
            "the retry shows why: {:?}",
            retrying.error
        );
        let ready = state.status(ManagedProgram::Claude);
        assert_eq!(ready.state, ProgramState::Ready);
        assert_eq!((ready.attempt, ready.error), (0, None));
        let binary = ctx.dirs.binary(ManagedProgram::Claude, claude_version());
        assert_eq!(fs::read(&binary).expect("the installed program"), b"abc");
        assert_eq!(
            fs::read_link(ctx.dirs.shim(ManagedProgram::Claude)).expect("the shim"),
            binary
        );
    }

    #[test]
    fn plat_28_a_download_that_keeps_failing_ends_failed_after_the_last_attempt() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let (url, server) = serve(vec![
            Answer::Body(503, b""),
            Answer::Body(503, b""),
            Answer::Body(503, b""),
        ]);
        write_feed(&ctx.dirs, claude_version(), &url, b"abc");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_claude(&ctx, &state, recorder.as_ref(), InstallMode::Install);

        assert_eq!(server.join().expect("the server ends"), 3);
        assert_eq!(
            recorder.states(ManagedProgram::Claude),
            vec![
                ProgramState::Downloading,
                ProgramState::Retrying,
                ProgramState::Downloading,
                ProgramState::Retrying,
                ProgramState::Downloading,
                ProgramState::Failed,
            ]
        );
        let failed = state.status(ManagedProgram::Claude);
        assert_eq!(failed.state, ProgramState::Failed);
        assert_eq!(failed.attempt, 3);
        assert_eq!(failed.next_attempt_at, None);
        assert!(
            failed
                .error
                .as_deref()
                .is_some_and(|error| error.contains("503"))
        );
    }

    #[test]
    fn plat_28_a_missing_feed_fails_at_once_without_a_retry() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_claude(&ctx, &state, recorder.as_ref(), InstallMode::Install);

        assert_eq!(
            recorder.states(ManagedProgram::Claude),
            vec![ProgramState::Failed]
        );
        let failed = state.status(ManagedProgram::Claude);
        assert_eq!(failed.attempt, 1);
        assert!(
            failed
                .error
                .as_deref()
                .is_some_and(|error| error.contains("release feed"))
        );
    }

    #[test]
    fn plat_28_a_feed_with_another_version_is_refused_without_a_download() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        // Nothing listens on port 1, so a download would fail with a network error instead.
        write_feed(&ctx.dirs, "2.1.307", "http://127.0.0.1:1/program", b"abc");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_claude(&ctx, &state, recorder.as_ref(), InstallMode::Install);

        assert_eq!(
            recorder.states(ManagedProgram::Claude),
            vec![ProgramState::Failed]
        );
        let error = state
            .status(ManagedProgram::Claude)
            .error
            .expect("the refusal is shown");
        assert!(
            error.contains("offers claude 2.1.307") && error.contains("pins 2.1.308"),
            "{error}"
        );
        assert!(!ctx.dirs.program(ManagedProgram::Claude).exists());
    }

    #[test]
    fn plat_28_a_checksum_that_does_not_match_is_never_installed() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let (url, server) = serve(vec![
            Answer::Body(200, b"xyz"),
            Answer::Body(200, b"xyz"),
            Answer::Body(200, b"xyz"),
        ]);
        write_feed(&ctx.dirs, claude_version(), &url, b"abc");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_claude(&ctx, &state, recorder.as_ref(), InstallMode::Install);

        assert_eq!(server.join().expect("the server ends"), 3);
        let failed = state.status(ManagedProgram::Claude);
        assert_eq!(failed.state, ProgramState::Failed);
        assert!(
            failed
                .error
                .as_deref()
                .is_some_and(|error| error.contains("SHA-256"))
        );
        let binary = ctx.dirs.binary(ManagedProgram::Claude, claude_version());
        assert!(!binary.exists(), "the refused file is not installed");
        let left: Vec<_> = fs::read_dir(binary.parent().expect("the version folder"))
            .expect("list the version folder")
            .collect();
        assert!(left.is_empty(), "no partial file is left: {left:?}");
        assert!(fs::symlink_metadata(ctx.dirs.shim(ManagedProgram::Claude)).is_err());
        assert!(
            !recorder
                .states(ManagedProgram::Claude)
                .contains(&ProgramState::Ready)
        );
    }

    #[test]
    fn plat_28_install_of_a_ready_program_downloads_nothing() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let binary = install_on_disk(&ctx, b"abc");
        write_feed(
            &ctx.dirs,
            claude_version(),
            "http://127.0.0.1:1/program",
            b"abc",
        );
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_claude(&ctx, &state, recorder.as_ref(), InstallMode::Install);

        assert_eq!(
            recorder.states(ManagedProgram::Claude),
            vec![ProgramState::Ready]
        );
        let ready = state.status(ManagedProgram::Claude);
        assert_eq!(ready.path, Some(binary.to_string_lossy().into_owned()));
        assert_eq!(ready.version.as_deref(), Some(claude_version()));
    }

    #[test]
    fn plat_28_redownload_replaces_the_installed_copy() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let binary = install_on_disk(&ctx, b"old");
        let (url, server) = serve(vec![Answer::Body(200, b"new")]);
        write_feed(&ctx.dirs, claude_version(), &url, b"new");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_claude(&ctx, &state, recorder.as_ref(), InstallMode::Redownload);

        assert_eq!(server.join().expect("the server ends"), 1);
        assert_eq!(
            recorder.states(ManagedProgram::Claude),
            vec![
                ProgramState::Downloading,
                ProgramState::Verifying,
                ProgramState::Ready,
            ]
        );
        assert_eq!(fs::read(&binary).expect("the new program"), b"new");
        assert!(installed_copy(&ctx.dirs, ManagedProgram::Claude).is_some());
    }

    #[test]
    fn plat_28_an_old_version_that_cannot_be_trashed_leaves_the_new_one_ready() {
        let folder = TempDir::new();
        let mut ctx = install_context(&folder, NO_WAIT);
        ctx.trash = Arc::new(|_path: &Path| {
            Err(CommandError::Failed {
                code: "test_trash_refused",
                message: "The test Trash refused the old version.".to_string(),
            })
        });
        let old = ctx.dirs.program(ManagedProgram::Claude).join("2.1.307");
        fs::create_dir_all(&old).expect("make the old version");
        let (url, server) = serve(vec![Answer::Body(200, b"abc")]);
        write_feed(&ctx.dirs, claude_version(), &url, b"abc");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_claude(&ctx, &state, recorder.as_ref(), InstallMode::Install);

        assert_eq!(server.join().expect("the server ends"), 1);
        let ready = state.status(ManagedProgram::Claude);
        assert_eq!(ready.state, ProgramState::Ready);
        assert_eq!(
            ready.error.as_deref(),
            Some("The test Trash refused the old version.")
        );
        assert!(old.is_dir(), "the old version is still there");
        assert!(
            !recorder
                .states(ManagedProgram::Claude)
                .contains(&ProgramState::Retrying)
        );
    }

    #[test]
    fn plat_28_remove_cancels_a_running_install_and_missing_is_the_last_state() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let (arrived, request_arrived) = std::sync::mpsc::channel();
        let (release, hold) = std::sync::mpsc::channel();
        let (url, server) = serve(vec![Answer::Hold {
            arrived,
            release: hold,
        }]);
        write_feed(&ctx.dirs, claude_version(), &url, b"abc");
        let (recorder, arrivals) = Recorder::new();
        let state = ProgramsState::default();

        let task = start_install(
            ctx.clone(),
            &state,
            recorder.clone(),
            ManagedProgram::Claude,
            InstallMode::Install,
        )
        .expect("the install starts")
        .expect("a new run");
        wait_for(&arrivals, |status| {
            status.state == ProgramState::Downloading
        });
        request_arrived
            .recv_timeout(Duration::from_secs(10))
            .expect("the download reaches the server");

        tauri::async_runtime::block_on(remove_program(
            &ctx,
            &state,
            recorder.as_ref(),
            ManagedProgram::Claude,
        ))
        .expect("the remove succeeds");
        tauri::async_runtime::block_on(task).expect("the install task ends");
        release.send(()).expect("release the server");
        assert_eq!(server.join().expect("the server ends"), 1);

        let sent = recorder.sent(ManagedProgram::Claude);
        assert_eq!(
            sent.last().map(|status| status.state),
            Some(ProgramState::Missing)
        );
        assert_eq!(
            state.status(ManagedProgram::Claude).state,
            ProgramState::Missing
        );
        assert!(!ctx.dirs.program(ManagedProgram::Claude).exists());
        assert!(folder.path().join("trash").join("claude").is_dir());
        assert!(fs::symlink_metadata(ctx.dirs.shim(ManagedProgram::Claude)).is_err());
        assert!(!state.is_installing(ManagedProgram::Claude));
    }

    #[test]
    fn plat_28_remove_trashes_the_program_and_its_shim() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        install_on_disk(&ctx, b"abc");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        tauri::async_runtime::block_on(remove_program(
            &ctx,
            &state,
            recorder.as_ref(),
            ManagedProgram::Claude,
        ))
        .expect("the remove succeeds");

        assert_eq!(
            recorder.states(ManagedProgram::Claude),
            vec![ProgramState::Missing]
        );
        assert!(!ctx.dirs.program(ManagedProgram::Claude).exists());
        assert!(
            folder
                .path()
                .join("trash")
                .join("claude")
                .join(claude_version())
                .join("claude")
                .is_file()
        );
        assert!(fs::symlink_metadata(ctx.dirs.shim(ManagedProgram::Claude)).is_err());
    }

    #[test]
    fn plat_28_a_second_start_joins_the_running_install_and_downloads_once() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let (url, server) = serve(vec![Answer::Body(200, b"abc")]);
        write_feed(&ctx.dirs, claude_version(), &url, b"abc");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        let first = start_install(
            ctx.clone(),
            &state,
            recorder.clone(),
            ManagedProgram::Claude,
            InstallMode::Redownload,
        )
        .expect("the first install starts");
        let second = start_install(
            ctx.clone(),
            &state,
            recorder.clone(),
            ManagedProgram::Claude,
            InstallMode::Redownload,
        )
        .expect("the second install is accepted");

        assert!(second.is_none(), "the second install joins the first");
        tauri::async_runtime::block_on(first.expect("a new run")).expect("the install ends");
        assert_eq!(server.join().expect("the server ends"), 1);
        assert_eq!(
            recorder
                .sent(ManagedProgram::Claude)
                .iter()
                .filter(|status| status.state == ProgramState::Queued)
                .count(),
            1
        );
        assert_eq!(
            state.status(ManagedProgram::Claude).state,
            ProgramState::Ready
        );
    }

    #[test]
    fn plat_28_a_status_the_window_refuses_is_returned_by_the_command() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let state = ProgramsState::default();
        let window = RefusingSink {
            allowed: Mutex::new(0),
        };

        let error = tauri::async_runtime::block_on(remove_program(
            &ctx,
            &state,
            &window,
            ManagedProgram::Claude,
        ))
        .expect_err("the window could not be told");

        assert_eq!(error_code(error), "test_window_gone");
        assert_eq!(
            state.status(ManagedProgram::Claude).state,
            ProgramState::Missing
        );
    }

    #[test]
    fn plat_28_a_background_install_keeps_a_status_the_window_refused() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let state = ProgramsState::default();
        // The window takes Queued, then refuses the Failed that follows (there is no feed).
        let window = Arc::new(RefusingSink {
            allowed: Mutex::new(1),
        });

        let task = start_install(
            ctx,
            &state,
            window,
            ManagedProgram::Claude,
            InstallMode::Install,
        )
        .expect("Queued was sent")
        .expect("a new run");
        tauri::async_runtime::block_on(task).expect("the install task ends");

        let kept = state.status(ManagedProgram::Claude);
        assert_eq!(kept.state, ProgramState::Failed);
        let error = kept.error.expect("the errors are kept");
        assert!(error.contains("release feed"), "{error}");
        assert!(error.contains("The test window is gone."), "{error}");
    }

    #[test]
    fn plat_28_the_app_sends_a_status_on_the_status_event() {
        use tauri::Listener;
        let app = tauri::test::mock_app();
        let (sender, events) = std::sync::mpsc::channel::<String>();
        app.handle().listen(EVENT_PROGRAM_STATUS, move |event| {
            sender
                .send(event.payload().to_string())
                .expect("the test still listens");
        });
        let state = ProgramsState::default();

        state
            .publish(app.handle(), ProgramStatus::missing(ManagedProgram::Codex))
            .expect("the window is told");

        let payload = events
            .recv_timeout(Duration::from_secs(5))
            .expect("the status arrives");
        let parsed: serde_json::Value = serde_json::from_str(&payload).expect("JSON");
        assert_eq!(parsed["program"], "codex");
        assert_eq!(parsed["state"], "missing");
    }

    #[test]
    fn plat_28_a_quarantine_flag_that_is_set_is_cleared() {
        let folder = TempDir::new();
        let path = folder.path().join("claude");
        fs::write(&path, b"program").expect("write program");
        let set = Command::new("xattr")
            .args(["-w", "com.apple.quarantine", "0081;00000000;Test;"])
            .arg(&path)
            .status()
            .expect("run xattr");
        assert!(set.success(), "the flag is set");

        strip_quarantine(&path).expect("the flag is cleared");

        let read = Command::new("xattr")
            .args(["-p", "com.apple.quarantine"])
            .arg(&path)
            .output()
            .expect("run xattr");
        assert!(!read.status.success(), "the flag is gone");
    }

    #[test]
    fn plat_28_the_shim_replaces_an_old_link_and_a_dangling_one() {
        let folder = TempDir::new();
        let bin = folder.folder("bin");
        let old = folder.path().join("old-claude");
        fs::write(&old, b"old").expect("write the old program");
        let new = folder.path().join("new-claude");
        fs::write(&new, b"new").expect("write the new program");
        symlink(&old, bin.join("claude")).expect("an old shim");
        symlink(folder.path().join("gone"), bin.join("codex")).expect("a dangling shim");

        install_bin_shim(&bin, ManagedProgram::Claude, &new).expect("replace the old shim");
        install_bin_shim(&bin, ManagedProgram::Codex, &new).expect("replace the dangling shim");

        assert_eq!(fs::read_link(bin.join("claude")).expect("claude shim"), new);
        assert_eq!(fs::read_link(bin.join("codex")).expect("codex shim"), new);
    }

    #[test]
    fn plat_28_a_restart_shows_the_installed_copy_ready() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let binary = install_on_disk(&ctx, b"abc");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        hydrate_from_disk(&ctx.dirs, &state, recorder.as_ref()).expect("hydrate");

        let claude = state.status(ManagedProgram::Claude);
        assert_eq!(claude.state, ProgramState::Ready);
        assert_eq!(claude.path, Some(binary.to_string_lossy().into_owned()));
        assert_eq!(
            state.status(ManagedProgram::Codex).state,
            ProgramState::Missing
        );
        assert_eq!(
            recorder.states(ManagedProgram::Claude),
            vec![ProgramState::Ready]
        );
    }

    #[test]
    fn plat_28_a_launch_preparation_that_fails_is_kept_on_every_agent_and_does_not_stop_launch() {
        let state = ProgramsState::default();

        keep_launch_error(
            Err(CommandError::Failed {
                code: "program_data_dir_failed",
                message: "Could not find the app data folder: no home".to_string(),
            }),
            &state,
        );

        for program in [ManagedProgram::Claude, ManagedProgram::Codex] {
            let status = state.status(program);
            assert_eq!(status.state, ProgramState::Missing);
            assert!(
                status
                    .error
                    .as_deref()
                    .is_some_and(|error| error.contains("Could not find the app data folder")),
                "{program}: {:?}",
                status.error
            );
        }
        let before = state.status(ManagedProgram::Claude).error;
        keep_launch_error(Ok(()), &state);
        assert_eq!(state.status(ManagedProgram::Claude).error, before);
    }

    #[test]
    fn plat_28_prefetch_installs_only_the_programs_that_are_not_ready() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        install_on_disk(&ctx, b"abc");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        let started = prefetch(&ctx, &state, recorder.clone()).expect("prefetch starts");
        assert_eq!(started.len(), 1, "only Codex needs an install");
        for task in started {
            tauri::async_runtime::block_on(task).expect("the install task ends");
        }

        assert_eq!(
            recorder.states(ManagedProgram::Claude),
            vec![ProgramState::Ready]
        );
        let codex = state.status(ManagedProgram::Codex);
        assert_eq!(codex.state, ProgramState::Failed);
        assert!(
            codex
                .error
                .as_deref()
                .is_some_and(|error| error.contains("release feed"))
        );
    }

    #[test]
    fn plat_28_app_exit_stops_an_install_that_waits_to_retry() {
        let folder = TempDir::new();
        let ctx = install_context(
            &folder,
            RetryPolicy {
                attempts: 3,
                first_delay_ms: 600_000,
            },
        );
        let (url, server) = serve(vec![Answer::Body(500, b"")]);
        write_feed(&ctx.dirs, claude_version(), &url, b"abc");
        let (recorder, arrivals) = Recorder::new();
        let state = ProgramsState::default();
        let task = start_install(
            ctx,
            &state,
            recorder.clone(),
            ManagedProgram::Claude,
            InstallMode::Install,
        )
        .expect("the install starts")
        .expect("a new run");
        wait_for(&arrivals, |status| status.state == ProgramState::Retrying);

        state.cancel_all();

        tauri::async_runtime::block_on(async {
            tokio::time::timeout(Duration::from_secs(10), task).await
        })
        .expect("the install stops without waiting out its delay")
        .expect("the install task ends");
        assert_eq!(server.join().expect("the server ends"), 1);
        assert_eq!(
            recorder.states(ManagedProgram::Claude).last(),
            Some(&ProgramState::Retrying)
        );
        assert!(!state.is_installing(ManagedProgram::Claude));
    }
}
