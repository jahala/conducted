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
//! - A Codex visualization's page (`visualization://localhost/<id>`, CHAT-22) is allowed. Tauri
//!   asks this guard about every frame's navigation, not only the window's, so the visualization
//!   frame could not load without it. The frame is sandboxed without `allow-top-navigation`, so
//!   it cannot move the window there.
//! - The content security policy replaces `"csp": null`. It allows the app's own origin, the IPC
//!   channel and, in development only, the dev server and its web socket. It lists no remote
//!   script source. Images from `https` hosts (avatars, GitHub attachments) and `data:` URLs stay
//!   allowed for pictures only. Local files reach `<object>` (PDF previews) and `<video>` (video
//!   previews, chat videos) through the asset protocol only (`asset:` and `http://asset.localhost`).
//!   Frames may load the visualization scheme (`visualization:`), whose pages carry their own
//!   policy; the app's `script-src` stays `'self'`. The directives the policy must contain are checked against
//!   `tauri.conf.json` in this module's test. Loading every screen with the policy on is not
//!   covered by a test yet.
//!
//! Our design choice: the decision is a pure function of the URL and the allowed origins, so it is
//! tested without a window. The `window.open` script is tested in JavaScript
//! (`src/platform/navigation-shim.plat-22.test.ts` reads it from this file and runs it in jsdom). `install_guard` is the only part that touches Tauri. It registers a
//! plugin for navigation, because a handler cannot be attached to a window after it was built, and
//! injects a small script for `window.open`, which WebKit otherwise sends to a new-window request
//! that nothing handles.
//!
//! Test first: `decide_navigation("https://example.com/a", &origins)` is `OpenInBrowser`, and
//! `decide_navigation("tauri://localhost/index.html", &origins)` is `Allow`.

use tauri::plugin::Builder as PluginBuilder;
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, Url, Webview, Wry};
use tauri_plugin_opener::OpenerExt;

use crate::error::{CommandError, CommandResult};
use crate::visualization;

/// Origin of the bundled web UI in a release build.
pub const RELEASE_ORIGIN: &str = "tauri://localhost";
/// Origin of the Vite dev server used by `tauri dev`.
pub const DEV_ORIGIN: &str = "http://localhost:1420";
const RELEASE_ORIGINS: &[&str] = &[RELEASE_ORIGIN];
const DEV_ORIGINS: &[&str] = &[DEV_ORIGIN];
/// Name of the navigation plugin registered in `setup`.
const PLUGIN_NAME: &str = "navigation-guard";
/// Hands `window.open` requests to the browser. A link click with `target="_blank"` is already
/// handled by the opener plugin; a script call is not, and WebKit's new-window request is denied
/// when no builder attached a handler.
const OPEN_WINDOW_SHIM: &str = r#"(() => {
  const original = window.open;
  window.open = function (url, ...rest) {
    try {
      const target = new URL(String(url), window.location.href);
      const external = target.protocol === "http:" || target.protocol === "https:";
      if (external && target.origin !== window.location.origin) {
        window.__TAURI_INTERNALS__.invoke("plugin:opener|open_url", { url: target.href });
        return null;
      }
    } catch {}
    return original.call(window, url, ...rest);
  };
})();"#;

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

/// The origins this build keeps in the web view.
pub fn app_origins() -> &'static [&'static str] {
    if tauri::is_dev() {
        DEV_ORIGINS
    } else {
        RELEASE_ORIGINS
    }
}

/// Decides for one URL. `app_origins` holds origins such as `tauri://localhost`.
pub fn decide_navigation(url: &str, app_origins: &[&str]) -> NavigationDecision {
    let Ok(parsed) = Url::parse(url) else {
        return NavigationDecision::Block;
    };

    if parsed.scheme() == "about" && parsed.path() == "blank" {
        return NavigationDecision::Allow;
    }

    if is_app_origin(&parsed, app_origins) {
        return NavigationDecision::Allow;
    }

    if parsed.scheme() == visualization::SCHEME && parsed.host_str() == Some("localhost") {
        return NavigationDecision::Allow;
    }

    match parsed.scheme() {
        "http" | "https" => NavigationDecision::OpenInBrowser,
        _ => NavigationDecision::Block,
    }
}

