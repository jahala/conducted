//! @feature PLAT-15 App menu with accelerators from the command registry
//!
//! Owns: the macOS menu bar. Every custom item sends its command id to the UI; the shell does not
//! run any of them. Accelerators come from the UI's command registry, so a rebinding shows here.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A5 (Menus: App, View and Help
//! items, Edit and Window from the defaults, Quit sends `quit_requested` so the UI can confirm and
//! flush, the toggle items have no accelerator until the UI sends one).
//!
//! Must handle:
//! - The standard App, Edit, Window and Help structure of a Mac app: About, Services, Hide and
//!   Quit; undo, copy and paste (these must stay, or text fields lose Cmd+C and Cmd+V);
//!   Minimize, Zoom and Close Window.
//! - Each custom item has a stable command id (`MENU_ITEMS`). A click emits `menu://command` with
//!   the command id as payload (`app.openDebugTools` for the Help item `help.toggleInspector`).
//!   The Quit item emits `app://quit-requested` instead.
//! - `menu_set_shortcuts` receives `{ commandId, accelerator }` pairs. Ids with no menu item are
//!   ignored on purpose, because the registry has many more commands than the menu. Accelerators
//!   use Tauri's syntax (`CmdOrCtrl+Shift+O`). Invalid ones are reported in `rejected` and the
//!   item keeps its old accelerator. `None` removes the accelerator.
//! - Menu handles are kept in `MenuState` so a later call can change an accelerator. Calls come
//!   from the UI at any time, so the table sits behind a mutex.
//! - A Quit chosen before the UI listens is held in `QuitGate` and delivered when
//!   `set_quit_handler_ready` runs, so the user's quit is never lost.
//! - The menu is built by Tauri's builder before any window opens.
//!
//! Our design choice: ids follow the registry's dot style (`view.toggleLeftSidebar`). The Help
//! items keep Conductor's semantic names (`help.*`) while the registry names the same actions
//! `app.*`; `menu_set_shortcuts` maps those registry ids onto the Help items, and a Help click
//! emits the registry's command id so the command dispatcher can run it. We leave out Conductor's
//! "Best Practices", "Submit a Prompt" and "Send Feedback" items because they point at its hosted
//! services. "Documentation" and "Changelog" stay as UI commands that open our docs.
//!
//! Our design choice: Close Window in the Window menu sends the active tab's close command
//! (`tab.close`, Cmd+W). Conductor rewires the system item; this keeps Cmd+W with the web view and
//! makes the menu pick close a tab instead of the window.
//!
//! Test first: `plan_shortcuts` puts `view.toggleLeftSidebar` bound to `CmdOrCtrl+B` in `applied`
//! and an invalid accelerator in `rejected` without changing the menu.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{
    AboutMetadata, HELP_SUBMENU_ID, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu,
    WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Manager, State, Wry};

use crate::error::{CommandError, CommandResult};

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
        id: "tab.close",
        label: "Close Window",
        menu: "Window",
        default_accelerator: Some("CmdOrCtrl+W"),
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
        label: "Debug",
        menu: "Help",
        default_accelerator: Some("CmdOrCtrl+Alt+I"),
    },
];

/// Registry ids that name the same action as a Help menu item.
const MENU_ID_ALIASES: &[(&str, &str)] = &[
    ("app.showShortcuts", "help.keyboardShortcuts"),
    ("app.openDocumentation", "help.documentation"),
    ("app.openChangelog", "help.changelog"),
    ("app.openDiagnostics", "help.diagnostics"),
    ("app.openDebugTools", "help.toggleInspector"),
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

/// The menu id whose item a registry command changes, when the menu has that item.
pub fn menu_id_for_command(command_id: &str) -> Option<&'static str> {
    if let Some(spec) = MENU_ITEMS.iter().find(|spec| spec.id == command_id) {
        return Some(spec.id);
    }
    MENU_ID_ALIASES
        .iter()
        .find(|(registry_id, _)| *registry_id == command_id)
        .map(|(_, menu_id)| *menu_id)
}

/// Where a clicked menu item goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MenuRoute {
    /// Ask the UI to confirm and flush before the app quits.
    QuitRequested,
    /// Send this command id to the UI.
    Command(&'static str),
    /// A standard item the system handles, or an unknown id.
    Ignore,
}

