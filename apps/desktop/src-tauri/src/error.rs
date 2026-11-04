//! Errors returned by Tauri commands. They serialise to `{ code, message }` so the UI's
//! Platform layer can turn them into `AppError` values (packages/shared/src/result.ts).

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

/// Placeholder for an unbuilt command body. Usage: `not_implemented!("PLAT-07")`.
#[macro_export]
macro_rules! not_implemented {
    ($id:literal) => {
        return Err($crate::error::CommandError::NotImplemented($id))
    };
}
