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
//! - Every link the plugin hands over goes to the UI, whatever its scheme. The UI's parser is the
//!   one home of the scheme rule and the route table, so a link it cannot read reaches it and is
//!   reported there instead of vanishing here. Conductor's parser lives in its UI the same way.
//! - The plugin hands links over already parsed, so the string the UI gets is the `url` crate's:
//!   the scheme in lower case and characters a URL may not hold (a space) percent-encoded; the
//!   host, the path and an existing encoding stay as given. Nothing is decoded here.
//! - Links longer than `MAX_URL_BYTES` are dropped. The drop is written to the app log and sent
//!   to the UI on `app://deep-link-rejected` as `{ code, message }`, which the UI shows the way
//!   it shows any refused link (`AppInfo.onDeepLinkRejected`).
//! - A link that arrives while the app is already running brings the window to the front.
//! - A launch link is not missed: the UI calls `deep_link_launch` when it subscribes, which reads
//!   the plugin's current URLs through the same length rule, and this module forwards every
//!   later link on the plugin's event.
//! - Several links in a row are delivered in order, one event each.
//!
//! Our design choice: no `conducted-alpha`, `-beta` or similar scheme variants. Conductor needs
//! them for its release channels; we ship one channel for now.
//! Our design choice: a second launch with a URL needs `tauri-plugin-single-instance`. The
//! one-instance guard is PLAT-27's, so that path is not part of this module.
//!
//! Test first: `normalise("conducted://workspace?id=1")` returns the URL unchanged, a link of
//! another scheme reaches the UI unchanged, and a link over `MAX_URL_BYTES` fails with
//! `deep_link_too_long`.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime, Url};
use tauri_plugin_deep_link::DeepLinkExt;

use crate::error::{CommandError, CommandResult};

/// Event carrying one URL as a string.
pub const EVENT_DEEP_LINK: &str = "app://deep-link";
/// Event carrying a link this module refused, as `{ code, message }` (PLAT-16).
pub const EVENT_DEEP_LINK_REJECTED: &str = "app://deep-link-rejected";
/// The one scheme this app registers with macOS.
pub const SCHEME: &str = "conducted";
/// Longest accepted URL.
pub const MAX_URL_BYTES: usize = 64 * 1024;

fn too_long() -> CommandError {
    CommandError::Failed {
        code: "deep_link_too_long",
        message: format!("A deep link longer than {MAX_URL_BYTES} bytes was dropped."),
    }
}

/// Checks the length of a URL and returns it for forwarding. The scheme and the route are the
/// UI parser's to judge.
pub fn normalise(url: &str) -> CommandResult<String> {
    if url.len() > MAX_URL_BYTES {
        return Err(too_long());
    }
    Ok(url.to_owned())
}

/// A link that was refused before it reached the UI's parser, as the UI shows it.
#[derive(Debug, Clone, Serialize)]
pub struct DeepLinkRejection {
    pub code: String,
    pub message: String,
}

impl From<CommandError> for DeepLinkRejection {
    fn from(error: CommandError) -> Self {
        Self {
            code: error.code().to_string(),
            message: error.to_string(),
        }
    }
}

/// The links that launched the app: the ones for the UI's parser, and the ones refused here.
#[derive(Debug, Clone, Serialize)]
pub struct LaunchLinks {
    pub urls: Vec<String>,
    pub rejected: Vec<DeepLinkRejection>,
}

/// Sorts the launch links by the same rule as a link that arrives while the app runs.
pub fn launch_links(urls: Vec<Url>) -> LaunchLinks {
    let mut links = LaunchLinks {
        urls: Vec::new(),
        rejected: Vec::new(),
    };
    for url in urls {
        match normalise(url.as_str()) {
            Ok(link) => links.urls.push(link),
            Err(error) => links.rejected.push(error.into()),
        }
    }
    links
}

/// The links that launched the app, read when the UI subscribes, so a cold-start link is not
/// missed and an oversized one is refused the same way as one that arrives later.
#[tauri::command]
pub fn deep_link_launch(app: AppHandle) -> CommandResult<LaunchLinks> {
    let current = app
        .deep_link()
        .get_current()
        .map_err(|error| CommandError::Failed {
            code: "deep_link_unavailable",
            message: format!("Could not read the link that opened the app: {error}"),
        })?;
    Ok(launch_links(current.unwrap_or_default()))
}

/// Brings the one window to the front, so a link opened from another app is noticed.
fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    let focused = crate::window::main_window(app).and_then(|window| {
        window.set_focus().map_err(|error| CommandError::Failed {
            code: "window_focus_failed",
            message: error.to_string(),
        })
    });
    if let Err(error) = focused {
        report(
            app,
            &format!("deep link: could not bring the window to the front: {error}"),
        );
    }
}

/// Writes a failure to the app log, or to stderr while the log is not running.
fn report<R: Runtime>(app: &AppHandle<R>, message: &str) {
    crate::log_or_stderr(app, "warn", message);
}