/// The command id a custom menu item sends: the registry id when the registry has the action,
/// otherwise the menu item's own id.
pub fn command_id_for_menu(menu_id: &str) -> Option<&'static str> {
    if let Some((registry_id, _)) = MENU_ID_ALIASES
        .iter()
        .find(|(_, aliased_menu_id)| *aliased_menu_id == menu_id)
    {
        return Some(*registry_id);
    }
    MENU_ITEMS
        .iter()
        .find(|spec| spec.id == menu_id)
        .map(|spec| spec.id)
}

/// The route for a menu item id.
pub fn route_for(item_id: &str) -> MenuRoute {
    if item_id == "app.quit" {
        return MenuRoute::QuitRequested;
    }
    command_id_for_menu(item_id).map_or(MenuRoute::Ignore, MenuRoute::Command)
}

/// One accelerator change to put on a menu item.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShortcutChange {
    /// Set this accelerator string, already checked to parse.
    Set(String),
    /// Remove the accelerator.
    Clear,
}

/// One planned change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedShortcut {
    /// The id the UI sent, echoed in the report.
    pub command_id: String,
    /// The menu item to change.
    pub menu_id: &'static str,
    pub change: ShortcutChange,
}

/// The result of checking the UI's bindings before touching the menu.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ShortcutPlan {
    pub applied: Vec<PlannedShortcut>,
    pub rejected: Vec<String>,
}

/// Checks every binding and decides which menu items change. Pure: the menu is touched by the
/// caller, so the rule is tested without a window.
pub fn plan_shortcuts(shortcuts: &[MenuShortcut]) -> ShortcutPlan {
    let mut plan = ShortcutPlan::default();
    for shortcut in shortcuts {
        let Some(menu_id) = menu_id_for_command(&shortcut.command_id) else {
            continue;
        };
        match &shortcut.accelerator {
            None => plan.applied.push(PlannedShortcut {
                command_id: shortcut.command_id.clone(),
                menu_id,
                change: ShortcutChange::Clear,
            }),
            Some(value) => match value.parse::<muda::Accelerator>() {
                Ok(_) => plan.applied.push(PlannedShortcut {
                    command_id: shortcut.command_id.clone(),
                    menu_id,
                    change: ShortcutChange::Set(value.clone()),
                }),
                Err(_) => plan.rejected.push(shortcut.command_id.clone()),
            },
        }
    }
    plan
}

#[derive(Debug, Default)]
struct QuitStatus {
    ready: bool,
    pending: bool,
}

/// Holds a quit asked for before the UI could hear it. One lock keeps a request and the UI's
/// readiness from racing, so a quit is either delivered now or held for the ready call.
#[derive(Debug, Default)]
pub struct QuitGate {
    status: Mutex<QuitStatus>,
}

impl QuitGate {
    fn lock(&self) -> std::sync::MutexGuard<'_, QuitStatus> {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Records a quit request. Returns true when the UI should be told now.
    pub fn request(&self) -> bool {
        let mut status = self.lock();
        if status.ready {
            return true;
        }
        status.pending = true;
        false
    }

    /// Marks the UI ready. Returns true when a held quit must now be delivered.
    pub fn mark_ready(&self) -> bool {
        let mut status = self.lock();
        status.ready = true;
        std::mem::take(&mut status.pending)
    }
}

/// Handles to the custom items, by command id, plus the quit hand-shake.
#[derive(Default)]
pub struct MenuState {
    pub items: Mutex<HashMap<String, MenuItem<Wry>>>,
    pub quit: QuitGate,
}

