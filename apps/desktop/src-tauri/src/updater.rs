//! @feature PLAT-13 Self-update that waits until agents are idle
//!
//! Owns: the app's update commands over `tauri-plugin-updater`: checking our release feed,
//! downloading and verifying the update with retries, installing it and restarting, and the record
//! of the update installed just before this launch. The plugin reads the feed, downloads the
//! package, checks its minisign signature and replaces the app bundle (D079). This module adds what
//! the plugin leaves to the app: retry with backoff, one download shared by callers that ask at
//! once, the status event, the sidecar's stop before the restart, and the installed record behind
//! the release notes after relaunch. The UI decides when it is safe to relaunch.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A9 (the Tauri updater plugin does
//! the update with minisign signatures; a manual path retries the download and shows the release
//! notes after relaunch) and A2 (`check_for_updates`, `get_installed_manual_update`).
//!
//! Must handle:
//! - `updater_check` returns `None` when the app is current. A network or feed failure is an error
//!   (`updater_network`, `updater_feed_invalid`, `updater_platform_missing`), never "no update".
//! - The feed URL and the public key are `plugins.updater` in tauri.conf.json. Nothing is defaulted.
//! - `updater_install` downloads and verifies the update, keeps the package in memory and reports
//!   `Ready`. It does not install: a bundle replaced while the app runs would hand a restarted
//!   sidecar the next version's files. A package whose signature does not match fails with
//!   `updater_bad_signature`, and nothing is kept, so the next install downloads it again.
//! - Two `updater_install` calls at once share one download. With no checked update the call fails
//!   with `updater_nothing_pending`.
//! - A download failure that another attempt can fix (the network, an error answer) is tried again
//!   with backoff and reports `Downloading` again. After the last attempt the status is `Failed`.
//!   The feed request may take `FEED_TIMEOUT_MS` in all; a download waits at most
//!   `READ_TIMEOUT_MS` for its next bytes, so a large download on a slow line is not cut off.
//! - `updater_relaunch` records the update for the next launch, then installs it. When either step
//!   fails nothing has been stopped: the status is `Failed` and the app keeps running. After the
//!   install the sidecar is stopped and the app restarts, also when the stop fails, because the
//!   bundle on disk is already the new version.
//! - `updater_installed_update` returns the record once, and only when the running version is that
//!   update, so an update that did not apply never claims it did. A record that cannot be read is
//!   an error, never "no update".
//! - Every status change is emitted as `updater://status` with the full status.
//!
//! Our design choice: a downloaded package stays in memory until the relaunch. A quit before then
//! drops it, and the next check finds the update again. Only the installed record is kept on disk.
//! Our design choice: Conductor's feed is CrabNebula's; ours is `latest.json` on this repository's
//! GitHub releases, signed with our own key (D079).
//!
//! Test first: with a local feed that serves a newer signed manifest, the check returns the version
//! and notes; with a package the signature does not cover, the install fails with
//! `updater_bad_signature` and keeps nothing.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_updater::{Error as PluginError, Update, Updater, UpdaterExt};

use crate::error::{CommandError, CommandResult, lock};

/// Event carrying the full `UpdaterStatus` after every change.
pub const EVENT_STATUS: &str = "updater://status";
/// Download attempts before the status becomes `Failed`.
pub const MAX_DOWNLOAD_ATTEMPTS: u32 = 5;
/// Pause before each retry. The last value repeats.
pub const RETRY_DELAYS_MS: [u64; 4] = [1_000, 2_000, 4_000, 8_000];
/// How long the feed request may take in all.
pub const FEED_TIMEOUT_MS: u64 = 30_000;
/// How long a request may wait for its next bytes. A download as a whole has no limit.
pub const READ_TIMEOUT_MS: u64 = 30_000;
/// The folder in the app data folder that holds the installed record.
const UPDATES_FOLDER: &str = "updates";
/// Record of the update installed just before this launch.
const INSTALLED_FILE: &str = "installed.json";

/// An available update. Mirrors the object `Updater.check` returns in platform.ts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    /// Release notes as markdown. Empty when the feed publishes none.
    pub notes: String,
}

/// Where the updater is. Sent as `updater://status`.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum UpdaterStatus {
    Idle,
    Checking,
    Available {
        version: String,
    },
    Downloading {
        version: String,
        received: u64,
        total: Option<u64>,
    },
    /// Downloaded and verified. Waiting for `updater_relaunch`.
    Ready {
        version: String,
    },
    Failed {
        code: String,
        message: String,
    },
}

