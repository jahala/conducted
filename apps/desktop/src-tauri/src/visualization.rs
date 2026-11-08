//! @feature CHAT-22 Codex visualizations in the chat
//!
//! Owns: the `visualization` URI scheme that serves each Codex visualization from its own origin,
//! the store of the pages it serves (`VisualizationState`), the policy those pages carry
//! (`FRAME_POLICY`), and the commands that add and remove a page (`visualization_serve`,
//! `visualization_release`).
//!
//! Behaviour: coverage/inventory-ui-text.md ("Codex inline visualizations": a sandboxed frame that
//! runs the page's scripts). Issue #466: a `srcdoc` frame inherits the app's policy, whose
//! `script-src 'self'` blocks the page's inline scripts. A page served from this scheme carries
//! its own policy, so its inline scripts run while the app's own policy stays as strict as it is.
//!
//! Must handle:
//! - A page answers with `FRAME_POLICY` as its `Content-Security-Policy` header, so the policy
//!   covers every script of the page, also one before `<head>`. It allows inline scripts and
//!   styles and `data:` and `blob:` images, fonts and media, and nothing from the network.
//! - An id the store does not hold answers 404, and a request other than GET answers 405. Both
//!   carry `default-src 'none'`.
//! - Each page gets its own random id, so two visualizations on screen never load each other's
//!   page, and a page cannot guess another one's address.
//! - The store is bounded: a page leaves it when its frame is gone (`visualization_release`), when
//!   newer pages push the store past `MAX_PAGES` or `MAX_STORE_BYTES` (oldest first), or when the
//!   app quits, because it lives only in memory. A page larger than `MAX_STORE_BYTES` is refused
//!   with `visualization_too_large`.
//! - Releasing an id that is not stored succeeds, because an evicted page's frame still releases.
//!
//! Our design choice: the store is in Rust because the scheme handler runs in Rust; the web view
//! hands over the finished document and gets back its address. The frame keeps
//! `sandbox="allow-scripts"` without `allow-same-origin`, so the page's origin stays opaque.
//! Tauri treats a page from a registered scheme as a local page for its command permissions; the
//! frame still cannot call a command, because the per-launch invoke key exists only in the app's
//! main frame and an opaque origin cannot read it.
//!
//! Test first: `chat_22_a_served_page_answers_with_its_own_policy` serves a stored page with
//! `FRAME_POLICY` in its headers.

use std::collections::VecDeque;
use std::sync::Mutex;

use ring::rand::{SecureRandom, SystemRandom};
use serde::Serialize;
use tauri::http::{Method, Request, Response, StatusCode, header};

use crate::error::{CommandError, CommandResult, lock};

/// The URI scheme. A page's address is `visualization://localhost/<id>` on macOS.
pub const SCHEME: &str = "visualization";

/// The policy every served page carries. Only inline scripts and styles, and pictures, fonts and
/// media from `data:` and `blob:` URLs; no network, no form posts.
pub const FRAME_POLICY: &str = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'";

/// The policy of an answer that is not a page.
const ERROR_POLICY: &str = "default-src 'none'";

/// At most this many pages are kept; a newer page pushes the oldest out.
pub const MAX_PAGES: usize = 64;

/// At most this many bytes of pages are kept. Twice the largest file `fs_read_text` reads.
pub const MAX_STORE_BYTES: usize = 128 * 1024 * 1024;

/// Random bytes in an id, written as hex.
const ID_BYTES: usize = 16;

/// One stored page and the address its frame loads.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct VisualizationPage {
    pub id: String,
    pub url: String,
}

/// The pages in the order they were added, oldest first.
#[derive(Default)]
struct Pages {
    entries: VecDeque<(String, Vec<u8>)>,
    bytes: usize,
}

/// The pages the scheme serves. Managed by Tauri, so no module keeps global state.
#[derive(Default)]
pub struct VisualizationState {
    pages: Mutex<Pages>,
}

impl VisualizationState {
    /// Stores `document` under a new random id and returns its address.
    pub fn serve(&self, document: String) -> CommandResult<VisualizationPage> {
        let id = random_id()?;
        self.insert(id, document.into_bytes())
    }

    fn insert(&self, id: String, document: Vec<u8>) -> CommandResult<VisualizationPage> {
        if document.len() > MAX_STORE_BYTES {
            return Err(CommandError::Failed {
                code: "visualization_too_large",
                message: format!(
                    "The visualization is {} bytes; at most {MAX_STORE_BYTES} can be shown.",
                    document.len()
                ),
            });
        }
        let mut pages = lock(&self.pages);
        while pages.entries.len() >= MAX_PAGES || pages.bytes + document.len() > MAX_STORE_BYTES {
            let Some((_, oldest)) = pages.entries.pop_front() else {
                break;
            };
            pages.bytes -= oldest.len();
        }
        pages.bytes += document.len();
        pages.entries.push_back((id.clone(), document));
        Ok(VisualizationPage {
            url: format!("{SCHEME}://localhost/{id}"),
            id,
        })
    }

