//! @feature PLAT-11 Native notifications, dock badge, click opens a deep link
//!
//! Owns: showing macOS notifications, setting the Dock badge, and turning a click on a
//! notification into an app deep link for the UI.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`send_native_notification`,
//! `take_pending_notification_deep_links`, `set_dock_badge`) and A5 (a click queues a deep link
//! that the UI drains; the Dock badge shows a count).
//!
//! Must handle:
//! - `notify` reads the notification plugin's permission state and fails with
//!   `notification_denied` when it is not granted. On macOS the plugin always reports granted,
//!   so this command does not prompt.
//! - The deep link travels in the notification's extra data and is returned on click. Only
//!   `conducted://` links are accepted; others fail with `notification_bad_link`.
//! - A click is queued in `NotificationState` and a `notification://clicked` event wakes the UI.
//!   The UI drains the queue through `notification_take_pending`, which it calls right after
//!   attaching its listener, so a click that arrives first is not lost.
//! - `notification_take_pending` returns the newest queued click only. Older queued clicks are
//!   logged and dropped, matching Conductor on a cold start (services-map 5B.2.5).
//! - A click on a notification shown by an earlier run of the app is not delivered. The plugin
//!   only reports clicks on notifications it showed after its handler was registered in this
//!   process. Delivering a launch click waits for the `conducted://` route (PLAT-16).
//! - The click handler runs on a system thread. It only reads the link, locks the queue and emits
//!   an event.
//! - The badge is cleared with `None` or zero. Counts above 99 show as `99+` in the Dock tile.
//!
//! Our design choice: the system notification sound is used. `notify` asks for it with the sound
//! name "default" unless the request turns it off. Conductor stores a user-chosen sound type;
//! ours has no custom sounds because Conductor's sound files are not ours to copy.
//! Our design choice: we use the notification plugin's `on_action` click callback and its extra
//! payload instead of writing an Objective-C delegate. The handler is installed on the first
//! `notify`, before that notification is shown, because a notification shown before a handler
//! exists reports no click.
//! `notification_take_pending` is listed in docs/plans/tauri-commands.md as an extra command.
//!
//! Test first: two clicks recorded while no listener is attached return only the newest link
//! from `notification_take_pending`, and a second call returns an empty list.

use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_notification::NotificationExt;

use crate::deep_link::SCHEME;
use crate::error::{CommandError, CommandResult, lock};

/// Event sent when a notification is clicked. The UI drains the queued links in response.
pub const EVENT_CLICKED: &str = "notification://clicked";
/// The largest count shown in the Dock tile. Higher counts show as `99+`.
pub const MAX_BADGE_COUNT: u32 = 99;

/// What to show. The fields match the argument of `Notifications.notify` in platform.ts, plus
/// the sound choice the notification-sound setting needs.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyRequest {
    pub title: String,
    pub body: String,
    /// `conducted://...` link the UI opens when the notification is clicked.
    #[serde(default)]
    pub deep_link: Option<String>,
    /// Whether to use the system notification sound. Missing means on.
    #[serde(default = "sound_on")]
    pub sound: bool,
}

fn sound_on() -> bool {
    true
}

/// The sound name for the notification builder. `None` leaves the notification silent.
pub fn notification_sound(sound: bool) -> Option<&'static str> {
    sound.then_some("default")
}

/// Shared state, registered once with `.manage(NotificationState::default())`.
#[derive(Default)]
pub struct NotificationState {
    /// Clicked deep links the UI has not taken yet, oldest first.
    pending: Mutex<Vec<String>>,
    /// Whether the plugin's click handler is installed.
    handler_installed: AtomicBool,
}

impl NotificationState {
    /// Queues a clicked link for the UI. Only `conducted://` links are accepted.
    pub fn record_click(&self, link: &str) -> CommandResult<()> {
        let link = accept_link(link)?;
        lock(&self.pending).push(link);
        Ok(())
    }

    /// Returns the newest queued link and clears the queue. Older queued links are dropped and
    /// logged, as Conductor does on a cold start (services-map 5B.2.5).
    pub fn take_pending(&self) -> Vec<String> {
        let mut links = std::mem::take(&mut *lock(&self.pending));
        let Some(newest) = links.pop() else {
            return Vec::new();
        };
        if !links.is_empty() {
            eprintln!(
                "notifications: dropped {} older queued click(s)",
                links.len()
            );
        }
        vec![newest]
    }
}

/// Accepts only our own scheme. The OS can report anything as a notification action.
pub fn accept_link(link: &str) -> CommandResult<String> {
    match tauri::Url::parse(link) {
        Ok(url) if url.scheme() == SCHEME => Ok(link.to_owned()),
        _ => Err(CommandError::Failed {
            code: "notification_bad_link",
            message: format!("A notification deep link must start with {SCHEME}://."),
        }),
    }
}

/// The Dock tile label for a count. `None` and zero clear it; above 99 shows `99+`.
pub fn badge_label(count: Option<u32>) -> Option<String> {
    match count {
        None | Some(0) => None,
        Some(number) if number > MAX_BADGE_COUNT => Some(format!("{MAX_BADGE_COUNT}+")),
        Some(number) => Some(number.to_string()),
    }
}