/// Forwards each URL, in order, as one `app://deep-link` event. A link over the size limit is
/// written to the app log, and the links after it still go on.
fn deliver<R: Runtime>(app: &AppHandle<R>, urls: Vec<Url>) {
    for url in urls {
        match normalise(url.as_str()) {
            Ok(link) => {
                focus_main(app);
                if let Err(error) = app.emit(EVENT_DEEP_LINK, link) {
                    report(
                        app,
                        &format!("deep link: could not send the link to the UI: {error}"),
                    );
                }
            }
            Err(error) => {
                report(app, &format!("deep link: dropped a URL: {error}"));
                let refusal = DeepLinkRejection::from(error);
                if let Err(error) = app.emit(EVENT_DEEP_LINK_REJECTED, refusal) {
                    report(
                        app,
                        &format!("deep link: could not tell the UI a link was refused: {error}"),
                    );
                }
            }
        }
    }
}

/// Registers the plugin's open-url handler. Each URL within the size limit is shown (window to
/// the front) and emitted as `app://deep-link`. Called once from `run()`.
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
    fn plat_16_another_scheme_is_left_for_the_ui_parser_to_refuse() {
        let forwarded = normalise("https://example.com").expect("the UI judges the scheme");
        assert_eq!(forwarded, "https://example.com");
    }

    #[test]
    fn plat_16_a_variant_scheme_is_left_for_the_ui_parser_to_refuse() {
        let forwarded =
            normalise("conducted-beta://workspace?id=1").expect("the UI judges the scheme");
        assert_eq!(forwarded, "conducted-beta://workspace?id=1");
    }

    #[test]
    fn plat_16_a_string_without_a_scheme_is_left_for_the_ui_parser_to_refuse() {
        let forwarded = normalise("workspace?id=1").expect("the UI judges the scheme");
        assert_eq!(forwarded, "workspace?id=1");
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
    fn plat_16_a_running_link_of_another_scheme_reaches_the_ui_to_be_refused() {
        let app = app_with_the_plugin();
        let events = received(&app);
        register(app.handle()).expect("the handler registers");

        app.handle()
            .emit(
                "deep-link://new-url",
                vec![Url::parse("https://example.com").expect("a URL")],
            )
            .expect("emit the plugin event");

        let payload = events
            .recv_timeout(Duration::from_secs(5))
            .expect("the link arrives for the UI to refuse");
        assert_eq!(
            serde_json::from_str::<String>(&payload).expect("the payload is a string"),
            "https://example.com/"
        );
    }

    #[test]
    fn plat_16_a_running_link_over_the_limit_is_dropped() {
        let app = app_with_the_plugin();
        let events = received(&app);
        register(app.handle()).expect("the handler registers");

        let long = format!("conducted://workspace?id={}", "x".repeat(MAX_URL_BYTES));
        app.handle()
            .emit(
                "deep-link://new-url",
                vec![Url::parse(&long).expect("a URL")],
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
    fn plat_16_a_running_link_over_the_limit_is_refused_on_its_own_event() {
        let app = app_with_the_plugin();
        let (sender, refusals) = std::sync::mpsc::channel::<String>();
        app.handle().listen(EVENT_DEEP_LINK_REJECTED, move |event| {
            let _ = sender.send(event.payload().to_string());
        });
        register(app.handle()).expect("the handler registers");

        let long = format!("conducted://workspace?id={}", "x".repeat(MAX_URL_BYTES));
        app.handle()
            .emit(
                "deep-link://new-url",
                vec![Url::parse(&long).expect("a URL")],
            )
            .expect("emit the plugin event");

        let payload = refusals
            .recv_timeout(Duration::from_secs(5))
            .expect("the refusal arrives");
        let refusal: serde_json::Value = serde_json::from_str(&payload).expect("JSON");
        assert_eq!(refusal["code"], "deep_link_too_long");
        assert!(
            refusal["message"]
                .as_str()
                .is_some_and(|text| !text.is_empty())
        );
    }

    #[test]
    fn plat_16_launch_links_keep_the_accepted_and_name_the_refused() {
        let long = format!("conducted://workspace?id={}", "x".repeat(MAX_URL_BYTES));
        let links = launch_links(vec![
            Url::parse("conducted://workspace?id=w1").expect("a URL"),
            Url::parse(&long).expect("a URL"),
        ]);

        assert_eq!(links.urls, vec!["conducted://workspace?id=w1".to_string()]);
        assert_eq!(links.rejected.len(), 1);
        assert_eq!(links.rejected[0].code, "deep_link_too_long");
    }

    #[test]
    fn plat_16_the_ui_gets_the_link_as_the_url_crate_writes_it() {
        let app = app_with_the_plugin();
        let events = received(&app);
        register(app.handle()).expect("the handler registers");

        app.handle()
            .emit(
                "deep-link://new-url",
                vec![
                    Url::parse("CONDUCTED://Workspace?id=A%20b&prompt=x%2Fy").expect("a URL"),
                    Url::parse("conducted://path=/tmp/a b&prompt=hi there").expect("a URL"),
                ],
            )
            .expect("emit the plugin event");

        // The scheme is lower case; the host and an existing encoding are kept as given.
        let first = events
            .recv_timeout(Duration::from_secs(5))
            .expect("the first link arrives");
        assert_eq!(
            serde_json::from_str::<String>(&first).expect("the payload is a string"),
            "conducted://Workspace?id=A%20b&prompt=x%2Fy"
        );
        // A space is not a URL character, so it arrives encoded.
        let second = events
            .recv_timeout(Duration::from_secs(5))
            .expect("the second link arrives");
        assert_eq!(
            serde_json::from_str::<String>(&second).expect("the payload is a string"),
            "conducted://path=/tmp/a%20b&prompt=hi%20there"
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
