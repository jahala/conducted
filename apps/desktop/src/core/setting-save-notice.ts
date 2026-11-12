/**
 * @feature SET-02 Setting row and setting controls
 * Owns: what the user is told when a setting could not be saved, as a toast's title and text.
 * Settings rows and the services that save a setting on the user's behalf share it.
 * Behaviour: Conductor's settings writer toasts every failed save (Uz, main @389863), from a
 * settings row and from any other caller alike.
 * Test first: a save stopped by a settings file that does not parse is told as an invalid file.
 */
import { type AppError, isAppError } from "@conducted/shared";
import { SETTINGS_FILE_INVALID_MESSAGE } from "./services/settings.ts";

/** The most lines of a parse error a failed-save toast quotes, as Conductor's does. */
const QUOTED_PARSE_ERROR_LINES = 6;

/** What the user is told when a setting could not be saved: a toast's title and its text. */
export interface SettingSaveFailedNotice {
	title: string;
	description: string | null;
}

/**
 * The toast for a failed setting save, by Conductor's rule (Uz, main @389863): a save stopped by a
 * settings file that does not parse gets "Can't save setting because your settings file is
 * invalid" with the parse error's first six lines, and any other failure its own words, which for
 * a failed write are "Failed to save setting" with no text under them.
 */
export function settingSaveFailedNotice(error: AppError): SettingSaveFailedNotice {
	let cause: unknown = error;
	while (isAppError(cause) && cause.code === "settings_file_invalid") cause = cause.cause;
	// Only a parse error under the file's refusal is an invalid file; an unreadable one says so.
	if (
		error.code !== "settings_file_invalid" ||
		!isAppError(cause) ||
		cause.code !== "toml_invalid"
	) {
		return { title: error.message, description: null };
	}
	const detail = cause.message.trim();
	const lines = detail.split("\n");
	const description =
		lines.length <= QUOTED_PARSE_ERROR_LINES
			? detail
			: [...lines.slice(0, QUOTED_PARSE_ERROR_LINES), "…"].join("\n");
	return { title: SETTINGS_FILE_INVALID_MESSAGE, description };
}
