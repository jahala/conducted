//! @feature PLAT-17 Block startup when the database is newer than the app
//!
//! Owns: the migration list for `conducted.db`, and the check that stops the app when the
//! database was migrated by a newer version. The UI reads and writes through tauri-plugin-sql; this
//! module only defines the schema and guards it.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A11 (Conductor's migrations and
//! rollback guard: at startup the database version is compared with the app's newest migration, and
//! a newer database produces a warning instead of running; `get_db_version_warning` hands it to
//! the UI). Our command is `db_version_check`.
//!
//! Must handle:
//! - The check must run before the UI opens the database. Opening it through the plugin runs
//!   migrations, and a database with applied versions the app does not know makes the migrator
//!   fail with a message the user cannot act on.
//! - The version is the highest `version` with `success = 1` in the `_sqlx_migrations` table that
//!   the plugin keeps. It is read with a read-only connection, so the check never creates or
//!   changes the file.
//! - No database file yet: state `fresh`. A file without the table: state `fresh`.
//! - A database version above `app_schema_version()`: state `database_newer`, with a message that
//!   tells the user to update the app. The app does not offer to migrate down. This is checked
//!   before failed rows, so a newer database with a failed row still asks for an update.
//! - A row with `success = 0` means a migration failed half way: state `failed_migration`. The
//!   plugin's migrator refuses such a database on every start, so the message says a restart will
//!   not help, and names the file to restore from a backup and asks the user to report it.
//! - Never edit an applied migration; add a new numbered file and a new entry in `migrations()`.
//!
//! Our design choice: no down-migrations and no rollback table. Conductor keeps a
//! `migration_rollbacks` table; for us "update the app" is the only supported fix. Undo SQL and the
//! rollback command need that table, which is a new migration and so belongs to a change that may
//! edit `migrations/`.
//! Our design choice: the database file is `conducted.db` in the app config folder, which is where
//! tauri-plugin-sql puts it (the same folder as the app data folder on macOS). The implementation
//! uses `rusqlite` for the read-only query.
//!
//! Test first: a temp database whose `_sqlx_migrations` holds a version one higher than
//! `app_schema_version()` yields `database_newer`; one at the same version yields `ok`.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_sql::{Migration, MigrationKind};

