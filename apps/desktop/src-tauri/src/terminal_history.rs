//! @feature PLAT-08 Saved terminal scrollback
//!
//! Owns: writing a terminal's output to disk when it ends or the app quits, reading it back after
//! a restart, and keeping the folder within its size and age limits.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`terminal_history_storage.rs`:
//! `pty_load_terminal_history`, `pty_persist_terminal_history`, `get_or_create_local_storage_encryption_key`,
//! the 50 MiB limit with eviction of the oldest entries), D1 (`local-storage.entries/terminal-history`,
//! encrypted entries, directory mode 0700) and services-map.md 4.2.9 (the local-storage entry scheme:
//! a 32-byte key in the Keychain under `local-storage-entry-encryption-key-v1`, AES-256-GCM with a
//! random 12-byte nonce and the entry's subsystem, id and version as additional authenticated data).
//!
//! Must handle:
//! - Files live in `<app data>/terminal-history/<terminal id>.bin`. The terminal id is the row id
//!   the UI stores, which `PtySpawn.terminalId` carries into `pty_spawn`, so a reopened terminal
//!   finds its history. The folder has mode 0700 and each file mode 0600.
//! - Each file is encrypted. Its first bytes are `ENTRY_MAGIC`, then a random 12-byte nonce, then
//!   the AES-256-GCM ciphertext and tag. The key is created in the macOS Keychain on first use and
//!   reused after that. A file that does not start with `ENTRY_MAGIC` is never returned as text: a
//!   plain file left by an earlier version is encrypted by the migration below before any read.
//! - A terminal that never received user input is not saved: a finished setup script has its log
//!   file already. The recorder tracks `has_received_input`.
//! - Each file holds at most the terminal's scrollback limit, and never more than
//!   `MAX_ENTRY_BYTES`, the newest bytes. The cut moves forward to just
//!   after the first newline in the kept bytes, so it does not start inside an escape sequence or
//!   a character. Without a newline it moves to the first escape character, which starts a
//!   sequence. With neither it moves to the next UTF-8 character start; then the first kept bytes
//!   can be the printable tail of a sequence cut before them (a few characters such as `31m`).
//! - A quit saves every terminal still running (`pty::save_live_histories` from `lib.rs`), before
//!   the terminals are ended, so the history of a terminal open at quit is on disk.
//! - Writes are atomic (temp file plus rename), so a crash never leaves a half entry. A temp
//!   file left by a crash is removed once it is a day old.
//! - Eviction runs whenever the folder is opened for a load and after each save. It removes
//!   entries older than `MAX_AGE_DAYS`, then the oldest entries until the folder is under
//!   `MAX_TOTAL_BYTES`.
//! - Existing plain entries are encrypted by `migrate_plain_entries` on the first start that opens
//!   the folder. An entry that cannot be encrypted stays as it is and the error is logged; nothing
//!   is deleted, so a later start tries again.
//! - Loading a missing file fails with `history_not_found`. A bad id (path separators, `..`)
//!   fails with `history_bad_id`, so an id can never point outside the folder. A file that is not
//!   encrypted fails with `history_unencrypted`; a file whose tag or key does not match fails with
//!   `history_decrypt_failed`.
//!
//! Our design choice: the scheme follows Conductor's local-storage entries, as the issue asks
//! (D087 replaces D014). The key is a generic password in the Keychain under `keychain::SERVICE`
//! and the account `local-storage-entry-encryption-key-v1`, the name Conductor uses. The 14-day
//! age limit matches the lifetime of the `terminals` table rows in migration 0001.
//!
//! Our design choice: one record holds at most 20 MiB and the whole folder at most 50 MiB, so the
//! 60 MiB test below evicts the oldest terminal.
//! - The Advanced setting "terminal scrollback limit" arrives as `PtySpawn.scrollbackLimitBytes`
//!   and caps one terminal's record; the record never holds more than `MAX_ENTRY_BYTES` whatever
//!   the setting says (services-map.md 5A.4.8, ui-map.md 6 Advanced).
//! - A save that fails when a terminal ends is written to the app log and reaches the UI on
//!   `pty://exit` as `historyError` (pty.rs).
//!
//! Our design choice: output is appended as it arrives and written when the child exits or the
//! app quits, so there is no debounce timer and no UI persist call.
//!
//! Test first: saving 60 MiB of entries over three terminals leaves the folder at or under
//! 50 MiB, and the oldest terminal is the one that is gone. The file on disk does not hold the
//! terminal's text in plain form, and loading it returns the same text; a plain entry left by an
//! earlier version is encrypted by the migration and reads back unchanged.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use ring::aead::{AES_256_GCM, Aad, LessSafeKey, Nonce, UnboundKey};
use ring::rand::{SecureRandom, SystemRandom};
use tauri::{AppHandle, Manager};

