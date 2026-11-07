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
//! - `fs_stat` resolves only the parent folder and then reads the link itself, so a link is
//!   described as a link even when it points to another name.
//! - The folders registered with `fs_register_root` while the app runs (PLAT-02). The project
//!   and workspace services register every project folder and workspace folder they load or add,
//!   so a repository outside `~/conducted` is reachable. A registration lasts until the app quits;
//!   the UI registers again on every start. A relative path fails with `fs_relative_path`.
//!
//! - A registered folder is also added to the asset protocol's scope, so the web view can load
//!   previews from it through `Platform.fs.assetUrl`. The static scope in `tauri.conf.json` is
//!   empty; `lib.rs` adds the attachment draft folder at startup (`attachments::DRAFT_FOLDER`).
//!
//! Our design choice: the web view registers the folders, so a page that runs code in the web
//! view could register any folder. The scope narrows accidents, as the program list in shell.rs
//! does; it is not a sandbox. A folder the user picks in a dialog is the normal case.
//!
//! Our design choice: the web view's file scope covers the folders the UI already uses, not all of
//! the home folder. The whole app data folder and the whole temp folder are roots because drafts,
//! setup logs, attachments and temporary files live there; the research names only the Claude
//! files.
//!
//! Our design choice: `capabilities/default.json` drops the broad plugin defaults. The UI calls
//! the app's own file and shell commands, so the file-system and shell plugins are not granted.
//! Web links keep `https://*` and `http://*` because chat renders links to any host; the host list
//! in the research (A3) is narrower than what the chat shows. `mailto:` stays because chat renders
//! mail addresses as links. `tel:` is not granted because nothing renders a telephone link. The
//! IDE and chat schemes and the Full Disk Access pane come from A3.
//!
//! Our design choice: `fs_stat` reports the link itself, not the file it points to, so the UI can
//! show a link. The file size and kind still come from the target, as the PLAT-05 header says.
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
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, State};

use crate::error::{CommandError, CommandResult, blocking, lock};

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

/// Folders the UI added to the file scope while the app runs (PLAT-02): the project and workspace
/// folders it loaded or added. Registered once with `.manage(FsScopeState::default())`.
#[derive(Default)]
pub struct FsScopeState {
    registered: Mutex<Vec<PathBuf>>,
}

impl FsScopeState {
    /// Adds a folder to the scope and returns it as stored: `.` and `..` resolved by spelling,
    /// without a trailing slash. A relative path fails with `fs_relative_path`. A folder that is
    /// already registered is kept once. The folder need not exist yet.
    pub fn register(&self, path: &str) -> CommandResult<PathBuf> {
        let root = normalise_lexically(&absolute_path(path)?);
        let mut registered = lock(&self.registered);
        if !registered.contains(&root) {
            registered.push(root.clone());
        }
        Ok(root)
    }

    /// `base` followed by every registered folder.
    pub fn roots_with(&self, mut base: Vec<PathBuf>) -> Vec<PathBuf> {
        base.extend(lock(&self.registered).iter().cloned());
        base
    }
}

/// The roots the web view may reach: the folders Tauri owns, the Claude configuration files, the
/// app's own settings folder, the default workspaces folder, and every registered folder.
pub fn allowed_roots(app: &AppHandle, scope: &FsScopeState) -> CommandResult<Vec<PathBuf>> {
    let mut roots = scope.roots_with(default_roots(app)?);
    roots.sort();
    roots.dedup();
    Ok(roots)
}

