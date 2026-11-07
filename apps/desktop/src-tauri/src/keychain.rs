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
//! - Empty keys fail with `keychain_bad_key`. Values may be empty but not larger than 64 KiB;
//!   a larger value fails with `keychain_value_too_large`.
//! - Values never appear in logs, error messages or events. Keychain calls can block on a system
//!   prompt, so they run on the blocking thread pool.
//!
//! Our design choice: the service name is the bundle identifier, not Conductor's per-key prefix.
//! The implementation uses the `security-framework` crate.
//!
//! Test first: set, get and delete round-trip under a unique test service, and a get after the
//! delete returns `None`. The test removes everything it created.

use crate::error::{CommandError, CommandResult, blocking};
use security_framework::passwords::{
    delete_generic_password, get_generic_password, set_generic_password,
};

/// Keychain service name for every item Conducted stores.
pub const SERVICE: &str = "build.conducted.app";
/// Largest value accepted.
pub const MAX_VALUE_BYTES: usize = 64 * 1024;

/// The item was not found. `SecItemCopyMatching` and `SecItemDelete` report it when the key is new.
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;
/// The user cancelled the access prompt.
const ERR_SEC_USER_CANCELED: i32 = -128;
/// The item's access control refused the operation.
const ERR_SEC_AUTH_FAILED: i32 = -25293;
/// The Keychain cannot prompt, for example because the app runs without a user session.
const ERR_SEC_INTERACTION_NOT_ALLOWED: i32 = -25308;

/// Rejects a key that cannot name an item.
fn check_key(key: &str) -> CommandResult<()> {
    if key.is_empty() {
        return Err(CommandError::Failed {
            code: "keychain_bad_key",
            message: "A secret needs a non-empty key.".to_string(),
        });
    }
    Ok(())
}

/// Rejects a value larger than the Keychain item limit.
fn check_value(value: &str) -> CommandResult<()> {
    if value.len() > MAX_VALUE_BYTES {
        return Err(CommandError::Failed {
            code: "keychain_value_too_large",
            message: format!("A secret may be at most {MAX_VALUE_BYTES} bytes."),
        });
    }
    Ok(())
}

/// Maps a Security framework error to a stable code. The message never contains the value.
fn to_error(error: security_framework::base::Error, key: &str) -> CommandError {
    let code = error.code();
    let denied = matches!(
        code,
        ERR_SEC_USER_CANCELED | ERR_SEC_AUTH_FAILED | ERR_SEC_INTERACTION_NOT_ALLOWED
    );
    if denied {
        return CommandError::Failed {
            code: "keychain_denied",
            message: format!("Access to the Keychain was denied for the key \"{key}\"."),
        };
    }
    CommandError::Failed {
        code: "keychain_failed",
        message: format!("The Keychain call failed for the key \"{key}\": {error}"),
    }
}

/// Reads a secret from one service. `None` when it does not exist.
pub(crate) fn read_secret(service: &str, key: &str) -> CommandResult<Option<String>> {
    match get_generic_password(service, key) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| CommandError::Failed {
                code: "keychain_failed",
                message: format!("The secret stored under \"{key}\" is not valid UTF-8."),
            }),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(error) => Err(to_error(error, key)),
    }
}

/// Stores or replaces a secret in one service.
pub(crate) fn write_secret(service: &str, key: &str, value: &str) -> CommandResult<()> {
    set_generic_password(service, key, value.as_bytes()).map_err(|error| to_error(error, key))
}

/// Removes a secret from one service. A missing item is not an error.
pub(crate) fn remove_secret(service: &str, key: &str) -> CommandResult<()> {
    match delete_generic_password(service, key) {
        Ok(()) => Ok(()),
        Err(error) if error.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(error) => Err(to_error(error, key)),
    }
}

/// Reads a secret. `None` when it does not exist.
#[tauri::command]
pub async fn keychain_get(key: String) -> CommandResult<Option<String>> {
    check_key(&key)?;
    blocking("keychain_failed", move || read_secret(SERVICE, &key)).await
}

/// Stores or replaces a secret.
#[tauri::command]
pub async fn keychain_set(key: String, value: String) -> CommandResult<()> {
    check_key(&key)?;
    check_value(&value)?;
    blocking("keychain_failed", move || {
        write_secret(SERVICE, &key, &value)
    })
    .await
}

