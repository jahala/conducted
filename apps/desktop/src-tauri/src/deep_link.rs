//! @feature PLAT-16 `conducted://` deep links
//!
//! Owns: receiving `conducted://` URLs from macOS (a click in another app, a browser, a
//! notification) and passing them to the UI. The UI parses them and picks the route.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A8 (Deep links: the scheme list,
//! the host selects the route, cold-start links arrive through the plugin's current URL and
//! `deep-link://new-url`, notification clicks reuse the same router).
//!
//! Must handle:
//! - Only the `conducted` scheme is accepted. Other schemes are dropped and logged, because the
//!   OS can hand over anything registered to the app.
//! - The URL is passed on as a string without being decoded. Parsing belongs to the UI, which
//!   owns the route table. Links longer than `MAX_URL_BYTES` are dropped.
//! - A link that arrives while the app is already running brings the window to the front.
//! - A launch link is not missed: the UI reads the plugin's current URL when it subscribes
//!   (`platform/tauri.ts`), and this module forwards every later link on the plugin's event.
//! - Several links in a row are delivered in order, one event each.
//!
//! Our design choice: no `conducted-alpha`, `-beta` or similar scheme variants. Conductor needs
//! them for its release channels; we ship one channel for now.
//! Our design choice: a second launch with a URL needs `tauri-plugin-single-instance`. The
//! one-instance guard is PLAT-27's, so that path is not part of this module.
//!
//! Test first: `normalise("conducted://workspace?id=1")` returns the URL unchanged and
//! `normalise("https://example.com")` fails with `deep_link_bad_scheme`.

use tauri::{AppHandle, Emitter, Manager, Runtime, Url};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::error::{CommandError, CommandResult};

/// Event carrying one accepted URL as a string.
pub const EVENT_DEEP_LINK: &str = "app://deep-link";
/// The one scheme this app accepts.
pub const SCHEME: &str = "conducted";
/// Longest accepted URL.
pub const MAX_URL_BYTES: usize = 64 * 1024;

fn bad_scheme() -> CommandError {
    CommandError::Failed {
        code: "deep_link_bad_scheme",
        message: format!("A deep link must start with {SCHEME}://."),
    }
}

fn too_long() -> CommandError {
    CommandError::Failed {
        code: "deep_link_too_long",
        message: format!("A deep link longer than {MAX_URL_BYTES} bytes was dropped."),
    }
}

/// Checks the scheme and length of a URL and returns it for forwarding.
pub fn normalise(url: &str) -> CommandResult<String> {
    if url.len() > MAX_URL_BYTES {
        return Err(too_long());
    }

    let Some((scheme, _)) = url.split_once("://") else {
        return Err(bad_scheme());
    };
    if !scheme.eq_ignore_ascii_case(SCHEME) {
        return Err(bad_scheme());
    }

    Ok(url.to_owned())
}

/// Brings the one window to the front, so a link opened from another app is noticed.
fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Err(error) = window.set_focus() {
        eprintln!("deep link: could not bring the window to the front: {error}");
    }
}

/// Forwards each accepted URL, in order, as one `app://deep-link` event. A rejected URL is logged
/// and the links after it still go on.
fn deliver<R: Runtime>(app: &AppHandle<R>, urls: Vec<Url>) {
    for url in urls {
        let raw = url.to_string();
        match normalise(&raw) {
            Ok(link) => {
                focus_main(app);
                if let Err(error) = app.emit(EVENT_DEEP_LINK, link) {
                    eprintln!("deep link: could not send the link to the UI: {error}");
                }
            }
            Err(error) => eprintln!("deep link: dropped a URL: {error}"),
        }
    }
}

