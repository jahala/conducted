//! @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
//!
//! Owns: an integration test that runs the Worker in Cloudflare's own local runtime (`wrangler dev`,
//! workerd) and reaches it through the real Rust relay.
//!
//! Behaviour: docs/plans/cloud-and-remote.md Part 1 (the desktop reaches the user's Worker over one
//! WebSocket, with the pairing token in the `Authorization` header) and D101 (the relay appends the
//! newline the sidecar's NDJSON stream needs).
//!
//! Our design choice: the Worker runs without a container, with a Durable Object that echoes each
//! frame in place of the sandbox sidecar. Both stream channels (`rpc` and `terminal`) reach that
//! Durable Object without Docker. The test runs the same `front-door.ts` checks the deployed Worker
//! runs, so a wrong token, route, method or missing upgrade header is refused exactly as in
//! production. The local runtime's certificate is self-signed, so the test trusts it. The test starts
//! the runtime, reads the port it printed, and stops the process group of the pid it recorded.
//!
//! Test first: the relay's line reaches the Worker and its answer comes back on both channels.

use std::io::{BufRead, BufReader};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

use conducted_lib::cloud::{
    CloudState, EVENT_LINE, cloud_relay_close, cloud_relay_send, open_relay,
};
use serde_json::Value;
use tauri::test::mock_builder;
use tauri::{App, Listener, Manager};
use tokio_tungstenite::Connector;

/// The pairing token the local Worker is configured with.
const PAIRING_TOKEN: &str = "test-pairing-token";
/// The workspace name the relay URL names.
const WORKSPACE: &str = "relay-test";
/// How long the local runtime may take to bundle the Worker and answer.
const READY_TIMEOUT: Duration = Duration::from_secs(90);
/// How long one line may take to make the round trip.
const LINE_TIMEOUT: Duration = Duration::from_secs(20);

static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

/// A folder that removes itself, so the test leaves nothing behind.
struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> Self {
        let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "conducted-cloud-relay-{}-{counter}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create the test folder");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// The local runtime, stopped by the process group of the pid it recorded when it drops.
struct Wrangler {
    child: Child,
    port: u16,
}

impl Wrangler {
    /// Starts `wrangler dev` in a folder the test owns, with the e2e Worker and no container.
    fn start(folder: &Path) -> Self {
        let cloud = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../cloud");
        let program = cloud.join("node_modules/.bin/wrangler");
        assert!(
            program.is_file(),
            "Run pnpm install: the relay test needs {} to start the Worker.",
            program.display()
        );
        let home = folder.join("home");
        let config = folder.join("config");
        let cache = folder.join("cache");
        for path in [&home, &config, &cache] {
            std::fs::create_dir_all(path).expect("create a runtime folder");
        }
        let mut child = Command::new(&program)
            .current_dir(folder)
            .arg("dev")
            .arg("-c")
            .arg(cloud.join("wrangler.e2e.jsonc"))
            .arg("--cwd")
            .arg(folder)
            .args(["--local", "--ip", "127.0.0.1", "--port", "0"])
            .args(["--local-protocol", "https"])
            .args(["--show-interactive-dev-session=false"])
            .args(["--log-level", "info"])
            .arg("--var")
            .arg(format!("PAIRING_TOKEN:{PAIRING_TOKEN}"))
            .arg("--persist-to")
            .arg(folder.join("state"))
            .env("HOME", &home)
            .env("XDG_CONFIG_HOME", &config)
            .env("XDG_CACHE_HOME", &cache)
            .env("TMPDIR", folder)
            .env("NO_COLOR", "1")
            .env("CI", "1")
            .env("WRANGLER_SEND_METRICS", "false")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()
            .expect("start the local Worker runtime");

        let pid = child.id();
        let stdout = child.stdout.take().expect("the runtime's output is piped");
        let stderr = child.stderr.take().expect("the runtime's errors are piped");
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        let (ready, port) = mpsc::channel::<u16>();
        // The runtime prints its ready line on either stream; watch both.
        for stream in [
            Box::new(stdout) as Box<dyn std::io::Read + Send>,
            Box::new(stderr) as Box<dyn std::io::Read + Send>,
        ] {
            let ready = ready.clone();
            let log = Arc::clone(&log);
            std::thread::spawn(move || {
                for line in BufReader::new(stream).lines().map_while(Result::ok) {
                    if let Some(found) = ready_port(&line) {
                        let _ = ready.send(found);
                    }
                    if let Ok(mut lines) = log.lock() {
                        lines.push(line);
                    }
                }
            });
        }

        let port = match port.recv_timeout(READY_TIMEOUT) {
            Ok(port) => port,
            Err(_) => {
                terminate_group(pid);
                let _ = child.wait();
                let lines = log.lock().map(|lines| lines.join("\n")).unwrap_or_default();
                panic!("The local Worker did not become ready within {READY_TIMEOUT:?}:\n{lines}");
            }
        };
        Self { child, port }
    }

