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
//! - `app_icon` reads a known app's own icon, as Conductor does for its Open in buttons: the
//!   bundle's `CFBundleIconFile` (`plutil`), converted to a 64 px PNG by `sips` and kept in
//!   `<app data>/app-icons/<label>.png`. The copy is reused until the app's icon file is newer, so
//!   an app update brings its new icon. An app that is not installed, or whose bundle names no
//!   `.icns` file (an asset-catalogue-only app), has no icon: `None`, and the UI draws the app's
//!   kind instead, as Conductor does. A conversion that fails is an error, never an empty icon.
//!
//! Our design choice: the catalogue holds app labels only, taken from the research's list. The
//! bundle names are not checked against real installs; a wrong name shows that app as missing.
//! Conductor's app icons are not reused (D002); Finder's icon is read from
//! `/System/Library/CoreServices/Finder.app`, where macOS keeps it.
//!
//! Test first: with a temp folder standing in for `/Applications` that holds `Cursor.app` and
//! `Ghostty.app`, `installed_apps_in` returns "Finder", "Cursor" and "Ghostty" in catalogue order.
//! App icon test first: an app bundle whose Info.plist names an icon file gives a PNG data URL, and
//! the cached copy is read again without converting.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use base64::Engine as _;
use tauri::{AppHandle, Manager, Runtime};

use crate::error::{CommandError, CommandResult};

/// A tool that can open a folder.
#[derive(Debug, Clone, Copy)]
pub struct KnownApp {
    /// Name shown in the UI and passed to `open_with`.
    pub label: &'static str,
    /// Bundle names (without `.app`) that count as this tool being installed.
    pub bundle_names: &'static [&'static str],
    /// True for terminals, which open a file's parent folder instead of the file itself.
    pub terminal: bool,
}

/// The tools the "Open in" menu can offer, in menu order.
pub const KNOWN_APPS: &[KnownApp] = &[
    KnownApp {
        label: "Finder",
        bundle_names: &["Finder"],
        terminal: false,
    },
    KnownApp {
        label: "Cursor",
        bundle_names: &["Cursor"],
        terminal: false,
    },
    KnownApp {
        label: "Visual Studio Code",
        bundle_names: &["Visual Studio Code"],
        terminal: false,
    },
    KnownApp {
        label: "Zed",
        bundle_names: &["Zed", "Zed Preview", "Zed Nightly"],
        terminal: false,
    },
    KnownApp {
        label: "VSCodium",
        bundle_names: &["VSCodium"],
        terminal: false,
    },
    KnownApp {
        label: "Sublime Text",
        bundle_names: &["Sublime Text"],
        terminal: false,
    },
    KnownApp {
        label: "PyCharm",
        bundle_names: &["PyCharm", "PyCharm CE", "PyCharm Professional Edition"],
        terminal: false,
    },
    KnownApp {
        label: "IntelliJ IDEA",
        bundle_names: &[
            "IntelliJ IDEA",
            "IntelliJ IDEA CE",
            "IntelliJ IDEA Ultimate",
        ],
        terminal: false,
    },
    KnownApp {
        label: "Android Studio",
        bundle_names: &["Android Studio"],
        terminal: false,
    },
    KnownApp {
        label: "Xcode",
        bundle_names: &["Xcode"],
        terminal: false,
    },
    KnownApp {
        label: "Rider",
        bundle_names: &["Rider"],
        terminal: false,
    },
    KnownApp {
        label: "RubyMine",
        bundle_names: &["RubyMine"],
        terminal: false,
    },
    KnownApp {
        label: "WebStorm",
        bundle_names: &["WebStorm"],
        terminal: false,
    },
    KnownApp {
        label: "PhpStorm",
        bundle_names: &["PhpStorm"],
        terminal: false,
    },
    KnownApp {
        label: "GoLand",
        bundle_names: &["GoLand"],
        terminal: false,
    },
    KnownApp {
        label: "DataGrip",
        bundle_names: &["DataGrip"],
        terminal: false,
    },
    KnownApp {
        label: "Trae",
        bundle_names: &["Trae"],
        terminal: false,
    },
    KnownApp {
        label: "Antigravity",
        bundle_names: &["Antigravity"],
        terminal: false,
    },
    KnownApp {
        label: "Ghostty",
        bundle_names: &["Ghostty"],
        terminal: true,
    },
    KnownApp {
        label: "Alacritty",
        bundle_names: &["Alacritty"],
        terminal: true,
    },
    KnownApp {
        label: "iTerm",
        bundle_names: &["iTerm"],
        terminal: true,
    },
    KnownApp {
        label: "WezTerm",
        bundle_names: &["WezTerm"],
        terminal: true,
    },
    KnownApp {
        label: "Warp",
        bundle_names: &["Warp"],
        terminal: true,
    },
    KnownApp {
        label: "Hyper",
        bundle_names: &["Hyper"],
        terminal: true,
    },
    KnownApp {
        label: "Terminal",
        bundle_names: &["Terminal"],
        terminal: true,
    },
    KnownApp {
        label: "GitHub Desktop",
        bundle_names: &["GitHub Desktop"],
        terminal: false,
    },
    KnownApp {
        label: "Sourcetree",
        bundle_names: &["Sourcetree"],
        terminal: false,
    },
    KnownApp {
        label: "Fork",
        bundle_names: &["Fork"],
        terminal: false,
    },
    KnownApp {
        label: "Kaleidoscope",
        bundle_names: &["Kaleidoscope"],
        terminal: false,
    },
    KnownApp {
        label: "Devin Desktop",
        bundle_names: &["Devin Desktop", "Devin"],
        terminal: false,
    },
];

