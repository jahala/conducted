//! @feature APP-17 Import from Conductor: the read-only copy and the secret moves
//!
//! Owns: finding Conductor's database, copying it into a folder the import owns, reading the tables the import
//! maps from that copy, moving environment variable values from the copy straight into the
//! Keychain, and removing the copies.
//!
//! Behaviour: docs/plans/migrate-from-conductor.md, safety rules 1 (Conductor's files are only
//! read), 3 (Keychain entries the import made are removed on rollback) and 6 (secrets never show).
//! Conductor's tables are described in docs/research/conductor/services-map.md 2.2 and 4.2.8.
//!
//! Must handle:
//! - Conductor's files are only read, as bytes: SQLite never opens them, so nothing beside them is
//!   created, written or locked. A missing source is `conductor_import_missing`; a copy SQLite
//!   cannot open is `conductor_import_copy_failed`, and the half-made copy is removed.
//! - The copy is one consistent snapshot: the database, its write-ahead log and a hot journal are
//!   copied, and their size and modified time are compared before and after. A copy taken while
//!   Conductor wrote is taken again, and after three tries the error is `conductor_import_busy`.
//!   SQLite then folds the log into the copy and the copy is switched to a rollback journal, so a
//!   later read-only open needs no side files.
//! - Only a copy inside the import's own folder can be read or have secrets moved out of it
//!   (`conductor_import_bad_copy`), so the web view cannot point these commands at another file.
//! - A table Conductor does not have (an older schema) reads as `null`, never as an empty list.
//!   A BLOB value in a read table is an error that names the table and column.
//! - `env_vars.value` never leaves this module: the read answers `has_value` in its place.
//! - Moving secrets writes each value into the Keychain under the key the app chose. A move whose
//!   value is missing (`conductor_import_secret_missing`) or whose key the Keychain already holds
//!   (`conductor_import_secret_exists`) fails the whole call, and every entry this call wrote is
//!   removed first. Values never appear in an error, a log or a return value.
//!
//! Our design choice: the plan named SQLite's backup API for the copy. Opening Conductor's database
//! with SQLite, even read-only, creates `-wal` and `-shm` files beside it when Conductor is not
//! running and writes read marks into its `-shm` when it is, so the copy is made from the bytes
//! instead (D124). `std::fs::copy` clones the file on APFS, so even a large database copies at
//! once and takes no space until the copy changes.
//! Our design choice: the copy is removed with `remove_file`, not moved to the Trash. It is the
//! import's own scratch file, as large as Conductor's database, and nothing of the user's.
//!
//! Test first: a copy of a database holding a known row reads back the same row, and the source
//! file's bytes and modified time are unchanged.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{CommandError, CommandResult, blocking};
use crate::keychain::{SERVICE, read_secret, remove_secret, write_secret};

/// The folder under the app data folder that holds the copies.
pub const COPY_FOLDER: &str = "conductor-import";

/// Tables the import maps, read whole. `env_vars` is read without its values.
pub const READ_TABLES: &[&str] = &[
    "repos",
    "workspaces",
    "sessions",
    "settings",
    "env_vars",
    "navigation_sections",
    "navigation_section_memberships",
    "favorite_models",
    "diff_comments",
];

/// Tables the import leaves out or has not built yet. Only their row counts are read, so the dry
/// run can say how much stays behind.
pub const COUNTED_TABLES: &[&str] = &[
    "session_events",
    "session_messages",
    "terminal_sessions",
    "port_forwards",
    "attachments",
    "session_messages_outbox",
    "session_assets_outbox",
    "identity_associations",
];

/// Gives each copy of one process its own name.
static COPY_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CopyInfo {
    pub copy_path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Snapshot {
    /// Rows of each read table, keyed by column name. `None` when the table does not exist.
    pub tables: Map<String, Value>,
    /// Row counts of the counted tables. `None` when the table does not exist.
    pub counts: Map<String, Value>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SecretMove {
    /// Conductor's `env_vars` key, scope and context, which pick the row.
    pub name: String,
    pub scope: String,
    pub context: String,
    /// Where the value goes in the app's Keychain service.
    pub keychain_key: String,
}

fn failed(code: &'static str, message: String) -> CommandError {
    CommandError::Failed { code, message }
}

/// The import's own folder under the app data folder.
fn copy_folder<R: Runtime>(app: &AppHandle<R>) -> CommandResult<PathBuf> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| failed("conductor_import_copy_failed", error.to_string()))?;
    Ok(data.join(COPY_FOLDER))
}

