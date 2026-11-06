//! @feature PLAT-18 App log files and log export
//!
//! Owns: writing the UI's log lines to NDJSON files on disk, redacting secrets, keeping the files
//! within a size and age limit, and bundling them for a bug report.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A7 (app-logger: an in-memory ring
//! buffer of UI, Rust and sidecar logs with optional disk persistence and export;
//! `submit_app_logs`, `export_app_logs`) and D1 (`logs/` in the data dir). services-map.md
//! 5B.11.4 describes the redaction of every log record. ui-map.md 2 describes the diagnostics
//! page that offers the export.
//!
//! Must handle:
//! - `log_write` is called often and returns at once. It puts the record on a bounded channel; the
//!   writer thread owns the file.
//! - Records are one JSON object per line: time (ms since epoch), level, source (`ui`), message,
//!   optional data. A level other than `error`, `warn`, `info` or `debug` fails with
//!   `log_bad_level`.
//! - `log_set_level` changes the level at run time. A record below the level is not written.
//! - Secrets must not reach disk. Any data key that contains token, secret, password, key,
//!   authorization or credential (case-insensitive) is replaced by `"[redacted]"`. The keyboard
//!   and shortcut names `keyboard`, `keybinding`, `keycode`, `keypress` and `keymap` are kept
//!   unless another secret word is present. Known token shapes in strings, such as a bearer value
//!   or an `sk-` key, are replaced too when they start at a word boundary, so `task-queue` and
//!   `disk-usage` survive.
//! - A message is cut at `MAX_MESSAGE_BYTES` and data at `MAX_DATA_BYTES`, with a marker.
//! - Files: `<app data>/logs/app-YYYY-MM-DD.ndjson` in UTC, mode 0600. A day's file rolls over to
//!   `app-YYYY-MM-DD-1.ndjson` at `MAX_FILE_BYTES`. Files older than `KEEP_DAYS` days are removed
//!   at start and at rollover.
//! - If the writer cannot write (disk full), it drops records and counts them. The next
//!   successful write adds one `logs dropped: N` record. The app keeps running.
//! - `logs_export` collects the app logs of the kept days plus the newest sidecar log into one
//!   file in `<app data>/exports/`, and returns its path. Exports older than `EXPORT_KEEP_DAYS`
//!   are removed. It runs on the blocking pool and does not stop the writer.
//! - Sidecar logs are capped while they grow. A file that reaches `SIDECAR_MAX_BYTES` is cut to its
//!   newest third, starting on a line boundary. At start, logs older than `SIDECAR_KEEP_HOURS`
//!   hours or above twice `SIDECAR_MAX_BYTES` are removed, and the launcher asks this module to
//!   keep the five newest.
//! - Every line is flushed as it is written, so the last lines before a crash are on disk.
//!
//! Our design choice: Rust writes the files directly. Conductor runs a separate logger process
//! with an in-memory buffer and an HTTP port; a local-only app does not need either. The sidecar
//! keeps its own log (sidecar.rs), which redacts each line with `redact_text` as it writes, and the
//! export includes it.
//! Not built here: routing the sidecar's stdout and stderr into these files belongs to the
//! sidecar launcher (PLAT-09, D026). This file only caps those logs, cleans them at start and
//! includes the newest one in an export.
//! Not built here: the Rust shell's own `eprintln!` lines reach stderr only. Routing them through
//! this writer belongs to the modules that print them (PLAT-11 notifications, PLAT-27 startup).
//! Not built here: a user switch for persistence. Every accepted record is written while the
//! writer runs; the diagnostics page that offers the switch is APP-03.
//! Our design choice: no remote export of any kind.
//!
//! Test first: a record with `{ "apiToken": "abc" }` in its data is written with
//! `"apiToken":"[redacted]"`, and `logs_export` returns a file that contains that record.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU8, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use serde_json::{Map, Value, json};
use tauri::{AppHandle, Manager, State};

use crate::error::{CommandError, CommandResult, blocking};

/// Days of app log files kept.
pub const KEEP_DAYS: u64 = 14;
/// A day's file rolls over at this size.
pub const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
/// Longest message kept in one record.
pub const MAX_MESSAGE_BYTES: usize = 16 * 1024;
/// Largest data value kept in one record.
pub const MAX_DATA_BYTES: usize = 64 * 1024;
/// Days of exported log bundles kept.
pub const EXPORT_KEEP_DAYS: u64 = 7;
/// The sidecar log cap. A file above twice this is removed at start.
pub const SIDECAR_MAX_BYTES: u64 = 100 * 1024 * 1024;
/// Sidecar logs older than this are removed at start.
pub const SIDECAR_KEEP_HOURS: u64 = 24;

const CHANNEL_CAPACITY: usize = 4096;
pub const LOG_FOLDER: &str = "logs";
const EXPORT_FOLDER: &str = "exports";
const REDACTED: &str = "[redacted]";
const TRUNCATED: &str = "[truncated]";
const MAX_REDACT_DEPTH: u32 = 8;