/// Retry policy for a download. Tests use a policy with no waits.
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    pub attempts: u32,
    pub delays_ms: Vec<u64>,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            attempts: MAX_DOWNLOAD_ATTEMPTS,
            delays_ms: RETRY_DELAYS_MS.to_vec(),
        }
    }
}

impl RetryPolicy {
    fn delay(&self, attempt: u32) -> Duration {
        let index = attempt.saturating_sub(1) as usize;
        let millis = self
            .delays_ms
            .get(index)
            .copied()
            .or_else(|| self.delays_ms.last().copied())
            .unwrap_or(0);
        Duration::from_millis(millis)
    }
}

/// The update the last check found, and its verified package once downloaded.
#[derive(Clone)]
struct Pending {
    update: Update,
    package: Option<Arc<Vec<u8>>>,
}

/// An install that callers join instead of starting a second download.
#[derive(Default)]
struct InstallJob {
    started: AtomicBool,
    outcome: Mutex<Option<StoredOutcome>>,
    done: tokio::sync::Notify,
}

/// An outcome that can be cloned for every caller waiting on the job.
type StoredOutcome = std::result::Result<(), (&'static str, String)>;

/// Shared state, registered once with `.manage(UpdaterState::default())`.
#[derive(Default)]
pub struct UpdaterState {
    pending: Mutex<Option<Pending>>,
    install: tokio::sync::Mutex<Option<Arc<InstallJob>>>,
}

fn failed(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError::Failed {
        code,
        message: message.into(),
    }
}

/// The plugin's error as a command error with a code the UI can read.
fn plugin_error(error: PluginError) -> CommandError {
    let code = match &error {
        PluginError::Minisign(_)
        | PluginError::Base64(_)
        | PluginError::SignatureUtf8(_)
        | PluginError::SignedVersionMismatch { .. }
        | PluginError::MissingSignedVersion => "updater_bad_signature",
        PluginError::Reqwest(_) | PluginError::Network(_) => "updater_network",
        PluginError::ReleaseNotFound
        | PluginError::Serialization(_)
        | PluginError::Semver(_)
        | PluginError::UrlParse(_) => "updater_feed_invalid",
        PluginError::TargetNotFound(_)
        | PluginError::TargetsNotFound(_)
        | PluginError::UnsupportedArch
        | PluginError::UnsupportedOs => "updater_platform_missing",
        PluginError::EmptyEndpoints | PluginError::InsecureTransportProtocol => {
            "updater_config_missing"
        }
        _ => "updater_failed",
    };
    failed(code, error.to_string())
}

/// A failure that another attempt can fix: the connection, or an error answer from the server.
fn retryable(error: &PluginError) -> bool {
    matches!(error, PluginError::Reqwest(_) | PluginError::Network(_))
}

fn stored_outcome(error: &CommandError) -> StoredOutcome {
    Err((error.code(), error.to_string()))
}

fn restore_outcome(outcome: &StoredOutcome) -> CommandResult<()> {
    outcome
        .clone()
        .map_err(|(code, message)| CommandError::Failed { code, message })
}

/// Reports a status to the window. A window that cannot be reached does not change the update.
fn set_status<R: Runtime>(app: &AppHandle<R>, status: UpdaterStatus) {
    if let Err(error) = app.emit(EVENT_STATUS, status) {
        eprintln!("could not send the updater status: {error}");
    }
}

fn fail<R: Runtime>(app: &AppHandle<R>, error: &CommandError) {
    set_status(
        app,
        UpdaterStatus::Failed {
            code: error.code().to_string(),
            message: error.to_string(),
        },
    );
}

fn info_of(update: &Update) -> UpdateInfo {
    UpdateInfo {
        version: update.version.clone(),
        notes: update.body.clone().unwrap_or_default(),
    }
}

/// The plugin's updater for our feed, with our timeouts.
fn updater<R: Runtime>(app: &AppHandle<R>) -> CommandResult<Updater> {
    app.updater_builder()
        .timeout(Duration::from_millis(FEED_TIMEOUT_MS))
        .configure_client(|client| client.read_timeout(Duration::from_millis(READ_TIMEOUT_MS)))
        .build()
        .map_err(plugin_error)
}

/// The folder of the installed record, inside the app data folder.
fn updates_dir<R: Runtime>(app: &AppHandle<R>) -> CommandResult<PathBuf> {
    let data_dir = app.path().app_data_dir().map_err(|error| {
        failed(
            "updater_data_dir",
            format!("The app data folder is unknown: {error}"),
        )
    })?;
    Ok(data_dir.join(UPDATES_FOLDER))
}

/// Asks the feed whether a newer version exists, and keeps the answer for the install.
pub async fn check_update<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterState,
) -> CommandResult<Option<UpdateInfo>> {
    set_status(app, UpdaterStatus::Checking);
    let found = match updater(app) {
        Ok(updater) => updater.check().await.map_err(plugin_error),
        Err(error) => Err(error),
    };
    match found {
        Err(error) => {
            fail(app, &error);
            Err(error)
        }
        Ok(None) => {
            *lock(&state.pending) = None;
            set_status(app, UpdaterStatus::Idle);
            Ok(None)
        }
        Ok(Some(update)) => {
            let info = info_of(&update);
            {
                let mut pending = lock(&state.pending);
                // A package already downloaded for this version is kept.
                let package = pending
                    .as_ref()
                    .filter(|current| current.update.version == update.version)
                    .and_then(|current| current.package.clone());
                *pending = Some(Pending { update, package });
            }
            set_status(
                app,
                UpdaterStatus::Available {
                    version: info.version.clone(),
                },
            );
            Ok(Some(info))
        }
    }
}

