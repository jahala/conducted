//! @feature PLAT-17 Block startup when the database is newer than the app
//!
//! Owns: the migration list for `conducted.db`, and the check that stops the app when the
//! database was migrated by a newer version. The UI reads and writes through tauri-plugin-sql; this
//! module only defines the schema and guards it.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A11 (Conductor's migrations and
//! rollback guard: at startup the database version is compared with the app's newest migration, and
//! a newer database produces a warning instead of running; `get_db_version_warning` hands it to
//! the UI).
//!
//! Must handle:
//! - The check must run before the UI opens the database. Opening it through the plugin runs
//!   migrations, and a database with applied versions the app does not know makes the migrator
//!   fail with a message the user cannot act on.
//! - The version is the highest `version` with `success = 1` in the `_sqlx_migrations` table that
//!   the plugin keeps. It is read with a read-only connection, so the check never creates or
//!   changes the file.
//! - No database file yet: state `fresh`. A file without the table: state `fresh`.
//! - A row with `success = 0` means a migration failed half way: state `failed_migration`.
//! - A database version above `app_schema_version()`: state `database_newer`, with a message that
//!   tells the user to update the app. The app does not offer to migrate down.
//! - Never edit an applied migration; add a new numbered file and a new entry in `migrations()`.
//!
//! Our design choice: no down-migrations and no rollback table. Conductor keeps a
//! `migration_rollbacks` table; for us "update the app" is the only supported fix.
//! Our design choice: the database file is `conducted.db` in the app config folder, which is where
//! tauri-plugin-sql puts it (the same folder as the app data folder on macOS). The implementation
//! adds `rusqlite` for the read-only query.
//!
//! Test first: a temp database whose `_sqlx_migrations` holds a version one higher than
//! `app_schema_version()` yields `database_newer`; one at the same version yields `ok`.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_sql::{Migration, MigrationKind};

use crate::error::CommandResult;
use crate::not_implemented;

pub const DB_URL: &str = "sqlite:conducted.db";

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "init",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "archive_times_and_env_uniqueness",
            sql: include_str!("../migrations/0002_archive_times_and_env_uniqueness.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "diff_comment_side",
            sql: include_str!("../migrations/0003_diff_comment_side.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "review_states_backlog_snippets_keys",
            sql: include_str!("../migrations/0004_review_states_backlog_snippets_keys.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// The highest migration version this build knows.
pub fn app_schema_version() -> i64 {
    migrations().iter().map(|m| m.version).max().unwrap_or(0)
}

/// How the database file compares with this build.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DbVersionState {
    /// The database is at this build's version or older and will be migrated normally.
    Ok,
    /// There is no database yet, so there is nothing to protect.
    Fresh,
    /// A migration failed earlier and left a half-applied state.
    FailedMigration,
    /// The database was migrated by a newer app. Starting would fail or lose data.
    DatabaseNewer,
}

/// Result of `db_version_check`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbVersionCheck {
    pub state: DbVersionState,
    /// Highest version this build knows.
    pub app_version: i64,
    /// Highest successfully applied version in the file, when there is one.
    pub db_version: Option<i64>,
    /// Plain-language text for the blocking screen. Set when `state` is not `ok` or `fresh`.
    pub message: Option<String>,
}

/// Compares the database file with this build. The UI calls it at startup and shows a blocking
/// screen unless the state is `ok` or `fresh`.
#[tauri::command]
#[allow(unused_variables)]
pub async fn db_version_check(app: AppHandle) -> CommandResult<DbVersionCheck> {
    not_implemented!("PLAT-17")
}