/// One log record from the UI. Mirrors the arguments of `AppInfo.writeLog` in platform.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRecord {
    /// `error`, `warn`, `info` or `debug`.
    pub level: String,
    pub message: String,
    /// Any JSON value the caller wants to keep with the message.
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

/// Shared state, registered once with `.manage(LoggerState::default())`.
pub struct LoggerState {
    /// Queue into the writer thread. Records sent when the queue is full are dropped and counted.
    pub sender: Mutex<Option<SyncSender<LogRecord>>>,
    /// The most detailed level written, as a rank from `level_rank` (0 error to 3 debug).
    pub level: AtomicU8,
    /// Records dropped because the queue was full or the disk refused a write.
    pub dropped: Arc<AtomicU64>,
}

impl Default for LoggerState {
    fn default() -> Self {
        Self {
            sender: Mutex::new(None),
            level: AtomicU8::new(2),
            dropped: Arc::new(AtomicU64::new(0)),
        }
    }
}

/// The rank of a level, or `None` when the name is unknown. Higher ranks are more detailed.
pub fn level_rank(level: &str) -> Option<u8> {
    match level {
        "error" => Some(0),
        "warn" => Some(1),
        "info" => Some(2),
        "debug" => Some(3),
        _ => None,
    }
}

/// True when a record at `level` passes a configured level. `None` when the name is unknown.
pub fn level_allows(configured_rank: u8, level: &str) -> Option<bool> {
    level_rank(level).map(|rank| rank <= configured_rank)
}

/// The name of a level rank. A rank outside the known range falls back to `info`.
pub fn level_name(rank: u8) -> &'static str {
    match rank {
        0 => "error",
        1 => "warn",
        3 => "debug",
        _ => "info",
    }
}

fn failed(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError::Failed {
        code,
        message: message.into(),
    }
}

fn app_data_dir(app: &AppHandle) -> CommandResult<PathBuf> {
    app.path().app_data_dir().map_err(|error| {
        failed(
            "log_data_dir_failed",
            format!("Could not find the app data folder: {error}"),
        )
    })
}

/// Starts the writer thread and removes expired files. Called once from `run()`. A second call
/// does nothing and keeps the running writer.
pub fn start_writer(app: &AppHandle, state: &LoggerState) -> CommandResult<()> {
    let log_dir = app_data_dir(app)?.join(LOG_FOLDER);
    ensure_dir(&log_dir, 0o700)?;
    let mut sender = state
        .sender
        .lock()
        .map_err(|_| failed("log_state_failed", "The log state is poisoned."))?;
    if sender.is_some() {
        return Ok(());
    }
    let (queue, receiver) = mpsc::sync_channel(CHANNEL_CAPACITY);
    *sender = Some(queue);
    drop(sender);

    remove_expired(&log_dir, KEEP_DAYS, SystemTime::now());
    prune_sidecar_logs(&log_dir, SystemTime::now(), SIDECAR_MAX_BYTES);

    let dropped = Arc::clone(&state.dropped);
    thread::spawn(move || writer_loop(log_dir, receiver, dropped));
    Ok(())
}

/// Queues one record for writing.
#[tauri::command]
pub async fn log_write(state: State<'_, LoggerState>, record: LogRecord) -> CommandResult<()> {
    let allowed =
        level_allows(state.level.load(Ordering::Relaxed), &record.level).ok_or_else(|| {
            failed(
                "log_bad_level",
                format!(
                    "Unknown log level \"{}\". Use error, warn, info or debug.",
                    record.level
                ),
            )
        })?;
    if !allowed {
        return Ok(());
    }
    let sender = state
        .sender
        .lock()
        .map_err(|_| failed("log_state_failed", "The log state is poisoned."))?
        .clone();
    let Some(sender) = sender else {
        return Err(failed("log_not_running", "The log writer has not started."));
    };
    match sender.try_send(record) {
        Ok(()) => Ok(()),
        Err(TrySendError::Full(_)) => {
            state.dropped.fetch_add(1, Ordering::Relaxed);
            Ok(())
        }
        Err(TrySendError::Disconnected(_)) => {
            Err(failed("log_not_running", "The log writer is not running."))
        }
    }
}

/// Changes the level written at run time.
#[tauri::command]
pub async fn log_set_level(state: State<'_, LoggerState>, level: String) -> CommandResult<()> {
    let rank = level_rank(&level).ok_or_else(|| {
        failed(
            "log_bad_level",
            format!("Unknown log level \"{level}\". Use error, warn, info or debug."),
        )
    })?;
    state.level.store(rank, Ordering::Relaxed);
    Ok(())
}

