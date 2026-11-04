//! @feature PLAT-05 Files: atomic write, trash, stat, read dir
//!
//! Owns: the file operations the webview cannot do safely on its own: atomic writes, moving to
//! the Trash, stat with symlink information, directory listing and the well-known paths.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`write_file_async`,
//! `get_file_metadata`) and services-map.md 1.1 (`fs`: atomic write is a temp file plus rename,
//! `exists`, `mkdir`, `remove`, `readDir`, and the paths appData, home, temp, resource).
//!
//! Must handle:
//! - Atomic write: write a temp file in the same directory, fsync it, rename over the target.
//!   A crash leaves either the old file or the new one, never half of one. The temp file is
//!   removed if any step fails. The target's permission bits are kept.
//! - Writing through a symlink replaces the file the link points to, not the link.
//! - `fs_stat` returns `None` for a missing path and an error for any other failure, so the UI
//!   can build both `exists` and `stat` from it.
//! - `fs_read_text` fails with `fs_not_utf8` for binary files and never returns replacement text.
//! - `fs_read_dir` does not follow symlinks and reports a broken link as `is_symlink` with size 0.
//! - `fs_trash` moves to the macOS Trash and never deletes for good. A missing path is an error.
//! - Paths must be absolute. Relative paths fail with `fs_relative_path`.
//!
//! Our design choice: `fs_stat` returns an optional value instead of failing on a missing path.
//!
//! Test first: `fs_write_text_atomic` over an existing file, interrupted between the temp write
//! and the rename, leaves the old content readable and no temp file behind.

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{CommandError, CommandResult};
use crate::not_implemented;

/// File facts. Mirrors `FileStat` in `apps/desktop/src/platform/platform.ts`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    /// Absolute path as given.
    pub path: String,
    pub is_directory: bool,
    /// True when the path itself is a symlink. The other fields describe the link target.
    pub is_symlink: bool,
    /// Size in bytes. 0 for directories.
    pub size: u64,
    /// Last modification, in milliseconds since the Unix epoch.
    pub modified_at: i64,
}

/// Well-known folders. Mirrors `FileSystem.paths` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsPaths {
    pub home: String,
    /// App data folder (`~/Library/Application Support/<bundle id>`).
    pub app_data: String,
    pub temp: String,
    /// Folder holding bundled resources such as `bin/`.
    pub resources: String,
}

/// Reads a whole file as UTF-8 text.
#[tauri::command]
#[allow(unused_variables)]
pub async fn fs_read_text(path: String) -> CommandResult<String> {
    not_implemented!("PLAT-05")
}

/// Writes text through a temp file and a rename.
#[tauri::command]
#[allow(unused_variables)]
pub async fn fs_write_text_atomic(path: String, text: String) -> CommandResult<()> {
    not_implemented!("PLAT-05")
}

/// Returns facts about a path, or `None` when it does not exist.
#[tauri::command]
#[allow(unused_variables)]
pub async fn fs_stat(path: String) -> CommandResult<Option<FileStat>> {
    not_implemented!("PLAT-05")
}

/// Creates a folder and any missing parents. Succeeds when it already exists.
#[tauri::command]
#[allow(unused_variables)]
pub async fn fs_mkdirp(path: String) -> CommandResult<()> {
    not_implemented!("PLAT-05")
}

/// Lists the direct children of a folder.
#[tauri::command]
#[allow(unused_variables)]
pub async fn fs_read_dir(path: String) -> CommandResult<Vec<FileStat>> {
    not_implemented!("PLAT-05")
}

/// Moves a file or folder to the Trash.
#[tauri::command]
#[allow(unused_variables)]
pub async fn fs_trash(path: String) -> CommandResult<()> {
    not_implemented!("PLAT-05")
}

/// Returns the well-known folders. The UI reads this once at startup.
#[tauri::command]
pub async fn fs_paths(app: AppHandle) -> CommandResult<FsPaths> {
    let resolver = app.path();
    let to_error = |e: tauri::Error| CommandError::Failed {
        code: "fs_path_unavailable",
        message: e.to_string(),
    };
    let text = |p: std::path::PathBuf| p.to_string_lossy().into_owned();
    Ok(FsPaths {
        home: text(resolver.home_dir().map_err(to_error)?),
        app_data: text(resolver.app_data_dir().map_err(to_error)?),
        temp: text(resolver.temp_dir().map_err(to_error)?),
        resources: text(resolver.resource_dir().map_err(to_error)?),
    })
}
