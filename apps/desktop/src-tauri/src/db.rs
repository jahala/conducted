//! Database setup. Owns the migration list for `conducted.db`. The UI reads and writes through
//! tauri-plugin-sql; this module only defines the schema.
//! Research: native-and-sidecar-map.md A11 (Conductor's migrations and rollback guard).

use tauri_plugin_sql::{Migration, MigrationKind};

pub const DB_URL: &str = "sqlite:conducted.db";

pub fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "init",
        sql: include_str!("../migrations/0001_init.sql"),
        kind: MigrationKind::Up,
    }]
}
