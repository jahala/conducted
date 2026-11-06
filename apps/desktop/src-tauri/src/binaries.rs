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
//! metadata, pointing the PATH shim at it, moving old versions to the Trash, and keeping retry
//! state. Commands: `programs_state`, `program_install`, `program_redownload`, `program_remove`
//! and `programs_prefetch`.
//! Behaviour: native-and-sidecar-map.md A2, A6 and A9; services-map.md 5A.8.1.
//! Must handle: a download that fails (retry state and next attempt), a checksum that does not
//! match (refused, never installed), a second install of a program already installing (joined, no
//! second download), a missing release feed (a named error, never an invented URL), the user's
//! chosen path (the manager only writes its own folders), and old versions (moved to the Trash).
//! Our design choice: the release feed is a JSON file the packaging step writes at
//! `agent-binaries/manifest.json`, because the app has no hosted feed of its own yet.
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

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::io::Read;
use std::os::unix::fs::symlink;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
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

/// The version this app pins for each agent program (A9). A release feed must serve these.
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
}

/// One downloadable file of a release, named by CPU. The manifest is produced with the app's
/// packages (PLAT-25); it is read from `agent-binaries/manifest.json` in the app data folder.
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
}

#[derive(Default)]
struct ProgramsInner {
    statuses: Mutex<HashMap<ManagedProgram, ProgramStatus>>,
    running: Mutex<HashSet<ManagedProgram>>,
}

/// The program manager's state, shared by the commands and the background downloads.
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
        lock_or_recover(&self.inner.statuses)
            .get(&program)
            .cloned()
            .unwrap_or_else(|| ProgramStatus::missing(program))
    }

    /// Stores a status and tells the window. The store is updated first, so the event never shows
    /// a state the command cannot read back.
    fn emit(&self, app: &AppHandle, status: ProgramStatus) {
        lock_or_recover(&self.inner.statuses).insert(status.program, status.clone());
        if let Err(error) = app.emit(EVENT_PROGRAM_STATUS, &status) {
            eprintln!("could not report the status of {}: {error}", status.program);
        }
    }

    /// Starts one install. False means the same program already has one running.
    fn begin(&self, program: ManagedProgram) -> bool {
        lock_or_recover(&self.inner.running).insert(program)
    }

    fn finish(&self, program: ManagedProgram) {
        lock_or_recover(&self.inner.running).remove(&program);
    }
}

fn lock_or_recover<T>(value: &Mutex<T>) -> MutexGuard<'_, T> {
    value
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn app_data_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|error| CommandError::Failed {
            code: "program_data_dir_failed",
            message: format!("Could not find the app data folder: {error}"),
        })
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

fn retry_delay_ms(attempt: u32) -> u64 {
    1_000u64 << attempt.min(5)
}

/// Moves an old program version to the macOS Trash.
fn trash_app_file(path: &Path) -> CommandResult<()> {
    files::trash_path(path)
}

