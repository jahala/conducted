//! @feature PLAT-35 Install and update gh and watchexec (D024)
//!
//! Owns: the helper programs `gh` and `watchexec` as managed programs: they go through the same
//! program manager as the agent programs below (feed, download, checksum, unpack, metadata, bin
//! link, pruning, retry), and `prepare_on_launch` installs them with the agents.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A9 (binary manager: download to a
//! partial file, hash, rename into `<program>/<version>/`, a record per install, old versions
//! pruned), A6 step 11 (the bin folder is on PATH for terminals, scripts and agents) and C (`gh`
//! and `watchexec` sit in the bin folder; `spotlighter.sh` runs `watchexec`), services-map.md
//! 3.12 (Spotlight), overview.md 5. The decision is D024 in docs/decisions.md.
//!
//! Must handle:
//! - A download that fails, is cut off or has a wrong checksum: nothing is installed and nothing
//!   lands in the bin folder (the PLAT-28 rules below).
//! - The bin folder comes first on PATH for terminals, scripts and agents (the sidecar's
//!   `runners/managed-programs.ts`), so `gh` and `watchexec` resolve without any install by the
//!   user. The app's own commands check that this copy is ready before they run one, and a
//!   missing or failed copy is an error that names the program: the app never falls back to a copy
//!   on the user's PATH (D088). `spotlighter.sh` gets the app's watchexec by absolute path.
//!
//! The `gh stack` extension is not installed by the app: Conductor ships no copy of it (its bin
//! folder holds gh and watchexec) and tells the user to run `gh extension install github/gh-stack`
//! when a stack command needs it (renderApp's stack error); PR-08 shows that message. No setting chooses a gh or watchexec of the user's own: Conductor has none, so the app runs only its
//! own copy and never one on PATH (D088). ripgrep: Conductor ships one, but the research
//! does not show what runs it, so it is not managed.
//!
//! Test first: with a download source that serves a file with a wrong checksum, installing gh
//! fails and leaves no file in the bin folder.
//!
//! @feature PLAT-28 Agent program manager: download, verify, update, prune
//! Owns: the managed programs `claude`, `codex`, `gh` and `watchexec` (and Cursor's SDK tree,
//! AGENT-09 above): reading the pinned release
//! feed, downloading a program with a SHA-256 and progress, unpacking it from the vendor's
//! compressed file, clearing its quarantine flag, writing its install metadata, pointing its link
//! in the app's bin folder at it, moving old versions to the Trash, and retrying a failed
//! download. Commands: `programs_state`, `program_install`, `program_redownload`,
//! `program_remove` and `programs_prefetch`. `setup` in lib.rs runs the same prefetch at launch
//! through `prepare_on_launch`.
//! Behaviour: native-and-sidecar-map.md A2 (`lib.rs` prepares the agent programs at startup), A6
//! and A9 (pinned versions, metadata, shims, retry state, pruning, per-asset compressed files);
//! services-map.md 5A.8.1 (states, Retry).
//! Must handle:
//! - A failed download. A failure a retry can fix (network, timeout, server error, wrong checksum)
//!   shows Retrying with the attempt and the time of the next one, and runs again after that
//!   wait. After the last attempt, or at once for a failure that repeats the same way (no feed, a
//!   version this app does not pin, a file that cannot be unpacked), it shows Failed with the
//!   error.
//! - A checksum that does not match: refused, never installed. The feed's SHA-256 is that of the
//!   file as the vendor publishes it, so it is checked before anything is unpacked.
//! - A compressed release file (Codex's zstd, gh's zip, watchexec's tar.xz): the program is the
//!   one regular file of its name inside, wherever the vendor put it; none or two is an error. The
//!   downloaded file is removed after unpacking, and a failed unpack leaves no program behind.
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
//! The sidecar learns the folder through `CONDUCTED_AGENT_BINARIES_DIR` (`sidecar.rs`) and takes a
//! bin link as the managed copy only when it points in there.
//! Not built: an update feed that announces the next versions before an app update (A9's
//! `UpcomingAgentBinaries`): the app's own update feed carries no programs yet, so each app version
//! uses the versions its release feed pins. ACP provider downloads (OpenCode) are not in the feed.
//! Our design choice: five attempts, one second after the first failure and doubling after each
//! further one (`RetryPolicy::APP`). The research shows the retry state, not its numbers.
//! Our design choice: the release feed is `programs/release-feed.json`, shipped in the app's
//! resources (`tauri.conf.json`). It holds each program's URL, size and SHA-256 per CPU from the
//! vendor's official release host, as the owner ruled for PLAT-28. Conductor downloads its own
//! recompressed copies from its own host; we use the vendors' files and unpack them with Rust
//! decoders (ruzstd, zip, tar, lzma-rust2) instead of the system's `zstd` and `gzip`.
//! Test first: installing a program writes its metadata, points the bin shim at it and prunes the
//! old version.
//!
//! @feature AGENT-09 Cursor: SDK in process (installing the SDK on demand)
//! Owns: Cursor's SDK as a managed program (`cursor`): the pinned tree of npm packages in the
//! release feed, downloading each tarball from registry.npmjs.org with its SHA-256 checked,
//! unpacking it into `agent-binaries/cursor/<version>/node_modules/<name>/`, and the
//! `agent-binaries/cursor/current` link the sidecar loads the SDK through.
//! Behaviour: the owner's rulings for AGENT-09 and PLAT-28: the SDK installs on demand through
//! this manager and is never bundled (D010, D083); each tarball is pinned by exact version, size
//! and SHA-256 from the vendors' official release host.
//! Must handle: a tarball with a wrong checksum, a broken tarball or an entry outside its package
//! (nothing is installed: the tree is unpacked into a staging folder that is removed, and only a
//! complete tree is renamed into place and linked); the launch (Cursor's SDK is never installed
//! without the user asking: `ManagedProgram::installs_at_launch`); remove (the whole tree and its
//! link go to the Trash); the native package of this Mac's CPU only.
//! Our design choice: the tree is one install with one status, one progress bar over the sum of
//! the tarball sizes, and one metadata record kept on the SDK's `package.json`.
//! Test first: installing Cursor's SDK tree unpacks every package, keeps ripgrep's execute bit and
//! points `current` at the version.
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
//! `BinariesState`; the command reads that result instead of copying and running again. A command
//! that arrives while the check still runs waits for its result, so the command alone gives the
//! window the full list. The event only wakes a window that listens; one that could not be sent
//! loses nothing. A panic in the check is not caught: release builds abort on a panic.
//! Our design choice: every launch copies the whole bin folder. The source markers, quarantine
//! strip and unknown-file removal in A9 are not built yet, so a launch copies the 308 MB every
//! time (PLAT-34's later items).
//! Our design choice: the research and the issue call the pair `get_binary_verification_errors`
//! and `binary_verification_errors`; our names are `programs_verification_errors` and
//! `programs://verification-errors`, as recorded in docs/plans/tauri-commands.md.
//! Test first: a bundled `gh` that exits nonzero is copied, run again after a re-copy, and
//! reported as a verification error.
//!
//! @feature SET-13 Chosen program paths reach terminals and scripts
//! Owns: `programs_sync_path_overrides`, the command that stages the user's chosen `claude` and
//! `codex` executables in a shim folder and returns the folder to put first on PATH.
//! Behaviour: services-map.md 5A.8.2 (a shim folder `bin-overrides/<16-hex hash>/` with a link per
//! chosen program, whose folder is prepended through one PATH prefix variable).
//! Must handle: no chosen paths (`path_override_none`; the caller never asks then); an empty setting; a
//! path that is missing or not executable (a named error, and no shim is written); a program name
//! this app does not manage; a second sync with the same paths (the same folder, links rewritten);
//! a changed path (a new folder, and the old shim folders are moved to the Trash).
//! Test first: a chosen `claude` path becomes a link in a 16-hex shim folder whose name depends on
//! the path.

use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::io::Read;
use std::os::unix::fs::symlink;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio_util::sync::CancellationToken;

use crate::error::{CommandError, CommandResult};
use crate::files;
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
    /// Cursor's SDK: a tree of npm packages the sidecar loads in process (AGENT-09), not a program
    /// that runs on its own.
    Cursor,
}

impl ManagedProgram {
    /// Every program the manager knows.
    pub const ALL: [ManagedProgram; 5] = [
        ManagedProgram::Claude,
        ManagedProgram::Codex,
        ManagedProgram::Gh,
        ManagedProgram::Watchexec,
        ManagedProgram::Cursor,
    ];

    /// The agent programs, whose path the user may choose in settings instead (SET-13). The program
    /// manager downloads all of `ALL` (D021, D024).
    pub const AGENTS: [ManagedProgram; 2] = [ManagedProgram::Claude, ManagedProgram::Codex];

