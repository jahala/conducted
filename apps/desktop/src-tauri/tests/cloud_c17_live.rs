//! @feature CLOUD-17 MCP servers in the cloud sandbox
//!
//! Owns: one live run of the cloud MCP path on the owner's Cloudflare account, under a throwaway
//! `conducted-dev-c17l-<time>` name. A test MCP server runs on this Mac behind a Cloudflare quick
//! tunnel (no account resource) and answers only the bearer token this run made. The run saves
//! that server in the Worker's personal settings, starts a sandbox, and over the sidecar relay
//! asks Claude in the sandbox to list its MCP servers, warms a chat, and sends the server's prompt
//! as a slash command, so Claude calls the server (`prompts/get`). A `tools/call` from inside the
//! sandbox carries only the placeholder, so the server's answer proves the Worker's swap. The run
//! then searches the sandbox (every process's environment and command line, the files written
//! since it started, and the runtime folders) and every relayed line for the token, by its
//! SHA-256, and checks the search on a planted decoy. Then it deletes everything it made with the
//! app's own uninstall, which empties the bucket of the settings object and the backups first.
//!
//! The OAuth run does the same for an OAuth server: a test provider and MCP server on this Mac
//! behind a quick tunnel, which registers the Worker's client, approves the sign-in, and issues
//! 90-second access tokens with refresh tokens it spends once. The run connects the server through
//! the Worker's routes and acts as the browser between the provider and the callback, starts a
//! sandbox, has the agent list the server, calls it from the sandbox before and after the token is
//! due for refresh, and searches the sandbox for every token the provider issued.
//!
//! Behaviour: D121 and docs/research/cloud-spike-2026-11-06.md. It uses the app's bundled deploy
//! inputs (`resources/cloud`, made by `pnpm cloud:prepare`), the real `wrangler` login, Docker and
//! `cloudflared` on the PATH.
//!
//! Spend: the Worker holds no model key, so the turn's model call stops at the Worker with 503
//! and spends nothing; the run checks `/readiness` says so before it sends the turn.
//!
//! `#[ignore]` because it writes to a real Cloudflare account and needs Docker; run it with
//! `pnpm cloud:live-mcp`, which builds the deploy inputs and moves them to the Trash after. It deletes
//! everything it made even when a step fails or panics. A run killed outright leaves its
//! deployment; `remove_leftover_c17_deployments` removes every `conducted-dev-c17l-` one. The
//! token is made in memory and never printed; only counts are.

use std::io::{BufRead, BufReader};
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use ring::rand::{SecureRandom, SystemRandom};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

use conducted_lib::cloud::{
    CloudflareApi, WRANGLER_TIMEOUT, Wrangler, bucket_names, container_id, deploy_worker,
    image_refs, make_pairing_token, uninstall_worker,
};

const PREFIX: &str = "conducted-dev-c17l-";
const SERVER: &str = "c17probe";
const TOOL: &str = "c17_probe";
const PROMPT: &str = "probe";

fn live_name() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();
    format!(
        "{PREFIX}{:02}{:02}{:02}",
        (seconds / 3600) % 24,
        (seconds / 60) % 60,
        seconds % 60
    )
}

fn live_wrangler() -> Wrangler {
    let pinned =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../cloud/node_modules/.bin/wrangler");
    Wrangler {
        program: pinned.to_string_lossy().into_owned(),
    }
}

fn resources() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/cloud")
}

fn listed(wrangler: &Wrangler, resources: &Path, args: &[&str]) -> String {
    let owned: Vec<String> = args.iter().map(|arg| (*arg).to_string()).collect();
    wrangler
        .run(&owned, resources, None, WRANGLER_TIMEOUT)
        .map(|output| output.stdout)
        .unwrap_or_default()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 24 random bytes as 48 lowercase hex characters.
fn random_hex() -> String {
    let mut bytes = [0u8; 24];
    SystemRandom::new()
        .fill(&mut bytes)
        .expect("the system random source");
    hex(&bytes)
}

fn sha256_hex(text: &str) -> String {
    hex(&Sha256::digest(text.as_bytes()))
}

// ---------------------------------------------------------------- the test MCP server

/// What the test server saw, by JSON-RPC method: calls with the run's token and calls without.
#[derive(Default, Debug, Clone)]
struct Seen {
    authorized: Vec<String>,
    refused: Vec<String>,
}

impl Seen {
    fn count(&self, method: &str) -> usize {
        self.authorized
            .iter()
            .filter(|seen| *seen == method)
            .count()
    }
}

fn mcp_answer(message: &Value) -> Option<Value> {
    let id = message.get("id")?.clone();
    let method = message["method"].as_str().unwrap_or("");
    let result = match method {
        "initialize" => json!({
            "protocolVersion": message["params"]["protocolVersion"].as_str().unwrap_or("2025-06-18"),
            "capabilities": { "tools": {}, "prompts": {} },
            "serverInfo": { "name": SERVER, "version": "1.0.0" },
        }),
        "tools/list" => json!({ "tools": [{
            "name": TOOL,
            "description": "Answers c17-probe-ok.",
            "inputSchema": { "type": "object", "properties": {} },
        }] }),
        "tools/call" => json!({ "content": [{ "type": "text", "text": "c17-probe-ok" }] }),
        "prompts/list" => {
            json!({ "prompts": [{ "name": PROMPT, "description": "A probe prompt." }] })
        }
        "prompts/get" => json!({ "messages": [{
            "role": "user",
            "content": { "type": "text", "text": "Call the c17_probe tool once." },
        }] }),
        "resources/list" => json!({ "resources": [] }),
        "ping" => json!({}),
        _ => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": "Method not found" },
            }));
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn http_response(status: &str, content_type: &str, body: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 {status}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
        body.len()
    )
    .into_bytes()
}

/// Reads one HTTP/1.1 request: its first line, its headers (lower-cased names) and its body.
async fn read_request(
    stream: &mut tokio::net::TcpStream,
) -> Option<(String, Vec<(String, String)>, Vec<u8>)> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    let head_end = loop {
        if let Some(at) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            break at;
        }
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
    };
    let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let first = lines.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter_map(|line| {
            let (name, value) = line.split_once(':')?;
            Some((name.trim().to_ascii_lowercase(), value.trim().to_string()))
        })
        .collect();
    let header = |name: &str| {
        headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    let mut body = buffer[head_end + 4..].to_vec();
    if header("transfer-encoding").is_some_and(|value| value.contains("chunked")) {
        // Read until the last chunk, then decode.
        while !body.windows(5).any(|window| window == b"0\r\n\r\n") {
            let read = stream.read(&mut chunk).await.ok()?;
            if read == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..read]);
        }
        let mut decoded = Vec::new();
        let mut rest = &body[..];
        while let Some(at) = rest.windows(2).position(|window| window == b"\r\n") {
            let size =
                usize::from_str_radix(String::from_utf8_lossy(&rest[..at]).trim(), 16).ok()?;
            if size == 0 {
                break;
            }
            let start = at + 2;
            decoded.extend_from_slice(rest.get(start..start + size)?);
            rest = rest.get(start + size + 2..)?;
        }
        body = decoded;
    } else {
        let length: usize = header("content-length")
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        while body.len() < length {
            let read = stream.read(&mut chunk).await.ok()?;
            if read == 0 {
                break;
            }
            body.extend_from_slice(&chunk[..read]);
        }
    }
    Some((first, headers, body))
}

