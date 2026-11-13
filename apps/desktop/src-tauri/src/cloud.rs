//! @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
//! @feature CLOUD-07 Pair the desktop app with the user's Worker
//! @feature CLOUD-08 Deploy flow for the user's Cloudflare account
//! @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
//!
//! Owns: the Rust shell's side of the cloud connection: the pairing flow and the Keychain items it
//! keeps, the deploy and uninstall that run the user's `wrangler`, an HTTPS request to the user's
//! Worker with the pairing token, and the WebSocket relay that carries the UI's sidecar lines to
//! the Worker.
//!
//! Behaviour: docs/plans/cloud-and-remote.md Part 1 and the CLOUD-02 spike's question 4
//! (`docs/research/cloud-spike-2026-11-06.md`): the token travels in the `Authorization` header
//! and is kept in the Keychain; the web view cannot set WebSocket headers, so the Rust shell owns
//! the relay and relays lines verbatim, as it does for the local sidecar socket. CLOUD-07 checks a
//! Worker URL and token against the Worker's `/pair` route before saving either, and the answer
//! must name the service `conducted-cloud`.
//!
//! Must handle:
//! - The token is read from the Keychain and never returned to the web view, logged or put in an
//!   event payload. The saved Worker URL is returned; the token is not.
//! - Only `https` reaches a Worker. A plain-http URL, a user name or password, or an empty host is
//!   refused with `cloud_url_not_allowed`. The relay's `wss` URL is built from the same check.
//! - A request path starts with one `/`, holds no `..`, NUL or newline, and cannot name another
//!   host.
//! - A relay id is made here, so the UI can close a relay it opened. Opening is idempotent per
//!   (Worker, workspace) pair: a second open returns a second id, and both carry the same lines.
//!   Sending a line that holds a newline is refused, so one message stays one JSON-RPC line.
//! - A closed or failed relay emits `cloud://closed` once. The UI's transport turns that into a
//!   sidecar restart, exactly as it does for the local sidecar.
//! - Closing drops the relay's writer and aborts its reader, so nothing is left running.
//! - Pairing refuses a blank token with `cloud_token_invalid`, a Worker that answers 401 with
//!   `cloud_pair_refused`, and an answer that does not name this service with
//!   `cloud_not_a_worker`; a failed save leaves no half pairing: the URL is written before the
//!   token, and only a saved token counts as paired.
//! - Unpairing removes both items; a Mac that was never paired succeeds.
//! - The deploy makes 32 random bytes here, writes them to a mode-600 file that
//!   `wrangler deploy --secrets-file` reads, and removes that file whatever the deploy did. The
//!   token never reaches the web view, is never logged, and is never printed. It reads the
//!   Worker's resource names from its config's caller, creates the bucket only when it is
//!   missing, and pairs this Mac with the URL wrangler printed.
//! - While the deploy runs it emits `cloud://deploy` at each step it takes (issue #490), so the
//!   page can say what it is waiting for. One `wrangler deploy` call builds the image, uploads the
//!   Worker and sets the secret, so the shell names those three as one step rather than guessing.
//! - The uninstall deletes the Worker, then its container application and images, then the bucket,
//!   and unpairs. A resource the account does not have is skipped, so a second uninstall succeeds.
//!   Cloudflare refuses to delete a bucket that holds anything (code 10008, issue #635), and
//!   wrangler cannot list a bucket's objects, so the uninstall empties the bucket through
//!   Cloudflare's API with wrangler's own login: only the bucket named exactly as the Worker, in
//!   the one account that holds it, page by page, skipping an object already gone. It says what it
//!   removed. The login stays in a request header and is never logged or returned.
//! - wrangler's OAuth token can expire while the bucket empties (issue #675). A refused login (401,
//!   or 403 with code 9109) asks wrangler for its login again and repeats that one call only with
//!   a new login. A login Cloudflare still refuses is `cloud_login_refused`. A failure at the bucket says what is already deleted and
//!   that the bucket is left, so the user knows a second uninstall removes the rest.
//! - The SSH tunnel URL (CLOUD-12) is `wss://<worker>/w/<name>/ssh`, with no port query: the route
//!   reaches only the sandbox's loopback port 22.
//!
//! Our design choice: one pairing per Mac, stored under `cloud-pairing-token` and
//! `cloud-pairing-url`. D101 and D106 record this; D109 records the deploy flow.
//!
//! Test first: a request path that names another host or climbs with `..` is refused, a relay
//! line with a newline is refused before anything is sent, a pairing answer with another
//! service name is refused, a deploy leaves no secret file behind, and an uninstall removes a
//! bucket that holds objects and leaves every other bucket alone.

use std::collections::HashMap;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio_tungstenite::Connector;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

use crate::error::{CommandError, CommandResult, blocking, lock};
use crate::keychain;

/// Event carrying one relayed line. Payload: `RelayLine`.
pub const EVENT_LINE: &str = "cloud://line";
/// Event fired once when a relay ends. Payload: `RelayClosed`.
pub const EVENT_CLOSED: &str = "cloud://closed";
/// Event carrying one step of a running deploy. Payload: `DeployStep`.
pub const EVENT_DEPLOY: &str = "cloud://deploy";
/// The Keychain item that holds the Worker's pairing token (CLOUD-07).
pub const PAIRING_TOKEN_KEY: &str = "cloud-pairing-token";
/// The Keychain item that holds the URL of the Worker this token belongs to (CLOUD-07).
pub const PAIRING_URL_KEY: &str = "cloud-pairing-url";
/// The route a Worker answers with its own name when the token is right (CLOUD-07).
pub const PAIR_PATH: &str = "/pair";
/// What the Worker's pairing answer must call itself. `apps/cloud/src/auth.ts` sends this name.
pub const PAIR_SERVICE: &str = "conducted-cloud";
/// How long the shell waits for a Worker's answer when the request names no timeout.
pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;
/// Largest body accepted from a Worker, so an answer cannot exhaust memory.
pub const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

/// What this Mac knows about its pairing. Mirrors `CloudPairing` in platform.ts; never the token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudPairingPayload {
    pub paired: bool,
    pub url: Option<String>,
}

/// A Worker URL and token typed on the Connections page. Mirrors `CloudPairInput` in platform.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudPairInput {
    pub url: String,
    pub token: String,
}

/// One relayed line from the Worker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayLine {
    pub relay_id: String,
    pub line: String,
}

/// Why a relay ended.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayClosed {
    pub relay_id: String,
    pub reason: String,
}

/// One step of a running deploy, named by the shell (CLOUD-08, issue #490).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployStep {
    pub step: String,
}

/// The bundled deploy folder inside the app's resources, and the file its build wrote.
pub const CLOUD_RESOURCES: &str = "cloud";
/// The fact file `scripts/cloud/prepare-deploy.ts` writes from the Worker's own config.
pub const DEPLOY_FACT_FILE: &str = "deploy.json";
/// The pre-bundled Worker the app uploads.
pub const DEPLOY_WORKER_FILE: &str = "worker.js";
/// The sandbox Dockerfile the user's Docker builds the image from.
pub const DEPLOY_DOCKERFILE: &str = "sandbox/Dockerfile";
/// The program that deploys into the user's own Cloudflare account, from their login.
pub const WRANGLER_PROGRAM: &str = "wrangler";
/// The Worker secret the pairing token is stored as. `apps/cloud/src/auth.ts` reads it.
pub const PAIRING_SECRET_NAME: &str = "PAIRING_TOKEN";
/// What the user sees when wrangler is not installed. It names the exact steps (D088, D109).
pub const WRANGLER_MISSING_HELP: &str = "wrangler is not installed. Install Node.js from https://nodejs.org, then run `npm install -g wrangler` and `wrangler login`, and deploy again.";
/// What the user sees when Docker is not running. A Dockerfile image is built locally (D109).
pub const DOCKER_MISSING_HELP: &str = "Docker is needed to build the sandbox image from the app's Dockerfile. Install Docker Desktop from https://www.docker.com/products/docker-desktop/, start it, and deploy again.";
/// The oldest wrangler that reads the sandbox's `durable_object` container config. The repository
/// pins and verifies 4.158.0; 4.128.0 refuses the same config (D109).
pub const MIN_WRANGLER_VERSION: (u32, u32, u32) = (4, 158, 0);
/// What the user sees when wrangler is older than the container config needs.
pub const WRANGLER_OLD_HELP: &str = "wrangler 4.158 or newer is needed for the sandbox's container configuration. Run `npm install -g wrangler@latest` and deploy again.";

/// What a deploy may override (CLOUD-08). The UI sends none, so the bundled name is used; the live
/// verification sends a `conducted-dev-c08-<time>` name and deletes everything after.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudDeployInput {
    pub worker_name: Option<String>,
}

/// What a deploy leaves behind: the Worker's URL, now paired with this Mac.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudDeployPayload {
    pub url: String,
}

/// What the uninstall overrides. The same optional name a deploy used.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudUninstallInput {
    pub worker_name: Option<String>,
}

/// The facts the deploy inputs state: read from `deploy.json`, which the release build writes from
/// the Worker's own `wrangler.jsonc`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployFacts {
    pub name: String,
    pub compatibility_date: String,
    pub compatibility_flags: Vec<String>,
    pub instance: String,
    pub class_name: String,
    pub image_key: String,
    pub object_binding: String,
    pub backup_binding: String,
}

/// A program's answer, as the deploy reads it.
#[derive(Debug, Clone)]
pub struct ProgramOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Runs `wrangler` with the user's login. Production uses the program on the login PATH; the tests
/// use a stand-in script, which is the only seam a Cloudflare account would otherwise need.
#[derive(Debug, Clone)]
pub struct Wrangler {
    pub program: String,
}

impl Default for Wrangler {
    fn default() -> Self {
        Self::new()
    }
}

impl Wrangler {
    pub fn new() -> Self {
        Self {
            program: String::from(WRANGLER_PROGRAM),
        }
    }

    pub fn run(
        &self,
        args: &[String],
        cwd: &Path,
        stdin: Option<&str>,
        timeout: Duration,
    ) -> CommandResult<ProgramOutput> {
        let mut child = Command::new(&self.program)
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                let message = if error.kind() == std::io::ErrorKind::NotFound {
                    String::from(WRANGLER_MISSING_HELP)
                } else {
                    format!("`{}` could not start: {error}", self.program)
                };
                refused("cloud_wrangler_missing", message)
            })?;
        if let Some(text) = stdin {
            let mut pipe = child.stdin.take().ok_or_else(|| {
                refused(
                    "cloud_wrangler_failed",
                    "wrangler's input could not be opened.",
                )
            })?;
            pipe.write_all(text.as_bytes()).map_err(|error| {
                refused(
                    "cloud_wrangler_failed",
                    format!("The secret could not be sent to wrangler: {error}"),
                )
            })?;
        }
        // Drain both pipes while the child runs, so a long deploy cannot fill a pipe and stall.
        let mut stdout = child.stdout.take().ok_or_else(|| {
            refused(
                "cloud_wrangler_failed",
                "wrangler's output could not be read.",
            )
        })?;
        let mut stderr = child.stderr.take().ok_or_else(|| {
            refused(
                "cloud_wrangler_failed",
                "wrangler's errors could not be read.",
            )
        })?;
        let out_reader = std::thread::spawn(move || {
            let mut text = Vec::new();
            let _ = stdout.read_to_end(&mut text);
            text
        });
        let err_reader = std::thread::spawn(move || {
            let mut text = Vec::new();
            let _ = stderr.read_to_end(&mut text);
            text
        });
        let began = std::time::Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break Some(status),
                Ok(None) if began.elapsed() >= timeout => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(error) => {
                    return Err(refused(
                        "cloud_wrangler_failed",
                        format!("wrangler could not be waited for: {error}"),
                    ));
                }
            }
        };
        let stdout = String::from_utf8_lossy(&out_reader.join().unwrap_or_default()).into_owned();
        let stderr = String::from_utf8_lossy(&err_reader.join().unwrap_or_default()).into_owned();
        match status {
            Some(status) => Ok(ProgramOutput {
                success: status.success(),
                stdout,
                stderr,
            }),
            None => Err(refused(
                "cloud_wrangler_timeout",
                format!(
                    "wrangler did not finish within {} seconds.",
                    timeout.as_secs()
                ),
            )),
        }
    }
}

/// A request to the user's Worker. Mirrors `CloudRequest` in platform.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudRequestInput {
    pub url: String,
    pub method: String,
    pub path: String,
    pub body: Option<serde_json::Value>,
    pub timeout_ms: Option<u64>,
}

/// The Worker's answer. Mirrors `CloudResponse` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudResponsePayload {
    pub status: u16,
    pub body: String,
}

/// One open relay's writer and reader task.
struct Relay {
    outgoing: mpsc::UnboundedSender<String>,
    reader: tauri::async_runtime::JoinHandle<()>,
}

/// Every open relay. Registered once with `.manage(CloudState::default())`.
#[derive(Default)]
pub struct CloudState {
    relays: Mutex<HashMap<String, Relay>>,
    next_id: AtomicU64,
}

impl CloudState {
    fn next_id(&self) -> String {
        format!("relay-{}", self.next_id.fetch_add(1, Ordering::Relaxed) + 1)
    }
}

fn refused(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError::Failed {
        code,
        message: message.into(),
    }
}

