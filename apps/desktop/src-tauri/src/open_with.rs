//! @feature PLAT-19 Detect installed editors and terminals for "Open in"
//!
//! Owns: revealing a path in Finder, opening a folder or file in another app, and finding which
//! of the known editors, terminals and git tools are installed.
//!
//! Behaviour: docs/research/conductor/ui-map.md 3.10 (the "Open in" menu lists Finder, editors,
//! terminals and git clients; Cmd+O opens in the default app, Cmd+Shift+O opens the menu) and
//! native-and-sidecar-map.md A3 (the opener plugin's URL scope). The UI remembers the user's
//! default app; this module only reports what exists and opens things.
//!
//! Must handle:
//! - `installed_apps` returns UI labels of the apps found, always including "Finder". It looks in
//!   `/Applications`, `/System/Applications`, `/System/Applications/Utilities`, and
//!   `~/Applications`, and matches bundle names listed in `KNOWN_APPS`. JetBrains tools install
//!   under several names, so each entry lists all names it accepts.
//! - The result is stable between calls and sorted in the order of `KNOWN_APPS`.
//! - `open_with` runs `open -a <bundle path> <path>`. The app name must be one of `KNOWN_APPS`
//!   labels, never free text from the UI: an unknown label fails with `open_with_unknown_app`.
//!   Arguments are passed as an argument list, not through a shell.
//! - "Finder" means `reveal_in_finder` for a file and opening the folder for a folder.
//! - The path must exist; otherwise fail with `open_with_missing_path`.
//! - An app that was uninstalled since detection fails with `open_with_not_installed`.
//! - Terminal apps open a new window in the folder. For a file path they open its parent folder.
//! - `reveal_in_finder` selects the item in a Finder window (`open -R`).
//!
//! Our design choice: the catalogue holds app labels only, taken from the research's list. Bundle
//! names are checked against the real folders when this is built. Conductor's app icons are not
//! reused; the UI shows our own icons or the system icon for the app.
//!
//! Test first: with a temp folder standing in for `/Applications` that holds `Cursor.app` and
//! `Ghostty.app`, `installed_apps_in` returns "Finder", "Cursor" and "Ghostty" in catalogue order.

use std::path::Path;

use crate::error::CommandResult;
use crate::not_implemented;

/// A tool that can open a folder.
#[derive(Debug, Clone, Copy)]
pub struct KnownApp {
    /// Name shown in the UI and passed to `open_with`.
    pub label: &'static str,
    /// Bundle names (without `.app`) that count as this tool being installed.
    pub bundle_names: &'static [&'static str],
}

/// The tools the "Open in" menu can offer, in menu order.
pub const KNOWN_APPS: &[KnownApp] = &[
    KnownApp {
        label: "Finder",
        bundle_names: &["Finder"],
    },
    KnownApp {
        label: "Cursor",
        bundle_names: &["Cursor"],
    },
    KnownApp {
        label: "Visual Studio Code",
        bundle_names: &["Visual Studio Code"],
    },
    KnownApp {
        label: "Zed",
        bundle_names: &["Zed", "Zed Preview", "Zed Nightly"],
    },
    KnownApp {
        label: "VSCodium",
        bundle_names: &["VSCodium"],
    },
    KnownApp {
        label: "Sublime Text",
        bundle_names: &["Sublime Text"],
    },
    KnownApp {
        label: "PyCharm",
        bundle_names: &["PyCharm", "PyCharm CE", "PyCharm Professional Edition"],
    },
    KnownApp {
        label: "IntelliJ IDEA",
        bundle_names: &[
            "IntelliJ IDEA",
            "IntelliJ IDEA CE",
            "IntelliJ IDEA Ultimate",
        ],
    },
    KnownApp {
        label: "Android Studio",
        bundle_names: &["Android Studio"],
    },
    KnownApp {
        label: "Xcode",
        bundle_names: &["Xcode"],
    },
    KnownApp {
        label: "Rider",
        bundle_names: &["Rider"],
    },
    KnownApp {
        label: "RubyMine",
        bundle_names: &["RubyMine"],
    },
    KnownApp {
        label: "WebStorm",
        bundle_names: &["WebStorm"],
    },
    KnownApp {
        label: "PhpStorm",
        bundle_names: &["PhpStorm"],
    },
    KnownApp {
        label: "GoLand",
        bundle_names: &["GoLand"],
    },
    KnownApp {
        label: "DataGrip",
        bundle_names: &["DataGrip"],
    },
    KnownApp {
        label: "Trae",
        bundle_names: &["Trae"],
    },
    KnownApp {
        label: "Antigravity",
        bundle_names: &["Antigravity"],
    },
    KnownApp {
        label: "Ghostty",
        bundle_names: &["Ghostty"],
    },
    KnownApp {
        label: "Alacritty",
        bundle_names: &["Alacritty"],
    },
    KnownApp {
        label: "iTerm",
        bundle_names: &["iTerm"],
    },
    KnownApp {
        label: "WezTerm",
        bundle_names: &["WezTerm"],
    },
    KnownApp {
        label: "Warp",
        bundle_names: &["Warp"],
    },
    KnownApp {
        label: "Hyper",
        bundle_names: &["Hyper"],
    },
    KnownApp {
        label: "Terminal",
        bundle_names: &["Terminal"],
    },
    KnownApp {
        label: "GitHub Desktop",
        bundle_names: &["GitHub Desktop"],
    },
    KnownApp {
        label: "Sourcetree",
        bundle_names: &["Sourcetree"],
    },
    KnownApp {
        label: "Fork",
        bundle_names: &["Fork"],
    },
    KnownApp {
        label: "Kaleidoscope",
        bundle_names: &["Kaleidoscope"],
    },
    KnownApp {
        label: "Devin Desktop",
        bundle_names: &["Devin Desktop", "Devin"],
    },
];

/// Finds the known apps installed under the given application folders. Pure over the folder
/// contents, so tests can pass a temp folder.
pub fn installed_apps_in(_application_dirs: &[&Path]) -> CommandResult<Vec<&'static str>> {
    not_implemented!("PLAT-19")
}

/// Selects a file or folder in a Finder window.
#[tauri::command]
#[allow(unused_variables)]
pub async fn reveal_in_finder(path: String) -> CommandResult<()> {
    not_implemented!("PLAT-19")
}

/// Opens a folder or file in one of the known apps.
#[tauri::command]
#[allow(unused_variables)]
pub async fn open_with(app_name: String, path: String) -> CommandResult<()> {
    not_implemented!("PLAT-19")
}

/// Lists the labels of the known apps that are installed.
#[tauri::command]
pub async fn installed_apps() -> CommandResult<Vec<String>> {
    not_implemented!("PLAT-19")
}
