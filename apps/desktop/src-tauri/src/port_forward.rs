//! @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
//!
//! Owns: the local TCP listeners that carry a cloud workspace's ports to the Mac, the free-port
//! search, and the events that report a forward's state.
//!
//! Behaviour: docs/research/conductor/services-map.md 5A.3.3 (port forwarding for cloud
//! workspaces: the table, the allocation strategy, the port range and the error page when the
//! remote port is dead) and native-and-sidecar-map.md A10 (a local listener pipes each accepted
//! connection through the tunnel). Conductor reaches a sandbox over SSH; our Worker routes a
//! WebSocket tunnel to the sandbox entry (D002: the wire protocol is ours, because Conductor's
//! cloud backend is not in the research).
//!
//! Must handle:
//! - Port 22 is refused before a listener is made. It is reserved for SSH.
//! - The listener is bound before `start_port_forward` returns, so "started" always means the
//!   Mac port is open. A bind failure is `port_forward_bind_failed`, which the UI retries with a
//!   new port.
//! - Each accepted connection opens its own WebSocket. A connection that cannot reach the sandbox
//!   port gets Conductor's HTML error page ("Port <n> isn't responding") and closes.
//! - The pairing token is read from the Keychain in Rust. The web view never sees it (D101, D106),
//!   so there is no token-request round trip; the UI's token calls are replaced by this read.
//! - Stopping a forward aborts its accept loop. Connections already open end with it, because
//!   their WebSocket is part of the same task tree.
//! - `find_available_local_port` never returns a port below 1024, port 22, an excluded port, or
//!   one another process holds.
//!
//! Our design choice: one WebSocket per connection keeps a stuck connection from stalling the
//! others; the tunnel route is `/w/<name>/tunnel?port=<n>` on the Worker. D109 records this,
//! including why the token handshake has one home fewer than Conductor's.
//!
//! Test first: asking for a port another listener holds returns a different free port.

use std::collections::HashMap;
use std::sync::Mutex;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

use crate::cloud;
use crate::error::{CommandError, CommandResult, lock};

/// The event that reports a forward starting, stopping or failing.
pub const EVENT: &str = "port-forward-event";

/// The lowest local port a forward may use. Below it are the system ports, and 22 is reserved.
pub const MIN_PORT: u16 = 1024;
/// The highest local port.
pub const MAX_PORT: u16 = 65_535;
/// The port SSH uses, which Conductor reserves and this app refuses.
pub const SSH_PORT: u16 = 22;

/// One running forward, as the UI lists it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardEntry {
    pub forward_id: String,
    pub local_port: u16,
    pub remote_port: u16,
}

/// What a `port-forward-event` says. `kind` is "started", "stopped" or "error".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortForwardEvent {
    pub forward_id: String,
    pub kind: &'static str,
    pub message: Option<String>,
}

struct Running {
    entry: PortForwardEntry,
    task: tauri::async_runtime::JoinHandle<()>,
}

/// Every running forward. Registered once with `.manage(PortForwardState::default())`.
#[derive(Default)]
pub struct PortForwardState {
    forwards: Mutex<HashMap<String, Running>>,
}

fn refused(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError::Failed {
        code,
        message: message.into(),
    }
}

fn checked_port(port: u16) -> CommandResult<()> {
    if port == SSH_PORT {
        return Err(refused(
            "port_forward_reserved",
            "Port 22 is reserved for SSH and cannot be forwarded here.",
        ));
    }
    if port < MIN_PORT {
        return Err(refused(
            "port_forward_invalid",
            "Enter a valid port (1-65535).",
        ));
    }
    Ok(())
}

