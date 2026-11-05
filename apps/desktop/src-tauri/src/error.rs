//! Errors returned by Tauri commands. They serialise to `{ code, message }` so the UI's
//! Platform layer can turn them into `AppError` values (packages/shared/src/result.ts).
//! `blocking` runs work that may block off the async runtime.

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

/// Placeholder for an unbuilt command body. Usage: `not_implemented!("<ID>")` with a backlog id.
#[macro_export]
macro_rules! not_implemented {
    ($id:literal) => {
        return Err($crate::error::CommandError::NotImplemented($id))
    };
}