/// Downloads the package, trying again on failures another attempt can fix.
async fn download_with_retry<F>(
    update: &Update,
    policy: &RetryPolicy,
    mut on_status: F,
) -> CommandResult<Vec<u8>>
where
    F: FnMut(UpdaterStatus),
{
    let attempts = policy.attempts.max(1);
    let mut attempt = 1;
    loop {
        let mut received = 0_u64;
        on_status(UpdaterStatus::Downloading {
            version: update.version.clone(),
            received,
            total: None,
        });
        let downloaded = update
            .download(
                |chunk, total| {
                    received += chunk as u64;
                    on_status(UpdaterStatus::Downloading {
                        version: update.version.clone(),
                        received,
                        total,
                    });
                },
                || {},
            )
            .await;
        match downloaded {
            Ok(package) => return Ok(package),
            Err(error) if retryable(&error) && attempt < attempts => {
                tokio::time::sleep(policy.delay(attempt)).await;
                attempt += 1;
            }
            Err(error) => return Err(plugin_error(error)),
        }
    }
}

/// Downloads and verifies the update the last check found. Callers that ask at once share one
/// download.
pub async fn install_update<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterState,
    policy: &RetryPolicy,
) -> CommandResult<()> {
    let Some(pending) = lock(&state.pending).clone() else {
        let error = failed(
            "updater_nothing_pending",
            "No update has been checked, so there is nothing to install.",
        );
        fail(app, &error);
        return Err(error);
    };
    if pending.package.is_some() {
        set_status(
            app,
            UpdaterStatus::Ready {
                version: pending.update.version.clone(),
            },
        );
        return Ok(());
    }
    let job = {
        let mut slot = state.install.lock().await;
        match slot.as_ref() {
            Some(job) => job.clone(),
            None => {
                let job = Arc::new(InstallJob::default());
                *slot = Some(job.clone());
                job
            }
        }
    };
    if job.started.swap(true, Ordering::SeqCst) {
        // Register the waiter before reading the outcome, so a leader that finishes in between
        // cannot leave this caller asleep.
        let notified = job.done.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        loop {
            if let Some(outcome) = lock(&job.outcome).clone() {
                return restore_outcome(&outcome);
            }
            notified.as_mut().await;
        }
    }
    let result = run_install(app, state, pending, policy).await;
    *lock(&job.outcome) = Some(match &result {
        Ok(()) => Ok(()),
        Err(error) => stored_outcome(error),
    });
    job.done.notify_waiters();
    {
        let mut slot = state.install.lock().await;
        if slot
            .as_ref()
            .is_some_and(|running| Arc::ptr_eq(running, &job))
        {
            *slot = None;
        }
    }
    result
}

async fn run_install<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterState,
    pending: Pending,
    policy: &RetryPolicy,
) -> CommandResult<()> {
    let package = match download_with_retry(&pending.update, policy, |status| {
        set_status(app, status)
    })
    .await
    {
        Ok(package) => Arc::new(package),
        Err(error) => {
            fail(app, &error);
            return Err(error);
        }
    };
    let version = pending.update.version.clone();
    {
        let mut current = lock(&state.pending);
        // A check that found another version while this one downloaded wins.
        if let Some(current) = current.as_mut()
            && current.update.version == version
        {
            current.package = Some(package);
        }
    }
    set_status(app, UpdaterStatus::Ready { version });
    Ok(())
}

