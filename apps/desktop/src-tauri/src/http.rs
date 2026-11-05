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
//! - `http_cancel` on an unknown or finished id succeeds: the download is already gone.
//! - A non-2xx answer fails a download with `http_status` and removes the temporary file.
//! - A timeout is `http_timeout`. An expected hash that is not 64 hexadecimal characters is
//!   `http_checksum_invalid`, checked before any network request.
//!
//! Our design choice: the allow-list names only the hosts the app itself needs: Linear's API
//! (the first fetch caller) and the vendors' official release hosts the agent and helper program
//! downloads use (D021, D024). GitHub's API and features still go through `gh`; `github.com` here
//! is only for release assets.
//! Our design choice: the download id is made in the web view, so the cancel handle exists before
//! the command starts and a cancel can arrive while the request is still connecting.
//!
//! Test first: a download whose SHA-256 does not match fails with `http_checksum_mismatch` and
//! leaves no file at the destination.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
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

/// The downloads that can still be cancelled, by the id the web view chose.
#[derive(Default)]
pub struct HttpState {
    downloads: Mutex<HashMap<String, CancellationToken>>,
}

fn lock_downloads(
    state: &HttpState,
) -> CommandResult<MutexGuard<'_, HashMap<String, CancellationToken>>> {
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

/// The client follows a redirect only when the next URL passes the same allow-list.
fn build_client(allowed_hosts: &[&str]) -> CommandResult<Client> {
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
    Client::builder()
        .redirect(policy)
        .build()
        .map_err(|error| CommandError::Failed {
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
    let client = build_client(allowed_hosts)?;
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
        if let Err(error) = std::fs::remove_file(&self.path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "could not remove the temporary download {}: {error}",
                    self.path.display()
                );
            }
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
    let client = build_client(allowed_hosts)?;
    let response = client.get(url).send().await.map_err(network_error)?;
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
    if let Some(expected) = expected {
        if sha256 != expected {
            return Err(CommandError::Failed {
                code: "http_checksum_mismatch",
                message: format!("The downloaded file has the SHA-256 {sha256}, not {expected}."),
            });
        }
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
    let token = CancellationToken::new();
    {
        let mut downloads = lock_downloads(&state)?;
        if downloads.contains_key(&id) {
            return Err(CommandError::Failed {
                code: "http_duplicate_id",
                message: format!("A download with the id {id} is already running."),
            });
        }
        downloads.insert(id.clone(), token.clone());
    }
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
    let result = download_request(
        ALLOWED_HOSTS,
        &url,
        &destination,
        expected_sha256.as_deref(),
        token,
        progress,
    )
    .await;
    {
        let mut downloads = lock_downloads(&state)?;
        downloads.remove(&id);
    }
    result
}

/// Cancels a running download. An id that already finished is harmless.
#[tauri::command]
pub fn http_cancel(state: State<'_, HttpState>, id: String) -> CommandResult<()> {
    let downloads = lock_downloads(&state)?;
    if let Some(token) = downloads.get(&id) {
        token.cancel();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread::JoinHandle;

    fn error_code(error: CommandError) -> &'static str {
        match error {
            CommandError::Failed { code, .. } => code,
            CommandError::NotImplemented(_) => "not_implemented",
            CommandError::Io(_) => "io",
        }
    }

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
        assert_eq!(error_code(error), "http_url_not_allowed");
    }

    #[test]
    fn plat_30_refuses_plain_http_to_a_remote_host() {
        let error = check_url("http://github.com/file", ALLOWED_HOSTS)
            .expect_err("plain http to a remote host is refused");
        assert_eq!(error_code(error), "http_url_not_allowed");
    }

    #[test]
    fn plat_30_refuses_a_url_with_a_user_name_or_password() {
        let error = check_url("https://user:secret@api.linear.app/graphql", ALLOWED_HOSTS)
            .expect_err("a URL with credentials is refused");
        assert_eq!(error_code(error), "http_url_not_allowed");
    }

    #[test]
    fn plat_30_refuses_a_non_standard_https_port() {
        let error = check_url("https://api.linear.app:8443/graphql", ALLOWED_HOSTS)
            .expect_err("a non-standard port is refused");
        assert_eq!(error_code(error), "http_url_not_allowed");
    }

    #[test]
    fn plat_30_refuses_an_invalid_url() {
        let error = check_url("not a url", ALLOWED_HOSTS).expect_err("an invalid URL is refused");
        assert_eq!(error_code(error), "http_invalid_url");
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
            CancellationToken::new(),
            |_, _| Ok(()),
        ))
        .expect_err("the checksum does not match");
        server.join().expect("the test server ends");
        assert_eq!(error_code(error), "http_checksum_mismatch");
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
        assert_eq!(error_code(error), "http_cancelled");
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
            CancellationToken::new(),
            |_, _| Ok(()),
        ))
        .expect_err("the redirect is refused");
        server.join().expect("the test server ends");
        assert_eq!(error_code(error), "http_request_failed");
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
            CancellationToken::new(),
            |_, _| Ok(()),
        ))
        .expect_err("the folder is missing");
        assert_eq!(error_code(error), "http_destination_missing");
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
            CancellationToken::new(),
            |_, _| Ok(()),
        ))
        .expect_err("the checksum is not 64 hex characters");
        assert_eq!(error_code(error), "http_checksum_invalid");
    }
}