    fn url(&self) -> String {
        format!("https://127.0.0.1:{}", self.port)
    }
}

impl Drop for Wrangler {
    fn drop(&mut self) {
        terminate_group(self.child.id());
        let _ = self.child.wait();
    }
}

/// The port a `Ready on https://host:port` line names.
fn ready_port(line: &str) -> Option<u16> {
    let rest = line.split("Ready on ").nth(1)?;
    let port = rest
        .rsplit(':')
        .next()?
        .trim_end_matches(|c: char| !c.is_ascii_digit());
    port.parse().ok()
}

/// Ends a whole process group: SIGTERM, then SIGKILL after a short grace.
fn terminate_group(pid: u32) {
    let group = format!("-{pid}");
    let _ = Command::new("/bin/kill")
        .arg("-TERM")
        .arg(&group)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if !group_alive(pid) {
            return;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    let _ = Command::new("/bin/kill")
        .arg("-KILL")
        .arg(&group)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn group_alive(pid: u32) -> bool {
    Command::new("/bin/kill")
        .arg("-0")
        .arg(format!("-{pid}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

/// A TLS connector that trusts the local runtime's self-signed certificate.
fn local_connector() -> Connector {
    let tls = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .expect("build the local TLS connector");
    Connector::NativeTls(tls)
}

fn mock_app() -> App<tauri::test::MockRuntime> {
    mock_builder()
        .manage(CloudState::default())
        .build(tauri::generate_context!())
        .expect("the mock app builds")
}

/// Opens a relay, sends one line, and returns the answer the relay emitted.
fn round_trip(app: &App<tauri::test::MockRuntime>, url: &str, channel: &str, line: &str) -> String {
    let relay_id = tauri::async_runtime::block_on(open_relay(
        app.handle().clone(),
        &app.state::<CloudState>(),
        url,
        WORKSPACE,
        Some(channel),
        PAIRING_TOKEN,
        Some(local_connector()),
    ))
    .unwrap_or_else(|error| panic!("the {channel} relay opens with the pairing token: {error}"));

    let (sender, receiver) = mpsc::channel();
    let wanted = relay_id.clone();
    let listener = app.listen(EVENT_LINE, move |event| {
        let payload = event.payload().to_string();
        let is_wanted = serde_json::from_str::<Value>(&payload)
            .is_ok_and(|value| value["relayId"].as_str() == Some(wanted.as_str()));
        if is_wanted {
            let _ = sender.send(payload);
        }
    });

    tauri::async_runtime::block_on(cloud_relay_send(
        app.state(),
        relay_id.clone(),
        line.to_string(),
    ))
    .expect("the relay sends the line");

    let payload = receiver
        .recv_timeout(LINE_TIMEOUT)
        .unwrap_or_else(|_| panic!("the {channel} relay delivers the Worker's answer"));
    app.unlisten(listener);
    tauri::async_runtime::block_on(cloud_relay_close(app.state(), relay_id))
        .expect("the relay closes");
    payload
}

#[test]
fn cloud_03_the_relay_reaches_the_worker_and_frames_the_line() {
    let folder = TempDir::new();
    let wrangler = Wrangler::start(folder.path());
    let app = mock_app();
    let url = wrangler.url();
    let line =
        r#"{"jsonrpc":"2.0","id":1,"method":"liveState","params":{"liveState":{"status":"idle"}}}"#;
    let expected = format!("{line}\n");

    for channel in ["rpc", "terminal"] {
        let payload = round_trip(&app, &url, channel, line);
        let payload: Value = serde_json::from_str(&payload).expect("the event payload is JSON");
        assert_eq!(
            payload["line"].as_str(),
            Some(expected.as_str()),
            "the {channel} relay adds the newline the sidecar's NDJSON stream needs"
        );
    }

    let refused = tauri::async_runtime::block_on(open_relay(
        app.handle().clone(),
        &app.state::<CloudState>(),
        &url,
        WORKSPACE,
        Some("rpc"),
        "wrong-token",
        Some(local_connector()),
    ))
    .expect_err("a wrong pairing token is refused");
    assert_eq!(
        refused.code(),
        "cloud_relay_failed",
        "the Worker's 401 stops the relay: {refused}"
    );

    let bad_channel = tauri::async_runtime::block_on(open_relay(
        app.handle().clone(),
        &app.state::<CloudState>(),
        &url,
        WORKSPACE,
        Some("colour"),
        PAIRING_TOKEN,
        Some(local_connector()),
    ))
    .expect_err("an unknown channel is refused before connecting");
    assert_eq!(bad_channel.code(), "cloud_bad_channel");
}