/// A Worker's base URL, checked: https only, a host, no credentials, no query or fragment.
pub fn checked_worker_url(raw: &str) -> CommandResult<reqwest::Url> {
    let url = reqwest::Url::parse(raw).map_err(|error| {
        refused(
            "cloud_url_not_allowed",
            format!("That Worker URL is not valid: {error}"),
        )
    })?;
    if url.scheme() != "https" || url.host_str().is_none() {
        return Err(refused(
            "cloud_url_not_allowed",
            "A Worker URL must be https and name a host.",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(refused(
            "cloud_url_not_allowed",
            "A Worker URL cannot hold a user name or password.",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(refused(
            "cloud_url_not_allowed",
            "A Worker URL cannot hold a query or a fragment.",
        ));
    }
    Ok(url)
}

/// The full HTTPS URL for one route: the Worker's base path plus `path`, with `path` checked to
/// stay on the same host.
pub fn route_url(base: &reqwest::Url, path: &str) -> CommandResult<reqwest::Url> {
    if !path.starts_with('/')
        || path.starts_with("//")
        || path.contains("..")
        || path.contains('\u{0}')
        || path.contains('\n')
        || path.contains('\r')
    {
        return Err(refused(
            "cloud_path_not_allowed",
            "A Worker route path must start with one slash and stay inside the Worker.",
        ));
    }
    let mut url = base.clone();
    let joined = format!("{}{}", base.path().trim_end_matches('/'), path);
    url.set_path(&joined);
    Ok(url)
}

/// The WebSocket URLs a workspace's Durable Object answers: the sidecar relay and a terminal.
pub const RELAY_CHANNELS: [&str; 2] = ["rpc", "terminal"];

/// Whether a workspace's sandbox id has the shape the Worker accepts.
fn checked_vm_id(vm_id: &str) -> CommandResult<()> {
    if vm_id.is_empty()
        || vm_id.len() > 63
        || !vm_id.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        || vm_id.starts_with('-')
        || vm_id.ends_with('-')
    {
        return Err(refused(
            "cloud_vm_id_invalid",
            "A workspace id is lowercase letters, digits and dashes, and no longer than 63 characters.",
        ));
    }
    Ok(())
}

/// The WebSocket URL for one workspace's relay or terminal stream.
pub fn relay_url(base: &reqwest::Url, vm_id: &str, channel: &str) -> CommandResult<reqwest::Url> {
    checked_vm_id(vm_id)?;
    if !RELAY_CHANNELS.contains(&channel) {
        return Err(refused(
            "cloud_bad_channel",
            "A cloud stream is the sidecar relay or a terminal.",
        ));
    }
    let url = route_url(base, &format!("/w/{vm_id}/{channel}"))?;
    let mut url = url;
    url.set_scheme("wss").map_err(|_| {
        refused(
            "cloud_url_not_allowed",
            "The relay URL could not be made secure.",
        )
    })?;
    Ok(url)
}

/// The WebSocket URL of one remote port's tunnel, which the Rust shell pipes a local listener into
/// (CLOUD-10). The Worker's tunnel route sits beside the relay and terminal routes.
pub fn tunnel_url(base: &reqwest::Url, vm_id: &str, port: u16) -> CommandResult<reqwest::Url> {
    checked_vm_id(vm_id)?;
    if port == 22 {
        return Err(refused(
            "port_forward_reserved",
            "Port 22 is reserved for SSH and cannot be forwarded here.",
        ));
    }
    let mut url = route_url(base, &format!("/w/{vm_id}/tunnel"))?;
    url.set_scheme("wss").map_err(|_| {
        refused(
            "cloud_url_not_allowed",
            "The tunnel URL could not be made secure.",
        )
    })?;
    url.set_query(Some(&format!("port={port}")));
    Ok(url)
}

/// The WebSocket URL of the workspace's SSH door (CLOUD-12). Unlike a tunnel, it names no port:
/// the Worker's `/ssh` route always reaches the sandbox's loopback port 22 and nothing else.
pub fn ssh_tunnel_url(base: &reqwest::Url, vm_id: &str) -> CommandResult<reqwest::Url> {
    checked_vm_id(vm_id)?;
    let mut url = route_url(base, &format!("/w/{vm_id}/ssh"))?;
    url.set_scheme("wss").map_err(|_| {
        refused(
            "cloud_url_not_allowed",
            "The SSH tunnel URL could not be made secure.",
        )
    })?;
    Ok(url)
}

/// The pairing this Mac has, from the two Keychain values. Only a non-empty token counts as
/// paired, and an unpaired Mac reports no Worker even if a stale URL remains.
pub fn pairing_from(token: Option<String>, url: Option<String>) -> CloudPairingPayload {
    match token {
        Some(token) if !token.is_empty() => CloudPairingPayload {
            paired: true,
            url: url.filter(|url| !url.is_empty()),
        },
        _ => CloudPairingPayload {
            paired: false,
            url: None,
        },
    }
}

/// Asks the Worker at `url` whether it accepts `token`, and checks that the answer names this
/// service. The URL is already checked; this takes it as given so a test can drive a local server.
pub async fn ask_worker_for_pairing(
    client: &reqwest::Client,
    url: &reqwest::Url,
    token: &str,
) -> CommandResult<()> {
    let response = client
        .request(reqwest::Method::GET, url.clone())
        .header(reqwest::header::AUTHORIZATION, bearer(token)?)
        .send()
        .await
        .map_err(|error| {
            refused(
                "cloud_request_failed",
                format!("The Worker could not be reached: {error}"),
            )
        })?;
    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(refused(
            "cloud_pair_refused",
            "The Worker refused the pairing token. Check it and try again.",
        ));
    }
    if !status.is_success() {
        return Err(refused(
            "cloud_request_failed",
            format!("The Worker answered {status}."),
        ));
    }
    let bytes = response.bytes().await.map_err(|error| {
        refused(
            "cloud_request_failed",
            format!("The Worker's pairing answer was cut off: {error}"),
        )
    })?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err(refused(
            "cloud_response_too_large",
            "The Worker's pairing answer is too large for the app.",
        ));
    }
    let answer: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
        refused(
            "cloud_not_a_worker",
            "That URL did not answer as a Conducted Worker.",
        )
    })?;
    let names_this_service = answer.get("service").and_then(|value| value.as_str())
        == Some(PAIR_SERVICE)
        && answer.get("paired").and_then(|value| value.as_bool()) == Some(true);
    if !names_this_service {
        return Err(refused(
            "cloud_not_a_worker",
            "That URL did not answer as a Conducted Worker.",
        ));
    }
    Ok(())
}

/// Reads the pairing token from the Keychain. A missing token is `cloud_not_paired`, not an empty
/// header.
pub async fn pairing_token() -> CommandResult<String> {
    let token = blocking("cloud_token_unreadable", || {
        keychain::read_secret(keychain::SERVICE, PAIRING_TOKEN_KEY)
    })
    .await?
    .ok_or_else(|| {
        refused(
            "cloud_not_paired",
            "This Mac is not paired with a cloud Workspace. Pair it in Settings first.",
        )
    })?;
    if token.is_empty() {
        return Err(refused(
            "cloud_not_paired",
            "The saved pairing token is empty. Pair this Mac again.",
        ));
    }
    Ok(token)
}

pub(crate) fn bearer(token: &str) -> CommandResult<HeaderValue> {
    HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| {
        refused(
            "cloud_token_unreadable",
            "The pairing token cannot be a header.",
        )
    })
}

/// Whether this Mac is paired, and with which Worker. The token itself never leaves Rust.
#[tauri::command]
pub async fn cloud_pairing() -> CommandResult<CloudPairingPayload> {
    let (token, url) = blocking("cloud_token_unreadable", || {
        let token = keychain::read_secret(keychain::SERVICE, PAIRING_TOKEN_KEY)?;
        let url = keychain::read_secret(keychain::SERVICE, PAIRING_URL_KEY)?;
        Ok((token, url))
    })
    .await?;
    Ok(pairing_from(token, url))
}

/// Checks a Worker URL and token with the Worker, then keeps both in the Keychain. A refused
/// token leaves any earlier pairing in place.
#[tauri::command]
pub async fn cloud_pair(input: CloudPairInput) -> CommandResult<CloudPairingPayload> {
    let base = checked_worker_url(&input.url)?;
    let token = input.token.trim();
    if token.is_empty() {
        return Err(refused("cloud_token_invalid", "A pairing token is needed."));
    }
    let url = route_url(&base, PAIR_PATH)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
        .build()
        .map_err(|error| {
            refused(
                "cloud_request_failed",
                format!("The HTTP client did not start: {error}"),
            )
        })?;
    ask_worker_for_pairing(&client, &url, token).await?;
    write_pairing(&base, token).await
}

/// Keeps the URL and token, URL first, restoring the earlier pair if either write fails. Only a
/// non-empty token counts as paired (D106).
async fn write_pairing(base: &reqwest::Url, token: &str) -> CommandResult<CloudPairingPayload> {
    let (old_token, old_url) = blocking("cloud_token_unreadable", || {
        let token = keychain::read_secret(keychain::SERVICE, PAIRING_TOKEN_KEY)?;
        let url = keychain::read_secret(keychain::SERVICE, PAIRING_URL_KEY)?;
        Ok((token, url))
    })
    .await?;
    // The same one spelling the TypeScript side stores: no trailing slash.
    let stored_url = base.as_str().trim_end_matches('/').to_string();
    let written_url = stored_url.clone();
    let stored_token = token.to_string();
    blocking("cloud_token_unreadable", move || {
        let saved = (|| {
            keychain::write_secret(keychain::SERVICE, PAIRING_URL_KEY, &written_url)?;
            keychain::write_secret(keychain::SERVICE, PAIRING_TOKEN_KEY, &stored_token)
        })();
        if saved.is_err() {
            // Put back what was there: a half-written pair would pair a new URL with an old token.
            let _ = match old_url {
                Some(value) => keychain::write_secret(keychain::SERVICE, PAIRING_URL_KEY, &value),
                None => keychain::remove_secret(keychain::SERVICE, PAIRING_URL_KEY),
            };
            let _ = match old_token {
                Some(value) => keychain::write_secret(keychain::SERVICE, PAIRING_TOKEN_KEY, &value),
                None => keychain::remove_secret(keychain::SERVICE, PAIRING_TOKEN_KEY),
            };
        }
        saved
    })
    .await?;
    Ok(CloudPairingPayload {
        paired: true,
        url: Some(stored_url),
    })
}

/// Removes this Mac's pairing. A Mac that was never paired succeeds.
#[tauri::command]
pub async fn cloud_unpair() -> CommandResult<()> {
    blocking("cloud_token_unreadable", || {
        keychain::remove_secret(keychain::SERVICE, PAIRING_TOKEN_KEY)?;
        keychain::remove_secret(keychain::SERVICE, PAIRING_URL_KEY)
    })
    .await
}

/// How long a deploy may take: uploading and building the container image took 40 to 80 seconds on
/// this Mac (the spike), and a first build on a slow link can take longer.
pub const DEPLOY_TIMEOUT: Duration = Duration::from_secs(20 * 60);
/// How long a listing or small management call may take.
pub const WRANGLER_TIMEOUT: Duration = Duration::from_secs(2 * 60);
/// The names a deploy writes into the user's account: lowercase letters, digits and dashes, and no
/// dash at either end, as Cloudflare names a Worker.
fn checked_resource_name(code: &'static str, what: &str, name: &str) -> CommandResult<()> {
    let well_formed = name.len() >= 3
        && name.len() <= 63
        && !name.starts_with('-')
        && !name.ends_with('-')
        && name.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        });
    if well_formed {
        return Ok(());
    }
    Err(refused(
        code,
        format!("The {what} name \"{name}\" is not a lowercase Cloudflare name."),
    ))
}

/// The deploy folder inside the app's resources. A packaged app always has it; a dev run reads the
/// folder `pnpm cloud:prepare` built, and a dev run without it gets a named error, never a guess.
pub fn deploy_resources(resource_dir: &Path) -> CommandResult<PathBuf> {
    let bundled = resource_dir.join(CLOUD_RESOURCES);
    if bundled.is_dir() {
        return Ok(bundled);
    }
    if cfg!(debug_assertions) {
        let prepared = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(CLOUD_RESOURCES);
        if prepared.is_dir() {
            return Ok(prepared);
        }
    }
    Err(refused(
        "cloud_resources_missing",
        "This build carries no deploy inputs. Run `pnpm cloud:prepare` and start the app again.",
    ))
}

/// The facts the deploy inputs state, from `deploy.json`.
pub fn read_deploy_facts(resources: &Path) -> CommandResult<DeployFacts> {
    let path = resources.join(DEPLOY_FACT_FILE);
    let text = std::fs::read_to_string(&path).map_err(|error| {
        refused(
            "cloud_resources_invalid",
            format!("The deploy inputs are unreadable: {error}"),
        )
    })?;
    serde_json::from_str(&text).map_err(|error| {
        refused(
            "cloud_resources_invalid",
            format!("The deploy inputs are not valid: {error}"),
        )
    })
}

/// The name a deploy uses: the input's override, or the bundled default.
pub fn deploy_name(input: Option<&CloudDeployInput>, facts: &DeployFacts) -> String {
    input
        .and_then(|value| value.worker_name.clone())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| facts.name.clone())
}

/// The container application and bucket a Worker name owns. One rule for deploy and uninstall.
pub fn container_name(worker: &str) -> String {
    format!("{worker}-sandbox")
}