/// The paths SQLite may keep beside a database file.
fn with_side_files(path: &Path) -> [PathBuf; 4] {
    let text = path.display().to_string();
    [
        path.to_path_buf(),
        PathBuf::from(format!("{text}-wal")),
        PathBuf::from(format!("{text}-shm")),
        PathBuf::from(format!("{text}-journal")),
    ]
}

/// Removes a copy and its side files. A file that is already gone is not an error.
fn remove_copy(path: &Path) -> CommandResult<()> {
    for file in with_side_files(path) {
        match fs::remove_file(&file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(failed(
                    "conductor_import_copy_failed",
                    format!("The copy {} could not be removed: {error}", file.display()),
                ));
            }
        }
    }
    Ok(())
}

/// The size and modified time of a file, or `None` when it does not exist.
fn file_state(path: &Path) -> CommandResult<Option<(u64, SystemTime)>> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(Some((
            metadata.len(),
            metadata
                .modified()
                .map_err(|error| failed("conductor_import_copy_failed", error.to_string()))?,
        ))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(failed(
            "conductor_import_copy_failed",
            format!("{} could not be read: {error}", path.display()),
        )),
    }
}

/// How often a copy is tried again when Conductor wrote to its database while it was copied.
const COPY_ATTEMPTS: usize = 3;

/// Copies `source` into `folder` and returns the copy. SQLite never opens Conductor's files: the
/// database and its write-ahead log are copied as plain bytes (a clone on APFS), and only the copy
/// is opened, where SQLite folds the log into the database. A copy taken while Conductor wrote is
/// thrown away and taken again; after `COPY_ATTEMPTS` the error asks the user to quit Conductor.
pub fn copy_database(source: &Path, folder: &Path) -> CommandResult<CopyInfo> {
    if !source.is_absolute() || !source.is_file() {
        return Err(failed(
            "conductor_import_missing",
            format!(
                "Conductor's database was not found at {}.",
                source.display()
            ),
        ));
    }
    fs::create_dir_all(folder).map_err(|error| {
        failed(
            "conductor_import_copy_failed",
            format!("The folder {} could not be made: {error}", folder.display()),
        )
    })?;
    for _ in 0..COPY_ATTEMPTS {
        let destination = next_copy_path(folder);
        match copy_once(source, &destination) {
            Ok(true) => {}
            Ok(false) => {
                remove_copy(&destination)?;
                continue;
            }
            Err(error) => {
                remove_copy(&destination)?;
                return Err(error);
            }
        }
        if let Err(error) = settle_copy(&destination) {
            remove_copy(&destination)?;
            return Err(error);
        }
        let bytes = fs::metadata(&destination)
            .map(|metadata| metadata.len())
            .map_err(|error| failed("conductor_import_copy_failed", error.to_string()))?;
        return Ok(CopyInfo {
            copy_path: destination.display().to_string(),
            bytes,
        });
    }
    Err(failed(
        "conductor_import_busy",
        "Conductor kept writing to its database while it was being copied. Quit Conductor and try again."
            .to_string(),
    ))
}

fn next_copy_path(folder: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let counter = COPY_COUNTER.fetch_add(1, Ordering::Relaxed);
    folder.join(format!(
        "conductor-{stamp}-{}-{counter}.db",
        std::process::id()
    ))
}

/// Copies the database and the log beside it as bytes. False when a file changed meanwhile.
fn copy_once(source: &Path, destination: &Path) -> CommandResult<bool> {
    let [database, log, _shared_memory, journal] = with_side_files(source);
    let [database_copy, log_copy, _, journal_copy] = with_side_files(destination);
    // The shared-memory index (`-shm`) is never copied: SQLite rebuilds it from the log.
    let pairs = [
        (database, database_copy),
        (log, log_copy),
        (journal, journal_copy),
    ];
    let states = |pairs: &[(PathBuf, PathBuf)]| {
        pairs
            .iter()
            .map(|(from, _)| file_state(from))
            .collect::<CommandResult<Vec<_>>>()
    };
    let before = states(&pairs)?;
    for ((from, to), state) in pairs.iter().zip(&before) {
        if state.is_none() {
            continue;
        }
        fs::copy(from, to).map_err(|error| {
            failed(
                "conductor_import_copy_failed",
                format!("{} could not be copied: {error}", from.display()),
            )
        })?;
    }
    Ok(before == states(&pairs)?)
}

