//! @feature PLAT-13 Self-update that waits until agents are idle
//!
//! Owns: checking for a new version, downloading and verifying it, and applying it on relaunch.
//! The Rust side only moves bytes. The UI decides when it is safe to relaunch.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A9 (Updater: the Tauri updater
//! plugin does the normal update, signatures are minisign with an embedded public key,
//! `updater.rs` adds a manual path with retry and persisted state, status events
//! `manual_update_status`) and A2 (`check_for_updates`, `get_installed_manual_update`).
//!
//! Must handle:
//! - `updater_check` returns `None` when the app is current. A network failure is an error
//!   (`updater_network`), never "no update".
//! - A bad signature fails with `updater_bad_signature` and the download is discarded. Nothing
//!   unsigned is ever installed.
//! - `updater_install` downloads and stages the update, then reports `Ready`. It does not restart
//!   the app. The UI calls `updater_relaunch` once no agent is working (CHAT services know that),
//!   and shows "Update ready, restarts when agents are idle" until then.
//! - Calling `updater_install` twice at once returns the same in-flight work, not a second
//!   download. Calling it with no checked update fails with `updater_nothing_pending`.
//! - A download interrupted by sleep or a dropped connection retries with backoff and reports
//!   `Downloading` progress again. After the retry limit the status is `Failed`.
//! - `updater_relaunch` stops the sidecar and terminals first (the app's quit path), then lets
//!   the plugin replace the bundle and restart.
//! - Every status change is emitted as `updater://status` with the full status, so a UI that
//!   attaches late still shows the right state after the next event. The newest status wins.
//!
//! Our design choice: this module is written against our own command names and does not add
//! `tauri-plugin-updater` yet. The plugin needs a signing key pair and a release feed, which do not
//! exist. Setup when they do: run `cargo tauri signer generate`, put the public key in
//! `plugins.updater.pubkey` and the feed URL in `plugins.updater.endpoints` in tauri.conf.json,
//! set `bundle.createUpdaterArtifacts`, add `tauri-plugin-updater` and `updater:default` to the
//! capability file, register `.plugin(tauri_plugin_updater::Builder::new().build())`, and build
//! releases with `TAURI_SIGNING_PRIVATE_KEY` set. Conductor's CrabNebula feed is theirs and is
//! not reused.
//!
//! Test first: with a local feed that serves a newer signed manifest, `updater_check` returns the
//! version and notes; with an altered signature `updater_install` fails with
//! `updater_bad_signature` and leaves no staged file.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::error::CommandResult;
use crate::not_implemented;

/// Event carrying the full `UpdaterStatus` after every change.
pub const EVENT_STATUS: &str = "updater://status";
/// Download attempts before the status becomes `Failed`.
pub const MAX_DOWNLOAD_ATTEMPTS: u32 = 5;

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
    /// Set once the download is verified.
    pub staged_at: Option<PathBuf>,
}

/// Shared state, registered once with `.manage(UpdaterState::default())`.
#[derive(Default)]
pub struct UpdaterState {
    pub pending: Mutex<Option<PendingUpdate>>,
    pub status: Mutex<Option<UpdaterStatus>>,
}

/// Asks the release feed whether a newer version exists.
#[tauri::command]
#[allow(unused_variables)]
pub async fn updater_check(
    app: AppHandle,
    state: State<'_, UpdaterState>,
) -> CommandResult<Option<UpdateInfo>> {
    not_implemented!("PLAT-13")
}

/// Downloads and verifies the update found by the last check.
#[tauri::command]
#[allow(unused_variables)]
pub async fn updater_install(app: AppHandle, state: State<'_, UpdaterState>) -> CommandResult<()> {
    not_implemented!("PLAT-13")
}

/// Applies a staged update and restarts the app.
#[tauri::command]
#[allow(unused_variables)]
pub async fn updater_relaunch(app: AppHandle, state: State<'_, UpdaterState>) -> CommandResult<()> {
    not_implemented!("PLAT-13")
}