use crate::error::blocking;
use crate::error::{CommandError, CommandResult};
use crate::keychain;

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

/// The Keychain account that holds the scrollback encryption key. Conductor's name for the same
/// key (services-map.md 4.2.9).
pub const ENCRYPTION_KEY_ACCOUNT: &str = "local-storage-entry-encryption-key-v1";
/// Bytes in the AES-256-GCM key.
pub const KEY_BYTES: usize = 32;
/// Bytes in the GCM nonce.
pub const NONCE_BYTES: usize = 12;
/// Marks an encrypted entry and its format version.
pub const ENTRY_MAGIC: &[u8] = b"CONDUCTED-SCROLLBACK\x00\x01";
/// The version included in the entry's additional authenticated data.
const ENTRY_VERSION: u64 = 1;

/// Counter that keeps two temp files in one process apart.
static TEMP_SERIAL: AtomicU64 = AtomicU64::new(0);
/// The key is read from the Keychain once per process.
static CACHED_KEY: OnceLock<[u8; KEY_BYTES]> = OnceLock::new();
/// Serializes the key's read-or-create, so two threads never make two keys.
static KEY_LOCK: Mutex<()> = Mutex::new(());

/// The scrollback encryption key, read from the Keychain or created there on first use. The key
/// stays in memory after the first read.
pub(crate) fn entry_key() -> CommandResult<[u8; KEY_BYTES]> {
    if let Some(key) = CACHED_KEY.get() {
        return Ok(*key);
    }
    let _guard = crate::error::lock(&KEY_LOCK);
    if let Some(key) = CACHED_KEY.get() {
        return Ok(*key);
    }
    let key = load_or_create_key(keychain::SERVICE, ENCRYPTION_KEY_ACCOUNT)?;
    CACHED_KEY
        .set(key)
        .expect("the key is only set under KEY_LOCK");
    Ok(key)
}

/// Reads the key in one service, or makes a random one and stores it there. The service and
/// account are parameters so a test can use an item of its own.
fn load_or_create_key(service: &str, account: &str) -> CommandResult<[u8; KEY_BYTES]> {
    if let Some(stored) = keychain::read_secret(service, account)? {
        return decode_key(&stored);
    }
    let mut key = [0u8; KEY_BYTES];
    SystemRandom::new()
        .fill(&mut key)
        .map_err(|_| CommandError::Failed {
            code: "history_key_random",
            message: "Could not make a random scrollback encryption key.".to_string(),
        })?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(key);
    keychain::write_secret(service, account, &encoded)?;
    Ok(key)
}

/// Turns the base64 value stored in the Keychain into the key, refusing any other length.
fn decode_key(stored: &str) -> CommandResult<[u8; KEY_BYTES]> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(stored)
        .map_err(|_| CommandError::Failed {
            code: "history_key_invalid",
            message: "The saved scrollback encryption key is not valid base64.".to_string(),
        })?;
    bytes.try_into().map_err(|_| CommandError::Failed {
        code: "history_key_invalid",
        message: format!("The saved scrollback encryption key is not {KEY_BYTES} bytes."),
    })
}

