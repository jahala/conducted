//! @feature PLAT-05 Files: atomic write, trash, stat, read dir
//! @feature PLAT-29 Limit the paths, programs and links the webview can reach
//!
//! Owns: the file operations the webview cannot do safely on its own: atomic writes, moving to
//! the Trash, stat with symlink information, directory listing and the well-known paths.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`write_file_async`,
//! `get_file_metadata`) and services-map.md 1.1 (`fs`: atomic write is a temp file plus rename,
//! `exists`, `mkdir`, `remove`, `readDir`, and the paths appData, home, temp, resource).
//!
//! Must handle:
//! - Atomic write: write a temp file in the same directory, fsync it, rename over the target, then
//!   fsync the parent folder. A crash leaves either the old file or the new one, never half of one.
//!   A crash between the temp write and the rename can leave a hidden `.name.tmp-<pid>-<n>` file
//!   beside the target; a later write does not remove it. The temp file is removed if any step
//!   fails. The target's permission bits are kept.
//! - Writing through a symlink replaces the file the link points to, not the link.
//! - `fs_stat` returns `None` for a missing path and an error for any other failure of the path
//!   itself; a link whose target cannot be read is a broken link with size 0, so the UI can build
//!   both `exists` and `stat` from it.
//! - `fs_read_text` fails with `fs_not_utf8` for binary files and never returns replacement text.
//! - `fs_read_dir` does not follow symlinks and reports a link whose target cannot be read (a
//!   missing target or a loop) as `is_symlink` with size 0, so one bad entry cannot fail the
//!   listing.
//! - `fs_trash` moves to the macOS Trash and never deletes for good. A missing path is an error.
//! - Paths must be absolute. Relative paths fail with `fs_relative_path`.
//! - `fs_read_text` refuses a file larger than `MAX_READ_BYTES`, so a huge file cannot exhaust the
//!   app's memory.
//!
//! Scope (PLAT-29, native-and-sidecar-map.md A3): every `fs_*` command first calls
//! `check_path_in_scope` with the roots `allowed_roots` builds:
//! - The app data folder, the resource folder and the temp folder.
//! - The user's `~/.claude.json`, `~/.claude/`, `~/.conducted/` and Claude Desktop's
//!   `claude_desktop_config.json`.
//! - The default workspaces folder, `~/conducted/`.
//! - The check resolves symlinks and `..` first, so a link inside a root cannot lead out of it.
//! - A path outside every root fails with `fs_out_of_scope` and names the path.
//! - The roots are a parameter, so a caller with a workspace outside the default folder can pass
//!   its own list. The `fs_*` commands use `allowed_roots` until the UI registers its workspaces.
//!
//! Our design choice: the web view's file scope covers the folders the UI already uses, not all of
//! the home folder. A workspace the user keeps outside `~/conducted` needs its root registered; no
//! command does that yet, and the UI's workspace list would have to call one.
//!
//! Our design choice: `capabilities/default.json` drops the broad plugin defaults. The UI calls
//! the app's own file and shell commands, so the file-system and shell plugins are not granted.
//! The opener is limited to web, mail, telephone and the IDE and chat schemes in the research.
//!
//! Our design choice: `fs_stat` returns an optional value instead of failing on a missing path.
//! `fs_trash` uses the Trash of the volume the item lives on, and picks "name 2.ext" when a
//! same-named item is already there, so nothing is overwritten. The move is a rename (on macOS
//! `renamex_np` with `RENAME_EXCL`), so Finder records no "Put Back" location for it.
//!
//! Test first: `fs_write_text_atomic` over an existing file, interrupted between the temp write
//! and the rename, leaves the old content readable and no temp file behind.

use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::error::{CommandError, CommandResult};

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn renamex_np(
        from: *const std::os::raw::c_char,
        to: *const std::os::raw::c_char,
        flags: std::os::raw::c_uint,
    ) -> std::os::raw::c_int;
}

/// macOS flag that makes `renamex_np` fail instead of replacing an existing path.
#[cfg(target_os = "macos")]
const RENAME_EXCL: std::os::raw::c_uint = 0x4;

/// Largest file `fs_read_text` will load.
pub const MAX_READ_BYTES: u64 = 64 * 1024 * 1024;

/// How many symbolic links one scope check follows before giving up.
const MAX_LINK_HOPS: usize = 40;

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

/// Resolves `path` and checks that it lies inside one of `roots`. Returns the resolved path.
pub fn check_path_in_scope(path: &str, roots: &[PathBuf]) -> CommandResult<PathBuf> {
    let absolute = absolute_path(path)?;
    let resolved = resolve_for_scope(&absolute).map_err(|error| CommandError::Failed {
        code: "fs_scope_failed",
        message: format!("Could not resolve {}: {error}", absolute.display()),
    })?;
    let inside = roots
        .iter()
        .any(|root| is_within(&resolved, &root_for_compare(root)));
    if inside {
        return Ok(resolved);
    }
    Err(CommandError::Failed {
        code: "fs_out_of_scope",
        message: format!(
            "Path is outside the folders this window may reach: {}",
            absolute.display()
        ),
    })
}

