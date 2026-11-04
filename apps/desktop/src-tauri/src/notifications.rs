//! @feature PLAT-11 Native notifications, dock badge, click opens a deep link
//!
//! Owns: showing macOS notifications, setting the Dock badge, and turning a click on a
//! notification into an app deep link for the UI.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`send_native_notification`,
//! `take_pending_notification_deep_links`, `set_dock_badge`) and A5 (a notification centre
//! delegate implements `willPresent` and `didReceiveNotificationResponse`; a click queues a deep
//! link that the UI drains).
//!
//! Must handle:
//! - The system asks for notification permission on first use. The UI checks and requests it with
//!   the notification plugin before calling `notify`. `notify` fails with
//!   `notification_denied` when permission is off.
//! - Show the notification even when the app is in front (`willPresent` returns banner and
//!   sound), because the UI decides when a notification is wanted.
//! - The deep link travels in the notification's user info and is returned on click. Only
//!   `conducted://` links are accepted; others fail with `notification_bad_link`.
//! - A click can launch the app cold. The UI is not listening yet, so clicks are queued in
//!   `NotificationState::pending` and sent as `notification://clicked` when the UI asks through
//!   `notification_take_pending`, which it calls right after attaching its listener.
//! - The click handler runs on a system thread. It only locks `pending` and emits an event.
//! - The badge is cleared with `None`. Counts above 99 show as 99+ in the Dock tile.
//!
//! Our design choice: the system notification sound is used. Conductor stores a user-chosen sound
//! type; ours has no custom sounds because Conductor's sound files are not ours to copy.
//! Our design choice: `notification_take_pending` is an extra command, not in the command table.
//! Without it, a cold-start click would be lost.
//! The implementation needs a small objc2 delegate, because the notification plugin has no click
//! callback on desktop.
//!
//! Test first: a click recorded while no listener is attached is returned once by
//! `notification_take_pending`, and a second call returns an empty list.

use std::sync::Mutex;

use serde::Deserialize;
use tauri::AppHandle;
use tauri::State;

use crate::error::CommandResult;
use crate::not_implemented;

/// Event sent with the deep link string of a clicked notification.
pub const EVENT_CLICKED: &str = "notification://clicked";

/// What to show. Mirrors the argument of `Notifications.notify` in platform.ts.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyRequest {
    pub title: String,
    pub body: String,
    /// `conducted://...` link the UI opens when the notification is clicked.
    #[serde(default)]
    pub deep_link: Option<String>,
}

/// Shared state, registered once with `.manage(NotificationState::default())`.
#[derive(Default)]
pub struct NotificationState {
    /// Clicked deep links the UI has not taken yet, oldest first.
    pub pending: Mutex<Vec<String>>,
}

/// Shows a notification.
#[tauri::command]
#[allow(unused_variables)]
pub async fn notify(app: AppHandle, request: NotifyRequest) -> CommandResult<()> {
    not_implemented!("PLAT-11")
}

/// Sets the Dock badge to a count, or clears it with `None`.
#[tauri::command]
#[allow(unused_variables)]
pub async fn set_dock_badge(app: AppHandle, count: Option<u32>) -> CommandResult<()> {
    not_implemented!("PLAT-11")
}

/// Returns and clears the deep links of notifications clicked before the UI was listening.
#[tauri::command]
#[allow(unused_variables)]
pub async fn notification_take_pending(
    state: State<'_, NotificationState>,
) -> CommandResult<Vec<String>> {
    not_implemented!("PLAT-11")
}