/// Bundles the logs into one file and returns its path.
#[tauri::command]
pub async fn logs_export(app: AppHandle) -> CommandResult<String> {
    let data_dir = app_data_dir(&app)?;
    blocking("log_export_task_failed", move || {
        export_logs_in(&data_dir, now_ms())
    })
    .await
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn ensure_dir(path: &Path, mode: u32) -> CommandResult<()> {
    fs::create_dir_all(path).map_err(|error| {
        failed(
            "log_folder_failed",
            format!("Could not create {}: {error}", path.display()),
        )
    })?;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|error| {
        failed(
            "log_folder_failed",
            format!(
                "Could not set the permissions of {}: {error}",
                path.display()
            ),
        )
    })
}

fn open_log_file(path: &Path) -> io::Result<File> {
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .read(true)
        .mode(0o600)
        .open(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(file)
}

fn writer_loop(log_dir: PathBuf, receiver: Receiver<LogRecord>, dropped: Arc<AtomicU64>) {
    let mut writer = FileWriter::new(log_dir, MAX_FILE_BYTES);
    while let Ok(record) = receiver.recv() {
        let pending = dropped.swap(0, Ordering::Relaxed);
        if writer.write(&record, now_ms()).is_err() {
            dropped.fetch_add(pending.saturating_add(1), Ordering::Relaxed);
            continue;
        }
        if pending > 0 {
            let notice = LogRecord {
                level: "warn".to_string(),
                message: format!("logs dropped: {pending}"),
                data: None,
            };
            if writer.write(&notice, now_ms()).is_err() {
                dropped.fetch_add(pending, Ordering::Relaxed);
            }
        }
    }
    if let Err(error) = writer.flush() {
        eprintln!("The last log lines could not be written: {error}");
    }
}

/// Writes encoded records into the day's files. The writer thread owns one of these.
pub struct FileWriter {
    dir: PathBuf,
    max_bytes: u64,
    date: Option<String>,
    part: u32,
    file: Option<File>,
    bytes: u64,
}

impl FileWriter {
    pub fn new(dir: impl Into<PathBuf>, max_bytes: u64) -> Self {
        Self {
            dir: dir.into(),
            max_bytes,
            date: None,
            part: 0,
            file: None,
            bytes: 0,
        }
    }

    /// Writes one record as one line and flushes it.
    pub fn write(&mut self, record: &LogRecord, at_ms: i64) -> io::Result<()> {
        let line = format!("{}\n", encode_record(record, at_ms)?);
        self.write_line(&line, at_ms)
    }

    pub fn flush(&mut self) -> io::Result<()> {
        match &mut self.file {
            Some(file) => file.flush(),
            None => Ok(()),
        }
    }

    fn write_line(&mut self, line: &str, at_ms: i64) -> io::Result<()> {
        let date = utc_date(at_ms);
        if self.file.is_none() || self.date.as_deref() != Some(date.as_str()) {
            self.open(date)?;
        }
        let length = line.len() as u64;
        if self.bytes > 0 && self.bytes.saturating_add(length) > self.max_bytes {
            self.rotate(at_ms)?;
        }
        if let Some(file) = &mut self.file {
            file.write_all(line.as_bytes())?;
            file.flush()?;
            self.bytes = self.bytes.saturating_add(length);
        }
        Ok(())
    }

    fn open(&mut self, date: String) -> io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        fs::set_permissions(&self.dir, fs::Permissions::from_mode(0o700))?;
        let (mut part, mut bytes) = newest_part(&self.dir, &date);
        if bytes >= self.max_bytes {
            part += 1;
            bytes = 0;
        }
        let path = self.path(&date, part);
        let file = open_log_file(&path)?;
        self.date = Some(date);
        self.part = part;
        self.bytes = bytes;
        self.file = Some(file);
        remove_expired(&self.dir, KEEP_DAYS, SystemTime::now());
        Ok(())
    }

    fn rotate(&mut self, at_ms: i64) -> io::Result<()> {
        let date = utc_date(at_ms);
        self.part += 1;
        self.bytes = 0;
        let path = self.path(&date, self.part);
        let file = open_log_file(&path)?;
        self.date = Some(date);
        self.file = Some(file);
        remove_expired(&self.dir, KEEP_DAYS, SystemTime::now());
        Ok(())
    }

    fn path(&self, date: &str, part: u32) -> PathBuf {
        self.dir.join(file_name(date, part))
    }
}

fn file_name(date: &str, part: u32) -> String {
    if part == 0 {
        format!("app-{date}.ndjson")
    } else {
        format!("app-{date}-{part}.ndjson")
    }
}

/// The highest part written for `date` and how large it is.
fn newest_part(dir: &Path, date: &str) -> (u32, u64) {
    let mut highest = 0;
    let mut highest_bytes = 0;
    let Ok(entries) = fs::read_dir(dir) else {
        return (highest, highest_bytes);
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(part) = app_log_part(&name, date) else {
            continue;
        };
        let bytes = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
        if part > highest || (part == highest && bytes > highest_bytes) {
            highest = part;
            highest_bytes = bytes;
        }
    }
    (highest, highest_bytes)
}