use crate::error::{CommandError, CommandResult, blocking};

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
        Migration {
            version: 5,
            description: "diff_comment_suggestion_base",
            sql: include_str!("../migrations/0005_diff_comment_suggestion_base.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "model_context_windows",
            sql: include_str!("../migrations/0006_model_context_windows.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "session_fork_resume",
            sql: include_str!("../migrations/0007_session_fork_resume.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "backlog_repo_optional",
            sql: include_str!("../migrations/0008_backlog_repo_optional.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "workspace_host",
            sql: include_str!("../migrations/0009_workspace_host.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "scan_indexes",
            sql: include_str!("../migrations/0010_scan_indexes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "drop_unused_columns",
            sql: include_str!("../migrations/0011_drop_unused_columns.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "linked_folders_off_chats",
            sql: include_str!("../migrations/0012_linked_folders_off_chats.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 13,
            description: "drop_session_context_window",
            sql: include_str!("../migrations/0013_drop_session_context_window.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 14,
            description: "port_forwards",
            sql: include_str!("../migrations/0014_port_forwards.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 15,
            description: "settings_garry_mode",
            sql: include_str!("../migrations/0015_settings_garry_mode.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 16,
            description: "terminal_host",
            sql: include_str!("../migrations/0016_terminal_host.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 17,
            description: "root_path_key",
            sql: include_str!("../migrations/0017_root_path_key.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "terminal_placement",
            sql: include_str!("../migrations/0018_terminal_placement.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// The highest migration version this build knows.
pub fn app_schema_version() -> i64 {
    migrations().iter().map(|m| m.version).max().unwrap_or(0)
}

/// How the database file compares with this build.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
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

/// What the database file says about its migrations, read without the migrator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DatabaseFacts {
    /// Whether the file exists at all.
    pub exists: bool,
    /// Whether the plugin's migration table is in the file.
    pub has_migration_table: bool,
    /// The highest version whose migration finished.
    pub db_version: Option<i64>,
    /// Whether any migration row records a failure.
    pub failed_migration: bool,
}

/// The path of the database the sql plugin opens: `conducted.db` in the app config folder.
pub fn database_path(app: &AppHandle) -> CommandResult<PathBuf> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("conducted.db"))
        .map_err(|error| CommandError::Failed {
            code: "db_path_unavailable",
            message: format!("The app's config folder could not be found: {error}."),
        })
}

/// Reads the migration facts through a read-only connection. A file that does not exist is not
/// created.
pub fn read_database_facts(path: &Path) -> CommandResult<DatabaseFacts> {
    if !path.exists() {
        return Ok(DatabaseFacts {
            exists: false,
            has_migration_table: false,
            db_version: None,
            failed_migration: false,
        });
    }
    let connection = open_read_only(path)?;
    let has_migration_table = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| read_error(path, error))?;
    if !has_migration_table {
        return Ok(DatabaseFacts {
            exists: true,
            has_migration_table: false,
            db_version: None,
            failed_migration: false,
        });
    }
    let db_version = connection
        .query_row(
            "SELECT MAX(version) FROM _sqlx_migrations WHERE success = 1",
            [],
            |row| row.get::<_, Option<i64>>(0),
        )
        .map_err(|error| read_error(path, error))?;
    let failed_migration = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM _sqlx_migrations WHERE success = 0)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| read_error(path, error))?;
    Ok(DatabaseFacts {
        exists: true,
        has_migration_table: true,
        db_version,
        failed_migration,
    })
}

fn open_read_only(path: &Path) -> CommandResult<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    Connection::open_with_flags(path, flags).map_err(|error| CommandError::Failed {
        code: "db_open_failed",
        message: format!(
            "The database at {} could not be opened read-only: {error}.",
            path.display()
        ),
    })
}

fn read_error(path: &Path, error: rusqlite::Error) -> CommandError {
    CommandError::Failed {
        code: "db_read_failed",
        message: format!(
            "The database version at {} could not be read: {error}.",
            path.display()
        ),
    }
}

/// Turns the facts from the file at `database` into the state the UI acts on. A newer database
/// wins over a failed row: a newer app may have left that row, and only updating can help then.
pub fn classify(app_version: i64, facts: DatabaseFacts, database: &Path) -> DbVersionCheck {
    if !facts.exists || !facts.has_migration_table {
        return DbVersionCheck {
            state: DbVersionState::Fresh,
            app_version,
            db_version: None,
            message: None,
        };
    }
    let db_version = facts.db_version.unwrap_or(0);
    if db_version > app_version {
        return DbVersionCheck {
            state: DbVersionState::DatabaseNewer,
            app_version,
            db_version: Some(db_version),
            message: Some(format!(
                "This database was written by a newer version of Conducted (schema version {db_version}); this app supports up to version {app_version}. Update Conducted to open it."
            )),
        };
    }
    if facts.failed_migration {
        return DbVersionCheck {
            state: DbVersionState::FailedMigration,
            app_version,
            db_version: facts.db_version,
            message: Some(format!(
                "A database upgrade did not finish, so Conducted cannot open its database. Restarting will not fix it. Quit Conducted and restore {} from a backup, such as Time Machine, or report this problem.",
                database.display()
            )),
        };
    }
    DbVersionCheck {
        state: DbVersionState::Ok,
        app_version,
        db_version: Some(db_version),
        message: None,
    }
}

/// Compares the database file with this build. The UI calls it at startup and shows a blocking
/// screen unless the state is `ok` or `fresh`.
#[tauri::command]
pub async fn db_version_check(app: AppHandle) -> CommandResult<DbVersionCheck> {
    let path = database_path(&app)?;
    let app_version = app_schema_version();
    blocking("db_check_failed", move || {
        let facts = read_database_facts(&path)?;
        Ok(classify(app_version, facts, &path))
    })
    .await
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    use super::*;

    /// A database file that removes itself, so a test leaves nothing behind.
    struct TempDatabase {
        path: PathBuf,
    }

    impl TempDatabase {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-plat-17-{}-{counter}.db",
                std::process::id()
            ));
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn with_migrations(rows: &[(i64, bool)]) -> Self {
            let database = Self::new();
            let connection = Connection::open(database.path()).expect("create test database");
            connection
                .execute_batch(
                    "CREATE TABLE _sqlx_migrations (
                        version INTEGER NOT NULL,
                        description TEXT NOT NULL,
                        success INTEGER NOT NULL
                    );",
                )
                .expect("create migration table");
            for (version, success) in rows {
                connection
                    .execute(
                        "INSERT INTO _sqlx_migrations (version, description, success) VALUES (?1, 'test', ?2)",
                        rusqlite::params![version, success],
                    )
                    .expect("insert migration row");
            }
            drop(connection);
            database
        }
    }

    impl Drop for TempDatabase {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
            let _ = fs::remove_file(format!("{}-wal", self.path.display()));
            let _ = fs::remove_file(format!("{}-shm", self.path.display()));
        }
    }

    fn check(path: &Path) -> DbVersionCheck {
        let facts = read_database_facts(path).expect("read database facts");
        classify(app_schema_version(), facts, path)
    }

    #[test]
    fn plat_17_a_database_one_version_newer_blocks_startup() {
        let newer = app_schema_version() + 1;
        let database = TempDatabase::with_migrations(&[(1, true), (newer, true)]);

        let result = check(database.path());

        assert_eq!(result.state, DbVersionState::DatabaseNewer);
        assert_eq!(result.db_version, Some(newer));
        assert_eq!(result.app_version, app_schema_version());
        assert!(
            result
                .message
                .as_deref()
                .is_some_and(|message| message.contains("Update Conducted")),
            "{:?}",
            result.message
        );
    }

    #[test]
    fn plat_17_a_database_at_the_same_version_is_ok() {
        let database = TempDatabase::with_migrations(&[(1, true), (app_schema_version(), true)]);

        let result = check(database.path());

        assert_eq!(result.state, DbVersionState::Ok);
        assert_eq!(result.db_version, Some(app_schema_version()));
        assert_eq!(result.message, None);
    }

    #[test]
    fn plat_17_an_older_database_is_ok() {
        let database = TempDatabase::with_migrations(&[(1, true)]);

        let result = check(database.path());

        assert_eq!(result.state, DbVersionState::Ok);
        assert_eq!(result.db_version, Some(1));
    }

    #[test]
    fn plat_17_a_missing_database_is_fresh() {
        let database = TempDatabase::new();

        let facts = read_database_facts(database.path()).expect("read database facts");

        assert!(!facts.exists);
        assert_eq!(
            classify(app_schema_version(), facts, database.path()).state,
            DbVersionState::Fresh
        );
        assert!(!database.path().exists());
    }

    #[test]
    fn plat_17_a_file_without_the_migration_table_is_fresh() {
        let database = TempDatabase::new();
        Connection::open(database.path())
            .expect("create empty database")
            .execute_batch("CREATE TABLE unrelated (id TEXT);")
            .expect("create unrelated table");

        let facts = read_database_facts(database.path()).expect("read database facts");

        assert!(facts.exists);
        assert!(!facts.has_migration_table);
        assert_eq!(
            classify(app_schema_version(), facts, database.path()).state,
            DbVersionState::Fresh
        );
    }

    #[test]
    fn plat_17_a_failed_migration_blocks_startup() {
        let database = TempDatabase::with_migrations(&[(1, true), (2, false)]);

        let result = check(database.path());

        assert_eq!(result.state, DbVersionState::FailedMigration);
        assert_eq!(result.db_version, Some(1));
        assert!(
            result
                .message
                .as_deref()
                .is_some_and(|message| message.contains("did not finish")),
            "{:?}",
            result.message
        );
    }

    #[test]
    fn plat_17_a_failed_migration_names_an_action_that_can_fix_it() {
        let database = TempDatabase::with_migrations(&[(1, true), (2, false)]);

        let result = check(database.path());

        // The plugin's migrator refuses a half-applied migration on every start, so a restart
        // cannot help. The message points at the file to restore and says to report the problem.
        let message = result.message.expect("a failed migration has a message");
        assert!(!message.contains("Restart the app"), "{message}");
        assert!(message.contains("Restarting will not fix it"), "{message}");
        assert!(message.contains("from a backup"), "{message}");
        assert!(message.contains("report this problem"), "{message}");
        assert!(
            message.contains(&database.path().display().to_string()),
            "{message}"
        );
    }

    #[test]
    fn plat_17_a_newer_database_with_a_failed_row_asks_for_an_update() {
        let newer = app_schema_version() + 1;
        let database =
            TempDatabase::with_migrations(&[(1, true), (newer, true), (newer + 1, false)]);

        let result = check(database.path());

        assert_eq!(result.state, DbVersionState::DatabaseNewer);
        assert_eq!(result.db_version, Some(newer));
        assert!(
            result
                .message
                .as_deref()
                .is_some_and(|message| message.contains("Update Conducted")),
            "{:?}",
            result.message
        );
    }

    #[test]
    fn plat_17_reads_the_highest_successful_version() {
        let database =
            TempDatabase::with_migrations(&[(1, true), (2, true), (3, false), (4, true)]);

        let facts = read_database_facts(database.path()).expect("read database facts");

        assert_eq!(facts.db_version, Some(4));
        assert!(facts.failed_migration);
    }
}
