//! @feature PLAT-30 HTTP from Rust: fetch and download with progress, checksum, cancel
//!
//! Owns: the Rust-side HTTP client the web view uses when it cannot use fetch itself: a request
//! that returns status, headers and body; a download that streams to a temporary file, reports
//! progress, verifies a SHA-256 and moves the file into place only when it matches; and the cancel
//! handle for a download that is running.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`native_http.rs`: progress,
//! cancel, proxy and an allow-list; used because the web view cannot stream downloads) and
//! services-map.md 1.1 (the Platform object's `http` group).
//!
//! Must handle:
//! - The request goes through the system proxy settings, which reqwest reads by default.
//! - Every request, including each redirect, is on the https allow-list. A lookalike host, a
//!   plain-http remote host, a user name or password in the URL, or a non-standard port is
//!   refused with `http_url_not_allowed`. Loopback is allowed over http for the local test server.
//! - A fetch returns the status and body even for 4xx and 5xx, so the caller can read the
//!   service's error. Only a network failure, a bad URL or a body over `MAX_FETCH_BYTES` is an Err.
//! - A download writes to a hidden temporary file beside the destination and renames it into
//!   place only after the hash matches, so a failure, a cancel or a checksum mismatch leaves no
//!   partial file at the destination. The destination must sit in a folder the web view may reach.
//! - A download reports its received bytes and total after every chunk. A progress message that
//!   cannot reach the web view fails the download.
//! - A cancel stops a download at any point, also while it connects or waits for the answer.
//! - `http_cancel` may reach Rust before `http_download` has registered its id, because the web
//!   view sends both at once. A cancel for an id that is not running is kept, and a download that
//!   registers that id later stops before it connects. The newest `MAX_EARLY_CANCELS` such cancels
//!   are kept; older ones are dropped. `http_cancel` succeeds whether or not the id is running.
//! - A non-2xx answer fails a download with `http_status` and removes the temporary file.
//! - A fetch that runs past its timeout fails with `http_timeout`. A download fails with
//!   `http_timeout` when connecting, waiting for the answer or waiting for the next bytes takes
//!   longer than `DOWNLOAD_STALL_TIMEOUT_MS`. An expected hash that is not 64 hexadecimal
//!   characters is `http_checksum_invalid`, checked before any network request.
//!
//! Our design choice: the allow-list names only the hosts the app itself needs: Linear's API
//! (the first fetch caller) and the vendors' official release hosts the agent and helper program
//! downloads use (D021, D024). GitHub's API and features still go through `gh`; `github.com` here
//! is only for release assets.
//! Our design choice: the download id is made in the web view, so the web view can cancel a
//! download before `http_download` has answered.
//!
//! Test first: a download whose SHA-256 does not match fails with `http_checksum_mismatch` and
//! leaves no file at the destination.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::redirect::Policy;
use reqwest::{Client, Method, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

use crate::error::{CommandError, CommandResult};

/// Hosts the app may reach over native HTTP. Release assets for the helper programs and the agent
/// programs come from the vendors' own hosts; GitHub's API stays on `gh` (D024, D029).
pub const ALLOWED_HOSTS: &[&str] = &[
    "api.linear.app",
    "claude.ai",
    "downloads.cursor.com",
    "github.com",
    "objects.githubusercontent.com",
    "registry.npmjs.org",
    "release-assets.githubusercontent.com",
    "storage.googleapis.com",
];

/// Largest response body a fetch will load into memory.
pub const MAX_FETCH_BYTES: usize = 32 * 1024 * 1024;

/// How long a fetch may take when the request does not say.
pub const DEFAULT_FETCH_TIMEOUT_MS: u64 = 30_000;

/// How long a download may wait to connect, for the answer, or for its next bytes.
pub const DOWNLOAD_STALL_TIMEOUT_MS: u64 = 30_000;

/// How many cancels for downloads that have not registered yet are kept. Such a cancel waits only
/// for the moment between the web view sending `http_download` and Rust registering its id.
pub const MAX_EARLY_CANCELS: usize = 64;

/// Makes each temporary download name unique within the process.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// One request from the web view. Mirrors `HttpRequest` in platform.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequestInput {
    pub url: String,
    pub method: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

/// A response to a fetch. Mirrors `HttpResponse` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponsePayload {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// A finished download. Mirrors `HttpDownload.done` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOutcome {
    pub path: String,
    pub size_bytes: u64,
    pub sha256: String,
}

/// One progress message. Mirrors `onProgress` in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
}

/// The running downloads by the id the web view chose, and the cancels that arrived before their
/// download registered.
#[derive(Default)]
pub struct DownloadRegistry {
    running: HashMap<String, CancellationToken>,
    cancelled_early: VecDeque<String>,
}