/// The additional authenticated data that ties an entry to its terminal and format version.
/// This is the shape Conductor's local storage uses (services-map.md 4.2.9).
fn entry_aad(terminal_id: &str) -> Vec<u8> {
    serde_json::json!({
        "subsystem": HISTORY_DIR,
        "id": terminal_id,
        "version": ENTRY_VERSION,
    })
    .to_string()
    .into_bytes()
}

/// The AES-256-GCM key, or an error that does not print the key.
fn cipher(key: &[u8; KEY_BYTES]) -> CommandResult<LessSafeKey> {
    let key = UnboundKey::new(&AES_256_GCM, key).map_err(|_| CommandError::Failed {
        code: "history_key_invalid",
        message: format!("The scrollback encryption key is not {KEY_BYTES} bytes."),
    })?;
    Ok(LessSafeKey::new(key))
}

/// Encrypts one entry: magic, nonce, then the ciphertext with its tag.
fn seal_entry(
    key: &[u8; KEY_BYTES],
    terminal_id: &str,
    plaintext: &[u8],
) -> CommandResult<Vec<u8>> {
    let cipher = cipher(key)?;
    let mut nonce_bytes = [0u8; NONCE_BYTES];
    SystemRandom::new()
        .fill(&mut nonce_bytes)
        .map_err(|_| CommandError::Failed {
            code: "history_encrypt_failed",
            message: "Could not make a random scrollback nonce.".to_string(),
        })?;
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let mut body = plaintext.to_vec();
    cipher
        .seal_in_place_append_tag(nonce, Aad::from(entry_aad(terminal_id)), &mut body)
        .map_err(|_| CommandError::Failed {
            code: "history_encrypt_failed",
            message: "Could not encrypt the saved terminal history.".to_string(),
        })?;
    let mut entry = Vec::with_capacity(ENTRY_MAGIC.len() + NONCE_BYTES + body.len());
    entry.extend_from_slice(ENTRY_MAGIC);
    entry.extend_from_slice(&nonce_bytes);
    entry.extend_from_slice(&body);
    Ok(entry)
}

/// Decrypts one entry. Anything that is not an entry of this version is refused, never returned
/// as text.
fn open_entry(key: &[u8; KEY_BYTES], terminal_id: &str, entry: &[u8]) -> CommandResult<Vec<u8>> {
    if !entry.starts_with(ENTRY_MAGIC) {
        return Err(CommandError::Failed {
            code: "history_unencrypted",
            message: format!("The saved history for {terminal_id} is not encrypted."),
        });
    }
    let header = ENTRY_MAGIC.len();
    let nonce_end = header + NONCE_BYTES;
    let nonce_bytes: [u8; NONCE_BYTES] = entry
        .get(header..nonce_end)
        .and_then(|bytes| bytes.try_into().ok())
        .ok_or_else(|| CommandError::Failed {
            code: "history_decrypt_failed",
            message: format!("The saved history for {terminal_id} is cut off."),
        })?;
    let cipher = cipher(key)?;
    let nonce =
        Nonce::try_assume_unique_for_key(&nonce_bytes).map_err(|_| CommandError::Failed {
            code: "history_decrypt_failed",
            message: format!("The saved history for {terminal_id} has an invalid nonce."),
        })?;
    let mut body = entry[nonce_end..].to_vec();
    let plaintext = cipher
        .open_in_place(nonce, Aad::from(entry_aad(terminal_id)), &mut body)
        .map_err(|_| CommandError::Failed {
            code: "history_decrypt_failed",
            message: format!("The saved history for {terminal_id} could not be decrypted."),
        })?;
    Ok(plaintext.to_vec())
}

/// Collects the output of one terminal while it runs.
pub struct HistoryRecorder {
    terminal_id: String,
    bytes: Vec<u8>,
    has_received_input: bool,
    /// Most bytes kept: the terminal's scrollback limit, never above `MAX_ENTRY_BYTES`.
    limit: usize,
}