    /// The name the program has on disk and in the Platform.
    pub fn as_str(self) -> &'static str {
        match self {
            ManagedProgram::Claude => "claude",
            ManagedProgram::Codex => "codex",
            ManagedProgram::Gh => "gh",
            ManagedProgram::Watchexec => "watchexec",
            ManagedProgram::Cursor => "cursor",
        }
    }

    /// True when the launch installs the program without being asked. Cursor's SDK installs only
    /// when the user asks for it (the owner's ruling for AGENT-09), so nothing of it is downloaded
    /// at app start.
    pub fn installs_at_launch(self) -> bool {
        self != ManagedProgram::Cursor
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

/// What the finished launch check produced: the programs that failed, or the error that stopped
/// the whole check before it could name a program.
#[derive(Debug, Clone)]
enum LaunchOutcome {
    Checked(Vec<VerificationError>),
    Failed(StoredFailure),
}

/// The launch check's result, managed once by `lib.rs` and read by the command.
///
/// One thread runs the check at a time: `claim_run` returns true for the first caller only. The
/// command never starts a check, so asking it during launch cannot copy or run anything. It waits
/// for the check instead: `None` means the check is still running, never "no errors".
#[derive(Debug)]
pub struct BinariesState {
    outcome: tokio::sync::watch::Sender<Option<LaunchOutcome>>,
    started: AtomicBool,
}

impl Default for BinariesState {
    fn default() -> Self {
        Self {
            outcome: tokio::sync::watch::Sender::new(None),
            started: AtomicBool::new(false),
        }
    }
}

impl BinariesState {
    fn claim_run(&self) -> bool {
        !self.started.swap(true, Ordering::AcqRel)
    }

    fn finish(&self, result: &CommandResult<Vec<VerificationError>>) {
        let outcome = match result {
            Ok(errors) => LaunchOutcome::Checked(errors.clone()),
            Err(error) => LaunchOutcome::Failed(StoredFailure::from_error(error)),
        };
        self.outcome.send_replace(Some(outcome));
    }

    /// The launch check's result. Waits while the check still runs, so a caller that asks early
    /// gets the real list and not an empty one.
    async fn result(&self) -> CommandResult<Vec<VerificationError>> {
        let mut receiver = self.outcome.subscribe();
        let ready = receiver
            .wait_for(Option::is_some)
            .await
            .map_err(|_| no_launch_result())?;
        match &*ready {
            Some(LaunchOutcome::Checked(errors)) => Ok(errors.clone()),
            Some(LaunchOutcome::Failed(failure)) => Err(failure.to_error()),
            None => Err(no_launch_result()),
        }
    }
}

fn no_launch_result() -> CommandError {
    CommandError::Failed {
        code: "binary_verification_failed",
        message: "The launch check of the bundled programs ended without a result.".to_string(),
    }
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
    if let Ok(errors) = result {
        // The event only wakes a window that is listening. `programs_verification_errors` waits
        // for this same result and returns it, so an event that could not be sent loses nothing
        // the window can read, and there is no one else to tell.
        let _ = app.emit(EVENT_VERIFICATION_ERRORS, errors);
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
/// copies or runs a program itself. Called while the check still runs, it waits for the result.
#[tauri::command]
pub async fn programs_verification_errors(
    state: State<'_, BinariesState>,
) -> CommandResult<Vec<VerificationError>> {
    state.result().await
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

// ------------------------------------------------------------------ SET-13 path overrides

/// Writes the shim folder for the user's chosen program paths and returns the folder to put first
/// on PATH. With nothing chosen it fails with `path_override_none`: the caller owns the bundled
/// folder and asks only when something is chosen. Each chosen executable must exist and be
/// runnable; otherwise the command fails and the caller tells the user. The shim folder's name is a hash of the chosen names and paths, so the same
/// choice reuses one folder. Older shim folders are moved to the Trash.
pub fn stage_path_overrides(
    app_data: &Path,
    overrides: &HashMap<String, String>,
    trash: &dyn Fn(&Path) -> CommandResult<()>,
) -> CommandResult<PathBuf> {
    use std::os::unix::fs::PermissionsExt;

    let mut chosen: Vec<(ManagedProgram, PathBuf)> = Vec::new();
    for (name, raw) in overrides {
        let value = raw.trim();
        if value.is_empty() {
            continue;
        }
        let program = ManagedProgram::AGENTS
            .iter()
            .copied()
            .find(|program| program.as_str() == name)
            .ok_or_else(|| CommandError::Failed {
                code: "path_override_unknown_program",
                message: format!("There is no agent program this app manages named {name}."),
            })?;
        let path = PathBuf::from(value);
        let metadata = fs::metadata(&path).map_err(|error| CommandError::Failed {
            code: "path_override_invalid",
            message: format!(
                "The {program} program path {} cannot be used: {error}",
                path.display()
            ),
        })?;
        if !metadata.is_file() {
            return Err(CommandError::Failed {
                code: "path_override_invalid",
                message: format!(
                    "The {program} program path {} is not a file.",
                    path.display()
                ),
            });
        }
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(CommandError::Failed {
                code: "path_override_invalid",
                message: format!(
                    "The {program} program path {} is not executable.",
                    path.display()
                ),
            });
        }
        chosen.push((program, path));
    }
    chosen.sort_by_key(|(program, _)| program.as_str());

    if chosen.is_empty() {
        return Err(CommandError::Failed {
            code: "path_override_none",
            message: "No program path was chosen, so there is no shim folder to write.".to_string(),
        });
    }

    let mut hasher = Sha256::new();
    for (program, path) in &chosen {
        hasher.update(program.as_str().as_bytes());
        hasher.update([0u8]);
        hasher.update(path.to_string_lossy().as_bytes());
        hasher.update([0u8]);
    }
    let hash: String = format!("{:x}", hasher.finalize())
        .chars()
        .take(16)
        .collect();
    let root = app_data.join("bin-overrides");
    let shim_dir = root.join(&hash);
    fs::create_dir_all(&shim_dir).map_err(|error| CommandError::Failed {
        code: "path_override_shim_failed",
        message: format!("Could not make {}: {error}", shim_dir.display()),
    })?;

    for (program, path) in &chosen {
        let link = shim_dir.join(program.as_str());
        remove_if_present(&link, "path_override_shim_failed", |link| {
            remove_link(link, "path_override_shim_failed")
        })?;
        symlink(path, &link).map_err(|error| CommandError::Failed {
            code: "path_override_shim_failed",
            message: format!(
                "Could not point {} at {}: {error}",
                link.display(),
                path.display()
            ),
        })?;
    }

    prune_shim_folders(&root, &hash, trash)?;
    Ok(shim_dir)
}

/// Moves every shim folder except `keep` to the Trash, so the folder cannot grow without bound.
/// The prefix applies to terminals and scripts started after the choice; an older terminal keeps
/// the command it already resolved.
fn prune_shim_folders(
    root: &Path,
    keep: &str,
    trash: &dyn Fn(&Path) -> CommandResult<()>,
) -> CommandResult<()> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(CommandError::Failed {
                code: "path_override_prune_failed",
                message: format!("Could not list {}: {error}", root.display()),
            });
        }
    };
    for entry in entries {
        let entry = entry.map_err(|error| CommandError::Failed {
            code: "path_override_prune_failed",
            message: format!("Could not read an entry of {}: {error}", root.display()),
        })?;
        if entry.file_name().to_string_lossy() == keep {
            continue;
        }
        trash(&entry.path())?;
    }
    Ok(())
}

/// One sync at a time, so two terminals opening together cannot remove each other's links.
static PATH_OVERRIDES_SYNC: Mutex<()> = Mutex::new(());

/// Writes the shims for the chosen agent program paths and returns the folder to put first on PATH.
#[tauri::command]
pub fn programs_sync_path_overrides(
    app: AppHandle,
    overrides: HashMap<String, String>,
) -> CommandResult<String> {
    let _guard = PATH_OVERRIDES_SYNC
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| CommandError::Failed {
            code: "path_override_data_dir_failed",
            message: format!("Could not find the app data folder: {error}"),
        })?;
    let dir = stage_path_overrides(&data, &overrides, &files::trash_path)?;
    Ok(dir.to_string_lossy().into_owned())
}

// ------------------------------------------------------------------ PLAT-28 agent programs

/// Event carrying one program's status, including download progress.
pub const EVENT_PROGRAM_STATUS: &str = "programs://status";

/// The version this app pins for each managed program. These are the versions Conductor 0.92.1
/// pins (native-and-sidecar-map.md A9, "Pinned versions in this build", and section C for
/// watchexec). The release feed shipped with the app must serve them.
pub fn pinned_version(program: ManagedProgram) -> &'static str {
    match program {
        ManagedProgram::Claude => "2.1.308",
        ManagedProgram::Codex => "0.164.0",
        ManagedProgram::Gh => "2.100.0",
        ManagedProgram::Watchexec => "2.3.2",
        // The latest @cursor/sdk on registry.npmjs.org on 2026-11-06, which the owner ruled is
        // installed on demand (AGENT-09). Conductor bundles its own copy; its version is not in the
        // research.
        ManagedProgram::Cursor => "1.3.1",
    }
}

/// Where the release feed sits inside the app's resources. `tauri.conf.json` bundles it there.
pub const RELEASE_FEED_RESOURCE: &str = "programs/release-feed.json";

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

/// How a release file holds its program. The SHA-256 and size in the feed are those of the file
/// as the vendor publishes it; the program is unpacked after that file has been checked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssetFormat {
    /// The file is the program itself (Claude Code).
    Raw,
    /// One zstd-compressed program (Codex's `.zst`).
    Zstd,
    /// A zip archive with the program somewhere inside (gh).
    Zip,
    /// An xz-compressed tar archive with the program somewhere inside (watchexec).
    TarXz,
}

/// One downloadable file of a release, named by CPU, from the vendor's official release host.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub format: AssetFormat,
}

/// One pinned program and its per-CPU files.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramRelease {
    pub version: String,
    pub darwin_arm64: ReleaseAsset,
    pub darwin_x64: ReleaseAsset,
}

/// One npm package of a package tree: its exact version and the tarball registry.npmjs.org
/// publishes for it, with the tarball's size and SHA-256.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageTarball {
    /// The package name, such as `@cursor/sdk`. It names the folder under `node_modules`.
    pub name: String,
    pub version: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
}

/// A pinned tree of npm packages: the packages every Mac needs, and the native package of each
/// CPU. Cursor's SDK is one (AGENT-09).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageTreeRelease {
    pub version: String,
    pub packages: Vec<PackageTarball>,
    pub darwin_arm64: Vec<PackageTarball>,
    pub darwin_x64: Vec<PackageTarball>,
}

impl PackageTreeRelease {
    /// Every tarball this Mac installs, the shared packages first.
    fn tarballs(&self) -> Vec<&PackageTarball> {
        let native = if cfg!(target_arch = "aarch64") {
            &self.darwin_arm64
        } else {
            &self.darwin_x64
        };
        self.packages.iter().chain(native.iter()).collect()
    }

    fn tarballs_mut(&mut self) -> impl Iterator<Item = &mut PackageTarball> {
        self.packages
            .iter_mut()
            .chain(self.darwin_arm64.iter_mut())
            .chain(self.darwin_x64.iter_mut())
    }
}

/// The release feed the program manager reads: one pinned release per managed program. The app
/// ships it as a resource (`RELEASE_FEED_RESOURCE`), so each app version pins its own programs.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub struct ReleaseManifest {
    pub claude: Option<ProgramRelease>,
    pub codex: Option<ProgramRelease>,
    pub gh: Option<ProgramRelease>,
    pub watchexec: Option<ProgramRelease>,
    pub cursor: Option<PackageTreeRelease>,
}

impl ReleaseManifest {
    /// The release of a program that is one file. Cursor's SDK is a package tree, so it has none.
    fn release(&self, program: ManagedProgram) -> Option<&ProgramRelease> {
        match program {
            ManagedProgram::Claude => self.claude.as_ref(),
            ManagedProgram::Codex => self.codex.as_ref(),
            ManagedProgram::Gh => self.gh.as_ref(),
            ManagedProgram::Watchexec => self.watchexec.as_ref(),
            ManagedProgram::Cursor => None,
        }
    }

    fn releases_mut(&mut self) -> [Option<&mut ProgramRelease>; 4] {
        [
            self.claude.as_mut(),
            self.codex.as_mut(),
            self.gh.as_mut(),
            self.watchexec.as_mut(),
        ]
    }
}

fn asset_for(release: &ProgramRelease) -> &ReleaseAsset {
    if cfg!(target_arch = "aarch64") {
        &release.darwin_arm64
    } else {
        &release.darwin_x64
    }
}