impl DownloadRegistry {
    /// Registers a download and returns its cancel token. The token is already cancelled when a
    /// cancel for this id arrived first.
    fn begin(&mut self, id: &str) -> CommandResult<CancellationToken> {
        if self.running.contains_key(id) {
            return Err(CommandError::Failed {
                code: "http_duplicate_id",
                message: format!("A download with the id {id} is already running."),
            });
        }
        let token = CancellationToken::new();
        if let Some(index) = self.cancelled_early.iter().position(|early| early == id) {
            self.cancelled_early.remove(index);
            token.cancel();
        }
        self.running.insert(id.to_string(), token.clone());
        Ok(token)
    }

    /// Cancels a running download, or keeps the cancel for a download that has not registered.
    fn cancel(&mut self, id: &str) {
        if let Some(token) = self.running.get(id) {
            token.cancel();
            return;
        }
        if self.cancelled_early.iter().any(|early| early == id) {
            return;
        }
        self.cancelled_early.push_back(id.to_string());
        if self.cancelled_early.len() > MAX_EARLY_CANCELS {
            self.cancelled_early.pop_front();
        }
    }

    /// Forgets a download that ended, however it ended.
    fn finish(&mut self, id: &str) {
        self.running.remove(id);
    }
}

/// The download registry the commands share.
#[derive(Default)]
pub struct HttpState {
    downloads: Mutex<DownloadRegistry>,
}

fn lock_downloads(state: &HttpState) -> CommandResult<MutexGuard<'_, DownloadRegistry>> {
    state.downloads.lock().map_err(|_| CommandError::Failed {
        code: "http_state_poisoned",
        message: "The list of running downloads could not be read after a panic.".to_string(),
    })
}

/// Reads an allowed URL. The host must match an entry exactly, so a lookalike cannot pass.
pub fn check_url(text: &str, allowed_hosts: &[&str]) -> CommandResult<Url> {
    let url = Url::parse(text).map_err(|error| CommandError::Failed {
        code: "http_invalid_url",
        message: format!("The URL could not be read: {error}"),
    })?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(url_not_allowed(
            "URLs with a user name or password are refused.",
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| url_not_allowed("The URL has no host."))?;
    let loopback = matches!(host, "127.0.0.1" | "localhost" | "[::1]" | "::1");
    let scheme_ok = url.scheme() == "https" || (url.scheme() == "http" && loopback);
    if !scheme_ok {
        return Err(url_not_allowed(&format!(
            "Only https is allowed, not {}.",
            url.scheme()
        )));
    }
    if url.scheme() == "https"
        && let Some(port) = url.port()
        && port != 443
    {
        return Err(url_not_allowed(&format!("Port {port} is not allowed.")));
    }
    if !allowed_hosts
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(host))
    {
        return Err(url_not_allowed(&format!(
            "{host} is not on the allow-list."
        )));
    }
    Ok(url)
}

fn url_not_allowed(message: &str) -> CommandError {
    CommandError::Failed {
        code: "http_url_not_allowed",
        message: message.to_string(),
    }
}

fn method_from(text: &str) -> CommandResult<Method> {
    match text {
        "GET" => Ok(Method::GET),
        "POST" => Ok(Method::POST),
        "PUT" => Ok(Method::PUT),
        "PATCH" => Ok(Method::PATCH),
        "DELETE" => Ok(Method::DELETE),
        other => Err(CommandError::Failed {
            code: "http_invalid_method",
            message: format!("{other} is not an HTTP method this app sends."),
        }),
    }
}

/// The client follows a redirect only when the next URL passes the same allow-list. With a stall
/// timeout, connecting and every read (the answer's head and each body chunk) may each take at
/// most that long.
fn build_client(allowed_hosts: &[&str], stall_timeout: Option<Duration>) -> CommandResult<Client> {
    let redirect_allowed: Vec<String> = allowed_hosts
        .iter()
        .map(|host| (*host).to_string())
        .collect();
    let policy = Policy::custom(move |attempt| {
        let hosts: Vec<&str> = redirect_allowed.iter().map(String::as_str).collect();
        match check_url(attempt.url().as_str(), &hosts) {
            Ok(_) => attempt.follow(),
            Err(error) => attempt.error(format!("The redirect was refused: {error}")),
        }
    });
    let mut builder = Client::builder().redirect(policy);
    if let Some(stall_timeout) = stall_timeout {
        builder = builder
            .connect_timeout(stall_timeout)
            .read_timeout(stall_timeout);
    }
    builder.build().map_err(|error| CommandError::Failed {
        code: "http_client_failed",
        message: format!("The HTTP client could not start: {}", error.without_url()),
    })
}

fn network_error(error: reqwest::Error) -> CommandError {
    CommandError::Failed {
        code: if error.is_timeout() {
            "http_timeout"
        } else {
            "http_request_failed"
        },
        message: format!("The request failed: {}", error.without_url()),
    }
}