/// Resolves every symlink and `..` in `path`. A path that does not exist yet is resolved from its
/// deepest existing ancestor, so a write or a new folder can be checked before it exists.
fn resolve_for_scope(path: &Path) -> io::Result<PathBuf> {
    match fs::canonicalize(path) {
        Ok(resolved) => return Ok(resolved),
        Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error),
        Err(_) => {}
    }
    let mut missing: Vec<OsString> = Vec::new();
    let mut current = path.to_path_buf();
    for _ in 0..MAX_LINK_HOPS {
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                let target = fs::read_link(&current)?;
                current = if target.is_absolute() {
                    target
                } else {
                    current
                        .parent()
                        .unwrap_or_else(|| Path::new("/"))
                        .join(target)
                };
            }
            Ok(_) => {
                let mut resolved = fs::canonicalize(&current)?;
                append_missing(&mut resolved, &missing);
                return Ok(resolved);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let Some(name) = current.file_name().map(|name| name.to_os_string()) else {
                    return Ok(normalise_lexically(path));
                };
                missing.push(name);
                let Some(parent) = current.parent() else {
                    return Ok(normalise_lexically(path));
                };
                current = parent.to_path_buf();
            }
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::other("too many symbolic links"))
}

/// Appends the names that do not exist yet, resolving `.` and `..` without following links that
/// are not there.
fn append_missing(base: &mut PathBuf, missing: &[OsString]) {
    for part in missing.iter().rev() {
        match part.to_str() {
            Some(".") => {}
            Some("..") => {
                base.pop();
            }
            _ => base.push(part),
        }
    }
}

/// Resolves `.` and `..` without touching the file system.
fn normalise_lexically(path: &Path) -> PathBuf {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved
}

/// Canonicalises a root when it exists, so a link in the root itself cannot hide a match.
fn root_for_compare(root: &Path) -> PathBuf {
    match fs::canonicalize(root) {
        Ok(resolved) => resolved,
        // A root that does not exist yet is compared as written. Nothing can be read under it
        // until it is created, and a later check canonicalises it.
        Err(_) => normalise_lexically(root),
    }
}

/// True when `path` is `root` itself or lies below it. Components are compared, so `~/.claude`
/// does not match `~/.claude-other`.
fn is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

/// The roots the web view may reach without a further registration: the folders Tauri owns, the
/// Claude configuration files, the app's own settings folder, and the default workspaces folder.
pub fn allowed_roots(app: &AppHandle) -> CommandResult<Vec<PathBuf>> {
    let resolver = app.path();
    let to_error = |error: tauri::Error| CommandError::Failed {
        code: "fs_scope_failed",
        message: error.to_string(),
    };
    let home = home_dir()?;
    let mut roots = vec![
        resolver.app_data_dir().map_err(to_error)?,
        resolver.temp_dir().map_err(to_error)?,
        resolver.resource_dir().map_err(to_error)?,
    ];
    roots.extend(home_roots(&home));
    roots.sort();
    roots.dedup();
    Ok(roots)
}

/// The home-folder roots: the Claude configuration the UI imports and the folders the app owns.
fn home_roots(home: &Path) -> Vec<PathBuf> {
    vec![
        home.join(".claude.json"),
        home.join(".claude"),
        home.join(".conducted"),
        home.join("Library")
            .join("Application Support")
            .join("Claude")
            .join("claude_desktop_config.json"),
        home.join("conducted"),
    ]
}

/// Runs a blocking file operation off the async runtime.
async fn blocking<T, F>(work: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CommandResult<T> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(result) => result,
        Err(error) => Err(CommandError::Failed {
            code: "fs_task_failed",
            message: error.to_string(),
        }),
    }
}

/// Rejects a relative path, so a command can never resolve one against the process folder.
fn absolute_path(path: &str) -> CommandResult<PathBuf> {
    let path = PathBuf::from(path);
    if path.is_absolute() {
        Ok(path)
    } else {
        Err(CommandError::Failed {
            code: "fs_relative_path",
            message: format!("Path must be absolute: {}", path.display()),
        })
    }
}