/// Shows a notification. The click handler is installed before the notification so its click is
/// reported.
#[tauri::command]
pub async fn notify(app: AppHandle, request: NotifyRequest) -> CommandResult<()> {
    if let Some(link) = request.deep_link.as_deref() {
        accept_link(link)?;
    }
    let sound = notification_sound(request.sound);

    let permission =
        app.notification()
            .permission_state()
            .map_err(|error| CommandError::Failed {
                code: "notification_permission",
                message: error.to_string(),
            })?;
    if !matches!(
        permission,
        tauri_plugin_notification::PermissionState::Granted
    ) {
        return Err(CommandError::Failed {
            code: "notification_denied",
            message: "Notifications are turned off for Conducted.".to_owned(),
        });
    }

    install_click_handler(&app);

    let mut builder = app
        .notification()
        .builder()
        .title(request.title)
        .body(request.body);
    if let Some(name) = sound {
        builder = builder.sound(name);
    }
    if let Some(link) = request.deep_link {
        builder = builder.extra("deepLink", link);
    }
    builder.show().map_err(|error| CommandError::Failed {
        code: "notification_failed",
        message: error.to_string(),
    })
}

/// Reads the deep link from the extra data of a clicked notification. Our links are the only
/// ones written to `deepLink`; a notification without one yields nothing.
fn clicked_link(extra: &HashMap<String, serde_json::Value>) -> Option<&str> {
    extra.get("deepLink").and_then(|value| value.as_str())
}

fn install_click_handler(app: &AppHandle) {
    let state = app.state::<NotificationState>();
    if state.handler_installed.swap(true, Ordering::AcqRel) {
        return;
    }

    let handle = app.clone();
    let registration = app.notification().on_action(move |performed| {
        let Some(link) = performed
            .notification()
            .and_then(|notification| clicked_link(notification.extra()))
        else {
            return;
        };
        let state = handle.state::<NotificationState>();
        if let Err(error) = state.record_click(link) {
            eprintln!("notifications: dropped a click: {error}");
            return;
        }
        if let Err(error) = handle.emit(EVENT_CLICKED, ()) {
            eprintln!("notifications: could not tell the UI about a click: {error}");
        }
    });

    if let Err(error) = registration {
        state.handler_installed.store(false, Ordering::Release);
        eprintln!("notifications: could not listen for clicks: {error}");
    }
}

/// Sets the Dock badge to a count, or clears it with `None`.
#[tauri::command]
pub async fn set_dock_badge(app: AppHandle, count: Option<u32>) -> CommandResult<()> {
    let window = crate::window::main_window(&app)?;

    #[cfg(target_os = "macos")]
    let result = window.set_badge_label(badge_label(count));
    #[cfg(not(target_os = "macos"))]
    let result = window.set_badge_count(count.map(i64::from));

    result.map_err(|error| CommandError::Failed {
        code: "dock_badge_failed",
        message: error.to_string(),
    })
}

/// Returns and clears the deep links of notifications clicked before the UI was listening.
#[tauri::command]
pub async fn notification_take_pending(
    state: State<'_, NotificationState>,
) -> CommandResult<Vec<String>> {
    Ok(state.take_pending())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plat_11_a_click_with_no_listener_is_returned_once() {
        let state = NotificationState::default();
        state
            .record_click("conducted://workspace?id=w1&session=s1")
            .expect("a conducted link is accepted");

        assert_eq!(
            state.take_pending(),
            ["conducted://workspace?id=w1&session=s1"]
        );
        assert!(state.take_pending().is_empty());
    }

    #[test]
    fn plat_11_only_the_newest_queued_click_is_returned() {
        let state = NotificationState::default();
        state
            .record_click("conducted://workspace?id=older")
            .expect("the older link is accepted");
        state
            .record_click("conducted://workspace?id=newer")
            .expect("the newer link is accepted");

        assert_eq!(state.take_pending(), ["conducted://workspace?id=newer"]);
        assert!(state.take_pending().is_empty());
    }

    #[test]
    fn plat_11_the_sound_setting_chooses_the_notification_sound() {
        let default_request: NotifyRequest = serde_json::from_value(serde_json::json!({
            "title": "Agent finished",
            "body": "Click to view session."
        }))
        .expect("a request without a sound setting is valid");
        assert!(default_request.sound);
        assert_eq!(notification_sound(default_request.sound), Some("default"));

        let silent_request: NotifyRequest = serde_json::from_value(serde_json::json!({
            "title": "Agent finished",
            "body": "Click to view session.",
            "sound": false
        }))
        .expect("a request with the sound off is valid");
        assert!(!silent_request.sound);
        assert_eq!(notification_sound(silent_request.sound), None);
    }

    #[test]
    fn plat_11_a_click_reads_the_deep_link_from_the_extra_payload() {
        let mut extra = HashMap::new();
        extra.insert(
            "deepLink".to_owned(),
            serde_json::json!("conducted://workspace?id=w1"),
        );

        assert_eq!(clicked_link(&extra), Some("conducted://workspace?id=w1"));
        assert_eq!(clicked_link(&HashMap::new()), None);
    }

    #[test]
    fn plat_11_a_link_of_another_scheme_is_rejected_and_not_queued() {
        let state = NotificationState::default();
        let error = state
            .record_click("https://example.com/workspace?id=w1")
            .expect_err("another scheme is refused");

        assert!(matches!(
            error,
            CommandError::Failed {
                code: "notification_bad_link",
                ..
            }
        ));
        assert!(state.take_pending().is_empty());
    }

    #[test]
    fn plat_11_badge_counts_above_99_show_99_plus() {
        assert_eq!(badge_label(None), None);
        assert_eq!(badge_label(Some(0)), None);
        assert_eq!(badge_label(Some(3)), Some("3".to_owned()));
        assert_eq!(badge_label(Some(MAX_BADGE_COUNT)), Some("99".to_owned()));
        assert_eq!(
            badge_label(Some(MAX_BADGE_COUNT + 1)),
            Some("99+".to_owned())
        );
    }
}