/// Serves the test MCP server on 127.0.0.1 and returns its port. Every request but `/healthz`
/// needs `Authorization: Bearer <token>`; the token is compared, never logged.
async fn start_mcp_server(token: String, seen: Arc<Mutex<Seen>>) -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a loopback port");
    let port = listener.local_addr().expect("the bound port").port();
    let expected = format!("Bearer {token}");
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            let expected = expected.clone();
            let seen = seen.clone();
            tauri::async_runtime::spawn(async move {
                let Some((first, headers, body)) = read_request(&mut stream).await else {
                    return;
                };
                let method = first.split(' ').next().unwrap_or("").to_string();
                let path = first.split(' ').nth(1).unwrap_or("").to_string();
                if path == "/healthz" {
                    let _ = stream
                        .write_all(&http_response("200 OK", "text/plain", "ok"))
                        .await;
                    return;
                }
                let authorized = headers
                    .iter()
                    .any(|(name, value)| name == "authorization" && *value == expected);
                let parsed: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                let messages: Vec<Value> = match parsed {
                    Value::Array(items) => items,
                    Value::Null => Vec::new(),
                    other => vec![other],
                };
                let label = |message: &Value| {
                    message["method"]
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("{method} {path}"))
                };
                {
                    let mut record = seen.lock().expect("the record");
                    let names: Vec<String> = if messages.is_empty() {
                        vec![format!("{method} {path}")]
                    } else {
                        messages.iter().map(label).collect()
                    };
                    if authorized {
                        record.authorized.extend(names);
                    } else {
                        record.refused.extend(names);
                    }
                }
                let reply = if !authorized {
                    http_response(
                        "401 Unauthorized",
                        "application/json",
                        r#"{"error":"unauthorized"}"#,
                    )
                } else if method != "POST" {
                    http_response("405 Method Not Allowed", "text/plain", "")
                } else {
                    let answers: Vec<Value> = messages.iter().filter_map(mcp_answer).collect();
                    match answers.len() {
                        0 => http_response("202 Accepted", "application/json", ""),
                        1 => http_response("200 OK", "application/json", &answers[0].to_string()),
                        _ => http_response(
                            "200 OK",
                            "application/json",
                            &Value::Array(answers).to_string(),
                        ),
                    }
                };
                let _ = stream.write_all(&reply).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    port
}

/// Starts a Cloudflare quick tunnel to the port and returns the child and its public URL. The
/// tunnel runs with a home folder of its own, so no tunnel config on this Mac is read.
fn start_tunnel(port: u16, home: &Path) -> Result<(Child, String), String> {
    let mut child = Command::new("cloudflared")
        .args([
            "tunnel",
            "--no-autoupdate",
            "--url",
            &format!("http://127.0.0.1:{port}"),
        ])
        .env("HOME", home)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("cloudflared did not start: {error}"))?;
    let stderr = child.stderr.take().ok_or("cloudflared has no stderr")?;
    let (sender, receiver) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(at) = line.find("https://") {
                let url: String = line[at..]
                    .chars()
                    .take_while(|c| !c.is_whitespace() && *c != '|')
                    .collect();
                if url.ends_with(".trycloudflare.com") {
                    let _ = sender.send(url);
                }
            }
        }
    });
    match receiver.recv_timeout(Duration::from_secs(60)) {
        Ok(url) => Ok((child, url)),
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            Err("cloudflared printed no trycloudflare.com URL in 60 s".into())
        }
    }
}

// ---------------------------------------------------------------- the Worker

/// True for Cloudflare's answer while a new `workers.dev` name is not yet known at every edge
/// (error 1042). It can come back after the name first answered, so every call checks for it.
fn not_yet_routed(status: u16, body: &str) -> bool {
    status == 404 && body.contains("1042")
}

