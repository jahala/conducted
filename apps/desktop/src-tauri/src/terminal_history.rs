//! @feature PLAT-08 Saved terminal scrollback
//!
//! Owns: writing a terminal's output to disk when it ends, reading it back after a restart, and
//! keeping the folder within its size and age limits.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`terminal_history_storage.rs`:
//! `pty_load_terminal_history`, `pty_persist_terminal_history`, the 50 MiB limit with eviction of
//! the oldest entries) and D1 (`local-storage.entries/terminal-history`, directory mode 0700).
//!
//! Must handle:
//! - Files live in `<app data>/terminal-history/<terminal id>.bin`. The folder has mode 0700 and
//!   each file mode 0600.
//! - A terminal that never received user input is not saved: a finished setup script has its log
//!   file already. The recorder tracks `has_received_input`.
//! - Each file holds at most `MAX_ENTRY_BYTES`, the newest bytes. Cutting must not start in the
//!   middle of an escape sequence: drop everything up to the first newline.
//! - Writes are atomic (temp file plus rename), so a crash never leaves a half entry. A temp
//!   file left by a crash is removed once it is a day old.
//! - Eviction runs whenever the folder is opened for a load and after each save. It removes
//!   entries older than `MAX_AGE_DAYS`, then the oldest entries until the folder is under
//!   `MAX_TOTAL_BYTES`.
//! - Loading a missing file fails with `history_not_found`. A bad id (path separators, `..`)
//!   fails with `history_bad_id`, so an id can never point outside the folder.
//! - The terminal id is the PTY id from pty.rs.
//!
//! Our design choice: files are plain, not encrypted. Terminal output can hold secrets, but the
//! data folder is private to the user and an encryption key in the Keychain would add a prompt and
//! a failure mode. Revisit if shared machines matter. The 14-day age limit matches the lifetime
//! of the `terminals` table rows in migration 0001.
//!
//! Our design choice: one record holds at most 20 MiB and the whole folder at most 50 MiB, so the
//! 60 MiB test below evicts the oldest terminal. The UI's scrollback setting bounds the live
//! screen; the shell owns the saved file so a restart needs no UI call.
//!
//! Our design choice: output is appended as it arrives and written when the child exits, so there
//! is no debounce timer and no UI persist call.
//!
//! Test first: saving 60 MiB of entries over three terminals leaves the folder at or under
//! 50 MiB, and the oldest terminal is the one that is gone.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::error::blocking;
use crate::error::{CommandError, CommandResult};

/// Folder name under the app data folder.
pub const HISTORY_DIR: &str = "terminal-history";
/// Most bytes kept for one terminal.
pub const MAX_ENTRY_BYTES: usize = 20 * 1024 * 1024;
/// Most bytes kept in the whole folder.
pub const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;
/// Entries older than this are removed.
pub const MAX_AGE_DAYS: u64 = 14;
/// A temp file left by a crashed write is removed after this long.
pub const TEMP_MAX_AGE_MS: i64 = 86_400_000;

/// Counter that keeps two temp files in one process apart.
static TEMP_SERIAL: AtomicU64 = AtomicU64::new(0);

/// Collects the output of one terminal while it runs.
pub struct HistoryRecorder {
    terminal_id: String,
    bytes: Vec<u8>,
    has_received_input: bool,
}

impl HistoryRecorder {
    /// An empty recorder for the given terminal id.
    pub fn new(terminal_id: String) -> Self {
        Self {
            terminal_id,
            bytes: Vec::new(),
            has_received_input: false,
        }
    }

    /// Appends output, dropping the oldest bytes past `MAX_ENTRY_BYTES`.
    pub fn push_output(&mut self, bytes: &[u8]) -> CommandResult<()> {
        self.bytes.extend_from_slice(bytes);
        if self.bytes.len() > MAX_ENTRY_BYTES {
            let keep_from = {
                let kept = newest_bytes(&self.bytes, MAX_ENTRY_BYTES);
                self.bytes.len() - kept.len()
            };
            self.bytes.drain(..keep_from);
        }
        Ok(())
    }