/// Whether `port` can be bound on the loopback interface right now.
fn can_bind(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

/// The first free port at `preferred`, then from `range_start` upward. `excluded` holds ports the
/// app already owns, so two forwards never pick the same one.
pub fn first_available(
    preferred: Option<u16>,
    excluded: &[u16],
    range_start: u16,
    range_end: u16,
) -> CommandResult<u16> {
    let taken =
        |port: u16| -> bool { port < MIN_PORT || port == SSH_PORT || excluded.contains(&port) };
    if let Some(port) = preferred
        && !taken(port)
        && can_bind(port)
    {
        return Ok(port);
    }
    let start = range_start.max(MIN_PORT);
    let end = range_end;
    if start <= end {
        for port in start..=end {
            if !taken(port) && can_bind(port) {
                return Ok(port);
            }
        }
    }
    Err(refused(
        "port_forward_no_port",
        "No free local port is left in the forwarding range.",
    ))
}

/// Finds a free local port for a forward. `preferred_port` is the remote port under the "match"
/// strategy; the range is the fallback.
#[tauri::command]
pub async fn find_available_local_port(
    preferred_port: Option<u16>,
    excluded_ports: Option<Vec<u16>>,
    range_start: Option<u16>,
    range_end: Option<u16>,
) -> CommandResult<u16> {
    let excluded = excluded_ports.unwrap_or_default();
    let start = range_start.unwrap_or(20_000);
    let end = range_end.unwrap_or(29_999);
    let preferred = preferred_port.filter(|port| *port != SSH_PORT);
    tokio::task::spawn_blocking(move || first_available(preferred, &excluded, start, end))
        .await
        .map_err(|error| {
            refused(
                "port_forward_failed",
                format!("The port search could not run: {error}"),
            )
        })?
}

/// Starts a local listener that carries each accepted connection to `remote_port` in the
/// workspace's sandbox.
#[tauri::command]
pub async fn start_port_forward(
    app: AppHandle,
    state: State<'_, PortForwardState>,
    forward_id: String,
    url: String,
    vm_id: String,
    local_port: u16,
    remote_port: u16,
) -> CommandResult<PortForwardEntry> {
    checked_port(local_port)?;
    checked_port(remote_port)?;
    let base = cloud::checked_worker_url(&url)?;
    let tunnel = cloud::tunnel_url(&base, &vm_id, remote_port)?;
    let token = cloud::pairing_token().await?;
    let listener = TcpListener::bind(("127.0.0.1", local_port))
        .await
        .map_err(|error| {
            refused(
                "port_forward_bind_failed",
                format!("Failed to bind port {local_port}: {error}"),
            )
        })?;
    let entry = PortForwardEntry {
        forward_id: forward_id.clone(),
        local_port,
        remote_port,
    };
    if let Some(previous) = lock(&state.forwards).remove(&forward_id) {
        previous.task.abort();
    }
    let task_id = forward_id.clone();
    let app_for_task = app.clone();
    let tunnel_url = tunnel.to_string();
    let task = tauri::async_runtime::spawn(async move {
        let reason = accept_loop(listener, tunnel_url, token).await;
        if let Some(message) = reason {
            let _ = app_for_task.emit(
                EVENT,
                PortForwardEvent {
                    forward_id: task_id.clone(),
                    kind: "error",
                    message: Some(message),
                },
            );
        }
        let _ = app_for_task.emit(
            EVENT,
            PortForwardEvent {
                forward_id: task_id,
                kind: "stopped",
                message: None,
            },
        );
    });
    lock(&state.forwards).insert(
        forward_id.clone(),
        Running {
            entry: entry.clone(),
            task,
        },
    );
    let _ = app.emit(
        EVENT,
        PortForwardEvent {
            forward_id,
            kind: "started",
            message: None,
        },
    );
    Ok(entry)
}

/// Accepts connections until the task is aborted. Returns a message when the listener itself
/// failed, which the UI shows; an aborted task returns nothing.
async fn accept_loop(listener: TcpListener, tunnel_url: String, token: String) -> Option<String> {
    loop {
        match listener.accept().await {
            Ok((stream, _peer)) => {
                let url = tunnel_url.clone();
                let token = token.clone();
                tauri::async_runtime::spawn(async move {
                    pipe(stream, url, token).await;
                });
            }
            Err(error) => return Some(format!("The local listener failed: {error}")),
        }
    }
}

/// Carries one accepted connection over a tunnel WebSocket, in both directions, until either side
/// closes. A tunnel that cannot open gets an HTML page, as Conductor's forward does.
async fn pipe(stream: TcpStream, tunnel_url: String, token: String) {
    let remote_port = remote_port_of(&tunnel_url);
    let request = match tunnel_url.into_client_request() {
        Ok(mut request) => {
            match cloud::bearer(&token) {
                Ok(header) => {
                    request.headers_mut().insert(
                        tokio_tungstenite::tungstenite::http::header::AUTHORIZATION,
                        header,
                    );
                }
                Err(_) => return,
            }
            request
        }
        Err(_) => return,
    };
    let (ws, _answer) = match tokio_tungstenite::connect_async(request).await {
        Ok(opened) => opened,
        Err(_) => {
            write_error_page(stream, remote_port).await;
            return;
        }
    };
    let (mut sink, mut source) = ws.split();
    let (mut reader, mut writer) = stream.into_split();
    let mut buffer = vec![0u8; 16 * 1024];
    loop {
        tokio::select! {
            read = reader.read(&mut buffer) => match read {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if sink.send(Message::Binary(buffer[..count].to_vec().into())).await.is_err() {
                        break;
                    }
                }
            },
            message = source.next() => match message {
                Some(Ok(Message::Binary(bytes))) => {
                    if writer.write_all(&bytes).await.is_err() {
                        break;
                    }
                }
                Some(Ok(Message::Text(text))) => {
                    if writer.write_all(text.as_bytes()).await.is_err() {
                        break;
                    }
                }
                Some(Ok(Message::Ping(payload))) => {
                    let _ = sink.send(Message::Pong(payload)).await;
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            },
        }
    }
    let _ = sink.close().await;
    let _ = writer.shutdown().await;
}

/// The remote port in a tunnel URL, for the error page. Zero when it cannot be read.
fn remote_port_of(tunnel_url: &str) -> u16 {
    reqwest::Url::parse(tunnel_url)
        .ok()
        .and_then(|url| {
            url.query_pairs()
                .find(|(name, _)| name == "port")
                .and_then(|(_, value)| value.parse().ok())
        })
        .unwrap_or(0)
}

/// Conductor's answer to an HTTP client whose remote port is dead. The page says what happened
/// instead of leaving the browser with a blank connection.
async fn write_error_page(mut stream: TcpStream, remote_port: u16) {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Port {remote_port} isn't responding</title></head>\
         <body style=\"font-family: system-ui, sans-serif; padding: 48px; color: #111;\">\
         <h1>Port {remote_port} isn't responding</h1>\
         <p>The dev server may not be running in the cloud workspace yet.</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

fn running_entries(state: &PortForwardState) -> Vec<PortForwardEntry> {
    lock(&state.forwards)
        .values()
        .map(|running| running.entry.clone())
        .collect()
}

/// Lists the forwards that are running now, so the UI can reconcile a reload.
#[tauri::command]
pub async fn list_port_forwards(
    state: State<'_, PortForwardState>,
) -> CommandResult<Vec<PortForwardEntry>> {
    Ok(running_entries(&state))
}

/// Stops one forward. A forward that is already gone succeeds.
#[tauri::command]
pub async fn stop_port_forward(
    state: State<'_, PortForwardState>,
    forward_id: String,
) -> CommandResult<()> {
    if let Some(running) = lock(&state.forwards).remove(&forward_id) {
        running.task.abort();
    }
    Ok(())
}

/// Stops every forward. Called when the app quits, so no listener outlives the window.
pub fn close_all(state: &PortForwardState) {
    let forwards = std::mem::take(&mut *lock(&state.forwards));
    for (_, running) in forwards {
        running.task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_port_another_listener_holds_is_not_offered() {
        let held = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("a free port");
        let port = held.local_addr().expect("the bound address").port();
        let chosen = first_available(Some(port), &[], port, port + 50).expect("another port");
        assert_ne!(chosen, port);
        assert!((port..=port + 50).contains(&chosen) || chosen >= MIN_PORT);
    }

    #[test]
    fn excluded_ports_are_skipped() {
        let first = first_available(Some(20_000), &[], 20_000, 20_010).expect("a free port");
        let second = first_available(Some(20_000), &[first], 20_000, 20_010)
            .expect("a free port other than the first");
        assert_ne!(first, second);
    }

    #[test]
    fn port_22_and_the_system_range_are_refused() {
        assert!(checked_port(SSH_PORT).is_err());
        assert!(checked_port(1).is_err());
        assert!(checked_port(3000).is_ok());
        // Even when a range names 22, the search skips it.
        let chosen = first_available(Some(SSH_PORT), &[], 1, 2000).expect("a free port");
        assert!(chosen >= MIN_PORT);
    }

    #[test]
    fn a_tunnel_url_names_the_port_and_the_workspace() {
        let base =
            cloud::checked_worker_url("https://conducted.example.workers.dev").expect("a good URL");
        let url = cloud::tunnel_url(&base, "oslo-1", 3000).expect("a good tunnel");
        assert_eq!(
            url.as_str(),
            "wss://conducted.example.workers.dev/w/oslo-1/tunnel?port=3000"
        );
        assert!(cloud::tunnel_url(&base, "oslo-1", 22).is_err());
    }

    #[test]
    fn the_remote_port_is_read_from_the_tunnel_url() {
        assert_eq!(
            remote_port_of("wss://example.test/w/oslo/tunnel?port=5173"),
            5173
        );
        assert_eq!(remote_port_of("not a url"), 0);
    }
}