/// Records and installs the kept update, so the app can restart into it. Nothing is stopped here;
/// a failure leaves the running app as it was.
pub fn install_for_relaunch<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdaterState,
    dir: &Path,
) -> CommandResult<()> {
    let Some(pending) = lock(&state.pending).clone() else {
        let error = failed(
            "updater_nothing_pending",
            "No update is ready, so there is nothing to relaunch into.",
        );
        fail(app, &error);
        return Err(error);
    };
    let Some(package) = pending.package.clone() else {
        let error = failed(
            "updater_not_staged",
            "The update has not been downloaded and verified yet.",
        );
        fail(app, &error);
        return Err(error);
    };
    // The record comes first: it is only read when the running version matches it, so a record
    // left by an install that failed is dropped at the next launch.
    if let Err(error) = save_installed(dir, &info_of(&pending.update)) {
        fail(app, &error);
        return Err(error);
    }
    if let Err(error) = pending.update.install(package.as_slice()) {
        let error = match plugin_error(error) {
            CommandError::Failed {
                code: "updater_failed",
                message,
            } => failed("updater_install_failed", message),
            other => other,
        };
        fail(app, &error);
        return Err(error);
    }
    Ok(())
}

fn installed_path(dir: &Path) -> PathBuf {
    dir.join(INSTALLED_FILE)
}

fn save_installed(dir: &Path, info: &UpdateInfo) -> CommandResult<()> {
    std::fs::create_dir_all(dir).map_err(|error| {
        failed(
            "updater_state_write",
            format!("Could not create the update folder: {error}"),
        )
    })?;
    let text = serde_json::to_vec_pretty(info).map_err(|error| {
        failed(
            "updater_state_write",
            format!("Could not write the installed update: {error}"),
        )
    })?;
    std::fs::write(installed_path(dir), text).map_err(|error| {
        failed(
            "updater_state_write",
            format!("Could not save the installed update: {error}"),
        )
    })
}

/// Returns the update installed just before this launch, once, and only if the running version
/// is that update. A record for another version means the bundle was not replaced.
pub fn take_installed_update(
    dir: &Path,
    current_version: &str,
) -> CommandResult<Option<UpdateInfo>> {
    let path = installed_path(dir);
    let text = match std::fs::read(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(failed(
                "updater_state_read",
                format!("Could not read the installed update: {error}"),
            ));
        }
    };
    let record: UpdateInfo = serde_json::from_slice(&text).map_err(|error| {
        failed(
            "updater_state_unreadable",
            format!("The installed update could not be read: {error}"),
        )
    })?;
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(failed(
                "updater_state_write",
                format!("Could not remove {}: {error}", path.display()),
            ));
        }
    }
    Ok((record.version == current_version).then_some(record))
}

/// Asks the release feed whether a newer version exists.
#[tauri::command]
pub async fn updater_check(
    app: AppHandle,
    state: State<'_, UpdaterState>,
) -> CommandResult<Option<UpdateInfo>> {
    check_update(&app, &state).await
}

/// Downloads and verifies the update found by the last check.
#[tauri::command]
pub async fn updater_install(app: AppHandle, state: State<'_, UpdaterState>) -> CommandResult<()> {
    install_update(&app, &state, &RetryPolicy::default()).await
}

/// Installs the downloaded update, stops the sidecar and restarts the app.
#[tauri::command]
pub async fn updater_relaunch(app: AppHandle, state: State<'_, UpdaterState>) -> CommandResult<()> {
    let dir = match updates_dir(&app) {
        Ok(dir) => dir,
        Err(error) => {
            fail(&app, &error);
            return Err(error);
        }
    };
    install_for_relaunch(&app, &state, &dir)?;
    let sidecar = app.state::<crate::sidecar::SidecarState>();
    if let Err(error) = crate::sidecar::shutdown(&sidecar).await {
        // The bundle is already the new version, so the restart goes ahead. Nothing is left to
        // hand the error to: this process ends now.
        eprintln!("the sidecar did not stop before the update restart: {error}");
    }
    app.restart();
}

