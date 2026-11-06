//! @feature PLAT-24 Full Disk Access check and Privacy pane link
//!
//! Owns: the check that tells the General settings row whether this app has Full Disk Access, and
//! opening the macOS Privacy & Security pane where the user grants it.
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`check_full_disk_access`),
//! A3 (the opener scope includes the System Settings Full Disk Access pane) and A5;
//! ui-map.md 6 (the General row "Full disk access permissions").
//!
//! Must handle:
//! - A TCC database that cannot be read means no access. That is the normal state for an app
//!   without Full Disk Access, so it is an answer, not an error.
//! - A missing TCC database also means no access. The check reads another candidate when one is
//!   absent, because the user and system databases can appear separately.
//! - A System Settings that cannot open returns a failure that tells the user to grant Full Disk
//!   Access under Privacy & Security themselves. That covers `open` exiting with an error and
//!   `open` that cannot be started at all.
//!
//! Our design choice: the check opens the protected TCC database as a file. macOS allows that
//! read only with Full Disk Access, which is the same permission the row is about. We do not query
//! the database, so no schema detail can make the check wrong.
//!
//! Test first: `plat_24_reports_access_when_a_tcc_database_can_be_read` is true for a readable
//! file and `plat_24_reports_no_access_when_no_tcc_database_can_be_read` is false for missing ones.

use std::path::PathBuf;
use std::process::Command;

use crate::error::{CommandError, CommandResult};

/// The System Settings address for the Privacy & Security pane. The user picks Full Disk Access
/// from its list.
const PRIVACY_PANE_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

/// The protected databases that macOS lets only a Full Disk Access app read.
fn tcc_database_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        paths.push(PathBuf::from(home).join("Library/Application Support/com.apple.TCC/TCC.db"));
    }
    paths.push(PathBuf::from(
        "/Library/Application Support/com.apple.TCC/TCC.db",
    ));
    paths
}

/// Whether any candidate database can be opened. A read error is the answer "no access".
fn has_full_disk_access_at(paths: &[PathBuf]) -> bool {
    paths.iter().any(|path| std::fs::File::open(path).is_ok())
}

/// The `open` call that shows the Privacy & Security pane. Kept separate so a test can read it
/// without starting System Settings.
fn privacy_pane_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command.arg(PRIVACY_PANE_URL);
    command
}

/// The failure for every way System Settings can fail to open, with the step the user takes.
fn open_failed(cause: &str) -> CommandError {
    CommandError::Failed {
        code: "full_disk_access_open_failed",
        message: format!(
            "System Settings could not be opened ({cause}). Grant Full Disk Access under Privacy & Security yourself."
        ),
    }
}

fn open_settings_with(program: &str) -> CommandResult<()> {
    let status = privacy_pane_command(program)
        .status()
        .map_err(|error| open_failed(&format!("{program} could not start: {error}")))?;
    if status.success() {
        return Ok(());
    }
    Err(open_failed(&format!("{program} exited with {status}")))
}

/// Whether this app has Full Disk Access, for the General settings row.
#[tauri::command]
pub fn full_disk_access_check() -> CommandResult<bool> {
    Ok(has_full_disk_access_at(&tcc_database_paths()))
}

/// Opens System Settings at Privacy & Security, where the user grants Full Disk Access.
#[tauri::command]
pub fn full_disk_access_open_settings() -> CommandResult<()> {
    open_settings_with("/usr/bin/open")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
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
                "conducted-plat-24-{}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("create test folder");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.path).expect("remove test folder");
        }
    }

    #[test]
    fn plat_24_reports_access_when_a_tcc_database_can_be_read() {
        let folder = TempDir::new();
        let database = folder.path().join("TCC.db");
        fs::write(&database, "a stand-in for the protected database").expect("write test database");

        assert!(has_full_disk_access_at(std::slice::from_ref(&database)));
    }

    #[test]
    fn plat_24_reports_no_access_when_no_tcc_database_can_be_read() {
        let folder = TempDir::new();
        let missing = folder.path().join("TCC.db");
        assert!(!has_full_disk_access_at(std::slice::from_ref(&missing)));

        let another = folder.path().join("another.db");
        assert!(!has_full_disk_access_at(&[missing, another]));
    }

    #[test]
    fn plat_24_opens_the_privacy_and_security_pane_through_open() {
        let command = privacy_pane_command("/usr/bin/open");

        assert_eq!(command.get_program().to_string_lossy(), "/usr/bin/open");
        let args: Vec<String> = command
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect();
        assert_eq!(args, vec![PRIVACY_PANE_URL.to_string()]);
        assert!(PRIVACY_PANE_URL.starts_with("x-apple.systempreferences:"));
    }

    #[test]
    fn plat_24_open_failure_tells_the_user_to_grant_access_by_hand() {
        let error = open_settings_with("/usr/bin/false").expect_err("false exits non-zero");

        match error {
            CommandError::Failed { code, message } => {
                assert_eq!(code, "full_disk_access_open_failed");
                assert!(
                    message.contains("Full Disk Access"),
                    "message was {message:?}"
                );
                assert!(
                    message.contains("Privacy & Security"),
                    "message was {message:?}"
                );
            }
            other => panic!("unexpected error: {other}"),
        }
    }

    #[test]
    fn plat_24_an_opener_that_cannot_start_also_tells_the_user_what_to_do() {
        let folder = TempDir::new();
        let missing = folder.path().join("no-such-opener");
        let error = open_settings_with(&missing.to_string_lossy())
            .expect_err("a program that does not exist cannot start");

        match error {
            CommandError::Failed { code, message } => {
                assert_eq!(code, "full_disk_access_open_failed");
                assert!(
                    message.contains("Full Disk Access"),
                    "message was {message:?}"
                );
                assert!(
                    message.contains("Privacy & Security"),
                    "message was {message:?}"
                );
            }
            other => panic!("unexpected error: {other}"),
        }
    }
}