/// Builds the full menu and stores the custom item handles in `MenuState`.
///
/// Called once from Tauri's builder, before the windows are created.
pub fn build_menu(app: &AppHandle, state: &MenuState) -> tauri::Result<Menu<Wry>> {
    let mut handles = HashMap::new();
    for spec in MENU_ITEMS {
        let item = MenuItem::with_id(app, spec.id, spec.label, true, spec.default_accelerator)?;
        handles.insert(spec.id.to_string(), item);
    }

    let package = app.package_info();
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        ..Default::default()
    };

    let about_item = PredefinedMenuItem::about(app, None, Some(about))?;
    let app_separator_one = PredefinedMenuItem::separator(app)?;
    let app_separator_two = PredefinedMenuItem::separator(app)?;
    let app_separator_three = PredefinedMenuItem::separator(app)?;
    let app_separator_four = PredefinedMenuItem::separator(app)?;
    let services = PredefinedMenuItem::services(app, None)?;
    let hide = PredefinedMenuItem::hide(app, None)?;
    let hide_others = PredefinedMenuItem::hide_others(app, None)?;
    let show_all = PredefinedMenuItem::show_all(app, None)?;

    let app_items: [&dyn IsMenuItem<Wry>; 12] = [
        &about_item,
        &app_separator_one,
        &handles["app.checkForUpdates"],
        &handles["app.openSettings"],
        &app_separator_two,
        &services,
        &app_separator_three,
        &hide,
        &hide_others,
        &show_all,
        &app_separator_four,
        &handles["app.quit"],
    ];
    let app_menu = Submenu::with_items(app, package.name.clone(), true, &app_items)?;

    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let edit_separator = PredefinedMenuItem::separator(app)?;
    let cut = PredefinedMenuItem::cut(app, None)?;
    let copy = PredefinedMenuItem::copy(app, None)?;
    let paste = PredefinedMenuItem::paste(app, None)?;
    let select_all = PredefinedMenuItem::select_all(app, None)?;
    let edit_items: [&dyn IsMenuItem<Wry>; 7] = [
        &undo,
        &redo,
        &edit_separator,
        &cut,
        &copy,
        &paste,
        &select_all,
    ];
    let edit_menu = Submenu::with_items(app, "Edit", true, &edit_items)?;

    let view_separator = PredefinedMenuItem::separator(app)?;
    let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
    let view_items: [&dyn IsMenuItem<Wry>; 4] = [
        &handles["view.toggleLeftSidebar"],
        &handles["view.toggleRightSidebar"],
        &view_separator,
        &fullscreen,
    ];
    let view_menu = Submenu::with_items(app, "View", true, &view_items)?;

    let window_separator = PredefinedMenuItem::separator(app)?;
    let minimize = PredefinedMenuItem::minimize(app, None)?;
    let zoom = PredefinedMenuItem::maximize(app, None)?;
    let window_items: [&dyn IsMenuItem<Wry>; 4] =
        [&minimize, &zoom, &window_separator, &handles["tab.close"]];
    let window_menu =
        Submenu::with_id_and_items(app, WINDOW_SUBMENU_ID, "Window", true, &window_items)?;

    let help_separator = PredefinedMenuItem::separator(app)?;
    let help_items: [&dyn IsMenuItem<Wry>; 6] = [
        &handles["help.keyboardShortcuts"],
        &handles["help.documentation"],
        &handles["help.changelog"],
        &handles["help.diagnostics"],
        &help_separator,
        &handles["help.toggleInspector"],
    ];
    let help_menu = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &help_items)?;

    let menu_items: [&dyn IsMenuItem<Wry>; 5] =
        [&app_menu, &edit_menu, &view_menu, &window_menu, &help_menu];
    let menu = Menu::with_items(app, &menu_items)?;

    let mut stored = state
        .items
        .lock()
        .expect("the menu state is locked only while the menu is built");
    *stored = handles;

    Ok(menu)
}

/// Routes a click on a custom item: Quit asks the UI to quit, everything else sends its command
/// id. Standard items are handled by the system and ignored here.
pub fn handle_menu_event(app: &AppHandle, item_id: &str) -> tauri::Result<()> {
    match route_for(item_id) {
        MenuRoute::QuitRequested => {
            let state = app.state::<MenuState>();
            if state.quit.request() {
                app.emit(EVENT_QUIT_REQUESTED, ())?;
            }
            Ok(())
        }
        MenuRoute::Command(command_id) => {
            app.emit(EVENT_COMMAND, command_id.to_string())?;
            Ok(())
        }
        MenuRoute::Ignore => Ok(()),
    }
}

/// Tells the shell the UI listens for quit requests. A quit asked for earlier is delivered now.
pub fn mark_quit_handler_ready(app: &AppHandle, state: &MenuState) -> CommandResult<()> {
    if state.quit.mark_ready() {
        app.emit(EVENT_QUIT_REQUESTED, ())
            .map_err(|error| CommandError::Failed {
                code: "menu_event",
                message: format!("The quit request could not reach the UI: {error}"),
            })?;
    }
    Ok(())
}

