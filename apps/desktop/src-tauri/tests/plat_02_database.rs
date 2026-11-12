//! @feature PLAT-02 The app's database keeps one connection while the app runs
//!
//! Drives the database commands the UI calls through `tauri::test`, with the app's own context
//! (its capabilities) and app folders in a folder each test makes and removes. The database file
//! is read back with a second, read-only connection, so a test sees what is on disk.
//! Issue #616: a transaction is BEGIN IMMEDIATE, its statements and COMMIT sent one by one, so
//! all of them must run on one connection, and a connection's own state (a TEMP table, an ATTACH)
//! must last as long as the app.
//! Command names: docs/plans/tauri-commands.md.
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use conducted_lib::database::DatabaseState;
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, mock_builder};
use tauri::utils::config::AppDirectoriesOverride;
use tauri::webview::InvokeRequest;
use tauri::{App, Manager, WebviewWindow};

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A folder that removes itself, so a test leaves nothing behind.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> Self {
        let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "conducted-plat-02-db-{}-{counter}",
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

/// A mock app that opens its database as the app does, with app folders in a test folder.
struct TestApp {
    app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    folder: TempDir,
}

impl TestApp {
    fn new() -> Self {
        let folder = TempDir::new();
        let mut context = tauri::generate_context!();
        context.config_mut().app.app_directories_override =
            Some(AppDirectoriesOverride::Root(folder.path().to_path_buf()));
        let app = mock_builder()
            .manage(DatabaseState::default())
            .invoke_handler(tauri::generate_handler![
                conducted_lib::database::db_open,
                conducted_lib::database::db_execute,
                conducted_lib::database::db_select
            ])
            .build(context)
            .expect("the mock app builds");
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("the mock window builds");
        Self {
            app,
            window,
            folder,
        }
    }

    /// Calls one command by the name the UI uses and returns its JSON answer or its error.
    fn invoke(&self, command: &str, body: Value) -> Result<Value, Value> {
        self.invoke_text(command, body)
            .map(|text| serde_json::from_str(&text).expect("the answer is JSON"))
    }

    /// The answer as the JSON text the web view receives, so a test can read its key order.
    fn invoke_text(&self, command: &str, body: Value) -> Result<String, Value> {
        tauri::test::get_ipc_response(
            &self.window,
            InvokeRequest {
                cmd: command.to_string(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                // The app is macOS-only, where this is the local app origin (see plat_36.rs).
                url: "tauri://localhost".parse().expect("the test URL parses"),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|body| match body {
            InvokeResponseBody::Json(text) => text,
            InvokeResponseBody::Raw(_) => panic!("{command} answered bytes, not JSON"),
        })
    }

    /// Opens the database the way the UI does on its first statement.
    fn open(&self) -> Result<Value, Value> {
        self.invoke("db_open", json!({}))
    }

    fn execute(&self, query: &str) -> Result<Value, Value> {
        self.invoke("db_execute", json!({ "query": query, "values": [] }))
    }

    fn execute_with(&self, query: &str, values: Value) -> Result<Value, Value> {
        self.invoke("db_execute", json!({ "query": query, "values": values }))
    }

    fn select_text(&self, query: &str) -> Result<String, Value> {
        self.invoke_text("db_select", json!({ "query": query, "values": [] }))
    }

    fn select(&self, query: &str) -> Result<Value, Value> {
        self.invoke("db_select", json!({ "query": query, "values": [] }))
    }

    /// Takes the connection away from the app, as closing it at exit does. With tauri-plugin-sql
    /// the pool did the same to a connection past its 30-minute lifetime, then opened another.
    fn lose_connection(&self) {
        let state = self.app.state::<DatabaseState>();
        tauri::async_runtime::block_on(conducted_lib::database::close(&state))
            .expect("the connection closes");
    }

    /// The database file, read through a connection of its own.
    fn rows_on_disk(&self, table: &str) -> i64 {
        let path = self.folder.path().join("conducted.db");
        let connection = rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .expect("the database file opens read-only");
        connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("the table is counted")
    }
}

#[test]
fn plat_02_a_lost_connection_saves_no_part_of_an_open_transaction() {
    let test = TestApp::new();
    test.open().expect("the database opens");
    test.execute("CREATE TABLE plat_02_lost (id INTEGER PRIMARY KEY)")
        .expect("the table is made");

    test.execute("BEGIN IMMEDIATE")
        .expect("the transaction begins");
    test.execute("INSERT INTO plat_02_lost (id) VALUES (1)")
        .expect("the first row is written inside the transaction");
    test.lose_connection();
    let second = test.execute("INSERT INTO plat_02_lost (id) VALUES (2)");
    let commit = test.execute("COMMIT");

    assert_eq!(
        test.rows_on_disk("plat_02_lost"),
        0,
        "a statement of the transaction was saved on its own (second insert: {second:?}, commit: {commit:?})"
    );
    assert!(
        second.is_err(),
        "the second insert ran without its transaction: {second:?}"
    );
    assert!(
        commit.is_err(),
        "the commit found a transaction: {commit:?}"
    );
    let reopened = test.open();
    assert!(
        reopened.is_err(),
        "a second connection was opened after the first was lost: {reopened:?}"
    );
}

#[test]
fn plat_02_a_temp_table_lasts_while_the_app_runs() {
    let test = TestApp::new();
    test.open().expect("the database opens");
    test.execute("CREATE TEMP TABLE plat_02_scratch (id INTEGER)")
        .expect("the temp table is made");

    // The UI opens the database again after a failed first statement; nothing may replace the
    // connection that holds the temp table.
    test.open().expect("opening again is allowed");
    test.execute("INSERT INTO plat_02_scratch (id) VALUES (7)")
        .expect("the temp table is still there");

    let rows = test
        .select("SELECT id FROM plat_02_scratch")
        .expect("the temp table is read");
    assert_eq!(rows, json!([{ "id": 7 }]));
}

#[test]
fn plat_02_values_bind_and_read_back_as_tauri_plugin_sql_did() {
    let test = TestApp::new();
    test.open().expect("the database opens");
    test.execute("CREATE TABLE plat_02_values (id INTEGER PRIMARY KEY, whole INTEGER, any_value)")
        .expect("the table is made");
    let values = [
        json!(null),
        json!("text"),
        json!(3),
        json!(2.5),
        json!(true),
        json!({ "a": [1, 2] }),
    ];
    for (id, value) in values.iter().enumerate() {
        let written = test
            .execute_with(
                "INSERT INTO plat_02_values (id, whole, any_value) VALUES ($1, $2, $2)",
                json!([id, value]),
            )
            .expect("the row is written");
        assert_eq!(written, json!({ "rowsAffected": 1, "lastInsertId": id }));
    }

    let rows = test
        .select(
            "SELECT id, whole, typeof(whole) AS whole_type, any_value, typeof(any_value) AS any_type FROM plat_02_values ORDER BY id",
        )
        .expect("the rows are read");
    assert_eq!(
        rows,
        json!([
            { "id": 0, "whole": null, "whole_type": "null", "any_value": null, "any_type": "null" },
            { "id": 1, "whole": "text", "whole_type": "text", "any_value": "text", "any_type": "text" },
            { "id": 2, "whole": 3, "whole_type": "integer", "any_value": 3.0, "any_type": "real" },
            { "id": 3, "whole": 2.5, "whole_type": "real", "any_value": 2.5, "any_type": "real" },
            { "id": 4, "whole": "true", "whole_type": "text", "any_value": "true", "any_type": "text" },
            { "id": 5, "whole": "{\"a\":[1,2]}", "whole_type": "text", "any_value": "{\"a\":[1,2]}", "any_type": "text" },
        ])
    );
    let shapes = test
        .select_text("SELECT X'00ff' AS bytes, 2 AS second, 1 AS first")
        .expect("the literal row is read");
    assert_eq!(
        shapes, r#"[{"bytes":[0,255],"second":2,"first":1}]"#,
        "a blob is its bytes, and columns keep their order"
    );
}