impl HistoryRecorder {
    /// An empty recorder for the given terminal id. `limit_bytes` is the scrollback limit the
    /// terminal was started with; without one, or above it, `MAX_ENTRY_BYTES` holds.
    pub fn new(terminal_id: String, limit_bytes: Option<u64>) -> Self {
        let limit = limit_bytes
            .map(|limit| usize::try_from(limit).unwrap_or(usize::MAX))
            .map_or(MAX_ENTRY_BYTES, |limit| limit.min(MAX_ENTRY_BYTES));
        Self {
            terminal_id,
            bytes: Vec::new(),
            has_received_input: false,
            limit,
        }
    }

    /// Appends output, dropping the oldest bytes past the limit.
    pub fn push_output(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
        if self.bytes.len() > self.limit {
            let keep_from = {
                let kept = newest_bytes(&self.bytes, self.limit);
                self.bytes.len() - kept.len()
            };
            self.bytes.drain(..keep_from);
        }
    }

    /// Notes that the user typed into the terminal.
    pub fn mark_input(&mut self) {
        self.has_received_input = true;
    }

    /// Whether `save` will write anything. A terminal with no input is not saved.
    pub fn has_received_input(&self) -> bool {
        self.has_received_input
    }

    /// Writes the entry to `dir` unless no input was received, then evicts old entries.
    pub fn save(&self, dir: &Path) -> CommandResult<()> {
        if !self.has_received_input {
            return Ok(());
        }
        self.save_with_key(dir, &entry_key()?)
    }