/// The first `major.minor.patch` in wrangler's `--version` output.
pub fn parse_wrangler_version(text: &str) -> Option<(u32, u32, u32)> {
    let token = text.split_whitespace().find_map(|word| {
        let clean = word.trim_start_matches('v');
        let mut parts = clean.split('.');
        let major = parts.next()?.parse::<u32>().ok()?;
        let minor = parts.next()?.parse::<u32>().ok()?;
        let patch = parts
            .next()?
            .trim_end_matches(|c: char| !c.is_ascii_digit());
        let patch = patch.parse::<u32>().ok()?;
        Some((major, minor, patch))
    })?;
    Some(token)
}

/// Refuses a wrangler too old for the sandbox's container config, before anything is created.
fn require_wrangler_version(wrangler: &Wrangler, cwd: &Path) -> CommandResult<()> {
    let output = wrangler.run(&[String::from("--version")], cwd, None, WRANGLER_TIMEOUT)?;
    let version = parse_wrangler_version(&output.stdout).ok_or_else(|| {
        refused(
            "cloud_wrangler_failed",
            "wrangler did not say its version. Run `npm install -g wrangler@latest` and deploy again.",
        )
    })?;
    if version < MIN_WRANGLER_VERSION {
        return Err(refused("cloud_wrangler_too_old", WRANGLER_OLD_HELP));
    }
    Ok(())
}

/// A name part no other temp path of this process shares: the process id, the time and a count.
/// The time alone repeats: macOS clocks tick in microseconds, and two deploys or tests started in
/// the same tick took the same folder.
fn unique_temp_part() -> String {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    format!(
        "{}-{nanos}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

/// The writable temp folder one deploy uses for its config and secret file, under `temp_root`.
fn deploy_temp_folder(temp_root: &Path) -> CommandResult<PathBuf> {
    let folder = temp_root.join(format!("conducted-deploy-{}", unique_temp_part()));
    std::fs::create_dir_all(&folder).map_err(|error| {
        refused(
            "cloud_wrangler_failed",
            format!("The deploy's temp folder could not be made: {error}"),
        )
    })?;
    Ok(folder)
}

/// The wrangler config for one deploy: the bundled worker and Dockerfile, and the names derived
/// from the Worker name. Written to the deploy's temp folder.
pub fn deploy_config(facts: &DeployFacts, resources: &Path, worker: &str) -> serde_json::Value {
    let mut images = serde_json::Map::new();
    images.insert(
        facts.image_key.clone(),
        serde_json::json!({ "dockerfile": resources.join(DEPLOY_DOCKERFILE) }),
    );
    let mut exports = serde_json::Map::new();
    exports.insert(
        facts.class_name.clone(),
        serde_json::json!({ "type": "durable-object", "storage": "sqlite" }),
    );
    serde_json::json!({
        "name": worker,
        "main": resources.join(DEPLOY_WORKER_FILE),
        "no_bundle": true,
        "compatibility_date": facts.compatibility_date,
        "compatibility_flags": facts.compatibility_flags,
        "vars": { "INSTANCE_TYPE": facts.instance },
        "containers": [{
            "name": container_name(worker),
            "class_name": facts.class_name,
            "scheduling_policy": "durable_object",
            "images": images
        }],
        "durable_objects": { "bindings": [{ "class_name": facts.class_name, "name": facts.object_binding }] },
        "exports": exports,
        "r2_buckets": [{ "binding": facts.backup_binding, "bucket_name": worker }]
    })
}

/// Docker must be installed and running, because a Dockerfile image is built locally (D109).
fn require_docker() -> CommandResult<()> {
    match Command::new("docker").arg("info").output() {
        Ok(output) if output.status.success() => Ok(()),
        _ => Err(refused("cloud_docker_missing", DOCKER_MISSING_HELP)),
    }
}

/// 32 random bytes, base64url without padding: what the CLOUD-02 spike made at setup (question 4).
pub fn make_pairing_token() -> CommandResult<String> {
    use base64::Engine as _;
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut source| source.read_exact(&mut bytes))
        .map_err(|error| {
            refused(
                "cloud_token_unreadable",
                format!("The pairing token could not be made: {error}"),
            )
        })?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

/// The Worker URL wrangler printed after a deploy, or None when its output held none.
pub fn deployed_url(stdout: &str) -> Option<String> {
    stdout
        .split_whitespace()
        .map(|word| word.trim_end_matches([',', ';', '.']))
        .find(|word| word.starts_with("https://") && word.contains(".workers.dev"))
        .map(str::to_string)
}

/// The bucket names in `wrangler r2 bucket list`'s table, which prints one `name:` line per bucket.
pub fn bucket_names(listing: &str) -> Vec<String> {
    listing
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            trimmed
                .strip_prefix("name:")
                .map(|name| name.trim().to_string())
        })
        .filter(|name| !name.is_empty())
        .collect()
}

/// The id of the container application called `name` in `wrangler containers list --json`.
pub fn container_id(raw: &str, name: &str) -> Option<String> {
    let parsed: serde_json::Value = serde_json::from_str(raw).ok()?;
    let array = parsed.as_array()?;
    array.iter().find_map(|entry| {
        let named = entry.get("name")?.as_str()? == name;
        if !named {
            return None;
        }
        Some(entry.get("id")?.as_str()?.to_string())
    })
}

/// The `name:tag` references of the images a Worker deployed, from
/// `wrangler containers images list --json`. The image names begin with the Worker's name.
pub fn image_refs(raw: &str, worker: &str) -> Vec<String> {
    let prefix = format!("{worker}-");
    let parsed: Option<serde_json::Value> = serde_json::from_str(raw).ok();
    let Some(array) = parsed.as_ref().and_then(|value| value.as_array()) else {
        return Vec::new();
    };
    let mut refs = Vec::new();
    for entry in array {
        let Some(name) = entry.get("name").and_then(|value| value.as_str()) else {
            continue;
        };
        if !name.starts_with(&prefix) {
            continue;
        }
        if let Some(tags) = entry.get("tags").and_then(|value| value.as_array()) {
            for tag in tags.iter().filter_map(|tag| tag.as_str()) {
                refs.push(format!("{name}:{tag}"));
            }
        }
    }
    refs
}

/// Runs wrangler and turns a failure into the user's message, keeping its own words.
fn run_checked(
    wrangler: &Wrangler,
    args: &[&str],
    cwd: &Path,
    stdin: Option<&str>,
    timeout: Duration,
) -> CommandResult<ProgramOutput> {
    let owned: Vec<String> = args.iter().map(|arg| (*arg).to_string()).collect();
    let output = wrangler.run(&owned, cwd, stdin, timeout)?;
    if output.success {
        return Ok(output);
    }
    Err(refused(
        "cloud_wrangler_failed",
        format!(
            "wrangler {} failed: {}",
            args.first().copied().unwrap_or(""),
            output.stderr.trim()
        ),
    ))
}

/// Cloudflare's API. The uninstall empties and deletes the bucket through it, because wrangler can
/// delete one object by its key but cannot list the objects a bucket holds (issue #635).
pub const CLOUDFLARE_API: &str = "https://api.cloudflare.com/client/v4";
/// The most objects Cloudflare lists in one page.
const OBJECTS_PER_PAGE: u32 = 1000;
/// How many accounts the uninstall asks for per page while it looks for the bucket's account.
const ACCOUNTS_PER_PAGE: u32 = 50;
/// How many times the uninstall empties the bucket and tries to delete it. A second round catches
/// an object written while the first round ran.
const EMPTY_ROUNDS: usize = 3;
/// Cloudflare's error code for deleting a bucket that still holds objects.
const BUCKET_NOT_EMPTY: i64 = 10008;
/// Cloudflare's error code for a token it does not accept. An expired wrangler token met it as
/// 403 on the account list; the R2 routes answer 401 instead.
const INVALID_ACCESS_TOKEN: i64 = 9109;
/// How long one call to Cloudflare's API may take.
const API_TIMEOUT: Duration = Duration::from_secs(60);

/// Where the uninstall reaches Cloudflare's API, and the account it was told to use. The tests
/// point `base` at a stand-in on this Mac.
#[derive(Debug, Clone)]
pub struct CloudflareApi {
    pub base: String,
    /// The account `CLOUDFLARE_ACCOUNT_ID` names, which wrangler also obeys. None looks for the
    /// account that holds the bucket.
    pub account: Option<String>,
}

impl CloudflareApi {
    /// Cloudflare's own API, for the account `CLOUDFLARE_ACCOUNT_ID` names when it is set.
    /// wrangler obeys the same variable, so the API calls reach the account its commands did.
    pub fn from_env() -> Self {
        Self {
            base: String::from(CLOUDFLARE_API),
            account: std::env::var("CLOUDFLARE_ACCOUNT_ID")
                .ok()
                .filter(|id| !id.is_empty()),
        }
    }
}

/// What an uninstall removed from the user's account. Mirrors `CloudUninstallResult` in
/// platform.ts.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudUninstallPayload {
    /// The Worker was deleted.
    pub worker: bool,
    /// The container application was deleted.
    pub container: bool,
    /// How many container images were deleted.
    pub images: usize,
    /// The R2 bucket was deleted.
    pub bucket: bool,
    /// How many objects (the settings object and backups) were deleted from the bucket first.
    pub objects: usize,
}

/// The login wrangler holds, as `wrangler auth token --json` gives it. It has no `Debug`, so it
/// cannot be printed or logged by accident.
#[derive(PartialEq, Eq)]
enum ApiLogin {
    /// An OAuth token from `wrangler login`, or `CLOUDFLARE_API_TOKEN`.
    Token(String),
    /// `CLOUDFLARE_API_KEY` with `CLOUDFLARE_EMAIL`.
    Key { email: String, key: String },
}

/// The login in `wrangler auth token --json`'s output: one JSON object, which may follow a line
/// of warnings.
fn parse_login(stdout: &str) -> Option<ApiLogin> {
    let start = stdout.find('{')?;
    let value: serde_json::Value = serde_json::Deserializer::from_str(&stdout[start..])
        .into_iter()
        .next()?
        .ok()?;
    let text = |field: &str| {
        value
            .get(field)
            .and_then(|item| item.as_str())
            .filter(|item| !item.is_empty())
            .map(str::to_string)
    };
    match value.get("type")?.as_str()? {
        "oauth" | "api_token" => Some(ApiLogin::Token(text("token")?)),
        "api_key" => Some(ApiLogin::Key {
            email: text("email")?,
            key: text("key")?,
        }),
        _ => None,
    }
}

/// Asks wrangler for the login it uses, so the API calls run as the same user as its commands.
/// wrangler refreshes its OAuth token only once the token has expired, and hands back the stored
/// one until then without saying when it expires (issue #675).
fn wrangler_login(wrangler: &Wrangler, cwd: &Path) -> CommandResult<ApiLogin> {
    let output = wrangler.run(
        &[
            String::from("auth"),
            String::from("token"),
            String::from("--json"),
        ],
        cwd,
        None,
        WRANGLER_TIMEOUT,
    )?;
    if !output.success {
        return Err(refused(
            "cloud_wrangler_failed",
            format!(
                "wrangler could not give its login to empty the bucket: {} Run `wrangler login` and remove the deployment again.",
                output.stderr.trim()
            ),
        ));
    }
    parse_login(&output.stdout).ok_or_else(|| {
        refused(
            "cloud_wrangler_failed",
            "wrangler did not give its login in a form the app reads. Run `npm install -g wrangler@latest` and remove the deployment again.",
        )
    })
}

/// A Cloudflare account id names a path segment, so it is letters and digits only.
fn checked_account_id(id: &str) -> CommandResult<()> {
    if !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Ok(());
    }
    Err(refused(
        "cloud_account_invalid",
        format!("The Cloudflare account id \"{id}\" is not one Cloudflare gives."),
    ))
}

/// An object key as a URL path, with every byte outside the unreserved set percent-encoded and
/// its `/` kept. A key with a `.` or `..` segment is refused: a URL parser folds those away, so
/// the call would name another object.
fn object_path(key: &str) -> Option<String> {
    if key.is_empty()
        || key
            .split('/')
            .any(|segment| segment == "." || segment == "..")
    {
        return None;
    }
    let mut path = String::with_capacity(key.len());
    for byte in key.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~' | b'/') {
            path.push(char::from(byte));
        } else {
            path.push_str(&format!("%{byte:02X}"));
        }
    }
    Some(path)
}

/// One answer from Cloudflare's API: the status and its JSON envelope.
struct ApiAnswer {
    status: u16,
    body: serde_json::Value,
}

impl ApiAnswer {
    fn succeeded(&self) -> bool {
        (200..300).contains(&self.status)
            && self.body.get("success").and_then(|value| value.as_bool()) != Some(false)
    }

    /// Cloudflare did not accept the login: 401 on the R2 routes, 403 with code 9109 on the
    /// account list.
    fn login_refused(&self) -> bool {
        self.status == 401 || (self.status == 403 && self.has_code(INVALID_ACCESS_TOKEN))
    }

    fn has_code(&self, code: i64) -> bool {
        self.body
            .get("errors")
            .and_then(|errors| errors.as_array())
            .is_some_and(|errors| {
                errors
                    .iter()
                    .any(|error| error.get("code").and_then(|item| item.as_i64()) == Some(code))
            })
    }