    /// Removes the page with `id`. An id that is not stored is already gone.
    pub fn release(&self, id: &str) {
        let mut pages = lock(&self.pages);
        if let Some(index) = pages.entries.iter().position(|(stored, _)| stored == id)
            && let Some((_, removed)) = pages.entries.remove(index)
        {
            pages.bytes -= removed.len();
        }
    }

    fn page(&self, id: &str) -> Option<Vec<u8>> {
        lock(&self.pages)
            .entries
            .iter()
            .find(|(stored, _)| stored == id)
            .map(|(_, document)| document.clone())
    }

    /// The answer to one request of the scheme.
    pub fn respond(&self, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        if request.method() != Method::GET {
            return plain(StatusCode::METHOD_NOT_ALLOWED, "Only GET is served.");
        }
        let id = request.uri().path().trim_start_matches('/');
        match self.page(id) {
            Some(document) => Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
                .header(header::CONTENT_SECURITY_POLICY, FRAME_POLICY)
                .header(header::CACHE_CONTROL, "no-store")
                .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
                .body(document)
                .unwrap_or_else(|_| failed_response()),
            None => plain(StatusCode::NOT_FOUND, "No such visualization."),
        }
    }
}

fn random_id() -> CommandResult<String> {
    let mut bytes = [0u8; ID_BYTES];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| CommandError::Failed {
            code: "visualization_id_failed",
            message: "Could not make a random id for the visualization.".to_string(),
        })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn plain(status: StatusCode, text: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CONTENT_SECURITY_POLICY, ERROR_POLICY)
        .body(text.as_bytes().to_vec())
        .unwrap_or_else(|_| failed_response())
}

/// A response whose builder refused a header. The headers above are constants, so this does not
/// happen; it still answers rather than panicking inside the web view's request.
fn failed_response() -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
    response
}

/// Stores a finished visualization document and returns the address its frame loads.
#[tauri::command]
pub fn visualization_serve(
    state: tauri::State<'_, VisualizationState>,
    document: String,
) -> CommandResult<VisualizationPage> {
    state.serve(document)
}