/// The application folders this Mac keeps apps in. A missing `$HOME` simply leaves out the user's
/// own folder; the system folders are still searched.
fn application_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/Applications"),
        PathBuf::from("/System/Applications"),
        PathBuf::from("/System/Applications/Utilities"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    dirs
}

/// The folders an app's icon is looked up in: the application folders, plus the one that holds
/// Finder, which is never under `/Applications`.
fn icon_bundle_dirs() -> Vec<PathBuf> {
    let mut dirs = application_dirs();
    dirs.push(PathBuf::from("/System/Library/CoreServices"));
    dirs
}

/// Finds the bundle for `app` under the given folders, trying each accepted bundle name in turn.
fn bundle_path(app: &KnownApp, application_dirs: &[&Path]) -> Option<PathBuf> {
    for dir in application_dirs {
        for name in app.bundle_names {
            let candidate = dir.join(format!("{name}.app"));
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Finds the known apps installed under the given application folders. Pure over the folder
/// contents, so tests can pass a temp folder.
pub fn installed_apps_in(application_dirs: &[&Path]) -> CommandResult<Vec<&'static str>> {
    let installed = KNOWN_APPS
        .iter()
        .filter(|app| app.label == "Finder" || bundle_path(app, application_dirs).is_some())
        .map(|app| app.label)
        .collect();
    Ok(installed)
}

/// What `open` should do for one request.
#[derive(Debug, Clone, PartialEq, Eq)]
enum OpenAction {
    /// Select the item in a Finder window.
    RevealInFinder { path: PathBuf },
    /// Open the folder itself in Finder.
    OpenFolder { path: PathBuf },
    /// Open a path with the given app bundle.
    OpenWith { bundle: PathBuf, target: PathBuf },
}

/// The path must exist. A missing path is an expected failure, not an invented empty answer.
fn require_existing(path: &Path) -> CommandResult<fs::Metadata> {
    match fs::metadata(path) {
        Ok(metadata) => Ok(metadata),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Err(CommandError::Failed {
            code: "open_with_missing_path",
            message: format!("{} does not exist.", path.display()),
        }),
        Err(error) => Err(CommandError::Io(error)),
    }
}

fn unknown_app(app_name: &str) -> CommandError {
    CommandError::Failed {
        code: "open_with_unknown_app",
        message: format!("\"{app_name}\" is not an app the Open in menu knows."),
    }
}

fn missing_app(app: &KnownApp) -> CommandError {
    CommandError::Failed {
        code: "open_with_not_installed",
        message: format!("{} is not installed.", app.label),
    }
}

/// Decides what to open. Kept separate from running `open`, so tests can check the choice and the
/// arguments without launching an app.
fn plan_open(app_name: &str, path: &Path, application_dirs: &[&Path]) -> CommandResult<OpenAction> {
    let app = KNOWN_APPS
        .iter()
        .find(|app| app.label == app_name)
        .ok_or_else(|| unknown_app(app_name))?;
    let metadata = require_existing(path)?;
    let is_directory = metadata.is_dir();

    if app.label == "Finder" {
        return Ok(if is_directory {
            OpenAction::OpenFolder {
                path: path.to_path_buf(),
            }
        } else {
            OpenAction::RevealInFinder {
                path: path.to_path_buf(),
            }
        });
    }

    let bundle = bundle_path(app, application_dirs).ok_or_else(|| missing_app(app))?;
    let target = if app.terminal && !is_directory {
        path.parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .map_or_else(|| PathBuf::from("."), Path::to_path_buf)
    } else {
        path.to_path_buf()
    };
    Ok(OpenAction::OpenWith { bundle, target })
}

fn plan_reveal(path: &Path) -> CommandResult<OpenAction> {
    require_existing(path)?;
    Ok(OpenAction::RevealInFinder {
        path: path.to_path_buf(),
    })
}

/// Builds the `open` call for an action. Arguments stay a list; no shell is involved.
fn open_command(action: &OpenAction) -> Command {
    let mut command = Command::new("open");
    match action {
        OpenAction::RevealInFinder { path } => {
            command.arg("-R").arg(path);
        }
        OpenAction::OpenFolder { path } => {
            command.arg(path);
        }
        OpenAction::OpenWith { bundle, target } => {
            command.arg("-a").arg(bundle).arg(target);
        }
    }
    command
}

fn run_open(action: &OpenAction) -> CommandResult<()> {
    let output = open_command(action)
        .output()
        .map_err(|error| CommandError::Failed {
            code: "open_failed",
            message: format!("Could not run open: {error}"),
        })?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stderr = stderr.trim();
    Err(CommandError::Failed {
        code: "open_failed",
        message: if stderr.is_empty() {
            format!("open exited with {}.", output.status)
        } else {
            stderr.to_string()
        },
    })
}

/// The edge of the PNG an icon is cached as: the 16 px slot at 2x, with room for 32 px rows.
const ICON_PIXELS: u32 = 64;

/// The folder of cached icons inside the app data folder.
const ICON_CACHE_DIR: &str = "app-icons";

fn icon_failed(message: String) -> CommandError {
    CommandError::Failed {
        code: "app_icon_failed",
        message,
    }
}

/// The `.icns` file a bundle names in its Info.plist, or `None` when it names none or the file
/// is not there. `plutil` reads both XML and binary property lists.
fn icon_source(bundle: &Path) -> CommandResult<Option<PathBuf>> {
    let info = bundle.join("Contents").join("Info.plist");
    if !info.is_file() {
        return Ok(None);
    }
    let output = Command::new("/usr/bin/plutil")
        .args(["-extract", "CFBundleIconFile", "raw", "-o", "-"])
        .arg(&info)
        .output()
        .map_err(|error| icon_failed(format!("Could not run plutil: {error}")))?;
    // plutil exits 1 when the key is missing: the bundle names no icon file.
    if !output.status.success() {
        return Ok(None);
    }
    let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if name.is_empty() {
        return Ok(None);
    }
    let file = if Path::new(&name)
        .extension()
        .is_some_and(|ext| ext == "icns")
    {
        name
    } else {
        format!("{name}.icns")
    };
    let path = bundle.join("Contents").join("Resources").join(file);
    Ok(path.is_file().then_some(path))
}

/// True when the cached PNG was written after the icon file last changed.
fn cache_is_fresh(cached: &Path, source: &Path) -> CommandResult<bool> {
    let cached_at = match fs::metadata(cached) {
        Ok(metadata) => metadata.modified()?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(CommandError::Io(error)),
    };
    let source_at = fs::metadata(source)?.modified()?;
    Ok(cached_at >= source_at)
}

/// Converts the icon file to a PNG next to the cache entry, then moves it into place, so a
/// reader never sees half a file.
fn convert_icon(source: &Path, cached: &Path) -> CommandResult<()> {
    let partial = cached.with_extension("png.partial");
    let output = Command::new("/usr/bin/sips")
        .args(["-s", "format", "png", "-Z", &ICON_PIXELS.to_string()])
        .arg(source)
        .arg("--out")
        .arg(&partial)
        .output()
        .map_err(|error| icon_failed(format!("Could not run sips: {error}")))?;
    if !output.status.success() || !partial.is_file() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if partial.exists() {
            fs::remove_file(&partial)?;
        }
        return Err(icon_failed(format!(
            "Could not convert {}: {}",
            source.display(),
            if stderr.is_empty() {
                output.status.to_string()
            } else {
                stderr
            }
        )));
    }
    fs::rename(&partial, cached)?;
    Ok(())
}

/// Reads a known app's icon as a PNG data URL, converting and caching it on the first read.
/// Pure over the folders it is given, so tests can pass temp folders.
pub fn app_icon_in(
    app_name: &str,
    application_dirs: &[&Path],
    cache_dir: &Path,
) -> CommandResult<Option<String>> {
    let app = KNOWN_APPS
        .iter()
        .find(|app| app.label == app_name)
        .ok_or_else(|| unknown_app(app_name))?;
    let Some(bundle) = bundle_path(app, application_dirs) else {
        return Ok(None);
    };
    let Some(source) = icon_source(&bundle)? else {
        return Ok(None);
    };
    fs::create_dir_all(cache_dir)?;
    let cached = cache_dir.join(format!("{}.png", app.label));
    if !cache_is_fresh(&cached, &source)? {
        convert_icon(&source, &cached)?;
    }
    let bytes = fs::read(&cached)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(Some(format!("data:image/png;base64,{encoded}")))
}

/// Selects a file or folder in a Finder window.
#[tauri::command]
pub async fn reveal_in_finder(path: String) -> CommandResult<()> {
    run_open(&plan_reveal(Path::new(&path))?)
}

/// Opens a folder or file in one of the known apps.
#[tauri::command]
pub async fn open_with(app_name: String, path: String) -> CommandResult<()> {
    let dirs = application_dirs();
    let dir_refs: Vec<&Path> = dirs.iter().map(PathBuf::as_path).collect();
    let action = plan_open(&app_name, Path::new(&path), &dir_refs)?;
    run_open(&action)
}

/// A known app's own icon as a PNG data URL, or `None` when it has no icon file to read.
#[tauri::command]
pub async fn app_icon<R: Runtime>(
    app: AppHandle<R>,
    app_name: String,
) -> CommandResult<Option<String>> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| icon_failed(format!("Could not find the app data folder: {error}")))?;
    let dirs = icon_bundle_dirs();
    let dir_refs: Vec<&Path> = dirs.iter().map(PathBuf::as_path).collect();
    app_icon_in(&app_name, &dir_refs, &data.join(ICON_CACHE_DIR))
}

