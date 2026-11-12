//! @feature PLAT-28 Agent program manager: download, verify, update, prune
//!
//! Owns: Claude Code following its newest compatible release (D133): reading the `latest` pointer
//! and that release's `manifest.json` from Claude Code's release host, choosing whether to move
//! (`choose`), installing the chosen release with the size and SHA-256 its manifest states
//! (`follow_newest`), and running that check at launch and once a day (`start_following`).
//! `ClaudeReleases` names the host, the floor and the SDK; `FollowNote` is what Settings >
//! Advanced says about which copy runs and why.
//!
//! Behaviour: issue #541. The release host publishes `<base>/latest` (the newest version as plain
//! text) and `<base>/<version>/manifest.json` (version, `platforms[].checksum` and `.size`,
//! `sdkCompat.testedWrapperVersions`); Claude Code's own installer reads the same two files
//! (https://claude.ai/install.sh). The release feed's version is the floor and the answer when the
//! host cannot be read. A release whose manifest does not list the Claude Agent SDK the sidecar
//! pins is never installed. D088 stays: the managed copy is still the only one the app chooses.
//!
//! Must handle:
//! - The host cannot be reached, answers an error or sends something that is not a version or a
//!   manifest: the running copy stays, and the note says why.
//! - A newer release that does not list our SDK: skipped, and the note names it.
//! - A download whose size or SHA-256 differs from its manifest: refused; the running copy stays
//!   and no temporary file is left (`http::download_request`, `fetch_release`).
//! - A running chat: it keeps the path it started with. The version it runs stays on disk until
//!   the next launch (`ProgramsState::used`), and only a new chat gets the new link.
//! - A check while an install of Claude Code runs: skipped; the hourly tick tries again.
//! - The app exits: the loop and a running check stop (`ProgramsState::cancel_all`).
//!
//! Our design choice: only the `latest` pointer is read. The host publishes no list of versions,
//! so a newer release between the one installed and `latest` is never seen; when `latest` does
//! not list our SDK, the app stays on the newest one it saw that did.
//! Our design choice: a follow download keeps the program Ready, so the send gate (services-map
//! 5A.8.1) never holds a chat while a newer copy arrives in the background.
//! Our design choice: the check runs at launch and then whenever a day has passed on the wall
//! clock, looked at once an hour, so a Mac that slept still checks the day it wakes.
//!
//! Test first: with the saved 2.1.322 manifest, a Mac on 2.1.311 moves to 2.1.322 for new chats.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tokio_util::sync::CancellationToken;

use super::{
    AssetFormat, InstallContext, InstallExtras, ManagedProgram, ProgramRelease, ProgramStatus,
    ProgramsState, ReleaseAsset, StatusSink, fetch_release, installed_copy, now_ms, pinned_version,
};
use crate::error::{CommandError, CommandResult};

/// Where Claude Code's releases are published. The release feed's URLs point here too.
pub const CLAUDE_RELEASES: &str = "https://downloads.claude.ai/claude-code-releases";

/// The Claude Agent SDK the sidecar pins, read from `packages/sidecar/package.json` by build.rs.
pub const CLAUDE_AGENT_SDK: &str = env!("CONDUCTED_CLAUDE_AGENT_SDK");

/// How long after one check the next one is due.
pub const CHECK_EVERY_MS: u64 = 24 * 60 * 60 * 1000;

/// How often the loop looks at the wall clock to see whether a check is due.
const CHECK_TICK: Duration = Duration::from_secs(60 * 60);

/// What Claude Code follows: the host it reads, the version the app ships with, and the SDK a
/// release must list. The app passes `ClaudeReleases::app()`; a test passes its own server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaudeReleases {
    /// The folder that holds `latest` and `<version>/manifest.json`.
    pub base: String,
    /// The release feed's version: the oldest the app runs and the answer when the host is out of
    /// reach.
    pub floor: String,
    /// The Claude Agent SDK version a release's `sdkCompat` must list.
    pub sdk: String,
}

impl ClaudeReleases {
    /// The app's own: the official host, the pinned version and the SDK the sidecar is built with.
    pub fn app() -> Self {
        Self {
            base: CLAUDE_RELEASES.to_string(),
            floor: pinned_version(ManagedProgram::Claude).to_string(),
            sdk: CLAUDE_AGENT_SDK.to_string(),
        }
    }
}