/// Opens the copy, folds its log into it and switches it to a rollback journal, so a later
/// read-only open needs no side files.
fn settle_copy(destination: &Path) -> CommandResult<()> {
    let copy_error = |error: rusqlite::Error| {
        failed(
            "conductor_import_copy_failed",
            format!("The copy of Conductor's database could not be opened: {error}"),
        )
    };
    let connection = Connection::open(destination).map_err(copy_error)?;
    connection
        .pragma_update(None, "journal_mode", "DELETE")
        .map_err(copy_error)?;
    connection.close().map_err(|(_, error)| copy_error(error))?;
    Ok(())
}

/// Refuses a path that is not a file directly inside the import's folder.
fn check_copy(copy: &Path, folder: &Path) -> CommandResult<PathBuf> {
    let refuse = || {
        failed(
            "conductor_import_bad_copy",
            format!("{} is not a copy this import made.", copy.display()),
        )
    };
    let canonical_folder = folder.canonicalize().map_err(|_| refuse())?;
    let canonical = copy.canonicalize().map_err(|_| refuse())?;
    if canonical.parent() != Some(canonical_folder.as_path()) || !canonical.is_file() {
        return Err(refuse());
    }
    Ok(canonical)
}

fn open_copy(copy: &Path) -> CommandResult<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    Connection::open_with_flags(copy, flags).map_err(|error| {
        failed(
            "conductor_import_read_failed",
            format!("The copy of Conductor's database could not be opened: {error}"),
        )
    })
}

fn read_error(table: &str, error: rusqlite::Error) -> CommandError {
    failed(
        "conductor_import_read_failed",
        format!("Conductor's table {table} could not be read: {error}"),
    )
}

fn table_exists(connection: &Connection, table: &str) -> CommandResult<bool> {
    connection
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [table],
            |row| row.get::<_, i64>(0),
        )
        .map(|count| count > 0)
        .map_err(|error| read_error(table, error))
}

fn json_value(table: &str, column: &str, value: ValueRef<'_>) -> CommandResult<Value> {
    Ok(match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(number) => Value::from(number),
        ValueRef::Real(number) => serde_json::Number::from_f64(number)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(_) => {
            return Err(failed(
                "conductor_import_read_failed",
                format!(
                    "Conductor's column {table}.{column} holds binary data the import cannot read."
                ),
            ));
        }
    })
}

/// Every row of `sql` as an object keyed by column name.
fn read_rows(connection: &Connection, table: &str, sql: &str) -> CommandResult<Vec<Value>> {
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| read_error(table, error))?;
    let columns: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| name.to_string())
        .collect();
    let mut rows = statement
        .query([])
        .map_err(|error| read_error(table, error))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|error| read_error(table, error))? {
        let mut object = Map::new();
        for (index, column) in columns.iter().enumerate() {
            let value = row
                .get_ref(index)
                .map_err(|error| read_error(table, error))?;
            object.insert(column.clone(), json_value(table, column, value)?);
        }
        out.push(Value::Object(object));
    }
    Ok(out)
}