/// Removes a secret. Succeeds when it does not exist.
#[tauri::command]
pub async fn keychain_delete(key: String) -> CommandResult<()> {
    check_key(&key)?;
    blocking("keychain_failed", move || remove_secret(SERVICE, &key)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// A name that this test alone uses.
    fn unique_name(label: &str) -> String {
        let counter = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("plat-10-{label}-{}-{counter}", std::process::id())
    }

    /// A service name that this test alone uses.
    fn test_service() -> String {
        unique_name("service")
    }

    /// A key in the real service that the test removes on drop.
    struct ServiceKey(String);

    impl ServiceKey {
        fn new(label: &str) -> Self {
            Self(unique_name(label))
        }

        fn key(&self) -> &str {
            &self.0
        }
    }

    impl Drop for ServiceKey {
        fn drop(&mut self) {
            if let Err(error) = remove_secret(SERVICE, &self.0) {
                eprintln!("could not remove test Keychain item {}: {error}", self.0);
            }
        }
    }

    /// Removes every key a test created, even when an assertion panics.
    struct TestSecrets {
        service: String,
        keys: RefCell<Vec<String>>,
    }

    impl TestSecrets {
        fn new() -> Self {
            Self {
                service: test_service(),
                keys: RefCell::new(Vec::new()),
            }
        }

        fn write(&self, key: &str, value: &str) {
            self.keys.borrow_mut().push(key.to_string());
            write_secret(&self.service, key, value).expect("write secret");
        }

        fn read(&self, key: &str) -> CommandResult<Option<String>> {
            read_secret(&self.service, key)
        }

        fn delete(&self, key: &str) -> CommandResult<()> {
            remove_secret(&self.service, key)
        }
    }

    impl Drop for TestSecrets {
        fn drop(&mut self) {
            for key in self.keys.borrow().iter() {
                if let Err(error) = remove_secret(&self.service, key) {
                    eprintln!("could not remove test Keychain item {key}: {error}");
                }
            }
        }
    }

    fn error_code(error: CommandError) -> &'static str {
        match error {
            CommandError::Failed { code, .. } => code,
            CommandError::NotImplemented(_) => "not_implemented",
            CommandError::Io(_) => "io",
        }
    }

    #[test]
    fn plat_10_commands_round_trip_in_the_app_service() {
        let key = ServiceKey::new("command");

        let missing = tauri::async_runtime::block_on(keychain_get(key.key().to_string()))
            .expect("get missing");
        assert_eq!(missing, None);

        tauri::async_runtime::block_on(keychain_set(key.key().to_string(), "hello".to_string()))
            .expect("set");
        assert_eq!(
            tauri::async_runtime::block_on(keychain_get(key.key().to_string())).expect("get"),
            Some("hello".to_string())
        );

        tauri::async_runtime::block_on(keychain_delete(key.key().to_string())).expect("delete");
        assert_eq!(
            tauri::async_runtime::block_on(keychain_get(key.key().to_string())).expect("get after"),
            None
        );
        tauri::async_runtime::block_on(keychain_delete(key.key().to_string()))
            .expect("delete missing");
    }

    #[test]
    fn plat_10_set_get_and_delete_round_trip() {
        let secrets = TestSecrets::new();
        let key = "round_trip";

        assert_eq!(secrets.read(key).expect("get missing"), None);

        secrets.write(key, "first");
        assert_eq!(secrets.read(key).expect("get"), Some("first".to_string()));

        secrets.write(key, "second");
        assert_eq!(
            secrets.read(key).expect("get replaced"),
            Some("second".to_string())
        );

        secrets.delete(key).expect("delete");
        assert_eq!(secrets.read(key).expect("get after delete"), None);
        secrets.delete(key).expect("delete missing");
    }

    #[test]
    fn plat_10_stores_one_generic_password_item_per_key() {
        let secrets = TestSecrets::new();

        secrets.write("alpha", "one");
        secrets.write("beta", "two");

        assert_eq!(
            secrets.read("alpha").expect("alpha"),
            Some("one".to_string())
        );
        assert_eq!(secrets.read("beta").expect("beta"), Some("two".to_string()));

        secrets.delete("alpha").expect("delete alpha");
        assert_eq!(secrets.read("alpha").expect("alpha after delete"), None);
        assert_eq!(
            secrets.read("beta").expect("beta remains"),
            Some("two".to_string())
        );
    }

    #[test]
    fn plat_10_accepts_an_empty_value() {
        let secrets = TestSecrets::new();
        let key = "empty";

        secrets.write(key, "");

        assert_eq!(secrets.read(key).expect("get"), Some(String::new()));
    }

    #[test]
    fn plat_10_rejects_an_empty_key() {
        let error = tauri::async_runtime::block_on(keychain_get(String::new())).expect_err("key");
        assert_eq!(error_code(error), "keychain_bad_key");

        let error =
            tauri::async_runtime::block_on(keychain_set(String::new(), "value".to_string()))
                .expect_err("set key");
        assert_eq!(error_code(error), "keychain_bad_key");

        let error =
            tauri::async_runtime::block_on(keychain_delete(String::new())).expect_err("delete key");
        assert_eq!(error_code(error), "keychain_bad_key");
    }

    #[test]
    fn plat_10_rejects_a_value_larger_than_64_kib() {
        let key = format!("plat-10-too-large-{}", std::process::id());
        let value = "x".repeat(MAX_VALUE_BYTES + 1);

        let error =
            tauri::async_runtime::block_on(keychain_set(key, value)).expect_err("too large");
        assert_eq!(error_code(error), "keychain_value_too_large");
    }

    #[test]
    fn plat_10_items_share_the_bundle_identifier_service() {
        let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("tauri.conf.json is valid JSON");
        let identifier = config["identifier"]
            .as_str()
            .expect("tauri.conf.json has an identifier");

        assert_eq!(SERVICE, identifier);
    }
}
