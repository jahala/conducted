//! @feature PLAT-02 The app's one database connection
//!
//! Owns: `DatabaseState`, the one SQLite connection to `conducted.db` that every statement of the
//! UI runs on, from the first `db_open` until the app exits, and the commands `db_open`,
//! `db_execute` and `db_select`.
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A11 (Rust migrates the database
//! before the UI reads it), services-map.md 1.1 (the UI reads and writes through the Platform).
//! Must handle:
//! - A transaction is BEGIN IMMEDIATE, its statements and COMMIT sent as separate commands, so all
//!   of them must reach one connection (issue #616). There is one connection and no pool: nothing
//!   closes it while the app runs and nothing opens a second one, so a transaction cannot be split
//!   across connections, and a connection's own state (a TEMP table, an ATTACH) lasts as long as
//!   the app.
//! - `db_open` opens the file, creating it when missing, the first time. It runs the migrations on
//!   a connection of their own, closed before the app's connection opens, and keeps sqlx's
//!   `_sqlx_migrations` records, so a database tauri-plugin-sql migrated opens unchanged. A later
//!   call changes nothing. A failed open leaves nothing open, so the next call tries again.
//! - Once the connection is closed (at exit) it is never opened again: every later command fails
//!   with `db_closed`. A connection SQLite can no longer use fails each statement in the same way,
//!   so no later statement of a transaction runs on a new connection and saves on its own.
//! - Values bind as tauri-plugin-sql 2.6 bound them, so a statement writes what it wrote before
//!   (D137): null, text, every number as a REAL (an INTEGER column's affinity stores 3.0 as 3),
//!   and a boolean, array or object as its JSON text.
//! - A row is an object keyed by column name, in column order: NULL is null, INTEGER and REAL are
//!   numbers, TEXT is a string and a BLOB is an array of bytes.
//!
//! Our design choice: our own commands over one sqlx connection instead of tauri-plugin-sql, whose
//! pool closes a connection after 30 minutes of life or 10 idle and lets any caller replace the
//! pool, with no setting for either (D137).
//! Test first: tests/plat_02_database.rs, "a lost connection saves no part of an open transaction".

use std::path::Path;

use serde::Serialize;
use serde::ser::SerializeMap;
use serde_json::Value as JsonValue;
use sqlx::migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator};
use sqlx::sqlite::{SqliteArguments, SqliteConnectOptions, SqliteConnection, SqlitePoolOptions};
use sqlx::{Column, ConnectOptions, Connection, Executor, Row, Sqlite, TypeInfo, ValueRef};
use tauri::{AppHandle, Runtime, State};
use tokio::sync::Mutex;

use crate::db;
use crate::error::{CommandError, CommandResult};

/// Where the app's connection is in its life. It moves forward only: `Closed` never reopens.
enum Slot {
    Unopened,
    Open(SqliteConnection),
    Closed,
}

/// The app's one database connection.
pub struct DatabaseState {
    slot: Mutex<Slot>,
}

impl Default for DatabaseState {
    fn default() -> Self {
        Self {
            slot: Mutex::new(Slot::Unopened),
        }
    }
}

/// The answer of `db_execute`.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResult {
    pub rows_affected: u64,
    pub last_insert_id: i64,
}

/// One selected row: its columns in the order the statement names them.
#[derive(Debug, Clone, PartialEq)]
pub struct SqlRow(Vec<(String, JsonValue)>);

impl Serialize for SqlRow {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (name, value) in &self.0 {
            map.serialize_entry(name, value)?;
        }
        map.end()
    }
}

/// The migrations in db.rs, as sqlx's migrator reads them. The checksum is sqlx's hash of the SQL,
/// so a database tauri-plugin-sql migrated is recognised as migrated.
#[derive(Debug)]
struct AppMigrations(Vec<SqlxMigration>);

impl MigrationSource<'static> for AppMigrations {
    fn resolve(
        self,
    ) -> futures_util::future::BoxFuture<
        'static,
        Result<Vec<SqlxMigration>, sqlx::error::BoxDynError>,
    > {
        Box::pin(async move { Ok(self.0) })
    }
}

fn app_migrations() -> AppMigrations {
    AppMigrations(
        db::migrations()
            .into_iter()
            .map(|migration| {
                SqlxMigration::new(
                    migration.version,
                    migration.description.into(),
                    MigrationType::ReversibleUp,
                    migration.sql.into(),
                    false,
                )
            })
            .collect(),
    )
}

/// Runs the migrations on a connection of their own, closed before the app's connection opens.
/// sqlx's migrator takes a pool here: on a bare connection the command's future cannot be shown
/// to be `Send`.
async fn migrate(options: &SqliteConnectOptions) -> CommandResult<()> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options.clone())
        .await
        .map_err(|error| failed("db_open_failed", error))?;
    let migrated = match Migrator::new(app_migrations()).await {
        Ok(migrator) => migrator.run(&pool).await,
        Err(error) => Err(error),
    };
    pool.close().await;
    migrated.map_err(|error| failed("db_migration_failed", error))
}

fn failed(code: &'static str, error: impl std::fmt::Display) -> CommandError {
    CommandError::Failed {
        code,
        message: error.to_string(),
    }
}

fn closed() -> CommandError {
    CommandError::Failed {
        code: "db_closed",
        message: "The database connection has closed. Quit and reopen Conducted.".to_owned(),
    }
}

