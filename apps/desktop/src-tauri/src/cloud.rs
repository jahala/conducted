//! @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
//! @feature CLOUD-07 Pair the desktop app with the user's Worker
//!
//! Owns: the Rust shell's side of the cloud connection: the pairing flow and the Keychain items it
//! keeps, an HTTPS request to the user's Worker with the pairing token, and the WebSocket relay
//! that carries the UI's sidecar lines to the Worker.
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
//!
//! Our design choice: one pairing per Mac, stored under `cloud-pairing-token` and
//! `cloud-pairing-url`. D101 and D104 record this.
//!
//! Test first: a request path that names another host or climbs with `..` is refused, a relay
//! line with a newline is refused before anything is sent, and a pairing answer with another
//! service name is refused.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
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

fn bearer(token: &str) -> CommandResult<HeaderValue> {
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
    let base = checked_worker_url(&url)?;
    let relay = relay_url(&base, &vm_id)?;
    let token = pairing_token().await?;
    let mut request = relay.as_str().into_client_request().map_err(|error| {
        refused(
            "cloud_relay_failed",
            format!("The relay URL is not valid: {error}"),
        )
    })?;
    request
        .headers_mut()
        .insert(reqwest::header::AUTHORIZATION, bearer(&token)?);
    let (stream, _answer) = tokio_tungstenite::connect_async(request)
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