/// Modification time in milliseconds since the Unix epoch, or 0 when unknown.
fn modified_ms(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Facts about one path, or `None` when it does not exist.
fn stat_at(path: &Path) -> io::Result<Option<FileStat>> {
    let link = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let is_symlink = link.file_type().is_symlink();
    let (target, size) = if is_symlink {
        match fs::metadata(path) {
            Ok(target) => {
                let size = if target.is_dir() { 0 } else { target.len() };
                (target, size)
            }
            // A link whose target cannot be read (missing, loop or no permission) has nothing to
            // describe, so it is reported as a broken link instead of failing the whole listing.
            Err(_) => (link, 0),
        }
    } else {
        let size = if link.is_dir() { 0 } else { link.len() };
        (link, size)
    };
    Ok(Some(FileStat {
        path: path.to_string_lossy().into_owned(),
        is_directory: target.is_dir(),
        is_symlink,
        size,
        modified_at: modified_ms(&target),
    }))
}

fn read_text_at(path: &Path) -> CommandResult<String> {
    let bytes = fs::read(path)?;
    String::from_utf8(bytes).map_err(|_| CommandError::Failed {
        code: "fs_not_utf8",
        message: format!("File is not UTF-8 text: {}", path.display()),
    })
}

/// Reads a file as text, refusing one over `MAX_READ_BYTES` before it is loaded.
fn read_text_limited(path: &Path) -> CommandResult<String> {
    let metadata = fs::metadata(path)?;
    if metadata.len() > MAX_READ_BYTES {
        return Err(CommandError::Failed {
            code: "fs_file_too_large",
            message: format!(
                "File is larger than {MAX_READ_BYTES} bytes: {}",
                path.display()
            ),
        });
    }
    read_text_at(path)
}

/// Follows a symlink chain to the file a write should replace, so the link itself stays.
fn write_target(path: &Path) -> PathBuf {
    let mut current = path.to_path_buf();
    for _ in 0..40 {
        let metadata = match fs::symlink_metadata(&current) {
            Ok(metadata) => metadata,
            Err(_) => return current,
        };
        if !metadata.file_type().is_symlink() {
            return current;
        }
        let link = match fs::read_link(&current) {
            Ok(link) => link,
            Err(_) => return current,
        };
        current = if link.is_absolute() {
            link
        } else {
            current
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(link)
        };
    }
    current
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A hidden, unique temp path beside `target`, so the rename stays on one volume.
fn temp_path_for(target: &Path) -> CommandResult<PathBuf> {
    let parent = target
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| CommandError::Failed {
            code: "fs_bad_path",
            message: format!("Cannot write to {}", target.display()),
        })?;
    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".to_string());
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(".{name}.tmp-{}-{counter}", std::process::id())))
}

/// Renames one path over another. A named wrapper keeps the signature free of lifetime
/// parameters, so it fits the higher-ranked `FnOnce` below (`fs::rename` itself is generic over
/// both paths and does not).
fn rename_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

/// Flushes the folder entry so a rename survives a crash.
#[cfg(unix)]
fn sync_parent(target: &Path) -> io::Result<()> {
    match target.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => fs::File::open(parent)?.sync_all(),
        _ => Ok(()),
    }
}

#[cfg(not(unix))]
fn sync_parent(_target: &Path) -> io::Result<()> {
    Ok(())
}

/// Writes through a temp file, then renames it over the target. The rename is a parameter so a
/// test can stop between the write and the rename and prove the old file survives.
fn write_text_atomic_with<F>(path: &Path, text: &str, rename: F) -> CommandResult<()>
where
    F: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let target = write_target(path);
    let permissions = fs::metadata(&target)
        .ok()
        .map(|metadata| metadata.permissions());
    let temp = temp_path_for(&target)?;
    let result = (|| -> io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        drop(file);
        if let Some(permissions) = permissions {
            fs::set_permissions(&temp, permissions)?;
        }
        rename(&temp, &target)?;
        sync_parent(&target)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(CommandError::from)
}

fn read_dir_at(path: &Path) -> CommandResult<Vec<FileStat>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(path)? {
        let child = entry?.path();
        // A child removed between the listing and the stat is simply not listed.
        if let Some(stat) = stat_at(&child)? {
            entries.push(stat);
        }
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(entries)
}

fn home_dir() -> CommandResult<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| CommandError::Failed {
            code: "fs_no_home",
            message: "Cannot find the home folder".to_string(),
        })
}

/// Picks the Trash folder from the device comparison, so the choice can be tested without a
/// second volume.
#[cfg(unix)]
fn trash_dir_in(device: u64, root_device: u64, mount: &Path, home: &Path, uid: u32) -> PathBuf {
    if device == root_device {
        home.join(".Trash")
    } else {
        mount.join(".Trashes").join(uid.to_string())
    }
}