fn not_open() -> CommandError {
    CommandError::Failed {
        code: "db_not_open",
        message: "The database is not open yet.".to_owned(),
    }
}

/// Opens the connection to `path` and migrates it, once. A later call while it is open changes
/// nothing; a call after `close` fails with `db_closed`.
pub async fn open(state: &DatabaseState, path: &Path) -> CommandResult<()> {
    let mut slot = state.slot.lock().await;
    match &*slot {
        Slot::Open(_) => return Ok(()),
        Slot::Closed => return Err(closed()),
        Slot::Unopened => {}
    }
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder)?;
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    migrate(&options).await?;
    let connection = options
        .connect()
        .await
        .map_err(|error| failed("db_open_failed", error))?;
    *slot = Slot::Open(connection);
    Ok(())
}

/// Closes the connection for good. Every later command fails with `db_closed`.
pub async fn close(state: &DatabaseState) -> CommandResult<()> {
    let mut slot = state.slot.lock().await;
    match std::mem::replace(&mut *slot, Slot::Closed) {
        Slot::Open(connection) => connection
            .close()
            .await
            .map_err(|error| failed("db_close_failed", error)),
        Slot::Unopened | Slot::Closed => Ok(()),
    }
}

/// Binds each value the way tauri-plugin-sql 2.6 did (see the header).
fn bind_all<'q>(
    mut query: sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>>,
    values: Vec<JsonValue>,
) -> sqlx::query::Query<'q, Sqlite, SqliteArguments<'q>> {
    for value in values {
        query = match value {
            JsonValue::Null => query.bind(None::<String>),
            JsonValue::String(text) => query.bind(text),
            JsonValue::Number(number) => query.bind(number.as_f64().unwrap_or_default()),
            other => query.bind(other.to_string()),
        };
    }
    query
}

/// One column's value as JSON, by the value's own SQLite storage class.
fn column_json(row: &sqlx::sqlite::SqliteRow, index: usize) -> Result<JsonValue, sqlx::Error> {
    let raw = row.try_get_raw(index)?;
    if raw.is_null() {
        return Ok(JsonValue::Null);
    }
    let kind = raw.type_info().name().to_owned();
    Ok(match kind.as_str() {
        "INTEGER" => JsonValue::from(row.try_get::<i64, _>(index)?),
        "REAL" => JsonValue::from(row.try_get::<f64, _>(index)?),
        "TEXT" => JsonValue::from(row.try_get::<String, _>(index)?),
        "BLOB" => JsonValue::from(row.try_get::<Vec<u8>, _>(index)?),
        _ => {
            return Err(sqlx::Error::Decode(
                format!("SQLite answered a value of type {kind}").into(),
            ));
        }
    })
}

/// Runs one statement (or several, separated by semicolons) on the app's connection.
pub async fn execute(
    state: &DatabaseState,
    query: &str,
    values: Vec<JsonValue>,
) -> CommandResult<ExecuteResult> {
    let mut slot = state.slot.lock().await;
    let connection = match &mut *slot {
        Slot::Open(connection) => connection,
        Slot::Unopened => return Err(not_open()),
        Slot::Closed => return Err(closed()),
    };
    let result = connection
        .execute(bind_all(sqlx::query(query), values))
        .await
        .map_err(|error| failed("db_statement_failed", error))?;
    Ok(ExecuteResult {
        rows_affected: result.rows_affected(),
        last_insert_id: result.last_insert_rowid(),
    })
}

/// Runs one query on the app's connection and returns its rows.
pub async fn select(
    state: &DatabaseState,
    query: &str,
    values: Vec<JsonValue>,
) -> CommandResult<Vec<SqlRow>> {
    let mut slot = state.slot.lock().await;
    let connection = match &mut *slot {
        Slot::Open(connection) => connection,
        Slot::Unopened => return Err(not_open()),
        Slot::Closed => return Err(closed()),
    };
    let rows = connection
        .fetch_all(bind_all(sqlx::query(query), values))
        .await
        .map_err(|error| failed("db_statement_failed", error))?;
    rows.iter()
        .map(|row| {
            row.columns()
                .iter()
                .enumerate()
                .map(|(index, column)| {
                    column_json(row, index).map(|value| (column.name().to_owned(), value))
                })
                .collect::<Result<Vec<_>, _>>()
                .map(SqlRow)
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| failed("db_statement_failed", error))
}

/// Opens `conducted.db` in the app config folder and migrates it. The UI calls it before its first
/// statement, after `db_version_check` (PLAT-17).
#[tauri::command]
pub async fn db_open<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, DatabaseState>,
) -> CommandResult<()> {
    let path = db::database_path(&app)?;
    open(&state, &path).await
}

/// Runs a statement with `$1..$n` values.
#[tauri::command]
pub async fn db_execute(
    state: State<'_, DatabaseState>,
    query: String,
    values: Vec<JsonValue>,
) -> CommandResult<ExecuteResult> {
    execute(&state, &query, values).await
}

/// Runs a query with `$1..$n` values and returns its rows.
#[tauri::command]
pub async fn db_select(
    state: State<'_, DatabaseState>,
    query: String,
    values: Vec<JsonValue>,
) -> CommandResult<Vec<SqlRow>> {
    select(&state, &query, values).await
}