fn app_log_part(name: &str, date: &str) -> Option<u32> {
    let rest = name.strip_prefix(&format!("app-{date}"))?;
    if rest == ".ndjson" {
        return Some(0);
    }
    rest.strip_prefix('-')?
        .strip_suffix(".ndjson")?
        .parse()
        .ok()
}

fn is_app_log_name(name: &str) -> bool {
    name.starts_with("app-") && name.ends_with(".ndjson")
}

fn is_sidecar_log_name(name: &str) -> bool {
    name.starts_with("sidecar-") && name.ends_with(".log")
}

/// Removes app log files older than `keep_days` days. Returns how many were removed.
pub fn remove_expired(dir: &Path, keep_days: u64, now: SystemTime) -> usize {
    let Some(cutoff) = now.checked_sub(Duration::from_secs(keep_days.saturating_mul(86_400)))
    else {
        return 0;
    };
    remove_files_older_than(dir, cutoff, is_app_log_name)
}

/// Cuts a sidecar log to its newest third when it reaches `max_bytes`. The kept part starts on a
/// line boundary. Returns true when the file was cut. The file must be open for reading and
/// writing at absolute offsets, not in append mode.
pub fn cap_sidecar_log(file: &mut File, max_bytes: u64) -> io::Result<bool> {
    let length = file.metadata()?.len();
    if length < max_bytes {
        return Ok(false);
    }
    let keep = (max_bytes / 3).max(1);
    let start = length.saturating_sub(keep);
    file.seek(SeekFrom::Start(start))?;
    let mut tail = Vec::with_capacity(keep as usize);
    file.read_to_end(&mut tail)?;
    let begin = tail
        .iter()
        .position(|byte| *byte == b'\n')
        .map_or(0, |index| index + 1);
    let kept = &tail[begin..];
    file.seek(SeekFrom::Start(0))?;
    file.write_all(kept)?;
    file.set_len(kept.len() as u64)?;
    file.flush()?;
    Ok(true)
}

/// Sidecar log files in `dir`, with the time each was last changed.
pub fn sidecar_log_files(dir: &Path) -> Vec<(PathBuf, SystemTime)> {
    log_files(dir, is_sidecar_log_name)
}

/// Keeps the newest `keep` sidecar logs and removes the rest. Returns how many were removed.
pub fn keep_newest_sidecar_logs(dir: &Path, keep: usize) -> usize {
    let mut files = sidecar_log_files(dir);
    if files.len() <= keep {
        return 0;
    }
    files.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
    files
        .into_iter()
        .skip(keep)
        .filter(|(path, _)| fs::remove_file(path).is_ok())
        .count()
}

/// Removes sidecar logs older than `SIDECAR_KEEP_HOURS` or above twice `max_bytes`.
pub fn prune_sidecar_logs(dir: &Path, now: SystemTime, max_bytes: u64) -> usize {
    let Some(cutoff) = now.checked_sub(Duration::from_secs(
        SIDECAR_KEEP_HOURS.saturating_mul(3_600),
    )) else {
        return 0;
    };
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !is_sidecar_log_name(&name) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let too_old = metadata.modified().is_ok_and(|modified| modified < cutoff);
        let too_big = metadata.len() > max_bytes.saturating_mul(2);
        if (too_old || too_big) && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn remove_files_older_than(dir: &Path, cutoff: SystemTime, wanted: fn(&str) -> bool) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !wanted(&name) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let old = metadata.modified().is_ok_and(|modified| modified < cutoff);
        if old && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

fn is_export_name(name: &str) -> bool {
    name.starts_with("conducted-logs-") && name.ends_with(".ndjson")
}

/// Builds one export under `<data>/exports/` and returns its path.
pub fn export_logs_in(data_dir: &Path, at_ms: i64) -> CommandResult<String> {
    let log_dir = data_dir.join(LOG_FOLDER);
    let export_dir = data_dir.join(EXPORT_FOLDER);
    ensure_dir(&export_dir, 0o700)?;
    if let Some(cutoff) =
        SystemTime::now().checked_sub(Duration::from_secs(EXPORT_KEEP_DAYS.saturating_mul(86_400)))
    {
        remove_files_older_than(&export_dir, cutoff, is_export_name);
    }

    let path = export_dir.join(format!("conducted-logs-{at_ms}.ndjson"));
    let mut out = open_log_file(&path)?;

    let mut app_logs = log_files(&log_dir, is_app_log_name);
    app_logs.sort_by_key(|(_, modified)| *modified);
    for (source, _) in app_logs {
        copy_into(&source, &mut out)?;
    }
    if let Some((sidecar, _)) = log_files(&log_dir, is_sidecar_log_name)
        .into_iter()
        .max_by_key(|(_, modified)| *modified)
    {
        copy_into(&sidecar, &mut out)?;
    }
    out.flush()?;
    Ok(path.to_string_lossy().into_owned())
}

fn log_files(dir: &Path, wanted: fn(&str) -> bool) -> Vec<(PathBuf, SystemTime)> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !wanted(&name) {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            if !metadata.is_file() {
                return None;
            }
            let modified = metadata.modified().ok()?;
            Some((entry.path(), modified))
        })
        .collect()
}