/// Applies accelerators from the UI's command registry.
#[tauri::command]
pub async fn menu_set_shortcuts(
    state: State<'_, MenuState>,
    shortcuts: Vec<MenuShortcut>,
) -> CommandResult<MenuShortcutReport> {
    let plan = plan_shortcuts(&shortcuts);
    let items = state.items.lock().map_err(|_| CommandError::Failed {
        code: "menu_state_poisoned",
        message: "The menu state was left locked by a failed call.".to_string(),
    })?;

    for planned in &plan.applied {
        let item = items
            .get(planned.menu_id)
            .ok_or_else(|| CommandError::Failed {
                code: "menu_item_missing",
                message: format!("The menu has no item for command {}.", planned.command_id),
            })?;
        let accelerator = match &planned.change {
            ShortcutChange::Set(value) => Some(value.as_str()),
            ShortcutChange::Clear => None,
        };
        item.set_accelerator(accelerator)
            .map_err(|error| CommandError::Failed {
                code: "menu_accelerator_failed",
                message: format!(
                    "The accelerator for {} could not be set: {error}",
                    planned.command_id
                ),
            })?;
    }

    Ok(MenuShortcutReport {
        applied: plan
            .applied
            .into_iter()
            .map(|planned| planned.command_id)
            .collect(),
        rejected: plan.rejected,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shortcut(command_id: &str, accelerator: Option<&str>) -> MenuShortcut {
        MenuShortcut {
            command_id: command_id.to_string(),
            accelerator: accelerator.map(str::to_string),
        }
    }

    #[test]
    fn plat_15_the_custom_menu_items_are_present() {
        let ids: Vec<&str> = MENU_ITEMS.iter().map(|spec| spec.id).collect();
        assert_eq!(
            ids,
            vec![
                "app.checkForUpdates",
                "app.openSettings",
                "app.quit",
                "view.toggleLeftSidebar",
                "view.toggleRightSidebar",
                "tab.close",
                "help.keyboardShortcuts",
                "help.documentation",
                "help.changelog",
                "help.diagnostics",
                "help.toggleInspector",
            ]
        );
        assert_eq!(
            route_for("app.openSettings"),
            MenuRoute::Command("app.openSettings")
        );
        assert_eq!(
            route_for("app.checkForUpdates"),
            MenuRoute::Command("app.checkForUpdates")
        );
        assert_eq!(
            route_for("view.toggleLeftSidebar"),
            MenuRoute::Command("view.toggleLeftSidebar")
        );
        assert_eq!(
            route_for("view.toggleRightSidebar"),
            MenuRoute::Command("view.toggleRightSidebar")
        );
        assert_eq!(
            route_for("help.keyboardShortcuts"),
            MenuRoute::Command("app.showShortcuts")
        );
        assert_eq!(
            route_for("help.documentation"),
            MenuRoute::Command("app.openDocumentation")
        );
        assert_eq!(
            route_for("help.changelog"),
            MenuRoute::Command("app.openChangelog")
        );
        assert_eq!(
            route_for("help.diagnostics"),
            MenuRoute::Command("app.openDiagnostics")
        );
        assert_eq!(
            route_for("help.toggleInspector"),
            MenuRoute::Command("app.openDebugTools")
        );
        assert_eq!(route_for("tab.close"), MenuRoute::Command("tab.close"));
        assert_eq!(route_for("app.quit"), MenuRoute::QuitRequested);
        assert_eq!(route_for("not.a.menu.item"), MenuRoute::Ignore);
    }

    #[test]
    fn plat_15_fixed_accelerators_match_the_registry() {
        let settings = MENU_ITEMS
            .iter()
            .find(|spec| spec.id == "app.openSettings")
            .and_then(|spec| spec.default_accelerator);
        let quit = MENU_ITEMS
            .iter()
            .find(|spec| spec.id == "app.quit")
            .and_then(|spec| spec.default_accelerator);
        let debug = MENU_ITEMS
            .iter()
            .find(|spec| spec.id == "help.toggleInspector")
            .and_then(|spec| spec.default_accelerator);
        let close_window = MENU_ITEMS
            .iter()
            .find(|spec| spec.id == "tab.close")
            .and_then(|spec| spec.default_accelerator);
        assert_eq!(settings, Some("CmdOrCtrl+,"));
        assert_eq!(quit, Some("CmdOrCtrl+Q"));
        assert_eq!(debug, Some("CmdOrCtrl+Alt+I"));
        assert_eq!(close_window, Some("CmdOrCtrl+W"));
    }

    #[test]
    fn plat_15_help_items_follow_the_registry_ids() {
        assert_eq!(
            menu_id_for_command("app.openSettings"),
            Some("app.openSettings")
        );
        assert_eq!(
            menu_id_for_command("app.showShortcuts"),
            Some("help.keyboardShortcuts")
        );
        assert_eq!(
            menu_id_for_command("app.openDiagnostics"),
            Some("help.diagnostics")
        );
        assert_eq!(
            menu_id_for_command("app.openDebugTools"),
            Some("help.toggleInspector")
        );
        assert_eq!(menu_id_for_command("chat.submit"), None);
    }

    #[test]
    fn plat_15_a_registry_id_sets_the_help_item_it_names() {
        let plan = plan_shortcuts(&[shortcut("app.openDebugTools", Some("CmdOrCtrl+Alt+I"))]);
        assert_eq!(
            plan.applied,
            vec![PlannedShortcut {
                command_id: "app.openDebugTools".to_string(),
                menu_id: "help.toggleInspector",
                change: ShortcutChange::Set("CmdOrCtrl+Alt+I".to_string()),
            }]
        );
    }

    #[test]
    fn plat_15_a_valid_shortcut_is_applied() {
        let plan = plan_shortcuts(&[shortcut("view.toggleLeftSidebar", Some("CmdOrCtrl+B"))]);
        assert_eq!(plan.rejected, Vec::<String>::new());
        assert_eq!(
            plan.applied,
            vec![PlannedShortcut {
                command_id: "view.toggleLeftSidebar".to_string(),
                menu_id: "view.toggleLeftSidebar",
                change: ShortcutChange::Set("CmdOrCtrl+B".to_string()),
            }]
        );
    }

    #[test]
    fn plat_15_an_invalid_shortcut_is_rejected_and_changes_nothing() {
        let plan = plan_shortcuts(&[shortcut("view.toggleLeftSidebar", Some("NotAKey"))]);
        assert_eq!(plan.applied, Vec::<PlannedShortcut>::new());
        assert_eq!(plan.rejected, vec!["view.toggleLeftSidebar".to_string()]);
    }

    #[test]
    fn plat_15_a_cleared_or_unknown_binding_is_handled() {
        let plan = plan_shortcuts(&[
            shortcut("view.toggleRightSidebar", None),
            shortcut("chat.submit", Some("Cmd+Enter")),
        ]);
        assert_eq!(
            plan.applied,
            vec![PlannedShortcut {
                command_id: "view.toggleRightSidebar".to_string(),
                menu_id: "view.toggleRightSidebar",
                change: ShortcutChange::Clear,
            }]
        );
        assert_eq!(plan.rejected, Vec::<String>::new());
    }

    #[test]
    fn plat_15_a_quit_before_the_ui_listens_is_held_then_delivered() {
        let gate = QuitGate::default();
        assert!(!gate.request());
        assert!(gate.mark_ready());
        assert!(!gate.mark_ready());
        assert!(gate.request());
    }

    #[test]
    fn plat_15_a_quit_racing_the_ready_call_is_delivered_exactly_once() {
        use std::sync::{Arc, Barrier};

        for _ in 0..100 {
            let gate = Arc::new(QuitGate::default());
            let barrier = Arc::new(Barrier::new(2));

            let requesting = {
                let gate = Arc::clone(&gate);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    gate.request()
                })
            };
            let becoming_ready = {
                let gate = Arc::clone(&gate);
                let barrier = Arc::clone(&barrier);
                std::thread::spawn(move || {
                    barrier.wait();
                    gate.mark_ready()
                })
            };

            let delivered = [requesting.join().unwrap(), becoming_ready.join().unwrap()]
                .into_iter()
                .filter(|delivered| *delivered)
                .count();
            assert_eq!(delivered, 1);
        }
    }
}
