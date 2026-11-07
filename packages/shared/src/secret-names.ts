/**
 * @feature PLAT-18 App log files and log export
 * @feature SIDE-18 Sidecar logs go to the Rust shell's log files
 * @feature APP-03 Diagnostics page and log export
 * Owns: the one rule that decides which names hold a secret. The sidecar logger hides the values
 * under those names, and the diagnostics report hashes the environment values.
 * Behaviour: our own rule, built from the three rules it replaces (the Rust app logger, the
 * sidecar logger and the diagnostics report). It is their union, so no name one runtime hides is
 * written in clear by another. The Rust logger keeps its own copy; the shared fixture
 * packages/shared/fixtures/secret-names.json is the contract both runtimes answer.
 * Must handle: a secret word at any position in a name (API_TOKEN_VALUE), camelCase boundaries,
 * `-`, `_` and `.` separators, `key` inside another word (monkey), the keyboard and shortcut
 * names (keyboard_layout, keymap) which stay visible, `pat` only as a whole word after another
 * word (GITHUB_PAT, not REACT_COMPAT), and the CONDUCTED_INTERNAL_ prefix.
 * Our design choice: the words are exported as data, so the sidecar's contract test can compare
 * them with the Rust copy without running either rule.
 * Test first: answers every case in the shared fixture the same way.
 */

/** A name with this prefix holds an app-internal secret. */
export const SECRET_NAME_PREFIX = "CONDUCTED_INTERNAL_";

/** Words that mark a name as a secret wherever they appear. */
export const SECRET_NAME_WORDS = [
	"token",
	"secret",
	"password",
	"passwd",
	"credential",
	"authorization",
	"auth",
	"cookie",
	"apikey",
] as const;

/** A word that marks a name as a secret on its own, unless a keyboard word is present. */
export const SECRET_NAME_KEY_WORD = "key";

/** Words that mark a name as a secret only after another word. */
export const SECRET_NAME_QUALIFIED_WORDS = ["pat"] as const;

/** Keyboard and shortcut words: a name that holds one keeps the key rule from applying. */
export const KEYBOARD_NAME_WORDS = [
	"keyboard",
	"keybinding",
	"keycode",
	"keypress",
	"keymap",
] as const;

/** Splits a name at separators and camelCase boundaries, in lower case. */
function nameWords(name: string): string[] {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[^a-zA-Z0-9]+/)
		.filter((word) => word !== "")
		.map((word) => word.toLowerCase());
}

/** True when a variable or data key name holds a secret (see the header). */
export function isSecretName(name: string): boolean {
	if (name.toUpperCase().startsWith(SECRET_NAME_PREFIX)) return true;
	const compact = name.toLowerCase().replace(/[-_]/g, "");
	if (SECRET_NAME_WORDS.some((word) => compact.includes(word))) return true;
	const words = nameWords(name);
	if (words.length > 1 && SECRET_NAME_QUALIFIED_WORDS.some((word) => words.includes(word))) {
		return true;
	}
	if (KEYBOARD_NAME_WORDS.some((word) => compact.includes(word))) return false;
	return compact.includes(SECRET_NAME_KEY_WORD);
}