    /// The user's message for a call that failed, with Cloudflare's own words and codes. A refused
    /// login is one Cloudflare refused even after wrangler was asked for it again.
    fn failure(&self, doing: &str) -> CommandError {
        let said: Vec<String> = self
            .body
            .get("errors")
            .and_then(|errors| errors.as_array())
            .map(|errors| {
                errors
                    .iter()
                    .map(|error| {
                        let message = error
                            .get("message")
                            .and_then(|item| item.as_str())
                            .unwrap_or("no message");
                        match error.get("code").and_then(|item| item.as_i64()) {
                            Some(code) => format!("{message} (code {code})"),
                            None => message.to_string(),
                        }
                    })
                    .collect()
            })
            .unwrap_or_default();
        let said = if said.is_empty() {
            String::from("no reason given")
        } else {
            said.join("; ")
        };
        if self.login_refused() {
            return refused(
                "cloud_login_refused",
                format!(
                    "Cloudflare refused your login to {doing}: HTTP {}, {said}. Run `wrangler login` and remove the deployment again.",
                    self.status
                ),
            );
        }
        refused(
            "cloud_api_failed",
            format!(
                "Cloudflare refused to {doing}: HTTP {}, {said}.",
                self.status
            ),
        )
    }
}

/// The uninstall's calls to Cloudflare's API, with wrangler's login. wrangler's OAuth token lasts
/// an hour, and `wrangler auth token` hands back the stored one until it has expired, so a token
/// read before the bucket is emptied can expire partway through (issue #675). Cloudflare then
/// refuses the login. The session asks wrangler for its login again and repeats the call once,
/// only when wrangler hands back a different login. The same login is reported, never retried.
struct ApiSession<'a> {
    client: reqwest::Client,
    wrangler: &'a Wrangler,
    cwd: &'a Path,
    login: ApiLogin,
}

impl<'a> ApiSession<'a> {
    /// Starts with the login wrangler holds now.
    fn start(wrangler: &'a Wrangler, cwd: &'a Path) -> CommandResult<Self> {
        let login = wrangler_login(wrangler, cwd)?;
        let client = reqwest::Client::builder()
            .timeout(API_TIMEOUT)
            .build()
            .map_err(|error| {
                refused(
                    "cloud_api_failed",
                    format!("The HTTP client did not start: {error}"),
                )
            })?;
        Ok(Self {
            client,
            wrangler,
            cwd,
            login,
        })
    }

    /// One call. A refused login reads wrangler's login again; a new one repeats the call once.
    async fn call(
        &mut self,
        method: reqwest::Method,
        url: reqwest::Url,
    ) -> CommandResult<ApiAnswer> {
        let answer = api_call(&self.client, &self.login, method.clone(), url.clone()).await?;
        if !answer.login_refused() {
            return Ok(answer);
        }
        let fresh = wrangler_login(self.wrangler, self.cwd)?;
        if fresh == self.login {
            return Ok(answer);
        }
        self.login = fresh;
        api_call(&self.client, &self.login, method, url).await
    }
}

/// One call to Cloudflare's API with wrangler's login. The login goes in a header only.
async fn api_call(
    client: &reqwest::Client,
    login: &ApiLogin,
    method: reqwest::Method,
    url: reqwest::Url,
) -> CommandResult<ApiAnswer> {
    let request = client.request(method, url);
    let request = match login {
        ApiLogin::Token(token) => request.bearer_auth(token),
        ApiLogin::Key { email, key } => request
            .header("X-Auth-Email", email)
            .header("X-Auth-Key", key),
    };
    let response = request.send().await.map_err(|error| {
        refused(
            "cloud_api_failed",
            format!("Cloudflare's API could not be reached: {error}"),
        )
    })?;
    let status = response.status().as_u16();
    let text = response.text().await.map_err(|error| {
        refused(
            "cloud_api_failed",
            format!("Cloudflare's answer could not be read: {error}"),
        )
    })?;
    let body = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    Ok(ApiAnswer { status, body })
}

/// The API URL for `path`, which starts with `/`.
fn api_url(api: &CloudflareApi, path: &str) -> CommandResult<reqwest::Url> {
    let raw = format!("{}{path}", api.base.trim_end_matches('/'));
    reqwest::Url::parse(&raw).map_err(|error| {
        refused(
            "cloud_api_failed",
            format!("The Cloudflare API address is not valid: {error}"),
        )
    })
}

/// Every account the login reaches, page by page.
async fn api_accounts(
    session: &mut ApiSession<'_>,
    api: &CloudflareApi,
) -> CommandResult<Vec<String>> {
    let mut ids = Vec::new();
    let mut page = 1u64;
    loop {
        let mut url = api_url(api, "/accounts")?;
        url.query_pairs_mut()
            .append_pair("page", &page.to_string())
            .append_pair("per_page", &ACCOUNTS_PER_PAGE.to_string());
        let answer = session.call(reqwest::Method::GET, url).await?;
        if !answer.succeeded() {
            return Err(answer.failure("list your accounts"));
        }
        let listed: Vec<String> = answer
            .body
            .get("result")
            .and_then(|result| result.as_array())
            .map(|accounts| {
                accounts
                    .iter()
                    .filter_map(|account| account.get("id").and_then(|id| id.as_str()))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let pages = answer
            .body
            .pointer("/result_info/total_pages")
            .and_then(|value| value.as_u64())
            .unwrap_or(page);
        if listed.is_empty() || page >= pages {
            ids.extend(listed);
            return Ok(ids);
        }
        ids.extend(listed);
        page += 1;
    }
}

/// The account that holds a bucket with exactly this name, or None when no account does. Two
/// accounts with the same bucket name are refused, so the uninstall never empties a bucket of
/// the wrong account.
async fn bucket_account(
    session: &mut ApiSession<'_>,
    api: &CloudflareApi,
    bucket: &str,
) -> CommandResult<Option<String>> {
    let accounts = match &api.account {
        Some(account) => vec![account.clone()],
        None => api_accounts(session, api).await?,
    };
    let mut holders = Vec::new();
    let mut unreadable = 0usize;
    for account in accounts {
        checked_account_id(&account)?;
        let url = api_url(api, &format!("/accounts/{account}/r2/buckets/{bucket}"))?;
        let answer = session.call(reqwest::Method::GET, url).await?;
        match answer.status {
            _ if answer.succeeded() => holders.push(account),
            404 => {}
            401 | 403 => unreadable += 1,
            _ => return Err(answer.failure(&format!("look up the bucket {bucket}"))),
        }
    }
    match holders.len() {
        0 if unreadable == 0 => Ok(None),
        0 => Err(refused(
            "cloud_bucket_unreadable",
            format!(
                "Your login could not read the buckets of {unreadable} account(s), so the app cannot tell whether the bucket {bucket} is gone. Set CLOUDFLARE_ACCOUNT_ID to the account you deployed to and remove the deployment again."
            ),
        )),
        1 => Ok(holders.pop()),
        several => Err(refused(
            "cloud_bucket_account_unclear",
            format!(
                "{several} of your Cloudflare accounts hold a bucket named {bucket}. Set CLOUDFLARE_ACCOUNT_ID to the account you deployed to and remove the deployment again."
            ),
        )),
    }
}

/// Deletes every object in the bucket, page by page, and counts the ones it deleted. An object
/// that is gone by the time its delete arrives is skipped.
async fn empty_bucket(
    session: &mut ApiSession<'_>,
    api: &CloudflareApi,
    account: &str,
    bucket: &str,
) -> CommandResult<usize> {
    let objects = format!("/accounts/{account}/r2/buckets/{bucket}/objects");
    let mut deleted = 0usize;
    let mut cursor: Option<String> = None;
    loop {
        let mut url = api_url(api, &objects)?;
        {
            let mut query = url.query_pairs_mut();
            query.append_pair("per_page", &OBJECTS_PER_PAGE.to_string());
            if let Some(after) = &cursor {
                query.append_pair("cursor", after);
            }
        }
        let answer = session.call(reqwest::Method::GET, url).await?;
        if answer.status == 404 {
            return Ok(deleted);
        }
        if !answer.succeeded() {
            return Err(answer.failure(&format!("list the objects in the bucket {bucket}")));
        }
        let keys: Vec<String> = answer
            .body
            .get("result")
            .and_then(|result| result.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.get("key").and_then(|key| key.as_str()))
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        for key in &keys {
            let path = object_path(key).ok_or_else(|| {
                refused(
                    "cloud_bucket_key_unaddressable",
                    format!(
                        "The bucket {bucket} holds an object named \"{key}\", which Cloudflare's API cannot address. Delete it in the Cloudflare dashboard and remove the deployment again."
                    ),
                )
            })?;
            let url = api_url(api, &format!("{objects}/{path}"))?;
            let answer = session.call(reqwest::Method::DELETE, url).await?;
            match answer.status {
                _ if answer.succeeded() => deleted += 1,
                404 => {}
                _ => {
                    return Err(answer.failure(&format!(
                        "delete the object \"{key}\" in the bucket {bucket}"
                    )));
                }
            }
        }
        let truncated = answer
            .body
            .pointer("/result_info/is_truncated")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        let next = answer
            .body
            .pointer("/result_info/cursor")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        match next {
            Some(next) if truncated && !keys.is_empty() && cursor.as_ref() != Some(&next) => {
                cursor = Some(next);
            }
            _ => return Ok(deleted),
        }
    }
}

/// Empties the bucket with exactly this name and deletes it. Returns whether a bucket was deleted
/// and how many objects were. A bucket no account holds is skipped, so a second uninstall
/// succeeds.
async fn remove_bucket(
    session: &mut ApiSession<'_>,
    api: &CloudflareApi,
    bucket: &str,
) -> CommandResult<(bool, usize)> {
    let Some(account) = bucket_account(session, api, bucket).await? else {
        return Ok((false, 0));
    };
    let url = api_url(api, &format!("/accounts/{account}/r2/buckets/{bucket}"))?;
    let mut objects = 0usize;
    for _ in 0..EMPTY_ROUNDS {
        objects += empty_bucket(session, api, &account, bucket).await?;
        let answer = session.call(reqwest::Method::DELETE, url.clone()).await?;
        if answer.succeeded() {
            return Ok((true, objects));
        }
        if answer.status == 404 {
            return Ok((false, objects));
        }
        if !answer.has_code(BUCKET_NOT_EMPTY) {
            return Err(answer.failure(&format!("delete the bucket {bucket}")));
        }
    }
    Err(refused(
        "cloud_bucket_not_empty",
        format!(
            "The bucket {bucket} still held objects after it was emptied {EMPTY_ROUNDS} times, so something is still writing to it. {objects} objects were deleted. Remove the deployment again."
        ),
    ))
}

/// Creates the R2 bucket a Worker's backups need, unless the user's account already has it.
fn ensure_bucket(wrangler: &Wrangler, source: &Path, bucket: &str) -> CommandResult<()> {
    let listed = run_checked(
        wrangler,
        &["r2", "bucket", "list"],
        source,
        None,
        WRANGLER_TIMEOUT,
    )?;
    if bucket_names(&listed.stdout)
        .iter()
        .any(|name| name == bucket)
    {
        return Ok(());
    }
    run_checked(
        wrangler,
        &["r2", "bucket", "create", bucket],
        source,
        None,
        WRANGLER_TIMEOUT,
    )?;
    Ok(())
}

/// Writes the pairing token to a mode-600 file `wrangler deploy --secrets-file` reads, and returns
/// its path so the caller removes it whatever happens.
fn write_secret_file(temp_root: &Path, token: &str) -> CommandResult<PathBuf> {
    use std::os::unix::fs::OpenOptionsExt as _;
    let path = temp_root.join(format!("conducted-deploy-{}.json", unique_temp_part()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
        .map_err(|error| {
            refused(
                "cloud_wrangler_failed",
                format!("The secret file could not be made: {error}"),
            )
        })?;
    let body = serde_json::json!({ PAIRING_SECRET_NAME: token });
    file.write_all(body.to_string().as_bytes())
        .map_err(|error| {
            refused(
                "cloud_wrangler_failed",
                format!("The secret file could not be written: {error}"),
            )
        })?;
    Ok(path)
}

/// The steps of a deploy, run off the async runtime: the shipped inputs, Docker, the bucket, the
/// generated config, the Worker with its token, and the URL it printed. The temp folder and the
/// secret file are removed whatever the deploy did.
pub fn deploy_worker(
    wrangler: &Wrangler,
    resources: &Path,
    worker: &str,
    token: &str,
    progress: &dyn Fn(&str),
) -> CommandResult<String> {
    deploy_worker_with(
        wrangler,
        resources,
        worker,
        token,
        &std::env::temp_dir(),
        require_docker,
        progress,
    )
}

/// The deploy's steps with the temp root and the Docker check passed in, so a test can run them
/// without Docker and check what it left in a folder of its own.
fn deploy_worker_with<F>(
    wrangler: &Wrangler,
    resources: &Path,
    worker: &str,
    token: &str,
    temp_root: &Path,
    docker: F,
    progress: &dyn Fn(&str),
) -> CommandResult<String>
where
    F: FnOnce() -> CommandResult<()>,
{
    checked_resource_name("cloud_worker_name_invalid", "Worker", worker)?;
    checked_resource_name("cloud_bucket_name_invalid", "bucket", worker)?;
    checked_resource_name(
        "cloud_container_name_invalid",
        "container application",
        &container_name(worker),
    )?;
    let facts = read_deploy_facts(resources)?;
    if !resources.join(DEPLOY_WORKER_FILE).is_file() {
        return Err(refused(
            "cloud_resources_invalid",
            "This build's deploy inputs hold no worker.js. Run `pnpm cloud:prepare`.",
        ));
    }
    if !resources.join(DEPLOY_DOCKERFILE).is_file() {
        return Err(refused(
            "cloud_resources_invalid",
            "This build's deploy inputs hold no sandbox Dockerfile. Run `pnpm cloud:prepare`.",
        ));
    }
    require_wrangler_version(wrangler, resources)?;
    // The docs build a Dockerfile image at deploy time; say so before anything is created.
    progress("Checking Docker");
    docker()?;
    // wrangler writes its own state under the working folder; use the deploy's temp folder so the
    // app bundle is never written to.
    let folder = deploy_temp_folder(temp_root)?;
    progress("Creating the bucket");
    ensure_bucket(wrangler, &folder, worker)?;
    let config = folder.join("wrangler.jsonc");
    if let Err(error) = std::fs::write(
        &config,
        deploy_config(&facts, resources, worker).to_string(),
    ) {
        let _ = std::fs::remove_dir_all(&folder);
        return Err(refused(
            "cloud_wrangler_failed",
            format!("The deploy config could not be written: {error}"),
        ));
    }
    let secrets = match write_secret_file(temp_root, token) {
        Ok(path) => path,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&folder);
            return Err(error);
        }
    };
    let config = config.to_string_lossy().into_owned();
    let secrets_arg = secrets.to_string_lossy().into_owned();
    // One wrangler call builds the sandbox image, uploads the Worker and sets the secret, so the
    // shell names that whole step rather than guessing where wrangler is inside it.
    progress("Building the image and uploading the Worker");
    let result = run_checked(
        wrangler,
        &[
            "deploy",
            "--config",
            &config,
            "--secrets-file",
            &secrets_arg,
        ],
        &folder,
        None,
        DEPLOY_TIMEOUT,
    );
    let _ = std::fs::remove_file(&secrets);
    let _ = std::fs::remove_dir_all(&folder);
    let output = result?;
    deployed_url(&output.stdout).ok_or_else(|| {
        refused(
            "cloud_deploy_no_url",
            "The Worker deployed but wrangler printed no workers.dev URL to pair with.",
        )
    })
}

/// The resources folder for the running app.
fn app_deploy_resources(app: &AppHandle) -> CommandResult<PathBuf> {
    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| CommandError::Failed {
            code: "cloud_resources_missing",
            message: format!("Could not find the app resources folder: {error}"),
        })?;
    deploy_resources(&resources)
}

/// Deploys the Worker, its container application and its R2 bucket to the user's account, sets the
/// pairing token as a Worker secret, and pairs this Mac with the result (CLOUD-08). The inputs are
/// the app's own bundled copy, so the user chooses no folder.
#[tauri::command]
pub async fn cloud_deploy(
    app: AppHandle,
    input: Option<CloudDeployInput>,
) -> CommandResult<CloudDeployPayload> {
    let resources = app_deploy_resources(&app)?;
    let facts = read_deploy_facts(&resources)?;
    let worker = deploy_name(input.as_ref(), &facts);
    let token = make_pairing_token()?;
    let wrangler = Wrangler::new();
    let with_token = token.clone();
    let progress_app = app.clone();
    let url = blocking("cloud_deploy_failed", move || {
        let progress = |step: &str| {
            let _ = progress_app.emit(
                EVENT_DEPLOY,
                DeployStep {
                    step: step.to_string(),
                },
            );
        };
        deploy_worker(&wrangler, &resources, &worker, &with_token, &progress)
    })
    .await?;
    let base = checked_worker_url(&url)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(DEFAULT_TIMEOUT_MS))
        .build()
        .map_err(|error| {
            refused(
                "cloud_request_failed",
                format!("The HTTP client did not start: {error}"),
            )
        })?;
    let pair_url = route_url(&base, PAIR_PATH)?;
    let _ = app.emit(
        EVENT_DEPLOY,
        DeployStep {
            step: String::from("Pairing this Mac"),
        },
    );
    ask_worker_for_pairing(&client, &pair_url, &token).await?;
    write_pairing(&base, &token).await?;
    Ok(CloudDeployPayload {
        url: base.as_str().trim_end_matches('/').to_string(),
    })
}