/// What the last look at the release host found, as Settings > Advanced says it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FollowCheck {
    /// The host is being read now.
    Checking,
    /// The copy that runs is the newest release. `latest` is the host's newest version.
    Newest { latest: String },
    /// A newer release is out, but its manifest does not list the SDK, so it is skipped.
    Untested { latest: String },
    /// A newer release is downloading for new chats.
    Downloading { latest: String },
    /// The host could not be read, or the newer release was refused.
    Failed { error: String },
}

/// Which Claude Code runs and why, carried on Claude Code's status. Mirrors `ProgramFollow` in
/// platform.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowNote {
    /// The version the app ships with.
    pub shipped: String,
    /// The Claude Agent SDK a release must list.
    pub sdk: String,
    /// What the last look at the host found. None before the first one.
    pub check: Option<FollowCheck>,
}

impl FollowNote {
    pub fn new(releases: &ClaudeReleases) -> Self {
        Self {
            shipped: releases.floor.clone(),
            sdk: releases.sdk.clone(),
            check: None,
        }
    }
}

/// The parts of a release's `manifest.json` the app reads.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseManifestFile {
    version: String,
    #[serde(default)]
    platforms: HashMap<String, PlatformFile>,
    sdk_compat: Option<SdkCompat>,
}

#[derive(Debug, Deserialize)]
struct PlatformFile {
    checksum: Option<String>,
    size: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SdkCompat {
    #[serde(default)]
    tested_wrapper_versions: Vec<String>,
}

/// A release to install: its version, its file for this Mac, and the SDK versions its manifest
/// tested, which the install records so a later launch can check them again.
#[derive(Debug, Clone)]
pub struct FollowTarget {
    pub version: String,
    pub asset: ReleaseAsset,
    pub sdk_compat: Option<Vec<String>>,
}

impl FollowTarget {
    /// The feed's own release, which needs no SDK record: the feed is the floor.
    pub fn from_feed(release: &ProgramRelease) -> Self {
        Self {
            version: release.version.clone(),
            asset: super::asset_for(release).clone(),
            sdk_compat: None,
        }
    }
}

/// What to do after reading the host.
#[derive(Debug)]
pub enum FollowChoice {
    /// Keep the copy that runs; the check says why.
    Stay(FollowCheck),
    /// Install this newer release.
    Install(FollowTarget),
}

/// The manifest's name for this Mac's file.
pub fn platform() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "darwin-arm64"
    } else {
        "darwin-x64"
    }
}

/// An `x.y.z` version as numbers. Anything else, a pre-release included, is not a version the
/// app follows.
pub fn parse_version(text: &str) -> Option<[u64; 3]> {
    let mut parts = text.split('.');
    let mut numbers = [0u64; 3];
    for number in &mut numbers {
        let part = parts.next()?;
        if part.is_empty() || !part.chars().all(|character| character.is_ascii_digit()) {
            return None;
        }
        *number = part.parse().ok()?;
    }
    parts.next().is_none().then_some(numbers)
}

fn invalid(message: String) -> CommandError {
    CommandError::Failed {
        code: "program_follow_invalid",
        message,
    }
}