/// Removes a page once its frame is gone.
#[tauri::command]
pub fn visualization_release(
    state: tauri::State<'_, VisualizationState>,
    id: String,
) -> CommandResult<()> {
    state.release(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get(path: &str) -> Request<Vec<u8>> {
        Request::builder()
            .method(Method::GET)
            .uri(format!("{SCHEME}://localhost{path}"))
            .body(Vec::new())
            .expect("a request")
    }

    fn header_of(response: &Response<Vec<u8>>, name: header::HeaderName) -> &str {
        response
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
    }

    fn id_of(page: &VisualizationPage) -> &str {
        page.url
            .strip_prefix(&format!("{SCHEME}://localhost/"))
            .expect("the address is on the scheme")
    }

    #[test]
    fn chat_22_a_served_page_answers_with_its_own_policy() {
        let state = VisualizationState::default();
        let page = state
            .serve("<script>parent.postMessage(1, '*')</script>".to_string())
            .expect("served");
        assert_eq!(id_of(&page), page.id);

        let response = state.respond(&get(&format!("/{}", page.id)));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            header_of(&response, header::CONTENT_SECURITY_POLICY),
            FRAME_POLICY
        );
        assert_eq!(
            header_of(&response, header::CONTENT_TYPE),
            "text/html; charset=utf-8"
        );
        assert_eq!(header_of(&response, header::CACHE_CONTROL), "no-store");
        assert_eq!(
            response.body().as_slice(),
            b"<script>parent.postMessage(1, '*')</script>"
        );
    }

    #[test]
    fn chat_22_the_policy_allows_inline_code_and_no_network() {
        let directives: Vec<&str> = FRAME_POLICY.split(';').map(str::trim).collect();
        assert!(directives.contains(&"default-src 'none'"));
        assert!(directives.contains(&"script-src 'unsafe-inline'"));
        assert!(directives.contains(&"style-src 'unsafe-inline'"));
        assert!(directives.contains(&"form-action 'none'"));
        let sources: Vec<&str> = directives
            .iter()
            .flat_map(|directive| directive.split_whitespace().skip(1))
            .collect();
        assert_eq!(sources.len(), 9, "every directive names its sources");
        for source in sources {
            assert!(
                matches!(source, "'none'" | "'unsafe-inline'" | "data:" | "blob:"),
                "{source} is not a network source"
            );
        }
    }

    #[test]
    fn chat_22_an_unknown_id_answers_404() {
        let state = VisualizationState::default();
        state.serve("<p>kept</p>".to_string()).expect("served");
        for path in ["/", "/unknown", "/../etc/passwd"] {
            let response = state.respond(&get(path));
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
            assert_eq!(
                header_of(&response, header::CONTENT_SECURITY_POLICY),
                ERROR_POLICY
            );
        }
    }

    #[test]
    fn chat_22_only_get_is_served() {
        let state = VisualizationState::default();
        let page = state.serve("<p>a</p>".to_string()).expect("served");
        let request = Request::builder()
            .method(Method::POST)
            .uri(&page.url)
            .body(Vec::new())
            .expect("a request");
        assert_eq!(
            state.respond(&request).status(),
            StatusCode::METHOD_NOT_ALLOWED
        );
    }

    #[test]
    fn chat_22_two_pages_get_their_own_random_ids() {
        let state = VisualizationState::default();
        let first = state.serve("<p>first</p>".to_string()).expect("served");
        let second = state.serve("<p>second</p>".to_string()).expect("served");
        assert_ne!(first.id, second.id);
        assert_eq!(first.id.len(), ID_BYTES * 2);
        assert!(
            first
                .id
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        );
        assert_eq!(
            state
                .respond(&get(&format!("/{}", first.id)))
                .body()
                .as_slice(),
            b"<p>first</p>"
        );
        assert_eq!(
            state
                .respond(&get(&format!("/{}", second.id)))
                .body()
                .as_slice(),
            b"<p>second</p>"
        );
    }

    #[test]
    fn chat_22_a_released_page_answers_404_and_a_second_release_succeeds() {
        let state = VisualizationState::default();
        let page = state.serve("<p>gone</p>".to_string()).expect("served");
        state.release(&page.id);
        assert_eq!(
            state.respond(&get(&format!("/{}", page.id))).status(),
            StatusCode::NOT_FOUND
        );
        state.release(&page.id);
        assert_eq!(lock(&state.pages).bytes, 0);
    }

    #[test]
    fn chat_22_the_store_keeps_at_most_max_pages_dropping_the_oldest() {
        let state = VisualizationState::default();
        let pages: Vec<VisualizationPage> = (0..=MAX_PAGES)
            .map(|index| state.serve(format!("<p>{index}</p>")).expect("served"))
            .collect();
        assert_eq!(lock(&state.pages).entries.len(), MAX_PAGES);
        assert_eq!(
            state.respond(&get(&format!("/{}", pages[0].id))).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            state.respond(&get(&format!("/{}", pages[1].id))).status(),
            StatusCode::OK
        );
    }

    #[test]
    fn chat_22_the_store_keeps_at_most_max_store_bytes_dropping_the_oldest() {
        let state = VisualizationState::default();
        let half = MAX_STORE_BYTES / 2;
        let first = state.insert("a".to_string(), vec![b'a'; half]).expect("a");
        let second = state.insert("b".to_string(), vec![b'b'; half]).expect("b");
        let third = state.insert("c".to_string(), vec![b'c'; 1]).expect("c");
        assert_eq!(
            state.respond(&get(&format!("/{}", first.id))).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            state.respond(&get(&format!("/{}", second.id))).status(),
            StatusCode::OK
        );
        assert_eq!(
            state.respond(&get(&format!("/{}", third.id))).status(),
            StatusCode::OK
        );
        assert_eq!(lock(&state.pages).bytes, half + 1);
    }

    #[test]
    fn chat_22_a_page_over_the_store_size_is_refused() {
        let state = VisualizationState::default();
        let kept = state.serve("<p>kept</p>".to_string()).expect("served");
        let refused = state
            .insert("big".to_string(), vec![b'x'; MAX_STORE_BYTES + 1])
            .expect_err("too large");
        assert_eq!(refused.code(), "visualization_too_large");
        assert_eq!(
            state.respond(&get(&format!("/{}", kept.id))).status(),
            StatusCode::OK,
            "a refused page pushes nothing out"
        );
    }

    fn directive<'a>(csp: &'a str, name: &str) -> &'a str {
        csp.split(';')
            .map(str::trim)
            .find(|directive| directive.split_whitespace().next() == Some(name))
            .unwrap_or("")
    }

    /// The app's own policy frames the scheme and nothing more: its `script-src` stays `'self'`.
    #[test]
    fn chat_22_the_app_policy_frames_the_scheme_and_keeps_its_script_src() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json parses");
        let security = &config["app"]["security"];
        let scheme_source = format!("{SCHEME}:");
        for key in ["csp", "devCsp"] {
            let csp = security[key].as_str().expect("the policy is a string");
            assert!(
                directive(csp, "frame-src")
                    .split_whitespace()
                    .any(|source| source == scheme_source),
                "{key} frame-src allows {scheme_source}"
            );
            for name in ["default-src", "script-src", "connect-src", "img-src"] {
                assert!(
                    !directive(csp, name).contains(&scheme_source),
                    "{key} {name} does not name the scheme"
                );
            }
        }
        let release = security["csp"].as_str().expect("csp is a string");
        assert_eq!(directive(release, "script-src"), "script-src 'self'");
    }
}
