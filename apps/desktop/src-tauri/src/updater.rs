//! @feature PLAT-13 Self-update that waits until agents are idle
//!
//! Owns: checking a release feed for a newer app version, downloading and verifying that version,
//! staging it for a relaunch, and reporting the notes of an update installed since the last launch.
//! The Rust side moves bytes and verifies them. The UI decides when it is safe to relaunch.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A9 (Updater: a release feed,
//! minisign signatures, a manual update path with retry and persisted state, release notes after
//! relaunch) and A2 (`check_for_updates`, `get_installed_manual_update`).
//!
//! Must handle:
//! - `updater_check` returns `None` when the app is current. A network or feed failure is an error
//!   (`updater_network`, `updater_feed_invalid`), never "no update".
//! - The feed and its public key come from `CONDUCTED_UPDATE_FEED` and
//!   `CONDUCTED_UPDATE_PUBLIC_KEY`, set by the build or the environment. When either is missing the
//!   command fails with `updater_config_missing`; no URL or key is invented.
//! - A bad signature fails with `updater_bad_signature` and the downloaded file is discarded.
//!   Nothing unsigned is staged. The minisign `Ed` (raw Ed25519) scheme is verified; the prehashed
//!   `ED` scheme is refused with `updater_signature_unsupported`, because this module has no
//!   BLAKE2b implementation.
//! - `updater_install` downloads and stages the update, then reports `Ready`. It does not restart
//!   the app. The UI calls `updater_relaunch` once no agent is working.
//! - Calling `updater_install` twice at once joins the first download. Calling it with no checked
//!   update fails with `updater_nothing_pending`.
//! - A download that fails in a way a retry can fix retries with backoff and reports `Downloading`
//!   again. After the last attempt the status is `Failed`.
//! - The pending update, including its staged file, is written beside the app data so a restart
//!   keeps it. A state file that cannot be read is an error, never an empty state.
//! - `updater_relaunch` stops the sidecar, records the update for the next launch, and restarts the
//!   app. Replacing the bundle is the job of the Tauri updater plugin when it is added; the record
//!   is returned by `updater_installed_update` only when the running version matches it, so an
//!   update that did not apply never claims it did.
//! - Every status change is emitted as `updater://status` with the full status. A late listener
//!   reads the stored status through the next event.
//!
//! Our design choice: this module is written against our own command names and does not add
//! `tauri-plugin-updater` yet. The plugin needs a signing key pair and a release feed, which do not
//! exist. Setup when they do: run `cargo tauri signer generate`, put the public key in
//! `plugins.updater.pubkey` and the feed URL in `plugins.updater.endpoints` in tauri.conf.json,
//! set `bundle.createUpdaterArtifacts`, add `tauri-plugin-updater` and `updater:default` to the
//! capability file, register `.plugin(tauri_plugin_updater::Builder::new().build())`, and build
//! releases with `TAURI_SIGNING_PRIVATE_KEY` set. Conductor's CrabNebula feed is theirs and is
//! not reused.
//! Our design choice: minisign verification uses `ring`'s Ed25519 verifier directly, and the feed
//! format is Tauri's (`version`, `notes`, `platforms` with `url` and `signature`). Our feed will
//! use raw `Ed` signatures so no second hash implementation is needed.
//!
//! Test first: with a local feed that serves a newer signed manifest, the check returns the version
//! and notes; with an altered signature the download is refused with `updater_bad_signature` and
//! leaves no staged file.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use futures_util::StreamExt;
use reqwest::Client;
use ring::signature::{ED25519, UnparsedPublicKey};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::io::AsyncWriteExt;

use crate::error::{CommandError, CommandResult, lock};

/// Event carrying the full `UpdaterStatus` after every change.
pub const EVENT_STATUS: &str = "updater://status";
/// Download attempts before the status becomes `Failed`.
pub const MAX_DOWNLOAD_ATTEMPTS: u32 = 5;
/// Pause before each retry. The last value repeats.
pub const RETRY_DELAYS_MS: [u64; 4] = [1_000, 2_000, 4_000, 8_000];
/// Largest feed document read into memory.
pub const MAX_FEED_BYTES: usize = 1_024 * 1_024;
/// Largest update file this app will download.
pub const MAX_UPDATE_BYTES: u64 = 512 * 1_024 * 1_024;
/// How long a feed request or a download may wait for the answer or the next bytes.
pub const NETWORK_TIMEOUT_MS: u64 = 30_000;
/// Environment variable holding our own update feed URL.
pub const FEED_ENV: &str = "CONDUCTED_UPDATE_FEED";
/// Environment variable holding our minisign public key text.
pub const PUBLIC_KEY_ENV: &str = "CONDUCTED_UPDATE_PUBLIC_KEY";
/// Pending update state file inside the updater folder.
const PENDING_FILE: &str = "pending.json";
/// Record of the update installed just before this launch.
const INSTALLED_FILE: &str = "installed.json";

/// Makes each partial download name unique within the process.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// An available update. Mirrors the object `Updater.check` returns in platform.ts.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    /// Release notes as markdown.
    pub notes: String,
}

/// Where the updater is. Sent as `updater://status`.
#[derive(Debug, Clone, Serialize)]
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
    /// Staged and verified. Waiting for `updater_relaunch`.
    Ready {
        version: String,
    },
    Failed {
        code: String,
        message: String,
    },
}