/// The Trash folder of the volume that holds `path`.
#[cfg(unix)]
fn trash_dir_for(path: &Path) -> CommandResult<PathBuf> {
    use std::os::unix::fs::MetadataExt;

    // A missing path is an error, as is a path whose volume cannot be read.
    let device = fs::symlink_metadata(path)?.dev();
    let mut mount = path.to_path_buf();
    let mut probe = path.parent();
    while let Some(parent) = probe {
        match fs::metadata(parent) {
            Ok(metadata) if metadata.dev() == device => {
                mount = parent.to_path_buf();
                probe = parent.parent();
            }
            _ => break,
        }
    }
    let home = home_dir()?;
    let root_device = fs::metadata("/")?.dev();
    let uid = fs::metadata(&home)?.uid();
    Ok(trash_dir_in(device, root_device, &mount, &home, uid))
}

/// Renames `from` to `to` and fails when `to` already exists, so nothing is overwritten. The
/// exclusive rename closes the race between picking a free name and moving the item into it.
#[cfg(target_os = "macos")]
fn rename_exclusive(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let from_c = CString::new(from.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains a null byte"))?;
    let to_c = CString::new(to.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "path contains a null byte"))?;
    // SAFETY: both pointers are valid NUL-terminated strings that outlive the call.
    let result = unsafe { renamex_np(from_c.as_ptr(), to_c.as_ptr(), RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

/// Refuses to overwrite by checking first. The check and the rename are separate steps, so this
/// fallback is only for platforms the app does not ship on.
#[cfg(not(target_os = "macos"))]
fn rename_exclusive(from: &Path, to: &Path) -> io::Result<()> {
    if fs::symlink_metadata(to).is_ok() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("Refusing to replace {}", to.display()),
        ));
    }
    fs::rename(from, to)
}

/// "name.ext" becomes ("name", "ext"); a leading dot is part of the name.
fn split_name(name: &str) -> (&str, &str) {
    match name.rfind('.') {
        Some(index) if index > 0 => (&name[..index], &name[index + 1..]),
        _ => (name, ""),
    }
}

/// Moves `path` into `trash`, adding " 2", " 3" and so on rather than overwriting an item.
fn trash_into(path: &Path, trash: &Path) -> CommandResult<()> {
    use std::os::unix::fs::PermissionsExt;

    // A missing source is an error and must not create anything.
    fs::symlink_metadata(path)?;
    let existed = trash.is_dir();
    fs::create_dir_all(trash)?;
    if !existed {
        let _ = fs::set_permissions(trash, fs::Permissions::from_mode(0o700));
    }
    let name = path.file_name().ok_or_else(|| CommandError::Failed {
        code: "fs_bad_path",
        message: format!("Cannot move {} to the Trash", path.display()),
    })?;
    let file_name = name.to_string_lossy();
    let (stem, extension) = split_name(&file_name);
    let mut number = 1u64;
    loop {
        let candidate = if number == 1 {
            trash.join(name)
        } else if extension.is_empty() {
            trash.join(format!("{stem} {number}"))
        } else {
            trash.join(format!("{stem} {number}.{extension}"))
        };
        match rename_exclusive(path, &candidate) {
            Ok(()) => return Ok(()),
            // Another move took the name between our choice and the rename. Try the next one.
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                number += 1;
            }
            Err(error) => return Err(error.into()),
        }
    }
}

/// Checks the path against the roots, then returns it as written. The check follows links, so a
/// link that leaves a root is refused even though the operation keeps the link's own path.
fn checked_target(path: &str, roots: &[PathBuf]) -> CommandResult<PathBuf> {
    check_path_in_scope(path, roots)?;
    absolute_path(path)
}

/// Read a text file after the scope check.
async fn read_text_checked(path: String, roots: Vec<PathBuf>) -> CommandResult<String> {
    blocking(move || {
        let path = checked_target(&path, &roots)?;
        read_text_limited(&path)
    })
    .await
}

/// Write text atomically after the scope check.
async fn write_text_atomic_checked(
    path: String,
    text: String,
    roots: Vec<PathBuf>,
) -> CommandResult<()> {
    blocking(move || {
        let path = checked_target(&path, &roots)?;
        write_text_atomic_with(&path, &text, rename_file)
    })
    .await
}

/// Read facts about a path after the scope check.
async fn stat_checked(path: String, roots: Vec<PathBuf>) -> CommandResult<Option<FileStat>> {
    blocking(move || {
        let path = checked_target(&path, &roots)?;
        Ok(stat_at(&path)?)
    })
    .await
}

/// Create a folder after the scope check.
async fn mkdirp_checked(path: String, roots: Vec<PathBuf>) -> CommandResult<()> {
    blocking(move || {
        let path = checked_target(&path, &roots)?;
        fs::create_dir_all(path)?;
        Ok(())
    })
    .await
}

/// List a folder after the scope check.
async fn read_dir_checked(path: String, roots: Vec<PathBuf>) -> CommandResult<Vec<FileStat>> {
    blocking(move || {
        let path = checked_target(&path, &roots)?;
        read_dir_at(&path)
    })
    .await
}

