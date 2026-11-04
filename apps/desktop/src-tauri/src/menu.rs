//! @feature PLAT-15 App menu with accelerators from the command registry
//!
//! Owns: the macOS menu bar. Every item sends its command id to the UI; the shell does not run
//! any of them. Accelerators come from the UI's command registry so a rebinding shows up here.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A5 (Menus: App, View and Help
//! items, Edit and Window from the defaults, Quit sends `quit_requested` so the UI can confirm and
//! flush, the toggle items have no accelerator in Rust because the UI binds the keys).
//!
//! Must handle:
//! - The standard App, Edit, Window and Help structure of a Mac app: About, Hide, services and
//!   Quit; undo, copy and paste (these must stay, or text fields lose Cmd+C and Cmd+V); Minimize
//!   and Zoom.
//! - Each custom item has a stable command id (`MENU_ITEMS`). A click emits `menu://command` with
//!   the id string as payload. The Quit item emits `app://quit-requested` instead.
//! - `menu_set_shortcuts` receives `{ commandId, accelerator }` pairs. Ids with no menu item are
//!   ignored on purpose, because the registry has many more commands than the menu. Accelerators
//!   use Tauri's syntax (`CmdOrCtrl+Shift+O`). Invalid ones are reported in `rejected` and the
//!   item keeps its old accelerator. `None` removes the accelerator.
//! - Shortcuts the UI handles itself must not be double-bound: the UI sends `None` for those, so
//!   a key does not fire both the menu and the web handler.
//! - Menu handles are kept in `MenuState` so a later call can change an accelerator. Calls come
//!   from the UI at any time, so the table sits behind a mutex.
//! - The menu is built once at startup, before the window shows.
//!
//! Our design choice: ids follow the registry's dot style (`view.toggleLeftSidebar`). We leave out
//! Conductor's "Best Practices", "Submit a Prompt" and "Send Feedback" items because they point at
//! its hosted services. "Documentation" and "Changelog" stay as UI commands that open our docs.
//!
//! Test first: after `menu_set_shortcuts` with `view.toggleLeftSidebar` bound to `CmdOrCtrl+B`,
//! the menu item reports that accelerator; an invalid string lands in `rejected` and changes nothing.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, State, Wry};

use crate::error::CommandResult;
use crate::not_implemented;

/// Event sent with a command id when a custom menu item is clicked.
pub const EVENT_COMMAND: &str = "menu://command";
/// Event sent when the user chooses Quit. The UI confirms, flushes, then calls `app_quit`.
pub const EVENT_QUIT_REQUESTED: &str = "app://quit-requested";

/// A custom menu item.
#[derive(Debug, Clone, Copy)]
pub struct MenuItemSpec {
    /// Command id sent to the UI.
    pub id: &'static str,
    pub label: &'static str,
    /// Menu it sits in.
    pub menu: &'static str,
    /// Accelerator used until the UI sends its own. `None` leaves the item without one.
    pub default_accelerator: Option<&'static str>,
}

/// The custom items. Standard items (About, Hide, Copy, Paste, Minimize) are added by Tauri.
pub const MENU_ITEMS: &[MenuItemSpec] = &[
    MenuItemSpec {
        id: "app.checkForUpdates",
        label: "Check for Updates...",
        menu: "App",
        default_accelerator: None,
    },
    MenuItemSpec {
        id: "app.openSettings",
        label: "Settings...",
        menu: "App",
        default_accelerator: Some("CmdOrCtrl+,"),
    },
    MenuItemSpec {
        id: "app.quit",
        label: "Quit Conducted",
        menu: "App",
        default_accelerator: Some("CmdOrCtrl+Q"),
    },
    MenuItemSpec {
        id: "view.toggleLeftSidebar",
        label: "Toggle Left Sidebar",
        menu: "View",
        default_accelerator: None,
    },
    MenuItemSpec {
        id: "view.toggleRightSidebar",
        label: "Toggle Right Sidebar",
        menu: "View",
        default_accelerator: None,
    },
    MenuItemSpec {
        id: "help.keyboardShortcuts",
        label: "Keyboard Shortcuts",
        menu: "Help",
        default_accelerator: None,
    },
    MenuItemSpec {
        id: "help.documentation",
        label: "Documentation",
        menu: "Help",
        default_accelerator: None,
    },
    MenuItemSpec {
        id: "help.changelog",
        label: "Changelog",
        menu: "Help",
        default_accelerator: None,
    },
    MenuItemSpec {
        id: "help.diagnostics",
        label: "Diagnostics...",
        menu: "Help",
        default_accelerator: None,
    },
    MenuItemSpec {
        id: "help.toggleInspector",
        label: "Toggle Web Inspector",
        menu: "Help",
        default_accelerator: Some("CmdOrCtrl+Alt+I"),
    },
];

/// One binding from the UI's command registry.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuShortcut {
    pub command_id: String,
    /// Tauri accelerator string, or `None` to clear.
    pub accelerator: Option<String>,
}

/// What `menu_set_shortcuts` did.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuShortcutReport {
    /// Ids whose item now has the requested accelerator.
    pub applied: Vec<String>,
    /// Ids whose accelerator string was invalid.
    pub rejected: Vec<String>,
}

/// Handles to the custom items, by command id. Registered with `.manage(MenuState::default())`.
#[derive(Default)]
pub struct MenuState {
    pub items: Mutex<HashMap<String, MenuItem<Wry>>>,
}

/// Builds the full menu and stores the item handles in `MenuState`. Called once from `run()`.
pub fn build_menu(_app: &AppHandle, _state: &MenuState) -> CommandResult<Menu<Wry>> {
    not_implemented!("PLAT-15")
}

/// Routes a click on a custom item: Quit goes to `app://quit-requested`, everything else to
/// `menu://command`. Called from the menu event handler in `run()`.
pub fn handle_menu_event(_app: &AppHandle, _item_id: &str) -> CommandResult<()> {
    not_implemented!("PLAT-15")
}

/// Applies accelerators from the UI's command registry.
#[tauri::command]
#[allow(unused_variables)]
pub async fn menu_set_shortcuts(
    state: State<'_, MenuState>,
    shortcuts: Vec<MenuShortcut>,
) -> CommandResult<MenuShortcutReport> {
    not_implemented!("PLAT-15")
}
