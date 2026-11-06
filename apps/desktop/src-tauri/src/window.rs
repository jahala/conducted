//! @feature PLAT-23 Window look: vibrancy, traffic lights and zoom
//! Owns: the two Rust commands behind the window's material and title-bar controls, and
//! `main_window`, the one lookup of the main window that every Rust module uses. Tauri's own
//! window and webview APIs handle the theme and the webview zoom from `platform/tauri.ts`.
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 and A5 (`update_window_vibrancy`
//! applies an `NSVisualEffectView`, `update_traffic_light_position` moves the window's buttons), and
//! docs/plans/tauri-commands.md (`window_set_vibrancy { enabled }`, `window_set_traffic_lights { x, y }`).
//! Must handle: the main window not being open (a `window_missing` error); a window effect Tauri
//! rejects (a `window_vibrancy_failed` error); a window without all three traffic-light buttons (a
//! `traffic_lights_missing` error); a non-macOS build (a `window_platform_unsupported` error).
//! Our design choice: the traffic lights move as a group, keeping the spacing macOS gave them, so
//! a new origin for the close button places the whole group. The pure part is tested without a
//! window.
//! Test first: `plat_23_moving_the_traffic_lights_keeps_their_spacing` moves a group of origins.

use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::error::{CommandError, CommandResult};

/// The window effects that turn the translucent material on, or `None` to clear it.
pub fn vibrancy_effects(enabled: bool) -> Option<WindowEffectsConfig> {
    if !enabled {
        return None;
    }
    Some(
        EffectsBuilder::new()
            .effect(Effect::Sidebar)
            .state(EffectState::Active)
            .build(),
    )
}

/// Where the close, minimise and zoom buttons land when their group moves to `(x, y)`.
///
/// The current origins keep macOS's own spacing; only their shared offset changes.
pub fn shifted_traffic_light_origins(current: [(f64, f64); 3], x: f64, y: f64) -> [(f64, f64); 3] {
    let dx = x - current[0].0;
    let dy = y - current[0].1;
    current.map(|(current_x, current_y)| (current_x + dx, current_y + dy))
}

/// The label of the app's one window, from `tauri.conf.json`.
pub const MAIN_WINDOW: &str = "main";

/// The main window, or a `window_missing` error when it is not open.
pub fn main_window<R: Runtime>(app: &AppHandle<R>) -> CommandResult<WebviewWindow<R>> {
    app.get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| CommandError::Failed {
            code: "window_missing",
            message: "The main window is not open.".to_string(),
        })
}

/// Turns the translucent window material on or off.
#[tauri::command]
pub fn window_set_vibrancy(app: AppHandle, enabled: bool) -> CommandResult<()> {
    let window = main_window(&app)?;
    window
        .set_effects(vibrancy_effects(enabled))
        .map_err(|error| CommandError::Failed {
            code: "window_vibrancy_failed",
            message: format!("Failed to apply window vibrancy: {error}"),
        })
}

/// Moves the close, minimise and zoom buttons so the first sits at `(x, y)`.
#[tauri::command]
pub async fn window_set_traffic_lights(app: AppHandle, x: f64, y: f64) -> CommandResult<()> {
    let window = main_window(&app)?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let handle = window.clone();
    window
        .run_on_main_thread(move || {
            if sender.send(move_traffic_lights(&handle, x, y)).is_err() {
                eprintln!("the traffic-light move finished after its command was cancelled");
            }
        })
        .map_err(|error| CommandError::Failed {
            code: "window_main_thread_failed",
            message: format!("The traffic lights could not reach the main thread: {error}"),
        })?;
    receiver.await.map_err(|_| CommandError::Failed {
        code: "window_main_thread_failed",
        message: "The main thread did not answer the traffic-light move.".to_string(),
    })?
}