/// Hooks the guard into the main window. Called once from `setup`.
pub fn install_guard(app: &AppHandle) -> CommandResult<()> {
    let plugin = PluginBuilder::<Wry>::new(PLUGIN_NAME)
        .on_navigation(guard_navigation)
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }
            if let Err(error) = webview.eval(OPEN_WINDOW_SHIM) {
                eprintln!("navigation guard: could not install the window.open guard: {error}");
            }
        })
        .build();

    app.plugin(plugin).map_err(|error| CommandError::Failed {
        code: "navigation_guard",
        message: error.to_string(),
    })?;

    if let Some(webview) = app.get_webview_window("main")
        && let Err(error) = webview.eval(OPEN_WINDOW_SHIM)
    {
        eprintln!("navigation guard: could not install the window.open guard: {error}");
    }

    Ok(())
}

fn guard_navigation(webview: &Webview<Wry>, url: &Url) -> bool {
    match decide_navigation(url.as_str(), app_origins()) {
        NavigationDecision::Allow => true,
        NavigationDecision::OpenInBrowser => {
            if let Err(error) = webview.opener().open_url(url.to_string(), None::<&str>) {
                eprintln!("navigation guard: could not open {url} in the browser: {error}");
            }
            false
        }
        NavigationDecision::Block => false,
    }
}

fn is_app_origin(url: &Url, app_origins: &[&str]) -> bool {
    let Some(origin) = origin_of(url) else {
        return false;
    };

    app_origins
        .iter()
        .filter_map(|allowed| Url::parse(allowed).ok())
        .filter_map(|allowed| origin_of(&allowed))
        .any(|allowed| allowed == origin)
}