/// Reads the import's tables from a copy. `env_vars` comes without its values.
pub fn read_snapshot(copy: &Path) -> CommandResult<Snapshot> {
    let connection = open_copy(copy)?;
    let mut tables = Map::new();
    for table in READ_TABLES {
        if !table_exists(&connection, table)? {
            tables.insert((*table).to_string(), Value::Null);
            continue;
        }
        let sql = if *table == "env_vars" {
            "SELECT key, scope, context, value IS NOT NULL AS has_value FROM env_vars".to_string()
        } else {
            format!("SELECT * FROM \"{table}\"")
        };
        let mut rows = read_rows(&connection, table, &sql)?;
        if *table == "env_vars" {
            for row in &mut rows {
                if let Some(object) = row.as_object_mut() {
                    let has = object
                        .get("has_value")
                        .and_then(Value::as_i64)
                        .is_some_and(|flag| flag != 0);
                    object.insert("has_value".to_string(), Value::Bool(has));
                }
            }
        }
        tables.insert((*table).to_string(), Value::Array(rows));
    }
    let mut counts = Map::new();
    for table in COUNTED_TABLES {
        if !table_exists(&connection, table)? {
            counts.insert((*table).to_string(), Value::Null);
            continue;
        }
        let count: i64 = connection
            .query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |row| {
                row.get(0)
            })
            .map_err(|error| read_error(table, error))?;
        counts.insert((*table).to_string(), Value::from(count));
    }
    Ok(Snapshot { tables, counts })
}

/// Moves each value from the copy into `service`. All or nothing: a failure removes what this
/// call wrote before it returns. Returns the keys written, in order.
pub fn move_secrets(
    copy: &Path,
    moves: &[SecretMove],
    service: &str,
) -> CommandResult<Vec<String>> {
    let connection = open_copy(copy)?;
    let mut written: Vec<String> = Vec::new();
    let result = (|| -> CommandResult<()> {
        for one in moves {
            let value: Option<String> = connection
                .query_row(
                    "SELECT value FROM env_vars WHERE key = ?1 AND scope = ?2 AND context = ?3",
                    [&one.name, &one.scope, &one.context],
                    |row| row.get(0),
                )
                .map_err(|_| {
                    failed(
                        "conductor_import_secret_missing",
                        format!("Conductor holds no value for {}.", one.name),
                    )
                })?;
            let Some(value) = value else {
                return Err(failed(
                    "conductor_import_secret_missing",
                    format!("Conductor holds no value for {}.", one.name),
                ));
            };
            if read_secret(service, &one.keychain_key)?.is_some() {
                return Err(failed(
                    "conductor_import_secret_exists",
                    format!(
                        "The Keychain already holds a value for {}; the import does not replace it.",
                        one.name
                    ),
                ));
            }
            if value.len() > crate::keychain::MAX_VALUE_BYTES {
                return Err(failed(
                    "keychain_value_too_large",
                    format!(
                        "The value of {} is larger than {} bytes.",
                        one.name,
                        crate::keychain::MAX_VALUE_BYTES
                    ),
                ));
            }
            write_secret(service, &one.keychain_key, &value)?;
            written.push(one.keychain_key.clone());
        }
        Ok(())
    })();
    match result {
        Ok(()) => Ok(written),
        Err(error) => {
            let left: Vec<&str> = written
                .iter()
                .rev()
                .filter(|key| remove_secret(service, key).is_err())
                .map(String::as_str)
                .collect();
            if left.is_empty() {
                return Err(error);
            }
            Err(failed(
                error.code(),
                format!(
                    "{error} These Keychain items could not be removed again: {}.",
                    left.join(", ")
                ),
            ))
        }
    }
}

/// Removes every file in `folder`. A missing folder holds nothing.
pub fn discard_copies(folder: &Path) -> CommandResult<u64> {
    let entries = match fs::read_dir(folder) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => {
            return Err(failed(
                "conductor_import_copy_failed",
                format!(
                    "The folder {} could not be listed: {error}",
                    folder.display()
                ),
            ));
        }
    };
    let mut removed = 0;
    for entry in entries {
        let path = entry
            .map_err(|error| failed("conductor_import_copy_failed", error.to_string()))?
            .path();
        if path.is_file() {
            fs::remove_file(&path).map_err(|error| {
                failed(
                    "conductor_import_copy_failed",
                    format!("The copy {} could not be removed: {error}", path.display()),
                )
            })?;
            removed += 1;
        }
    }
    Ok(removed)
}

/// The size of Conductor's database at `source`, or `None` when there is none. Only a stat.
pub fn find_database(source: &Path) -> CommandResult<Option<u64>> {
    if !source.is_absolute() {
        return Ok(None);
    }
    Ok(file_state(source)?.map(|(bytes, _)| bytes))
}

/// Says whether Conductor's database is at `source`, and how large it is, without reading it.
#[tauri::command]
pub async fn conductor_import_find(source: String) -> CommandResult<Option<u64>> {
    blocking("conductor_import_copy_failed", move || {
        find_database(Path::new(&source))
    })
    .await
}