    /// Notes that the user typed into the terminal.
    pub fn mark_input(&mut self) {
        self.has_received_input = true;
    }

    /// Writes the entry to `dir` unless no input was received, then evicts old entries.
    pub fn save(&self, dir: &Path) -> CommandResult<()> {
        if !self.has_received_input {
            return Ok(());
        }
        ensure_private_dir(dir)?;
        let path = entry_path(dir, &self.terminal_id)?;
        let bytes = newest_bytes(&self.bytes, MAX_ENTRY_BYTES);
        write_atomic(&path, bytes)?;
        evict(dir, now_ms()?)?;
        Ok(())
    }
}

/// `<app data>/terminal-history`, created with mode 0700 when missing.
pub fn history_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| CommandError::Failed {
            code: "history_app_data",
            message: format!("Could not find the app data folder: {error}"),
        })?;
    let dir = data.join(HISTORY_DIR);
    ensure_private_dir(&dir)?;
    evict(&dir, now_ms()?)?;
    Ok(dir)
}

/// Reads one saved entry from `dir`.
pub fn load_entry(dir: &Path, terminal_id: &str) -> CommandResult<Vec<u8>> {
    let path = entry_path(dir, terminal_id)?;
    match fs::read(&path) {
        Ok(bytes) => Ok(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(CommandError::Failed {
            code: "history_not_found",
            message: format!("No saved terminal history for {terminal_id}"),
        }),
        Err(error) => Err(CommandError::Failed {
            code: "history_read_failed",
            message: format!("Could not read {}: {error}", path.display()),
        }),
    }
}

/// Removes entries past the age and size limits. `now_ms` is passed in so tests control time.
pub fn evict(dir: &Path, now_ms: i64) -> CommandResult<()> {
    let listing = match fs::read_dir(dir) {
        Ok(listing) => listing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(CommandError::Failed {
                code: "history_list_failed",
                message: format!("Could not list {}: {error}", dir.display()),
            });
        }
    };

    let age_limit_ms = i64::try_from(MAX_AGE_DAYS.saturating_mul(86_400_000)).unwrap_or(i64::MAX);
    let mut remaining = Vec::new();
    for item in listing {
        let item = item.map_err(|error| CommandError::Failed {
            code: "history_list_failed",
            message: format!("Could not list an entry in {}: {error}", dir.display()),
        })?;
        let path = item.path();
        let name = item.file_name().to_string_lossy().into_owned();
        let is_entry = name.ends_with(".bin");
        let is_temp = name.starts_with('.') && name.contains(".tmp-");
        if !is_entry && !is_temp {
            continue;
        }
        let metadata = item.metadata().map_err(|error| CommandError::Failed {
            code: "history_stat_failed",
            message: format!("Could not inspect {}: {error}", path.display()),
        })?;
        if !metadata.is_file() {
            continue;
        }
        let modified = modified_ms(&metadata, &path)?;
        if is_temp {
            if now_ms.saturating_sub(modified) > TEMP_MAX_AGE_MS {
                remove_entry(&path)?;
            }
            continue;
        }
        if now_ms.saturating_sub(modified) > age_limit_ms {
            remove_entry(&path)?;
        } else {
            remaining.push(Entry {
                path,
                modified,
                size: metadata.len(),
            });
        }
    }

    remaining.sort_by(|left, right| {
        left.modified
            .cmp(&right.modified)
            .then_with(|| left.path.cmp(&right.path))
    });
    let mut total: u64 = remaining.iter().map(|entry| entry.size).sum();
    for entry in remaining {
        if total <= MAX_TOTAL_BYTES {
            break;
        }
        remove_entry(&entry.path)?;
        total = total.saturating_sub(entry.size);
    }
    Ok(())
}

/// Returns the saved scrollback of an ended terminal as base64.
#[tauri::command]
pub async fn pty_load_history(app: AppHandle, terminal_id: String) -> CommandResult<String> {
    blocking("history_load_task_failed", move || {
        let dir = history_dir(&app)?;
        let bytes = load_entry(&dir, &terminal_id)?;
        Ok(crate::pty::encode_base64(&bytes))
    })
    .await
}