/// Records a failure and the attempt's retry time, so the Retry button and the status carry it.
fn failed_status(previous: &ProgramStatus, error: &CommandError) -> ProgramStatus {
    let attempt = previous.attempt.saturating_add(1);
    ProgramStatus {
        state: ProgramState::Retrying,
        attempt,
        next_attempt_at: Some(now_ms().saturating_add(retry_delay_ms(attempt))),
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

fn install_bin_shim(bin_dir: &Path, program: ManagedProgram, binary: &Path) -> CommandResult<()> {
    fs::create_dir_all(bin_dir).map_err(|error| CommandError::Failed {
        code: "program_bin_dir_failed",
        message: format!("Could not make {}: {error}", bin_dir.display()),
    })?;
    let link = bin_dir.join(program.as_str());
    match fs::symlink_metadata(&link) {
        Ok(_) => fs::remove_file(&link).map_err(|error| CommandError::Failed {
            code: "program_bin_shim_failed",
            message: format!("Could not replace {}: {error}", link.display()),
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(CommandError::Failed {
                code: "program_bin_shim_failed",
                message: format!("Could not read {}: {error}", link.display()),
            });
        }
    }
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

/// Marks an already-installed pinned program ready, so a restart shows the copy on disk.
fn hydrate_from_disk(app: &AppHandle, state: &ProgramsState) -> CommandResult<()> {
    let dirs = ProgramDirs::in_app_data(&app_data_dir(app)?);
    for program in ManagedProgram::AGENTS {
        if state.status(program).state != ProgramState::Missing {
            continue;
        }
        let Some(version) = pinned_version(program) else {
            continue;
        };
        let binary = dirs
            .binaries
            .join(program.as_str())
            .join(version)
            .join(program.as_str());
        let metadata_path = dirs
            .binaries
            .join(".meta")
            .join(format!("{}-{version}.json", program.as_str()));
        if !metadata_matches(&binary, &metadata_path) {
            continue;
        }
        let mut status = ProgramStatus::missing(program);
        status.state = ProgramState::Ready;
        status.version = Some(version.to_string());
        status.path = Some(binary.to_string_lossy().into_owned());
        state.emit(app, status);
    }
    Ok(())
}

/// Makes a downloaded file the program's current version: clears quarantine, records its
/// metadata, points the PATH shim at it and removes older versions.
pub fn finish_install(
    program: ManagedProgram,
    version: &str,
    binary: &Path,
    sha256: &str,
    dirs: &ProgramDirs,
    trash: &dyn Fn(&Path) -> CommandResult<()>,
) -> CommandResult<()> {
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
    let metadata_dir = dirs.binaries.join(".meta");
    fs::create_dir_all(&metadata_dir).map_err(|error| CommandError::Failed {
        code: "program_metadata_failed",
        message: format!("Could not make {}: {error}", metadata_dir.display()),
    })?;
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
    let metadata_path = metadata_dir.join(format!("{}-{version}.json", program.as_str()));
    fs::write(&metadata_path, metadata.to_string()).map_err(|error| CommandError::Failed {
        code: "program_metadata_failed",
        message: format!("Could not write {}: {error}", metadata_path.display()),
    })?;
    install_bin_shim(&dirs.bin, program, binary)?;
    prune_versions(&dirs.binaries.join(program.as_str()), version, trash)
}

async fn download_and_finish(
    app: &AppHandle,
    state: &ProgramsState,
    program: ManagedProgram,
    _redownload: bool,
) -> CommandResult<()> {
    let data = app_data_dir(app)?;
    let dirs = ProgramDirs::in_app_data(&data);
    let manifest = read_release_manifest(&dirs.binaries.join("manifest.json"))?;
    let release = manifest
        .release(program)
        .ok_or_else(|| CommandError::Failed {
            code: "program_release_missing",
            message: format!("The release feed has no {program} program."),
        })?;
    let pinned = pinned_version(program).ok_or_else(|| CommandError::Failed {
        code: "program_release_missing",
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
    let version = release.version.clone();
    let target_dir = dirs.binaries.join(program.as_str()).join(&version);
    fs::create_dir_all(&target_dir).map_err(|error| CommandError::Failed {
        code: "program_install_failed",
        message: format!("Could not make {}: {error}", target_dir.display()),
    })?;
    let target = target_dir.join(program.as_str());

    let mut queued = state.status(program);
    queued.state = ProgramState::Downloading;
    queued.version = Some(version.clone());
    queued.bytes_downloaded = 0;
    queued.bytes_total = Some(asset.size);
    queued.error = None;
    state.emit(app, queued);

    let progress_state = state.clone();
    let progress_app = app.clone();
    let expected_size = asset.size;
    let outcome = crate::http::download_request(
        crate::http::ALLOWED_HOSTS,
        &asset.url,
        &target,
        Some(asset.sha256.as_str()),
        Duration::from_millis(crate::http::DOWNLOAD_STALL_TIMEOUT_MS),
        CancellationToken::new(),
        move |received, total| {
            let mut status = progress_state.status(program);
            status.state = ProgramState::Downloading;
            status.bytes_downloaded = received;
            status.bytes_total = total.or(Some(expected_size));
            progress_state.emit(&progress_app, status);
            Ok(())
        },
    )
    .await?;

    let mut verifying = state.status(program);
    verifying.state = ProgramState::Verifying;
    verifying.bytes_downloaded = outcome.size_bytes;
    state.emit(app, verifying);

    finish_install(
        program,
        &version,
        &target,
        &outcome.sha256,
        &dirs,
        &trash_app_file,
    )?;

    let mut ready = state.status(program);
    ready.state = ProgramState::Ready;
    ready.version = Some(version);
    ready.bytes_downloaded = outcome.size_bytes;
    ready.bytes_total = Some(outcome.size_bytes);
    ready.attempt = 0;
    ready.next_attempt_at = None;
    ready.error = None;
    ready.path = Some(target.to_string_lossy().into_owned());
    state.emit(app, ready);
    Ok(())
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

fn start_install(
    app: &AppHandle,
    state: &ProgramsState,
    program: ManagedProgram,
    redownload: bool,
) {
    if !ManagedProgram::AGENTS.contains(&program) || !state.begin(program) {
        return;
    }
    let manager = state.clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let outcome = download_and_finish(&handle, &manager, program, redownload).await;
        if let Err(error) = outcome {
            let status = failed_status(&manager.status(program), &error);
            manager.emit(&handle, status);
        }
        manager.finish(program);
    });
}

/// Returns the install state of Claude Code and Codex, including a copy already on disk.
#[tauri::command]
pub fn programs_state(
    app: AppHandle,
    state: State<'_, ProgramsState>,
) -> CommandResult<Vec<ProgramStatus>> {
    hydrate_from_disk(&app, state.inner())?;
    Ok(state.snapshot())
}

/// Requests an install of an agent program. A program already installing joins that install.
#[tauri::command]
pub fn program_install(
    app: AppHandle,
    state: State<'_, ProgramsState>,
    program: ManagedProgram,
) -> CommandResult<()> {
    require_agent(program)?;
    start_install(&app, state.inner(), program, false);
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
    start_install(&app, state.inner(), program, true);
    Ok(())
}

/// Moves an installed agent program to the Trash and reports it missing.
#[tauri::command]
pub fn program_remove(
    app: AppHandle,
    state: State<'_, ProgramsState>,
    program: ManagedProgram,
) -> CommandResult<()> {
    require_agent(program)?;
    let dirs = ProgramDirs::in_app_data(&app_data_dir(&app)?);
    let program_dir = dirs.binaries.join(program.as_str());
    match fs::symlink_metadata(&program_dir) {
        Ok(_) => files::trash_path(&program_dir)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(CommandError::Failed {
                code: "program_remove_failed",
                message: format!("Could not read {}: {error}", program_dir.display()),
            });
        }
    }
    let link = dirs.bin.join(program.as_str());
    match fs::symlink_metadata(&link) {
        Ok(_) => fs::remove_file(&link).map_err(|error| CommandError::Failed {
            code: "program_remove_failed",
            message: format!("Could not remove {}: {error}", link.display()),
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(CommandError::Failed {
                code: "program_remove_failed",
                message: format!("Could not read {}: {error}", link.display()),
            });
        }
    }
    state.emit(&app, ProgramStatus::missing(program));
    Ok(())
}

/// Downloads, in the background, the agent programs that are not installed yet.
#[tauri::command]
pub fn programs_prefetch(app: AppHandle, state: State<'_, ProgramsState>) -> CommandResult<()> {
    hydrate_from_disk(&app, state.inner())?;
    for program in ManagedProgram::AGENTS {
        if state.status(program).state != ProgramState::Ready {
            start_install(&app, state.inner(), program, false);
        }
    }
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

        assert!(
            state.begin(ManagedProgram::Claude),
            "the first install runs"
        );
        assert!(
            !state.begin(ManagedProgram::Claude),
            "a second install of the same program joins the first"
        );
        assert!(
            state.begin(ManagedProgram::Codex),
            "another program runs alone"
        );

        state.finish(ManagedProgram::Claude);
        assert!(
            state.begin(ManagedProgram::Claude),
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

        let failed = failed_status(&previous, &error);

        assert_eq!(failed.state, ProgramState::Retrying);
        assert_eq!(failed.attempt, 1);
        assert_eq!(
            failed.error.as_deref(),
            Some("The download did not answer.")
        );
        assert!(failed.next_attempt_at.is_some());
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
}