/// The folder layout the manager owns: `agent-binaries/<program>/<version>/` and the PATH shims in
/// `bin/`. gh and watchexec live beside the agent programs (D024).
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

    fn program(&self, program: ManagedProgram) -> PathBuf {
        self.binaries.join(program.as_str())
    }

    /// The installed file a version is known by: the program itself, or for Cursor's SDK the
    /// SDK's own `package.json`, which the sidecar reads to load it.
    fn binary(&self, program: ManagedProgram, version: &str) -> PathBuf {
        match program {
            ManagedProgram::Cursor => self
                .program(program)
                .join(version)
                .join("node_modules")
                .join(CURSOR_SDK_PACKAGE)
                .join("package.json"),
            _ => self.program(program).join(version).join(program.as_str()),
        }
    }

    /// Where a package tree is unpacked before it is renamed to its version folder. The name
    /// starts with a dot, so no version is ever called that.
    fn staging(&self, program: ManagedProgram, version: &str) -> PathBuf {
        self.program(program).join(format!(".{version}.partial"))
    }

    /// Where a compressed release file is downloaded before its program is unpacked beside it.
    fn download(&self, program: ManagedProgram, version: &str) -> PathBuf {
        self.program(program)
            .join(version)
            .join(format!("{}.download", program.as_str()))
    }

    fn metadata(&self, program: ManagedProgram, version: &str) -> PathBuf {
        self.binaries
            .join(".meta")
            .join(format!("{}-{version}.json", program.as_str()))
    }

    /// The link that says which version is ready. A program's link is in the bin folder, which is
    /// on PATH. Cursor's SDK is no program to run, so its link is `cursor/current` beside its
    /// versions, where the sidecar looks for it.
    fn shim(&self, program: ManagedProgram) -> PathBuf {
        match program {
            ManagedProgram::Cursor => self.program(program).join(CURSOR_CURRENT_LINK),
            _ => self.bin.join(program.as_str()),
        }
    }
}

/// The npm package of Cursor's SDK inside its tree.
pub const CURSOR_SDK_PACKAGE: &str = "@cursor/sdk";

/// The name of the link to the ready version of Cursor's SDK. The sidecar's
/// `runners/cursor/load-sdk.ts` reads the same name.
pub const CURSOR_CURRENT_LINK: &str = "current";

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