/// One file that eviction may remove.
struct Entry {
    path: PathBuf,
    modified: i64,
    size: u64,
}

/// The last `limit` bytes, starting after a newline when one exists inside the window.
fn newest_bytes(bytes: &[u8], limit: usize) -> &[u8] {
    if bytes.len() <= limit {
        return bytes;
    }
    let cut = bytes.len() - limit;
    match bytes[cut..].iter().position(|byte| *byte == b'\n') {
        Some(offset) => &bytes[cut + offset + 1..],
        None => &bytes[cut..],
    }
}

/// Turns an id into a file inside `dir`, refusing anything that could leave it.
fn entry_path(dir: &Path, terminal_id: &str) -> CommandResult<PathBuf> {
    let bad = terminal_id.is_empty()
        || terminal_id == "."
        || terminal_id == ".."
        || terminal_id.contains('/')
        || terminal_id.contains('\\')
        || terminal_id.contains('\0');
    if bad {
        return Err(CommandError::Failed {
            code: "history_bad_id",
            message: format!("Not a terminal id: {terminal_id:?}"),
        });
    }
    Ok(dir.join(format!("{terminal_id}.bin")))
}

/// Creates `dir` when missing and makes it owner-only.
fn ensure_private_dir(dir: &Path) -> CommandResult<()> {
    fs::create_dir_all(dir).map_err(|error| CommandError::Failed {
        code: "history_folder_failed",
        message: format!("Could not create {}: {error}", dir.display()),
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700)).map_err(|error| {
            CommandError::Failed {
                code: "history_folder_failed",
                message: format!("Could not make {} owner-only: {error}", dir.display()),
            }
        })?;
    }
    Ok(())
}

/// Writes `bytes` to `path` through a temp file, then renames it over the target.
fn write_atomic(path: &Path, bytes: &[u8]) -> CommandResult<()> {
    let dir = path.parent().ok_or_else(|| CommandError::Failed {
        code: "history_save_failed",
        message: format!("{} has no parent folder", path.display()),
    })?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "entry".to_string());
    let serial = TEMP_SERIAL.fetch_add(1, Ordering::Relaxed);
    let temp = dir.join(format!(
        ".{name}.tmp-{}-{serial}-{nanos}",
        std::process::id(),
        nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0),
    ));

    if let Err(error) = write_temp(&temp, bytes) {
        return Err(cleanup_temp(&temp, error));
    }
    match fs::rename(&temp, path) {
        Ok(()) => Ok(()),
        Err(error) => Err(cleanup_temp(
            &temp,
            CommandError::Failed {
                code: "history_save_failed",
                message: format!("Could not replace {}: {error}", path.display()),
            },
        )),
    }
}

/// Writes a new temp file with mode 0600 and flushes it to disk.
fn write_temp(path: &Path, bytes: &[u8]) -> CommandResult<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|error| CommandError::Failed {
        code: "history_save_failed",
        message: format!("Could not create {}: {error}", path.display()),
    })?;
    file.write_all(bytes)
        .map_err(|error| CommandError::Failed {
            code: "history_save_failed",
            message: format!("Could not write {}: {error}", path.display()),
        })?;
    file.sync_all().map_err(|error| CommandError::Failed {
        code: "history_save_failed",
        message: format!("Could not flush {}: {error}", path.display()),
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            CommandError::Failed {
                code: "history_save_failed",
                message: format!("Could not make {} owner-only: {error}", path.display()),
            }
        })?;
    }
    Ok(())
}

/// Removes a temp file left by a failed write, keeping the original failure in the message.
fn cleanup_temp(temp: &Path, error: CommandError) -> CommandError {
    match fs::remove_file(temp) {
        Ok(()) => error,
        Err(cleanup) if cleanup.kind() == std::io::ErrorKind::NotFound => error,
        Err(cleanup) => CommandError::Failed {
            code: "history_save_failed",
            message: format!(
                "{error}; the temporary file {} could not be removed: {cleanup}",
                temp.display()
            ),
        },
    }
}