/// Move a path to the Trash after the scope check.
async fn trash_checked(path: String, roots: Vec<PathBuf>) -> CommandResult<()> {
    blocking(move || {
        let path = checked_target(&path, &roots)?;
        let trash = trash_dir_for(&path)?;
        trash_into(&path, &trash)
    })
    .await
}

/// Reads a whole file as UTF-8 text.
#[tauri::command]
pub async fn fs_read_text(app: AppHandle, path: String) -> CommandResult<String> {
    read_text_checked(path, allowed_roots(&app)?).await
}

/// Writes text through a temp file and a rename.
#[tauri::command]
pub async fn fs_write_text_atomic(app: AppHandle, path: String, text: String) -> CommandResult<()> {
    write_text_atomic_checked(path, text, allowed_roots(&app)?).await
}

/// Returns facts about a path, or `None` when it does not exist.
#[tauri::command]
pub async fn fs_stat(app: AppHandle, path: String) -> CommandResult<Option<FileStat>> {
    stat_checked(path, allowed_roots(&app)?).await
}

/// Creates a folder and any missing parents. Succeeds when it already exists.
#[tauri::command]
pub async fn fs_mkdirp(app: AppHandle, path: String) -> CommandResult<()> {
    mkdirp_checked(path, allowed_roots(&app)?).await
}

/// Lists the direct children of a folder.
#[tauri::command]
pub async fn fs_read_dir(app: AppHandle, path: String) -> CommandResult<Vec<FileStat>> {
    read_dir_checked(path, allowed_roots(&app)?).await
}