/// Decides, from the host's `latest` pointer and that release's manifest, whether the Mac moves
/// from `running` to a newer release. A release no newer than `running` stays; a newer one that
/// does not list `releases.sdk` stays and is named; a newer one without a checksum and size for
/// `platform` is refused.
pub fn choose(
    pointer: &str,
    manifest: &str,
    running: &str,
    releases: &ClaudeReleases,
    platform: &str,
) -> CommandResult<FollowChoice> {
    let latest = pointer.trim();
    let latest_number = parse_version(latest).ok_or_else(|| {
        invalid(format!(
            "The release host's latest version is not a version: {latest:?}."
        ))
    })?;
    let running_number = parse_version(running)
        .ok_or_else(|| invalid(format!("The running version {running} is not a version.")))?;
    let file: ReleaseManifestFile = serde_json::from_str(manifest).map_err(|error| {
        invalid(format!(
            "Claude Code {latest}'s manifest could not be read: {error}"
        ))
    })?;
    if file.version != latest {
        return Err(invalid(format!(
            "Claude Code {latest}'s manifest names version {}.",
            file.version
        )));
    }
    if latest_number <= running_number {
        return Ok(FollowChoice::Stay(FollowCheck::Newest {
            latest: latest.to_string(),
        }));
    }
    let tested = file
        .sdk_compat
        .map(|compat| compat.tested_wrapper_versions)
        .unwrap_or_default();
    if !tested.iter().any(|version| version == &releases.sdk) {
        return Ok(FollowChoice::Stay(FollowCheck::Untested {
            latest: latest.to_string(),
        }));
    }
    let entry = file.platforms.get(platform);
    let checksum = entry.and_then(|entry| entry.checksum.as_deref());
    let size = entry.and_then(|entry| entry.size).filter(|size| *size > 0);
    let (Some(checksum), Some(size)) = (checksum, size) else {
        return Err(invalid(format!(
            "Claude Code {latest}'s manifest has no checksum and size for {platform}."
        )));
    };
    let sha256 = crate::http::parse_sha256(checksum).map_err(|_| {
        invalid(format!(
            "Claude Code {latest}'s manifest has a bad checksum for {platform}."
        ))
    })?;
    Ok(FollowChoice::Install(FollowTarget {
        version: latest.to_string(),
        asset: ReleaseAsset {
            url: format!("{}/{latest}/{platform}/claude", releases.base),
            sha256,
            size,
            format: AssetFormat::Raw,
        },
        sdk_compat: Some(tested),
    }))
}

/// Reads one text file from the release host. A cancel stops the read.
async fn read_text(
    ctx: &InstallContext,
    url: String,
    cancel: &CancellationToken,
) -> CommandResult<String> {
    let request = crate::http::HttpRequestInput {
        url: url.clone(),
        method: "GET".to_string(),
        headers: None,
        body: None,
        timeout_ms: Some(ctx.stall_timeout.as_millis() as u64),
    };
    let response = tokio::select! {
        biased;
        _ = cancel.cancelled() => {
            return Err(CommandError::Failed {
                code: "http_cancelled",
                message: "The check for a newer Claude Code was cancelled.".to_string(),
            });
        }
        response = crate::http::fetch_request(ctx.allowed_hosts, request) => response?,
    };
    if response.status != 200 {
        return Err(CommandError::Failed {
            code: "http_status",
            message: format!("The release host answered {} for {url}.", response.status),
        });
    }
    Ok(response.body)
}

/// Reads the host's `latest` pointer and that release's manifest, and chooses.
async fn read_and_choose(
    ctx: &InstallContext,
    releases: &ClaudeReleases,
    running: &str,
    cancel: &CancellationToken,
) -> CommandResult<FollowChoice> {
    let pointer = read_text(ctx, format!("{}/latest", releases.base), cancel).await?;
    let latest = pointer.trim();
    if parse_version(latest).is_none() {
        return Err(invalid(format!(
            "The release host's latest version is not a version: {latest:?}."
        )));
    }
    let manifest = read_text(
        ctx,
        format!("{}/{latest}/manifest.json", releases.base),
        cancel,
    )
    .await?;
    choose(&pointer, &manifest, running, releases, platform())
}

/// The release a first install or a re-download of Claude Code fetches: the newest one that lists
/// the SDK, or the feed's floor when none newer does or the host cannot be read. The check says
/// which, for the note.
pub async fn install_target(
    ctx: &InstallContext,
    releases: &ClaudeReleases,
    floor: &ProgramRelease,
    cancel: &CancellationToken,
) -> (FollowTarget, FollowCheck) {
    match read_and_choose(ctx, releases, &floor.version, cancel).await {
        Ok(FollowChoice::Install(target)) => {
            let latest = target.version.clone();
            (target, FollowCheck::Newest { latest })
        }
        Ok(FollowChoice::Stay(check)) => (FollowTarget::from_feed(floor), check),
        Err(error) => (
            FollowTarget::from_feed(floor),
            FollowCheck::Failed {
                error: error.to_string(),
            },
        ),
    }
}