/// The update installed just before this launch, so its release notes can be shown once.
#[tauri::command]
pub fn updater_installed_update(app: AppHandle) -> CommandResult<Option<UpdateInfo>> {
    let dir = updates_dir(&app)?;
    take_installed_update(&dir, &app.package_info().version.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::AtomicU64;
    use std::sync::mpsc;
    use std::thread;

    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;
    use ring::rand::SystemRandom;
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use tauri::Listener;
    use tauri::test::MockRuntime;

    static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A folder of the run's own, removed when the test ends.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "conducted-plat-13-{}-{}",
                std::process::id(),
                TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).expect("create the temp folder");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            if let Err(error) = std::fs::remove_dir_all(&self.path) {
                eprintln!("could not remove {}: {error}", self.path.display());
            }
        }
    }

    const KEY_ID: [u8; 8] = [1, 2, 3, 4, 5, 6, 7, 8];

    /// A minisign key pair of the test's own, in the text form `tauri signer` writes.
    struct SigningKey {
        pair: Ed25519KeyPair,
        /// The public key file's text, base64-encoded as `plugins.updater.pubkey` holds it.
        pubkey: String,
    }

    fn signing_key(key_id: [u8; 8]) -> SigningKey {
        let rng = SystemRandom::new();
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).expect("generate a test key");
        let pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).expect("read the test key");
        let mut blob = Vec::new();
        blob.extend_from_slice(b"Ed");
        blob.extend_from_slice(&key_id);
        blob.extend_from_slice(pair.public_key().as_ref());
        let text = format!(
            "untrusted comment: minisign public key: test\n{}\n",
            STANDARD.encode(blob)
        );
        SigningKey {
            pair,
            pubkey: STANDARD.encode(text),
        }
    }

    /// The `.sig` file of `data`, base64-encoded as a feed's `signature` holds it.
    fn signature(key: &SigningKey, key_id: [u8; 8], data: &[u8]) -> String {
        let signature = key.pair.sign(data);
        let mut blob = Vec::new();
        blob.extend_from_slice(b"Ed");
        blob.extend_from_slice(&key_id);
        blob.extend_from_slice(signature.as_ref());
        let trusted = "timestamp:0\tfile:Conducted.app.tar.gz";
        let mut global = signature.as_ref().to_vec();
        global.extend_from_slice(trusted.as_bytes());
        let text = format!(
            "untrusted comment: signature from tauri secret key\n{}\ntrusted comment: {trusted}\n{}\n",
            STANDARD.encode(blob),
            STANDARD.encode(key.pair.sign(&global).as_ref())
        );
        STANDARD.encode(text)
    }

    struct Response {
        status: u16,
        body: Vec<u8>,
    }

    /// A local server on a port the system picks. Each answer goes to one request, then the
    /// server stops and reports how many it served.
    fn serve(path: &str, answers: Vec<Response>) -> (String, thread::JoinHandle<usize>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind the test server");
        let address = listener.local_addr().expect("read the test server address");
        let (ready_tx, ready_rx) = mpsc::channel();
        let server = thread::spawn(move || {
            ready_tx.send(()).expect("signal that the server is ready");
            let mut served = 0;
            for answer in answers {
                let (mut stream, _) = listener.accept().expect("accept one request");
                let mut request = [0_u8; 4096];
                let mut read = Vec::new();
                loop {
                    let count = stream.read(&mut request).expect("read a request");
                    if count == 0 {
                        break;
                    }
                    read.extend_from_slice(&request[..count]);
                    if read.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                let reason = if answer.status == 200 {
                    "OK"
                } else {
                    "Server Error"
                };
                let header = format!(
                    "HTTP/1.1 {} {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    answer.status,
                    reason,
                    answer.body.len()
                );
                stream
                    .write_all(header.as_bytes())
                    .expect("write the answer head");
                stream
                    .write_all(&answer.body)
                    .expect("write the answer body");
                stream.flush().expect("send the answer");
                served += 1;
            }
            served
        });
        ready_rx.recv().expect("the test server starts");
        (format!("http://{address}/{path}"), server)
    }

    fn ok(body: Vec<u8>) -> Response {
        Response { status: 200, body }
    }

    fn server_error() -> Response {
        Response {
            status: 500,
            body: Vec::new(),
        }
    }

    /// The feed for this Mac, as the release workflow writes `latest.json`.
    fn feed(version: &str, package_url: &str, signature: &str) -> Vec<u8> {
        let platform = format!("darwin-{}", std::env::consts::ARCH);
        serde_json::to_vec(&serde_json::json!({
            "version": version,
            "notes": "The notes for this version.",
            "platforms": { platform: { "url": package_url, "signature": signature } }
        }))
        .expect("write the feed")
    }

    /// The mock app with the updater plugin set to the test feed and key, as tauri.conf.json sets
    /// them for the real app. Its version is 0.1.0.
    fn app(feed_url: &str, pubkey: &str) -> tauri::App<MockRuntime> {
        let mut context = tauri::test::mock_context(tauri::test::noop_assets());
        context.config_mut().plugins.0.insert(
            "updater".to_string(),
            serde_json::json!({
                "pubkey": pubkey,
                "endpoints": [feed_url],
                "dangerousInsecureTransportProtocol": true
            }),
        );
        tauri::test::mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .manage(UpdaterState::default())
            .build(context)
            .expect("build the mock app")
    }

    fn statuses(app: &tauri::App<MockRuntime>) -> Arc<Mutex<Vec<serde_json::Value>>> {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        app.listen(EVENT_STATUS, move |event| {
            let value = serde_json::from_str(event.payload()).expect("a status is JSON");
            lock(&sink).push(value);
        });
        seen
    }

    fn no_wait(attempts: u32) -> RetryPolicy {
        RetryPolicy {
            attempts,
            delays_ms: vec![0],
        }
    }

    #[tokio::test]
    async fn plat_13_a_newer_signed_version_in_the_feed_is_an_update() {
        let key = signing_key(KEY_ID);
        let (feed_url, feed_server) = serve(
            "latest.json",
            vec![ok(feed("0.2.0", "https://example.invalid/a.tar.gz", "sig"))],
        );
        let app = app(&feed_url, &key.pubkey);
        let state = app.state::<UpdaterState>();

        let found = check_update(app.handle(), &state)
            .await
            .expect("the feed answers");

        assert_eq!(
            found,
            Some(UpdateInfo {
                version: "0.2.0".to_string(),
                notes: "The notes for this version.".to_string(),
            })
        );
        assert_eq!(feed_server.join().expect("the server ends"), 1);
    }

    #[tokio::test]
    async fn plat_13_the_current_version_is_not_an_update() {
        let key = signing_key(KEY_ID);
        let (feed_url, feed_server) = serve(
            "latest.json",
            vec![ok(feed("0.1.0", "https://example.invalid/a.tar.gz", "sig"))],
        );
        let app = app(&feed_url, &key.pubkey);
        let state = app.state::<UpdaterState>();

        assert_eq!(
            check_update(app.handle(), &state)
                .await
                .expect("the feed answers"),
            None
        );
        assert_eq!(feed_server.join().expect("the server ends"), 1);
    }

    #[tokio::test]
    async fn plat_13_a_feed_that_cannot_be_read_is_an_error_not_an_answer() {
        let key = signing_key(KEY_ID);
        let (feed_url, feed_server) = serve(
            "latest.json",
            vec![ok(br#"{"version":"not a version","platforms":{}}"#.to_vec())],
        );
        let app = app(&feed_url, &key.pubkey);
        let state = app.state::<UpdaterState>();

        let error = check_update(app.handle(), &state)
            .await
            .expect_err("a broken feed is not 'no update'");

        assert_eq!(error.code(), "updater_feed_invalid");
        assert_eq!(feed_server.join().expect("the server ends"), 1);
    }

    #[tokio::test]
    async fn plat_13_a_feed_with_no_file_for_this_mac_is_an_error() {
        let key = signing_key(KEY_ID);
        let body = serde_json::to_vec(&serde_json::json!({
            "version": "0.2.0",
            "platforms": { "windows-x86_64": { "url": "https://example.invalid/a.zip", "signature": "sig" } }
        }))
        .expect("write the feed");
        let (feed_url, feed_server) = serve("latest.json", vec![ok(body)]);
        let app = app(&feed_url, &key.pubkey);
        let state = app.state::<UpdaterState>();

        let error = check_update(app.handle(), &state)
            .await
            .expect_err("there is no file for this Mac");

        assert_eq!(error.code(), "updater_platform_missing");
        assert_eq!(feed_server.join().expect("the server ends"), 1);
    }

    #[tokio::test]
    async fn plat_13_a_verified_download_is_ready_for_the_relaunch() {
        let key = signing_key(KEY_ID);
        let package = b"the signed update".to_vec();
        let (package_url, package_server) = serve("a.tar.gz", vec![ok(package.clone())]);
        let (feed_url, feed_server) = serve(
            "latest.json",
            vec![ok(feed(
                "0.2.0",
                &package_url,
                &signature(&key, KEY_ID, &package),
            ))],
        );
        let app = app(&feed_url, &key.pubkey);
        let seen = statuses(&app);
        let state = app.state::<UpdaterState>();
        check_update(app.handle(), &state)
            .await
            .expect("the feed answers");

        install_update(app.handle(), &state, &no_wait(1))
            .await
            .expect("a correctly signed package is kept");

        let kept = lock(&state.pending)
            .as_ref()
            .and_then(|pending| pending.package.clone())
            .expect("the package is kept for the relaunch");
        assert_eq!(kept.as_slice(), package.as_slice());
        assert_eq!(
            lock(&seen).last(),
            Some(&serde_json::json!({ "state": "ready", "version": "0.2.0" }))
        );
        assert_eq!(feed_server.join().expect("the feed server ends"), 1);
        assert_eq!(package_server.join().expect("the package server ends"), 1);
    }

    #[tokio::test]
    async fn plat_13_a_signature_for_other_bytes_is_refused_and_nothing_is_kept() {
        let key = signing_key(KEY_ID);
        let (package_url, package_server) =
            serve("a.tar.gz", vec![ok(b"the downloaded update".to_vec())]);
        let (feed_url, feed_server) = serve(
            "latest.json",
            vec![ok(feed(
                "0.2.0",
                &package_url,
                &signature(&key, KEY_ID, b"the update we signed"),
            ))],
        );
        let app = app(&feed_url, &key.pubkey);
        let seen = statuses(&app);
        let state = app.state::<UpdaterState>();
        check_update(app.handle(), &state)
            .await
            .expect("the feed answers");

        let error = install_update(app.handle(), &state, &no_wait(3))
            .await
            .expect_err("the signature does not cover the download");

        assert_eq!(error.code(), "updater_bad_signature");
        assert!(
            lock(&state.pending)
                .as_ref()
                .is_some_and(|pending| pending.package.is_none()),
            "nothing unsigned is kept"
        );
        assert_eq!(
            lock(&seen).last().and_then(|status| status.get("state")),
            Some(&serde_json::json!("failed"))
        );
        assert_eq!(feed_server.join().expect("the feed server ends"), 1);
        assert_eq!(
            package_server.join().expect("the package server ends"),
            1,
            "a bad signature is not tried again"
        );
    }

    #[tokio::test]
    async fn plat_13_a_signature_with_a_different_key_is_refused() {
        let key = signing_key(KEY_ID);
        let other = signing_key([9, 9, 9, 9, 9, 9, 9, 9]);
        let package = b"the signed update".to_vec();
        let (package_url, package_server) = serve("a.tar.gz", vec![ok(package.clone())]);
        let (feed_url, feed_server) = serve(
            "latest.json",
            vec![ok(feed(
                "0.2.0",
                &package_url,
                &signature(&other, [9, 9, 9, 9, 9, 9, 9, 9], &package),
            ))],
        );
        let app = app(&feed_url, &key.pubkey);
        let state = app.state::<UpdaterState>();
        check_update(app.handle(), &state)
            .await
            .expect("the feed answers");

        let error = install_update(app.handle(), &state, &no_wait(1))
            .await
            .expect_err("another key signed the package");

        assert_eq!(error.code(), "updater_bad_signature");
        assert_eq!(feed_server.join().expect("the feed server ends"), 1);
        assert_eq!(package_server.join().expect("the package server ends"), 1);
    }

    #[tokio::test]
    async fn plat_13_a_download_retries_and_then_succeeds() {
        let key = signing_key(KEY_ID);
        let package = b"the signed update".to_vec();
        let (package_url, package_server) =
            serve("a.tar.gz", vec![server_error(), ok(package.clone())]);
        let (feed_url, feed_server) = serve(
            "latest.json",
            vec![ok(feed(
                "0.2.0",
                &package_url,
                &signature(&key, KEY_ID, &package),
            ))],
        );
        let app = app(&feed_url, &key.pubkey);
        let seen = statuses(&app);
        let state = app.state::<UpdaterState>();
        check_update(app.handle(), &state)
            .await
            .expect("the feed answers");

        install_update(app.handle(), &state, &no_wait(2))
            .await
            .expect("the second attempt succeeds");

        let starts = lock(&seen)
            .iter()
            .filter(|status| {
                status.get("state") == Some(&serde_json::json!("downloading"))
                    && status.get("received") == Some(&serde_json::json!(0))
            })
            .count();
        assert_eq!(starts, 2, "each attempt reports Downloading again");
        assert_eq!(feed_server.join().expect("the feed server ends"), 1);
        assert_eq!(package_server.join().expect("the package server ends"), 2);
    }

    #[tokio::test]
    async fn plat_13_a_failed_download_stops_after_the_attempt_limit() {
        let key = signing_key(KEY_ID);
        let (package_url, package_server) = serve("a.tar.gz", vec![server_error(), server_error()]);
        let (feed_url, feed_server) = serve(
            "latest.json",
            vec![ok(feed("0.2.0", &package_url, "unused"))],
        );
        let app = app(&feed_url, &key.pubkey);
        let state = app.state::<UpdaterState>();
        check_update(app.handle(), &state)
            .await
            .expect("the feed answers");

        let error = install_update(app.handle(), &state, &no_wait(2))
            .await
            .expect_err("both attempts fail");

        assert_eq!(error.code(), "updater_network");
        assert_eq!(feed_server.join().expect("the feed server ends"), 1);
        assert_eq!(package_server.join().expect("the package server ends"), 2);
    }

    #[tokio::test]
    async fn plat_13_two_installs_at_once_share_one_download() {
        let key = signing_key(KEY_ID);
        let package = b"the signed update".to_vec();
        // The server answers one download only. A second download would find no server.
        let (package_url, package_server) = serve("a.tar.gz", vec![ok(package.clone())]);
        let (feed_url, feed_server) = serve(
            "latest.json",
            vec![ok(feed(
                "0.2.0",
                &package_url,
                &signature(&key, KEY_ID, &package),
            ))],
        );
        let app = app(&feed_url, &key.pubkey);
        let state = app.state::<UpdaterState>();
        check_update(app.handle(), &state)
            .await
            .expect("the feed answers");

        let policy = no_wait(1);
        let (first, second) = tokio::join!(
            install_update(app.handle(), &state, &policy),
            install_update(app.handle(), &state, &policy)
        );

        first.expect("the first install succeeds");
        second.expect("the second install joins the first");
        assert_eq!(feed_server.join().expect("the feed server ends"), 1);
        assert_eq!(package_server.join().expect("the package server ends"), 1);
    }

    #[tokio::test]
    async fn plat_13_an_install_with_no_checked_update_fails() {
        let key = signing_key(KEY_ID);
        let app = app("http://127.0.0.1:9/latest.json", &key.pubkey);
        let state = app.state::<UpdaterState>();

        let error = install_update(app.handle(), &state, &no_wait(1))
            .await
            .expect_err("nothing was checked");

        assert_eq!(error.code(), "updater_nothing_pending");
    }

    #[tokio::test]
    async fn plat_13_a_relaunch_before_the_download_stops_nothing_and_records_nothing() {
        let folder = TempDir::new();
        let key = signing_key(KEY_ID);
        let (feed_url, feed_server) = serve(
            "latest.json",
            vec![ok(feed("0.2.0", "https://example.invalid/a.tar.gz", "sig"))],
        );
        let app = app(&feed_url, &key.pubkey);
        let state = app.state::<UpdaterState>();

        let nothing = install_for_relaunch(app.handle(), &state, folder.path())
            .expect_err("nothing was checked");
        assert_eq!(nothing.code(), "updater_nothing_pending");

        check_update(app.handle(), &state)
            .await
            .expect("the feed answers");
        let not_staged = install_for_relaunch(app.handle(), &state, folder.path())
            .expect_err("nothing was downloaded");
        assert_eq!(not_staged.code(), "updater_not_staged");
        assert!(
            !installed_path(folder.path()).exists(),
            "no update is claimed for the next launch"
        );
        assert_eq!(feed_server.join().expect("the server ends"), 1);
    }

    #[test]
    fn plat_13_installed_notes_only_come_back_for_the_running_version() {
        let folder = TempDir::new();
        let info = UpdateInfo {
            version: "0.2.0".to_string(),
            notes: "The notes.".to_string(),
        };
        save_installed(folder.path(), &info).expect("the record is written");
        let taken = take_installed_update(folder.path(), "0.2.0")
            .expect("the record is readable")
            .expect("the running version matches");
        assert_eq!(taken.notes, "The notes.");
        assert!(
            take_installed_update(folder.path(), "0.2.0")
                .expect("the record is gone")
                .is_none()
        );
    }

    #[test]
    fn plat_13_installed_notes_are_dropped_when_the_bundle_did_not_change() {
        let folder = TempDir::new();
        let info = UpdateInfo {
            version: "0.2.0".to_string(),
            notes: "The notes.".to_string(),
        };
        save_installed(folder.path(), &info).expect("the record is written");
        assert!(
            take_installed_update(folder.path(), "0.1.0")
                .expect("the record is readable")
                .is_none(),
            "an unchanged app version is not an installed update"
        );
        assert!(
            !installed_path(folder.path()).exists(),
            "the stale record is removed"
        );
    }

    #[test]
    fn plat_13_an_unreadable_installed_record_is_an_error() {
        let folder = TempDir::new();
        std::fs::write(installed_path(folder.path()), b"not json").expect("write a broken record");
        assert_eq!(
            take_installed_update(folder.path(), "0.2.0")
                .expect_err("a broken record is not 'no update'")
                .code(),
            "updater_state_unreadable"
        );
    }

    #[test]
    fn plat_13_the_default_retry_waits_longer_each_time_and_then_repeats_the_last_wait() {
        let policy = RetryPolicy::default();
        assert_eq!(policy.attempts, MAX_DOWNLOAD_ATTEMPTS);
        let waits: Vec<u64> = (1..=5)
            .map(|attempt| policy.delay(attempt).as_millis() as u64)
            .collect();
        assert_eq!(waits, vec![1_000, 2_000, 4_000, 8_000, 8_000]);
    }
}