/// An update that was found and maybe staged.
#[derive(Debug, Clone)]
pub struct PendingUpdate {
    pub info: UpdateInfo,
    /// Where the verified download can be fetched from.
    pub url: String,
    /// The minisign signature of the downloaded file.
    pub signature: String,
    /// Set once the download is verified.
    pub staged_at: Option<PathBuf>,
}

/// The feed's platform entry for the update file.
#[derive(Debug, Clone, Deserialize)]
struct UpdateAsset {
    url: String,
    signature: String,
}

/// Tauri's update manifest shape. `notes` is optional so a feed may publish no notes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    platforms: HashMap<String, UpdateAsset>,
}

/// The pending update written to disk, so a restart keeps it.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingRecord {
    version: String,
    notes: String,
    url: String,
    signature: String,
    staged_path: Option<String>,
}

/// The update record read after a relaunch.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledRecord {
    version: String,
    notes: String,
}

/// Where a command reads the feed, the key and the staging folder.
#[derive(Debug, Clone)]
pub struct UpdaterConfig {
    pub feed_url: String,
    pub public_key: String,
    pub staging_dir: PathBuf,
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
pub struct UpdaterState {
    pub pending: Mutex<Option<PendingUpdate>>,
    pub status: Mutex<Option<UpdaterStatus>>,
    install: tokio::sync::Mutex<Option<Arc<InstallJob>>>,
}

impl Default for UpdaterState {
    fn default() -> Self {
        Self {
            pending: Mutex::new(None),
            status: Mutex::new(None),
            install: tokio::sync::Mutex::new(None),
        }
    }
}

fn failed(code: &'static str, message: impl Into<String>) -> CommandError {
    CommandError::Failed {
        code,
        message: message.into(),
    }
}

fn stored_outcome(error: &CommandError) -> StoredOutcome {
    Err((error.code(), error.to_string()))
}

fn restore_outcome(outcome: &StoredOutcome) -> CommandResult<()> {
    outcome
        .clone()
        .map_err(|(code, message)| CommandError::Failed { code, message })
}

/// Configures the updater from the build or the environment. Nothing is defaulted.
fn config_from_app<R: Runtime>(app: &AppHandle<R>) -> CommandResult<UpdaterConfig> {
    let feed_url = configured(FEED_ENV, option_env!("CONDUCTED_UPDATE_FEED"))?;
    let public_key = configured(PUBLIC_KEY_ENV, option_env!("CONDUCTED_UPDATE_PUBLIC_KEY"))?;
    let data_dir = app.path().app_data_dir().map_err(|error| {
        failed(
            "updater_data_dir",
            format!("The app data folder is unknown: {error}"),
        )
    })?;
    Ok(UpdaterConfig {
        feed_url,
        public_key,
        staging_dir: data_dir.join("updates"),
    })
}

fn configured(name: &str, build_value: Option<&'static str>) -> CommandResult<String> {
    if let Ok(value) = std::env::var(name)
        && !value.trim().is_empty()
    {
        return Ok(value);
    }
    if let Some(value) = build_value
        && !value.trim().is_empty()
    {
        return Ok(value.to_string());
    }
    Err(failed(
        "updater_config_missing",
        format!("{name} is not set, so Conducted has no update feed or public key."),
    ))
}

/// Stores a status and reports it to the window. A window that cannot be reached does not make
/// the status wrong; the stored value is what the next call reads.
fn set_status<R: Runtime>(app: &AppHandle<R>, state: &UpdaterState, status: UpdaterStatus) {
    *lock(&state.status) = Some(status.clone());
    if let Err(error) = app.emit(EVENT_STATUS, status) {
        eprintln!("could not send the updater status: {error}");
    }
}

fn fail<R: Runtime>(app: &AppHandle<R>, state: &UpdaterState, error: &CommandError) {
    set_status(
        app,
        state,
        UpdaterStatus::Failed {
            code: error.code().to_string(),
            message: error.to_string(),
        },
    );
}

/// The manifest key for this Mac, as Tauri's updater names its platforms.
fn platform_key() -> CommandResult<String> {
    let arch = match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        "x86_64" => "x86_64",
        other => {
            return Err(failed(
                "updater_platform_missing",
                format!("Conducted has no update for the {other} CPU."),
            ));
        }
    };
    Ok(format!("darwin-{arch}"))
}

/// Splits a version into its numeric parts. Anything after `-` or `+` is not compared.
fn version_parts(version: &str) -> CommandResult<Vec<u64>> {
    let core = version.split(['-', '+']).next().unwrap_or(version);
    let mut parts = Vec::new();
    for part in core.split('.') {
        let number = part.parse::<u64>().map_err(|_| {
            failed(
                "updater_version_invalid",
                format!("The version {version} is not a number this app can compare."),
            )
        })?;
        parts.push(number);
    }
    if parts.is_empty() {
        return Err(failed(
            "updater_version_invalid",
            format!("The version {version} is empty."),
        ));
    }
    Ok(parts)
}

/// True when `candidate` is newer than `current`.
pub fn is_newer(candidate: &str, current: &str) -> CommandResult<bool> {
    let candidate = version_parts(candidate)?;
    let current = version_parts(current)?;
    for (left, right) in candidate.iter().zip(current.iter()) {
        if left != right {
            return Ok(left > right);
        }
    }
    Ok(candidate.len() > current.len())
}

