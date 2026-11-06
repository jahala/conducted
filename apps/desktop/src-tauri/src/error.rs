//! Errors returned by Tauri commands. They serialise to `{ code, message }` so the UI's
//! Platform layer can turn them into `AppError` values (packages/shared/src/result.ts).
//! `blocking` runs work that may block off the async runtime. `lock` takes a mutex and recovers
//! it when a panicking thread poisoned it, so one panic never takes a shared table down with it.

use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum CommandError {
    /// The scaffold placeholder. The feature id must exist in docs/plans/backlog.md;
    /// `pnpm stubs` lists every remaining use.
    #[error("Not implemented: {0}")]
    NotImplemented(&'static str),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{message}")]
    Failed { code: &'static str, message: String },
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let code = match self {
            CommandError::NotImplemented(_) => "not_implemented",
            CommandError::Io(_) => "io",
            CommandError::Failed { code, .. } => code,
        };
        let mut s = serializer.serialize_struct("CommandError", 2)?;
        s.serialize_field("code", code)?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

/// Runs blocking work off the async runtime, so it never stalls an async worker. A task that
/// cannot be joined fails with `code`.
pub async fn blocking<T, F>(code: &'static str, work: F) -> CommandResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> CommandResult<T> + Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(result) => result,
        Err(error) => Err(CommandError::Failed {
            code,
            message: format!("The background task could not run: {error}"),
        }),
    }
}

/// Takes `mutex`, recovering the data when another thread panicked while holding it. The data a
/// panicking thread left is still the best answer the app has, and the alternative is a second
/// panic in every later caller.
pub fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Placeholder for an unbuilt command body. Usage: `not_implemented!("<ID>")` with a backlog id.
#[macro_export]
macro_rules! not_implemented {
    ($id:literal) => {
        return Err($crate::error::CommandError::NotImplemented($id))
    };
}

/// Every `.rs` file under `src/` with its text, for the source guards in tests.
#[cfg(test)]
pub(crate) fn crate_sources() -> Vec<(String, String)> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("list the crate's source files") {
        let path = entry.expect("read a source entry").path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("rs") {
            continue;
        }
        let name = path
            .file_name()
            .expect("a listed source file has a name")
            .to_string_lossy()
            .into_owned();
        let source = std::fs::read_to_string(&path).expect("read a source file");
        files.push((name, source));
    }
    files.sort();
    files
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The source files under `src/` that define their own poison-recovering lock helper.
    fn files_defining_a_lock_helper(files: &[(String, String)]) -> Vec<String> {
        let signature = format!("fn {}<T>(mutex: &Mutex<T>)", "lock");
        files
            .iter()
            .filter(|(_, source)| source.contains(&signature))
            .map(|(name, _)| name.clone())
            .collect()
    }

    #[test]
    fn a_poisoned_mutex_still_gives_its_data() {
        let shared = std::sync::Arc::new(Mutex::new(7));
        let poisoner = std::sync::Arc::clone(&shared);
        let joined = std::thread::spawn(move || {
            let _guard = poisoner.lock().expect("the first lock works");
            panic!("poison the mutex on purpose");
        })
        .join();
        assert!(
            joined.is_err(),
            "the thread panicked while holding the lock"
        );
        assert!(shared.is_poisoned());
        assert_eq!(*lock(&shared), 7);
    }

    #[test]
    fn the_lock_helper_has_one_home() {
        assert_eq!(
            files_defining_a_lock_helper(&crate_sources()),
            vec!["error.rs".to_string()]
        );
    }

    #[test]
    fn the_lock_helper_guard_flags_a_second_copy() {
        let copy = format!(
            "fn {}<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {{ body }}",
            "lock"
        );
        let files = vec![
            ("error.rs".to_string(), copy.clone()),
            ("speech.rs".to_string(), copy),
        ];
        assert_eq!(
            files_defining_a_lock_helper(&files),
            vec!["error.rs".to_string(), "speech.rs".to_string()]
        );
    }
}