fn copy_into(source: &Path, out: &mut File) -> CommandResult<()> {
    let mut input = File::open(source)?;
    let copied = io::copy(&mut input, out)?;
    if copied == 0 {
        return Ok(());
    }
    input.seek(SeekFrom::End(-1))?;
    let mut last = [0u8; 1];
    input.read_exact(&mut last)?;
    if last[0] != b'\n' {
        out.write_all(b"\n")?;
    }
    Ok(())
}

/// Encodes one record as a single JSON line, with secrets redacted and long values cut.
pub fn encode_record(record: &LogRecord, at_ms: i64) -> io::Result<String> {
    let mut map = Map::new();
    map.insert("time".to_string(), json!(at_ms));
    map.insert("level".to_string(), json!(record.level));
    map.insert("source".to_string(), json!("ui"));
    map.insert(
        "message".to_string(),
        json!(truncate_with_marker(
            redact_text(&record.message),
            MAX_MESSAGE_BYTES
        )),
    );
    if let Some(data) = &record.data {
        let redacted = redact_value(data, 0);
        let encoded = serde_json::to_string(&redacted)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if encoded.len() > MAX_DATA_BYTES {
            map.insert(
                "data".to_string(),
                json!(truncate_with_marker(encoded, MAX_DATA_BYTES)),
            );
        } else {
            map.insert("data".to_string(), redacted);
        }
    }
    serde_json::to_string(&Value::Object(map))
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
}

/// True when a data key names a secret. Matching ignores case and `-`/`_`. A key that contains
/// `key` is a secret unless the word is a keyboard or shortcut name.
pub fn key_is_secret(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    let compact: String = lower
        .chars()
        .filter(|character| *character != '-' && *character != '_')
        .collect();
    if [
        "token",
        "secret",
        "password",
        "authorization",
        "credential",
        "apikey",
    ]
    .iter()
    .any(|part| compact.contains(part))
    {
        return true;
    }
    if ["keyboard", "keybinding", "keycode", "keypress", "keymap"]
        .iter()
        .any(|allowed| compact.contains(allowed))
    {
        return false;
    }
    compact.contains("key")
}

fn redact_value(value: &Value, depth: u32) -> Value {
    if depth >= MAX_REDACT_DEPTH {
        return json!("[depth limit]");
    }
    match value {
        Value::Object(object) => {
            let mut out = Map::new();
            for (key, item) in object {
                if key_is_secret(key) {
                    out.insert(key.clone(), json!(REDACTED));
                } else {
                    out.insert(key.clone(), redact_value(item, depth + 1));
                }
            }
            Value::Object(out)
        }
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| redact_value(item, depth + 1))
                .collect(),
        ),
        Value::String(text) => Value::String(redact_text(text)),
        other => other.clone(),
    }
}

/// Replaces known token shapes in a string. Key names stay; only the value is replaced.
pub fn redact_text(input: &str) -> String {
    let mut text = redact_prefixed(input, "Bearer ", "Bearer ", true);
    for prefix in [
        "sk-",
        "sk_live_",
        "sk_test_",
        "ghp_",
        "gho_",
        "ghu_",
        "ghs_",
        "ghr_",
        "github_pat_",
        "cond_",
        "crsr_",
        "whsec_",
        "npm_",
        "glpat-",
        "xoxb-",
        "xoxp-",
        "xapp-",
        "xwfp-",
        "AIza",
        "AKIA",
        "ASIA",
        "fo1_",
        "fm1_",
        "fm2_",
        "eyJ",
    ] {
        text = redact_prefixed(&text, prefix, prefix, false);
    }
    text
}

fn redact_prefixed(input: &str, needle: &str, prefix_out: &str, ignore_case: bool) -> String {
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    loop {
        let found = if ignore_case {
            find_ignore_case(&input[cursor..], needle)
        } else {
            input[cursor..].find(needle)
        };
        let Some(relative) = found else {
            out.push_str(&input[cursor..]);
            break;
        };
        let index = cursor + relative;
        let starts_a_word = index == 0
            || input[..index]
                .chars()
                .next_back()
                .is_some_and(|previous| !previous.is_alphanumeric());
        if !starts_a_word {
            let after = index + needle.len();
            out.push_str(&input[cursor..after]);
            cursor = after;
            continue;
        }
        out.push_str(&input[cursor..index]);
        let after = &input[index + needle.len()..];
        let end = after
            .find(|character: char| !is_token_character(character))
            .unwrap_or(after.len());
        if end == 0 {
            out.push_str(&input[index..index + needle.len()]);
            cursor = index + needle.len();
            continue;
        }
        out.push_str(prefix_out);
        out.push_str(REDACTED);
        cursor = index + needle.len() + end;
    }
    out
}