/// The roots the web view may reach without a registration.
fn default_roots(app: &AppHandle) -> CommandResult<Vec<PathBuf>> {
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

/// Checks the path against the roots and returns the resolved path. Commands act on that path, so
/// a link swapped after the check cannot point them outside the root.
fn checked_target(path: &str, roots: &[PathBuf]) -> CommandResult<PathBuf> {
    check_path_in_scope(path, roots)
}

/// Checks the path against the roots but keeps its last name. The parent is resolved, so a link in
/// a parent folder cannot be swapped after the check, while `fs_stat` still describes the link
/// itself. A link whose target leaves the roots is refused first.
fn checked_link_target(path: &str, roots: &[PathBuf]) -> CommandResult<PathBuf> {
    let resolved = check_path_in_scope(path, roots)?;
    let absolute = absolute_path(path)?;
    let name = absolute.file_name().ok_or_else(|| CommandError::Failed {
        code: "fs_bad_path",
        message: format!("Cannot describe this path: {}", absolute.display()),
    })?;
    let parent = absolute.parent().unwrap_or_else(|| Path::new("/"));
    if parent.as_os_str().is_empty() {
        return Ok(PathBuf::from("/").join(name));
    }
    let parent_text = parent.to_string_lossy().into_owned();
    match check_path_in_scope(&parent_text, roots) {
        Ok(resolved_parent) => Ok(resolved_parent.join(name)),
        // A path that is itself a root has a parent outside every root. The full check above
        // already resolved it, so its own location is safe to use.
        Err(_) => Ok(resolved),
    }
}

/// Read a text file after the scope check.
async fn read_text_checked(path: String, roots: Vec<PathBuf>) -> CommandResult<String> {
    blocking("fs_task_failed", move || {
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
    blocking("fs_task_failed", move || {
        let path = checked_target(&path, &roots)?;
        write_text_atomic_with(&path, &text, rename_file)
    })
    .await
}

/// Read facts about a path after the scope check.
async fn stat_checked(path: String, roots: Vec<PathBuf>) -> CommandResult<Option<FileStat>> {
    blocking("fs_task_failed", move || {
        let path = checked_link_target(&path, &roots)?;
        Ok(stat_at(&path)?)
    })
    .await
}

/// Create a folder after the scope check.
async fn mkdirp_checked(path: String, roots: Vec<PathBuf>) -> CommandResult<()> {
    blocking("fs_task_failed", move || {
        let path = checked_target(&path, &roots)?;
        fs::create_dir_all(path)?;
        Ok(())
    })
    .await
}

/// List a folder after the scope check.
async fn read_dir_checked(path: String, roots: Vec<PathBuf>) -> CommandResult<Vec<FileStat>> {
    blocking("fs_task_failed", move || {
        let path = checked_target(&path, &roots)?;
        read_dir_at(&path)
    })
    .await
}

/// Move a path to the Trash after the scope check.
async fn trash_checked(path: String, roots: Vec<PathBuf>) -> CommandResult<()> {
    blocking("fs_task_failed", move || {
        let path = checked_target(&path, &roots)?;
        let trash = trash_dir_for(&path)?;
        trash_into(&path, &trash)
    })
    .await
}

/// Reads a whole file as UTF-8 text.
#[tauri::command]
pub async fn fs_read_text(
    app: AppHandle,
    scope: State<'_, FsScopeState>,
    path: String,
) -> CommandResult<String> {
    read_text_checked(path, allowed_roots(&app, &scope)?).await
}

/// Writes text through a temp file and a rename.
#[tauri::command]
pub async fn fs_write_text_atomic(
    app: AppHandle,
    scope: State<'_, FsScopeState>,
    path: String,
    text: String,
) -> CommandResult<()> {
    write_text_atomic_checked(path, text, allowed_roots(&app, &scope)?).await
}

/// Returns facts about a path, or `None` when it does not exist.
#[tauri::command]
pub async fn fs_stat(
    app: AppHandle,
    scope: State<'_, FsScopeState>,
    path: String,
) -> CommandResult<Option<FileStat>> {
    stat_checked(path, allowed_roots(&app, &scope)?).await
}

/// Creates a folder and any missing parents. Succeeds when it already exists.
#[tauri::command]
pub async fn fs_mkdirp(
    app: AppHandle,
    scope: State<'_, FsScopeState>,
    path: String,
) -> CommandResult<()> {
    mkdirp_checked(path, allowed_roots(&app, &scope)?).await
}

/// Lists the direct children of a folder.
#[tauri::command]
pub async fn fs_read_dir(
    app: AppHandle,
    scope: State<'_, FsScopeState>,
    path: String,
) -> CommandResult<Vec<FileStat>> {
    read_dir_checked(path, allowed_roots(&app, &scope)?).await
}

/// Moves a file or folder to the Trash.
#[tauri::command]
pub async fn fs_trash(
    app: AppHandle,
    scope: State<'_, FsScopeState>,
    path: String,
) -> CommandResult<()> {
    trash_checked(path, allowed_roots(&app, &scope)?).await
}

/// Adds a folder to the scope of the file commands and of the asset protocol until the app quits
/// (PLAT-02).
#[tauri::command]
pub async fn fs_register_root(
    app: AppHandle,
    scope: State<'_, FsScopeState>,
    path: String,
) -> CommandResult<()> {
    register_root(&app, &scope, &path)
}

/// Registers `path` with the file commands, then lets the web view load files below it through
/// the asset protocol, so image, PDF and video previews of a project load.
pub fn register_root<R: Runtime>(
    app: &AppHandle<R>,
    scope: &FsScopeState,
    path: &str,
) -> CommandResult<()> {
    let root = scope.register(path)?;
    allow_assets_under(app, &root)
}

/// Lets the web view load files below `folder` through the asset protocol. The static scope in
/// tauri.conf.json is empty, so only the folders added here can be loaded.
pub fn allow_assets_under<R: Runtime>(app: &AppHandle<R>, folder: &Path) -> CommandResult<()> {
    app.asset_protocol_scope()
        .allow_directory(folder, true)
        .map_err(|error| CommandError::Failed {
            code: "fs_asset_scope_failed",
            message: format!(
                "Could not let previews load from {}: {error}",
                folder.display()
            ),
        })
}

/// Moves an app-managed file or folder to the Trash without the web view's path scope.
///
/// The program manager replaces the programs it downloaded itself, so it uses the same Trash as
/// `fs_trash` and never deletes an old version for good.
pub(crate) fn trash_path(path: &Path) -> CommandResult<()> {
    let trash = trash_dir_for(path)?;
    trash_into(path, &trash)
}

/// Returns the well-known folders. The UI reads this once at startup.
#[tauri::command]
pub async fn fs_paths<R: Runtime>(app: AppHandle<R>) -> CommandResult<FsPaths> {
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
    fn plat_29_checked_target_returns_the_resolved_path() {
        let folder = TempDir::new();
        let real = folder.path().join("real");
        fs::create_dir(&real).expect("real folder");
        let link = folder.path().join("link");
        symlink(&real, &link).expect("make link");
        let target = link.join("note.txt");
        fs::write(&target, "x").expect("seed file");

        let checked = checked_target(&as_string(&target), &[folder.path().to_path_buf()])
            .expect("the path is in scope");

        assert_eq!(
            checked,
            real.canonicalize().expect("real path").join("note.txt")
        );
        assert!(
            !checked.starts_with(&link),
            "the command acts on the resolved path, not the link"
        );
    }

    #[test]
    fn plat_29_stat_keeps_the_link_name_after_resolving_its_parent() {
        let folder = TempDir::new();
        let real = folder.path().join("real");
        fs::create_dir(&real).expect("real folder");
        let link_dir = folder.path().join("linkdir");
        symlink(&real, &link_dir).expect("make the folder link");
        let target = real.join("file.txt");
        fs::write(&target, "x").expect("seed file");
        let link = link_dir.join("note.txt");
        symlink(&target, &link).expect("make the file link");

        let checked = checked_link_target(&as_string(&link), &[folder.path().to_path_buf()])
            .expect("the link is in scope");

        assert_eq!(
            checked,
            real.canonicalize().expect("real path").join("note.txt")
        );
        let stat = stat_at(&checked)
            .expect("stat the link")
            .expect("the link exists");
        assert!(stat.is_symlink, "fs_stat reports the link, not its target");
    }

    #[test]
    fn plat_29_every_file_command_refuses_an_outside_path() {
        let folder = TempDir::new();
        let root = folder.path().join("root");
        fs::create_dir(&root).expect("root folder");
        let outside = folder.path().join("outside.txt");
        fs::write(&outside, "secret").expect("seed the outside file");
        let outside_dir = folder.path().join("outside-dir");
        fs::create_dir(&outside_dir).expect("outside folder");
        let roots = vec![root.clone()];

        let write = tauri::async_runtime::block_on(write_text_atomic_checked(
            as_string(&outside),
            "changed".to_string(),
            roots.clone(),
        ))
        .expect_err("a write outside the roots is refused");
        assert_out_of_scope(write);
        assert_eq!(
            fs::read_to_string(&outside).expect("the outside file"),
            "secret"
        );

        let stat = tauri::async_runtime::block_on(stat_checked(as_string(&outside), roots.clone()))
            .expect_err("a stat outside the roots is refused");
        assert_out_of_scope(stat);

        let new_folder = folder.path().join("new-folder");
        let mkdir =
            tauri::async_runtime::block_on(mkdirp_checked(as_string(&new_folder), roots.clone()))
                .expect_err("a folder outside the roots is refused");
        assert_out_of_scope(mkdir);
        assert!(!new_folder.exists(), "a refused mkdirp creates nothing");

        let listed = tauri::async_runtime::block_on(read_dir_checked(
            as_string(&outside_dir),
            roots.clone(),
        ))
        .expect_err("a listing outside the roots is refused");
        assert_out_of_scope(listed);

        let trash =
            tauri::async_runtime::block_on(trash_checked(as_string(&outside), roots.clone()))
                .expect_err("a trash outside the roots is refused");
        assert_out_of_scope(trash);
        assert!(outside.exists(), "a refused trash moves nothing");

        let secret = folder.path().join("secret-target.txt");
        fs::write(&secret, "secret").expect("seed the link target");
        let escaping_link = root.join("escaping.txt");
        symlink(&secret, &escaping_link).expect("make the escaping link");
        let stat_link =
            tauri::async_runtime::block_on(stat_checked(as_string(&escaping_link), roots.clone()))
                .expect_err("a link that leaves the roots is refused");
        assert_out_of_scope(stat_link);
    }

    #[test]
    fn plat_02_a_registered_root_is_in_scope_and_an_unregistered_one_is_not() {
        let folder = TempDir::new();
        let project = folder.path().join("project");
        let other = folder.path().join("other");
        fs::create_dir(&project).expect("project folder");
        fs::create_dir(&other).expect("other folder");
        let note = project.join("note.txt");
        fs::write(&note, "x").expect("seed file");
        let base = vec![folder.path().join("app-data")];
        let scope = FsScopeState::default();

        let before = check_path_in_scope(&as_string(&note), &scope.roots_with(base.clone()))
            .expect_err("an unregistered folder is out of scope");
        assert_out_of_scope(before);

        scope
            .register(&as_string(&project))
            .expect("an absolute folder registers");
        let roots = scope.roots_with(base);
        check_path_in_scope(&as_string(&note), &roots)
            .expect("a file in a registered folder is in scope");
        let elsewhere = check_path_in_scope(&as_string(&other.join("x.txt")), &roots)
            .expect_err("a folder nobody registered stays out of scope");
        assert_out_of_scope(elsewhere);
    }

    fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .manage(FsScopeState::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build a mock app")
    }

    #[test]
    fn plat_02_a_registered_folder_can_be_loaded_as_an_asset_and_another_cannot() {
        let folder = TempDir::new();
        let project = folder.path().join("project");
        let other = folder.path().join("other");
        fs::create_dir_all(project.join("shots")).expect("project folder");
        fs::create_dir(&other).expect("other folder");
        let image = project.join("shots").join("a.png");
        let elsewhere = other.join("b.png");
        fs::write(&image, "png").expect("seed image");
        fs::write(&elsewhere, "png").expect("seed other image");
        let app = mock_app();
        let scope = app.state::<FsScopeState>();

        assert!(!app.asset_protocol_scope().is_allowed(&image));
        register_root(app.handle(), &scope, &as_string(&project)).expect("registers");

        assert!(app.asset_protocol_scope().is_allowed(&image));
        assert!(!app.asset_protocol_scope().is_allowed(&elsewhere));
    }

    #[test]
    fn plat_02_the_asset_protocol_has_no_static_scope() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json is JSON");
        let asset = &config["app"]["security"]["assetProtocol"];
        assert_eq!(asset["enable"], serde_json::Value::Bool(true));
        assert_eq!(asset["scope"], serde_json::json!([]));
    }

    #[test]
    fn plat_02_a_relative_root_is_refused() {
        let scope = FsScopeState::default();
        let error = scope
            .register("projects/mine")
            .expect_err("a relative folder is refused");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "fs_relative_path",
                ..
            }
        ));
        assert!(scope.roots_with(Vec::new()).is_empty());
    }

    #[test]
    fn plat_02_a_root_registered_twice_is_kept_once_and_spelled_plainly() {
        let scope = FsScopeState::default();
        scope.register("/code/./mine/").expect("first registration");
        scope.register("/code/mine").expect("second registration");
        assert_eq!(
            scope.roots_with(Vec::new()),
            vec![PathBuf::from("/code/mine")]
        );
    }

    fn assert_out_of_scope(error: CommandError) {
        assert!(
            matches!(
                &error,
                CommandError::Failed {
                    code: "fs_out_of_scope",
                    ..
                }
            ),
            "expected fs_out_of_scope, got {error:?}"
        );
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
        let capabilities: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json"))
                .expect("the capability file is valid JSON");
        let permissions = capabilities["permissions"]
            .as_array()
            .expect("permissions is a list");

        let mut opener_scopes: Vec<&str> = Vec::new();
        for permission in permissions {
            let identifier = permission["identifier"].as_str().unwrap_or("");
            if identifier == "opener:allow-open-url" {
                for entry in permission["allow"]
                    .as_array()
                    .expect("the opener allow list is a list")
                {
                    opener_scopes.push(entry["url"].as_str().expect("every opener entry is a URL"));
                }
            }
            assert!(
                !matches!(
                    identifier,
                    "opener:default" | "shell:default" | "fs:default"
                ),
                "the broad plugin default {identifier} is not granted"
            );
        }
        assert_eq!(
            opener_scopes,
            vec![
                "https://*",
                "http://*",
                "mailto:*",
                "linear://*",
                "vscode://*",
                "slack://*",
                "figma://*",
                "notion://*",
                "raycast://*",
                "x-apple.systempreferences:*",
            ],
            "the opener scope is the exact list, not a broader web scope"
        );
    }
}
