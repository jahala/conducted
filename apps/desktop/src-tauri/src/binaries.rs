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

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::AppHandle;

use crate::error::CommandResult;
use crate::not_implemented;

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
