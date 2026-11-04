//! @feature PLAT-10 Keychain read and write
//!
//! Owns: storing small secrets (tokens, API keys) in the macOS Keychain and reading them back.
//!
//! Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 (`keychain_settings.rs`:
//! `get_keychain_setting`, `set_keychain_setting`, `delete_keychain_setting`) and A5 (Keychain:
//! generic-password items, one per key, created when absent).
//!
//! Must handle:
//! - Items are generic passwords. The service is `SERVICE`, the account is the key.
//! - `keychain_get` returns `None` when the item does not exist. It is not an error.
//! - `keychain_set` replaces an existing item and creates a missing one.
//! - `keychain_delete` on a missing item succeeds.
//! - The user can deny access in the system prompt: fail with `keychain_denied`, so the UI can
//!   explain instead of showing a raw status code. Other failures use `keychain_failed`.
//! - Empty keys fail with `keychain_bad_key`. Values may be empty but not larger than 64 KiB.
//! - Values never appear in logs, error messages or events. Keychain calls can block on a system
//!   prompt, so they run on the blocking thread pool.
//!
//! Our design choice: the service name is the bundle identifier, not Conductor's per-key prefix.
//! The implementation adds the `security-framework` crate.
//!
//! Test first: set, get and delete round-trip under a unique test service, and a get after the
//! delete returns `None`. The test removes everything it created.

use crate::error::CommandResult;
use crate::not_implemented;

/// Keychain service name for every item Conducted stores.
pub const SERVICE: &str = "build.conducted.app";
/// Largest value accepted.
pub const MAX_VALUE_BYTES: usize = 64 * 1024;

/// Reads a secret. `None` when it does not exist.
#[tauri::command]
#[allow(unused_variables)]
pub async fn keychain_get(key: String) -> CommandResult<Option<String>> {
    not_implemented!("PLAT-10")
}

/// Stores or replaces a secret.
#[tauri::command]
#[allow(unused_variables)]
pub async fn keychain_set(key: String, value: String) -> CommandResult<()> {
    not_implemented!("PLAT-10")
}

/// Removes a secret. Succeeds when it does not exist.
#[tauri::command]
#[allow(unused_variables)]
pub async fn keychain_delete(key: String) -> CommandResult<()> {
    not_implemented!("PLAT-10")
}
