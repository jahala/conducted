//! @feature PLAT-16 `conducted://` deep links
//!
//! Owns: receiving `conducted://` URLs from macOS (a click in another app, a browser, a
//! notification) and passing them to the UI. The UI parses them and picks the route.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A8 (Deep links: the scheme list,
//! the host selects the route, cold-start links arrive through `deep-link://new-url` and
//! `plugin:deep-link|get_current`, notification clicks reuse the same router).
//!
//! Must handle:
//! - Only the `conducted` scheme is accepted. Other schemes are dropped and logged, because the
//!   OS can hand over anything registered to the app.
//! - The URL is passed on as a string without being decoded. Parsing belongs to the UI, which
//!   owns the route table. Links longer than `MAX_URL_BYTES` are dropped.
//! - A link that arrives while the app is starting is not lost. The UI reads cold-start links
//!   with the plugin's `getCurrent` call and also listens to `app://deep-link` for later ones.
//! - A link that arrives while the app is already running brings the window to the front.
//! - Several links in a row are delivered in order, one event each.
//!
//! Our design choice: no `conducted-alpha`, `-beta` or similar scheme variants. Conductor needs
//! them for its release channels; we ship one channel for now.
//! Our design choice: a second launch with a URL needs `tauri-plugin-single-instance` with its
//! `deep-link` feature so the link reaches the running app. It is added when the shell is built
//! out, together with the macOS Info.plist scheme registration already in tauri.conf.json.
//!
//! Test first: `normalise("conducted://workspace?id=1")` returns the URL unchanged and
//! `normalise("https://example.com")` fails with `deep_link_bad_scheme`.

use tauri::AppHandle;

use crate::error::CommandResult;
use crate::not_implemented;

/// Event carrying one accepted URL as a string.
pub const EVENT_DEEP_LINK: &str = "app://deep-link";
/// The one scheme this app accepts.
pub const SCHEME: &str = "conducted";
/// Longest accepted URL.
pub const MAX_URL_BYTES: usize = 64 * 1024;

/// Checks the scheme and length of a URL and returns it for forwarding.
pub fn normalise(_url: &str) -> CommandResult<String> {
    not_implemented!("PLAT-16")
}

/// Registers the plugin's open-url handler. Each accepted URL is shown (window to the front) and
/// emitted as `app://deep-link`. Called once from `run()`.
pub fn register(_app: &AppHandle) -> CommandResult<()> {
    not_implemented!("PLAT-16")
}