fn response_headers(
    headers: &reqwest::header::HeaderMap,
) -> CommandResult<HashMap<String, String>> {
    let mut collected: HashMap<String, String> = HashMap::new();
    for (name, value) in headers {
        let text = value.to_str().map_err(|_| CommandError::Failed {
            code: "http_header_not_text",
            message: format!("The response header {} is not text.", name.as_str()),
        })?;
        collected
            .entry(name.as_str().to_string())
            .and_modify(|existing| {
                existing.push_str(", ");
                existing.push_str(text);
            })
            .or_insert_with(|| text.to_string());
    }
    Ok(collected)
}

async fn fetch_request(
    allowed_hosts: &[&str],
    request: HttpRequestInput,
) -> CommandResult<HttpResponsePayload> {
    let url = check_url(&request.url, allowed_hosts)?;
    let method = method_from(&request.method)?;
    let client = build_client(allowed_hosts, None)?;
    let mut builder = client.request(method, url);
    if let Some(headers) = request.headers.as_ref() {
        for (name, value) in headers {
            builder = builder.header(name.as_str(), value.as_str());
        }
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }
    let timeout = request.timeout_ms.unwrap_or(DEFAULT_FETCH_TIMEOUT_MS);
    let response = builder
        .timeout(Duration::from_millis(timeout))
        .send()
        .await
        .map_err(network_error)?;
    let status = response.status().as_u16();
    let headers = response_headers(response.headers())?;
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(network_error)?;
        if body.len().saturating_add(chunk.len()) > MAX_FETCH_BYTES {
            return Err(CommandError::Failed {
                code: "http_response_too_large",
                message: format!("The response is larger than {MAX_FETCH_BYTES} bytes."),
            });
        }
        body.extend_from_slice(&chunk);
    }
    let body = String::from_utf8(body).map_err(|_| CommandError::Failed {
        code: "http_body_not_utf8",
        message: "The response body is not UTF-8 text.".to_string(),
    })?;
    Ok(HttpResponsePayload {
        status,
        headers,
        body,
    })
}

fn parse_sha256(text: &str) -> CommandResult<String> {
    let value = text.trim().to_ascii_lowercase();
    if value.len() != 64 || !value.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err(CommandError::Failed {
            code: "http_checksum_invalid",
            message: "A SHA-256 checksum must be 64 hexadecimal characters.".to_string(),
        });
    }
    Ok(value)
}

fn digest_hex(digest: impl AsRef<[u8]>) -> String {
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}", byte = *byte))
        .collect()
}

fn invalid_destination(destination: &Path) -> CommandError {
    CommandError::Failed {
        code: "http_destination_invalid",
        message: format!("The download path is not a file: {}", destination.display()),
    }
}

/// A temporary download that removes itself unless it was moved into place.
struct TempFile {
    path: PathBuf,
    keep: bool,
}

impl TempFile {
    fn new(destination: &Path) -> CommandResult<Self> {
        let name = destination
            .file_name()
            .ok_or_else(|| invalid_destination(destination))?;
        let parent = destination
            .parent()
            .ok_or_else(|| invalid_destination(destination))?;
        let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(
            ".{}.part-{}-{counter}",
            name.to_string_lossy(),
            std::process::id()
        ));
        Ok(Self { path, keep: false })
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        if self.keep {
            return;
        }
        if let Err(error) = std::fs::remove_file(&self.path)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            eprintln!(
                "could not remove the temporary download {}: {error}",
                self.path.display()
            );
        }
    }
}

fn cancelled_error() -> CommandError {
    CommandError::Failed {
        code: "http_cancelled",
        message: "The download was cancelled.".to_string(),
    }
}