    /// `save` with the key passed in, so a caller that saves several terminals reads or creates
    /// the Keychain item once.
    pub(crate) fn save_with_key(&self, dir: &Path, key: &[u8; KEY_BYTES]) -> CommandResult<()> {
        if !self.has_received_input {
            return Ok(());
        }
        ensure_private_dir(dir)?;
        let path = entry_path(dir, &self.terminal_id)?;
        let bytes = newest_bytes(&self.bytes, self.limit);
        let entry = seal_entry(key, &self.terminal_id, bytes)?;
        write_atomic(&path, &entry)?;
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
    migrate_plain_entries(&dir)?;
    evict(&dir, now_ms()?)?;
    Ok(dir)
}

/// Reads one saved entry from `dir`.
pub fn load_entry(dir: &Path, terminal_id: &str) -> CommandResult<Vec<u8>> {
    let path = entry_path(dir, terminal_id)?;
    let bytes = read_entry(&path, terminal_id)?;
    open_entry(&entry_key()?, terminal_id, &bytes)
}

/// `load_entry` with the key passed in.
#[cfg(test)]
pub(crate) fn load_entry_with_key(
    dir: &Path,
    terminal_id: &str,
    key: &[u8; KEY_BYTES],
) -> CommandResult<Vec<u8>> {
    let path = entry_path(dir, terminal_id)?;
    let bytes = read_entry(&path, terminal_id)?;
    open_entry(key, terminal_id, &bytes)
}

/// Reads an entry file, mapping the errors a load reports.
fn read_entry(path: &Path, terminal_id: &str) -> CommandResult<Vec<u8>> {
    match fs::read(path) {
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

/// Encrypts every plain entry in `dir`. Run when the folder is opened, so a file written by an
/// earlier version is never served as plain text.
pub fn migrate_plain_entries(dir: &Path) -> CommandResult<usize> {
    let plain = plain_entry_paths(dir)?;
    if plain.is_empty() {
        return Ok(0);
    }
    encipher_plain_entries(plain, &entry_key()?)
}

/// `migrate_plain_entries` with the key passed in, for a test.
#[cfg(test)]
fn migrate_plain_entries_with_key(dir: &Path, key: &[u8; KEY_BYTES]) -> CommandResult<usize> {
    let plain = plain_entry_paths(dir)?;
    encipher_plain_entries(plain, key)
}

/// Every `.bin` entry in `dir` that is not encrypted yet.
fn plain_entry_paths(dir: &Path) -> CommandResult<Vec<(PathBuf, String)>> {
    let listing = match fs::read_dir(dir) {
        Ok(listing) => listing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(CommandError::Failed {
                code: "history_list_failed",
                message: format!("Could not list {}: {error}", dir.display()),
            });
        }
    };
    let mut plain = Vec::new();
    for item in listing {
        let item = item.map_err(|error| CommandError::Failed {
            code: "history_list_failed",
            message: format!("Could not list an entry in {}: {error}", dir.display()),
        })?;
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let Some(terminal_id) = name.strip_suffix(".bin") else {
            continue;
        };
        if terminal_id.is_empty() {
            continue;
        }
        entry_path(dir, terminal_id)?;
        let path = item.path();
        let metadata = item.metadata().map_err(|error| CommandError::Failed {
            code: "history_stat_failed",
            message: format!("Could not inspect {}: {error}", path.display()),
        })?;
        if !metadata.is_file() {
            continue;
        }
        let mut prefix = [0u8; ENTRY_MAGIC.len()];
        let read = fs::File::open(&path)
            .and_then(|mut file| file.read(&mut prefix))
            .map_err(|error| CommandError::Failed {
                code: "history_read_failed",
                message: format!("Could not read {}: {error}", path.display()),
            })?;
        if read != ENTRY_MAGIC.len() || prefix.as_slice() != ENTRY_MAGIC {
            plain.push((path, terminal_id.to_string()));
        }
    }
    Ok(plain)
}

/// Encrypts the named entries in place and reports how many were written.
fn encipher_plain_entries(
    plain: Vec<(PathBuf, String)>,
    key: &[u8; KEY_BYTES],
) -> CommandResult<usize> {
    let mut migrated = 0;
    for (path, terminal_id) in plain {
        let bytes = fs::read(&path).map_err(|error| CommandError::Failed {
            code: "history_read_failed",
            message: format!("Could not read {}: {error}", path.display()),
        })?;
        let entry = seal_entry(key, &terminal_id, &bytes)?;
        write_atomic(&path, &entry)?;
        migrated += 1;
    }
    Ok(migrated)
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

/// The escape character that starts every terminal control sequence.
const ESC: u8 = 0x1b;

/// The last `limit` bytes at most, starting just after the first newline inside them, else at
/// the first escape character, else at the first UTF-8 character start.
fn newest_bytes(bytes: &[u8], limit: usize) -> &[u8] {
    if bytes.len() <= limit {
        return bytes;
    }
    let window = &bytes[bytes.len() - limit..];
    if let Some(newline) = window.iter().position(|byte| *byte == b'\n') {
        return &window[newline + 1..];
    }
    if let Some(escape) = window.iter().position(|byte| *byte == ESC) {
        return &window[escape..];
    }
    // A UTF-8 continuation byte has the bit pattern 10xxxxxx.
    let start = window
        .iter()
        .position(|byte| byte & 0b1100_0000 != 0b1000_0000)
        .unwrap_or(window.len());
    &window[start..]
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

    /// The key every test encrypts with. The Keychain path has its own test below.
    const TEST_KEY: [u8; KEY_BYTES] = [7u8; KEY_BYTES];

    fn recorder(terminal_id: &str, bytes: &[u8]) -> HistoryRecorder {
        let mut recorder = HistoryRecorder::new(terminal_id.to_string(), None);
        recorder.mark_input();
        recorder.push_output(bytes);
        recorder
    }

    #[test]
    fn plat_08_saving_sixty_mib_over_three_terminals_evicts_the_oldest() {
        let folder = TempDir::new("evict");
        let mut block = vec![b'x'; 1024 * 1024];
        let last = block.len() - 1;
        block[last] = b'\n';

        for index in 0..3 {
            let id = format!("terminal-{index}");
            let mut recorder = HistoryRecorder::new(id.clone(), None);
            recorder.mark_input();
            for _ in 0..20 {
                recorder.push_output(&block);
            }
            recorder
                .save_with_key(folder.path(), &TEST_KEY)
                .expect("save history");
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
        let mut quiet = HistoryRecorder::new("pty-quiet".to_string(), None);
        quiet.push_output(b"setup output\n");
        quiet
            .save_with_key(folder.path(), &TEST_KEY)
            .expect("save history");
        assert!(!folder.entry("pty-quiet").exists());

        quiet.mark_input();
        quiet
            .save_with_key(folder.path(), &TEST_KEY)
            .expect("save history");
        assert!(folder.entry("pty-quiet").exists());
    }

    #[test]
    fn plat_08_saved_history_reads_back_byte_for_byte() {
        let folder = TempDir::new("read-back");
        let output: &[u8] = b"line one\n\x1b[31mline two\x1b[0m\n";
        recorder("pty-read", output)
            .save_with_key(folder.path(), &TEST_KEY)
            .expect("save history");

        let loaded =
            load_entry_with_key(folder.path(), "pty-read", &TEST_KEY).expect("load history");
        assert_eq!(loaded.as_slice(), output);
    }

    #[test]
    fn plat_08_a_saved_history_file_does_not_hold_its_text_in_plain_form() {
        let folder = TempDir::new("at-rest");
        let output: &[u8] = b"line one\nSECRET-TOKEN-123456\n";
        recorder("pty-secret", output)
            .save_with_key(folder.path(), &TEST_KEY)
            .expect("save history");

        let on_disk = fs::read(folder.entry("pty-secret")).expect("read the saved file");
        assert!(on_disk.starts_with(ENTRY_MAGIC), "the entry is encrypted");
        assert!(
            !on_disk.windows(output.len()).any(|window| window == output),
            "the saved file holds the terminal's text in plain form"
        );
        assert!(
            !on_disk
                .windows(b"SECRET-TOKEN-123456".len())
                .any(|window| window == b"SECRET-TOKEN-123456"),
            "the saved file holds part of the terminal's text in plain form"
        );

        let loaded = load_entry_with_key(folder.path(), "pty-secret", &TEST_KEY)
            .expect("load the encrypted history");
        assert_eq!(loaded.as_slice(), output);
    }

    #[test]
    fn plat_08_a_plain_entry_is_encrypted_on_first_use_and_reads_back() {
        let folder = TempDir::new("migrate");
        let output: &[u8] = b"history from the plain version\n";
        fs::write(folder.entry("pty-plain"), output).expect("seed a plain entry");

        let migrated = migrate_plain_entries_with_key(folder.path(), &TEST_KEY)
            .expect("encrypt the plain entry");
        assert_eq!(migrated, 1);

        let on_disk = fs::read(folder.entry("pty-plain")).expect("read the migrated entry");
        assert!(
            on_disk.starts_with(ENTRY_MAGIC),
            "the migrated entry is encrypted"
        );
        assert!(
            !on_disk.windows(output.len()).any(|window| window == output),
            "the migrated entry still holds its text in plain form"
        );

        let loaded = load_entry_with_key(folder.path(), "pty-plain", &TEST_KEY)
            .expect("read the migrated history");
        assert_eq!(loaded.as_slice(), output);

        let again = migrate_plain_entries_with_key(folder.path(), &TEST_KEY)
            .expect("run the migration again");
        assert_eq!(again, 0, "an encrypted entry is left alone");
        let names: Vec<String> = fs::read_dir(folder.path())
            .expect("list folder")
            .map(|item| {
                item.expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["pty-plain.bin".to_string()]);
    }

    #[test]
    fn plat_08_a_plain_entry_is_never_returned_as_text() {
        let folder = TempDir::new("plain-read");
        fs::write(folder.entry("pty-plain"), b"not encrypted\n").expect("seed a plain entry");

        let error = load_entry_with_key(folder.path(), "pty-plain", &TEST_KEY)
            .expect_err("a plain entry is refused");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "history_unencrypted",
                ..
            }
        ));
    }

    #[test]
    fn plat_08_an_entry_under_another_key_is_not_read() {
        let folder = TempDir::new("wrong-key");
        recorder("pty-other", b"written under one key\n")
            .save_with_key(folder.path(), &TEST_KEY)
            .expect("save history");

        let mut other = TEST_KEY;
        other[0] ^= 0xff;
        let error = load_entry_with_key(folder.path(), "pty-other", &other)
            .expect_err("another key must not open the entry");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "history_decrypt_failed",
                ..
            }
        ));
    }

    #[test]
    fn plat_08_the_encryption_key_is_created_once_and_reused() {
        struct KeyItem {
            service: String,
            account: String,
        }

        impl Drop for KeyItem {
            fn drop(&mut self) {
                if let Err(error) = keychain::remove_secret(&self.service, &self.account) {
                    eprintln!(
                        "could not remove test Keychain item {}: {error}",
                        self.account
                    );
                }
            }
        }

        let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let item = KeyItem {
            service: format!("plat-08-key-service-{}-{counter}", std::process::id()),
            account: format!("plat-08-key-account-{}-{counter}", std::process::id()),
        };

        assert!(
            keychain::read_secret(&item.service, &item.account)
                .expect("read a missing key")
                .is_none(),
            "the test starts without a key"
        );

        let first = load_or_create_key(&item.service, &item.account).expect("create the key");
        let stored = keychain::read_secret(&item.service, &item.account)
            .expect("read the stored key")
            .expect("the key is stored");
        let decoded = decode_key(&stored).expect("the stored key is valid");
        assert_eq!(decoded, first);
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(&stored)
                .expect("the stored value is base64")
                .len(),
            KEY_BYTES
        );

        let second = load_or_create_key(&item.service, &item.account).expect("read the key again");
        assert_eq!(second, first, "the second read reuses the same key");
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
    fn plat_08_a_cut_without_a_newline_never_starts_inside_a_sequence_or_a_character() {
        // The raw cut lands inside `\x1b[31m`; the kept bytes start at the next sequence.
        assert_eq!(
            newest_bytes(b"\x1b[31mabc\x1b[0mdef", 13),
            &b"\x1b[0mdef"[..]
        );
        // The raw cut lands inside a two-byte character; the kept bytes start at the next one.
        let text = "\u{e9}\u{e9}\u{e9}".as_bytes();
        assert_eq!(newest_bytes(text, 3), "\u{e9}".as_bytes());
        assert!(std::str::from_utf8(newest_bytes(text, 5)).is_ok());
    }

    #[test]
    fn plat_08_the_scrollback_limit_caps_the_saved_history() {
        let folder = TempDir::new("limit");
        let mut recorder = HistoryRecorder::new("pty-limited".to_string(), Some(1024 * 1024));
        recorder.mark_input();
        let line = b"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcde\n";
        for _ in 0..(3 * 1024 * 1024 / line.len()) {
            recorder.push_output(line);
        }

        recorder
            .save_with_key(folder.path(), &TEST_KEY)
            .expect("save history");

        let saved = fs::metadata(folder.entry("pty-limited"))
            .expect("the entry")
            .len();
        assert!(saved <= 1024 * 1024, "the entry holds {saved} bytes");
        assert!(
            saved > 1024 * 1024 - 2 * line.len() as u64,
            "the entry holds {saved} bytes"
        );
    }

    #[test]
    fn plat_08_a_limit_above_the_record_cap_keeps_the_record_cap() {
        let mut recorder = HistoryRecorder::new("pty-huge".to_string(), Some(1024 * 1024 * 1024));
        let chunk = vec![b'a'; 1024 * 1024];
        for _ in 0..21 {
            recorder.push_output(&chunk);
        }
        assert!(recorder.bytes.len() <= MAX_ENTRY_BYTES);
    }

    #[test]
    fn plat_08_push_output_keeps_at_most_one_entry_limit() {
        let mut recorder = HistoryRecorder::new("pty-big".to_string(), None);
        let chunk = vec![b'a'; 1024 * 1024];
        for _ in 0..21 {
            recorder.push_output(&chunk);
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
            .save_with_key(folder.path(), &TEST_KEY)
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
            .save_with_key(folder.path(), &TEST_KEY)
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
            .save_with_key(&dir, &TEST_KEY)
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
            .save_with_key(folder.path(), &TEST_KEY)
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
