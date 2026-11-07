//! @feature PLAT-36 Rust command tests through a mock Tauri app
//!
//! Drives the real commands `shell_start`, `shell_cancel`, `fs_paths` and `pty_spawn` through
//! `tauri::test`, with the login environment the app captures and app data in a folder each test
//! makes and removes. The tests assert the events and answers a caller sees.
//! Research: docs/research/conductor/native-and-sidecar-map.md A2.
//! Command names: docs/plans/tauri-commands.md.
use std::collections::HashMap;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::time::Duration;

use conducted_lib::pty::PtyState;
use conducted_lib::shell::{LoginEnv, ShellState};
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody, InvokeResponseBody};
use tauri::test::{INVOKE_KEY, MockRuntime, mock_builder};
use tauri::utils::config::AppDirectoriesOverride;
use tauri::webview::InvokeRequest;
use tauri::{App, Listener, WebviewWindow};

/// The fs paths test runs a copy of itself from a bundle-shaped folder. A Cargo test binary sits
/// in `target/debug/deps`, where Tauri's macOS resource lookup finds no `Resources` folder. The
/// copy sits in `<bundle>/Contents/MacOS`, so the real resolver finds `<bundle>/Contents/Resources`.
const FS_PATHS_TEST: &str = "plat_36_fs_paths_returns_the_app_folders";
const FS_PATHS_CHILD: &str = "PLAT_36_FS_PATHS_CHILD";
const FS_PATHS_APP_DATA: &str = "PLAT_36_FS_PATHS_APP_DATA";
const FS_PATHS_RESOURCES: &str = "PLAT_36_FS_PATHS_RESOURCES";
const FS_PATHS_DONE: &str = "plat_36_fs_paths_child_done";

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A folder that removes itself, so a test leaves nothing behind.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> Self {
        let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "conducted-plat-36-{}-{counter}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create test folder");
        // Tauri refuses a starting binary whose path has a symlink ancestor on macOS, and
        // `/var` (where `temp_dir` lives) is one. The resolved path has none, and the tests
        // must resolve the same exe path the app does.
        let path = path.canonicalize().expect("resolve the test folder");
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

/// A mock app with the real states, the commands under test and app data in a test folder.
struct TestApp {
    app: App<MockRuntime>,
    window: WebviewWindow<MockRuntime>,
    folder: TempDir,
}

impl TestApp {
    fn new() -> Self {
        let folder = TempDir::new();
        let app_data = folder.path().to_path_buf();
        Self::with_app_data(folder, app_data)
    }