/// Picks the update for this platform, when the feed has a newer one.
fn pending_from_manifest(
    manifest: &UpdateManifest,
    current_version: &str,
) -> CommandResult<Option<PendingUpdate>> {
    if !is_newer(&manifest.version, current_version)? {
        return Ok(None);
    }
    let key = platform_key()?;
    let asset = manifest.platforms.get(&key).ok_or_else(|| {
        failed(
            "updater_platform_missing",
            format!("The update feed has no file for {key}."),
        )
    })?;
    Ok(Some(PendingUpdate {
        info: UpdateInfo {
            version: manifest.version.clone(),
            notes: manifest.notes.clone(),
        },
        url: asset.url.clone(),
        signature: asset.signature.clone(),
        staged_at: None,
    }))
}

/// Reads the feed. A network failure is an error, never an empty update list.
async fn fetch_manifest(config: &UpdaterConfig) -> CommandResult<UpdateManifest> {
    let client = Client::builder()
        .timeout(Duration::from_millis(NETWORK_TIMEOUT_MS))
        .build()
        .map_err(|error| {
            failed(
                "updater_network",
                format!("Could not build the HTTP client: {error}"),
            )
        })?;
    let response = client.get(&config.feed_url).send().await.map_err(|error| {
        failed(
            "updater_network",
            format!("Could not reach the update feed: {error}"),
        )
    })?;
    if !response.status().is_success() {
        return Err(failed(
            "updater_network",
            format!("The update feed answered {}", response.status()),
        ));
    }
    let bytes = response.bytes().await.map_err(|error| {
        failed(
            "updater_network",
            format!("Could not read the update feed: {error}"),
        )
    })?;
    if bytes.len() > MAX_FEED_BYTES {
        return Err(failed(
            "updater_feed_invalid",
            "The update feed is larger than this app accepts.",
        ));
    }
    serde_json::from_slice(&bytes).map_err(|error| {
        failed(
            "updater_feed_invalid",
            format!("The update feed could not be read: {error}"),
        )
    })
}

/// The first base64 line of a minisign document, after its comments.
fn minisign_block(text: &str) -> CommandResult<Vec<u8>> {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| {
            !line.is_empty()
                && !line.starts_with("untrusted comment:")
                && !line.starts_with("trusted comment:")
        })
        .ok_or_else(|| failed("updater_bad_signature", "The minisign document is empty."))?;
    STANDARD.decode(line).map_err(|error| {
        failed(
            "updater_bad_signature",
            format!("The minisign document is not base64: {error}"),
        )
    })
}

/// True when the minisign algorithm says the file was signed without a prehash.
fn is_raw_signature(algorithm: &[u8]) -> bool {
    algorithm == b"Ed"
}

/// Verifies a raw minisign `Ed` signature over the downloaded bytes.
fn verify_signature(data: &[u8], signature_text: &str, public_key_text: &str) -> CommandResult<()> {
    let public = minisign_block(public_key_text)?;
    if public.len() != 42 {
        return Err(failed(
            "updater_bad_signature",
            "The minisign public key is not 42 bytes.",
        ));
    }
    if !is_raw_signature(&public[0..2]) {
        return Err(failed(
            "updater_signature_unsupported",
            "The update public key uses a minisign scheme this app cannot verify.",
        ));
    }
    let signature = minisign_block(signature_text)?;
    if signature.len() != 74 {
        return Err(failed(
            "updater_bad_signature",
            "The minisign signature is not 74 bytes.",
        ));
    }
    if !is_raw_signature(&signature[0..2]) {
        return Err(failed(
            "updater_signature_unsupported",
            "The update uses a prehashed minisign signature, which this app cannot verify yet.",
        ));
    }
    if public[2..10] != signature[2..10] {
        return Err(failed(
            "updater_bad_signature",
            "The update was signed with a different key than the app's public key.",
        ));
    }
    UnparsedPublicKey::new(&ED25519, &public[10..42])
        .verify(data, &signature[10..74])
        .map_err(|_| {
            failed(
                "updater_bad_signature",
                "The update signature does not match.",
            )
        })
}

/// A download failure, with whether another attempt can succeed.
struct DownloadFailure {
    code: &'static str,
    message: String,
    retryable: bool,
}

impl DownloadFailure {
    fn into_error(self) -> CommandError {
        failed(self.code, self.message)
    }
}

