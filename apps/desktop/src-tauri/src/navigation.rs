//! @feature PLAT-22 Navigation guard and content security policy
//!
//! Owns: keeping the web view on the app's own pages, opening other web links in the user's
//! browser, and the content security policy in `tauri.conf.json`.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`navigation_guard.rs`: keeps
//! the web view on the app origin, external links open in the browser).
//!
//! Must handle:
//! - The app's own origins are allowed: `tauri://localhost` in a release build and the dev server
//!   (`http://localhost:1420`) in `tauri dev`. Nothing else is allowed.
//! - An `http` or `https` link to another host opens in the default browser, and the web view stays
//!   where it was. This covers link clicks, `target="_blank"` and `window.open`.
//! - Other schemes (`file:`, `javascript:`, `data:`, an unknown app scheme) are blocked, not opened.
//! - A URL that does not parse is blocked.
//! - `about:blank` is allowed.
//! - The content security policy replaces `"csp": null`. It allows the app's own origin, the IPC
//!   channel and, in development only, the dev server and its web socket. It lists no remote
//!   script source. Images from `https` hosts (avatars, GitHub attachments) and `data:` URLs stay
//!   allowed for pictures only. The exact string is written when this is built and checked by
//!   loading every screen with the policy on.
//!
//! Our design choice: the decision is a pure function of the URL and the allowed origins, so it is
//! tested without a window. `install_guard` is the only part that touches Tauri.
//!
//! Test first: `decide_navigation("https://example.com/a", &origins)` is `OpenInBrowser`, and
//! `decide_navigation("tauri://localhost/index.html", &origins)` is `Allow`.

use tauri::AppHandle;

use crate::error::CommandResult;
use crate::not_implemented;

/// What to do with a navigation the web view asks for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationDecision {
    /// The web view goes there.
    Allow,
    /// The URL opens in the default browser and the web view stays.
    OpenInBrowser,
    /// Nothing happens.
    Block,
}

/// Decides for one URL. `app_origins` holds origins such as `tauri://localhost`.
pub fn decide_navigation(_url: &str, _app_origins: &[&str]) -> CommandResult<NavigationDecision> {
    not_implemented!("PLAT-22")
}

/// Hooks the guard into the main window. Called once from `setup`.
pub fn install_guard(_app: &AppHandle) -> CommandResult<()> {
    not_implemented!("PLAT-22")
}