/// What an install needs from outside: the folders, the release feed, the download's hosts and
/// stall timeout, the retry policy and the Trash. The app builds it from its data and resource
/// folders; a test passes its own.
#[derive(Clone)]
pub struct InstallContext {
    pub dirs: ProgramDirs,
    pub feed: PathBuf,
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
        let resources = app
            .path()
            .resource_dir()
            .map_err(|error| CommandError::Failed {
                code: "program_resources_dir_failed",
                message: format!("Could not find the app resources folder: {error}"),
            })?;
        Ok(Self {
            dirs: ProgramDirs::in_app_data(&data),
            feed: resources.join(RELEASE_FEED_RESOURCE),
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
    /// Every managed program's status: Claude, Codex, gh, watchexec. A program with no record is
    /// missing.
    pub fn snapshot(&self) -> Vec<ProgramStatus> {
        ManagedProgram::ALL
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
/// Each hash is checked and kept in lower case here, so the download and the install compare the
/// same text.
pub fn read_release_manifest(path: &Path) -> CommandResult<ReleaseManifest> {
    let text = fs::read_to_string(path).map_err(|error| CommandError::Failed {
        code: "program_release_missing",
        message: format!(
            "The program release feed {} could not be read: {error}",
            path.display()
        ),
    })?;
    let mut manifest: ReleaseManifest =
        serde_json::from_str(&text).map_err(|error| CommandError::Failed {
            code: "program_release_invalid",
            message: format!("The program release feed could not be understood: {error}"),
        })?;
    let bad_hash = |error: CommandError| CommandError::Failed {
        code: "program_release_invalid",
        message: format!("The program release feed has a bad hash: {error}"),
    };
    for release in manifest.releases_mut().into_iter().flatten() {
        for asset in [&mut release.darwin_arm64, &mut release.darwin_x64] {
            asset.sha256 = crate::http::parse_sha256(&asset.sha256).map_err(bad_hash)?;
        }
    }
    if let Some(tree) = manifest.cursor.as_mut() {
        for tarball in tree.tarballs_mut() {
            tarball.sha256 = crate::http::parse_sha256(&tarball.sha256).map_err(bad_hash)?;
            check_package_name(&tarball.name)?;
        }
    }
    Ok(manifest)
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
    point_link(&bin_dir.join(program.as_str()), binary)
}

/// Makes `link` point at `target`, replacing whatever link was there, and makes its folder first.
fn point_link(link: &Path, target: &Path) -> CommandResult<()> {
    if let Some(folder) = link.parent() {
        fs::create_dir_all(folder).map_err(|error| CommandError::Failed {
            code: "program_bin_dir_failed",
            message: format!("Could not make {}: {error}", folder.display()),
        })?;
    }
    remove_if_present(link, "program_bin_shim_failed", |link| {
        remove_link(link, "program_bin_shim_failed")
    })?;
    symlink(target, link).map_err(|error| CommandError::Failed {
        code: "program_bin_shim_failed",
        message: format!(
            "Could not point {} at {}: {error}",
            link.display(),
            target.display()
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
    let version = pinned_version(program);
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
    for program in ManagedProgram::ALL {
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
    write_metadata(dirs, program, version, binary, sha256)?;
    install_bin_shim(&dirs.bin, program, binary)?;
    Ok(Installed {
        prune_error: prune_versions(&dirs.program(program), version, trash).err(),
    })
}

/// Records an installed version: the SHA-256 it was checked against, and the size and modified
/// time of the file it is known by, so a later launch can tell the file has not changed.
fn write_metadata(
    dirs: &ProgramDirs,
    program: ManagedProgram,
    version: &str,
    binary: &Path,
    sha256: &str,
) -> CommandResult<()> {
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
    })
}

/// Unpacks the program from a downloaded release file whose SHA-256 already matched, then removes
/// that file. Returns the SHA-256 of the program it wrote, for `finish_install` to check against
/// the file on disk. A file that cannot be unpacked leaves neither the program nor the download.
fn unpack_downloaded(
    format: AssetFormat,
    downloaded: &Path,
    program: ManagedProgram,
    binary: &Path,
) -> CommandResult<String> {
    let unpacked = unpack(format, downloaded, program.as_str(), binary);
    let removed = fs::remove_file(downloaded).map_err(|error| CommandError::Failed {
        code: "program_unpack_failed",
        message: format!(
            "Could not remove the downloaded file {}: {error}",
            downloaded.display()
        ),
    });
    let sha256 = unpacked?;
    removed?;
    Ok(sha256)
}

/// Writes the program named `name` from the release file at `source` to `binary`, through a
/// temporary file beside it that is renamed into place only when the whole program was written.
/// In an archive the program is the one regular file whose name is `name`, in whichever folder
/// the vendor put it; none, or more than one, is an error.
pub fn unpack(
    format: AssetFormat,
    source: &Path,
    name: &str,
    binary: &Path,
) -> CommandResult<String> {
    let file = fs::File::open(source).map_err(|error| unpack_failed(source, &error))?;
    let temporary = temporary_copy_path(binary);
    let written = match format {
        AssetFormat::Raw => Err(CommandError::Failed {
            code: "program_unpack_failed",
            message: format!(
                "{} is the program itself and has nothing to unpack.",
                source.display()
            ),
        }),
        AssetFormat::Zstd => write_zstd(file, source, &temporary),
        AssetFormat::Zip => write_from_zip(file, source, name, &temporary),
        AssetFormat::TarXz => write_from_tar_xz(file, source, name, &temporary),
    };
    let sha256 = match written {
        Ok(sha256) => sha256,
        Err(error) => {
            remove_temporary(&temporary);
            return Err(error);
        }
    };
    if let Err(error) = fs::rename(&temporary, binary) {
        remove_temporary(&temporary);
        return Err(CommandError::Failed {
            code: "program_unpack_failed",
            message: format!(
                "Could not move the unpacked program to {}: {error}",
                binary.display()
            ),
        });
    }
    Ok(sha256)
}

fn unpack_failed(source: &Path, error: &dyn fmt::Display) -> CommandError {
    CommandError::Failed {
        code: "program_unpack_failed",
        message: format!("Could not unpack {}: {error}", source.display()),
    }
}

/// Removes a half-written temporary program. Nothing there is fine; a file that stays is
/// reported on stderr, because the caller is already returning the error that matters.
fn remove_temporary(temporary: &Path) {
    if let Err(error) = fs::remove_file(temporary)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        eprintln!(
            "could not remove the temporary program {}: {error}",
            temporary.display()
        );
    }
}

/// A new program file that hashes what is written to it.
struct HashedFile<'a> {
    file: fs::File,
    hasher: Sha256,
    source: &'a Path,
}

impl<'a> HashedFile<'a> {
    fn create(temporary: &Path, source: &'a Path) -> CommandResult<Self> {
        let file = fs::File::create(temporary).map_err(|error| unpack_failed(source, &error))?;
        Ok(Self {
            file,
            hasher: Sha256::new(),
            source,
        })
    }

    /// Copies everything `reader` gives into the file.
    fn copy_from(&mut self, reader: &mut dyn Read) -> CommandResult<()> {
        use std::io::Write;
        let mut buffer = vec![0u8; 1024 * 1024];
        loop {
            let read = reader
                .read(&mut buffer)
                .map_err(|error| unpack_failed(self.source, &error))?;
            if read == 0 {
                return Ok(());
            }
            self.hasher.update(&buffer[..read]);
            self.file
                .write_all(&buffer[..read])
                .map_err(|error| unpack_failed(self.source, &error))?;
        }
    }

    /// Flushes the file to disk and returns the SHA-256 of what was written.
    fn finish(self) -> CommandResult<String> {
        self.file
            .sync_all()
            .map_err(|error| unpack_failed(self.source, &error))?;
        Ok(format!("{:x}", self.hasher.finalize()))
    }
}

/// Copies `reader` into a new file at `temporary` and returns the SHA-256 of what it wrote.
fn write_hashed(reader: &mut dyn Read, source: &Path, temporary: &Path) -> CommandResult<String> {
    let mut file = HashedFile::create(temporary, source)?;
    file.copy_from(reader)?;
    file.finish()
}

/// Decodes every zstd frame of the file in turn, so a file of several frames unpacks whole.
fn write_zstd(file: fs::File, source: &Path, temporary: &Path) -> CommandResult<String> {
    use std::io::BufRead;
    let mut input = std::io::BufReader::new(file);
    let mut output = HashedFile::create(temporary, source)?;
    loop {
        let rest = input
            .fill_buf()
            .map_err(|error| unpack_failed(source, &error))?;
        if rest.is_empty() {
            return output.finish();
        }
        let mut frame = ruzstd::decoding::StreamingDecoder::new(&mut input)
            .map_err(|error| unpack_failed(source, &error))?;
        output.copy_from(&mut frame)?;
    }
}

/// Finds the one regular file named `name` in a zip archive and writes it out.
fn write_from_zip(
    file: fs::File,
    source: &Path,
    name: &str,
    temporary: &Path,
) -> CommandResult<String> {
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|error| unpack_failed(source, &error))?;
    let mut found: Option<usize> = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index_raw(index)
            .map_err(|error| unpack_failed(source, &error))?;
        let entry_name = entry
            .name()
            .map_err(|error| unpack_failed(source, &error))?;
        if entry.is_file() && entry_file_name(&entry_name) == Some(name) {
            if found.is_some() {
                return Err(more_than_one(source, name));
            }
            found = Some(index);
        }
    }
    let index = found.ok_or_else(|| not_in_archive(source, name))?;
    let mut entry = archive
        .by_index(index)
        .map_err(|error| unpack_failed(source, &error))?;
    write_hashed(&mut entry, source, temporary)
}

/// Finds the one regular file named `name` in an xz-compressed tar archive and writes it out. The
/// whole archive is read, so a second file of the same name is caught.
fn write_from_tar_xz(
    file: fs::File,
    source: &Path,
    name: &str,
    temporary: &Path,
) -> CommandResult<String> {
    let reader = lzma_rust2::XzReader::new(std::io::BufReader::new(file), true);
    let mut archive = tar::Archive::new(reader);
    let mut written: Option<String> = None;
    for entry in archive
        .entries()
        .map_err(|error| unpack_failed(source, &error))?
    {
        let mut entry = entry.map_err(|error| unpack_failed(source, &error))?;
        let path = entry
            .path()
            .map_err(|error| unpack_failed(source, &error))?
            .into_owned();
        let named = path.file_name().and_then(|file_name| file_name.to_str()) == Some(name);
        if !named || !entry.header().entry_type().is_file() {
            continue;
        }
        if written.is_some() {
            remove_temporary(temporary);
            return Err(more_than_one(source, name));
        }
        written = Some(write_hashed(&mut entry, source, temporary)?);
    }
    written.ok_or_else(|| not_in_archive(source, name))
}

/// The last part of an archive entry's name: `gh_2.100.0_macOS_arm64/bin/gh` gives `gh`.
fn entry_file_name(entry: &str) -> Option<&str> {
    entry.rsplit('/').next().filter(|part| !part.is_empty())
}

fn not_in_archive(source: &Path, name: &str) -> CommandError {
    CommandError::Failed {
        code: "program_unpack_failed",
        message: format!("{} holds no program named {name}.", source.display()),
    }
}

fn more_than_one(source: &Path, name: &str) -> CommandError {
    CommandError::Failed {
        code: "program_unpack_failed",
        message: format!(
            "{} holds more than one file named {name}, so the program is not clear.",
            source.display()
        ),
    }
}

/// One attempt: reads the feed, downloads the pinned version with progress, unpacks the program
/// when the release file is compressed, and installs it. Returns the Ready status. `status`
/// carries the attempt count into each status it sends.
async fn download_and_finish(
    ctx: &InstallContext,
    state: &ProgramsState,
    sink: &dyn StatusSink,
    program: ManagedProgram,
    status: &ProgramStatus,
    cancel: &CancellationToken,
) -> CommandResult<ProgramStatus> {
    let manifest = read_release_manifest(&ctx.feed)?;
    if program == ManagedProgram::Cursor {
        return download_tree_and_finish(ctx, &manifest, state, sink, program, status, cancel)
            .await;
    }
    let release = manifest
        .release(program)
        .ok_or_else(|| CommandError::Failed {
            code: "program_release_missing",
            message: format!("The release feed has no {program} program."),
        })?;
    let pinned = pinned_version(program);
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
    // A raw release file is the program, so it downloads straight to its place. A compressed one
    // downloads beside it and is unpacked after its SHA-256 matched.
    let downloaded = match asset.format {
        AssetFormat::Raw => target.clone(),
        _ => ctx.dirs.download(program, pinned),
    };
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
        &downloaded,
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
    let format = asset.format;
    let checked = asset.sha256.clone();
    let binary = target.clone();
    // Unpacking and hashing a program of a few hundred MB blocks, so it runs off the async workers.
    let installed = crate::error::blocking("program_install_failed", move || {
        let expected = match format {
            AssetFormat::Raw => checked,
            _ => unpack_downloaded(format, &downloaded, program, &binary)?,
        };
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

/// Refuses a package name that is not `name` or `@scope/name`, so a feed entry cannot point a
/// folder outside `node_modules`.
fn check_package_name(name: &str) -> CommandResult<()> {
    let parts: Vec<&str> = name.split('/').collect();
    let plain = |part: &str| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && part.chars().all(|character| {
                character.is_ascii_lowercase()
                    || character.is_ascii_digit()
                    || matches!(character, '-' | '_' | '.' | '~')
            })
    };
    let valid = match parts.as_slice() {
        [single] => plain(single),
        [scope, package] => scope.strip_prefix('@').is_some_and(plain) && plain(package),
        _ => false,
    };
    if valid {
        return Ok(());
    }
    Err(CommandError::Failed {
        code: "program_release_invalid",
        message: format!("The program release feed names a package {name:?} that is not valid."),
    })
}

/// Unpacks one npm tarball into `folder`. An npm tarball keeps every file under `package/`; that
/// first part is dropped. Only folders and regular files are written, a file keeps its execute
/// bit, and an entry that would land outside `folder` refuses the whole tarball.
pub fn unpack_npm_tarball(source: &Path, folder: &Path) -> CommandResult<()> {
    use std::os::unix::fs::PermissionsExt;
    use std::path::Component;

    let file = fs::File::open(source).map_err(|error| unpack_failed(source, &error))?;
    let mut archive =
        tar::Archive::new(flate2::read::GzDecoder::new(std::io::BufReader::new(file)));
    for entry in archive
        .entries()
        .map_err(|error| unpack_failed(source, &error))?
    {
        let mut entry = entry.map_err(|error| unpack_failed(source, &error))?;
        let path = entry
            .path()
            .map_err(|error| unpack_failed(source, &error))?
            .into_owned();
        let mut components = path.components();
        let first = components.next();
        let rest: PathBuf = components.collect();
        let inside = matches!(first, Some(Component::Normal(_)))
            && rest
                .components()
                .all(|component| matches!(component, Component::Normal(_)));
        if !inside {
            return Err(unpack_failed(
                source,
                &format!("the entry {} is outside the package", path.display()),
            ));
        }
        let target = folder.join(&rest);
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            fs::create_dir_all(&target).map_err(|error| unpack_failed(source, &error))?;
            continue;
        }
        if !kind.is_file() {
            return Err(unpack_failed(
                source,
                &format!("the entry {} is not a file or a folder", path.display()),
            ));
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| unpack_failed(source, &error))?;
        }
        let mode = entry
            .header()
            .mode()
            .map_err(|error| unpack_failed(source, &error))?;
        let mut written =
            fs::File::create(&target).map_err(|error| unpack_failed(source, &error))?;
        std::io::copy(&mut entry, &mut written).map_err(|error| unpack_failed(source, &error))?;
        let permissions = if mode & 0o111 != 0 { 0o755 } else { 0o644 };
        fs::set_permissions(&target, fs::Permissions::from_mode(permissions))
            .map_err(|error| unpack_failed(source, &error))?;
    }
    Ok(())
}

/// Clears the quarantine flag from every file in `folder`, so the native parts of a package tree
/// (ripgrep, the sandbox helper, Node addons) can run.
fn strip_quarantine_tree(folder: &Path) -> CommandResult<()> {
    let output = Command::new("xattr")
        .arg("-d")
        .arg("-r")
        .arg("com.apple.quarantine")
        .arg(folder)
        .output()
        .map_err(|error| CommandError::Failed {
            code: "program_quarantine_failed",
            message: format!(
                "Could not clear the quarantine flag in {}: {error}",
                folder.display()
            ),
        })?;
    // xattr reports "No such xattr" for each file without the flag and still exits 0 with -r on
    // some macOS versions and 1 on others; only another message is a failure.
    let stderr = String::from_utf8_lossy(&output.stderr);
    let other = stderr
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.contains("No such xattr"))
        .collect::<Vec<_>>();
    if output.status.success() || other.is_empty() {
        return Ok(());
    }
    Err(CommandError::Failed {
        code: "program_quarantine_failed",
        message: format!(
            "Could not clear the quarantine flag in {}: {}",
            folder.display(),
            other.join(" ")
        ),
    })
}

/// Removes a staging folder this install made. A folder that stays is reported on stderr,
/// because the caller is already returning the error that matters.
fn remove_staging(staging: &Path) {
    if let Err(error) = fs::remove_dir_all(staging)
        && error.kind() != std::io::ErrorKind::NotFound
    {
        eprintln!(
            "could not remove the staging folder {}: {error}",
            staging.display()
        );
    }
}

/// One attempt at a package tree (Cursor's SDK): downloads each pinned tarball with its SHA-256
/// checked, unpacks it into a staging folder, and only when every package is in place renames the
/// folder to its version, records it and points `current` at it. Any failure leaves no version
/// folder and no link, and removes the staging folder.
async fn download_tree_and_finish(
    ctx: &InstallContext,
    manifest: &ReleaseManifest,
    state: &ProgramsState,
    sink: &dyn StatusSink,
    program: ManagedProgram,
    status: &ProgramStatus,
    cancel: &CancellationToken,
) -> CommandResult<ProgramStatus> {
    let release = manifest
        .cursor
        .as_ref()
        .ok_or_else(|| CommandError::Failed {
            code: "program_release_missing",
            message: format!("The release feed has no {program} package tree."),
        })?;
    let pinned = pinned_version(program);
    if release.version != pinned {
        return Err(CommandError::Failed {
            code: "program_version_not_pinned",
            message: format!(
                "The release feed offers {program} {}, but this app pins {pinned}.",
                release.version
            ),
        });
    }
    let tarballs = release.tarballs();
    let sdk_sha256 = tarballs
        .iter()
        .find(|tarball| tarball.name == CURSOR_SDK_PACKAGE)
        .map(|tarball| tarball.sha256.clone())
        .ok_or_else(|| CommandError::Failed {
            code: "program_release_invalid",
            message: format!("The release feed's {program} tree has no {CURSOR_SDK_PACKAGE}."),
        })?;
    let total: u64 = tarballs.iter().map(|tarball| tarball.size).sum();

    let staging = ctx.dirs.staging(program, pinned);
    // A staging folder left by an install the app did not finish is moved to the Trash first.
    remove_if_present(&staging, "program_install_failed", |folder| {
        (ctx.trash)(folder)
    })?;
    let modules = staging.join("node_modules");
    fs::create_dir_all(&modules).map_err(|error| CommandError::Failed {
        code: "program_install_failed",
        message: format!("Could not make {}: {error}", modules.display()),
    })?;

    let attempt = async {
        let mut downloading = ProgramStatus {
            state: ProgramState::Downloading,
            version: Some(pinned.to_string()),
            bytes_downloaded: 0,
            bytes_total: Some(total),
            next_attempt_at: None,
            error: None,
            ..status.clone()
        };
        state.publish(sink, downloading.clone())?;
        let mut done: u64 = 0;
        for (index, tarball) in tarballs.iter().enumerate() {
            let downloaded = staging.join(format!("{index}.tgz"));
            let outcome = crate::http::download_request(
                ctx.allowed_hosts,
                &tarball.url,
                &downloaded,
                Some(tarball.sha256.as_str()),
                ctx.stall_timeout,
                cancel.clone(),
                |received, _total| {
                    downloading.bytes_downloaded = done.saturating_add(received);
                    state.publish(sink, downloading.clone())
                },
            )
            .await?;
            done = done.saturating_add(outcome.size_bytes);
            let folder = modules.join(&tarball.name);
            crate::error::blocking("program_unpack_failed", move || {
                let unpacked = unpack_npm_tarball(&downloaded, &folder);
                let removed = fs::remove_file(&downloaded).map_err(|error| CommandError::Failed {
                    code: "program_unpack_failed",
                    message: format!(
                        "Could not remove the downloaded file {}: {error}",
                        downloaded.display()
                    ),
                });
                unpacked?;
                removed
            })
            .await?;
        }
        state.publish(
            sink,
            ProgramStatus {
                state: ProgramState::Verifying,
                bytes_downloaded: done,
                ..downloading
            },
        )?;

        let dirs = ctx.dirs.clone();
        let trash = Arc::clone(&ctx.trash);
        let staged = staging.clone();
        let installed = crate::error::blocking("program_install_failed", move || {
            finish_tree_install(program, pinned, &staged, &sdk_sha256, &dirs, &*trash)
        })
        .await?;
        Ok::<_, CommandError>((done, installed))
    };
    let (done, installed) = match attempt.await {
        Ok(finished) => finished,
        Err(error) => {
            remove_staging(&staging);
            return Err(error);
        }
    };

    Ok(ProgramStatus {
        program,
        state: ProgramState::Ready,
        version: Some(pinned.to_string()),
        bytes_downloaded: done,
        bytes_total: Some(done),
        attempt: 0,
        next_attempt_at: None,
        error: installed.prune_error.map(|error| error.to_string()),
        path: Some(
            ctx.dirs
                .binary(program, pinned)
                .to_string_lossy()
                .into_owned(),
        ),
    })
}

/// Makes a staged package tree the current version: clears quarantine, moves an installed copy of
/// the same version to the Trash (a re-download), renames the staging folder into place, records
/// the SDK's `package.json` in the metadata, points `current` at the version and removes older
/// versions.
fn finish_tree_install(
    program: ManagedProgram,
    version: &str,
    staging: &Path,
    sha256: &str,
    dirs: &ProgramDirs,
    trash: &dyn Fn(&Path) -> CommandResult<()>,
) -> CommandResult<Installed> {
    strip_quarantine_tree(staging)?;
    let entry_in_staging = staging
        .join("node_modules")
        .join(CURSOR_SDK_PACKAGE)
        .join("package.json");
    if !entry_in_staging.is_file() {
        return Err(CommandError::Failed {
            code: "program_install_failed",
            message: format!("The {program} tree has no {}.", entry_in_staging.display()),
        });
    }
    let target = dirs.program(program).join(version);
    remove_if_present(&target, "program_install_failed", trash)?;
    fs::rename(staging, &target).map_err(|error| CommandError::Failed {
        code: "program_install_failed",
        message: format!(
            "Could not move {} to {}: {error}",
            staging.display(),
            target.display()
        ),
    })?;
    write_metadata(
        dirs,
        program,
        version,
        &dirs.binary(program, version),
        sha256,
    )?;
    point_link(&dirs.shim(program), &target)?;
    Ok(Installed {
        prune_error: prune_versions(&dirs.program(program), version, trash).err(),
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

/// Shows the installed copies, then starts an install of every managed program that is not ready
/// and installs at launch: Cursor's SDK waits until the user installs it. Returns the tasks it
/// started.
fn prefetch(
    ctx: &InstallContext,
    state: &ProgramsState,
    sink: Arc<dyn StatusSink>,
) -> CommandResult<Vec<tauri::async_runtime::JoinHandle<()>>> {
    hydrate_from_disk(&ctx.dirs, state, sink.as_ref())?;
    let mut started = Vec::new();
    for program in ManagedProgram::ALL {
        if !program.installs_at_launch() || state.status(program).state == ProgramState::Ready {
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

/// Keeps a failed launch preparation on every program's status, so the window can read why.
fn keep_launch_error(prepared: CommandResult<()>, state: &ProgramsState) {
    if let Err(error) = prepared {
        for program in ManagedProgram::ALL {
            state.keep_error(program, &error);
        }
    }
}

/// Returns the install state of Claude Code, Codex, gh and watchexec, including a copy already on
/// disk.
#[tauri::command]
pub fn programs_state(
    app: AppHandle,
    state: State<'_, ProgramsState>,
) -> CommandResult<Vec<ProgramStatus>> {
    let ctx = InstallContext::for_app(&app)?;
    hydrate_from_disk(&ctx.dirs, state.inner(), &app)?;
    Ok(state.snapshot())
}

/// Installs a managed program, or shows the matching copy already installed. A program already
/// installing joins that install.
#[tauri::command]
pub fn program_install(
    app: AppHandle,
    state: State<'_, ProgramsState>,
    program: ManagedProgram,
) -> CommandResult<()> {
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

/// Moves an installed managed program to the Trash and reports it missing. Cancels and waits for a
/// running install of it first.
#[tauri::command]
pub async fn program_remove(
    app: AppHandle,
    state: State<'_, ProgramsState>,
    program: ManagedProgram,
) -> CommandResult<()> {
    let ctx = InstallContext::for_app(&app)?;
    remove_program(&ctx, state.inner(), &app, program).await
}

/// Downloads, in the background, the managed programs that are not ready. Until an update feed
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

        assert_eq!(
            launch_result(&state).expect("the launch result"),
            vec![error]
        );
    }

    /// The command's answer, read the way the command reads it.
    fn launch_result(state: &BinariesState) -> CommandResult<Vec<VerificationError>> {
        tauri::async_runtime::block_on(state.result())
    }

    #[test]
    fn plat_34_the_command_waits_for_a_launch_check_still_running() {
        use futures_util::FutureExt;

        let state = BinariesState::default();
        let error = VerificationError {
            program: ManagedProgram::Gh,
            message: "the bundled gh exited with 3".to_string(),
        };

        assert!(
            state.result().now_or_never().is_none(),
            "an early call waits instead of answering with an empty list"
        );
        state.finish(&Ok(vec![error.clone()]));

        let answer = state
            .result()
            .now_or_never()
            .expect("the call answers once the check has finished");
        assert_eq!(answer.expect("the launch result"), vec![error]);
    }

    #[test]
    fn plat_34_a_call_waiting_for_the_launch_check_gets_its_result() {
        let state = Arc::new(BinariesState::default());
        let (asking, asked) = std::sync::mpsc::channel();
        let waiter = {
            let state = Arc::clone(&state);
            thread::spawn(move || {
                tauri::async_runtime::block_on(async {
                    let mut answer = Box::pin(state.result());
                    // Polled once, the call is waiting on the check before the test finishes it.
                    let first = futures_util::poll!(answer.as_mut());
                    asking
                        .send(first.is_pending())
                        .expect("tell the test the call waits");
                    answer.await
                })
            })
        };
        let waiting = asked
            .recv_timeout(Duration::from_secs(5))
            .expect("the call is made");
        assert!(waiting, "the call waits while the check runs");

        state.finish(&Err(CommandError::Failed {
            code: "binary_copy_failed",
            message: "Could not copy the bundled programs.".to_string(),
        }));

        let error = waiter
            .join()
            .expect("the waiting call returns")
            .expect_err("the launch failure is handed on");
        assert_eq!(error_code(error), "binary_copy_failed");
    }

    #[test]
    fn plat_34_the_command_reports_a_failed_launch_check() {
        let state = BinariesState::default();
        state.finish(&Err(CommandError::Failed {
            code: "binary_copy_failed",
            message: "Could not copy the bundled programs.".to_string(),
        }));

        let error = launch_result(&state).expect_err("the launch failure is handed on");

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
            launch_result(&app.state::<BinariesState>())
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
        let error = launch_result(&app.state::<BinariesState>())
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
            format: AssetFormat::Raw,
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
                (ManagedProgram::Gh, ProgramState::Missing),
                (ManagedProgram::Watchexec, ProgramState::Missing),
                (ManagedProgram::Cursor, ProgramState::Missing),
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
            ..ReleaseManifest::default()
        };
        fs::write(&path, serde_json::to_string(&manifest).expect("serialise")).expect("write feed");

        let read = read_release_manifest(&path).expect("read feed");

        assert_eq!(
            read.release(ManagedProgram::Claude)
                .map(|release| release.version.as_str()),
            Some("2.1.308")
        );
        assert_eq!(pinned_version(ManagedProgram::Claude), "2.1.308");
        assert_eq!(pinned_version(ManagedProgram::Gh), "2.100.0");
    }

    #[test]
    fn plat_28_the_release_feed_hash_is_read_in_lower_case_and_checked() {
        let folder = TempDir::new();
        let path = folder.path().join("manifest.json");
        let upper = ProgramRelease {
            darwin_arm64: ReleaseAsset {
                sha256: "AB".repeat(32),
                ..release_asset()
            },
            ..release("2.1.308")
        };
        let manifest = ReleaseManifest {
            claude: Some(upper),
            ..ReleaseManifest::default()
        };
        fs::write(&path, serde_json::to_string(&manifest).expect("serialise")).expect("write feed");

        let read = read_release_manifest(&path).expect("read feed");

        let claude = read
            .release(ManagedProgram::Claude)
            .expect("Claude is offered");
        assert_eq!(claude.darwin_arm64.sha256, "ab".repeat(32));

        let short = ReleaseManifest {
            codex: Some(ProgramRelease {
                darwin_x64: ReleaseAsset {
                    sha256: "abc".to_string(),
                    ..release_asset()
                },
                ..release("0.164.0")
            }),
            ..ReleaseManifest::default()
        };
        fs::write(&path, serde_json::to_string(&short).expect("serialise")).expect("write feed");
        let error = read_release_manifest(&path).expect_err("a short hash is refused");
        assert_eq!(error_code(error), "program_release_invalid");
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
        pinned_version(ManagedProgram::Claude)
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
            feed: folder.folder("resources").join(RELEASE_FEED_RESOURCE),
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
    fn write_feed(ctx: &InstallContext, version: &str, url: &str, body: &[u8]) {
        write_program_feed(
            ctx,
            ManagedProgram::Claude,
            version,
            url,
            body,
            AssetFormat::Raw,
        );
    }

    /// A feed that offers `version` of `program` at `url` as one `format` file, with the size and
    /// hash of `body`, the file as served.
    fn write_program_feed(
        ctx: &InstallContext,
        program: ManagedProgram,
        version: &str,
        url: &str,
        body: &[u8],
        format: AssetFormat,
    ) {
        let asset = ReleaseAsset {
            url: url.to_string(),
            sha256: sha_hex(body),
            size: body.len() as u64,
            format,
        };
        let release = Some(ProgramRelease {
            version: version.to_string(),
            darwin_arm64: asset.clone(),
            darwin_x64: asset,
        });
        let mut manifest = ReleaseManifest::default();
        match program {
            ManagedProgram::Claude => manifest.claude = release,
            ManagedProgram::Codex => manifest.codex = release,
            ManagedProgram::Gh => manifest.gh = release,
            ManagedProgram::Watchexec => manifest.watchexec = release,
            ManagedProgram::Cursor => unreachable!("Cursor's SDK is a package tree, not one file"),
        }
        fs::create_dir_all(ctx.feed.parent().expect("a feed folder"))
            .expect("make the feed folder");
        fs::write(
            &ctx.feed,
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
        write_feed(&ctx, claude_version(), &url, b"abc");
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
        write_feed(&ctx, claude_version(), &url, b"abc");
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
        write_feed(&ctx, "2.1.307", "http://127.0.0.1:1/program", b"abc");
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
        write_feed(&ctx, claude_version(), &url, b"abc");
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
        write_feed(&ctx, claude_version(), "http://127.0.0.1:1/program", b"abc");
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
        write_feed(&ctx, claude_version(), &url, b"new");
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
        write_feed(&ctx, claude_version(), &url, b"abc");
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
        write_feed(&ctx, claude_version(), &url, b"abc");
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
        write_feed(&ctx, claude_version(), &url, b"abc");
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
    fn plat_28_a_copy_in_the_bin_folder_is_not_a_managed_install() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        fs::create_dir_all(&ctx.dirs.bin).expect("make the bin folder");
        let stray = ctx.dirs.bin.join("gh");
        fs::write(&stray, b"#!/bin/sh\nexit 0\n").expect("write a stray program");
        fs::set_permissions(&stray, fs::Permissions::from_mode(0o755))
            .expect("make the stray program runnable");
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        hydrate_from_disk(&ctx.dirs, &state, recorder.as_ref()).expect("hydrate");

        // Only an install the manager recorded is ready. A same-named file in the bin folder, and
        // any copy on the user's PATH, is not one (D088).
        assert_eq!(
            state.status(ManagedProgram::Gh).state,
            ProgramState::Missing
        );
        assert_eq!(
            recorder.states(ManagedProgram::Gh),
            Vec::<ProgramState>::new()
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
        assert_eq!(
            started.len(),
            3,
            "only Codex, gh and watchexec need an install"
        );
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
        write_feed(&ctx, claude_version(), &url, b"abc");
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

    // ------------------------------------------------------- PLAT-28 and PLAT-35 release files

    /// The feed the app ships, read the way the program manager reads it.
    fn shipped_feed() -> ReleaseManifest {
        read_release_manifest(&Path::new(env!("CARGO_MANIFEST_DIR")).join(RELEASE_FEED_RESOURCE))
            .expect("the shipped release feed reads")
    }

    #[test]
    fn plat_28_the_shipped_release_feed_pins_every_program_from_an_allowed_host() {
        let feed = shipped_feed();

        assert_eq!(
            ManagedProgram::ALL.len(),
            5,
            "claude, codex, gh, watchexec and Cursor's SDK"
        );
        for program in ManagedProgram::ALL {
            if program == ManagedProgram::Cursor {
                continue;
            }
            let release = feed
                .release(program)
                .unwrap_or_else(|| panic!("the feed offers {program}"));
            assert_eq!(release.version, pinned_version(program), "{program}");
            for asset in [&release.darwin_arm64, &release.darwin_x64] {
                crate::http::check_url(&asset.url, crate::http::ALLOWED_HOSTS)
                    .unwrap_or_else(|error| panic!("{program}: {} is refused: {error}", asset.url));
                assert!(asset.size > 0, "{program}: {} has a size", asset.url);
            }
        }
        assert_eq!(
            feed.release(ManagedProgram::Codex)
                .map(|release| release.darwin_arm64.format),
            Some(AssetFormat::Zstd)
        );
    }

    #[test]
    fn plat_28_the_app_bundles_the_release_feed_where_the_manager_reads_it() {
        let config =
            fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json"))
                .expect("read tauri.conf.json");
        let config: serde_json::Value =
            serde_json::from_str(&config).expect("parse tauri.conf.json");

        assert_eq!(
            config["bundle"]["resources"][RELEASE_FEED_RESOURCE], RELEASE_FEED_RESOURCE,
            "the feed is copied to the resource path the program manager reads"
        );
    }

    #[test]
    fn plat_35_the_bin_folder_is_the_one_the_window_puts_on_path() {
        let data = Path::new("/data");
        assert_eq!(ProgramDirs::in_app_data(data).bin, data.join("bin"));
        let paths = fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/core/app-paths.ts"),
        )
        .expect("read app-paths.ts");
        assert!(
            paths.contains(
                "export const programsBinDir = (paths: AppPaths): string => join(paths.appData, \"bin\");"
            ),
            "the window's programsBinDir is <app data>/bin, where the links are"
        );
    }

    /// Leaks `bytes`, so the local test server can serve a body made at run time.
    fn served(bytes: Vec<u8>) -> &'static [u8] {
        Box::leak(bytes.into_boxed_slice())
    }

    fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in files {
            writer
                .start_file(*name, options)
                .expect("start a zip entry");
            writer.write_all(body).expect("write a zip entry");
        }
        writer.finish().expect("finish the zip").into_inner()
    }

    fn tar_xz_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut builder = tar::Builder::new(Vec::new());
        for (name, body) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            builder
                .append_data(&mut header, name, *body)
                .expect("add a tar entry");
        }
        let tar = builder.into_inner().expect("finish the tar");
        let mut writer = lzma_rust2::XzWriter::new(Vec::new(), lzma_rust2::XzOptions::default())
            .expect("start the xz stream");
        writer.write_all(&tar).expect("compress the tar");
        writer.finish().expect("finish the xz stream")
    }

    fn zstd_of(body: &[u8]) -> Vec<u8> {
        ruzstd::encoding::compress_to_vec(body, ruzstd::encoding::CompressionLevel::Fastest)
    }

    fn install_program(
        ctx: &InstallContext,
        state: &ProgramsState,
        sink: &dyn StatusSink,
        program: ManagedProgram,
    ) {
        tauri::async_runtime::block_on(run_install(
            ctx,
            state,
            sink,
            program,
            InstallMode::Install,
            &CancellationToken::new(),
        ))
        .expect("every status was sent");
    }

    /// Installs `program` from one release file served by the local test server, and returns the
    /// program's final status.
    fn install_served(
        folder: &TempDir,
        program: ManagedProgram,
        file: Vec<u8>,
        format: AssetFormat,
    ) -> (InstallContext, ProgramStatus) {
        let ctx = install_context(folder, NO_WAIT);
        let file = served(file);
        let (url, server) = serve(vec![Answer::Body(200, file)]);
        write_program_feed(&ctx, program, pinned_version(program), &url, file, format);
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_program(&ctx, &state, recorder.as_ref(), program);

        assert_eq!(server.join().expect("the server ends"), 1);
        (ctx.clone(), state.status(program))
    }

    /// The files in a program's version folder, by name.
    fn version_folder_names(ctx: &InstallContext, program: ManagedProgram) -> Vec<String> {
        let folder = ctx.dirs.program(program).join(pinned_version(program));
        let Ok(entries) = fs::read_dir(&folder) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .map(|entry| {
                entry
                    .expect("read an entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        names.sort();
        names
    }

    /// Runs the installed program with `--version` and returns what it printed. A run that has not
    /// ended after 30 s is stopped and fails the test: on a loaded Mac a program written a moment
    /// ago has been seen to wait in its start-up, and a test must not hang on that.
    fn program_answer(shim: &Path) -> String {
        let mut child = Command::new(shim)
            .arg("--version")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("the installed program starts");
        let deadline = Instant::now() + Duration::from_secs(30);
        let status = loop {
            if let Some(status) = child.try_wait().expect("read the program's state") {
                break status;
            }
            if Instant::now() >= deadline {
                child.kill().expect("stop the program");
                child.wait().expect("collect the program");
                panic!("{} did not answer --version within 30 s", shim.display());
            }
            thread::sleep(Duration::from_millis(10));
        };
        assert!(status.success(), "the program exited with {status}");
        let mut printed = String::new();
        child
            .stdout
            .take()
            .expect("the program's output")
            .read_to_string(&mut printed)
            .expect("read the program's output");
        printed.trim().to_string()
    }

    #[test]
    fn plat_28_codex_is_unpacked_from_its_zstd_release_file() {
        let folder = TempDir::new();
        let program = b"#!/bin/sh\necho codex-cli 0.164.0\n";

        let (ctx, status) = install_served(
            &folder,
            ManagedProgram::Codex,
            zstd_of(program),
            AssetFormat::Zstd,
        );

        assert_eq!(status.state, ProgramState::Ready, "{:?}", status.error);
        let binary = ctx.dirs.binary(ManagedProgram::Codex, "0.164.0");
        assert_eq!(fs::read(&binary).expect("the program"), program);
        assert_eq!(
            version_folder_names(&ctx, ManagedProgram::Codex),
            vec!["codex".to_string()],
            "the downloaded file is gone"
        );
        let metadata = fs::read_to_string(ctx.dirs.metadata(ManagedProgram::Codex, "0.164.0"))
            .expect("metadata");
        let metadata: serde_json::Value = serde_json::from_str(&metadata).expect("metadata json");
        assert_eq!(
            metadata["sha256"],
            sha_hex(program),
            "the program's own hash"
        );
        assert_eq!(
            program_answer(&ctx.dirs.shim(ManagedProgram::Codex)),
            "codex-cli 0.164.0"
        );
    }

    #[test]
    fn plat_28_a_zstd_file_of_two_frames_unpacks_whole() {
        let folder = TempDir::new();
        let mut file = zstd_of(b"#!/bin/sh\n");
        file.extend(zstd_of(b"echo codex-cli 0.164.0\n"));

        let (ctx, status) = install_served(&folder, ManagedProgram::Codex, file, AssetFormat::Zstd);

        assert_eq!(status.state, ProgramState::Ready, "{:?}", status.error);
        assert_eq!(
            fs::read(ctx.dirs.binary(ManagedProgram::Codex, "0.164.0")).expect("the program"),
            b"#!/bin/sh\necho codex-cli 0.164.0\n"
        );
    }

    #[test]
    fn plat_35_gh_is_unpacked_from_its_zip_and_runs_through_the_bin_folder() {
        let folder = TempDir::new();
        let program = b"#!/bin/sh\necho gh version 2.100.0\n";
        let archive = zip_of(&[
            ("gh_2.100.0_macOS_arm64/LICENSE", b"MIT"),
            ("gh_2.100.0_macOS_arm64/share/man/man1/gh.1", b"manual"),
            ("gh_2.100.0_macOS_arm64/bin/gh", program),
        ]);

        let (ctx, status) = install_served(&folder, ManagedProgram::Gh, archive, AssetFormat::Zip);

        assert_eq!(status.state, ProgramState::Ready, "{:?}", status.error);
        assert_eq!(status.version.as_deref(), Some("2.100.0"));
        let binary = ctx.dirs.binary(ManagedProgram::Gh, "2.100.0");
        assert_eq!(fs::read(&binary).expect("the program"), program);
        assert_eq!(
            fs::read_link(ctx.dirs.bin.join("gh")).expect("the bin shim"),
            binary
        );
        assert_eq!(
            program_answer(&ctx.dirs.bin.join("gh")),
            "gh version 2.100.0"
        );
    }

    #[test]
    fn plat_35_watchexec_is_unpacked_from_its_tar_xz() {
        let folder = TempDir::new();
        let program = b"#!/bin/sh\necho watchexec 2.3.2\n";
        let archive = tar_xz_of(&[
            (
                "watchexec-2.3.2-aarch64-apple-darwin/LICENSE",
                b"Apache-2.0",
            ),
            (
                "watchexec-2.3.2-aarch64-apple-darwin/completions/zsh",
                b"#compdef watchexec",
            ),
            ("watchexec-2.3.2-aarch64-apple-darwin/watchexec", program),
        ]);

        let (ctx, status) = install_served(
            &folder,
            ManagedProgram::Watchexec,
            archive,
            AssetFormat::TarXz,
        );

        assert_eq!(status.state, ProgramState::Ready, "{:?}", status.error);
        assert_eq!(
            fs::read(ctx.dirs.binary(ManagedProgram::Watchexec, "2.3.2")).expect("the program"),
            program
        );
        assert_eq!(
            program_answer(&ctx.dirs.bin.join("watchexec")),
            "watchexec 2.3.2"
        );
    }

    #[test]
    fn plat_35_a_gh_download_with_a_wrong_checksum_leaves_no_file_in_the_bin_folder() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let archive = served(zip_of(&[("gh_2.100.0_macOS_arm64/bin/gh", b"#!/bin/sh\n")]));
        let (url, server) = serve(vec![
            Answer::Body(200, archive),
            Answer::Body(200, archive),
            Answer::Body(200, archive),
        ]);
        write_program_feed(
            &ctx,
            ManagedProgram::Gh,
            "2.100.0",
            &url,
            b"another file",
            AssetFormat::Zip,
        );
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_program(&ctx, &state, recorder.as_ref(), ManagedProgram::Gh);

        assert_eq!(server.join().expect("the server ends"), 3);
        let status = state.status(ManagedProgram::Gh);
        assert_eq!(status.state, ProgramState::Failed);
        assert!(!ctx.dirs.bin.join("gh").exists(), "no gh in the bin folder");
        assert_eq!(
            version_folder_names(&ctx, ManagedProgram::Gh),
            Vec::<String>::new()
        );
    }

    #[test]
    fn plat_28_an_archive_without_the_program_fails_and_leaves_nothing() {
        let folder = TempDir::new();
        let archive = zip_of(&[("gh_2.100.0_macOS_arm64/LICENSE", b"MIT")]);

        let (ctx, status) = install_served(&folder, ManagedProgram::Gh, archive, AssetFormat::Zip);

        assert_eq!(
            status.state,
            ProgramState::Failed,
            "a feed problem is not retried"
        );
        assert!(
            status
                .error
                .as_deref()
                .is_some_and(|error| error.contains("holds no program named gh")),
            "{:?}",
            status.error
        );
        assert_eq!(
            version_folder_names(&ctx, ManagedProgram::Gh),
            Vec::<String>::new(),
            "neither the download nor a half-written program is left"
        );
        assert!(!ctx.dirs.bin.join("gh").exists());
    }

    #[test]
    fn plat_28_an_archive_with_two_files_of_the_program_name_is_refused() {
        let folder = TempDir::new();
        let archive = tar_xz_of(&[
            ("one/watchexec", b"#!/bin/sh\necho one\n"),
            ("two/watchexec", b"#!/bin/sh\necho two\n"),
        ]);

        let (ctx, status) = install_served(
            &folder,
            ManagedProgram::Watchexec,
            archive,
            AssetFormat::TarXz,
        );

        assert_eq!(status.state, ProgramState::Failed);
        assert!(
            status
                .error
                .as_deref()
                .is_some_and(|error| error.contains("more than one file named watchexec")),
            "{:?}",
            status.error
        );
        assert_eq!(
            version_folder_names(&ctx, ManagedProgram::Watchexec),
            Vec::<String>::new()
        );
    }

    // ------------------------------------------------------------ AGENT-09 Cursor's SDK tree

    #[test]
    fn agent_09_the_shipped_feed_pins_cursors_sdk_tree_from_the_npm_registry() {
        let feed = shipped_feed();
        let tree = feed.cursor.expect("the feed offers Cursor's SDK");

        assert_eq!(tree.version, pinned_version(ManagedProgram::Cursor));
        let names: Vec<&str> = tree
            .packages
            .iter()
            .map(|tarball| tarball.name.as_str())
            .collect();
        assert_eq!(
            names,
            vec![
                "@cursor/sdk",
                "@bufbuild/protobuf",
                "@connectrpc/connect",
                "@connectrpc/connect-web",
                "@statsig/js-client",
                "@statsig/client-core",
                "zod",
            ]
        );
        assert_eq!(tree.darwin_arm64[0].name, "@cursor/sdk-darwin-arm64");
        assert_eq!(tree.darwin_x64[0].name, "@cursor/sdk-darwin-x64");
        assert_eq!(
            tree.packages.len() + tree.darwin_arm64.len() + tree.darwin_x64.len(),
            9
        );
        for tarball in tree
            .packages
            .iter()
            .chain(&tree.darwin_arm64)
            .chain(&tree.darwin_x64)
        {
            let url = crate::http::check_url(&tarball.url, crate::http::ALLOWED_HOSTS)
                .unwrap_or_else(|error| panic!("{} is refused: {error}", tarball.url));
            assert_eq!(
                url.host_str(),
                Some("registry.npmjs.org"),
                "{}",
                tarball.url
            );
            assert!(
                tarball.url.ends_with(&format!("-{}.tgz", tarball.version)),
                "{} is the tarball of {} {}",
                tarball.url,
                tarball.name,
                tarball.version
            );
            assert!(tarball.size > 0, "{} has a size", tarball.url);
        }
    }

    /// One npm tarball: every file under `package/`, as the registry serves it.
    fn npm_tarball(files: &[(&str, &[u8], u32)]) -> Vec<u8> {
        use std::io::Write;
        let mut builder = tar::Builder::new(Vec::new());
        for (name, body, mode) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(body.len() as u64);
            header.set_mode(*mode);
            header.set_cksum();
            builder
                .append_data(&mut header, format!("package/{name}"), *body)
                .expect("add a tar entry");
        }
        let tar = builder.into_inner().expect("finish the tar");
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(&tar).expect("compress the tar");
        encoder.finish().expect("finish the gzip")
    }

    fn tarball_entry(name: &str, url: &str, body: &[u8]) -> PackageTarball {
        PackageTarball {
            name: name.to_string(),
            version: "1.0.0".to_string(),
            url: url.to_string(),
            sha256: sha_hex(body),
            size: body.len() as u64,
        }
    }

    /// A feed whose Cursor tree is the SDK and one dependency, plus the native package of this
    /// Mac's CPU, all served from `url` in that order.
    fn write_cursor_feed(ctx: &InstallContext, url: &str, bodies: [&[u8]; 3]) {
        let native = tarball_entry("@cursor/sdk-native", url, bodies[2]);
        let manifest = ReleaseManifest {
            cursor: Some(PackageTreeRelease {
                version: pinned_version(ManagedProgram::Cursor).to_string(),
                packages: vec![
                    tarball_entry("@cursor/sdk", url, bodies[0]),
                    tarball_entry("zod", url, bodies[1]),
                ],
                darwin_arm64: vec![native.clone()],
                darwin_x64: vec![native],
            }),
            ..ReleaseManifest::default()
        };
        fs::create_dir_all(ctx.feed.parent().expect("a feed folder"))
            .expect("make the feed folder");
        fs::write(
            &ctx.feed,
            serde_json::to_string(&manifest).expect("serialise the feed"),
        )
        .expect("write the feed");
    }

    fn cursor_bodies() -> [&'static [u8]; 3] {
        [
            served(npm_tarball(&[
                (
                    "package.json",
                    br#"{"name":"@cursor/sdk","version":"1.3.1"}"#,
                    0o644,
                ),
                ("dist/bundled/index.js", b"export const sdk = 1;", 0o644),
            ])),
            served(npm_tarball(&[("index.js", b"export const z = 1;", 0o644)])),
            served(npm_tarball(&[("bin/rg", b"#!/bin/sh\nexit 0\n", 0o755)])),
        ]
    }

    fn install_cursor(ctx: &InstallContext, state: &ProgramsState, sink: &dyn StatusSink) {
        tauri::async_runtime::block_on(run_install(
            ctx,
            state,
            sink,
            ManagedProgram::Cursor,
            InstallMode::Install,
            &CancellationToken::new(),
        ))
        .expect("every status was sent");
    }

    #[test]
    fn agent_09_installs_cursors_sdk_tree_and_points_current_at_it() {
        use std::os::unix::fs::PermissionsExt;
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let bodies = cursor_bodies();
        let (url, server) = serve(bodies.iter().map(|body| Answer::Body(200, body)).collect());
        write_cursor_feed(&ctx, &url, bodies);
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_cursor(&ctx, &state, recorder.as_ref());

        assert_eq!(server.join().expect("the server ends"), 3);
        assert_eq!(
            recorder.states(ManagedProgram::Cursor),
            vec![
                ProgramState::Downloading,
                ProgramState::Verifying,
                ProgramState::Ready
            ]
        );
        let version = pinned_version(ManagedProgram::Cursor);
        let tree = ctx.dirs.program(ManagedProgram::Cursor).join(version);
        let modules = tree.join("node_modules");
        assert_eq!(
            fs::read_to_string(modules.join("@cursor/sdk/dist/bundled/index.js")).expect("the SDK"),
            "export const sdk = 1;"
        );
        assert!(modules.join("zod/index.js").is_file());
        let rg = modules.join("@cursor/sdk-native/bin/rg");
        let mode = fs::metadata(&rg).expect("ripgrep").permissions().mode();
        assert_eq!(mode & 0o777, 0o755, "ripgrep keeps its execute bit");
        assert_eq!(
            fs::read_link(ctx.dirs.shim(ManagedProgram::Cursor)).expect("the current link"),
            tree
        );
        assert!(
            fs::symlink_metadata(ctx.dirs.bin.join("cursor")).is_err(),
            "the SDK is no program on PATH"
        );
        let ready = recorder.first(ManagedProgram::Cursor, ProgramState::Ready);
        let total: u64 = bodies.iter().map(|body| body.len() as u64).sum();
        assert_eq!(ready.bytes_total, Some(total));
        assert_eq!(
            ready.path.as_deref(),
            Some(
                modules
                    .join("@cursor/sdk/package.json")
                    .to_string_lossy()
                    .as_ref()
            )
        );
        assert!(!ctx.dirs.staging(ManagedProgram::Cursor, version).exists());
        assert!(
            fs::read_dir(modules.join("@cursor/sdk"))
                .expect("the SDK folder")
                .all(|entry| !entry
                    .expect("an entry")
                    .file_name()
                    .to_string_lossy()
                    .ends_with(".tgz")),
            "no tarball is left behind"
        );

        // A second install finds the recorded copy and downloads nothing.
        let (again, _again_arrivals) = Recorder::new();
        install_cursor(&ctx, &state, again.as_ref());
        assert_eq!(
            again.states(ManagedProgram::Cursor),
            vec![ProgramState::Ready]
        );
    }

    #[test]
    fn agent_09_a_tarball_with_a_wrong_checksum_installs_nothing() {
        let folder = TempDir::new();
        let ctx = install_context(
            &folder,
            RetryPolicy {
                attempts: 1,
                first_delay_ms: 0,
            },
        );
        let bodies = cursor_bodies();
        let tampered: &'static [u8] = served(npm_tarball(&[("index.js", b"evil", 0o644)]));
        let (url, server) = serve(vec![
            Answer::Body(200, bodies[0]),
            Answer::Body(200, tampered),
        ]);
        write_cursor_feed(&ctx, &url, bodies);
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        install_cursor(&ctx, &state, recorder.as_ref());

        assert_eq!(server.join().expect("the server ends"), 2);
        let failed = recorder.first(ManagedProgram::Cursor, ProgramState::Failed);
        assert!(
            failed
                .error
                .as_deref()
                .is_some_and(|error| error.contains("checksum") || error.contains("SHA-256")),
            "{failed:?}"
        );
        let program = ctx.dirs.program(ManagedProgram::Cursor);
        let left: Vec<String> = fs::read_dir(&program)
            .map(|entries| {
                entries
                    .map(|entry| {
                        entry
                            .expect("an entry")
                            .file_name()
                            .to_string_lossy()
                            .into_owned()
                    })
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(
            left,
            Vec::<String>::new(),
            "no version, link or staging folder"
        );
    }

    #[test]
    fn agent_09_a_tarball_entry_outside_its_package_is_refused() {
        let folder = TempDir::new();
        let source = folder.path().join("evil.tgz");
        let mut header = tar::Header::new_gnu();
        header.set_size(4);
        header.set_mode(0o644);
        {
            let name = &mut header.as_old_mut().name;
            let path = b"package/../../escaped";
            name[..path.len()].copy_from_slice(path);
        }
        header.set_cksum();
        let mut builder = tar::Builder::new(Vec::new());
        builder
            .append(&header, &b"evil"[..])
            .expect("add the entry");
        let tar = builder.into_inner().expect("finish the tar");
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        std::io::Write::write_all(&mut encoder, &tar).expect("compress");
        fs::write(&source, encoder.finish().expect("finish")).expect("write the tarball");
        let target = folder.folder("modules").join("pkg");

        let refused = unpack_npm_tarball(&source, &target).expect_err("refused");

        assert_eq!(error_code(refused), "program_unpack_failed");
        assert!(!folder.path().join("escaped").exists());
        assert!(!folder.path().join("modules").join("escaped").exists());
    }

    #[test]
    fn agent_09_the_launch_installs_every_program_but_cursors_sdk() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();

        let started = prefetch(&ctx, &state, recorder.clone()).expect("prefetch starts");
        assert_eq!(started.len(), 4, "every program but Cursor's SDK");
        for task in started {
            tauri::async_runtime::block_on(task).expect("the install task ends");
        }

        assert_eq!(recorder.sent(ManagedProgram::Cursor), Vec::new());
        assert_eq!(
            state.status(ManagedProgram::Cursor).state,
            ProgramState::Missing
        );
        for program in [
            ManagedProgram::Claude,
            ManagedProgram::Codex,
            ManagedProgram::Gh,
            ManagedProgram::Watchexec,
        ] {
            assert_eq!(
                recorder.states(program).first(),
                Some(&ProgramState::Queued),
                "{program} starts at launch"
            );
        }
    }

    #[test]
    fn agent_09_removing_cursors_sdk_trashes_its_tree_and_its_link() {
        let folder = TempDir::new();
        let ctx = install_context(&folder, NO_WAIT);
        let bodies = cursor_bodies();
        let (url, server) = serve(bodies.iter().map(|body| Answer::Body(200, body)).collect());
        write_cursor_feed(&ctx, &url, bodies);
        let (recorder, _arrivals) = Recorder::new();
        let state = ProgramsState::default();
        install_cursor(&ctx, &state, recorder.as_ref());
        server.join().expect("the server ends");

        tauri::async_runtime::block_on(remove_program(
            &ctx,
            &state,
            recorder.as_ref(),
            ManagedProgram::Cursor,
        ))
        .expect("removed");

        assert!(!ctx.dirs.program(ManagedProgram::Cursor).exists());
        assert!(folder.path().join("trash").join("cursor").is_dir());
        assert_eq!(
            state.status(ManagedProgram::Cursor).state,
            ProgramState::Missing
        );
    }

    #[test]
    fn plat_35_the_program_state_lists_gh_and_watchexec_beside_the_agents() {
        let statuses = ProgramsState::default().snapshot();

        assert_eq!(
            statuses
                .iter()
                .map(|status| status.program)
                .collect::<Vec<_>>(),
            ManagedProgram::ALL.to_vec()
        );
    }

    fn no_trash(_: &Path) -> CommandResult<()> {
        Ok(())
    }

    #[test]
    fn set_13_with_no_chosen_paths_is_refused_and_writes_nothing() {
        let folder = TempDir::new();
        let data = folder.folder("data");

        let error = stage_path_overrides(&data, &HashMap::new(), &no_trash)
            .expect_err("nothing chosen has no shim folder");

        assert_eq!(error_code(error), "path_override_none");
        assert!(!data.join("bin-overrides").exists());
    }

    #[test]
    fn set_13_writes_a_link_for_each_chosen_program() {
        let folder = TempDir::new();
        let data = folder.folder("data");
        let claude = write_script(folder.path(), "my-claude", "exit 0");
        let codex = write_script(folder.path(), "my-codex", "exit 0");
        let overrides = HashMap::from([
            ("claude".to_string(), claude.to_string_lossy().into_owned()),
            ("codex".to_string(), codex.to_string_lossy().into_owned()),
        ]);

        let returned = stage_path_overrides(&data, &overrides, &no_trash).expect("the shim folder");
        let expected_parent = data.join("bin-overrides");

        assert_eq!(returned.parent(), Some(expected_parent.as_path()));
        let hash = returned
            .file_name()
            .and_then(|name| name.to_str())
            .expect("the folder has a name");
        assert_eq!(hash.len(), 16, "the folder name is a 16-hex hash");
        assert!(hash.chars().all(|character| character.is_ascii_hexdigit()));
        assert_eq!(
            fs::read_link(returned.join("claude")).expect("the claude link"),
            claude
        );
        assert_eq!(
            fs::read_link(returned.join("codex")).expect("the codex link"),
            codex
        );
    }

    #[test]
    fn set_13_the_same_paths_reuse_one_shim_folder() {
        let folder = TempDir::new();
        let data = folder.folder("data");
        let claude = write_script(folder.path(), "my-claude", "exit 0");
        let overrides =
            HashMap::from([("claude".to_string(), claude.to_string_lossy().into_owned())]);

        let first = stage_path_overrides(&data, &overrides, &no_trash).expect("the first sync");
        let second = stage_path_overrides(&data, &overrides, &no_trash).expect("the second sync");

        assert_eq!(first, second);
    }

    #[test]
    fn set_13_a_missing_program_path_is_refused() {
        let folder = TempDir::new();
        let data = folder.folder("data");
        let missing = folder.path().join("no-such-claude");
        let overrides =
            HashMap::from([("claude".to_string(), missing.to_string_lossy().into_owned())]);

        let error = stage_path_overrides(&data, &overrides, &no_trash)
            .expect_err("a missing path cannot be used");

        assert_eq!(error_code(error), "path_override_invalid");
        assert!(
            !data.join("bin-overrides").exists(),
            "nothing is written for a path that cannot run"
        );
    }

    #[test]
    fn set_13_a_program_the_app_does_not_manage_is_refused() {
        let folder = TempDir::new();
        let data = folder.folder("data");
        let program = write_script(folder.path(), "something", "exit 0");
        let overrides = HashMap::from([(
            "something".to_string(),
            program.to_string_lossy().into_owned(),
        )]);

        let error = stage_path_overrides(&data, &overrides, &no_trash)
            .expect_err("the name is not a managed agent");

        assert_eq!(error_code(error), "path_override_unknown_program");
    }

    #[test]
    fn set_13_a_changed_path_replaces_the_old_shim_folder() {
        let folder = TempDir::new();
        let data = folder.folder("data");
        let first_claude = write_script(folder.path(), "first-claude", "exit 0");
        let second_claude = write_script(folder.path(), "second-claude", "exit 0");
        let trashed: Arc<Mutex<Vec<PathBuf>>> = Arc::new(Mutex::new(Vec::new()));
        let record = Arc::clone(&trashed);
        let trash = move |path: &Path| {
            record
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(path.to_path_buf());
            Ok(())
        };
        let first = stage_path_overrides(
            &data,
            &HashMap::from([(
                "claude".to_string(),
                first_claude.to_string_lossy().into_owned(),
            )]),
            &trash,
        )
        .expect("the first shim folder");
        let second = stage_path_overrides(
            &data,
            &HashMap::from([(
                "claude".to_string(),
                second_claude.to_string_lossy().into_owned(),
            )]),
            &trash,
        )
        .expect("the second shim folder");

        assert_ne!(first, second);
        assert_eq!(
            fs::read_link(second.join("claude")).expect("the new link"),
            second_claude
        );
        assert_eq!(
            *trashed.lock().unwrap_or_else(PoisonError::into_inner),
            vec![first]
        );
    }
}