async fn call(
    client: &reqwest::Client,
    method: reqwest::Method,
    url: &str,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (u16, String) {
    let mut last = (0, String::new());
    for _ in 0..20 {
        let mut request = client
            .request(method.clone(), format!("{url}{path}"))
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"));
        if let Some(body) = &body {
            request = request.json(body);
        }
        last = match request.send().await {
            Ok(answer) => {
                let status = answer.status().as_u16();
                (status, answer.text().await.unwrap_or_default())
            }
            Err(error) => (0, error.to_string()),
        };
        if !not_yet_routed(last.0, &last.1) {
            break;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    last
}

async fn post(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (u16, String) {
    call(client, reqwest::Method::POST, url, token, path, body).await
}

async fn get(client: &reqwest::Client, url: &str, token: &str, path: &str) -> (u16, String) {
    call(client, reqwest::Method::GET, url, token, path, None).await
}

/// The sidecar relay: JSON-RPC lines over the Worker's `/rpc` WebSocket. It answers the
/// sidecar's own requests the way the app would for a run that stores nothing, and keeps every
/// line it received.
struct Relay {
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    next_id: u64,
    /// Every line received, in order.
    lines: Vec<String>,
    /// Bytes of a line not yet ended: the relay carries the sidecar's bytes in any chunking.
    partial: String,
    /// Whole lines received and not yet read.
    queue: std::collections::VecDeque<String>,
}

impl Relay {
    async fn open(url: &str, token: &str, workspace: &str) -> Result<Self, String> {
        let ws_url = format!(
            "{}/w/{workspace}/rpc",
            url.replacen("https://", "wss://", 1)
        );
        let mut request = ws_url
            .into_client_request()
            .map_err(|error| format!("bad relay URL: {error}"))?;
        request.headers_mut().insert(
            tokio_tungstenite::tungstenite::http::header::AUTHORIZATION,
            format!("Bearer {token}")
                .parse()
                .map_err(|error| format!("bad token header: {error}"))?,
        );
        let (socket, _answer) = tokio_tungstenite::connect_async(request)
            .await
            .map_err(|error| format!("relay connect failed: {error}"))?;
        Ok(Self {
            socket,
            next_id: 1,
            lines: Vec::new(),
            partial: String::new(),
            queue: std::collections::VecDeque::new(),
        })
    }

    /// Sends one request and reads lines until its answer, or until `stop` says a line ends the
    /// wait. Returns the answer's `result`, or the error it carried.
    async fn request(
        &mut self,
        method: &str,
        params: Value,
        within: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id;
        self.next_id += 1;
        let line = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        // The sidecar's wire format is NDJSON, so the newline ends the message (as open_relay does).
        self.socket
            .send(Message::Text(format!("{line}\n").into()))
            .await
            .map_err(|error| format!("relay send: {error}"))?;
        let deadline = Instant::now() + within;
        loop {
            let message = self.next_line(deadline).await?;
            if message["id"].as_u64() == Some(id) && message.get("method").is_none() {
                if let Some(error) = message.get("error") {
                    return Err(format!("{method} answered an error: {error}"));
                }
                return Ok(message["result"].clone());
            }
        }
    }

    /// Reads lines until `done` accepts one or the time runs out.
    async fn wait_for(
        &mut self,
        within: Duration,
        done: impl Fn(&Value) -> bool,
    ) -> Result<Value, String> {
        let deadline = Instant::now() + within;
        loop {
            let message = self.next_line(deadline).await?;
            if done(&message) {
                return Ok(message);
            }
        }
    }

    async fn next_line(&mut self, deadline: Instant) -> Result<Value, String> {
        loop {
            if let Some(line) = self.queue.pop_front() {
                let message: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
                // The sidecar's own requests: acknowledge a replayed event, refuse the rest.
                if let (Some(id), Some(method)) = (message.get("id"), message["method"].as_str()) {
                    let answer = if method == "deliverEvent" {
                        json!({ "jsonrpc": "2.0", "id": id, "result": { "persisted": true } })
                    } else {
                        json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": "not in this run" } })
                    };
                    self.socket
                        .send(Message::Text(format!("{answer}\n").into()))
                        .await
                        .map_err(|error| format!("relay answer: {error}"))?;
                }
                return Ok(message);
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("timed out waiting on the relay".into());
            }
            let frame = tokio::time::timeout(left, self.socket.next())
                .await
                .map_err(|_| "timed out waiting on the relay".to_string())?
                .ok_or("the relay closed")?
                .map_err(|error| format!("relay frame: {error}"))?;
            let text = match frame {
                Message::Text(text) => text.to_string(),
                Message::Binary(bytes) => String::from_utf8_lossy(&bytes).to_string(),
                Message::Close(_) => return Err("the relay closed".into()),
                _ => continue,
            };
            self.partial.push_str(&text);
            while let Some(at) = self.partial.find('\n') {
                let line: String = self.partial.drain(..=at).collect();
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }
                self.lines.push(line.clone());
                self.queue.push_back(line);
            }
        }
    }
}

/// Runs one command on the Worker's terminal stream and returns its exit code (CLOUD-11's route).
async fn terminal_command(
    url: &str,
    token: &str,
    workspace: &str,
    command: &[&str],
    within: Duration,
) -> Result<Option<i64>, String> {
    let ws_url = format!(
        "{}/w/{workspace}/terminal",
        url.replacen("https://", "wss://", 1)
    );
    let mut request = ws_url
        .into_client_request()
        .map_err(|error| format!("bad terminal URL: {error}"))?;
    request.headers_mut().insert(
        tokio_tungstenite::tungstenite::http::header::AUTHORIZATION,
        format!("Bearer {token}")
            .parse()
            .map_err(|error| format!("bad token header: {error}"))?,
    );
    let (mut socket, _answer) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|error| format!("terminal connect failed: {error}"))?;
    socket
        .send(Message::Text(
            json!({ "type": "start", "cwd": "/", "cols": 80, "rows": 24, "command": command })
                .to_string()
                .into(),
        ))
        .await
        .map_err(|error| format!("terminal start failed: {error}"))?;
    tokio::time::timeout(within, async {
        while let Some(frame) = socket.next().await {
            let text = match frame.map_err(|error| format!("terminal frame: {error}"))? {
                Message::Text(text) => text.to_string(),
                Message::Close(_) => break,
                _ => continue,
            };
            let message: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            match message["type"].as_str() {
                Some("exit") => return Ok(message["exitCode"].as_i64()),
                Some("error") => return Err(message["message"].as_str().unwrap_or("").to_string()),
                _ => {}
            }
        }
        Ok(None)
    })
    .await
    .map_err(|_| "the terminal command timed out".to_string())?
}

/// The scan run inside the sandbox, in two files. `scan.sh` lists the files written since the
/// sandbox started and every file in the runtime folders, and pulls every run of 48 or more hex
/// characters out of them and out of every process's environment and command line (grep, so the
/// files are streamed, not held). `hash.js` hashes each 48-character window of each run and
/// compares it with the token's and the decoy's hashes. Only counts come out.
fn scan_files(token_hashes: &[String], decoy_hash: &str) -> (String, String) {
    let token_hashes = token_hashes
        .iter()
        .map(|hash| format!("\"{hash}\""))
        .collect::<Vec<_>>()
        .join(", ");
    let shell = r#"
set -u
btime=$(awk '/btime/{print $2}' /proc/stat)
ticks=$(awk '{print $22}' /proc/1/stat)
since=$((btime + ticks / 100))
# /run/cloudchamber/proc mirrors /proc, which is read below process by process.
prune='( -path /proc -o -path /sys -o -path /dev -o -path /run/cloudchamber/proc ) -prune -o'
{
  find / $prune -type f -newermt "@$since" -size -16M -print0
  find /workspace /root /home /tmp /var /run /etc $prune -type f -size -16M -print0
} 2>/dev/null | sort -zu > /tmp/c17-files
files=$(tr -cd '\000' < /tmp/c17-files | wc -c)
# Each batch runs in its own shell, so a grep that dies on one file cannot stop the rest.
xargs -0 -n 200 -a /tmp/c17-files sh -c 'grep -ahoE "[0-9a-f]{48,}" "$@" 2>/dev/null; exit 0' sh > /tmp/c17-runs
echo "xargs_exit=$?" >&2
procs=0
placeholder=0
for p in /proc/[0-9]*; do
  [ -r "$p/environ" ] || continue
  procs=$((procs + 1))
  grep -qa provided-by-worker "$p/environ" 2>/dev/null && placeholder=$((placeholder + 1))
  { tr '\000' '\n' < "$p/environ"; echo; tr '\000' '\n' < "$p/cmdline"; echo; } 2>/dev/null | grep -aoE '[0-9a-f]{48,}' >> /tmp/c17-runs
done
node /tmp/c17-hash.js /tmp/c17-runs "$files" "$procs" "$placeholder" "$since" > /tmp/c17-scan.json
"#
    .to_string();
    let hasher = format!(
        r#"
const fs = require("fs");
const crypto = require("crypto");
const readline = require("readline");
const [runs, files, procs, placeholderProcs, since] = process.argv.slice(2);
const tokens = new Set([{token_hashes}]);
const counts = {{ files: Number(files), procs: Number(procs), placeholderProcs: Number(placeholderProcs), since: Number(since), candidates: 0, token: 0, decoy: 0 }};
const lines = readline.createInterface({{ input: fs.createReadStream(runs, "latin1") }});
lines.on("line", (run) => {{
	for (let i = 0; i + 48 <= run.length; i++) {{
		const hash = crypto.createHash("sha256").update(run.slice(i, i + 48)).digest("hex");
		counts.candidates++;
		if (tokens.has(hash)) counts.token++;
		if (hash === "{decoy_hash}") counts.decoy++;
	}}
}});
lines.on("close", () => process.stdout.write(JSON.stringify(counts)));
"#
    );
    (shell, hasher)
}

/// The base settings object the run writes: no variables, one bearer-token MCP server.
fn settings_with_server(server_url: &str, token: &str) -> Value {
    json!({
        "gitIdentity": null,
        "envVars": {},
        "mcpServers": {
            SERVER: { "url": server_url, "authType": "bearer", "bearerToken": token },
        },
    })
}

#[derive(Debug, Default)]
struct Outcome {
    start_ms: u128,
    readiness: String,
    listing: String,
    turn: String,
    curl_status: String,
    sizing: String,
    scan_ms: u128,
    scan_log: String,
    scan: String,
    relay_lines: usize,
    relay_lines_with_token: usize,
}

/// What one scan of a sandbox read and found: its size, how long it took, its log and the counts.
struct Scanned {
    sizing: String,
    ms: u128,
    log: String,
    counts: String,
}

/// Plants a decoy in the sandbox and searches every file written since it started, the runtime
/// folders and every process's environment and command line for the tokens, by their SHA-256.
async fn scan_sandbox(
    client: &reqwest::Client,
    url: &str,
    pairing: &str,
    workspace: &str,
    token_hashes: &[String],
    decoy: &str,
) -> Result<Scanned, String> {
    let (status, body) = post(
        client,
        url,
        pairing,
        &format!("/w/{workspace}/files"),
        Some(json!({ "operation": "write", "path": "/workspace/c17-decoy.txt", "text": format!("decoy {decoy}\n") })),
    )
    .await;
    if status != 200 {
        return Err(format!("the decoy write answered {status}: {body}"));
    }
    let (shell, hasher) = scan_files(token_hashes, &sha256_hex(decoy));
    let (status, body) = post(
        client,
        url,
        pairing,
        &format!("/w/{workspace}/files"),
        Some(json!({ "operation": "write", "path": "/tmp/c17-hash.js", "text": hasher })),
    )
    .await;
    if status != 200 {
        return Err(format!("the hasher write answered {status}: {body}"));
    }
    let (status, body) = post(
        client,
        url,
        pairing,
        &format!("/w/{workspace}/files"),
        Some(json!({ "operation": "write", "path": "/tmp/c17-scan.sh", "text": shell })),
    )
    .await;
    if status != 200 {
        return Err(format!("the scan script write answered {status}: {body}"));
    }
    // How much the scan reads: files written since the sandbox started, and the runtime folders.
    let (_, sizing) = post(
        client,
        url,
        pairing,
        &format!("/w/{workspace}/exec"),
        Some(json!({
            "program": "sh",
            "args": ["-c", "s=$(awk '/btime/{print $2}' /proc/stat); t=$(awk '{print $22}' /proc/1/stat); since=$((s + t / 100)); echo newer=$(find / \\( -path /proc -o -path /sys -o -path /dev \\) -prune -o -type f -newermt @$since -print | wc -l); du -sxk /workspace /root /home /tmp /var /run /etc 2>/dev/null | tr '\\n' ' '"],
            "cwd": "/",
            "timeoutMs": 90_000,
        })),
    )
    .await;
    let sizing_text = sizing;
    // The scan outlasts one request's window, so it runs on the terminal stream, which keeps its
    // process alive for as long as the stream is open.
    let began = Instant::now();
    let ran = terminal_command(
        url,
        pairing,
        workspace,
        &[
            "/bin/sh",
            "-c",
            "sh /tmp/c17-scan.sh 2> /tmp/c17-scan.err; echo scan_exit=$? >> /tmp/c17-scan.err",
        ],
        Duration::from_secs(420),
    )
    .await;
    let ms = began.elapsed().as_millis();
    let (_, log) = post(
        client,
        url,
        pairing,
        &format!("/w/{workspace}/files"),
        Some(json!({ "operation": "read", "path": "/tmp/c17-scan.err" })),
    )
    .await;
    let scan_log = format!("terminal={ran:?} log={log}");
    let (status, body) = post(
        client,
        url,
        pairing,
        &format!("/w/{workspace}/files"),
        Some(json!({ "operation": "read", "path": "/tmp/c17-scan.json" })),
    )
    .await;
    if status != 200 {
        return Err(format!("reading the scan answered {status}: {body}"));
    }
    let read: Value = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    let counts = read["text"].as_str().unwrap_or("").to_string();
    if counts.is_empty() {
        return Err(format!("the scan wrote nothing: {scan_log}"));
    }
    Ok(Scanned {
        sizing: sizing_text,
        ms,
        log: scan_log,
        counts,
    })
}

#[allow(clippy::too_many_arguments)]
async fn live_steps(
    url: &str,
    pairing: &str,
    workspace: &str,
    server_url: &str,
    token: &str,
    decoy: &str,
    seen: &Arc<Mutex<Seen>>,
    outcome: &mut Outcome,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?;

    // No model key on this Worker: the turn's model call stops at the Worker and spends nothing.
    // A new workers.dev name can answer 404 (Cloudflare's error 1042) for its first seconds.
    let (mut status, mut body) = get(&client, url, pairing, "/readiness").await;
    for _ in 0..20 {
        if status == 200 {
            break;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        (status, body) = get(&client, url, pairing, "/readiness").await;
    }
    outcome.readiness = format!("{status} {body}");
    let readiness: Value = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    if readiness["agents"]["anthropic"] != json!(false) {
        return Err("the Worker holds a model key; stopping before any model call".into());
    }

    let (status, body) = post(
        &client,
        url,
        pairing,
        "/settings",
        Some(settings_with_server(server_url, token)),
    )
    .await;
    if status != 200 {
        return Err(format!("settings answered {status}"));
    }
    drop(body);

    let began = Instant::now();
    let mut started = false;
    let mut last = String::new();
    for _ in 0..3 {
        let (status, body) = post(
            &client,
            url,
            pairing,
            &format!("/w/{workspace}/start"),
            None,
        )
        .await;
        if status == 200 {
            started = true;
            break;
        }
        last = format!("start answered {status}: {body}");
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    outcome.start_ms = began.elapsed().as_millis();
    if !started {
        return Err(last);
    }

    let launch = json!({
        "env": {},
        "providerKeys": { "ANTHROPIC_API_KEY": { "value": "provided-by-worker", "source": "entered" } },
    });
    let mut relay = Relay::open(url, pairing, workspace).await?;

    // 1. The agent lists the server.
    let listed = relay
        .request(
            "listMcpServers",
            json!({ "agent": "claude", "workspacePath": "/workspace", "launch": launch }),
            Duration::from_secs(90),
        )
        .await;
    outcome.listing = match &listed {
        Ok(result) => result.to_string(),
        Err(error) => error.clone(),
    };

    // 2. The agent calls the server: the server's prompt as a slash command makes Claude fetch it.
    // Claude takes the chat's id as its own session id, which must be a UUID.
    let session = format!(
        "{}-{}-4{}-a{}-{}",
        &decoy[..8],
        &decoy[8..12],
        &decoy[13..16],
        &decoy[17..20],
        &decoy[20..32]
    );
    let config = json!({
        "agent": "claude",
        "model": "claude-haiku-5-5",
        "effort": "low",
        "fastMode": false,
        "planMode": false,
        "requireToolApproval": false,
        "additionalDirectories": [],
        "appTools": { "diffComments": false, "progressUpdates": false, "setTargetBranch": false },
    });
    let context = json!({
        "workspaceId": format!("c17-ws-{workspace}"),
        "workspaceName": workspace,
        "workspacePath": "/workspace",
        "repoRootPath": "/workspace",
        "targetBranch": "origin/main",
        "placeholderBranch": false,
        "port": 3000,
        "host": { "kind": "cloud", "url": url, "vmId": workspace },
    });
    // The app warms a chat's agent before its first message; the warm agent has connected its MCP
    // servers by the time the slash command arrives, so the command is known.
    let warmed = relay
        .request(
            "warmAgent",
            json!({ "sessionId": session, "config": config, "workspace": context, "launch": launch }),
            Duration::from_secs(60),
        )
        .await
        .map(|result| result.to_string());
    let warm_deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < warm_deadline && seen.lock().expect("the record").count("tools/list") < 2
    {
        let _ = relay.wait_for(Duration::from_secs(2), |_| true).await;
    }
    let sent = relay
        .request(
            "sendMessage",
            json!({
                "sessionId": session,
                "messageId": "c17-message-1",
                "turnId": "c17-turn-1",
                "text": format!("/mcp__{SERVER}__{PROMPT}"),
                "attachmentPaths": [],
                "delivery": "new_turn",
                // A first message gets the workspace's instruction block in front, and the
                // slash command must lead the text.
                "firstMessage": false,
                "config": config,
                "workspace": context,
                "launch": launch,
            }),
            Duration::from_secs(120),
        )
        .await;
    // The turn ends when the server's prompt was fetched, the agent goes idle, or 120 s pass. The
    // model call after the prompt stops at the Worker (no key), and Claude retries it, so the run
    // cancels the turn rather than wait for the retries.
    let mut idle = false;
    if sent.is_ok() {
        let deadline = Instant::now() + Duration::from_secs(120);
        while Instant::now() < deadline
            && seen.lock().expect("the record").count("prompts/get") == 0
        {
            if let Ok(message) = relay.wait_for(Duration::from_secs(5), |_| true).await
                && message["method"] == "liveState"
                && message["params"]["liveState"]["status"] == "idle"
            {
                idle = true;
                break;
            }
        }
    }
    let cancelled = relay
        .request(
            "cancel",
            json!({ "sessionId": session }),
            Duration::from_secs(30),
        )
        .await
        .map(|result| result.to_string());
    // What the agent said, by its messages' text, so a refusal or an error is readable.
    let said: Vec<String> = relay
        .lines
        .iter()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|message| message["method"] == "sessionEvent")
        .map(|message| {
            let event = &message["params"]["event"];
            let text = event["message"].to_string();
            format!(
                "{}: {}",
                event["type"].as_str().unwrap_or(""),
                text.chars().take(400).collect::<String>()
            )
        })
        .collect();
    outcome.turn = format!(
        "warmed={warmed:?} sent={:?} idle={idle} cancelled={cancelled:?} prompts/get={} said={said:#?}",
        sent.as_ref().map(|result| result.to_string()),
        seen.lock().expect("the record").count("prompts/get"),
    );

    // 3. A tools/call from inside the sandbox with only the placeholder: the Worker swaps it.
    let curl = post(
        &client,
        url,
        pairing,
        &format!("/w/{workspace}/exec"),
        Some(json!({
            "program": "curl",
            "args": [
                "-s", "-o", "/dev/null", "-w", "%{http_code}",
                "-X", "POST", server_url,
                "-H", "authorization: Bearer provided-by-worker",
                "-H", "content-type: application/json",
                "-H", "accept: application/json, text/event-stream",
                "-d", json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": TOOL, "arguments": {} } }).to_string(),
            ],
            "cwd": "/workspace",
        })),
    )
    .await;
    outcome.curl_status = format!("{} {}", curl.0, curl.1);

    // 4. The token is nowhere in the sandbox: plant a decoy, scan by hash, read the counts.
    let scanned = scan_sandbox(
        &client,
        url,
        pairing,
        workspace,
        &[sha256_hex(token)],
        decoy,
    )
    .await?;
    outcome.sizing = scanned.sizing;
    outcome.scan_ms = scanned.ms;
    outcome.scan_log = scanned.log;
    outcome.scan = scanned.counts;

    outcome.relay_lines = relay.lines.len();
    outcome.relay_lines_with_token = relay
        .lines
        .iter()
        .filter(|line| line.contains(token))
        .count();
    let _ = relay.socket.close(None).await;
    Ok(())
}

/// Deletes the Worker, its container application, its images and its bucket with everything in it
/// through the app's own uninstall, then the local Docker images wrangler built for it, and says
/// what is left.
fn teardown(wrangler: &Wrangler, resources: &Path, name: &str) -> (Result<(), String>, String) {
    let removed = uninstall_worker(wrangler, &CloudflareApi::from_env(), resources, name)
        .map_err(|error| format!("{error:?}"));
    let containers = listed(wrangler, resources, &["containers", "list", "--json"]);
    let images = listed(
        wrangler,
        resources,
        &["containers", "images", "list", "--json"],
    );
    let buckets = listed(wrangler, resources, &["r2", "bucket", "list"]);
    let container_left = container_id(&containers, &format!("{name}-sandbox")).is_some();
    let images_left = image_refs(&images, name);
    let bucket_left = bucket_names(&buckets)
        .iter()
        .any(|bucket| bucket.starts_with(name));
    let mut docker_removed = Vec::new();
    if let Ok(output) = Command::new("docker")
        .args(["images", "--format", "{{.Repository}} {{.ID}}"])
        .output()
    {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Some((repository, id)) = line.split_once(' ')
                && repository.contains(name)
            {
                let gone = Command::new("docker")
                    .args(["image", "rm", "-f", id])
                    .status()
                    .is_ok_and(|status| status.success());
                docker_removed.push(format!("{repository} {id} removed={gone}"));
            }
        }
    }
    let docker_left = Command::new("docker")
        .args(["images", "--format", "{{.Repository}}"])
        .output()
        .map(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|repository| repository.contains(name))
                .count()
        })
        .unwrap_or(usize::MAX);
    let report = format!(
        "removed={removed:?} container_left={container_left} images_left={images_left:?} bucket_left={bucket_left} \
         docker_removed={docker_removed:?} docker_left={docker_left}"
    );
    let clean = !container_left && images_left.is_empty() && !bucket_left && docker_left == 0;
    let result = match (removed, clean) {
        (Ok(_), true) => Ok(()),
        (Ok(_), false) => Err(format!("left behind: {report}")),
        (Err(error), _) => Err(error),
    };
    (result, report)
}

