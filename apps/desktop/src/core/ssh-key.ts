/**
 * @feature CLOUD-06 SSH key for cloud workspaces
 * Owns: the setting that chooses the private key, the `~` expansion of its path, and the error
 * word for a missing public key. The cloud SSH service and the Settings page share them.
 * Behaviour: ui-map.md 6 (the SSH key setting).
 */

/** The setting that chooses the private key; empty means the auto-generated one. */
export const SSH_KEY_PATH_SETTING = "ssh_key_path";

/** Expands a leading `~` in `ssh_key_path`, as Conductor does, so no shell is needed. */
export function expandSshKeyPath(value: string, home: string): string {
	const trimmed = value.trim();
	if (trimmed === "~") return home;
	if (trimmed.startsWith("~/")) return `${home}/${trimmed.slice(2)}`;
	return trimmed;
}

/** Conductor's error when a custom key's `.pub` half cannot be read. */
export function customSshKeyMissing(keyPath: string): string {
	return `Custom SSH public key not found at ${keyPath}.pub`;
}