async fn download_request(
    allowed_hosts: &[&str],
    url_text: &str,
    destination: &Path,
    expected_sha256: Option<&str>,
    stall_timeout: Duration,
    cancel: CancellationToken,
    mut progress: impl FnMut(u64, Option<u64>) -> CommandResult<()>,
) -> CommandResult<DownloadOutcome> {
    let expected = match expected_sha256 {
        Some(text) => Some(parse_sha256(text)?),
        None => None,
    };
    let url = check_url(url_text, allowed_hosts)?;
    let parent = destination
        .parent()
        .ok_or_else(|| invalid_destination(destination))?;
    let metadata = tokio::fs::metadata(parent)
        .await
        .map_err(|error| CommandError::Failed {
            code: "http_destination_missing",
            message: format!(
                "The download folder {} cannot be read: {error}",
                parent.display()
            ),
        })?;
    if !metadata.is_dir() {
        return Err(CommandError::Failed {
            code: "http_destination_missing",
            message: format!("The download folder {} is not a folder.", parent.display()),
        });
    }
    let mut temp = TempFile::new(destination)?;
    let client = build_client(allowed_hosts, Some(stall_timeout))?;
    // The cancel goes first, so a cancel that came before the download started stops it before it
    // connects, and a cancel during connecting is not held up until the server answers.
    let response = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(cancelled_error()),
        sent = client.get(url).send() => sent.map_err(network_error)?,
    };
    let status = response.status();
    if !status.is_success() {
        return Err(CommandError::Failed {
            code: "http_status",
            message: format!("The server answered {} for the download.", status.as_u16()),
        });
    }
    let total = response.content_length();
    let mut file =
        tokio::fs::File::create(&temp.path)
            .await
            .map_err(|error| CommandError::Failed {
                code: "http_destination_missing",
                message: format!(
                    "The temporary download {} cannot be written: {error}",
                    temp.path.display()
                ),
            })?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let mut received: u64 = 0;
    progress(0, total)?;
    loop {
        let next = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(cancelled_error()),
            next = stream.next() => next,
        };
        let Some(chunk) = next else {
            break;
        };
        let chunk = chunk.map_err(network_error)?;
        file.write_all(&chunk)
            .await
            .map_err(|error| CommandError::Failed {
                code: "http_destination_missing",
                message: format!(
                    "The temporary download {} cannot be written: {error}",
                    temp.path.display()
                ),
            })?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        progress(received, total)?;
    }
    file.flush().await.map_err(|error| CommandError::Failed {
        code: "http_destination_missing",
        message: format!(
            "The temporary download {} cannot be written: {error}",
            temp.path.display()
        ),
    })?;
    file.sync_all()
        .await
        .map_err(|error| CommandError::Failed {
            code: "http_destination_missing",
            message: format!(
                "The temporary download {} cannot be written: {error}",
                temp.path.display()
            ),
        })?;
    drop(file);
    let sha256 = digest_hex(hasher.finalize());
    if let Some(expected) = expected
        && sha256 != expected
    {
        return Err(CommandError::Failed {
            code: "http_checksum_mismatch",
            message: format!("The downloaded file has the SHA-256 {sha256}, not {expected}."),
        });
    }
    tokio::fs::rename(&temp.path, destination)
        .await
        .map_err(|error| CommandError::Failed {
            code: "http_destination_missing",
            message: format!(
                "The download could not be moved to {}: {error}",
                destination.display()
            ),
        })?;
    temp.keep = true;
    Ok(DownloadOutcome {
        path: destination.to_string_lossy().into_owned(),
        size_bytes: received,
        sha256,
    })
}

/// Makes an HTTP request from Rust. The status and body come back for 4xx and 5xx too.
#[tauri::command]
pub async fn http_fetch(request: HttpRequestInput) -> CommandResult<HttpResponsePayload> {
    fetch_request(ALLOWED_HOSTS, request).await
}

/// Downloads a file to `destination_path`, reporting progress and checking a SHA-256 when given.
#[tauri::command]
pub async fn http_download(
    app: AppHandle,
    state: State<'_, HttpState>,
    id: String,
    url: String,
    destination_path: String,
    expected_sha256: Option<String>,
    on_progress: Channel<DownloadProgress>,
) -> CommandResult<DownloadOutcome> {
    let roots = crate::files::allowed_roots(&app)?;
    let destination = crate::files::check_path_in_scope(&destination_path, &roots)?;
    let progress = |received: u64, total: Option<u64>| -> CommandResult<()> {
        on_progress
            .send(DownloadProgress {
                received_bytes: received,
                total_bytes: total,
            })
            .map_err(|error| CommandError::Failed {
                code: "http_progress_failed",
                message: format!("The download progress could not reach the app: {error}"),
            })
    };
    registered_download(
        &state,
        &id,
        ALLOWED_HOSTS,
        &url,
        &destination,
        expected_sha256.as_deref(),
        progress,
    )
    .await
}

/// Runs a download under its id, so `http_cancel` can reach it, and forgets the id when it ends.
async fn registered_download(
    state: &HttpState,
    id: &str,
    allowed_hosts: &[&str],
    url: &str,
    destination: &Path,
    expected_sha256: Option<&str>,
    progress: impl FnMut(u64, Option<u64>) -> CommandResult<()>,
) -> CommandResult<DownloadOutcome> {
    let token = lock_downloads(state)?.begin(id)?;
    let result = download_request(
        allowed_hosts,
        url,
        destination,
        expected_sha256,
        Duration::from_millis(DOWNLOAD_STALL_TIMEOUT_MS),
        token,
        progress,
    )
    .await;
    // A lock poisoned by another download's panic must not discard this download's result.
    state
        .downloads
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .finish(id);
    result
}

