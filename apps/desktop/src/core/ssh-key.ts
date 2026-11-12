/**
 * @feature CLOUD-06 SSH key for cloud workspaces
 * Owns: the setting that chooses the private key, the `~` expansion of its path, the error word for
 * a missing public key, and `readCustomPublicKey`, the one read of a chosen key's public half. The
 * cloud SSH service and the Settings page share them.
 * Behaviour: ui-map.md 6 (the SSH key setting); Conductor reads the chosen key's `<path>.pub` with
 * `cat` through its shell command (main-BE1h_1MP.js `ib` @3846433, through `Lf` @3845832) and answers "Custom SSH public
 * key not found at <path>.pub" when it reads nothing.
 * Must handle: a key outside the folders the file commands reach (`~/.ssh` is not one of them), so
 * the read goes through the shell as Conductor's does and a typed key that exists is found (issue
 * #601); a shell that cannot run the read is its own error, never "not found".
 * Our design choice: the private file must be there too; Conductor reads only the `.pub` half, but
 * a key whose private half is gone cannot open anything. The path is an argument to a fixed
 * script, so the shell never parses it.
 * Test first: AdvancedPage.test.tsx, a typed key pair outside the app's folders is accepted.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { Shell } from "../platform/platform.ts";

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

/** Prints the `.pub` half when the private key is a file; the key path is `$1`. */
export const READ_PUBLIC_KEY_SCRIPT = 'test -f "$1" && cat "$1.pub"';

/**
 * The public half of a chosen key, read through the shell. An empty read is Conductor's "not
 * found" error with code `ssh_key_missing`; a shell that could not run the read passes its error on.
 */
export async function readCustomPublicKey(
	shell: Pick<Shell, "run">,
	keyPath: string,
	cwd: string,
): Promise<Result<string>> {
	const read = await shell.run({
		program: "sh",
		args: ["-c", READ_PUBLIC_KEY_SCRIPT, "conducted-ssh-key", keyPath],
		cwd,
	});
	if (!read.ok) return read;
	const text = read.value.exitCode === 0 ? read.value.stdout.trim() : "";
	if (text === "") return err(appError("ssh_key_missing", customSshKeyMissing(keyPath)));
	return ok(text);
}