fn find_ignore_case(haystack: &str, needle: &str) -> Option<usize> {
    let haystack = haystack.as_bytes();
    let needle = needle.as_bytes();
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    (0..=haystack.len() - needle.len())
        .find(|start| haystack[*start..*start + needle.len()].eq_ignore_ascii_case(needle))
}

fn is_token_character(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-' | '+' | '/' | '=')
}

/// Cuts a string at `max` bytes and appends a marker. A cut never splits a UTF-8 character.
pub fn truncate_with_marker(text: String, max: usize) -> String {
    if text.len() <= max {
        return text;
    }
    if max <= TRUNCATED.len() {
        return TRUNCATED.to_string();
    }
    let mut end = max - TRUNCATED.len();
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let mut out = text[..end].to_string();
    out.push_str(TRUNCATED);
    out
}

/// The UTC date of a time in milliseconds since the epoch, as `YYYY-MM-DD`.
pub fn utc_date(at_ms: i64) -> String {
    let (year, month, day) = civil_from_days(at_ms.div_euclid(86_400_000));
    format!("{year:04}-{month:02}-{day:02}")
}

/// Converts days since the epoch to a civil date (Howard Hinnant's algorithm).
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * month_position + 2) / 5 + 1) as u32;
    let month = if month_position < 10 {
        month_position + 3
    } else {
        month_position - 9
    } as u32;
    if month <= 2 {
        year += 1;
    }
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicU64;
    use std::sync::mpsc::sync_channel;

    /// A folder that removes itself, so a test leaves nothing behind.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-plat-18-{}-{counter}",
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

    fn record(level: &str, message: &str, data: Option<Value>) -> LogRecord {
        LogRecord {
            level: level.to_string(),
            message: message.to_string(),
            data,
        }
    }

    fn set_modified(path: &Path, time: SystemTime) {
        let file = fs::File::options()
            .write(true)
            .open(path)
            .expect("open test log");
        file.set_modified(time).expect("set test log time");
    }

    fn at(seconds: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(seconds)
    }

    #[test]
    fn plat_18_a_token_in_data_is_redacted() {
        let data = json!({ "apiToken": "abc" });
        let line = encode_record(&record("info", "sending", Some(data)), 1_000).expect("encode");
        assert!(line.contains("\"apiToken\":\"[redacted]\""), "{line}");
        assert!(!line.contains("abc"), "{line}");
    }

    #[test]
    fn plat_18_snake_case_and_nested_secret_keys_are_redacted() {
        let data = json!({
            "api_key": "one",
            "client_secret": "two",
            "authorization": "three",
            "privateKey": "four",
            "nested": { "password": "five", "safe": "kept" }
        });
        let line = encode_record(&record("info", "sending", Some(data)), 1_000).expect("encode");
        for secret in ["one", "two", "three", "four", "five"] {
            assert!(!line.contains(secret), "{secret} survived in {line}");
        }
        assert!(line.contains("\"safe\":\"kept\""), "{line}");
    }

    #[test]
    fn plat_18_bearer_values_and_key_shapes_are_redacted() {
        let text =
            redact_text("Authorization: Bearer abc.def and sk-1234567890 and ghp_abcdefghij");
        assert!(!text.contains("abc.def"), "{text}");
        assert!(!text.contains("1234567890"), "{text}");
        assert!(!text.contains("abcdefghij"), "{text}");
        assert!(text.contains("Bearer [redacted]"), "{text}");
    }

    #[test]
    fn plat_18_a_plain_message_keeps_its_words() {
        assert_eq!(
            redact_text("The sidecar started normally."),
            "The sidecar started normally."
        );
    }

    #[test]
    fn plat_18_prefixes_inside_plain_words_are_kept() {
        let text = "task-queue disk-usage risk-assessment desk-lamp reAKIAted theyJson";
        assert_eq!(redact_text(text), text);
        assert_eq!(redact_text("a sk- b"), "a sk- b");
        assert_eq!(redact_text("key=sk-1234567890"), "key=sk-[redacted]");
    }

    #[test]
    fn plat_18_key_names_that_contain_key_are_redacted() {
        let data = json!({
            "sshKey": "one",
            "encryptionKey": "two",
            "signingKey": "three",
            "keyboardLayout": "us",
            "keybindings": ["keep me"]
        });
        let line = encode_record(&record("info", "saving", Some(data)), 1_000).expect("encode");
        for secret in ["one", "two", "three"] {
            assert!(!line.contains(secret), "{secret} survived in {line}");
        }
        assert!(line.contains("\"keyboardLayout\":\"us\""), "{line}");
        assert!(line.contains("keep me"), "{line}");
    }

    #[test]
    fn plat_18_level_names_round_trip() {
        assert_eq!(level_name(0), "error");
        assert_eq!(level_name(1), "warn");
        assert_eq!(level_name(2), "info");
        assert_eq!(level_name(3), "debug");
        assert_eq!(level_name(9), "info");
    }

    #[test]
    fn plat_18_an_unknown_level_is_refused() {
        assert_eq!(level_rank("loud"), None);
        assert_eq!(level_rank("debug"), Some(3));
    }

    #[test]
    fn plat_18_the_run_time_level_filters_records() {
        assert_eq!(level_allows(2, "info"), Some(true));
        assert_eq!(level_allows(2, "debug"), Some(false));
        assert_eq!(level_allows(1, "warn"), Some(true));
        assert_eq!(level_allows(1, "error"), Some(true));
        assert_eq!(level_allows(1, "loud"), None);
    }

    #[test]
    fn plat_18_a_long_message_is_cut_with_a_marker() {
        let message = "x".repeat(MAX_MESSAGE_BYTES + 100);
        let line = encode_record(&record("info", &message, None), 1_000).expect("encode");
        assert!(line.contains(TRUNCATED), "the marker is missing");
        assert!(!line.contains(&"x".repeat(MAX_MESSAGE_BYTES + 1)));
    }

    #[test]
    fn plat_18_long_data_is_cut_with_a_marker() {
        let data = json!({ "body": "y".repeat(MAX_DATA_BYTES + 100) });
        let line = encode_record(&record("info", "big", Some(data)), 1_000).expect("encode");
        assert!(line.contains(TRUNCATED), "the marker is missing");
    }

    #[test]
    fn plat_18_a_record_has_time_level_source_and_message() {
        let line = encode_record(&record("warn", "careful", None), 1_234).expect("encode");
        let value: Value = serde_json::from_str(&line).expect("parse");
        assert_eq!(value["time"], json!(1_234));
        assert_eq!(value["level"], json!("warn"));
        assert_eq!(value["source"], json!("ui"));
        assert_eq!(value["message"], json!("careful"));
        assert!(value.get("data").is_none());
    }

    #[test]
    fn plat_18_dates_are_utc() {
        assert_eq!(utc_date(0), "1970-01-01");
        assert_eq!(utc_date(86_400_000), "1970-01-02");
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn plat_18_files_are_owner_only() {
        let folder = TempDir::new();
        let mut writer = FileWriter::new(folder.path(), MAX_FILE_BYTES);
        writer
            .write(&record("info", "hello", None), 0)
            .expect("write record");
        let path = folder.path().join("app-1970-01-01.ndjson");
        let mode = fs::metadata(&path).expect("stat log").permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let folder_mode = fs::metadata(folder.path())
            .expect("stat folder")
            .permissions()
            .mode();
        assert_eq!(folder_mode & 0o777, 0o700);
    }

    #[test]
    fn plat_18_a_full_file_rolls_over_to_the_next_part() {
        let folder = TempDir::new();
        let mut writer = FileWriter::new(folder.path(), 10);
        writer
            .write(&record("info", "first", None), 0)
            .expect("write first");
        writer
            .write(&record("info", "second", None), 0)
            .expect("write second");
        assert!(folder.path().join("app-1970-01-01.ndjson").is_file());
        assert!(folder.path().join("app-1970-01-01-1.ndjson").is_file());
    }

    #[test]
    fn plat_18_old_app_logs_are_removed() {
        let folder = TempDir::new();
        let old = folder.path().join("app-1969-12-01.ndjson");
        let fresh = folder.path().join("app-2026-11-05.ndjson");
        fs::write(&old, "{}\n").expect("write old log");
        fs::write(&fresh, "{}\n").expect("write fresh log");
        set_modified(&old, at(1_000));
        set_modified(&fresh, at(2_000_000));
        let removed = remove_expired(folder.path(), 14, at(2_000_000));
        assert_eq!(removed, 1);
        assert!(!old.exists());
        assert!(fresh.is_file());
    }

    #[test]
    fn plat_18_old_and_oversized_sidecar_logs_are_removed() {
        let folder = TempDir::new();
        let old = folder.path().join("sidecar-1.log");
        let big = folder.path().join("sidecar-2.log");
        let fresh = folder.path().join("sidecar-3.log");
        fs::write(&old, "old\n").expect("write old");
        fs::write(&big, "x".repeat(50)).expect("write big");
        fs::write(&fresh, "new\n").expect("write fresh");
        set_modified(&old, at(1_000));
        set_modified(&big, at(2_000_000));
        set_modified(&fresh, at(2_000_000));
        let removed = prune_sidecar_logs(
            folder.path(),
            UNIX_EPOCH + Duration::from_secs(2_000_000),
            10,
        );
        assert_eq!(removed, 2);
        assert!(!old.exists());
        assert!(!big.exists());
        assert!(fresh.is_file());
    }

    #[test]
    fn plat_18_a_full_sidecar_log_is_cut_to_about_a_third() {
        let folder = TempDir::new();
        let path = folder.path().join("sidecar-1.log");
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .expect("open sidecar log");
        let line = format!("[stdout] {}\n", "x".repeat(40));
        for _ in 0..20 {
            file.write_all(line.as_bytes()).expect("write a line");
        }
        file.flush().expect("flush");
        assert!(!cap_sidecar_log(&mut file, 10_000).expect("under the cap"));

        assert!(cap_sidecar_log(&mut file, 300).expect("cut the log"));
        let after = fs::metadata(&path).expect("stat log").len();
        assert!(after > 0 && after <= 100, "kept {after} bytes");
        let text = fs::read_to_string(&path).expect("read log");
        assert!(text.starts_with("[stdout] x"), "{text}");
        assert!(text.ends_with('\n'), "{text}");
    }

    #[test]
    fn plat_18_sidecar_log_lifetime_combines_age_size_and_count() {
        let folder = TempDir::new();
        let old = folder.path().join("sidecar-old.log");
        let big = folder.path().join("sidecar-big.log");
        fs::write(&old, "old\n").expect("write old");
        fs::write(&big, "x".repeat(300)).expect("write big");
        set_modified(&old, at(1_000));
        set_modified(&big, at(NOW));
        for index in 0..6 {
            let path = folder.path().join(format!("sidecar-{index}.log"));
            fs::write(&path, "fresh\n").expect("write fresh");
            set_modified(&path, at(NOW + index));
        }

        let removed = prune_sidecar_logs(folder.path(), at(NOW), 100);
        assert_eq!(removed, 2);
        assert!(!old.exists());
        assert!(!big.exists());
        let kept = keep_newest_sidecar_logs(folder.path(), 5);
        assert_eq!(kept, 1);
        assert_eq!(sidecar_log_files(folder.path()).len(), 5);
    }

    #[test]
    fn plat_18_dropped_records_are_reported_on_the_next_write() {
        let folder = TempDir::new();
        let dropped = Arc::new(AtomicU64::new(3));
        let (sender, receiver) = sync_channel(8);
        let handle = {
            let folder = folder.path().to_path_buf();
            let dropped = Arc::clone(&dropped);
            thread::spawn(move || writer_loop(folder, receiver, dropped))
        };
        sender
            .send(record("info", "after the drop", None))
            .expect("send record");
        drop(sender);
        handle.join().expect("writer finishes");

        let path = log_files(folder.path(), is_app_log_name)
            .into_iter()
            .map(|(path, _)| path)
            .next()
            .expect("the writer made a log file");
        let text = fs::read_to_string(&path).expect("read log");
        assert!(
            text.contains("logs dropped: 3"),
            "the notice is missing from {text}"
        );
        assert!(text.contains("after the drop"), "{text}");
        assert_eq!(dropped.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn plat_18_an_export_contains_the_redacted_record_and_the_sidecar_log() {
        let folder = TempDir::new();
        let logs = folder.path().join(LOG_FOLDER);
        fs::create_dir_all(&logs).expect("create log folder");
        let mut writer = FileWriter::new(logs.as_path(), MAX_FILE_BYTES);
        writer
            .write(
                &record("info", "sending", Some(json!({ "apiToken": "abc" }))),
                0,
            )
            .expect("write record");
        fs::write(logs.join("sidecar-9.log"), "sidecar line\n").expect("write sidecar log");
        set_modified(&logs.join("sidecar-9.log"), at(NOW));

        let path = export_logs_in(folder.path(), 99).expect("export");
        let text = fs::read_to_string(&path).expect("read export");
        assert!(text.contains("\"apiToken\":\"[redacted]\""), "{text}");
        assert!(!text.contains("abc"), "{text}");
        assert!(text.contains("sidecar line"), "{text}");
        let mode = fs::metadata(&path)
            .expect("stat export")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn plat_18_an_export_ends_a_log_without_a_newline_with_one() {
        let folder = TempDir::new();
        let logs = folder.path().join(LOG_FOLDER);
        fs::create_dir_all(&logs).expect("create log folder");
        fs::write(logs.join("app-1970-01-01.ndjson"), "first\nlast").expect("write log");

        let path = export_logs_in(folder.path(), 7).expect("export");
        let text = fs::read_to_string(&path).expect("read export");
        assert!(text.contains("first\nlast\n"), "{text}");
    }

    #[test]
    fn plat_18_old_exports_are_removed() {
        let folder = TempDir::new();
        let exports = folder.path().join(EXPORT_FOLDER);
        fs::create_dir_all(&exports).expect("create export folder");
        let old = exports.join("conducted-logs-1.ndjson");
        let fresh = exports.join("conducted-logs-2.ndjson");
        fs::write(&old, "{}\n").expect("write old export");
        fs::write(&fresh, "{}\n").expect("write fresh export");
        set_modified(&old, SystemTime::now() - Duration::from_secs(8 * 86_400));
        set_modified(&fresh, SystemTime::now());

        let path = export_logs_in(folder.path(), 3).expect("export");
        assert!(path.ends_with("conducted-logs-3.ndjson"));
        assert!(!old.exists());
        assert!(fresh.is_file());
    }

    const NOW: u64 = 2_000_000;
}