    fn with_app_data(folder: TempDir, app_data: PathBuf) -> Self {
        // The app's own context, so the commands are reached through the same capabilities the
        // real window has. Only the app data folder moves, into the folder this test removes.
        let mut context = tauri::generate_context!();
        context.config_mut().app.app_directories_override =
            Some(AppDirectoriesOverride::Root(app_data));

        // The app captures this once at launch. Tests use the same shape instead of running a
        // login shell, so a slow dotfile cannot make the test flaky.
        let login = LoginEnv {
            shell: "/bin/zsh".to_string(),
            path: "/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
            zdotdir: None,
            vars: HashMap::from([(
                "PATH".to_string(),
                "/usr/bin:/bin:/usr/sbin:/sbin".to_string(),
            )]),
        };
        let shell = ShellState::default();
        *shell.login_env.blocking_lock() = Some(login);

        let app = mock_builder()
            .manage(shell)
            .manage(PtyState::default())
            .invoke_handler(tauri::generate_handler![
                conducted_lib::shell::shell_start,
                conducted_lib::shell::shell_cancel,
                conducted_lib::files::fs_paths,
                conducted_lib::pty::pty_spawn
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

    /// Calls one command by the name the UI uses.
    fn invoke(&self, command: &str, body: Value) -> Result<InvokeResponseBody, Value> {
        tauri::test::get_ipc_response(
            &self.window,
            InvokeRequest {
                cmd: command.to_string(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                // The app is macOS-only, where this is the local app origin. The
                // `http://tauri.localhost` form the Tauri example uses is a remote origin on
                // macOS, which would ask the ACL for a capability the app does not have.
                url: "tauri://localhost".parse().expect("the test URL parses"),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
    }

    /// Receives the JSON payload of every event with this name.
    fn listen(&self, event: &str) -> mpsc::Receiver<String> {
        let (sender, receiver) = mpsc::channel();
        self.app.listen(event, move |event| {
            let _ = sender.send(event.payload().to_string());
        });
        receiver
    }

    fn folder_string(&self) -> String {
        self.folder.path().to_string_lossy().into_owned()
    }
}

fn unique(prefix: &str) -> String {
    let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("plat-36-{prefix}-{}-{counter}", std::process::id())
}

fn sleep_command(id: &str, timeout_ms: Option<u64>) -> Value {
    json!({
        "id": id,
        "command": {
            "program": "sleep",
            "args": ["30"],
            "cwd": std::env::temp_dir().to_string_lossy(),
            "timeoutMs": timeout_ms,
        },
    })
}

fn done_payload(receiver: &mpsc::Receiver<String>) -> Value {
    let payload = receiver
        .recv_timeout(Duration::from_secs(15))
        .expect("shell://done arrives");
    serde_json::from_str(&payload).expect("the event payload is JSON")
}

#[test]
fn plat_36_shell_start_emits_the_finished_output() {
    let test = TestApp::new();
    let done = test.listen("shell://done");
    let id = unique("start");
    let started = test.invoke(
        "shell_start",
        json!({
            "id": id,
            "command": {
                "program": "true",
                "args": [],
                "cwd": test.folder_string(),
            },
        }),
    );
    assert!(started.is_ok(), "shell_start failed: {started:?}");

    let event = done_payload(&done);
    assert_eq!(event["id"].as_str(), Some(id.as_str()));
    assert!(event["error"].is_null(), "no error: {event}");
    assert_eq!(event["output"]["exitCode"].as_i64(), Some(0));
    assert_eq!(event["output"]["stdout"].as_str(), Some(""));
}

#[test]
fn plat_36_shell_start_cancel_emits_a_cancelled_done_event() {
    let test = TestApp::new();
    let done = test.listen("shell://done");
    let id = unique("cancel");
    let started = test.invoke("shell_start", sleep_command(&id, None));
    assert!(started.is_ok(), "shell_start failed: {started:?}");

    let cancelled = test.invoke("shell_cancel", json!({ "id": id }));
    assert!(cancelled.is_ok(), "shell_cancel failed: {cancelled:?}");

    let event = done_payload(&done);
    assert_eq!(event["id"].as_str(), Some(id.as_str()));
    assert_eq!(event["error"]["code"].as_str(), Some("shell_cancelled"));
    assert!(event["output"].is_null());
}

#[test]
fn plat_36_shell_start_timeout_emits_a_timeout_done_event() {
    let test = TestApp::new();
    let done = test.listen("shell://done");
    let id = unique("timeout");
    let started = test.invoke("shell_start", sleep_command(&id, Some(100)));
    assert!(started.is_ok(), "shell_start failed: {started:?}");

    let event = done_payload(&done);
    assert_eq!(event["id"].as_str(), Some(id.as_str()));
    assert_eq!(event["error"]["code"].as_str(), Some("shell_timeout"));
    assert!(event["output"].is_null());
}

#[test]
fn plat_36_fs_paths_returns_the_app_folders() {
    if std::env::var_os(FS_PATHS_CHILD).is_some() {
        run_fs_paths_check();
        return;
    }

    let folder = TempDir::new();
    let contents = folder.path().join("Conducted.app/Contents");
    let macos = contents.join("MacOS");
    let resources = contents.join("Resources");
    let app_data = folder.path().join("app-data");
    fs::create_dir_all(&macos).expect("create the bundle folder");
    fs::create_dir_all(&resources).expect("create the resources folder");
    fs::create_dir_all(&app_data).expect("create the app data folder");
    let app_data = app_data
        .canonicalize()
        .expect("the app data folder resolves");

    let copy = macos.join("plat-36-test");
    fs::copy(std::env::current_exe().expect("the test exe"), &copy)
        .expect("copy the test binary into the bundle");
    fs::set_permissions(&copy, fs::Permissions::from_mode(0o755))
        .expect("the copied test binary stays executable");

    let output = std::process::Command::new(&copy)
        .args(["--exact", FS_PATHS_TEST, "--nocapture", "--test-threads=1"])
        .env(FS_PATHS_CHILD, "1")
        .env(FS_PATHS_APP_DATA, &app_data)
        .env(FS_PATHS_RESOURCES, &resources)
        .output()
        .expect("the bundled child test runs");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "the bundled child test failed:\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    assert!(
        stdout.contains(FS_PATHS_DONE),
        "the child test did not run:\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
}

/// The child half of the fs paths test, run from a bundle-shaped copy of the test binary.
fn run_fs_paths_check() {
    let folder = TempDir::new();
    let app_data = PathBuf::from(
        std::env::var_os(FS_PATHS_APP_DATA).expect("the parent sets the app data folder"),
    );
    let resources = PathBuf::from(
        std::env::var_os(FS_PATHS_RESOURCES).expect("the parent sets the resources folder"),
    );
    let test = TestApp::with_app_data(folder, app_data.clone());
    let response = test.invoke("fs_paths", json!({}));
    let body = response.expect("fs_paths succeeds");
    let paths: Value = body.deserialize().expect("the answer is JSON");

    let app_data_text = app_data.to_string_lossy().into_owned();
    assert_eq!(
        paths["appData"].as_str(),
        Some(app_data_text.as_str()),
        "app data is the folder the app was pointed at: {paths}"
    );
    let home = paths["home"].as_str().expect("home is a string");
    assert!(
        Path::new(home).is_absolute() && Path::new(home).is_dir(),
        "home is an existing absolute folder: {home}"
    );
    let temp = paths["temp"].as_str().expect("temp is a string");
    assert!(
        Path::new(temp).is_dir(),
        "temp is an existing folder: {temp}"
    );
    let expected_resources = resources
        .canonicalize()
        .expect("the resources folder resolves");
    let resources_text = expected_resources.to_string_lossy().into_owned();
    assert_eq!(
        paths["resources"].as_str(),
        Some(resources_text.as_str()),
        "resources is the bundle's Resources folder: {paths}"
    );
    println!("{FS_PATHS_DONE}");
}

#[test]
fn plat_36_pty_spawn_runs_a_terminal_to_pty_exit() {
    let test = TestApp::new();
    let exited = test.listen("pty://exit");
    let response = test.invoke(
        "pty_spawn",
        json!({
            "request": {
                "terminalId": unique("terminal"),
                "cwd": test.folder_string(),
                "cols": 80,
                "rows": 24,
                "command": { "program": "/bin/sh", "args": ["-c", "printf plat-36"] },
            },
            "onOutput": "__CHANNEL__:1",
        }),
    );
    let body = response.expect("pty_spawn succeeds");
    let spawned: Value = body.deserialize().expect("the answer is JSON");
    let id = spawned["id"]
        .as_str()
        .expect("the terminal has an id")
        .to_string();
    assert!(
        spawned["pid"].as_u64().is_some(),
        "the terminal has a pid: {spawned}"
    );

    let payload = exited
        .recv_timeout(Duration::from_secs(15))
        .expect("pty://exit arrives");
    let event: Value = serde_json::from_str(&payload).expect("the event payload is JSON");
    assert_eq!(event["id"].as_str(), Some(id.as_str()));
    assert_eq!(event["exitCode"].as_i64(), Some(0));
    assert!(event["signal"].is_null(), "no signal ended it: {event}");
    assert!(
        event["historyError"].is_null(),
        "the history saved: {event}"
    );
}