#[cfg(target_os = "macos")]
fn move_traffic_lights(window: &WebviewWindow, x: f64, y: f64) -> CommandResult<()> {
    use objc2_app_kit::{NSWindow, NSWindowButton};
    use objc2_foundation::NSPoint;

    let handle = window.ns_window().map_err(|error| CommandError::Failed {
        code: "window_missing",
        message: format!("The window has no native handle: {error}"),
    })?;
    // SAFETY: `ns_window` returns this window's live NSWindow, and this runs on the main thread.
    let ns_window: &NSWindow = unsafe { &*handle.cast::<NSWindow>() };
    let buttons: Vec<_> = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ]
    .into_iter()
    .filter_map(|kind| ns_window.standardWindowButton(kind))
    .collect();
    if buttons.len() != 3 {
        return Err(CommandError::Failed {
            code: "traffic_lights_missing",
            message: "The window does not have all three traffic-light buttons.".to_string(),
        });
    }

    let current = [
        frame_origin(&buttons[0]),
        frame_origin(&buttons[1]),
        frame_origin(&buttons[2]),
    ];
    let shifted = shifted_traffic_light_origins(current, x, y);
    for (button, (next_x, next_y)) in buttons.iter().zip(shifted) {
        button.setFrameOrigin(NSPoint::new(next_x, next_y));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn frame_origin(button: &objc2_app_kit::NSButton) -> (f64, f64) {
    let origin = button.frame().origin;
    (origin.x, origin.y)
}

#[cfg(not(target_os = "macos"))]
fn move_traffic_lights(_window: &WebviewWindow, _x: f64, _y: f64) -> CommandResult<()> {
    Err(CommandError::Failed {
        code: "window_platform_unsupported",
        message: "The traffic lights are a macOS window feature.".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The source files under `src/` that write the "main window is missing" error themselves.
    fn files_building_window_missing(files: &[(String, String)]) -> Vec<String> {
        let message = format!("The main window is {} open.", "not");
        files
            .iter()
            .filter(|(_, source)| source.contains(&message))
            .map(|(name, _)| name.clone())
            .collect()
    }

    #[test]
    fn plat_23_a_missing_main_window_is_a_window_missing_error() {
        let app = tauri::test::mock_app();
        let error = main_window(app.handle()).expect_err("the mock app opens no window");
        assert!(matches!(
            error,
            CommandError::Failed {
                code: "window_missing",
                ..
            }
        ));
    }

    #[test]
    fn plat_23_the_main_window_lookup_has_one_home() {
        assert_eq!(
            files_building_window_missing(&crate::error::crate_sources()),
            vec!["window.rs".to_string()]
        );
    }

    #[test]
    fn plat_23_the_window_lookup_guard_flags_a_second_copy() {
        let copy = format!("message: \"The main window is {} open.\"", "not");
        let files = vec![
            ("notifications.rs".to_string(), copy.clone()),
            ("window.rs".to_string(), copy),
        ];
        assert_eq!(
            files_building_window_missing(&files),
            vec!["notifications.rs".to_string(), "window.rs".to_string()]
        );
    }

    #[test]
    fn plat_23_vibrancy_on_asks_for_the_sidebar_material() {
        let effects = vibrancy_effects(true).expect("vibrancy on uses an effect");
        assert_eq!(effects.effects, vec![Effect::Sidebar]);
        assert_eq!(effects.state, Some(EffectState::Active));
    }

    #[test]
    fn plat_23_vibrancy_off_clears_the_effect() {
        assert_eq!(vibrancy_effects(false), None);
    }

    #[test]
    fn plat_23_moving_the_traffic_lights_keeps_their_spacing() {
        let current = [(7.0, 6.0), (27.0, 6.0), (47.0, 6.0)];

        let moved = shifted_traffic_light_origins(current, 13.0, 13.0);

        assert_eq!(moved, [(13.0, 13.0), (33.0, 13.0), (53.0, 13.0)]);
    }

    #[test]
    fn plat_23_moving_the_traffic_lights_uses_the_close_button_as_the_origin() {
        let current = [(20.0, 10.0), (40.0, 10.0), (60.0, 10.0)];

        assert_eq!(
            shifted_traffic_light_origins(current, -5.0, 30.0),
            [(-5.0, 30.0), (15.0, 30.0), (35.0, 30.0)]
        );
    }
}