/// The steps of an uninstall: the Worker, then its container application and images, then the
/// bucket, which is emptied first because Cloudflare refuses to delete a bucket that holds
/// anything (code 10008, issue #635). Only the bucket with exactly the Worker's name is touched.
/// A resource the account does not have is skipped, so a second uninstall succeeds.
pub fn uninstall_worker(
    wrangler: &Wrangler,
    api: &CloudflareApi,
    resources: &Path,
    worker: &str,
) -> CommandResult<CloudUninstallPayload> {
    checked_resource_name("cloud_worker_name_invalid", "Worker", worker)?;
    checked_resource_name("cloud_bucket_name_invalid", "bucket", worker)?;
    let mut removed = CloudUninstallPayload::default();
    let deleted = wrangler.run(
        &[
            String::from("delete"),
            String::from("--name"),
            worker.to_string(),
            String::from("--force"),
        ],
        resources,
        None,
        WRANGLER_TIMEOUT,
    )?;
    if deleted.success {
        removed.worker = true;
    } else {
        let said = deleted.stderr.to_ascii_lowercase();
        let already_gone = said.contains("does not exist") || said.contains("not found");
        if !already_gone {
            return Err(refused(
                "cloud_wrangler_failed",
                format!("wrangler delete failed: {}", deleted.stderr.trim()),
            ));
        }
    }

    let containers = wrangler.run(
        &[
            String::from("containers"),
            String::from("list"),
            String::from("--json"),
        ],
        resources,
        None,
        WRANGLER_TIMEOUT,
    )?;
    if let Some(id) = containers
        .success
        .then(|| container_id(&containers.stdout, &container_name(worker)))
        .flatten()
    {
        run_checked(
            wrangler,
            &["containers", "delete", &id],
            resources,
            None,
            WRANGLER_TIMEOUT,
        )?;
        removed.container = true;
    }

    let images = wrangler.run(
        &[
            String::from("containers"),
            String::from("images"),
            String::from("list"),
            String::from("--json"),
        ],
        resources,
        None,
        WRANGLER_TIMEOUT,
    )?;
    if images.success {
        for reference in image_refs(&images.stdout, worker) {
            run_checked(
                wrangler,
                &["containers", "images", "delete", &reference, "-y"],
                resources,
                None,
                WRANGLER_TIMEOUT,
            )?;
            removed.images += 1;
        }
    }

    // The Worker is gone by now, so nothing writes to the bucket while it is emptied.
    let (bucket, objects) = ApiSession::start(wrangler, resources)
        .and_then(|mut session| {
            tauri::async_runtime::block_on(remove_bucket(&mut session, api, worker))
        })
        .map_err(|error| bucket_left(error, &removed, worker))?;
    removed.bucket = bucket;
    removed.objects = objects;
    Ok(removed)
}

/// A failure while the bucket is emptied or deleted, told with what the uninstall already deleted
/// and what is still on the account. A second uninstall skips what is gone, so it removes the rest.
fn bucket_left(error: CommandError, removed: &CloudUninstallPayload, bucket: &str) -> CommandError {
    let CommandError::Failed { code, message } = error else {
        return error;
    };
    let mut gone = Vec::new();
    if removed.worker {
        gone.push(String::from("the Worker"));
    }
    if removed.container {
        gone.push(String::from("the container application"));
    }
    match removed.images {
        0 => {}
        1 => gone.push(String::from("1 image")),
        count => gone.push(format!("{count} images")),
    }
    let left = format!("the bucket {bucket} is still on your account");
    let state = match gone.split_last() {
        None => format!("The bucket {bucket} is still on your account."),
        Some((last, [])) => {
            let verb = if removed.images > 1 { "are" } else { "is" };
            format!("{} {verb} deleted, but {left}.", capitalised(last))
        }
        Some((last, rest)) => format!(
            "{} and {last} are deleted, but {left}.",
            capitalised(&rest.join(", "))
        ),
    };
    refused(code, format!("{state} {message}"))
}

/// The text with its first letter in upper case.
fn capitalised(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

/// Deletes what a deploy made, in the order that stops billing: the Worker, its container
/// application and images, then the R2 bucket with everything in it. It also removes this Mac's
/// pairing, and says what it removed.
#[tauri::command]
pub async fn cloud_uninstall(
    app: AppHandle,
    input: Option<CloudUninstallInput>,
) -> CommandResult<CloudUninstallPayload> {
    let resources = app_deploy_resources(&app)?;
    let facts = read_deploy_facts(&resources)?;
    let worker = input
        .as_ref()
        .and_then(|value| value.worker_name.clone())
        .filter(|name| !name.is_empty())
        .unwrap_or(facts.name);
    let wrangler = Wrangler::new();
    let api = CloudflareApi::from_env();
    let removed = blocking("cloud_uninstall_failed", move || {
        uninstall_worker(&wrangler, &api, &resources, &worker)
    })
    .await?;
    cloud_unpair().await?;
    Ok(removed)
}

/// One HTTPS request to the Worker. `status` and `body` are returned for every answer, including a
/// 4xx and 5xx, so the UI can read the Worker's own error.
#[tauri::command]
pub async fn cloud_request(input: CloudRequestInput) -> CommandResult<CloudResponsePayload> {
    let base = checked_worker_url(&input.url)?;
    let url = route_url(&base, &input.path)?;
    let method = match input.method.as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        other => {
            return Err(refused(
                "cloud_method_not_allowed",
                format!("{other} is not a cloud request method."),
            ));
        }
    };
    let token = pairing_token().await?;
    let timeout = input.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout))
        .build()
        .map_err(|error| {
            refused(
                "cloud_request_failed",
                format!("The HTTP client did not start: {error}"),
            )
        })?;
    let mut request = client
        .request(method, url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
    if let Some(body) = input.body {
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body.to_string());
    }
    let response = request.send().await.map_err(|error| {
        refused(
            "cloud_request_failed",
            format!("The Worker could not be reached: {error}"),
        )
    })?;
    let status = response.status().as_u16();
    let bytes = response.bytes().await.map_err(|error| {
        refused(
            "cloud_request_failed",
            format!("The Worker's answer was cut off: {error}"),
        )
    })?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err(refused(
            "cloud_response_too_large",
            "The Worker's answer is too large for the app.",
        ));
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();
    Ok(CloudResponsePayload { status, body })
}

/// Opens the WebSocket relay to one workspace and returns its id. The connection is made before
/// this returns, so the UI's first line is not lost.
#[tauri::command]
pub async fn cloud_relay_open(
    app: AppHandle,
    state: State<'_, CloudState>,
    url: String,
    vm_id: String,
    channel: Option<String>,
) -> CommandResult<String> {
    // Check the URL and channel before touching the Keychain, as the command always has.
    let base = checked_worker_url(&url)?;
    let channel = channel.unwrap_or_else(|| String::from("rpc"));
    relay_url(&base, &vm_id, &channel)?;
    let token = pairing_token().await?;
    open_relay(
        app,
        &state,
        &url,
        &vm_id,
        Some(channel.as_str()),
        &token,
        None,
    )
    .await
}