/// Copies Conductor's database at `source` into the import's folder.
#[tauri::command]
pub async fn conductor_import_copy<R: Runtime>(
    app: AppHandle<R>,
    source: String,
) -> CommandResult<CopyInfo> {
    let folder = copy_folder(&app)?;
    blocking("conductor_import_copy_failed", move || {
        copy_database(Path::new(&source), &folder)
    })
    .await
}

/// Reads the import's tables from a copy the import made.
#[tauri::command]
pub async fn conductor_import_read<R: Runtime>(
    app: AppHandle<R>,
    copy_path: String,
) -> CommandResult<Snapshot> {
    let folder = copy_folder(&app)?;
    blocking("conductor_import_read_failed", move || {
        let copy = check_copy(Path::new(&copy_path), &folder)?;
        read_snapshot(&copy)
    })
    .await
}

/// Moves environment variable values from a copy into the app's Keychain service.
#[tauri::command]
pub async fn conductor_import_move_secrets<R: Runtime>(
    app: AppHandle<R>,
    copy_path: String,
    moves: Vec<SecretMove>,
) -> CommandResult<Vec<String>> {
    let folder = copy_folder(&app)?;
    blocking("keychain_failed", move || {
        let copy = check_copy(Path::new(&copy_path), &folder)?;
        move_secrets(&copy, &moves, SERVICE)
    })
    .await
}