/// Moves a file or folder to the Trash.
#[tauri::command]
pub async fn fs_trash(app: AppHandle, path: String) -> CommandResult<()> {
    trash_checked(path, allowed_roots(&app)?).await
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{PermissionsExt, symlink};
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
                "conducted-plat-05-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test folder");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn as_string(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn plat_05_write_text_atomic_keeps_old_content_when_rename_fails() {
        let folder = TempDir::new();
        let path = folder.path().join("file.txt");
        fs::write(&path, "old").expect("seed old file");

        let result = write_text_atomic_with(&path, "new", |_from, _to| {
            Err(io::Error::other("interrupted before the rename"))
        });

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).expect("old file"), "old");
        let names: Vec<String> = fs::read_dir(folder.path())
            .expect("list folder")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["file.txt".to_string()], "no temp file is left");
    }

    #[test]
    fn plat_05_write_text_atomic_writes_and_reads_back() {
        let folder = TempDir::new();
        let path = as_string(&folder.path().join("note.txt"));
        let roots = vec![folder.path().to_path_buf()];

        tauri::async_runtime::block_on(write_text_atomic_checked(
            path.clone(),
            "hello".to_string(),
            roots.clone(),
        ))
        .expect("write");

        assert_eq!(
            tauri::async_runtime::block_on(read_text_checked(path, roots)).expect("read"),
            "hello"
        );
    }

    #[test]
    fn plat_05_write_text_atomic_keeps_permission_bits() {
        let folder = TempDir::new();
        let path = folder.path().join("script.sh");
        fs::write(&path, "old").expect("seed file");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).expect("set mode");

        write_text_atomic_with(&path, "new", rename_file).expect("write");

        let mode = fs::metadata(&path).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode, 0o640);
        assert_eq!(fs::read_to_string(&path).expect("content"), "new");
    }

    #[test]
    fn plat_05_write_text_atomic_follows_symlink() {
        let folder = TempDir::new();
        let target = folder.path().join("target.txt");
        let link = folder.path().join("link.txt");
        fs::write(&target, "old").expect("seed target");
        symlink(&target, &link).expect("make link");

        write_text_atomic_with(&link, "new", rename_file).expect("write through link");

        assert!(
            fs::symlink_metadata(&link)
                .expect("link")
                .file_type()
                .is_symlink()
        );
        assert_eq!(fs::read_to_string(&target).expect("target"), "new");
        assert_eq!(fs::read_to_string(&link).expect("link"), "new");
    }

    #[test]
    fn plat_05_read_text_rejects_non_utf8() {
        let folder = TempDir::new();
        let path = folder.path().join("binary.bin");
        fs::write(&path, [0xff, 0xfe]).expect("seed binary");

        let error = read_text_at(&path).expect_err("binary is not text");

        assert!(matches!(
            error,
            CommandError::Failed {
                code: "fs_not_utf8",
                ..
            }
        ));
    }

    #[test]
    fn plat_05_stat_returns_none_for_missing() {
        let folder = TempDir::new();
        let stat = stat_at(&folder.path().join("missing.txt")).expect("stat");
        assert!(stat.is_none());
    }

    #[test]
    fn plat_05_stat_reports_size_symlink_and_time() {
        let folder = TempDir::new();
        let file = folder.path().join("hello.txt");
        let link = folder.path().join("hello-link");
        let broken = folder.path().join("broken-link");
        fs::write(&file, "hello").expect("seed file");
        symlink(&file, &link).expect("make link");
        symlink(folder.path().join("missing.txt"), &broken).expect("make broken link");

        let direct = stat_at(&file).expect("stat").expect("file exists");
        assert!(!direct.is_directory);
        assert!(!direct.is_symlink);
        assert_eq!(direct.size, 5);
        assert!(direct.modified_at > 0);

        let through = stat_at(&link).expect("stat").expect("link exists");
        assert!(through.is_symlink);
        assert_eq!(through.size, 5);

        let dangling = stat_at(&broken).expect("stat").expect("link exists");
        assert!(dangling.is_symlink);
        assert_eq!(dangling.size, 0);
        assert!(!dangling.is_directory);
    }

    #[test]
    fn plat_05_relative_paths_fail() {
        let folder = TempDir::new();
        let error = tauri::async_runtime::block_on(read_text_checked(
            "relative.txt".to_string(),
            vec![folder.path().to_path_buf()],
        ))
        .expect_err("relative path is refused");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "fs_relative_path",
                ..
            }
        ));
    }

    #[test]
    fn plat_05_mkdirp_creates_parents_and_accepts_existing() {
        let folder = TempDir::new();
        let nested = as_string(&folder.path().join("a/b/c"));
        let roots = vec![folder.path().to_path_buf()];

        tauri::async_runtime::block_on(mkdirp_checked(nested.clone(), roots.clone()))
            .expect("create");
        tauri::async_runtime::block_on(mkdirp_checked(nested, roots)).expect("already exists");

        assert!(folder.path().join("a/b/c").is_dir());
    }

    #[test]
    fn plat_05_read_dir_lists_direct_children() {
        let folder = TempDir::new();
        let root = folder.path();
        fs::write(root.join("a.txt"), "contents").expect("seed file");
        fs::create_dir(root.join("sub")).expect("seed folder");
        fs::write(root.join("sub/inside.txt"), "x").expect("seed nested file");
        symlink(root.join("sub"), root.join("link")).expect("make link");
        symlink(root.join("missing"), root.join("broken")).expect("make broken link");

        let entries = read_dir_at(root).expect("list");
        let names: Vec<&str> = entries
            .iter()
            .map(|entry| {
                Path::new(&entry.path)
                    .file_name()
                    .expect("name")
                    .to_str()
                    .expect("utf8")
            })
            .collect();

        assert_eq!(names, vec!["a.txt", "broken", "link", "sub"]);
        let file = entries
            .iter()
            .find(|entry| entry.path.ends_with("a.txt"))
            .expect("file");
        assert_eq!(file.size, 8);
        let link = entries
            .iter()
            .find(|entry| entry.path.ends_with("link"))
            .expect("link");
        assert!(link.is_symlink && link.is_directory);
        let broken = entries
            .iter()
            .find(|entry| entry.path.ends_with("broken"))
            .expect("broken");
        assert!(broken.is_symlink && !broken.is_directory && broken.size == 0);
    }

    #[test]
    fn plat_05_read_dir_lists_a_symlink_loop_as_a_broken_link() {
        let folder = TempDir::new();
        let root = folder.path();
        let first = root.join("loop-a");
        let second = root.join("loop-b");
        symlink(&second, &first).expect("make first loop link");
        symlink(&first, &second).expect("make second loop link");

        let entries = read_dir_at(root).expect("a loop does not fail the listing");
        let names: Vec<&str> = entries
            .iter()
            .map(|entry| {
                Path::new(&entry.path)
                    .file_name()
                    .expect("name")
                    .to_str()
                    .expect("utf8")
            })
            .collect();

        assert_eq!(names, vec!["loop-a", "loop-b"]);
        for entry in entries {
            assert!(entry.is_symlink);
            assert_eq!(entry.size, 0);
            assert!(!entry.is_directory);
        }
    }

    #[test]
    fn plat_05_read_dir_command_lists_a_folder() {
        let folder = TempDir::new();
        fs::write(folder.path().join("a.txt"), "hello").expect("seed file");
        let roots = vec![folder.path().to_path_buf()];

        let entries =
            tauri::async_runtime::block_on(read_dir_checked(as_string(folder.path()), roots))
                .expect("list folder");

        assert_eq!(entries.len(), 1);
        assert!(entries[0].path.ends_with("a.txt"));
        assert_eq!(entries[0].size, 5);
    }

    #[test]
    fn plat_05_trash_moves_to_unique_names() {
        let folder = TempDir::new();
        let trash = folder.path().join("Trash");
        let first = folder.path().join("note.txt");
        fs::write(&first, "one").expect("seed first");
        trash_into(&first, &trash).expect("trash first");

        let second = folder.path().join("note.txt");
        fs::write(&second, "two").expect("seed second");
        trash_into(&second, &trash).expect("trash second");

        assert!(!first.exists());
        assert!(!second.exists());
        assert_eq!(
            fs::read_to_string(trash.join("note.txt")).expect("first"),
            "one"
        );
        assert_eq!(
            fs::read_to_string(trash.join("note 2.txt")).expect("second"),
            "two"
        );
    }

    #[test]
    fn plat_05_trash_missing_path_fails() {
        let folder = TempDir::new();
        let trash = folder.path().join("Trash");

        let result = trash_into(&folder.path().join("missing.txt"), &trash);

        assert!(result.is_err());
        assert!(!trash.exists(), "a failed trash move creates nothing");
    }

    #[test]
    fn plat_05_trash_command_fails_for_a_missing_path() {
        let folder = TempDir::new();
        let missing = as_string(&folder.path().join("missing.txt"));
        let roots = vec![folder.path().to_path_buf()];

        let error = tauri::async_runtime::block_on(trash_checked(missing, roots))
            .expect_err("missing path fails");

        assert!(matches!(error, CommandError::Io(_)));
    }

    #[test]
    fn plat_05_trash_rename_does_not_replace_an_existing_item() {
        let folder = TempDir::new();
        let source = folder.path().join("source.txt");
        let destination = folder.path().join("destination.txt");
        fs::write(&source, "source").expect("seed source");
        fs::write(&destination, "destination").expect("seed destination");

        let error = rename_exclusive(&source, &destination).expect_err("refuse to replace");

        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(&source).expect("source"), "source");
        assert_eq!(
            fs::read_to_string(&destination).expect("destination"),
            "destination"
        );
    }

    #[test]
    fn plat_05_trash_does_not_rename_a_directory_onto_an_empty_one() {
        let folder = TempDir::new();
        let trash = folder.path().join("Trash");
        fs::create_dir(&trash).expect("trash folder");
        fs::create_dir(trash.join("project")).expect("empty folder already in the trash");
        let source = folder.path().join("project");
        fs::create_dir(&source).expect("source folder");
        fs::write(source.join("keep.txt"), "keep").expect("seed file");

        trash_into(&source, &trash).expect("trash folder");

        assert!(!source.exists());
        assert_eq!(
            fs::read_to_string(trash.join("project 2").join("keep.txt")).expect("moved"),
            "keep"
        );
        assert!(trash.join("project").is_dir(), "the empty folder stays");
    }

    #[test]
    fn plat_05_trash_dir_in_uses_the_home_trash_on_the_boot_volume() {
        let home = Path::new("/Users/example");

        let trash = trash_dir_in(7, 7, Path::new("/"), home, 501);

        assert_eq!(trash, Path::new("/Users/example/.Trash"));
    }

    #[test]
    fn plat_05_trash_dir_in_uses_the_volume_trash_on_another_volume() {
        let home = Path::new("/Users/example");

        let trash = trash_dir_in(9, 7, Path::new("/Volumes/Backup"), home, 501);

        assert_eq!(trash, Path::new("/Volumes/Backup/.Trashes/501"));
    }

    #[test]
    fn plat_05_trash_dir_for_home_is_the_home_trash() {
        use std::os::unix::fs::MetadataExt;

        let home = home_dir().expect("home folder");
        let trash = trash_dir_for(&home).expect("trash folder");
        let home_metadata = fs::metadata(&home).expect("home metadata");
        let root_device = fs::metadata("/").expect("root metadata").dev();

        if home_metadata.dev() == root_device {
            assert_eq!(trash, home.join(".Trash"));
        } else {
            assert!(trash.ends_with(Path::new(".Trashes").join(home_metadata.uid().to_string())));
        }
    }

    #[test]
    fn plat_29_home_roots_list_the_claude_files_and_the_workspace_folder() {
        let home = Path::new("/Users/example");
        let roots = home_roots(home);

        assert!(roots.contains(&home.join(".claude.json")));
        assert!(roots.contains(&home.join(".claude")));
        assert!(roots.contains(&home.join(".conducted")));
        assert!(
            roots.contains(
                &home
                    .join("Library")
                    .join("Application Support")
                    .join("Claude")
                    .join("claude_desktop_config.json")
            )
        );
        assert!(roots.contains(&home.join("conducted")));
    }

    #[test]
    fn plat_29_a_path_inside_a_root_is_allowed() {
        let folder = TempDir::new();
        let file = folder.path().join("note.txt");
        fs::write(&file, "hello").expect("seed file");

        let resolved = check_path_in_scope(&as_string(&file), &[folder.path().to_path_buf()])
            .expect("a path inside the root is allowed");

        assert_eq!(resolved, file.canonicalize().expect("canonical path"));
    }

    #[test]
    fn plat_29_a_path_outside_every_root_is_refused_and_named() {
        let folder = TempDir::new();
        let outside = as_string(&folder.path().join("outside.txt"));
        let root = folder.path().join("root");
        fs::create_dir(&root).expect("root folder");

        let error = check_path_in_scope(&outside, &[root]).expect_err("outside is refused");

        match error {
            CommandError::Failed { code, message } => {
                assert_eq!(code, "fs_out_of_scope");
                assert!(message.contains(&outside), "the error names the path");
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn plat_29_a_sibling_whose_name_starts_with_the_root_is_not_inside() {
        let folder = TempDir::new();
        let root = folder.path().join("root");
        let sibling = folder.path().join("root-other");
        fs::create_dir(&root).expect("root folder");
        fs::create_dir(&sibling).expect("sibling folder");

        let error = check_path_in_scope(&as_string(&sibling), &[root])
            .expect_err("a name prefix is not a parent folder");

        assert!(matches!(
            error,
            CommandError::Failed {
                code: "fs_out_of_scope",
                ..
            }
        ));
    }

    #[test]
    fn plat_29_dot_dot_cannot_climb_out_of_a_root() {
        let folder = TempDir::new();
        let root = folder.path().join("root");
        fs::create_dir(&root).expect("root folder");

        let escape = as_string(&root.join("../outside.txt"));
        let error = check_path_in_scope(&escape, &[root]).expect_err("the climb is refused");

        assert!(matches!(
            error,
            CommandError::Failed {
                code: "fs_out_of_scope",
                ..
            }
        ));
    }

    #[test]
    fn plat_29_a_symlink_that_leaves_the_root_is_refused() {
        let folder = TempDir::new();
        let root = folder.path().join("root");
        let outside = folder.path().join("secret.txt");
        fs::create_dir(&root).expect("root folder");
        fs::write(&outside, "secret").expect("seed outside file");
        let link = root.join("link.txt");
        symlink(&outside, &link).expect("make link");

        let error =
            check_path_in_scope(&as_string(&link), &[root]).expect_err("the link is refused");

        assert!(matches!(
            error,
            CommandError::Failed {
                code: "fs_out_of_scope",
                ..
            }
        ));
    }

    #[test]
    fn plat_29_a_missing_path_inside_a_root_resolves_from_its_parent() {
        let folder = TempDir::new();
        let missing = folder.path().join("new").join("note.txt");

        let resolved = check_path_in_scope(&as_string(&missing), &[folder.path().to_path_buf()])
            .expect("a new path inside the root is allowed");

        assert!(resolved.ends_with("new/note.txt"));
    }

    #[test]
    fn plat_29_read_text_refuses_a_file_over_the_size_limit() {
        let folder = TempDir::new();
        let file = folder.path().join("huge.txt");
        let handle = fs::File::create(&file).expect("create sparse file");
        handle
            .set_len(MAX_READ_BYTES + 1)
            .expect("set the file length");

        let error = read_text_limited(&file).expect_err("the file is too large");

        assert!(matches!(
            error,
            CommandError::Failed {
                code: "fs_file_too_large",
                ..
            }
        ));
    }

    #[test]
    fn plat_29_read_text_outside_the_roots_is_refused() {
        let folder = TempDir::new();
        let file = folder.path().join("secret.txt");
        fs::write(&file, "secret").expect("seed file");
        let root = folder.path().join("root");
        fs::create_dir(&root).expect("root folder");

        let error = tauri::async_runtime::block_on(read_text_checked(as_string(&file), vec![root]))
            .expect_err("the read is refused");

        assert!(matches!(
            error,
            CommandError::Failed {
                code: "fs_out_of_scope",
                ..
            }
        ));
    }

    #[test]
    fn plat_29_capabilities_limit_the_opener_and_drop_the_broad_plugin_defaults() {
        let capabilities = include_str!("../capabilities/default.json");

        assert!(capabilities.contains("opener:allow-open-url"));
        for scope in [
            "https://*",
            "http://*",
            "mailto:*",
            "vscode://*",
            "linear://*",
            "slack://*",
        ] {
            assert!(
                capabilities.contains(scope),
                "the opener scope lists {scope}"
            );
        }
        assert!(
            !capabilities.contains("\"opener:default\""),
            "the broad opener default is gone"
        );
        assert!(
            !capabilities.contains("\"shell:default\""),
            "the plugin shell is not granted; the app's own commands check the program list"
        );
        assert!(
            !capabilities.contains("\"fs:default\""),
            "the plugin file system is not granted; the app's own commands check the path scope"
        );
    }
}