/// Removes one entry. A file that is already gone counts as removed.
fn remove_entry(path: &Path) -> CommandResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(CommandError::Failed {
            code: "history_evict_failed",
            message: format!("Could not remove {}: {error}", path.display()),
        }),
    }
}

/// Milliseconds since the epoch for a file's modification time.
fn modified_ms(metadata: &fs::Metadata, path: &Path) -> CommandResult<i64> {
    let modified = metadata.modified().map_err(|error| CommandError::Failed {
        code: "history_stat_failed",
        message: format!(
            "Could not read the change time of {}: {error}",
            path.display()
        ),
    })?;
    let millis = modified
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    Ok(i64::try_from(millis).unwrap_or(i64::MAX))
}

/// Milliseconds since the epoch.
fn now_ms() -> CommandResult<i64> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| CommandError::Failed {
            code: "history_clock",
            message: format!("The system clock is before the epoch: {error}"),
        })?
        .as_millis();
    Ok(i64::try_from(millis).unwrap_or(i64::MAX))
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A folder that removes itself, so a test leaves nothing behind.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(tag: &str) -> Self {
            let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-plat-08-{tag}-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test folder");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn entry(&self, terminal_id: &str) -> PathBuf {
            self.path.join(format!("{terminal_id}.bin"))
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            if let Err(error) = fs::remove_dir_all(&self.path) {
                eprintln!(
                    "could not remove test folder {}: {error}",
                    self.path.display()
                );
            }
        }
    }

    fn folder_bytes(dir: &Path) -> u64 {
        fs::read_dir(dir)
            .expect("list folder")
            .map(|item| item.expect("entry").metadata().expect("metadata").len())
            .sum()
    }

    fn recorder(terminal_id: &str, bytes: &[u8]) -> HistoryRecorder {
        let mut recorder = HistoryRecorder::new(terminal_id.to_string());
        recorder.mark_input();
        recorder.push_output(bytes).expect("collect output");
        recorder
    }

    #[test]
    fn plat_08_saving_sixty_mib_over_three_terminals_evicts_the_oldest() {
        let folder = TempDir::new("evict");
        let mut block = vec![b'x'; 1024 * 1024];
        block[block.len() - 1] = b'\n';

        for index in 0..3 {
            let id = format!("terminal-{index}");
            let mut recorder = HistoryRecorder::new(id.clone());
            recorder.mark_input();
            for _ in 0..20 {
                recorder.push_output(&block).expect("collect output");
            }
            recorder.save(folder.path()).expect("save history");
        }

        assert!(
            folder_bytes(folder.path()) <= MAX_TOTAL_BYTES,
            "the folder is {} bytes",
            folder_bytes(folder.path())
        );
        assert!(
            !folder.entry("terminal-0").exists(),
            "the oldest entry is gone"
        );
        assert!(folder.entry("terminal-1").exists());
        assert!(folder.entry("terminal-2").exists());
    }

    #[test]
    fn plat_08_a_terminal_without_input_is_not_saved() {
        let folder = TempDir::new("quiet");
        let mut quiet = HistoryRecorder::new("pty-quiet".to_string());
        quiet
            .push_output(b"setup output\n")
            .expect("collect output");
        quiet.save(folder.path()).expect("save history");
        assert!(!folder.entry("pty-quiet").exists());

        quiet.mark_input();
        quiet.save(folder.path()).expect("save history");
        assert!(folder.entry("pty-quiet").exists());
    }

    #[test]
    fn plat_08_saved_history_reads_back_byte_for_byte() {
        let folder = TempDir::new("read-back");
        let output: &[u8] = b"line one\n\x1b[31mline two\x1b[0m\n";
        recorder("pty-read", output)
            .save(folder.path())
            .expect("save history");

        let loaded = load_entry(folder.path(), "pty-read").expect("load history");
        assert_eq!(loaded.as_slice(), output);
    }

    #[test]
    fn plat_08_a_missing_entry_fails_with_history_not_found() {
        let folder = TempDir::new("missing");
        let error = load_entry(folder.path(), "pty-missing").unwrap_err();
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "history_not_found",
                ..
            }
        ));
    }

    #[test]
    fn plat_08_a_bad_id_cannot_leave_the_history_folder() {
        let folder = TempDir::new("bad-id");
        for id in ["", ".", "..", "../escape", "a/b", "a\\b", "a\0b"] {
            let error = load_entry(folder.path(), id).unwrap_err();
            assert!(
                matches!(
                    error,
                    CommandError::Failed {
                        code: "history_bad_id",
                        ..
                    }
                ),
                "id {id:?} was not refused"
            );
        }
    }

    #[test]
    fn plat_08_trimming_keeps_the_newest_bytes_from_a_line_start() {
        assert_eq!(
            newest_bytes(b"old line\nkeep this\n", 15),
            &b"keep this\n"[..]
        );
        assert_eq!(
            newest_bytes(b"\x1b[31mred\x1b[0m\nnext line\n", 12),
            &b"next line\n"[..]
        );
        assert_eq!(newest_bytes(b"abcdefghij", 4), &b"ghij"[..]);
        assert_eq!(newest_bytes(b"short\n", 100), &b"short\n"[..]);
    }

    #[test]
    fn plat_08_push_output_keeps_at_most_one_entry_limit() {
        let mut recorder = HistoryRecorder::new("pty-big".to_string());
        let chunk = vec![b'a'; 1024 * 1024];
        for _ in 0..21 {
            recorder.push_output(&chunk).expect("collect output");
        }
        assert!(
            recorder.bytes.len() <= MAX_ENTRY_BYTES,
            "the recorder holds {} bytes",
            recorder.bytes.len()
        );
    }

    #[test]
    fn plat_08_eviction_removes_entries_past_the_age_limit() {
        let folder = TempDir::new("age");
        recorder("pty-old", b"old output\n")
            .save(folder.path())
            .expect("save history");
        let path = folder.entry("pty-old");
        let day_ms = 86_400_000_i64;
        let later = now_ms().expect("clock") + (MAX_AGE_DAYS as i64 + 1) * day_ms;

        evict(folder.path(), later).expect("evict");

        assert!(!path.exists(), "an expired entry is removed");
    }

    #[test]
    fn plat_08_eviction_keeps_a_fresh_entry() {
        let folder = TempDir::new("fresh");
        recorder("pty-new", b"new output\n")
            .save(folder.path())
            .expect("save history");
        let path = folder.entry("pty-new");

        evict(folder.path(), now_ms().expect("clock")).expect("evict");

        assert!(path.exists(), "a fresh entry stays");
    }

    #[test]
    fn plat_08_eviction_removes_a_stale_temp_file() {
        let folder = TempDir::new("stale-temp");
        let temp = folder.path().join(".pty-1.bin.tmp-1-0");
        fs::write(&temp, b"half written").expect("seed temp file");
        let day_ms = 86_400_000_i64;
        let now = now_ms().expect("clock");

        evict(folder.path(), now).expect("evict");
        assert!(temp.exists(), "a fresh temp file waits");

        evict(folder.path(), now + day_ms + 1).expect("evict");
        assert!(!temp.exists(), "an old temp file is removed");
    }

    #[test]
    fn plat_08_the_folder_and_each_entry_are_owner_only() {
        let folder = TempDir::new("modes");
        let dir = folder.path().join("terminal-history");
        fs::create_dir_all(&dir).expect("create history folder");
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755))
            .expect("loosen the folder for the test");

        recorder("pty-mode", b"output\n")
            .save(&dir)
            .expect("save history");

        let dir_mode = fs::metadata(&dir)
            .expect("folder metadata")
            .permissions()
            .mode()
            & 0o777;
        let file_mode = fs::metadata(dir.join("pty-mode.bin"))
            .expect("entry metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(dir_mode, 0o700);
        assert_eq!(file_mode, 0o600);
    }

    #[test]
    fn plat_08_a_save_leaves_no_temp_file() {
        let folder = TempDir::new("temp");
        recorder("pty-atomic", b"output\n")
            .save(folder.path())
            .expect("save history");

        let names: Vec<String> = fs::read_dir(folder.path())
            .expect("list folder")
            .map(|item| {
                item.expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["pty-atomic.bin".to_string()]);
    }
}