/// Downloads one file to `partial`, reporting its progress.
async fn download_once<F>(
    url: &str,
    partial: &Path,
    version: &str,
    mut on_status: F,
) -> std::result::Result<(), DownloadFailure>
where
    F: FnMut(UpdaterStatus),
{
    let client = Client::builder()
        .timeout(Duration::from_millis(NETWORK_TIMEOUT_MS))
        .build()
        .map_err(|error| DownloadFailure {
            code: "updater_network",
            message: format!("Could not build the HTTP client: {error}"),
            retryable: false,
        })?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| DownloadFailure {
            code: "updater_network",
            message: format!("Could not reach the update file: {error}"),
            retryable: true,
        })?;
    if !response.status().is_success() {
        let status = response.status();
        return Err(DownloadFailure {
            code: "updater_network",
            message: format!("The update file answered {status}"),
            retryable: status.is_server_error() || status.as_u16() == 429,
        });
    }
    let total = response.content_length();
    if total.is_some_and(|size| size > MAX_UPDATE_BYTES) {
        return Err(DownloadFailure {
            code: "updater_package_too_large",
            message: "The update file is larger than this app accepts.".to_string(),
            retryable: false,
        });
    }
    let mut file = tokio::fs::File::create(partial)
        .await
        .map_err(|error| DownloadFailure {
            code: "updater_state_write",
            message: format!("Could not create the download file: {error}"),
            retryable: false,
        })?;
    let mut received = 0_u64;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| DownloadFailure {
            code: "updater_network",
            message: format!("The update download stopped: {error}"),
            retryable: true,
        })?;
        received += chunk.len() as u64;
        if received > MAX_UPDATE_BYTES {
            return Err(DownloadFailure {
                code: "updater_package_too_large",
                message: "The update file is larger than this app accepts.".to_string(),
                retryable: false,
            });
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| DownloadFailure {
                code: "updater_state_write",
                message: format!("Could not write the update file: {error}"),
                retryable: false,
            })?;
        on_status(UpdaterStatus::Downloading {
            version: version.to_string(),
            received,
            total,
        });
    }
    file.flush().await.map_err(|error| DownloadFailure {
        code: "updater_state_write",
        message: format!("Could not finish the update file: {error}"),
        retryable: false,
    })?;
    Ok(())
}

/// Removes a half-written download. Nothing there is fine; a file that stays is reported, because
/// the caller is already returning the error that matters.
async fn remove_partial(path: &Path) {
    if let Err(error) = tokio::fs::remove_file(path).await
        && error.kind() != std::io::ErrorKind::NotFound
    {
        eprintln!(
            "could not remove the partial download {}: {error}",
            path.display()
        );
    }
}

/// A version safe to use in a file name.
fn safe_version(version: &str) -> String {
    version
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '.' || character == '-' {
                character
            } else {
                '_'
            }
        })
        .collect()
}

/// Downloads, verifies and stages one update. Retries failures another attempt can fix.
async fn download_and_stage<F>(
    config: &UpdaterConfig,
    pending: &PendingUpdate,
    policy: &RetryPolicy,
    mut on_status: F,
) -> CommandResult<PathBuf>
where
    F: FnMut(UpdaterStatus),
{
    tokio::fs::create_dir_all(&config.staging_dir)
        .await
        .map_err(|error| {
            failed(
                "updater_state_write",
                format!("Could not create the update folder: {error}"),
            )
        })?;
    let staged = config.staging_dir.join(format!(
        "Conducted-{}.app.tar.gz",
        safe_version(&pending.info.version)
    ));
    if staged.exists() {
        let data = tokio::fs::read(&staged).await.map_err(|error| {
            failed(
                "updater_state_read",
                format!("Could not read the staged update: {error}"),
            )
        })?;
        verify_signature(&data, &pending.signature, &config.public_key)?;
        return Ok(staged);
    }
    let partial = config.staging_dir.join(format!(
        ".download-{}-{}.part",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let attempts = policy.attempts.max(1);
    let mut last: Option<DownloadFailure> = None;
    for attempt in 1..=attempts {
        match download_once(&pending.url, &partial, &pending.info.version, |status| {
            on_status(status)
        })
        .await
        {
            Ok(()) => {
                let data = tokio::fs::read(&partial).await.map_err(|error| {
                    failed(
                        "updater_state_read",
                        format!("Could not read the download: {error}"),
                    )
                })?;
                if let Err(error) = verify_signature(&data, &pending.signature, &config.public_key)
                {
                    remove_partial(&partial).await;
                    return Err(error);
                }
                tokio::fs::rename(&partial, &staged)
                    .await
                    .map_err(|error| {
                        failed(
                            "updater_state_write",
                            format!("Could not stage the update: {error}"),
                        )
                    })?;
                return Ok(staged);
            }
            Err(failure) => {
                remove_partial(&partial).await;
                if !failure.retryable || attempt == attempts {
                    return Err(failure.into_error());
                }
                tokio::time::sleep(policy.delay(attempt)).await;
                last = Some(failure);
            }
        }
    }
    Err(last
        .map(DownloadFailure::into_error)
        .unwrap_or_else(|| failed("updater_network", "The update download did not start.")))
}

fn pending_path(config: &UpdaterConfig) -> PathBuf {
    config.staging_dir.join(PENDING_FILE)
}

fn installed_path(config: &UpdaterConfig) -> PathBuf {
    config.staging_dir.join(INSTALLED_FILE)
}

/// Writes the pending update after every change, so a restart keeps it.
fn save_pending(config: &UpdaterConfig, pending: &PendingUpdate) -> CommandResult<()> {
    std::fs::create_dir_all(&config.staging_dir).map_err(|error| {
        failed(
            "updater_state_write",
            format!("Could not create the update folder: {error}"),
        )
    })?;
    let record = PendingRecord {
        version: pending.info.version.clone(),
        notes: pending.info.notes.clone(),
        url: pending.url.clone(),
        signature: pending.signature.clone(),
        staged_path: pending
            .staged_at
            .as_ref()
            .map(|path| path.to_string_lossy().into_owned()),
    };
    let text = serde_json::to_vec_pretty(&record).map_err(|error| {
        failed(
            "updater_state_write",
            format!("Could not write the update state: {error}"),
        )
    })?;
    std::fs::write(pending_path(config), text).map_err(|error| {
        failed(
            "updater_state_write",
            format!("Could not save the update state: {error}"),
        )
    })
}

/// Reads the pending update. A missing file is an empty state; a broken one is an error.
fn load_pending(config: &UpdaterConfig) -> CommandResult<Option<PendingUpdate>> {
    let text = match std::fs::read(pending_path(config)) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(failed(
                "updater_state_read",
                format!("Could not read the update state: {error}"),
            ));
        }
    };
    let record: PendingRecord = serde_json::from_slice(&text).map_err(|error| {
        failed(
            "updater_state_unreadable",
            format!("The update state could not be read: {error}"),
        )
    })?;
    Ok(Some(PendingUpdate {
        info: UpdateInfo {
            version: record.version,
            notes: record.notes,
        },
        url: record.url,
        signature: record.signature,
        staged_at: record.staged_path.map(PathBuf::from),
    }))
}

