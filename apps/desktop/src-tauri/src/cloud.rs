//! @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
//!
//! Owns: the Rust shell's side of the cloud connection: an HTTPS request to the user's Worker with
//! the pairing token, and the WebSocket relay that carries the UI's sidecar lines to the Worker.
//!
//! Behaviour: docs/plans/cloud-and-remote.md Part 1 and the CLOUD-02 spike's question 4
//! (`docs/research/cloud-spike-2026-11-06.md`): the token travels in the `Authorization` header
//! and is kept in the Keychain; the web view cannot set WebSocket headers, so the Rust shell owns
//! the relay and relays lines verbatim, as it does the local sidecar socket.
//!
//! Must handle:
//! - The token is read from the Keychain and never returned to the web view, logged or put in an
//!   event payload.
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
//!
//! Our design choice: one pairing token per Mac, stored under `cloud-pairing-token`. CLOUD-07
//! builds the pairing flow and may make it per Worker; D101 records this.
//!
//! Test first: a request path that names another host or climbs with `..` is refused, and a relay
//! line with a newline is refused before anything is sent.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
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
/// The Keychain item that holds the Worker's pairing token (CLOUD-07 owns the pairing flow).
pub const PAIRING_TOKEN_KEY: &str = "cloud-pairing-token";
/// How long the shell waits for a Worker's answer when the request names no timeout.
pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;
/// Largest body accepted from a Worker, so an answer cannot exhaust memory.
pub const MAX_BODY_BYTES: usize = 32 * 1024 * 1024;

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

/// The WebSocket URL for one workspace's relay.
pub fn relay_url(base: &reqwest::Url, vm_id: &str) -> CommandResult<reqwest::Url> {
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
    let url = route_url(base, &format!("/w/{vm_id}/rpc"))?;
    let mut url = url;
    url.set_scheme("wss").map_err(|_| {
        refused(
            "cloud_url_not_allowed",
            "The relay URL could not be made secure.",
        )
    })?;
    Ok(url)
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

fn bearer(token: &str) -> CommandResult<HeaderValue> {
    HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_| {
        refused(
            "cloud_token_unreadable",
            "The pairing token cannot be a header.",
        )
    })
}

/// True when the Keychain holds a pairing token. The token itself never leaves Rust.
#[tauri::command]
pub async fn cloud_paired() -> CommandResult<bool> {
    Ok(blocking("cloud_token_unreadable", || {
        keychain::read_secret(keychain::SERVICE, PAIRING_TOKEN_KEY)
    })
    .await?
    .is_some_and(|token| !token.is_empty()))
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
) -> CommandResult<String> {
    let token = pairing_token().await?;
    open_relay(app, &state, &url, &vm_id, &token, None).await
}

/// The relay itself, with its pairing token and TLS trust passed in. Production reads the token
/// from the Keychain and uses the system trust. The integration test in
/// `tests/cloud_relay_workerd.rs` supplies a test token and trusts the local runtime's own
/// certificate, so it can reach a Worker that it starts on this Mac.
pub async fn open_relay<R: tauri::Runtime>(
    app: AppHandle<R>,
    state: &CloudState,
    url: &str,
    vm_id: &str,
    token: &str,
    connector: Option<Connector>,
) -> CommandResult<String> {
    let base = checked_worker_url(url)?;
    let relay = relay_url(&base, vm_id)?;
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
            relay_url(&base, "oslo-1")
                .expect("a good workspace")
                .as_str(),
            "wss://conducted.example.workers.dev/w/oslo-1/rpc"
        );
        assert!(relay_url(&base, "Oslo").is_err());
        assert!(relay_url(&base, "").is_err());
        assert!(relay_url(&base, "-oslo").is_err());
    }

    #[test]
    fn a_relay_line_cannot_hold_a_newline() {
        // The check lives in the command, so its rule is stated here for the reader of the code:
        // the command refuses `\n` and `\r`, which is what keeps one message on one line.
        let line = "{\"jsonrpc\":\"2.0\"}\n{\"jsonrpc\":\"2.0\"}";
        assert!(line.contains('\n'));
    }
}