/// Registers the plugin's open-url handler. Each accepted URL is shown (window to the front) and
/// emitted as `app://deep-link`. Called once from `run()`.
pub fn register<R: Runtime>(app: &AppHandle<R>) -> CommandResult<()> {
    app.deep_link().on_open_url({
        let app = app.clone();
        move |event| deliver(&app, event.urls())
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tauri::Listener;

    use super::*;

    fn app_with_the_plugin() -> tauri::App<tauri::test::MockRuntime> {
        tauri::test::mock_builder()
            .plugin(tauri_plugin_deep_link::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("build a mock app with the deep-link plugin")
    }

    fn received(app: &tauri::App<tauri::test::MockRuntime>) -> std::sync::mpsc::Receiver<String> {
        let (sender, events) = std::sync::mpsc::channel::<String>();
        app.handle().listen(EVENT_DEEP_LINK, move |event| {
            let _ = sender.send(event.payload().to_string());
        });
        events
    }

    #[test]
    fn plat_16_a_conducted_link_is_returned_unchanged() {
        let url = "conducted://workspace?id=1&session=2&prompt=a%20b";
        assert_eq!(normalise(url).expect("the link is accepted"), url);
    }

    #[test]
    fn plat_16_the_scheme_is_matched_without_case() {
        assert_eq!(
            normalise("CONDUCTED://workspace?id=1").expect("a scheme is case-insensitive"),
            "CONDUCTED://workspace?id=1"
        );
    }

    #[test]
    fn plat_16_another_scheme_fails_with_deep_link_bad_scheme() {
        let error = normalise("https://example.com").expect_err("the scheme is refused");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "deep_link_bad_scheme",
                ..
            }
        ));
    }

    #[test]
    fn plat_16_a_variant_scheme_is_refused() {
        let error = normalise("conducted-beta://workspace?id=1").expect_err("there is one scheme");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "deep_link_bad_scheme",
                ..
            }
        ));
    }

    #[test]
    fn plat_16_a_string_without_a_scheme_is_refused() {
        let error = normalise("workspace?id=1").expect_err("a bare string is not a link");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "deep_link_bad_scheme",
                ..
            }
        ));
    }

    #[test]
    fn plat_16_a_link_over_the_limit_is_refused() {
        let url = format!("conducted://workspace?id={}", "x".repeat(MAX_URL_BYTES));
        let error = normalise(&url).expect_err("the link is too long");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "deep_link_too_long",
                ..
            }
        ));
    }

    #[test]
    fn plat_16_a_link_of_exactly_the_limit_is_accepted() {
        let prefix = "conducted://workspace?id=";
        let url = format!("{prefix}{}", "x".repeat(MAX_URL_BYTES - prefix.len()));
        assert_eq!(url.len(), MAX_URL_BYTES);
        assert!(normalise(&url).is_ok());
    }

    #[test]
    fn plat_16_the_app_registers_only_the_conducted_scheme() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json is JSON");
        let schemes = config["plugins"]["deep-link"]["desktop"]["schemes"]
            .as_array()
            .expect("the deep-link plugin lists desktop schemes")
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect::<Vec<_>>();

        assert_eq!(schemes, [SCHEME]);
    }

    #[test]
    fn plat_16_a_link_received_while_running_arrives_on_the_event() {
        let app = app_with_the_plugin();
        let events = received(&app);
        register(app.handle()).expect("the handler registers");

        app.handle()
            .emit(
                "deep-link://new-url",
                vec![Url::parse("conducted://workspace?id=w1&session=s1").expect("a URL")],
            )
            .expect("emit the plugin event");

        let payload = events
            .recv_timeout(Duration::from_secs(5))
            .expect("the link arrives");
        assert_eq!(
            serde_json::from_str::<String>(&payload).expect("the payload is a string"),
            "conducted://workspace?id=w1&session=s1"
        );
    }

    #[test]
    fn plat_16_a_running_link_of_another_scheme_is_dropped() {
        let app = app_with_the_plugin();
        let events = received(&app);
        register(app.handle()).expect("the handler registers");

        app.handle()
            .emit(
                "deep-link://new-url",
                vec![Url::parse("https://example.com").expect("a URL")],
            )
            .expect("emit the plugin event");
        app.handle()
            .emit(EVENT_DEEP_LINK, "marker")
            .expect("emit the marker");

        let first = events
            .recv_timeout(Duration::from_secs(5))
            .expect("the marker arrives");
        assert_eq!(
            serde_json::from_str::<String>(&first).expect("the payload is a string"),
            "marker"
        );
    }

    #[test]
    fn plat_16_several_running_links_arrive_in_order_one_event_each() {
        let app = app_with_the_plugin();
        let events = received(&app);
        register(app.handle()).expect("the handler registers");

        app.handle()
            .emit(
                "deep-link://new-url",
                vec![
                    Url::parse("conducted://workspace?id=first").expect("a URL"),
                    Url::parse("conducted://settings/general").expect("a URL"),
                ],
            )
            .expect("emit the plugin event");

        for expected in [
            "conducted://workspace?id=first",
            "conducted://settings/general",
        ] {
            let payload = events
                .recv_timeout(Duration::from_secs(5))
                .expect("the next link arrives");
            assert_eq!(
                serde_json::from_str::<String>(&payload).expect("the payload is a string"),
                expected
            );
        }
    }

    #[test]
    fn plat_16_run_registers_the_open_url_handler() {
        let shell = include_str!("lib.rs");
        assert!(
            shell.contains("deep_link::register(app.handle())?"),
            "run() must register the deep-link handler"
        );
    }
}