/// Removes every copy the import left in its folder. Returns how many files went.
#[tauri::command]
pub async fn conductor_import_discard<R: Runtime>(app: AppHandle<R>) -> CommandResult<u64> {
    let folder = copy_folder(&app)?;
    blocking("conductor_import_copy_failed", move || {
        discard_copies(&folder)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A folder this test alone uses, removed on drop.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-app-17-{label}-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test folder");
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            if let Err(error) = fs::remove_dir_all(&self.path) {
                eprintln!("could not remove {}: {error}", self.path.display());
            }
        }
    }

    /// Keychain items under a service this test alone uses, removed on drop.
    struct TestService {
        name: String,
        keys: Vec<String>,
    }

    impl TestService {
        fn new(keys: &[&str]) -> Self {
            let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            Self {
                name: format!("app-17-service-{}-{counter}", std::process::id()),
                keys: keys.iter().map(|key| key.to_string()).collect(),
            }
        }
    }

    impl Drop for TestService {
        fn drop(&mut self) {
            for key in &self.keys {
                if let Err(error) = remove_secret(&self.name, key) {
                    eprintln!("could not remove test Keychain item {key}: {error}");
                }
            }
        }
    }

    /// A Conductor-like database in WAL mode, the way Conductor keeps its own.
    fn conductor_database(dir: &TempDir) -> PathBuf {
        let path = dir.path.join("conductor.db");
        let connection = Connection::open(&path).expect("create source");
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .expect("wal");
        connection
            .execute_batch(
                "CREATE TABLE repos (id TEXT PRIMARY KEY, name TEXT, root_path TEXT,
                    display_order INTEGER DEFAULT 0);
                 INSERT INTO repos VALUES ('repo-1', 'alpha', '/tmp/alpha', 3);
                 CREATE TABLE env_vars (key TEXT, scope TEXT, context TEXT, value TEXT);
                 INSERT INTO env_vars VALUES ('API_TOKEN', 'shared', 'local', 'hunter2-secret');
                 INSERT INTO env_vars VALUES ('IN_KEYCHAIN', 'shared', 'local', NULL);
                 CREATE TABLE session_events (session_id TEXT, event_type TEXT);
                 INSERT INTO session_events VALUES ('s', 'agent');
                 INSERT INTO session_events VALUES ('s', 'userMessage');",
            )
            .expect("seed source");
        drop(connection);
        path
    }

    /// Size, modified time and a hash of each file in a folder.
    fn fingerprint(folder: &Path) -> Vec<(String, u64, SystemTime, Vec<u8>)> {
        let mut out = Vec::new();
        for entry in fs::read_dir(folder).expect("list folder") {
            let path = entry.expect("entry").path();
            if !path.is_file() {
                continue;
            }
            let metadata = fs::metadata(&path).expect("metadata");
            let bytes = fs::read(&path).expect("read");
            out.push((
                path.file_name()
                    .expect("name")
                    .to_string_lossy()
                    .into_owned(),
                metadata.len(),
                metadata.modified().expect("modified"),
                Sha256::digest(&bytes).to_vec(),
            ));
        }
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    fn code(error: CommandError) -> &'static str {
        error.code()
    }

    #[test]
    fn app_17_a_copy_reads_back_the_rows_and_leaves_the_source_unchanged() {
        let conductor = TempDir::new("source");
        let source = conductor_database(&conductor);
        let before = fingerprint(&conductor.path);
        let imports = TempDir::new("copies");

        let copy = copy_database(&source, &imports.path).expect("copy");
        let snapshot = read_snapshot(Path::new(&copy.copy_path)).expect("read");

        assert_eq!(fingerprint(&conductor.path), before);
        let repos = snapshot.tables["repos"].as_array().expect("repos");
        assert_eq!(repos.len(), 1);
        assert_eq!(repos[0]["name"], "alpha");
        assert_eq!(repos[0]["display_order"], 3);
        assert!(copy.bytes > 0);
        assert_eq!(snapshot.counts["session_events"], 2);
        assert_eq!(snapshot.counts["terminal_sessions"], Value::Null);
        assert_eq!(snapshot.tables["workspaces"], Value::Null);
    }

    #[test]
    fn app_17_a_copy_taken_while_conductor_runs_holds_its_unsaved_rows() {
        let conductor = TempDir::new("source");
        let source = conductor_database(&conductor);
        // Conductor running: a writer holds rows in the write-ahead log that are not in the file.
        let writer = Connection::open(&source).expect("writer");
        writer
            .pragma_update(None, "wal_autocheckpoint", 0)
            .expect("no checkpoint");
        writer
            .execute(
                "INSERT INTO repos VALUES ('repo-2', 'beta', '/tmp/beta', 4)",
                [],
            )
            .expect("write");
        assert!(conductor.path.join("conductor.db-wal").is_file());
        let before = fingerprint(&conductor.path);
        let imports = TempDir::new("copies");

        let copy = copy_database(&source, &imports.path).expect("copy");
        let snapshot = read_snapshot(Path::new(&copy.copy_path)).expect("read");

        assert_eq!(fingerprint(&conductor.path), before);
        let names: Vec<&str> = snapshot.tables["repos"]
            .as_array()
            .expect("repos")
            .iter()
            .filter_map(|row| row["name"].as_str())
            .collect();
        assert_eq!(names, vec!["alpha", "beta"]);
        let copies: Vec<String> = fs::read_dir(&imports.path)
            .expect("list")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(copies.len(), 1, "the copy kept side files: {copies:?}");
        drop(writer);
    }

    #[test]
    fn app_17_the_read_never_carries_an_environment_value() {
        let conductor = TempDir::new("source");
        let source = conductor_database(&conductor);
        let imports = TempDir::new("copies");
        let copy = copy_database(&source, &imports.path).expect("copy");

        let snapshot = read_snapshot(Path::new(&copy.copy_path)).expect("read");

        let text = serde_json::to_string(&snapshot).expect("json");
        assert!(!text.contains("hunter2"), "a value reached the answer");
        let rows = snapshot.tables["env_vars"].as_array().expect("env rows");
        assert_eq!(rows[0]["has_value"], true);
        assert_eq!(rows[1]["has_value"], false);
        assert!(rows[0].get("value").is_none());
    }

    #[test]
    fn app_17_find_only_stats_the_database() {
        let conductor = TempDir::new("source");
        let source = conductor_database(&conductor);
        let before = fingerprint(&conductor.path);

        let found = find_database(&source).expect("find");

        assert_eq!(found, Some(fs::metadata(&source).expect("stat").len()));
        assert_eq!(fingerprint(&conductor.path), before);
        assert_eq!(
            find_database(&conductor.path.join("none.db")).expect("none"),
            None
        );
        assert_eq!(
            find_database(Path::new("relative.db")).expect("relative"),
            None
        );
    }

    #[test]
    fn app_17_a_missing_source_is_its_own_error() {
        let imports = TempDir::new("copies");
        let error =
            copy_database(Path::new("/nowhere/conductor.db"), &imports.path).expect_err("missing");
        assert_eq!(code(error), "conductor_import_missing");
        assert_eq!(fs::read_dir(&imports.path).expect("list").count(), 0);
    }

    #[test]
    fn app_17_a_file_that_is_not_a_database_leaves_no_copy() {
        let conductor = TempDir::new("source");
        let source = conductor.path.join("conductor.db");
        fs::write(&source, b"this is not sqlite at all, only text").expect("write");
        let imports = TempDir::new("copies");

        let error = copy_database(&source, &imports.path).expect_err("not a database");

        assert_eq!(code(error), "conductor_import_copy_failed");
        assert_eq!(fs::read_dir(&imports.path).expect("list").count(), 0);
    }

    #[test]
    fn app_17_only_a_copy_inside_the_import_folder_is_read() {
        let conductor = TempDir::new("source");
        let source = conductor_database(&conductor);
        let imports = TempDir::new("copies");
        fs::create_dir_all(imports.path.join(COPY_FOLDER)).expect("folder");
        let folder = imports.path.join(COPY_FOLDER);

        let error = check_copy(&source, &folder).expect_err("outside");
        assert_eq!(code(error), "conductor_import_bad_copy");

        let copy = copy_database(&source, &folder).expect("copy");
        let escaped = folder
            .join("..")
            .join(COPY_FOLDER)
            .join(Path::new(&copy.copy_path).file_name().expect("name"));
        assert!(check_copy(&escaped, &folder).is_ok());
        assert_eq!(
            code(check_copy(&folder.join("missing.db"), &folder).expect_err("missing")),
            "conductor_import_bad_copy"
        );
    }

    #[test]
    fn app_17_secrets_move_into_the_keychain_and_a_failure_removes_what_it_wrote() {
        let conductor = TempDir::new("source");
        let source = conductor_database(&conductor);
        let imports = TempDir::new("copies");
        let copy = copy_database(&source, &imports.path).expect("copy");
        let service = TestService::new(&["env:global:API_TOKEN", "env:global:IN_KEYCHAIN"]);
        let token = SecretMove {
            name: "API_TOKEN".to_string(),
            scope: "shared".to_string(),
            context: "local".to_string(),
            keychain_key: "env:global:API_TOKEN".to_string(),
        };
        let no_value = SecretMove {
            name: "IN_KEYCHAIN".to_string(),
            scope: "shared".to_string(),
            context: "local".to_string(),
            keychain_key: "env:global:IN_KEYCHAIN".to_string(),
        };

        let error = move_secrets(
            Path::new(&copy.copy_path),
            &[token.clone(), no_value],
            &service.name,
        )
        .expect_err("a value is missing");
        assert_eq!(code(error), "conductor_import_secret_missing");
        assert_eq!(
            read_secret(&service.name, "env:global:API_TOKEN").expect("read"),
            None
        );

        let written = move_secrets(
            Path::new(&copy.copy_path),
            std::slice::from_ref(&token),
            &service.name,
        )
        .expect("move");
        assert_eq!(written, vec!["env:global:API_TOKEN".to_string()]);
        assert_eq!(
            read_secret(&service.name, "env:global:API_TOKEN").expect("read"),
            Some("hunter2-secret".to_string())
        );

        let again = move_secrets(Path::new(&copy.copy_path), &[token], &service.name)
            .expect_err("already there");
        let text = again.to_string();
        assert_eq!(code(again), "conductor_import_secret_exists");
        assert!(!text.contains("hunter2"), "an error carried the value");
    }

    #[test]
    fn app_17_discard_removes_every_copy() {
        let conductor = TempDir::new("source");
        let source = conductor_database(&conductor);
        let imports = TempDir::new("copies");
        copy_database(&source, &imports.path).expect("first");
        copy_database(&source, &imports.path).expect("second");

        assert_eq!(discard_copies(&imports.path).expect("discard"), 2);
        assert_eq!(fs::read_dir(&imports.path).expect("list").count(), 0);
        assert_eq!(
            discard_copies(&imports.path.join("none")).expect("missing"),
            0
        );
    }
}