/// Cancels a download. An id that is not running yet is kept, so its download stops when it
/// registers; an id that already finished is harmless.
#[tauri::command]
pub fn http_cancel(state: State<'_, HttpState>, id: String) -> CommandResult<()> {
    lock_downloads(&state)?.cancel(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread::JoinHandle;

    fn error_code(error: &CommandError) -> &'static str {
        match error {
            CommandError::Failed { code, .. } => code,
            CommandError::NotImplemented(_) => "not_implemented",
            CommandError::Io(_) => "io",
        }
    }

    /// The stall timeout for tests that do not test it: long enough for a loaded machine, and a
    /// hang still ends the test.
    const TEST_STALL: Duration = Duration::from_secs(10);

    fn temp_dir(label: &str) -> TempDir {
        TempDir::new(label)
    }

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(label: &str) -> Self {
            let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-plat-30-{label}-{}-{counter}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).expect("create the test folder");
            Self { path }
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            if let Err(error) = std::fs::remove_dir_all(&self.path) {
                eprintln!("could not remove {}: {error}", self.path.display());
            }
        }
    }

    fn respond_once(
        handler: impl FnOnce(&mut TcpStream) + Send + 'static,
    ) -> (String, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind the test server");
        let address = listener.local_addr().expect("read the test address");
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept the test request");
            handler(&mut stream);
        });
        (format!("http://{address}/file"), handle)
    }

    fn read_request(stream: &mut TcpStream) -> String {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("set the test read timeout");
        let mut collected = Vec::new();
        let mut buffer = [0u8; 4096];
        loop {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    collected.extend_from_slice(&buffer[..read]);
                    let Some(head_end) = collected
                        .windows(4)
                        .position(|window| window == b"\r\n\r\n")
                    else {
                        continue;
                    };
                    let head = String::from_utf8_lossy(&collected[..head_end]).to_ascii_lowercase();
                    let length = head
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length:"))
                        .and_then(|value| value.trim().parse::<usize>().ok())
                        .unwrap_or(0);
                    if collected.len() >= head_end + 4 + length {
                        break;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == std::io::ErrorKind::TimedOut => break,
                Err(error) => panic!("read the request: {error}"),
            }
        }
        String::from_utf8_lossy(&collected).into_owned()
    }

    fn send_response(stream: &mut TcpStream, status: &str, headers: &str, body: &[u8]) {
        let head = format!(
            "HTTP/1.1 {status}\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes()).expect("write the head");
        stream.write_all(body).expect("write the response body");
        stream.flush().expect("flush the response");
    }

    fn sha256_hex(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        digest_hex(hasher.finalize())
    }

    #[test]
    fn plat_30_allows_the_linear_host() {
        let url = check_url("https://api.linear.app/graphql", ALLOWED_HOSTS)
            .expect("Linear's API is on the allow-list");
        assert_eq!(url.host_str(), Some("api.linear.app"));
    }

    #[test]
    fn plat_30_refuses_a_lookalike_host() {
        let error = check_url("https://api.linear.app.example.com/graphql", ALLOWED_HOSTS)
            .expect_err("a lookalike host is refused");
        assert_eq!(error_code(&error), "http_url_not_allowed");
    }

    #[test]
    fn plat_30_refuses_plain_http_to_a_remote_host() {
        let error = check_url("http://github.com/file", ALLOWED_HOSTS)
            .expect_err("plain http to a remote host is refused");
        assert_eq!(error_code(&error), "http_url_not_allowed");
    }

    #[test]
    fn plat_30_refuses_a_url_with_a_user_name_or_password() {
        let error = check_url("https://user:secret@api.linear.app/graphql", ALLOWED_HOSTS)
            .expect_err("a URL with credentials is refused");
        assert_eq!(error_code(&error), "http_url_not_allowed");
    }

    #[test]
    fn plat_30_refuses_a_non_standard_https_port() {
        let error = check_url("https://api.linear.app:8443/graphql", ALLOWED_HOSTS)
            .expect_err("a non-standard port is refused");
        assert_eq!(error_code(&error), "http_url_not_allowed");
    }

    #[test]
    fn plat_30_refuses_an_invalid_url() {
        let error = check_url("not a url", ALLOWED_HOSTS).expect_err("an invalid URL is refused");
        assert_eq!(error_code(&error), "http_invalid_url");
    }

    #[test]
    fn plat_30_fetch_returns_the_status_headers_and_body() {
        let body = br#"{"data":{"ok":true}}"#.to_vec();
        let outgoing = body.clone();
        let (url, server) = respond_once(move |stream| {
            read_request(stream);
            send_response(
                stream,
                "200 OK",
                "Content-Type: application/json\r\nX-Test: yes\r\n",
                &outgoing,
            );
        });
        let response = tauri::async_runtime::block_on(fetch_request(
            &["127.0.0.1"],
            HttpRequestInput {
                url,
                method: "GET".to_string(),
                headers: None,
                body: None,
                timeout_ms: Some(2_000),
            },
        ))
        .expect("the fetch succeeds");
        server.join().expect("the test server ends");
        assert_eq!(response.status, 200);
        assert_eq!(response.body, String::from_utf8(body).expect("body text"));
        assert_eq!(
            response.headers.get("x-test").map(String::as_str),
            Some("yes")
        );
    }

    #[test]
    fn plat_30_fetch_sends_the_method_headers_and_body() {
        let (url, server) = respond_once(move |stream| {
            let request = read_request(stream).to_ascii_lowercase();
            assert!(request.starts_with("post /file http/1.1"), "{request}");
            assert!(request.contains("x-api-key: secret"), "{request}");
            assert!(request.contains("{\"query\":\"ok\"}"), "{request}");
            send_response(stream, "200 OK", "", b"{}");
        });
        let response = tauri::async_runtime::block_on(fetch_request(
            &["127.0.0.1"],
            HttpRequestInput {
                url,
                method: "POST".to_string(),
                headers: Some(HashMap::from([(
                    "x-api-key".to_string(),
                    "secret".to_string(),
                )])),
                body: Some("{\"query\":\"ok\"}".to_string()),
                timeout_ms: Some(2_000),
            },
        ))
        .expect("the fetch succeeds");
        server.join().expect("the test server ends");
        assert_eq!(response.status, 200);
    }

    #[test]
    fn plat_30_download_reports_progress_and_writes_the_file() {
        let payload: Vec<u8> = (0..64u8).cycle().take(64 * 1024).collect();
        let expected = sha256_hex(&payload);
        let outgoing = payload.clone();
        let (url, server) = respond_once(move |stream| {
            read_request(stream);
            send_response(
                stream,
                "200 OK",
                "Content-Type: application/octet-stream\r\n",
                &outgoing,
            );
        });
        let folder = temp_dir("download");
        let destination = folder.path.join("agent.bin");
        let seen = std::sync::Arc::new(Mutex::new(Vec::new()));
        let recorded = seen.clone();
        let outcome = tauri::async_runtime::block_on(download_request(
            &["127.0.0.1"],
            &url,
            &destination,
            Some(expected.as_str()),
            TEST_STALL,
            CancellationToken::new(),
            move |received, total| {
                recorded
                    .lock()
                    .expect("record progress")
                    .push((received, total));
                Ok(())
            },
        ))
        .expect("the download succeeds");
        server.join().expect("the test server ends");
        assert_eq!(outcome.size_bytes, payload.len() as u64);
        assert_eq!(outcome.sha256, expected);
        assert_eq!(std::fs::read(&destination).expect("the file"), payload);
        let seen = seen.lock().expect("read progress");
        assert!(seen.len() >= 2, "progress was {seen:?}");
        assert_eq!(seen.first().map(|(received, _)| *received), Some(0));
        assert_eq!(
            seen.last().map(|(received, _)| *received),
            Some(payload.len() as u64)
        );
    }

    #[test]
    fn plat_30_download_fails_and_leaves_no_file_on_a_checksum_mismatch() {
        let payload = b"the real bytes".to_vec();
        let outgoing = payload.clone();
        let (url, server) = respond_once(move |stream| {
            read_request(stream);
            send_response(stream, "200 OK", "", &outgoing);
        });
        let folder = temp_dir("mismatch");
        let destination = folder.path.join("agent.bin");
        let wrong = "0".repeat(64);
        let error = tauri::async_runtime::block_on(download_request(
            &["127.0.0.1"],
            &url,
            &destination,
            Some(wrong.as_str()),
            TEST_STALL,
            CancellationToken::new(),
            |_, _| Ok(()),
        ))
        .expect_err("the checksum does not match");
        server.join().expect("the test server ends");
        assert_eq!(error_code(&error), "http_checksum_mismatch");
        assert!(!destination.exists(), "the destination must not exist");
        assert!(
            std::fs::read_dir(&folder.path)
                .expect("read the test folder")
                .next()
                .is_none(),
            "a temporary file was left behind"
        );
    }

    #[test]
    fn plat_30_download_cancels_and_leaves_no_file() {
        let total: usize = 8 * 1024 * 1024;
        let (url, server) = respond_once(move |stream| {
            read_request(stream);
            let head =
                format!("HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nConnection: close\r\n\r\n");
            stream.write_all(head.as_bytes()).expect("write the head");
            let chunk = vec![7u8; 64 * 1024];
            for _ in 0..(total / chunk.len()) {
                if stream.write_all(&chunk).is_err() {
                    break;
                }
                if stream.flush().is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(2));
            }
        });
        let folder = temp_dir("cancel");
        let destination = folder.path.join("agent.bin");
        let cancel = CancellationToken::new();
        let stop_after_first = cancel.clone();
        let error = tauri::async_runtime::block_on(download_request(
            &["127.0.0.1"],
            &url,
            &destination,
            None,
            TEST_STALL,
            cancel,
            move |received, _| {
                if received > 0 {
                    stop_after_first.cancel();
                }
                Ok(())
            },
        ))
        .expect_err("the download is cancelled");
        server.join().expect("the test server ends");
        assert_eq!(error_code(&error), "http_cancelled");
        assert!(!destination.exists(), "the destination must not exist");
        assert!(
            std::fs::read_dir(&folder.path)
                .expect("read the test folder")
                .next()
                .is_none(),
            "a temporary file was left behind"
        );
    }

    #[test]
    fn plat_30_download_refuses_a_redirect_outside_the_allow_list() {
        let (url, server) = respond_once(move |stream| {
            read_request(stream);
            let head = "HTTP/1.1 302 Found\r\nLocation: http://evil.example/file\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
            stream.write_all(head.as_bytes()).expect("write the head");
        });
        let folder = temp_dir("redirect");
        let destination = folder.path.join("agent.bin");
        let error = tauri::async_runtime::block_on(download_request(
            &["127.0.0.1"],
            &url,
            &destination,
            None,
            TEST_STALL,
            CancellationToken::new(),
            |_, _| Ok(()),
        ))
        .expect_err("the redirect is refused");
        server.join().expect("the test server ends");
        assert_eq!(error_code(&error), "http_request_failed");
        let message = error.to_string();
        assert!(message.contains("redirect"), "{message}");
        assert!(!destination.exists(), "the destination must not exist");
    }

    #[test]
    fn plat_30_download_refuses_a_missing_destination_folder() {
        let folder = temp_dir("missing-folder");
        let destination = folder.path.join("gone").join("agent.bin");
        let error = tauri::async_runtime::block_on(download_request(
            ALLOWED_HOSTS,
            "https://api.linear.app/file",
            &destination,
            None,
            TEST_STALL,
            CancellationToken::new(),
            |_, _| Ok(()),
        ))
        .expect_err("the folder is missing");
        assert_eq!(error_code(&error), "http_destination_missing");
    }

    #[test]
    fn plat_30_download_refuses_a_checksum_that_is_not_sha256() {
        let folder = temp_dir("bad-checksum");
        let destination = folder.path.join("agent.bin");
        let error = tauri::async_runtime::block_on(download_request(
            &["127.0.0.1"],
            "http://127.0.0.1:1/file",
            &destination,
            Some("abc"),
            TEST_STALL,
            CancellationToken::new(),
            |_, _| Ok(()),
        ))
        .expect_err("the checksum is not 64 hex characters");
        assert_eq!(error_code(&error), "http_checksum_invalid");
    }

    /// Holds the test server's side open until the client closes the connection, so the server
    /// stays quiet for exactly as long as the client waits. A hang still ends after `TEST_STALL`.
    fn wait_for_close(stream: &mut TcpStream) {
        stream
            .set_read_timeout(Some(TEST_STALL))
            .expect("set the test read timeout");
        let mut buffer = [0u8; 1024];
        while let Ok(read) = stream.read(&mut buffer) {
            if read == 0 {
                break;
            }
        }
    }

    fn assert_folder_empty(folder: &TempDir) {
        assert!(
            std::fs::read_dir(&folder.path)
                .expect("read the test folder")
                .next()
                .is_none(),
            "a file was left in the download folder"
        );
    }

    #[test]
    fn plat_30_download_cancelled_before_the_server_answers_stops_at_once() {
        let cancel = CancellationToken::new();
        let cancel_from_server = cancel.clone();
        let (url, server) = respond_once(move |stream| {
            read_request(stream);
            // The request has arrived and no answer is sent: the download is waiting.
            cancel_from_server.cancel();
            wait_for_close(stream);
        });
        let folder = temp_dir("cancel-connecting");
        let destination = folder.path.join("agent.bin");
        let error = tauri::async_runtime::block_on(download_request(
            &["127.0.0.1"],
            &url,
            &destination,
            None,
            TEST_STALL,
            cancel,
            |_, _| Ok(()),
        ))
        .expect_err("the download is cancelled");
        server.join().expect("the test server ends");
        assert_eq!(error_code(&error), "http_cancelled");
        assert_folder_empty(&folder);
    }

    #[test]
    fn plat_30_download_times_out_when_the_server_never_answers() {
        let (url, server) = respond_once(move |stream| {
            read_request(stream);
            wait_for_close(stream);
        });
        let folder = temp_dir("timeout-answer");
        let destination = folder.path.join("agent.bin");
        let error = tauri::async_runtime::block_on(download_request(
            &["127.0.0.1"],
            &url,
            &destination,
            None,
            Duration::from_millis(200),
            CancellationToken::new(),
            |_, _| Ok(()),
        ))
        .expect_err("the download times out");
        server.join().expect("the test server ends");
        assert_eq!(error_code(&error), "http_timeout");
        assert_folder_empty(&folder);
    }

    #[test]
    fn plat_30_download_times_out_when_the_body_stops_arriving() {
        let (url, server) = respond_once(move |stream| {
            read_request(stream);
            let head = "HTTP/1.1 200 OK\r\nContent-Length: 1000\r\nConnection: close\r\n\r\n";
            stream.write_all(head.as_bytes()).expect("write the head");
            stream.write_all(&[7u8; 10]).expect("write the first bytes");
            stream.flush().expect("flush the first bytes");
            wait_for_close(stream);
        });
        let folder = temp_dir("timeout-body");
        let destination = folder.path.join("agent.bin");
        let error = tauri::async_runtime::block_on(download_request(
            &["127.0.0.1"],
            &url,
            &destination,
            None,
            Duration::from_millis(200),
            CancellationToken::new(),
            |_, _| Ok(()),
        ))
        .expect_err("the download times out");
        server.join().expect("the test server ends");
        assert_eq!(error_code(&error), "http_timeout");
        assert_folder_empty(&folder);
    }

    #[test]
    fn plat_30_a_cancel_that_arrives_before_registration_cancels_the_download() {
        let mut registry = DownloadRegistry::default();

        registry.cancel("early");
        let early = registry.begin("early").expect("the download registers");
        let other = registry.begin("other").expect("another download registers");

        assert!(early.is_cancelled());
        assert!(!other.is_cancelled());
        assert!(registry.cancelled_early.is_empty());
    }

    #[test]
    fn plat_30_a_download_cancelled_before_registration_never_connects() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind the test server");
        listener
            .set_nonblocking(true)
            .expect("make the test server non-blocking");
        let url = format!(
            "http://{}/file",
            listener.local_addr().expect("read the test address")
        );
        let state = HttpState::default();
        lock_downloads(&state)
            .expect("lock the registry")
            .cancel("early");
        let folder = temp_dir("cancel-early");
        let destination = folder.path.join("agent.bin");

        let error = tauri::async_runtime::block_on(registered_download(
            &state,
            "early",
            &["127.0.0.1"],
            &url,
            &destination,
            None,
            |_, _| Ok(()),
        ))
        .expect_err("the download is cancelled");

        assert_eq!(error_code(&error), "http_cancelled");
        let accepted = listener.accept();
        assert!(
            matches!(&accepted, Err(error) if error.kind() == std::io::ErrorKind::WouldBlock),
            "the download connected: {accepted:?}"
        );
        assert!(
            lock_downloads(&state)
                .expect("lock the registry")
                .running
                .is_empty()
        );
        assert_folder_empty(&folder);
    }

    #[test]
    fn plat_30_a_cancel_reaches_a_running_download() {
        let mut registry = DownloadRegistry::default();
        let token = registry.begin("running").expect("the download registers");

        registry.cancel("running");

        assert!(token.is_cancelled());
        assert!(registry.cancelled_early.is_empty());
    }

    #[test]
    fn plat_30_keeps_only_the_newest_early_cancels() {
        let mut registry = DownloadRegistry::default();
        for index in 0..=MAX_EARLY_CANCELS {
            registry.cancel(&format!("early-{index}"));
        }

        assert_eq!(registry.cancelled_early.len(), MAX_EARLY_CANCELS);
        let oldest = registry.begin("early-0").expect("the oldest registers");
        let newest = registry
            .begin(&format!("early-{MAX_EARLY_CANCELS}"))
            .expect("the newest registers");
        assert!(!oldest.is_cancelled());
        assert!(newest.is_cancelled());
    }

    #[test]
    fn plat_30_a_download_id_is_refused_while_running_and_free_after_it_ends() {
        let state = HttpState::default();
        let running = lock_downloads(&state)
            .expect("lock the registry")
            .begin("same")
            .expect("the first download registers");
        let folder = temp_dir("duplicate");
        let destination = folder.path.join("agent.bin");

        let duplicate = tauri::async_runtime::block_on(registered_download(
            &state,
            "same",
            &["127.0.0.1"],
            "http://127.0.0.1:1/file",
            &destination,
            None,
            |_, _| Ok(()),
        ))
        .expect_err("a second download with the same id is refused");
        assert_eq!(error_code(&duplicate), "http_duplicate_id");
        assert!(!running.is_cancelled());

        lock_downloads(&state)
            .expect("lock the registry")
            .finish("same");
        let ended = tauri::async_runtime::block_on(registered_download(
            &state,
            "same",
            &["127.0.0.1"],
            "http://127.0.0.1:1/file",
            &destination,
            Some("abc"),
            |_, _| Ok(()),
        ))
        .expect_err("the checksum is not 64 hex characters");
        assert_eq!(error_code(&ended), "http_checksum_invalid");
        assert!(
            lock_downloads(&state)
                .expect("lock the registry")
                .running
                .is_empty()
        );
    }
}