/// Removes a state file, treating "already gone" as done.
fn remove_file(path: &Path) -> CommandResult<()> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(failed(
            "updater_state_write",
            format!("Could not remove {}: {error}", path.display()),
        )),
    }
}

fn save_installed(config: &UpdaterConfig, info: &UpdateInfo) -> CommandResult<()> {
    std::fs::create_dir_all(&config.staging_dir).map_err(|error| {
        failed(
            "updater_state_write",
            format!("Could not create the update folder: {error}"),
        )
    })?;
    let record = InstalledRecord {
        version: info.version.clone(),
        notes: info.notes.clone(),
    };
    let text = serde_json::to_vec_pretty(&record).map_err(|error| {
        failed(
            "updater_state_write",
            format!("Could not write the installed update: {error}"),
        )
    })?;
    std::fs::write(installed_path(config), text).map_err(|error| {
        failed(
            "updater_state_write",
            format!("Could not save the installed update: {error}"),
        )
    })
}

/// Returns the update installed just before this launch, once, and only if the running version
/// is that update. A record for another version means the bundle was not replaced.
fn take_installed_update(
    config: &UpdaterConfig,
    current_version: &str,
) -> CommandResult<Option<UpdateInfo>> {
    let text = match std::fs::read(installed_path(config)) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(failed(
                "updater_state_read",
                format!("Could not read the installed update: {error}"),
            ));
        }
    };
    let record: InstalledRecord = serde_json::from_slice(&text).map_err(|error| {
        failed(
            "updater_state_unreadable",
            format!("The installed update could not be read: {error}"),
        )
    })?;
    remove_file(&installed_path(config))?;
    if record.version != current_version {
        return Ok(None);
    }
    Ok(Some(UpdateInfo {
        version: record.version,
        notes: record.notes,
    }))
}

/// Asks the release feed whether a newer version exists.
#[tauri::command]
pub async fn updater_check(
    app: AppHandle,
    state: State<'_, UpdaterState>,
) -> CommandResult<Option<UpdateInfo>> {
    let current_version = app.package_info().version.to_string();
    let config = match config_from_app(&app) {
        Ok(config) => config,
        Err(error) => {
            fail(&app, &state, &error);
            return Err(error);
        }
    };
    set_status(&app, &state, UpdaterStatus::Checking);
    let manifest = match fetch_manifest(&config).await {
        Ok(manifest) => manifest,
        Err(error) => {
            fail(&app, &state, &error);
            return Err(error);
        }
    };
    let pending = match pending_from_manifest(&manifest, &current_version) {
        Ok(pending) => pending,
        Err(error) => {
            fail(&app, &state, &error);
            return Err(error);
        }
    };
    match pending {
        Some(pending) => {
            if let Err(error) = save_pending(&config, &pending) {
                fail(&app, &state, &error);
                return Err(error);
            }
            let info = pending.info.clone();
            *lock(&state.pending) = Some(pending);
            set_status(
                &app,
                &state,
                UpdaterStatus::Available {
                    version: info.version.clone(),
                },
            );
            Ok(Some(info))
        }
        None => {
            *lock(&state.pending) = None;
            if let Err(error) = remove_file(&pending_path(&config)) {
                fail(&app, &state, &error);
                return Err(error);
            }
            set_status(&app, &state, UpdaterStatus::Idle);
            Ok(None)
        }
    }
}

