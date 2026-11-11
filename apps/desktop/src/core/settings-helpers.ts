/**
 * @feature DATA-05 Settings store and settings files
 * @feature SET-04 Environment variables, stored in the Keychain
 * Owns: the reserved environment variable names and their check, the settings failure messages,
 * the run action id rules, and the shapes of a dropped settings entry. The settings and repo
 * services import them.
 * Behaviour: services-map.md 4.2.8 (reserved environment variables), 5A.1.6 (run action ids),
 * 4.2 (settings files and dropped entries).
 */

/**
 * Names the app fills in itself. They are refused in the form so a saved variable never fights the
 * app's own value (services-map.md 4.2.8 and 5A.1.2).
 */
export const RESERVED_ENV_VAR_NAMES: readonly string[] = [
	"CONDUCTED_WORKSPACE_ID",
	"CONDUCTED_WORKSPACE_NAME",
	"CONDUCTED_WORKSPACE_PATH",
	"CONDUCTED_ROOT_PATH",
	"CONDUCTED_DEFAULT_BRANCH",
	"CONDUCTED_PORT",
	"CONDUCTED_PATH_PREFIX",
];

export const isReservedEnvVarName = (name: string): boolean =>
	name.startsWith("CONDUCTED_") || RESERVED_ENV_VAR_NAMES.includes(name);

export const ENV_SAVE_FAILED_MESSAGE = "Couldn't update your environment variables";
export const ENV_FILES_FAILED_MESSAGE = "Failed to update env files";

/**
 * Trims an action id: drops a leading dash, turns dashes into spaces, removes anything that is
 * not a letter or digit, collapses spaces, then turns the spaces back into dashes.
 */
export function normalizeActionId(raw: string): string {
	return raw
		.replace(/^-+/, "")
		.replace(/-/g, " ")
		.replace(/[^A-Za-z0-9 ]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/ /g, "-");
}

/** Compares two action ids the way the product does: case-insensitive, after normalising. */
export const actionIdsEqual = (left: string, right: string): boolean =>
	normalizeActionId(left).toLowerCase() === normalizeActionId(right).toLowerCase();

/** A readable label from an action id: "my-dev-server" becomes "My dev server". */
export function actionLabel(id: string): string {
	const words = normalizeActionId(id).replace(/-/g, " ").split(" ").filter(Boolean);
	return words.map((word, index) => (index === 0 ? capitalize(word) : word)).join(" ");
}

const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export type DroppedReason =
	| "unreadable-file"
	| "invalid-file"
	| "unknown-key"
	| "wrong-type"
	| "unsupported-value";

export interface DroppedSetting {
	file: string;
	key: string;
	reason: DroppedReason;
}
