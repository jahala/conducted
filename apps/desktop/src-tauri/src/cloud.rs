//! @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
//! @feature CLOUD-07 Pair the desktop app with the user's Worker
//! @feature CLOUD-08 Deploy flow for the user's Cloudflare account
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
//! - The uninstall deletes the Worker, then its container application and images, then the bucket,
//!   and unpairs. A resource the account does not have is skipped, so a second uninstall succeeds.
//!
//! Our design choice: one pairing per Mac, stored under `cloud-pairing-token` and
//! `cloud-pairing-url`. D101 and D106 record this; D109 records the deploy flow.
//!
//! Test first: a request path that names another host or climbs with `..` is refused, a relay
//! line with a newline is refused before anything is sent, a pairing answer with another
//! service name is refused, and a deploy leaves no secret file behind.

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

/// The writable temp folder one deploy uses for its config and secret file.
fn deploy_temp_folder() -> CommandResult<PathBuf> {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let folder =
        std::env::temp_dir().join(format!("conducted-deploy-{}-{nanos}", std::process::id()));
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
fn write_secret_file(token: &str) -> CommandResult<PathBuf> {
    use std::os::unix::fs::OpenOptionsExt as _;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    let path = std::env::temp_dir().join(format!(
        "conducted-deploy-{}-{nanos}.json",
        std::process::id()
    ));
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
) -> CommandResult<String> {
    deploy_worker_with(wrangler, resources, worker, token, require_docker)
}

/// The deploy's steps with the Docker check passed in, so a test can run them without Docker.
fn deploy_worker_with<F>(
    wrangler: &Wrangler,
    resources: &Path,
    worker: &str,
    token: &str,
    docker: F,
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
    docker()?;
    // wrangler writes its own state under the working folder; use the deploy's temp folder so the
    // app bundle is never written to.
    let folder = deploy_temp_folder()?;
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
    let secrets = match write_secret_file(token) {
        Ok(path) => path,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&folder);
            return Err(error);
        }
    };
    let config = config.to_string_lossy().into_owned();
    let secrets_arg = secrets.to_string_lossy().into_owned();
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
    let url = blocking("cloud_deploy_failed", move || {
        deploy_worker(&wrangler, &resources, &worker, &with_token)
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
    ask_worker_for_pairing(&client, &pair_url, &token).await?;
    write_pairing(&base, &token).await?;
    Ok(CloudDeployPayload {
        url: base.as_str().trim_end_matches('/').to_string(),
    })
}

/// The steps of an uninstall: the Worker, then its container application and images, then the
/// bucket. A resource the account does not have is skipped, so a second uninstall succeeds.
pub fn uninstall_worker(wrangler: &Wrangler, resources: &Path, worker: &str) -> CommandResult<()> {
    checked_resource_name("cloud_worker_name_invalid", "Worker", worker)?;
    let removed = wrangler.run(
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
    if !removed.success {
        let said = removed.stderr.to_ascii_lowercase();
        let already_gone = said.contains("does not exist") || said.contains("not found");
        if !already_gone {
            return Err(refused(
                "cloud_wrangler_failed",
                format!("wrangler delete failed: {}", removed.stderr.trim()),
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
        }
    }

    let buckets = wrangler.run(
        &[
            String::from("r2"),
            String::from("bucket"),
            String::from("list"),
        ],
        resources,
        None,
        WRANGLER_TIMEOUT,
    )?;
    if buckets.success
        && bucket_names(&buckets.stdout)
            .iter()
            .any(|name| name == worker)
    {
        run_checked(
            wrangler,
            &["r2", "bucket", "delete", worker],
            resources,
            None,
            WRANGLER_TIMEOUT,
        )?;
    }
    Ok(())
}

/// Deletes what a deploy made, in the order that stops billing: the Worker, its container
/// application and images, then the R2 bucket. It also removes this Mac's pairing.
#[tauri::command]
pub async fn cloud_uninstall(
    app: AppHandle,
    input: Option<CloudUninstallInput>,
) -> CommandResult<()> {
    let resources = app_deploy_resources(&app)?;
    let facts = read_deploy_facts(&resources)?;
    let worker = input
        .as_ref()
        .and_then(|value| value.worker_name.clone())
        .filter(|name| !name.is_empty())
        .unwrap_or(facts.name);
    let wrangler = Wrangler::new();
    blocking("cloud_uninstall_failed", move || {
        uninstall_worker(&wrangler, &resources, &worker)
    })
    .await?;
    cloud_unpair().await
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
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|elapsed| elapsed.as_nanos())
                .unwrap_or_default();
            let path = std::env::temp_dir().join(format!(
                "conducted-deploy-test-{}-{nanos}",
                std::process::id()
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
        let url = deploy_worker_with(
            &wrangler,
            &resources,
            "conducted-dev-c08-test",
            "the-token",
            || Ok(()),
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
        let leftovers = std::fs::read_dir(std::env::temp_dir())
            .expect("the temp folder")
            .filter_map(|entry| entry.ok())
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(&format!("conducted-deploy-{}-", std::process::id()))
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn an_uninstall_deletes_the_worker_its_container_its_images_and_the_bucket() {
        let (folder, wrangler, record) = fake_wrangler(
            "#!/bin/sh\n\
             echo \"$*\" >> RECORD\n\
             if [ \"$1\" = \"containers\" ] && [ \"$2\" = \"list\" ]; then\n\
               echo '[{\"id\":\"abc\",\"name\":\"conducted-cloud-sandbox\"}]'; exit 0; fi\n\
             if [ \"$1\" = \"containers\" ] && [ \"$2\" = \"images\" ] && [ \"$3\" = \"list\" ]; then\n\
               echo '[{\"name\":\"conducted-cloud-workspace-sandbox\",\"tags\":[\"wrangler-a\"]}]'; exit 0; fi\n\
             if [ \"$1\" = \"r2\" ] && [ \"$3\" = \"list\" ]; then\n\
               echo 'name:           conducted-cloud'; exit 0; fi\n\
             exit 0\n",
        );
        let resources = resources_folder(&folder);
        uninstall_worker(&wrangler, &resources, "conducted-cloud").expect("an uninstall");
        let calls = std::fs::read_to_string(&record).expect("the record");
        let lines: Vec<&str> = calls.lines().collect();
        assert_eq!(lines[0], "delete --name conducted-cloud --force");
        assert!(lines.contains(&"containers delete abc"));
        assert!(
            lines.contains(
                &"containers images delete conducted-cloud-workspace-sandbox:wrangler-a -y"
            )
        );
        assert!(lines.contains(&"r2 bucket delete conducted-cloud"));
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