/// Serialises the scheme, host and port the way the user would write the origin.
fn origin_of(url: &Url) -> Option<String> {
    let host = url.host_str()?;
    match url.port() {
        Some(port) => Some(format!("{}://{host}:{port}", url.scheme())),
        None => Some(format!("{}://{host}", url.scheme())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The page WebKit offers before any real navigation.
    const ABOUT_BLANK: &str = "about:blank";

    fn decide(url: &str, origins: &[&str]) -> NavigationDecision {
        decide_navigation(url, origins)
    }

    #[test]
    fn plat_22_external_https_opens_in_the_browser() {
        assert_eq!(
            decide("https://example.com/a", RELEASE_ORIGINS),
            NavigationDecision::OpenInBrowser
        );
    }

    #[test]
    fn plat_22_external_http_opens_in_the_browser() {
        assert_eq!(
            decide("http://example.com/a", RELEASE_ORIGINS),
            NavigationDecision::OpenInBrowser
        );
    }

    #[test]
    fn plat_22_release_origin_is_allowed() {
        assert_eq!(
            decide("tauri://localhost/index.html", RELEASE_ORIGINS),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn plat_22_dev_origin_is_allowed() {
        assert_eq!(
            decide("http://localhost:1420/settings", DEV_ORIGINS),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn plat_22_same_host_on_another_port_opens_in_the_browser() {
        assert_eq!(
            decide("http://localhost:3000/a", DEV_ORIGINS),
            NavigationDecision::OpenInBrowser
        );
    }

    #[test]
    fn plat_22_another_tauri_host_is_blocked() {
        assert_eq!(
            decide("tauri://elsewhere.example/index.html", RELEASE_ORIGINS),
            NavigationDecision::Block
        );
    }

    #[test]
    fn plat_22_other_schemes_are_blocked() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hello",
            "conducted://workspace?id=1",
        ] {
            assert_eq!(
                decide(url, RELEASE_ORIGINS),
                NavigationDecision::Block,
                "{url}"
            );
        }
    }

    #[test]
    fn chat_22_a_visualization_page_is_allowed() {
        assert_eq!(
            decide(
                "visualization://localhost/0123456789abcdef0123456789abcdef",
                RELEASE_ORIGINS
            ),
            NavigationDecision::Allow
        );
        assert_eq!(
            decide("visualization://elsewhere/0123", RELEASE_ORIGINS),
            NavigationDecision::Block
        );
    }

    #[test]
    fn plat_22_unparseable_url_is_blocked() {
        assert_eq!(
            decide("not a url", RELEASE_ORIGINS),
            NavigationDecision::Block
        );
    }

    #[test]
    fn plat_22_about_blank_is_allowed() {
        assert_eq!(
            decide(ABOUT_BLANK, RELEASE_ORIGINS),
            NavigationDecision::Allow
        );
    }

    #[test]
    fn plat_22_other_about_pages_are_blocked() {
        assert_eq!(
            decide("about:srcdoc", RELEASE_ORIGINS),
            NavigationDecision::Block
        );
    }

    fn directive<'a>(csp: &'a str, name: &str) -> &'a str {
        csp.split(';')
            .map(str::trim)
            .find(|directive| directive.split_whitespace().next() == Some(name))
            .unwrap_or("")
    }

    #[test]
    fn plat_22_tauri_conf_sets_a_content_security_policy() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json parses");
        let security = &config["app"]["security"];

        let csp = security["csp"].as_str().expect("csp is a string");
        assert!(!csp.trim().is_empty(), "csp is not empty");

        let script = directive(csp, "script-src");
        assert!(
            script.split_whitespace().any(|source| source == "'self'"),
            "script-src allows the app's own bundle"
        );
        assert!(
            !script.contains("http:") && !script.contains("https:") && !script.contains('*'),
            "script-src allows no remote source: {script}"
        );

        let images = directive(csp, "img-src");
        assert!(
            images.split_whitespace().any(|source| source == "https:"),
            "img-src allows https pictures: {images}"
        );
        assert!(
            images.split_whitespace().any(|source| source == "data:"),
            "img-src allows data pictures: {images}"
        );

        let connect = directive(csp, "connect-src");
        assert!(
            connect.split_whitespace().any(|source| source == "'self'"),
            "connect-src allows the app's own origin: {connect}"
        );
        assert!(
            connect.split_whitespace().any(|source| source == "ipc:"),
            "connect-src allows the IPC channel: {connect}"
        );
        assert!(
            connect
                .split_whitespace()
                .any(|source| source == "http://ipc.localhost"),
            "connect-src allows the IPC host: {connect}"
        );

        let dev = security["devCsp"].as_str().expect("devCsp is a string");
        let dev_connect = directive(dev, "connect-src");
        assert!(
            dev_connect
                .split_whitespace()
                .any(|source| source == DEV_ORIGIN),
            "dev connect-src allows the dev server: {dev_connect}"
        );
        assert!(
            dev_connect
                .split_whitespace()
                .any(|source| source == "ws://localhost:1420"),
            "dev connect-src allows the default hot-reload socket: {dev_connect}"
        );
        assert!(
            dev_connect
                .split_whitespace()
                .any(|source| source == "ws://localhost:1421"),
            "dev connect-src allows the hot-reload socket when a dev host is set: {dev_connect}"
        );
        assert_eq!(
            config["build"]["devUrl"].as_str(),
            Some(DEV_ORIGIN),
            "build.devUrl is the origin the guard allows"
        );
        assert!(
            directive(dev, "default-src")
                .split_whitespace()
                .any(|source| source == DEV_ORIGIN),
            "dev default-src allows the dev server"
        );
    }

    /// The asset protocol URL `convertFileSrc` gives a local file: `asset://localhost/...` on macOS,
    /// `http://asset.localhost/...` elsewhere. PDF previews load it in `<object>`, and video previews
    /// and chat videos in `<video>`, so both directives must allow it, in release and in development.
    #[test]
    fn plat_22_csp_lets_pdf_and_video_previews_load_local_files() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json parses");
        let security = &config["app"]["security"];
        for key in ["csp", "devCsp"] {
            let csp = security[key].as_str().expect("the policy is a string");
            for name in ["object-src", "media-src"] {
                let sources = directive(csp, name);
                for asset in ["asset:", "http://asset.localhost"] {
                    assert!(
                        sources.split_whitespace().any(|source| source == asset),
                        "{key} {name} allows {asset}: {sources}"
                    );
                }
                assert!(
                    !sources.contains("'none'") && !sources.contains('*'),
                    "{key} {name} names its sources and nothing wider: {sources}"
                );
            }
        }
    }
}