/// Downloads and verifies the update found by the last check.
#[tauri::command]
pub async fn updater_install(app: AppHandle, state: State<'_, UpdaterState>) -> CommandResult<()> {
    let config = match config_from_app(&app) {
        Ok(config) => config,
        Err(error) => {
            fail(&app, &state, &error);
            return Err(error);
        }
    };
    let pending = {
        let in_memory = lock(&state.pending).clone();
        match in_memory {
            Some(pending) => Some(pending),
            None => match load_pending(&config) {
                Ok(pending) => pending,
                Err(error) => {
                    fail(&app, &state, &error);
                    return Err(error);
                }
            },
        }
    };
    let Some(pending) = pending else {
        let error = failed(
            "updater_nothing_pending",
            "No update has been checked, so there is nothing to install.",
        );
        fail(&app, &state, &error);
        return Err(error);
    };
    if pending.staged_at.as_ref().is_some_and(|path| path.exists()) {
        set_status(
            &app,
            &state,
            UpdaterStatus::Ready {
                version: pending.info.version.clone(),
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
    let result = run_install(&app, &state, &config, pending).await;
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

async fn run_install(
    app: &AppHandle,
    state: &UpdaterState,
    config: &UpdaterConfig,
    pending: PendingUpdate,
) -> CommandResult<()> {
    set_status(
        app,
        state,
        UpdaterStatus::Downloading {
            version: pending.info.version.clone(),
            received: 0,
            total: None,
        },
    );
    let staged = match download_and_stage(config, &pending, &RetryPolicy::default(), |status| {
        set_status(app, state, status)
    })
    .await
    {
        Ok(staged) => staged,
        Err(error) => {
            fail(app, state, &error);
            return Err(error);
        }
    };
    let mut updated = pending.clone();
    updated.staged_at = Some(staged);
    if let Err(error) = save_pending(config, &updated) {
        fail(app, state, &error);
        return Err(error);
    }
    *lock(&state.pending) = Some(updated.clone());
    set_status(
        app,
        state,
        UpdaterStatus::Ready {
            version: updated.info.version,
        },
    );
    Ok(())
}

/// Applies a staged update and restarts the app.
#[tauri::command]
pub async fn updater_relaunch(app: AppHandle, state: State<'_, UpdaterState>) -> CommandResult<()> {
    let config = match config_from_app(&app) {
        Ok(config) => config,
        Err(error) => {
            fail(&app, &state, &error);
            return Err(error);
        }
    };
    let pending = {
        let in_memory = lock(&state.pending).clone();
        match in_memory {
            Some(pending) => Some(pending),
            None => match load_pending(&config) {
                Ok(pending) => pending,
                Err(error) => {
                    fail(&app, &state, &error);
                    return Err(error);
                }
            },
        }
    };
    let Some(pending) = pending else {
        let error = failed(
            "updater_nothing_pending",
            "No update is ready, so there is nothing to relaunch into.",
        );
        fail(&app, &state, &error);
        return Err(error);
    };
    let Some(staged) = pending.staged_at.clone() else {
        let error = failed(
            "updater_not_staged",
            "The update has not been downloaded and verified yet.",
        );
        fail(&app, &state, &error);
        return Err(error);
    };
    if !staged.exists() {
        let error = failed(
            "updater_not_staged",
            "The staged update file is gone, so it must be downloaded again.",
        );
        fail(&app, &state, &error);
        return Err(error);
    }
    if let Err(error) = save_installed(&config, &pending.info) {
        fail(&app, &state, &error);
        return Err(error);
    }
    let sidecar = app.state::<crate::sidecar::SidecarState>();
    if let Err(error) = crate::sidecar::shutdown(&sidecar).await {
        fail(&app, &state, &error);
        return Err(error);
    }
    remove_file(&pending_path(&config))?;
    app.restart();
}

/// The update installed just before this launch, so its release notes can be shown once.
#[tauri::command]
pub fn updater_installed_update(app: AppHandle) -> CommandResult<Option<UpdateInfo>> {
    let config = config_from_app(&app)?;
    let current_version = app.package_info().version.to_string();
    take_installed_update(&config, &current_version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    use ring::rand::SystemRandom;
    use ring::signature::{Ed25519KeyPair, KeyPair};

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
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    const KEY_ID: [u8; 8] = [1, 2, 3, 4, 5, 6, 7, 8];

    struct SigningKey {
        pair: Ed25519KeyPair,
        public_text: String,
    }

    fn signing_key() -> SigningKey {
        let rng = SystemRandom::new();
        let pkcs8 = Ed25519KeyPair::generate_pkcs8(&rng).expect("generate a test key");
        let pair = Ed25519KeyPair::from_pkcs8(pkcs8.as_ref()).expect("read the test key");
        let mut blob = Vec::new();
        blob.extend_from_slice(b"Ed");
        blob.extend_from_slice(&KEY_ID);
        blob.extend_from_slice(pair.public_key().as_ref());
        let public_text = format!(
            "untrusted comment: conducted test key\n{}\n",
            STANDARD.encode(blob)
        );
        SigningKey { pair, public_text }
    }

    fn signature_text(key: &SigningKey, data: &[u8]) -> String {
        let signature = key.pair.sign(data);
        let mut blob = Vec::new();
        blob.extend_from_slice(b"Ed");
        blob.extend_from_slice(&KEY_ID);
        blob.extend_from_slice(signature.as_ref());
        format!(
            "untrusted comment: conducted test signature\n{}\ntrusted comment: test\n{}\n",
            STANDARD.encode(blob),
            STANDARD.encode(b"global signature")
        )
    }

    fn config(folder: &TempDir, feed_url: &str, public_text: &str) -> UpdaterConfig {
        UpdaterConfig {
            feed_url: feed_url.to_string(),
            public_key: public_text.to_string(),
            staging_dir: folder.path().join("updates"),
        }
    }

    struct Response {
        status: u16,
        body: Vec<u8>,
    }

    /// A local feed server. Each answer is sent to one request, then the server stops.
    fn serve(answers: Vec<Response>) -> (String, thread::JoinHandle<usize>) {
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
                let _ = stream.flush();
                served += 1;
            }
            served
        });
        ready_rx.recv().expect("the test server starts");
        (format!("http://{address}/feed"), server)
    }

    fn manifest_json(url: &str, signature: &str, version: &str) -> Vec<u8> {
        let key = platform_key().expect("this test CPU has an update key");
        serde_json::to_vec(&serde_json::json!({
            "version": version,
            "notes": "The notes for this version.",
            "platforms": {
                key: { "url": url, "signature": signature }
            }
        }))
        .expect("write the manifest")
    }

    #[test]
    fn plat_13_a_feed_manifest_names_the_update_file_and_signature() {
        let body = manifest_json("https://example.test/app.tar.gz", "signature", "0.2.0");
        let manifest: UpdateManifest =
            serde_json::from_slice(&body).expect("the feed shape is read");
        assert_eq!(manifest.version, "0.2.0");
        let asset = manifest
            .platforms
            .get(&platform_key().expect("this test CPU has an update key"))
            .expect("the file for this Mac is in the feed");
        assert_eq!(asset.url, "https://example.test/app.tar.gz");
        assert_eq!(asset.signature, "signature");
    }

    #[test]
    fn plat_13_a_newer_version_is_an_update() {
        assert!(is_newer("0.2.0", "0.1.9").expect("both versions are valid"));
        assert!(is_newer("1.0.0", "0.99.99").expect("both versions are valid"));
        assert!(!is_newer("1.0.0", "1.0.0").expect("both versions are valid"));
        assert!(!is_newer("1.0.0", "1.0.1").expect("both versions are valid"));
    }

    #[test]
    fn plat_13_an_invalid_version_is_an_error_not_an_answer() {
        assert_eq!(
            is_newer("next", "1.0.0")
                .expect_err("a word is not a version")
                .code(),
            "updater_version_invalid"
        );
    }

    #[test]
    fn plat_13_a_manifest_for_this_platform_becomes_a_pending_update() {
        let key = platform_key().expect("this test CPU has an update key");
        let manifest = UpdateManifest {
            version: "0.2.0".to_string(),
            notes: "Fixed the thing.".to_string(),
            platforms: HashMap::from([(
                key,
                UpdateAsset {
                    url: "https://example.test/app.tar.gz".to_string(),
                    signature: "signature".to_string(),
                },
            )]),
        };
        let pending = pending_from_manifest(&manifest, "0.1.0")
            .expect("the manifest is valid")
            .expect("the version is newer");
        assert_eq!(pending.info.version, "0.2.0");
        assert_eq!(pending.info.notes, "Fixed the thing.");
        assert_eq!(pending.staged_at, None);
    }

    #[test]
    fn plat_13_the_current_version_is_not_an_update() {
        let manifest = UpdateManifest {
            version: "0.1.0".to_string(),
            notes: String::new(),
            platforms: HashMap::new(),
        };
        assert!(
            pending_from_manifest(&manifest, "0.1.0")
                .expect("the manifest is valid")
                .is_none()
        );
    }

    #[test]
    fn plat_13_a_missing_platform_entry_is_an_error() {
        let manifest = UpdateManifest {
            version: "0.2.0".to_string(),
            notes: String::new(),
            platforms: HashMap::new(),
        };
        assert_eq!(
            pending_from_manifest(&manifest, "0.1.0")
                .expect_err("there is no file for this Mac")
                .code(),
            "updater_platform_missing"
        );
    }

    #[test]
    fn plat_13_a_signature_for_other_bytes_is_refused() {
        let key = signing_key();
        let error = verify_signature(
            b"the update",
            &signature_text(&key, b"other bytes"),
            &key.public_text,
        )
        .expect_err("the signature does not cover these bytes");
        assert_eq!(error.code(), "updater_bad_signature");
    }

    #[test]
    fn plat_13_a_signature_with_a_different_key_is_refused() {
        let signer = signing_key();
        let other = signing_key();
        let error = verify_signature(
            b"the update",
            &signature_text(&signer, b"the update"),
            &other.public_text,
        )
        .expect_err("the keys do not match");
        assert_eq!(error.code(), "updater_bad_signature");
    }

    #[tokio::test]
    async fn plat_13_a_verified_download_is_staged() {
        let folder = TempDir::new();
        let key = signing_key();
        let body = b"the signed update".to_vec();
        let signature = signature_text(&key, &body);
        let (url, server) = serve(vec![Response {
            status: 200,
            body: body.clone(),
        }]);
        let config = config(&folder, &url, &key.public_text);
        let pending = PendingUpdate {
            info: UpdateInfo {
                version: "0.2.0".to_string(),
                notes: String::new(),
            },
            url,
            signature,
            staged_at: None,
        };
        let staged = download_and_stage(&config, &pending, &RetryPolicy::default(), |_| {})
            .await
            .expect("a correctly signed update is staged");
        assert_eq!(std::fs::read(&staged).expect("read the staged file"), body);
        assert!(staged.ends_with("Conducted-0.2.0.app.tar.gz"));
        assert_eq!(server.join().expect("the server ends"), 1);
    }

    #[tokio::test]
    async fn plat_13_a_bad_signature_leaves_no_staged_file() {
        let folder = TempDir::new();
        let key = signing_key();
        let downloaded = b"the downloaded update".to_vec();
        let signature = signature_text(&key, b"the update we signed");
        let (url, server) = serve(vec![Response {
            status: 200,
            body: downloaded,
        }]);
        let config = config(&folder, &url, &key.public_text);
        let pending = PendingUpdate {
            info: UpdateInfo {
                version: "0.2.0".to_string(),
                notes: String::new(),
            },
            url,
            signature,
            staged_at: None,
        };
        let error = download_and_stage(&config, &pending, &RetryPolicy::default(), |_| {})
            .await
            .expect_err("the signature does not cover the download");
        assert_eq!(error.code(), "updater_bad_signature");
        let staged = config.staging_dir.join("Conducted-0.2.0.app.tar.gz");
        assert!(!staged.exists(), "nothing unsigned is staged");
        let leftovers: Vec<_> = std::fs::read_dir(&config.staging_dir)
            .expect("the staging folder exists")
            .filter_map(std::result::Result::ok)
            .map(|entry| entry.file_name())
            .collect();
        assert!(
            leftovers.is_empty(),
            "the partial file is removed: {leftovers:?}"
        );
        assert_eq!(server.join().expect("the server ends"), 1);
    }

    #[tokio::test]
    async fn plat_13_a_download_retries_and_then_succeeds() {
        let folder = TempDir::new();
        let key = signing_key();
        let body = b"the signed update".to_vec();
        let signature = signature_text(&key, &body);
        let (url, server) = serve(vec![
            Response {
                status: 500,
                body: Vec::new(),
            },
            Response {
                status: 200,
                body: body.clone(),
            },
        ]);
        let config = config(&folder, &url, &key.public_text);
        let pending = PendingUpdate {
            info: UpdateInfo {
                version: "0.2.0".to_string(),
                notes: String::new(),
            },
            url,
            signature,
            staged_at: None,
        };
        let policy = RetryPolicy {
            attempts: 2,
            delays_ms: vec![0],
        };
        let staged = download_and_stage(&config, &pending, &policy, |_| {})
            .await
            .expect("the second attempt succeeds");
        assert_eq!(std::fs::read(&staged).expect("read the staged file"), body);
        assert_eq!(server.join().expect("the server ends"), 2);
    }

    #[tokio::test]
    async fn plat_13_a_failed_download_stops_after_the_attempt_limit() {
        let folder = TempDir::new();
        let key = signing_key();
        let (url, server) = serve(vec![
            Response {
                status: 500,
                body: Vec::new(),
            },
            Response {
                status: 500,
                body: Vec::new(),
            },
        ]);
        let config = config(&folder, &url, &key.public_text);
        let pending = PendingUpdate {
            info: UpdateInfo {
                version: "0.2.0".to_string(),
                notes: String::new(),
            },
            url,
            signature: "unused".to_string(),
            staged_at: None,
        };
        let policy = RetryPolicy {
            attempts: 2,
            delays_ms: vec![0],
        };
        let error = download_and_stage(&config, &pending, &policy, |_| {})
            .await
            .expect_err("both attempts fail");
        assert_eq!(error.code(), "updater_network");
        assert!(
            std::fs::read_dir(&config.staging_dir)
                .expect("the staging folder exists")
                .next()
                .is_none()
        );
        assert_eq!(server.join().expect("the server ends"), 2);
    }

    #[test]
    fn plat_13_a_pending_update_survives_a_restart() {
        let folder = TempDir::new();
        let config = config(&folder, "https://example.test/feed", "unused");
        let pending = PendingUpdate {
            info: UpdateInfo {
                version: "0.2.0".to_string(),
                notes: "Notes".to_string(),
            },
            url: "https://example.test/app.tar.gz".to_string(),
            signature: "signature".to_string(),
            staged_at: Some(folder.path().join("Conducted-0.2.0.app.tar.gz")),
        };
        save_pending(&config, &pending).expect("the state is written");
        let loaded = load_pending(&config)
            .expect("the state is readable")
            .expect("a pending update is there");
        assert_eq!(loaded.info.version, "0.2.0");
        assert_eq!(loaded.staged_at, pending.staged_at);
    }

    #[test]
    fn plat_13_an_unreadable_state_file_is_an_error() {
        let folder = TempDir::new();
        let config = config(&folder, "https://example.test/feed", "unused");
        std::fs::create_dir_all(&config.staging_dir).expect("create the staging folder");
        std::fs::write(pending_path(&config), b"not json").expect("write a broken state");
        assert_eq!(
            load_pending(&config)
                .expect_err("a broken state is not an empty state")
                .code(),
            "updater_state_unreadable"
        );
    }

    #[test]
    fn plat_13_installed_notes_only_come_back_for_the_running_version() {
        let folder = TempDir::new();
        let config = config(&folder, "https://example.test/feed", "unused");
        let info = UpdateInfo {
            version: "0.2.0".to_string(),
            notes: "The notes.".to_string(),
        };
        save_installed(&config, &info).expect("the record is written");
        let taken = take_installed_update(&config, "0.2.0")
            .expect("the record is readable")
            .expect("the running version matches");
        assert_eq!(taken.notes, "The notes.");
        assert!(
            take_installed_update(&config, "0.2.0")
                .expect("the record is gone")
                .is_none()
        );
    }

    #[test]
    fn plat_13_installed_notes_are_dropped_when_the_bundle_did_not_change() {
        let folder = TempDir::new();
        let config = config(&folder, "https://example.test/feed", "unused");
        let info = UpdateInfo {
            version: "0.2.0".to_string(),
            notes: "The notes.".to_string(),
        };
        save_installed(&config, &info).expect("the record is written");
        assert!(
            take_installed_update(&config, "0.1.0")
                .expect("the record is readable")
                .is_none(),
            "an unchanged app version is not an installed update"
        );
        assert!(
            !installed_path(&config).exists(),
            "the stale record is removed"
        );
    }
}