/// The relay itself, with its channel, pairing token and TLS trust passed in. Production reads the
/// token from the Keychain and uses the system trust. The integration test in
/// `tests/cloud_relay_workerd.rs` supplies a test token and trusts the local runtime's own
/// certificate, so it can reach a Worker that it starts on this Mac.
pub async fn open_relay<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: &CloudState,
    url: &str,
    vm_id: &str,
    channel: Option<&str>,
    token: &str,
    connector: Option<Connector>,
) -> CommandResult<String> {
    let base = checked_worker_url(url)?;
    let channel = channel.unwrap_or("rpc");
    let relay = relay_url(&base, vm_id, channel)?;
    let mut request = relay.as_str().into_client_request().map_err(|error| {
        refused(
            "cloud_relay_failed",
            format!("The relay URL is not valid: {error}"),
        )
    })?;
    request
        .headers_mut()
        .insert(reqwest::header::AUTHORIZATION, bearer(token)?);
    let (stream, _answer) =
        tokio_tungstenite::connect_async_tls_with_config(request, None, false, connector)
            .await
            .map_err(|error| {
                refused(
                    "cloud_relay_failed",
                    format!("The relay could not connect: {error}"),
                )
            })?;
    let (mut writer, mut reader) = stream.split();
    let id = state.next_id();
    let (outgoing, mut lines) = mpsc::unbounded_channel::<String>();
    let task_id = id.clone();
    let app_for_task = app.clone();
    let reader_task = tauri::async_runtime::spawn(async move {
        let reason = loop {
            tokio::select! {
                line = lines.recv() => match line {
                    Some(text) => {
                        // The sidecar's wire format is NDJSON: the transport adds the newline, as
                        // the local sidecar relay does.
                        let framed = format!("{text}\n");
                        if writer.send(Message::Text(framed.into())).await.is_err() {
                            break String::from("The relay could not send.");
                        }
                    }
                    None => {
                        let _ = writer.close().await;
                        break String::from("The relay was closed.");
                    }
                },
                message = reader.next() => match message {
                    Some(Ok(Message::Text(text))) => {
                        let _ = app_for_task.emit(EVENT_LINE, RelayLine { relay_id: task_id.clone(), line: text.to_string() });
                    }
                    Some(Ok(Message::Binary(bytes))) => {
                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                            let _ = app_for_task.emit(EVENT_LINE, RelayLine { relay_id: task_id.clone(), line: text });
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        let _ = writer.send(Message::Pong(payload)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break String::from("The Worker closed the relay.");
                    }
                    Some(Err(error)) => {
                        break format!("The relay failed: {error}");
                    }
                    _ => {}
                },
            }
        };
        let _ = app_for_task.emit(
            EVENT_CLOSED,
            RelayClosed {
                relay_id: task_id,
                reason,
            },
        );
    });
    lock(&state.relays).insert(
        id.clone(),
        Relay {
            outgoing,
            reader: reader_task,
        },
    );
    Ok(id)
}

/// Sends one sidecar line over a relay. A newline is refused: the sidecar's wire format is one
/// JSON-RPC message per line and the transport adds the newline itself.
#[tauri::command]
pub async fn cloud_relay_send(
    state: State<'_, CloudState>,
    relay_id: String,
    line: String,
) -> CommandResult<()> {
    if line.contains('\n') || line.contains('\r') {
        return Err(refused(
            "cloud_bad_line",
            "A relay line cannot hold a newline.",
        ));
    }
    let sent = {
        let relays = lock(&state.relays);
        relays
            .get(&relay_id)
            .map(|relay| relay.outgoing.send(line).is_ok())
    };
    match sent {
        Some(true) => Ok(()),
        Some(false) => Err(refused(
            "cloud_relay_closed",
            "The relay to the cloud Workspace is closed.",
        )),
        None => Err(refused("cloud_relay_unknown", "That relay is not open.")),
    }
}

/// Closes a relay. A relay that is already gone succeeds.
#[tauri::command]
pub async fn cloud_relay_close(
    state: State<'_, CloudState>,
    relay_id: String,
) -> CommandResult<()> {
    let relay = lock(&state.relays).remove(&relay_id);
    if let Some(relay) = relay {
        drop(relay.outgoing);
        relay.reader.abort();
    }
    Ok(())
}

/// Stops every relay. Called when the app quits, so no reader outlives the window.
pub fn close_all(state: &CloudState) {
    let relays = std::mem::take(&mut *lock(&state.relays));
    for (_, relay) in relays {
        drop(relay.outgoing);
        relay.reader.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_worker_url_must_be_https_without_credentials() {
        assert!(checked_worker_url("https://conducted.example.workers.dev").is_ok());
        assert!(checked_worker_url("http://conducted.example.workers.dev").is_err());
        assert!(checked_worker_url("https://user:pass@conducted.example.workers.dev").is_err());
        assert!(checked_worker_url("https://conducted.example.workers.dev?x=1").is_err());
        assert!(checked_worker_url("not a url").is_err());
    }

    #[test]
    fn a_route_path_stays_on_the_worker() {
        let base = checked_worker_url("https://conducted.example.workers.dev").expect("a good URL");
        assert_eq!(
            route_url(&base, "/w/oslo/git")
                .expect("a good path")
                .as_str(),
            "https://conducted.example.workers.dev/w/oslo/git"
        );
        assert!(route_url(&base, "w/oslo/git").is_err());
        assert!(route_url(&base, "//evil.example/git").is_err());
        assert!(route_url(&base, "/w/../git").is_err());
        assert!(route_url(&base, "/w/oslo/git\n").is_err());
    }

    #[test]
    fn a_relay_url_is_secure_and_names_a_workspace() {
        let base = checked_worker_url("https://conducted.example.workers.dev").expect("a good URL");
        assert_eq!(
            relay_url(&base, "oslo-1", "rpc")
                .expect("a good workspace")
                .as_str(),
            "wss://conducted.example.workers.dev/w/oslo-1/rpc"
        );
        assert_eq!(
            relay_url(&base, "oslo-1", "terminal")
                .expect("a good workspace")
                .as_str(),
            "wss://conducted.example.workers.dev/w/oslo-1/terminal"
        );
        assert!(relay_url(&base, "Oslo", "rpc").is_err());
        assert!(relay_url(&base, "", "rpc").is_err());
        assert!(relay_url(&base, "-oslo", "rpc").is_err());
        assert!(relay_url(&base, "oslo-1", "colour").is_err());
    }

    #[test]
    fn an_ssh_url_is_secure_and_names_the_ssh_route() {
        let base = checked_worker_url("https://conducted.example.workers.dev").expect("a good URL");
        assert_eq!(
            ssh_tunnel_url(&base, "oslo-1")
                .expect("a good workspace")
                .as_str(),
            "wss://conducted.example.workers.dev/w/oslo-1/ssh"
        );
        assert!(ssh_tunnel_url(&base, "Oslo").is_err());
        assert!(ssh_tunnel_url(&base, "").is_err());
    }

    #[test]
    fn a_relay_line_cannot_hold_a_newline() {
        // The check lives in the command, so its rule is stated here for the reader of the code:
        // the command refuses `\n` and `\r`, which is what keeps one message on one line.
        let line = "{\"jsonrpc\":\"2.0\"}\n{\"jsonrpc\":\"2.0\"}";
        assert!(line.contains('\n'));
    }

    #[test]
    fn pairing_needs_a_non_empty_token_and_reports_its_worker() {
        let url = Some("https://conducted.example.workers.dev".to_string());
        assert_eq!(
            pairing_from(Some("token".to_string()), url.clone()),
            CloudPairingPayload {
                paired: true,
                url: url.clone(),
            }
        );
        assert_eq!(
            pairing_from(None, url.clone()),
            CloudPairingPayload {
                paired: false,
                url: None,
            }
        );
        assert_eq!(
            pairing_from(Some(String::new()), url),
            CloudPairingPayload {
                paired: false,
                url: None,
            }
        );
    }

    /// A server on this Mac that answers one request, checking the path and token it received.
    /// The answer is the status line after `HTTP/1.1` and the body.
    fn serve_once(
        status: &'static str,
        body: &'static str,
        expected_token: Option<&'static str>,
    ) -> (String, std::thread::JoinHandle<()>) {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("a free port");
        let port = listener.local_addr().expect("the bound address").port();
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("one connection");
            let mut reader = BufReader::new(stream.try_clone().expect("the stream"));
            let mut request_line = String::new();
            reader
                .read_line(&mut request_line)
                .expect("the request line");
            let mut authorization = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("a header");
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if line.to_ascii_lowercase().starts_with("authorization:") {
                    authorization = line;
                }
            }
            assert!(request_line.starts_with("GET /pair "), "{request_line}");
            if let Some(token) = expected_token {
                assert_eq!(
                    authorization.trim().to_ascii_lowercase(),
                    format!("authorization: bearer {token}")
                );
            }
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            stream.write_all(response.as_bytes()).expect("the answer");
        });
        (format!("http://127.0.0.1:{port}"), handle)
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .expect("a client")
    }

    #[test]
    fn a_deploy_url_is_read_from_wranglers_output() {
        let stdout = "Total Upload: 1 KiB\nUploaded conducted-cloud (1 sec)\n\
            Deployed conducted-cloud triggers (2 sec)\n  \
            https://conducted-cloud.example.workers.dev\nCurrent Version ID: abc\n";
        assert_eq!(
            deployed_url(stdout),
            Some(String::from("https://conducted-cloud.example.workers.dev"))
        );
        assert_eq!(deployed_url("no URL here"), None);
    }

    #[test]
    fn bucket_names_are_read_from_the_table() {
        let listing = " ⛅️ wrangler\nListing buckets...\nname:           conducted-cloud-backups\n\
            name:           other\n";
        assert_eq!(
            bucket_names(listing),
            vec![
                String::from("conducted-cloud-backups"),
                String::from("other")
            ]
        );
    }

    #[test]
    fn a_container_and_its_images_are_read_from_wranglers_json() {
        let containers = r#"[{"id":"abc","name":"conducted-cloud-sandbox"}]"#;
        assert_eq!(
            container_id(containers, "conducted-cloud-sandbox"),
            Some(String::from("abc"))
        );
        assert_eq!(container_id(containers, "other"), None);
        let images = r#"[{"name":"conducted-cloud-workspace-sandbox","tags":["wrangler-a","latest"]},
            {"name":"another","tags":["x"]}]"#;
        assert_eq!(
            image_refs(images, "conducted-cloud"),
            vec![
                String::from("conducted-cloud-workspace-sandbox:wrangler-a"),
                String::from("conducted-cloud-workspace-sandbox:latest")
            ]
        );
    }

    #[test]
    fn a_pairing_token_is_url_safe_and_long_enough() {
        let token = make_pairing_token().expect("a token");
        assert_eq!(token.len(), 43);
        assert!(
            token
                .chars()
                .all(|character| character.is_ascii_alphanumeric()
                    || character == '-'
                    || character == '_')
        );
        assert_ne!(token, make_pairing_token().expect("another token"));
    }

    #[test]
    fn a_resource_name_cloudflare_would_refuse_is_refused() {
        assert!(checked_resource_name("x", "Worker", "conducted-cloud").is_ok());
        assert!(checked_resource_name("x", "Worker", "Conducted-Cloud").is_err());
        assert!(checked_resource_name("x", "Worker", "-conducted").is_err());
        assert!(checked_resource_name("x", "Worker", "conducted-").is_err());
        assert!(checked_resource_name("x", "Worker", "a").is_err());
    }

    /// A folder this test owns, removed when the test ends.
    struct TestFolder(PathBuf);

    impl TestFolder {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "conducted-deploy-test-{}",
                super::unique_temp_part()
            ));
            std::fs::create_dir_all(&path).expect("a temp folder");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestFolder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// A stand-in `wrangler` in a folder the test owns, with the record path baked in.
    fn fake_wrangler(script: &str) -> (TestFolder, Wrangler, PathBuf) {
        let folder = TestFolder::new();
        let record = folder.path().join("calls.txt");
        let program = folder.path().join("wrangler");
        let body = script.replace("RECORD", &record.to_string_lossy());
        std::fs::write(&program, body).expect("the stand-in");
        use std::os::unix::fs::PermissionsExt as _;
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755))
            .expect("an executable");
        let wrangler = Wrangler {
            program: program.to_string_lossy().into_owned(),
        };
        (folder, wrangler, record)
    }

    /// The deploy inputs as `scripts/cloud/prepare-deploy.ts` leaves them.
    fn resources_folder(folder: &TestFolder) -> PathBuf {
        let resources = folder.path().join("cloud");
        std::fs::create_dir_all(resources.join("sandbox")).expect("the sandbox folder");
        std::fs::write(
            resources.join(DEPLOY_FACT_FILE),
            serde_json::json!({
                "name": "conducted-cloud",
                "compatibilityDate": "2026-11-06",
                "compatibilityFlags": ["nodejs_compat"],
                "instance": "basic",
                "className": "Workspace",
                "imageKey": "sandbox",
                "objectBinding": "WORKSPACE",
                "backupBinding": "BACKUPS"
            })
            .to_string(),
        )
        .expect("the fact file");
        std::fs::write(resources.join(DEPLOY_WORKER_FILE), "export default {}")
            .expect("the bundle");
        std::fs::write(resources.join(DEPLOY_DOCKERFILE), "FROM scratch").expect("the Dockerfile");
        resources
    }

    #[test]
    fn a_deploy_uses_the_bundled_inputs_and_its_own_names() {
        let (folder, wrangler, record) = fake_wrangler(
            "#!/bin/sh\n\
             case \"$1\" in\n\
             --version) echo \"4.158.0\"; exit 0 ;;\n\
             r2) if [ \"$3\" = \"list\" ]; then echo \"name:           other\"; exit 0; fi\n\
                 if [ \"$3\" = \"create\" ]; then echo \"bucket $4\" >> RECORD; exit 0; fi\n\
                 exit 1 ;;\n\
             deploy) cfg=\"\"; sec=\"\"; prev=\"\"\n\
                 for a in \"$@\"; do\n\
                   [ \"$prev\" = \"--config\" ] && cfg=\"$a\"\n\
                   [ \"$prev\" = \"--secrets-file\" ] && sec=\"$a\"\n\
                   prev=\"$a\"\n\
                 done\n\
                 echo \"deploy\" >> RECORD; cat \"$cfg\" >> RECORD; cat \"$sec\" >> RECORD\n\
                 echo \"  https://conducted-dev-c08-test.example.workers.dev\"; exit 0 ;;\n\
             esac\n\
             exit 1\n",
        );
        let resources = resources_folder(&folder);
        // The deploy's own temp root, so another test's deploy running alongside is never counted.
        let temp = TestFolder::new();
        let url = deploy_worker_with(
            &wrangler,
            &resources,
            "conducted-dev-c08-test",
            "the-token",
            temp.path(),
            || Ok(()),
            &|_step| {},
        )
        .expect("a deploy");
        assert_eq!(url, "https://conducted-dev-c08-test.example.workers.dev");
        let calls = std::fs::read_to_string(&record).expect("the record");
        assert!(calls.contains("bucket conducted-dev-c08-test"));
        assert!(calls.contains("\"name\":\"conducted-dev-c08-test\""));
        assert!(calls.contains("\"bucket_name\":\"conducted-dev-c08-test\""));
        assert!(calls.contains("\"name\":\"conducted-dev-c08-test-sandbox\""));
        // The worker and Dockerfile are the app's own bundled files, by absolute path.
        assert!(
            calls.contains(
                &resources
                    .join(DEPLOY_WORKER_FILE)
                    .to_string_lossy()
                    .into_owned()
            )
        );
        assert!(
            calls.contains(
                &resources
                    .join(DEPLOY_DOCKERFILE)
                    .to_string_lossy()
                    .into_owned()
            )
        );
        // The token reaches the deploy's secret file and nothing else.
        assert!(calls.contains("\"PAIRING_TOKEN\":\"the-token\""));
        // The temp folder and the secret file are gone when the deploy returns.
        let leftovers = std::fs::read_dir(temp.path())
            .expect("the temp folder")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("conducted-deploy-")
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn a_deploy_reports_the_steps_it_is_on() {
        let (folder, wrangler, _record) = fake_wrangler(
            "#!/bin/sh\n\
             case \"$1\" in\n\
             --version) echo \"4.158.0\"; exit 0 ;;\n\
             r2) exit 0 ;;\n\
             deploy) echo \"  https://conducted-dev-c08-steps.example.workers.dev\"; exit 0 ;;\n\
             esac\n\
             exit 1\n",
        );
        let resources = resources_folder(&folder);
        let steps = std::cell::RefCell::new(Vec::new());
        let progress = |step: &str| steps.borrow_mut().push(step.to_string());
        let temp = TestFolder::new();
        deploy_worker_with(
            &wrangler,
            &resources,
            "conducted-dev-c08-steps",
            "the-token",
            temp.path(),
            || Ok(()),
            &progress,
        )
        .expect("a deploy");
        // The shell names each step it takes; wrangler's image build and upload are one step
        // because one `wrangler deploy` call does both (issue #490).
        assert_eq!(
            steps.into_inner(),
            vec![
                String::from("Checking Docker"),
                String::from("Creating the bucket"),
                String::from("Building the image and uploading the Worker"),
            ]
        );
    }

    /// A stand-in `wrangler` for the uninstall: it records each call, lists one container and one
    /// image, and gives its login as `wrangler auth token --json` prints it, after a warning line.
    /// The login is the one in `RECORD.login` when that file exists, as wrangler gives the token it
    /// last stored, and `the-login` otherwise.
    const UNINSTALL_WRANGLER: &str = "#!/bin/sh\n\
         echo \"$*\" >> RECORD\n\
         if [ \"$1\" = \"containers\" ] && [ \"$2\" = \"list\" ]; then\n\
           echo '[{\"id\":\"abc\",\"name\":\"conducted-cloud-sandbox\"}]'; exit 0; fi\n\
         if [ \"$1\" = \"containers\" ] && [ \"$2\" = \"images\" ] && [ \"$3\" = \"list\" ]; then\n\
           echo '[{\"name\":\"conducted-cloud-workspace-sandbox\",\"tags\":[\"wrangler-a\"]}]'; exit 0; fi\n\
         if [ \"$1\" = \"auth\" ] && [ \"$2\" = \"token\" ]; then\n\
           login=the-login; [ -f 'RECORD.login' ] && login=$(cat 'RECORD.login')\n\
           echo 'A newer version of wrangler is available.'\n\
           printf '{\\n    \"type\": \"oauth\",\\n    \"token\": \"%s\"\\n}\\n' \"$login\"; exit 0; fi\n\
         exit 0\n";

    /// What the stand-in Cloudflare holds: accounts, their buckets and the keys in each, and every
    /// request it was sent.
    #[derive(Default)]
    struct StandInState {
        accounts: Vec<String>,
        buckets: std::collections::BTreeMap<(String, String), std::collections::BTreeSet<String>>,
        requests: Vec<String>,
        /// A key another writer deletes just after a listing first returns it.
        vanishes: Option<String>,
        /// The login Cloudflare accepts now. None is `the-login`.
        accepted: Option<String>,
        /// How many requests carried a login Cloudflare did not accept.
        refused: usize,
        /// The login expires once this many requests were answered.
        expiry: Option<LoginExpiry>,
    }

    /// An OAuth login that expires partway through an uninstall, as wrangler's one-hour token does
    /// (issue #675). From then on Cloudflare answers the old token with 401, code 10000.
    struct LoginExpiry {
        after_requests: usize,
        /// The token that replaces it.
        next: String,
        /// Where wrangler stores the refreshed token, so `wrangler auth token` hands it out. None is
        /// a login wrangler cannot refresh, which it keeps handing out.
        stored: Option<PathBuf>,
    }

    /// A stand-in for Cloudflare's API on this Mac. It answers the calls the uninstall makes as
    /// Cloudflare's API reference documents them (list accounts, get a bucket, list a bucket's
    /// objects with `per_page` up to 1000 and a cursor, delete an object, delete a bucket), and,
    /// as the CLOUD-17 live run saw, refuses to delete a bucket that holds anything with code
    /// 10008. A request without the login wrangler gave is answered 401.
    struct CloudflareStandIn {
        base: String,
        port: u16,
        state: std::sync::Arc<Mutex<StandInState>>,
        stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
        server: Option<std::thread::JoinHandle<()>>,
    }

    fn percent_decode(text: &str, plus_is_space: bool) -> String {
        let bytes = text.as_bytes();
        let mut out = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            match bytes[index] {
                b'%' if index + 2 < bytes.len() => {
                    let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("");
                    out.push(u8::from_str_radix(hex, 16).expect("a percent escape"));
                    index += 3;
                }
                b'+' if plus_is_space => {
                    out.push(b' ');
                    index += 1;
                }
                byte => {
                    out.push(byte);
                    index += 1;
                }
            }
        }
        String::from_utf8(out).expect("UTF-8")
    }

    impl CloudflareStandIn {
        fn start(accounts: &[&str], buckets: &[(&str, &str, Vec<String>)]) -> Self {
            use std::net::TcpListener;
            let mut state = StandInState {
                accounts: accounts.iter().map(|id| id.to_string()).collect(),
                ..StandInState::default()
            };
            for (account, bucket, keys) in buckets {
                state.buckets.insert(
                    (account.to_string(), bucket.to_string()),
                    keys.iter().cloned().collect(),
                );
            }
            let state = std::sync::Arc::new(Mutex::new(state));
            let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
            let listener = TcpListener::bind("127.0.0.1:0").expect("a free port");
            let port = listener.local_addr().expect("the bound address").port();
            let server_state = state.clone();
            let server_stop = stop.clone();
            let server = std::thread::spawn(move || {
                for stream in listener.incoming() {
                    if server_stop.load(Ordering::SeqCst) {
                        break;
                    }
                    if let Ok(stream) = stream {
                        Self::answer(stream, &server_state);
                    }
                }
            });
            Self {
                base: format!("http://127.0.0.1:{port}/client/v4"),
                port,
                state,
                stop,
                server: Some(server),
            }
        }

        fn answer(stream: std::net::TcpStream, state: &Mutex<StandInState>) {
            use std::io::{BufRead, BufReader, Write};
            let mut reader = BufReader::new(stream.try_clone().expect("the stream"));
            let mut request_line = String::new();
            if reader.read_line(&mut request_line).is_err() || request_line.is_empty() {
                return;
            }
            let mut authorization = String::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() || line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("authorization:") {
                    authorization = value.trim().to_string();
                }
            }
            let mut parts = request_line.split_whitespace();
            let method = parts.next().unwrap_or("").to_string();
            let target = parts.next().unwrap_or("").to_string();
            let (status, body) = {
                let mut state = lock(state);
                if state
                    .expiry
                    .as_ref()
                    .is_some_and(|expiry| state.requests.len() >= expiry.after_requests)
                    && let Some(expiry) = state.expiry.take()
                {
                    if let Some(stored) = &expiry.stored {
                        std::fs::write(stored, &expiry.next).expect("the refreshed login");
                    }
                    state.accepted = Some(expiry.next);
                }
                let accepted = state.accepted.as_deref().unwrap_or("the-login");
                if authorization != format!("bearer {accepted}") {
                    state.refused += 1;
                    // As Cloudflare answered an expired wrangler token on 2026-11-13: the account
                    // list with 403 and code 9109, the R2 routes with 401 and code 10000.
                    if target.starts_with("/client/v4/accounts?") {
                        (403, Self::failed(9109, "Invalid access token"))
                    } else {
                        (401, Self::failed(10000, "Authentication error"))
                    }
                } else {
                    state.requests.push(format!("{method} {target}"));
                    Self::route(&mut state, &method, &target)
                }
            };
            let text = body.to_string();
            let response = format!(
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{text}",
                text.len()
            );
            let mut stream = stream;
            let _ = stream.write_all(response.as_bytes());
        }

        fn failed(code: i64, message: &str) -> serde_json::Value {
            serde_json::json!({
                "success": false,
                "errors": [{ "code": code, "message": message }],
                "messages": [],
                "result": null
            })
        }

        fn route(state: &mut StandInState, method: &str, target: &str) -> (u16, serde_json::Value) {
            let (path, query) = target.split_once('?').unwrap_or((target, ""));
            let query: HashMap<String, String> = query
                .split('&')
                .filter_map(|pair| pair.split_once('='))
                .map(|(name, value)| (name.to_string(), percent_decode(value, true)))
                .collect();
            let Some(path) = path.strip_prefix("/client/v4/accounts") else {
                return (404, Self::failed(7000, "No route for that URI"));
            };
            if path.is_empty() && method == "GET" {
                let accounts: Vec<serde_json::Value> = state
                    .accounts
                    .iter()
                    .map(|id| serde_json::json!({ "id": id, "name": "Account" }))
                    .collect();
                let count = accounts.len();
                return (
                    200,
                    serde_json::json!({
                        "success": true, "errors": [], "messages": [], "result": accounts,
                        "result_info": { "page": 1, "per_page": 50, "count": count, "total_count": count, "total_pages": 1 }
                    }),
                );
            }
            let rest = path.trim_start_matches('/');
            let mut segments = rest.splitn(6, '/');
            let account = segments.next().unwrap_or("").to_string();
            let r2 = segments.next().unwrap_or("");
            let buckets = segments.next().unwrap_or("");
            let bucket = segments.next().unwrap_or("").to_string();
            let objects = segments.next();
            let key = segments.next().map(|raw| percent_decode(raw, false));
            if r2 != "r2" || buckets != "buckets" || !state.accounts.contains(&account) {
                return (404, Self::failed(7003, "Could not route to that account"));
            }
            let id = (account, bucket);
            if !state.buckets.contains_key(&id) {
                return (
                    404,
                    Self::failed(10006, "The specified bucket does not exist."),
                );
            }
            match (method, objects, key) {
                ("GET", None, None) => (
                    200,
                    serde_json::json!({ "success": true, "errors": [], "messages": [], "result": { "name": id.1 } }),
                ),
                ("DELETE", None, None) => {
                    if state.buckets[&id].is_empty() {
                        state.buckets.remove(&id);
                        (
                            200,
                            serde_json::json!({ "success": true, "errors": [], "messages": [], "result": {} }),
                        )
                    } else {
                        (
                            409,
                            Self::failed(10008, "The bucket you tried to delete is not empty."),
                        )
                    }
                }
                ("GET", Some("objects"), None) => {
                    let per_page = query
                        .get("per_page")
                        .and_then(|value| value.parse::<usize>().ok())
                        .unwrap_or(1000)
                        .clamp(1, 1000);
                    let keys = &state.buckets[&id];
                    let after = query.get("cursor").cloned();
                    let page: Vec<String> = keys
                        .iter()
                        .filter(|key| after.as_ref().is_none_or(|after| *key > after))
                        .take(per_page + 1)
                        .cloned()
                        .collect();
                    let truncated = page.len() > per_page;
                    let page: Vec<String> = page.into_iter().take(per_page).collect();
                    let cursor = page.last().cloned().unwrap_or_default();
                    if let Some(gone) = state.vanishes.clone()
                        && page.contains(&gone)
                    {
                        state.buckets.get_mut(&id).map(|keys| keys.remove(&gone));
                        state.vanishes = None;
                    }
                    let result: Vec<serde_json::Value> = page
                        .iter()
                        .map(|key| serde_json::json!({ "key": key, "size": 1 }))
                        .collect();
                    (
                        200,
                        serde_json::json!({
                            "success": true, "errors": [], "messages": [], "result": result,
                            "result_info": { "cursor": cursor, "is_truncated": truncated, "per_page": per_page }
                        }),
                    )
                }
                ("DELETE", Some("objects"), Some(key)) => {
                    let keys = state.buckets.get_mut(&id).expect("the bucket");
                    if keys.remove(&key) {
                        (
                            200,
                            serde_json::json!({ "success": true, "errors": [], "messages": [], "result": {} }),
                        )
                    } else {
                        (
                            404,
                            Self::failed(10007, "The specified key does not exist."),
                        )
                    }
                }
                _ => (405, Self::failed(10000, "Method not allowed")),
            }
        }

        fn api(&self, account: Option<&str>) -> CloudflareApi {
            CloudflareApi {
                base: self.base.clone(),
                account: account.map(str::to_string),
            }
        }

        fn keys(&self, account: &str, bucket: &str) -> Option<usize> {
            lock(&self.state)
                .buckets
                .get(&(account.to_string(), bucket.to_string()))
                .map(|keys| keys.len())
        }

        fn requests(&self) -> Vec<String> {
            lock(&self.state).requests.clone()
        }
    }

    impl Drop for CloudflareStandIn {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            // Wakes the accept loop so it sees the stop and ends.
            let _ = std::net::TcpStream::connect(("127.0.0.1", self.port));
            if let Some(server) = self.server.take() {
                let _ = server.join();
            }
        }
    }

    /// 1,207 objects named as the Worker names them (docs/data-model.md): more than one page of
    /// backups, one key that needs escaping, and the settings object.
    fn filled_bucket() -> Vec<String> {
        let mut keys: Vec<String> = (0..1205)
            .map(|index| {
                format!("workspace-backups/{index:08}-0000-4000-8000-000000000000.tar.zst")
            })
            .collect();
        keys.push(String::from("workspace-backups/a name+plus%.tar.zst"));
        keys.push(String::from("settings/user.json"));
        keys
    }

    #[test]
    fn an_uninstall_empties_the_bucket_and_deletes_it() {
        let (folder, wrangler, record) = fake_wrangler(UNINSTALL_WRANGLER);
        let resources = resources_folder(&folder);
        let cloudflare = CloudflareStandIn::start(
            &["acc1"],
            &[
                ("acc1", "conducted-cloud", filled_bucket()),
                (
                    "acc1",
                    "conducted-cloud-old",
                    vec![String::from("keep.json")],
                ),
                ("acc1", "other", vec![String::from("settings/user.json")]),
            ],
        );
        // Another writer deletes one backup between the listing and the uninstall's delete.
        lock(&cloudflare.state).vanishes = Some(String::from(
            "workspace-backups/00000003-0000-4000-8000-000000000000.tar.zst",
        ));
        let removed = uninstall_worker(
            &wrangler,
            &cloudflare.api(None),
            &resources,
            "conducted-cloud",
        )
        .expect("an uninstall");
        assert_eq!(
            removed,
            CloudUninstallPayload {
                worker: true,
                container: true,
                images: 1,
                bucket: true,
                objects: 1206,
            }
        );
        assert_eq!(cloudflare.keys("acc1", "conducted-cloud"), None);
        // Buckets with another name, even one that starts with the Worker's name, keep everything.
        assert_eq!(cloudflare.keys("acc1", "conducted-cloud-old"), Some(1));
        assert_eq!(cloudflare.keys("acc1", "other"), Some(1));
        let requests = cloudflare.requests();
        assert!(
            requests.iter().all(|request| {
                request.starts_with("GET /client/v4/accounts?")
                    || request.contains("/accounts/acc1/r2/buckets/conducted-cloud/")
                    || request.ends_with("/accounts/acc1/r2/buckets/conducted-cloud")
            }),
            "{requests:?}"
        );
        let listings = requests
            .iter()
            .filter(|request| {
                request
                    .starts_with("GET /client/v4/accounts/acc1/r2/buckets/conducted-cloud/objects?")
            })
            .count();
        assert!(listings >= 2, "{listings} listings");
        assert!(requests.contains(&String::from(
            "DELETE /client/v4/accounts/acc1/r2/buckets/conducted-cloud/objects/workspace-backups/a%20name%2Bplus%25.tar.zst"
        )));
        let calls = std::fs::read_to_string(&record).expect("the record");
        let lines: Vec<&str> = calls.lines().collect();
        assert_eq!(lines[0], "delete --name conducted-cloud --force");
        assert!(lines.contains(&"containers delete abc"));
        assert!(
            lines.contains(
                &"containers images delete conducted-cloud-workspace-sandbox:wrangler-a -y"
            )
        );
        // The bucket goes through the API only; wrangler is never asked to delete it.
        assert!(!calls.contains("r2 bucket delete"));
    }

    /// How many times the uninstall asked wrangler for its login.
    fn login_reads(record: &Path) -> usize {
        std::fs::read_to_string(record)
            .expect("the record")
            .lines()
            .filter(|line| *line == "auth token --json")
            .count()
    }

    #[test]
    fn a_login_that_expires_while_the_bucket_empties_is_read_again() {
        // The token wrangler handed out expires before the account list (answered 403, code
        // 9109), or after the first object listing, between two object deletes (401, code 10000).
        // Either way wrangler stores the refreshed one.
        for after_requests in [0, 600] {
            let (folder, wrangler, record) = fake_wrangler(UNINSTALL_WRANGLER);
            let resources = resources_folder(&folder);
            let cloudflare = CloudflareStandIn::start(
                &["acc1"],
                &[("acc1", "conducted-cloud", filled_bucket())],
            );
            lock(&cloudflare.state).expiry = Some(LoginExpiry {
                after_requests,
                next: String::from("the-refreshed-login"),
                stored: Some(PathBuf::from(format!("{}.login", record.display()))),
            });
            let removed = uninstall_worker(
                &wrangler,
                &cloudflare.api(None),
                &resources,
                "conducted-cloud",
            )
            .unwrap_or_else(|error| panic!("an uninstall expiring at {after_requests}: {error}"));
            assert_eq!((removed.bucket, removed.objects), (true, 1207));
            assert_eq!(cloudflare.keys("acc1", "conducted-cloud"), None);
            // One call met the expired token; the login was read again once and the call repeated.
            assert_eq!(lock(&cloudflare.state).refused, 1);
            assert_eq!(login_reads(&record), 2);
        }
    }

    #[test]
    fn a_login_cloudflare_still_refuses_is_reported_with_what_is_left() {
        let (folder, wrangler, record) = fake_wrangler(UNINSTALL_WRANGLER);
        let resources = resources_folder(&folder);
        let cloudflare =
            CloudflareStandIn::start(&["acc1"], &[("acc1", "conducted-cloud", filled_bucket())]);
        // The token stops working and wrangler cannot refresh it, so it hands out the same one.
        lock(&cloudflare.state).expiry = Some(LoginExpiry {
            after_requests: 600,
            next: String::from("a-login-this-mac-lacks"),
            stored: None,
        });
        let error = uninstall_worker(
            &wrangler,
            &cloudflare.api(None),
            &resources,
            "conducted-cloud",
        )
        .expect_err("a refused login");
        assert_eq!(error.code(), "cloud_login_refused");
        let message = error.to_string();
        assert!(message.contains("HTTP 401"), "{message}");
        assert!(message.contains("code 10000"), "{message}");
        // It says what is gone, what is left, and how to remove the rest.
        assert!(
            message.starts_with(
                "The Worker, the container application and 1 image are deleted, but the bucket conducted-cloud is still on your account. Cloudflare refused your login to delete the object"
            ),
            "{message}"
        );
        assert!(
            message.ends_with("Run `wrangler login` and remove the deployment again."),
            "{message}"
        );
        assert!(cloudflare.keys("acc1", "conducted-cloud").is_some());
        // The login was read again once, and the same login was never sent again.
        assert_eq!(login_reads(&record), 2);
        assert_eq!(lock(&cloudflare.state).refused, 1);
    }

    #[test]
    fn a_failure_at_the_bucket_says_what_is_deleted_and_what_is_left() {
        let said = |removed: CloudUninstallPayload| {
            bucket_left(
                refused("cloud_api_failed", "Cloudflare refused."),
                &removed,
                "b",
            )
            .to_string()
        };
        assert_eq!(
            said(CloudUninstallPayload::default()),
            "The bucket b is still on your account. Cloudflare refused."
        );
        assert_eq!(
            said(CloudUninstallPayload {
                images: 2,
                ..CloudUninstallPayload::default()
            }),
            "2 images are deleted, but the bucket b is still on your account. Cloudflare refused."
        );
        assert_eq!(
            said(CloudUninstallPayload {
                worker: true,
                container: true,
                ..CloudUninstallPayload::default()
            }),
            "The Worker and the container application are deleted, but the bucket b is still on your account. Cloudflare refused."
        );
    }

    #[test]
    fn a_second_uninstall_finds_no_bucket_and_succeeds() {
        let (folder, wrangler, _record) = fake_wrangler(UNINSTALL_WRANGLER);
        let resources = resources_folder(&folder);
        let cloudflare = CloudflareStandIn::start(
            &["acc1"],
            &[("acc1", "other", vec![String::from("keep.json")])],
        );
        let removed = uninstall_worker(
            &wrangler,
            &cloudflare.api(None),
            &resources,
            "conducted-cloud",
        )
        .expect("an uninstall");
        assert!(!removed.bucket);
        assert_eq!(removed.objects, 0);
        assert_eq!(cloudflare.keys("acc1", "other"), Some(1));
        assert!(
            !cloudflare
                .requests()
                .iter()
                .any(|request| request.starts_with("DELETE"))
        );
    }

    #[test]
    fn a_bucket_name_two_accounts_hold_is_refused_unless_the_account_is_named() {
        let (folder, wrangler, _record) = fake_wrangler(UNINSTALL_WRANGLER);
        let resources = resources_folder(&folder);
        let cloudflare = CloudflareStandIn::start(
            &["acc1", "acc2"],
            &[
                (
                    "acc1",
                    "conducted-cloud",
                    vec![String::from("settings/user.json")],
                ),
                (
                    "acc2",
                    "conducted-cloud",
                    vec![String::from("settings/user.json")],
                ),
            ],
        );
        let error = uninstall_worker(
            &wrangler,
            &cloudflare.api(None),
            &resources,
            "conducted-cloud",
        )
        .expect_err("an unclear account");
        assert_eq!(error.code(), "cloud_bucket_account_unclear");
        assert!(
            !cloudflare
                .requests()
                .iter()
                .any(|request| request.starts_with("DELETE"))
        );
        let removed = uninstall_worker(
            &wrangler,
            &cloudflare.api(Some("acc2")),
            &resources,
            "conducted-cloud",
        )
        .expect("an uninstall of the named account");
        assert_eq!((removed.bucket, removed.objects), (true, 1));
        assert_eq!(cloudflare.keys("acc1", "conducted-cloud"), Some(1));
        assert_eq!(cloudflare.keys("acc2", "conducted-cloud"), None);
    }

    #[test]
    fn wranglers_login_is_read_and_an_object_key_becomes_a_path() {
        let login =
            parse_login("A warning\n{\n    \"type\": \"oauth\",\n    \"token\": \"abc\"\n}\n");
        assert!(matches!(login, Some(ApiLogin::Token(token)) if token == "abc"));
        let key = parse_login("{\"type\":\"api_key\",\"key\":\"k\",\"email\":\"e\"}");
        assert!(matches!(key, Some(ApiLogin::Key { email, key }) if email == "e" && key == "k"));
        assert!(parse_login("Not logged in").is_none());
        assert!(parse_login("{\"type\":\"oauth\",\"token\":\"\"}").is_none());
        assert_eq!(
            object_path("backups/a b+c%/x.json").as_deref(),
            Some("backups/a%20b%2Bc%25/x.json")
        );
        assert_eq!(object_path("a/../settings/user.json"), None);
        assert_eq!(object_path("./x"), None);
        assert!(checked_account_id("acc/../x").is_err());
    }

    #[test]
    fn the_deploy_config_names_the_derived_resources() {
        let folder = TestFolder::new();
        let resources = resources_folder(&folder);
        let facts = read_deploy_facts(&resources).expect("the facts");
        let config = deploy_config(&facts, &resources, "conducted-dev-c08-x");
        assert_eq!(config["name"], "conducted-dev-c08-x");
        assert_eq!(
            config["containers"][0]["name"],
            "conducted-dev-c08-x-sandbox"
        );
        assert_eq!(
            config["containers"][0]["images"]["sandbox"]["dockerfile"],
            resources
                .join(DEPLOY_DOCKERFILE)
                .to_string_lossy()
                .into_owned()
        );
        assert_eq!(
            config["durable_objects"]["bindings"][0]["name"],
            "WORKSPACE"
        );
        assert_eq!(
            config["r2_buckets"][0]["bucket_name"],
            "conducted-dev-c08-x"
        );
        assert_eq!(config["no_bundle"], true);
    }

    #[test]
    fn a_pairing_answer_must_name_this_worker() {
        let (url, server) = serve_once(
            "200 OK",
            "{\"service\":\"conducted-cloud\",\"paired\":true}",
            Some("good-token"),
        );
        let parsed = reqwest::Url::parse(&format!("{url}/pair")).expect("a URL");
        tauri::async_runtime::block_on(ask_worker_for_pairing(&client(), &parsed, "good-token"))
            .expect("the Worker's answer");
        server.join().expect("the server");
    }

    #[test]
    fn a_refused_pairing_token_is_its_own_error() {
        let (url, server) = serve_once("401 Unauthorized", "Unauthorized", None);
        let parsed = reqwest::Url::parse(&format!("{url}/pair")).expect("a URL");
        let error =
            tauri::async_runtime::block_on(ask_worker_for_pairing(&client(), &parsed, "bad-token"))
                .expect_err("a refused token");
        let CommandError::Failed { code, .. } = error else {
            panic!("the error was not a failure");
        };
        assert_eq!(code, "cloud_pair_refused");
        server.join().expect("the server");
    }

    #[test]
    fn an_answer_with_another_service_name_is_refused() {
        let (url, server) = serve_once(
            "200 OK",
            "{\"service\":\"something-else\",\"paired\":true}",
            Some("good-token"),
        );
        let parsed = reqwest::Url::parse(&format!("{url}/pair")).expect("a URL");
        let error = tauri::async_runtime::block_on(ask_worker_for_pairing(
            &client(),
            &parsed,
            "good-token",
        ))
        .expect_err("another service");
        let CommandError::Failed { code, .. } = error else {
            panic!("the error was not a failure");
        };
        assert_eq!(code, "cloud_not_a_worker");
        server.join().expect("the server");
    }
}