/// Lists the labels of the known apps that are installed.
#[tauri::command]
pub async fn installed_apps() -> CommandResult<Vec<String>> {
    let dirs = application_dirs();
    let dir_refs: Vec<&Path> = dirs.iter().map(PathBuf::as_path).collect();
    let labels = installed_apps_in(&dir_refs)?;
    Ok(labels.into_iter().map(str::to_string).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsStr;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A folder that removes itself, so a test leaves nothing behind.
    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new() -> Self {
            let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "conducted-plat-19-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test folder");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }

        fn app(&self, name: &str) -> PathBuf {
            let bundle = self.path.join(format!("{name}.app"));
            fs::create_dir_all(&bundle).expect("create app bundle");
            bundle
        }

        fn file(&self, name: &str) -> PathBuf {
            let path = self.path.join(name);
            fs::write(&path, "hello").expect("create file");
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.path).expect("remove test folder");
        }
    }

    fn app_dirs(folders: &[TempDir]) -> Vec<&Path> {
        folders.iter().map(TempDir::path).collect()
    }

    fn error_code(error: CommandError) -> &'static str {
        match error {
            CommandError::Failed { code, .. } => code,
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn plat_19_installed_apps_in_lists_known_bundles_in_catalogue_order() {
        let folder = TempDir::new();
        folder.app("Cursor");
        folder.app("Ghostty");
        folder.app("Something Else");

        let installed = installed_apps_in(&app_dirs(&[folder])).expect("scan folders");

        assert_eq!(installed, vec!["Finder", "Cursor", "Ghostty"]);
    }

    #[test]
    fn plat_19_installed_apps_in_accepts_every_bundle_name() {
        let folder = TempDir::new();
        folder.app("Zed Preview");
        folder.app("IntelliJ IDEA CE");

        let installed = installed_apps_in(&app_dirs(&[folder])).expect("scan folders");

        assert_eq!(installed, vec!["Finder", "Zed", "IntelliJ IDEA"]);
    }

    #[test]
    fn plat_19_installed_apps_in_searches_every_application_folder() {
        let first = TempDir::new();
        let second = TempDir::new();
        second.app("Cursor");

        let installed = installed_apps_in(&app_dirs(&[first, second])).expect("scan folders");

        assert_eq!(installed, vec!["Finder", "Cursor"]);
    }

    #[test]
    fn plat_19_installed_apps_in_always_lists_finder() {
        let folder = TempDir::new();

        let installed = installed_apps_in(&app_dirs(&[folder])).expect("scan folders");

        assert_eq!(installed, vec!["Finder"]);
    }

    #[test]
    fn plat_19_open_with_rejects_a_label_outside_the_catalogue() {
        let folder = TempDir::new();
        let file = folder.file("note.txt");

        let error = plan_open("Definitely Not An Editor", &file, &app_dirs(&[folder]))
            .expect_err("an unknown app is refused");

        assert_eq!(error_code(error), "open_with_unknown_app");
    }

    #[test]
    fn plat_19_open_with_requires_an_existing_path() {
        let folder = TempDir::new();
        let missing = folder.path().join("missing.txt");

        let error = plan_open("Finder", &missing, &app_dirs(&[folder]))
            .expect_err("a missing path is refused");

        assert_eq!(error_code(error), "open_with_missing_path");
    }

    #[test]
    fn plat_19_open_with_reports_an_app_that_is_no_longer_installed() {
        let folder = TempDir::new();
        let file = folder.file("note.txt");

        let error = plan_open("Cursor", &file, &app_dirs(&[folder]))
            .expect_err("an uninstalled app is refused");

        assert_eq!(error_code(error), "open_with_not_installed");
    }

    #[test]
    fn plat_19_open_with_passes_the_bundle_path_and_file_to_open() {
        let folder = TempDir::new();
        let bundle = folder.app("Cursor");
        let file = folder.file("note.txt");

        let action = plan_open("Cursor", &file, &app_dirs(&[folder])).expect("plan the open");

        assert_eq!(
            action,
            OpenAction::OpenWith {
                bundle: bundle.clone(),
                target: file.clone(),
            }
        );
        assert_eq!(
            open_command(&action).get_args().collect::<Vec<_>>(),
            vec![OsStr::new("-a"), bundle.as_os_str(), file.as_os_str(),]
        );
    }

    #[test]
    fn plat_19_a_terminal_opens_a_files_parent_folder() {
        let folder = TempDir::new();
        let bundle = folder.app("Ghostty");
        let file = folder.file("note.txt");

        let action = plan_open("Ghostty", &file, &app_dirs(&[folder])).expect("plan the open");

        assert_eq!(
            action,
            OpenAction::OpenWith {
                bundle,
                target: file.parent().expect("the file has a parent").to_path_buf(),
            }
        );
    }

    #[test]
    fn plat_19_a_terminal_opens_a_folder_itself() {
        let folder = TempDir::new();
        let bundle = folder.app("Ghostty");
        let directory = folder.path().join("workspace");
        fs::create_dir_all(&directory).expect("create workspace folder");

        let action = plan_open("Ghostty", &directory, &app_dirs(&[folder])).expect("plan the open");

        assert_eq!(
            action,
            OpenAction::OpenWith {
                bundle,
                target: directory,
            }
        );
    }

    #[test]
    fn plat_19_finder_reveals_a_file_and_opens_a_folder() {
        let folder = TempDir::new();
        let file = folder.file("note.txt");
        let directory = folder.path().join("workspace");
        fs::create_dir_all(&directory).expect("create workspace folder");

        let folders = [folder];
        let dirs = app_dirs(&folders);
        let file_action = plan_open("Finder", &file, &dirs).expect("plan the file open");
        let folder_action = plan_open("Finder", &directory, &dirs).expect("plan the folder open");

        assert_eq!(
            file_action,
            OpenAction::RevealInFinder { path: file.clone() }
        );
        assert_eq!(
            open_command(&file_action).get_args().collect::<Vec<_>>(),
            vec![OsStr::new("-R"), file.as_os_str()]
        );
        assert_eq!(
            folder_action,
            OpenAction::OpenFolder {
                path: directory.clone()
            }
        );
        assert_eq!(
            open_command(&folder_action).get_args().collect::<Vec<_>>(),
            vec![directory.as_os_str()]
        );
    }

    /// A bundle whose Info.plist names `icon_name` and holds a real `.icns` made by `sips` from a
    /// one-colour PNG.
    fn bundle_with_icon(folder: &TempDir, app: &str, icon_name: &str) -> PathBuf {
        let bundle = folder.app(app);
        let resources = bundle.join("Contents").join("Resources");
        fs::create_dir_all(&resources).expect("create Resources");
        fs::write(
            bundle.join("Contents").join("Info.plist"),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>CFBundleIconFile</key><string>{icon_name}</string></dict></plist>\n"
            ),
        )
        .expect("write Info.plist");
        let png = folder.path().join(format!("{app}-source.png"));
        image::RgbaImage::from_pixel(256, 256, image::Rgba([40, 120, 220, 255]))
            .save(&png)
            .expect("write source PNG");
        let icns = resources.join(format!("{}.icns", icon_name.trim_end_matches(".icns")));
        let status = Command::new("/usr/bin/sips")
            .args(["-s", "format", "icns"])
            .arg(&png)
            .arg("--out")
            .arg(&icns)
            .output()
            .expect("run sips");
        assert!(status.status.success(), "sips made no icns: {status:?}");
        bundle
    }

    fn decode_png(data_url: &str) -> image::DynamicImage {
        let encoded = data_url
            .strip_prefix("data:image/png;base64,")
            .expect("a PNG data URL");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("valid base64");
        image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).expect("a PNG")
    }

    #[test]
    fn plat_19_app_icon_reads_the_icon_file_the_bundle_names() {
        let apps = TempDir::new();
        let cache = TempDir::new();
        bundle_with_icon(&apps, "Cursor", "Cursor");

        let icon = app_icon_in("Cursor", &[apps.path()], cache.path())
            .expect("read the icon")
            .expect("Cursor has an icon");

        let image = decode_png(&icon);
        assert_eq!((image.width(), image.height()), (ICON_PIXELS, ICON_PIXELS));
        assert!(cache.path().join("Cursor.png").is_file());
    }

    #[test]
    fn plat_19_app_icon_accepts_an_icon_name_with_its_extension() {
        let apps = TempDir::new();
        let cache = TempDir::new();
        bundle_with_icon(&apps, "Ghostty", "Ghostty.icns");

        let icon = app_icon_in("Ghostty", &[apps.path()], cache.path()).expect("read the icon");

        assert!(icon.is_some());
    }

    #[test]
    fn plat_19_app_icon_reuses_the_cached_copy_until_the_icon_file_changes() {
        let apps = TempDir::new();
        let cache = TempDir::new();
        let bundle = bundle_with_icon(&apps, "Zed", "Zed");
        let icns = bundle.join("Contents").join("Resources").join("Zed.icns");
        let cached = cache.path().join("Zed.png");
        // A cached copy newer than the icon file is read as it is, with no conversion.
        let marker = image::RgbaImage::from_pixel(3, 3, image::Rgba([0, 0, 0, 255]));
        marker.save(&cached).expect("write cached copy");
        let icon_changed = fs::metadata(&icns)
            .and_then(|metadata| metadata.modified())
            .expect("read the icon file's time");
        fs::File::options()
            .write(true)
            .open(&cached)
            .and_then(|file| file.set_modified(icon_changed + std::time::Duration::from_secs(60)))
            .expect("date the cached copy after the icon file");

        let icon = app_icon_in("Zed", &[apps.path()], cache.path())
            .expect("read the icon")
            .expect("Zed has an icon");

        assert_eq!(decode_png(&icon).width(), 3);
    }

    #[test]
    fn plat_19_app_icon_is_none_for_an_app_without_an_icon_file() {
        let apps = TempDir::new();
        let cache = TempDir::new();
        folder_with_plain_bundle(&apps, "Warp");

        assert_eq!(
            app_icon_in("Warp", &[apps.path()], cache.path()).expect("read"),
            None
        );
        assert_eq!(
            app_icon_in("Cursor", &[apps.path()], cache.path()).expect("read"),
            None,
            "an app that is not installed has no icon"
        );
    }

    fn folder_with_plain_bundle(folder: &TempDir, app: &str) {
        let bundle = folder.app(app);
        fs::create_dir_all(bundle.join("Contents")).expect("create Contents");
        fs::write(
            bundle.join("Contents").join("Info.plist"),
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><dict></dict></plist>\n",
        )
        .expect("write Info.plist");
    }

    #[test]
    fn plat_19_app_icon_refuses_a_label_outside_the_catalogue() {
        let apps = TempDir::new();
        let cache = TempDir::new();

        let error = app_icon_in("../../etc", &[apps.path()], cache.path())
            .expect_err("an unknown app is refused");

        assert_eq!(error_code(error), "open_with_unknown_app");
    }

    #[test]
    fn plat_19_reveal_in_finder_requires_an_existing_path() {
        let folder = TempDir::new();
        let missing = folder.path().join("missing.txt");

        let error = plan_reveal(&missing).expect_err("a missing path is refused");

        assert_eq!(error_code(error), "open_with_missing_path");
    }
}