#[test]
#[ignore = "live: deploys to the owner's Cloudflare account with Docker, then deletes everything"]
fn an_agent_in_the_sandbox_reaches_a_bearer_token_mcp_server() {
    let name = live_name();
    let resources = resources();
    assert!(
        resources.join("worker.js").is_file() && resources.join("sandbox/Dockerfile").is_file(),
        "the deploy inputs are missing: run `pnpm cloud:prepare` first"
    );
    let token = random_hex();
    let decoy = random_hex();
    let pairing = make_pairing_token().expect("a pairing token");
    let wrangler = live_wrangler();
    let workspace = format!("c17live{}", &name[name.len() - 6..]);
    let seen = Arc::new(Mutex::new(Seen::default()));
    let home = std::env::temp_dir().join(format!("{name}-tunnel-home"));
    std::fs::create_dir_all(&home).expect("the tunnel's home folder");

    let port = tauri::async_runtime::block_on(start_mcp_server(token.clone(), seen.clone()));
    let tunnel = start_tunnel(port, &home);
    let mut outcome = Outcome::default();
    let mut deploy_ms = 0u128;
    let mut deployed = false;
    let mut tunnel_child: Option<Child> = None;

    let run = std::panic::catch_unwind(AssertUnwindSafe(|| -> Result<(), String> {
        let (child, public) = tunnel.map_err(|error| error.to_string())?;
        tunnel_child = Some(child);
        let server_url = format!("{public}/mcp");
        // The quick tunnel's name takes a moment to resolve, and a lookup made before it does is
        // cached as missing, so the first probe waits.
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .map_err(|error| error.to_string())?;
            tokio::time::sleep(Duration::from_secs(20)).await;
            let mut last = String::new();
            for _ in 0..40 {
                match client.get(format!("{public}/healthz")).send().await {
                    Ok(answer) if answer.status().is_success() => return Ok(()),
                    Ok(answer) => last = format!("answered {}", answer.status()),
                    Err(error) => last = error.to_string(),
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
            Err(format!("the tunnel never answered: {last}"))
        })?;

        let began = Instant::now();
        let deploy = deploy_worker(&wrangler, &resources, &name, &pairing, &|_step| {});
        deploy_ms = began.elapsed().as_millis();
        deployed = true;
        let url = deploy.map_err(|error| format!("deploy failed: {error:?}"))?;
        tauri::async_runtime::block_on(live_steps(
            &url,
            &pairing,
            &workspace,
            &server_url,
            &token,
            &decoy,
            &seen,
            &mut outcome,
        ))
    }));
    let run = match run {
        Ok(result) => result,
        Err(_) => Err("a live step panicked".to_string()),
    };

    let began = Instant::now();
    let (removed, left) = if deployed {
        teardown(&wrangler, &resources, &name)
    } else {
        (Ok(()), String::from("nothing deployed"))
    };
    let uninstall_ms = began.elapsed().as_millis();
    if let Some(mut child) = tunnel_child {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = std::fs::remove_dir_all(&home);
    let record = seen.lock().expect("the record").clone();

    println!(
        "CLOUD-17 live: name={name} deploy_ms={deploy_ms} start_ms={} uninstall_ms={uninstall_ms}\n\
         readiness={}\nlisting={}\nturn={}\ncurl_tools_call={}\nsizing={}\nscan_ms={} scan_log={}\nscan={}\nrelay_lines={} \
         relay_lines_with_token={}\nserver_authorized={:?}\nserver_refused={:?}\nteardown={left} \
         removed={removed:?}\nrun={run:?}",
        outcome.start_ms,
        outcome.readiness,
        outcome.listing,
        outcome.turn,
        outcome.curl_status,
        outcome.sizing,
        outcome.scan_ms,
        outcome.scan_log,
        outcome.scan,
        outcome.relay_lines,
        outcome.relay_lines_with_token,
        record.authorized,
        record.refused,
    );

    assert!(removed.is_ok(), "the teardown left something: {removed:?}");
    assert!(run.is_ok(), "the live steps failed: {run:?}");
    let listing: Value = serde_json::from_str(&outcome.listing).unwrap_or(Value::Null);
    let listed = listing["servers"]
        .as_array()
        .and_then(|servers| servers.iter().find(|server| server["name"] == SERVER))
        .cloned();
    assert!(
        listed.is_some(),
        "the agent did not list {SERVER}: {}",
        outcome.listing
    );
    assert!(
        record.refused.is_empty(),
        "a request reached the server without the token: {:?}",
        record.refused
    );
    assert!(
        record.count("tools/list") >= 1,
        "the server was never listed with the token"
    );
    assert!(
        record.count("prompts/get") >= 1,
        "the agent never called the server"
    );
    assert!(
        record.count("tools/call") >= 1,
        "the sandbox's tools/call never arrived with the token"
    );
    let scan: Value = serde_json::from_str(&outcome.scan).unwrap_or(Value::Null);
    assert!(
        scan["decoy"].as_u64().unwrap_or(0) >= 1,
        "the scan missed its planted decoy"
    );
    assert!(
        scan["placeholderProcs"].as_u64().unwrap_or(0) >= 1,
        "the scan saw no placeholder"
    );
    assert_eq!(
        scan["token"].as_u64(),
        Some(0),
        "the token is in the sandbox"
    );
    assert_eq!(
        outcome.relay_lines_with_token, 0,
        "the token reached the agent's lines"
    );
}

// ---------------------------------------------------------------- the OAuth provider and its MCP server

const OAUTH_SERVER: &str = "c17oauth";
/// How long an access token lives. The Worker refreshes one that has less than 60 s left, so a
/// token is refreshed 30 s after it was issued.
const ACCESS_SECONDS: u64 = 90;

/// One authorization code: who asked for it, where it goes back to, the PKCE challenge, the resource.
struct Code {
    client: String,
    redirect: String,
    challenge: String,
    resource: String,
}

/// The provider's state: its public URL, registered clients, codes, the tokens valid now with
/// their expiry, every token it ever issued (for the scan), and the grants it was asked for.
#[derive(Default)]
struct Provider {
    public: String,
    clients: Vec<(String, Vec<String>)>,
    codes: std::collections::HashMap<String, Code>,
    access: Vec<(String, Instant)>,
    refresh: Vec<String>,
    issued: Vec<String>,
    grants: Vec<String>,
    refused_grants: Vec<String>,
    seen: Seen,
}

impl Provider {
    fn issue(&mut self) -> Value {
        let access = random_hex();
        let refresh = random_hex();
        self.access.push((
            access.clone(),
            Instant::now() + Duration::from_secs(ACCESS_SECONDS),
        ));
        self.refresh.push(refresh.clone());
        self.issued.push(access.clone());
        self.issued.push(refresh.clone());
        json!({ "access_token": access, "token_type": "Bearer", "expires_in": ACCESS_SECONDS, "refresh_token": refresh })
    }
}

fn base64url(bytes: &[u8]) -> String {
    use base64::Engine as _;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// The pairs of an `application/x-www-form-urlencoded` body or a query string.
fn form_pairs(text: &str) -> std::collections::HashMap<String, String> {
    reqwest::Url::parse(&format!("http://form.invalid/?{text}"))
        .map(|url| url.query_pairs().into_owned().collect())
        .unwrap_or_default()
}

fn redirect_response(location: &str) -> Vec<u8> {
    format!(
        "HTTP/1.1 302 Found\r\nlocation: {location}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
    )
    .into_bytes()
}

/// One request to the provider: its metadata, registration, authorization, token endpoint, and the
/// MCP server, which answers only an access token that is valid now. Tokens are compared, never logged.
fn provider_answer(
    provider: &mut Provider,
    method: &str,
    target: &str,
    headers: &[(String, String)],
    body: &[u8],
) -> Vec<u8> {
    let public = provider.public.clone();
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let ok_json = |value: Value| http_response("200 OK", "application/json", &value.to_string());
    match (method, path) {
        ("GET", "/healthz") => http_response("200 OK", "text/plain", "ok"),
        ("GET", "/.well-known/oauth-protected-resource/mcp") => ok_json(json!({
            "resource": format!("{public}/mcp"),
            "authorization_servers": [public],
        })),
        ("GET", "/.well-known/oauth-authorization-server") => ok_json(json!({
            "issuer": public,
            "authorization_endpoint": format!("{public}/authorize"),
            "token_endpoint": format!("{public}/token"),
            "registration_endpoint": format!("{public}/register"),
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none"],
        })),
        ("POST", "/register") => {
            let parsed: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
            let redirects: Vec<String> = parsed["redirect_uris"]
                .as_array()
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default();
            let id = format!("client-{}", &random_hex()[..12]);
            provider.clients.push((id.clone(), redirects.clone()));
            http_response(
                "201 Created",
                "application/json",
                &json!({ "client_id": id, "redirect_uris": redirects }).to_string(),
            )
        }
        ("GET", "/authorize") => {
            let params = form_pairs(query);
            let get = |key: &str| params.get(key).cloned().unwrap_or_default();
            let client = get("client_id");
            let redirect = get("redirect_uri");
            let known = provider
                .clients
                .iter()
                .any(|(id, redirects)| *id == client && redirects.contains(&redirect));
            if !known || get("code_challenge_method") != "S256" || get("response_type") != "code" {
                return http_response("400 Bad Request", "text/plain", "bad authorization request");
            }
            let code = random_hex();
            provider.codes.insert(
                code.clone(),
                Code {
                    client,
                    redirect: redirect.clone(),
                    challenge: get("code_challenge"),
                    resource: get("resource"),
                },
            );
            let mut back = match reqwest::Url::parse(&redirect) {
                Ok(url) => url,
                Err(_) => return http_response("400 Bad Request", "text/plain", "bad redirect"),
            };
            back.query_pairs_mut()
                .append_pair("code", &code)
                .append_pair("state", &get("state"))
                .append_pair("iss", &public);
            redirect_response(back.as_str())
        }
        ("POST", "/token") => {
            let form = form_pairs(&String::from_utf8_lossy(body));
            let get = |key: &str| form.get(key).cloned().unwrap_or_default();
            let grant = get("grant_type");
            provider.grants.push(grant.clone());
            let refuse = |provider: &mut Provider, why: &str| {
                provider.refused_grants.push(format!("{grant}: {why}"));
                http_response(
                    "400 Bad Request",
                    "application/json",
                    &json!({ "error": "invalid_grant", "error_description": why }).to_string(),
                )
            };
            if grant == "authorization_code" {
                let Some(code) = provider.codes.remove(&get("code")) else {
                    return refuse(provider, "unknown code");
                };
                let verifier_ok =
                    base64url(&Sha256::digest(get("code_verifier").as_bytes())) == code.challenge;
                if code.client != get("client_id")
                    || code.redirect != get("redirect_uri")
                    || code.resource != get("resource")
                    || !verifier_ok
                {
                    return refuse(provider, "the code does not match");
                }
                return ok_json(provider.issue());
            }
            if grant == "refresh_token" {
                let token = get("refresh_token");
                let Some(at) = provider.refresh.iter().position(|held| *held == token) else {
                    return refuse(provider, "the refresh token was spent or is unknown");
                };
                // Rotation: the old refresh token is spent once.
                provider.refresh.remove(at);
                return ok_json(provider.issue());
            }
            refuse(provider, "unsupported grant")
        }
        (_, "/mcp") => {
            let now = Instant::now();
            let authorized = headers.iter().any(|(name, value)| {
                name == "authorization"
                    && value.strip_prefix("Bearer ").is_some_and(|token| {
                        provider
                            .access
                            .iter()
                            .any(|(held, until)| held == token && *until > now)
                    })
            });
            let parsed: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
            let messages: Vec<Value> = match parsed {
                Value::Array(items) => items,
                Value::Null => Vec::new(),
                other => vec![other],
            };
            let names: Vec<String> = if messages.is_empty() {
                vec![format!("{method} {path}")]
            } else {
                messages
                    .iter()
                    .map(|message| message["method"].as_str().unwrap_or("").to_string())
                    .collect()
            };
            if authorized {
                provider.seen.authorized.extend(names);
            } else {
                provider.seen.refused.extend(names);
                let challenge = format!(
                    "HTTP/1.1 401 Unauthorized\r\nwww-authenticate: Bearer resource_metadata=\"{public}/.well-known/oauth-protected-resource/mcp\"\r\ncontent-type: application/json\r\ncontent-length: 26\r\nconnection: close\r\n\r\n{{\"error\":\"unauthorized\"}}"
                );
                return challenge.into_bytes();
            }
            if method != "POST" {
                return http_response("405 Method Not Allowed", "text/plain", "");
            }
            let answers: Vec<Value> = messages.iter().filter_map(mcp_answer).collect();
            match answers.len() {
                0 => http_response("202 Accepted", "application/json", ""),
                1 => http_response("200 OK", "application/json", &answers[0].to_string()),
                _ => http_response(
                    "200 OK",
                    "application/json",
                    &Value::Array(answers).to_string(),
                ),
            }
        }
        _ => http_response("404 Not Found", "text/plain", "not found"),
    }
}

/// Serves the provider on 127.0.0.1 and returns its port.
async fn start_provider(provider: Arc<Mutex<Provider>>) -> u16 {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("a loopback port");
    let port = listener.local_addr().expect("the bound port").port();
    tauri::async_runtime::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                break;
            };
            let provider = provider.clone();
            tauri::async_runtime::spawn(async move {
                let Some((first, headers, body)) = read_request(&mut stream).await else {
                    return;
                };
                let method = first.split(' ').next().unwrap_or("").to_string();
                let target = first.split(' ').nth(1).unwrap_or("").to_string();
                let reply = {
                    let mut held = provider.lock().expect("the provider");
                    provider_answer(&mut held, &method, &target, &headers, &body)
                };
                let _ = stream.write_all(&reply).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    port
}

#[derive(Debug, Default)]
struct OAuthOutcome {
    readiness: String,
    connect: String,
    callback: String,
    credentials: String,
    credentials_hold_a_token: bool,
    start_ms: u128,
    listing: String,
    first_call: String,
    after_refresh_call: String,
    scan_ms: u128,
    scan_log: String,
    scan: String,
    relay_lines: usize,
    relay_lines_with_token: usize,
}

async fn oauth_live_steps(
    url: &str,
    pairing: &str,
    workspace: &str,
    server_url: &str,
    decoy: &str,
    provider: &Arc<Mutex<Provider>>,
    outcome: &mut OAuthOutcome,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| error.to_string())?;
    // The browser: it follows nothing by itself, so each hop is checked.
    let browser = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;

    let (mut status, mut body) = get(&client, url, pairing, "/readiness").await;
    for _ in 0..20 {
        if status == 200 {
            break;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
        (status, body) = get(&client, url, pairing, "/readiness").await;
    }
    outcome.readiness = format!("{status} {body}");
    let readiness: Value = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    if readiness["agents"]["anthropic"] != json!(false) {
        return Err("the Worker holds a model key; stopping before any model call".into());
    }

    // 1. Save the server as OAuth, connect it, and sign in as the browser would.
    let settings = json!({
        "gitIdentity": null,
        "envVars": {},
        "mcpServers": { OAUTH_SERVER: { "url": server_url, "authType": "oauth" } },
    });
    let (status, _) = post(&client, url, pairing, "/settings", Some(settings)).await;
    if status != 200 {
        return Err(format!("settings answered {status}"));
    }
    let (status, body) = post(
        &client,
        url,
        pairing,
        &format!("/mcp-oauth/{OAUTH_SERVER}/connect"),
        None,
    )
    .await;
    outcome.connect = format!("{status}");
    if status != 200 {
        return Err(format!("connect answered {status}: {body}"));
    }
    let started: Value = serde_json::from_str(&body).map_err(|error| error.to_string())?;
    let authorization = started["authorizationUrl"]
        .as_str()
        .unwrap_or("")
        .to_string();
    let state = started["state"].as_str().unwrap_or("").to_string();
    let (status, body) = get(
        &client,
        url,
        pairing,
        &format!("/mcp-oauth/{OAUTH_SERVER}/status?state={state}"),
    )
    .await;
    if status != 200 || !body.contains("pending") {
        return Err(format!("the connect is not pending: {status} {body}"));
    }
    let to_provider = browser
        .get(&authorization)
        .send()
        .await
        .map_err(|error| format!("the authorization page: {error}"))?;
    let callback = to_provider
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
        .ok_or("the provider sent the browser nowhere")?;
    if !callback.starts_with(&format!("{url}/mcp-oauth/callback?")) {
        return Err("the provider's redirect is not the Worker's callback".into());
    }
    // The browser carries no pairing token back to the Worker.
    let mut page_status = 0;
    let mut page_text = String::new();
    for _ in 0..20 {
        let page = browser
            .get(&callback)
            .send()
            .await
            .map_err(|error| format!("the callback: {error}"))?;
        page_status = page.status().as_u16();
        page_text = page.text().await.unwrap_or_default();
        if !not_yet_routed(page_status, &page_text) {
            break;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    outcome.callback = format!(
        "{page_status} connected={}",
        page_text.contains("is connected")
    );
    if page_status != 200 {
        return Err(format!("the callback answered {page_status}"));
    }
    let (status, body) = get(&client, url, pairing, "/mcp-oauth").await;
    outcome.credentials = format!("{status} {}", {
        let parsed: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        parsed["servers"].to_string()
    });
    outcome.credentials_hold_a_token = provider
        .lock()
        .expect("the provider")
        .issued
        .iter()
        .any(|token| body.contains(token));

    // 2. A sandbox starts, and its agent lists the server through the Worker.
    let began = Instant::now();
    let mut started = false;
    let mut last = String::new();
    for _ in 0..3 {
        let (status, body) = post(
            &client,
            url,
            pairing,
            &format!("/w/{workspace}/start"),
            None,
        )
        .await;
        if status == 200 {
            started = true;
            break;
        }
        last = format!("start answered {status}: {body}");
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    outcome.start_ms = began.elapsed().as_millis();
    if !started {
        return Err(last);
    }
    let launch = json!({
        "env": {},
        "providerKeys": { "ANTHROPIC_API_KEY": { "value": "provided-by-worker", "source": "entered" } },
    });
    let mut relay = Relay::open(url, pairing, workspace).await?;
    let listed = relay
        .request(
            "listMcpServers",
            json!({ "agent": "claude", "workspacePath": "/workspace", "launch": launch }),
            Duration::from_secs(90),
        )
        .await;
    outcome.listing = match &listed {
        Ok(result) => result.to_string(),
        Err(error) => error.clone(),
    };

    // 3. A tools/call from the sandbox with only the placeholder, then again after the access
    // token is due for its refresh: the Worker refreshes it and sends the new one.
    let tools_call = || {
        json!({
            "program": "curl",
            "args": [
                "-s", "-o", "/dev/null", "-w", "%{http_code}",
                "-X", "POST", server_url,
                "-H", "authorization: Bearer provided-by-worker",
                "-H", "content-type: application/json",
                "-H", "accept: application/json, text/event-stream",
                "-d", json!({ "jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": { "name": TOOL, "arguments": {} } }).to_string(),
            ],
            "cwd": "/workspace",
        })
    };
    let first = post(
        &client,
        url,
        pairing,
        &format!("/w/{workspace}/exec"),
        Some(tools_call()),
    )
    .await;
    outcome.first_call = format!("{} {}", first.0, first.1);
    // The newest token was issued at most now; 35 s on it is inside the Worker's refresh margin.
    tokio::time::sleep(Duration::from_secs(ACCESS_SECONDS - 55)).await;
    let second = post(
        &client,
        url,
        pairing,
        &format!("/w/{workspace}/exec"),
        Some(tools_call()),
    )
    .await;
    outcome.after_refresh_call = format!("{} {}", second.0, second.1);

    // 4. No token the provider issued is anywhere in the sandbox.
    let hashes: Vec<String> = provider
        .lock()
        .expect("the provider")
        .issued
        .iter()
        .map(|token| sha256_hex(token))
        .collect();
    let scanned = scan_sandbox(&client, url, pairing, workspace, &hashes, decoy).await?;
    outcome.scan_ms = scanned.ms;
    outcome.scan_log = scanned.log;
    outcome.scan = scanned.counts;

    let issued = provider.lock().expect("the provider").issued.clone();
    outcome.relay_lines = relay.lines.len();
    outcome.relay_lines_with_token = relay
        .lines
        .iter()
        .filter(|line| issued.iter().any(|token| line.contains(token)))
        .count();
    let _ = relay.socket.close(None).await;
    Ok(())
}

#[test]
#[ignore = "live: deploys to the owner's Cloudflare account with Docker, then deletes everything"]
fn an_agent_in_the_sandbox_reaches_an_oauth_mcp_server() {
    let name = live_name();
    let resources = resources();
    assert!(
        resources.join("worker.js").is_file() && resources.join("sandbox/Dockerfile").is_file(),
        "the deploy inputs are missing: run `pnpm cloud:prepare` first"
    );
    let decoy = random_hex();
    let pairing = make_pairing_token().expect("a pairing token");
    let wrangler = live_wrangler();
    let workspace = format!("c17oauth{}", &name[name.len() - 6..]);
    let provider = Arc::new(Mutex::new(Provider::default()));
    let home = std::env::temp_dir().join(format!("{name}-oauth-tunnel-home"));
    std::fs::create_dir_all(&home).expect("the tunnel's home folder");

    let port = tauri::async_runtime::block_on(start_provider(provider.clone()));
    let tunnel = start_tunnel(port, &home);
    let mut outcome = OAuthOutcome::default();
    let mut deployed = false;
    let mut tunnel_child: Option<Child> = None;

    let run = std::panic::catch_unwind(AssertUnwindSafe(|| -> Result<(), String> {
        let (child, public) = tunnel.map_err(|error| error.to_string())?;
        tunnel_child = Some(child);
        provider.lock().expect("the provider").public = public.clone();
        let server_url = format!("{public}/mcp");
        tauri::async_runtime::block_on(async {
            let client = reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .map_err(|error| error.to_string())?;
            tokio::time::sleep(Duration::from_secs(20)).await;
            let mut last = String::new();
            for _ in 0..40 {
                match client.get(format!("{public}/healthz")).send().await {
                    Ok(answer) if answer.status().is_success() => return Ok(()),
                    Ok(answer) => last = format!("answered {}", answer.status()),
                    Err(error) => last = error.to_string(),
                }
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
            Err(format!("the tunnel never answered: {last}"))
        })?;
        let deploy = deploy_worker(&wrangler, &resources, &name, &pairing, &|_step| {});
        deployed = true;
        let url = deploy.map_err(|error| format!("deploy failed: {error:?}"))?;
        tauri::async_runtime::block_on(oauth_live_steps(
            &url,
            &pairing,
            &workspace,
            &server_url,
            &decoy,
            &provider,
            &mut outcome,
        ))
    }));
    let run = match run {
        Ok(result) => result,
        Err(_) => Err("a live step panicked".to_string()),
    };

    let (removed, left) = if deployed {
        teardown(&wrangler, &resources, &name)
    } else {
        (Ok(()), String::from("nothing deployed"))
    };
    if let Some(mut child) = tunnel_child {
        let _ = child.kill();
        let _ = child.wait();
    }
    let _ = std::fs::remove_dir_all(&home);
    let held = provider.lock().expect("the provider");

    println!(
        "CLOUD-17 OAuth live: name={name} start_ms={}\nreadiness={}\nconnect={} callback={}\ncredentials={} \
         credentials_hold_a_token={}\nlisting={}\nfirst_call={}\nafter_refresh_call={}\ngrants={:?} refused_grants={:?} \
         registrations={} tokens_issued={}\nscan_ms={} scan_log={}\nscan={}\nrelay_lines={} relay_lines_with_token={}\n\
         server_authorized={:?}\nserver_refused={:?}\nteardown={left} removed={removed:?}\nrun={run:?}",
        outcome.start_ms,
        outcome.readiness,
        outcome.connect,
        outcome.callback,
        outcome.credentials,
        outcome.credentials_hold_a_token,
        outcome.listing,
        outcome.first_call,
        outcome.after_refresh_call,
        held.grants,
        held.refused_grants,
        held.clients.len(),
        held.issued.len(),
        outcome.scan_ms,
        outcome.scan_log,
        outcome.scan,
        outcome.relay_lines,
        outcome.relay_lines_with_token,
        held.seen.authorized,
        held.seen.refused,
    );

    assert!(removed.is_ok(), "the teardown left something: {removed:?}");
    assert!(run.is_ok(), "the live steps failed: {run:?}");
    assert!(
        outcome.callback.starts_with("200 connected=true"),
        "the callback did not connect: {}",
        outcome.callback
    );
    assert!(
        outcome.credentials.contains("\"active\""),
        "the Worker does not list the server as connected: {}",
        outcome.credentials
    );
    assert!(
        !outcome.credentials_hold_a_token,
        "the desktop's answer held a token"
    );
    let listing: Value = serde_json::from_str(&outcome.listing).unwrap_or(Value::Null);
    assert!(
        listing["servers"]
            .as_array()
            .is_some_and(|servers| servers.iter().any(|server| server["name"] == OAUTH_SERVER)),
        "the agent did not list {OAUTH_SERVER}: {}",
        outcome.listing
    );
    assert!(
        held.seen
            .authorized
            .iter()
            .any(|method| method == "tools/list"),
        "the agent never listed the server's tools with a token"
    );
    assert!(
        outcome.first_call.contains("\"stdout\":\"200\"")
            && outcome.after_refresh_call.contains("\"stdout\":\"200\""),
        "the sandbox's calls were not answered: {} / {}",
        outcome.first_call,
        outcome.after_refresh_call
    );
    assert!(
        held.grants.iter().any(|grant| grant == "refresh_token"),
        "the Worker never refreshed the token: {:?}",
        held.grants
    );
    assert!(
        held.refused_grants.is_empty(),
        "the provider refused a grant (a refresh token spent twice?): {:?}",
        held.refused_grants
    );
    // The only request without a token is the Worker's own discovery probe, an `initialize` it
    // sends unauthenticated to read the server's challenge.
    assert!(
        held.seen
            .refused
            .iter()
            .all(|method| method == "initialize"),
        "a request other than the discovery probe reached the server without a token: {:?}",
        held.seen.refused
    );
    let scan: Value = serde_json::from_str(&outcome.scan).unwrap_or(Value::Null);
    assert!(
        scan["decoy"].as_u64().unwrap_or(0) >= 1,
        "the scan missed its planted decoy"
    );
    assert_eq!(scan["token"].as_u64(), Some(0), "a token is in the sandbox");
    assert_eq!(
        outcome.relay_lines_with_token, 0,
        "a token reached the agent's lines"
    );
}

/// Removes every `conducted-dev-c17l-` deployment a killed run left, by the container
/// applications wrangler lists.
#[test]
#[ignore = "live: removes leftover conducted-dev-c17l- deployments from the owner's account"]
fn remove_leftover_c17_deployments() {
    let resources = resources();
    let wrangler = live_wrangler();
    let containers = listed(&wrangler, &resources, &["containers", "list", "--json"]);
    let parsed: Value = serde_json::from_str(&containers).unwrap_or(Value::Null);
    let names: Vec<String> = parsed
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item["name"].as_str())
                .filter(|container| container.starts_with(PREFIX))
                .filter_map(|container| container.strip_suffix("-sandbox"))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let mut failed = Vec::new();
    for name in &names {
        let (removed, left) = teardown(&wrangler, &resources, name);
        println!("removed {name}: {removed:?} {left}");
        if removed.is_err() {
            failed.push(name.clone());
        }
    }
    assert!(failed.is_empty(), "these were not removed: {failed:?}");
    println!("leftover deployments removed: {}", names.len());
    let after = listed(&wrangler, &resources, &["containers", "list", "--json"]);
    let left = serde_json::from_str::<Value>(&after)
        .ok()
        .and_then(|parsed| parsed.as_array().cloned())
        .map(|items| {
            items
                .iter()
                .filter(|item| {
                    item["name"]
                        .as_str()
                        .is_some_and(|name| name.starts_with(PREFIX))
                })
                .count()
        });
    assert_eq!(
        left,
        Some(0),
        "conducted-dev-c17l- container applications are still listed"
    );
}