/// Looks for a newer compatible Claude Code and installs it for new chats. The caller holds
/// Claude Code's run and slot. A Claude Code that is not installed is left to the install, which
/// fetches the newest compatible release itself. Returns an error only for a status it could not
/// send.
pub async fn follow_newest(
    ctx: &InstallContext,
    state: &ProgramsState,
    sink: &dyn StatusSink,
    cancel: &CancellationToken,
) -> CommandResult<()> {
    let Some(releases) = ctx.claude_releases.as_ref() else {
        return Ok(());
    };
    let program = ManagedProgram::Claude;
    let Some((running, _)) = installed_copy(&ctx.dirs, program, Some(releases)) else {
        return Ok(());
    };
    state.set_follow_check(sink, program, FollowCheck::Checking)?;
    let choice = read_and_choose(ctx, releases, &running, cancel).await;
    if cancel.is_cancelled() {
        return Ok(());
    }
    let target = match choice {
        Ok(FollowChoice::Install(target)) => target,
        Ok(FollowChoice::Stay(check)) => return state.set_follow_check(sink, program, check),
        Err(error) => {
            return state.set_follow_check(
                sink,
                program,
                FollowCheck::Failed {
                    error: error.to_string(),
                },
            );
        }
    };
    let latest = target.version.clone();
    state.set_follow_check(
        sink,
        program,
        FollowCheck::Downloading {
            latest: latest.clone(),
        },
    )?;
    let extras = InstallExtras {
        keep: state.used(program),
        sdk_compat: target.sdk_compat.clone(),
    };
    let fetched = fetch_release(
        ctx,
        program,
        &target,
        &extras,
        cancel,
        |_, _| Ok(()),
        |_| Ok(()),
    )
    .await;
    if cancel.is_cancelled() {
        return Ok(());
    }
    match fetched {
        Ok(fetched) => {
            state.note_check(program, FollowCheck::Newest { latest });
            state.publish(
                sink,
                ProgramStatus {
                    error: fetched.installed.prune_error.map(|error| error.to_string()),
                    ..ProgramStatus::installed(program, &target.version, &fetched.binary)
                },
            )
        }
        Err(error) => state.set_follow_check(
            sink,
            program,
            FollowCheck::Failed {
                error: format!("Claude Code {latest} could not be installed: {error}"),
            },
        ),
    }
}

/// Runs one check, unless an install of Claude Code is running. True when it ran.
pub async fn follow_once(
    ctx: &InstallContext,
    state: &ProgramsState,
    sink: &dyn StatusSink,
) -> CommandResult<bool> {
    let program = ManagedProgram::Claude;
    let Some((id, cancel)) = state.begin(program) else {
        return Ok(false);
    };
    let slot = state.slot(program);
    let held = slot.lock().await;
    let result = if cancel.is_cancelled() {
        Ok(())
    } else {
        follow_newest(ctx, state, sink, &cancel).await
    };
    state.finish(program, id);
    drop(held);
    result.map(|()| true)
}

/// True when a check is due: never checked, or a day has passed since the last one.
pub fn check_due(last_checked_ms: Option<u64>, now_ms: u64) -> bool {
    last_checked_ms.is_none_or(|last| now_ms.saturating_sub(last) >= CHECK_EVERY_MS)
}

/// Checks at launch and whenever a day has passed, until the app exits.
pub fn start_following<R: Runtime>(app: &AppHandle<R>, ctx: InstallContext, state: ProgramsState) {
    let sink: Arc<dyn StatusSink> = Arc::new(app.clone());
    let stopping = state.stopping();
    tauri::async_runtime::spawn(async move {
        let mut last_checked: Option<u64> = None;
        loop {
            if check_due(last_checked, now_ms()) {
                match follow_once(&ctx, &state, sink.as_ref()).await {
                    Ok(true) => last_checked = Some(now_ms()),
                    Ok(false) => {}
                    Err(error) => {
                        state.keep_error(ManagedProgram::Claude, &error);
                        last_checked = Some(now_ms());
                    }
                }
            }
            tokio::select! {
                _ = stopping.cancelled() => return,
                _ = tokio::time::sleep(CHECK_TICK) => {}
            }
        }
    });
}
