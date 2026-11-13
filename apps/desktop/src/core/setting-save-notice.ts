/**
 * @feature SET-02 Setting row and setting controls
 * Owns: what the user is told when a setting could not be saved, as a toast's title, text and
 * "Overwrite file" button. Settings rows, a setting's Reset, a project's config pages and env file
 * list, and the services that save a setting on the user's behalf share it (issue #654).
 * Behaviour: Conductor's settings writer toasts every failed save (Uz, main @389730), from a
 * settings row and from any other caller alike. A save stopped by a file that does not parse gets
 * an "Overwrite file" button when the writer can force it (mutateSettingsFile, @416065); the button
 * runs the same save forced (@389976), and a forced save that fails is told again with no button.
 * Must handle: a forced save that fails, and one that throws, are each told once.
 * Test first: a save stopped by a settings file that does not parse is told as an invalid file.
 */
import { type AppError, isAppError, type Result } from "@conducted/shared";
import { fireAndForget } from "./async/fire-and-forget.ts";
import {
	SETTINGS_FILE_INVALID_MESSAGE,
	SETTINGS_SAVE_FAILED_MESSAGE,
	settingsFileOverwritable,
} from "./services/settings.ts";

/** The most lines of a parse error a failed-save toast quotes, as Conductor's does. */
const QUOTED_PARSE_ERROR_LINES = 6;

/** Conductor's label for the button that saves over an invalid settings file (main @389976). */
export const OVERWRITE_FILE_LABEL = "Overwrite file";

/** What the user is told when a setting could not be saved: a toast's title and its text. */
export interface SettingSaveFailedNotice {
	title: string;
	description: string | null;
	/** True when the toast offers "Overwrite file". */
	overwritable: boolean;
}

/** The toast for a failed setting save, with the button when it has one. */
export interface SettingSaveFailedToast {
	title: string;
	description: string | null;
	action: { label: string; onClick: () => void } | null;
}

/** Repeats the failed save with `overwrite`, for the "Overwrite file" button. */
export type OverwriteAndSave = () => Promise<Result<void>>;

/**
 * The toast for a failed setting save, by Conductor's rule (Uz, main @389730): a save stopped by a
 * settings file that does not parse gets "Can't save setting because your settings file is
 * invalid" with the parse error's first six lines, and any other failure its own words, which for
 * a failed write are "Failed to save setting" with no text under them. Only an invalid file the
 * service can overwrite offers "Overwrite file".
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
		return { title: error.message, description: null, overwritable: false };
	}
	const detail = cause.message.trim();
	const lines = detail.split("\n");
	const description =
		lines.length <= QUOTED_PARSE_ERROR_LINES
			? detail
			: [...lines.slice(0, QUOTED_PARSE_ERROR_LINES), "…"].join("\n");
	return {
		title: SETTINGS_FILE_INVALID_MESSAGE,
		description,
		overwritable: settingsFileOverwritable(error),
	};
}

/**
 * Tells a failed setting save through `show`. When the file can be overwritten, the toast's
 * "Overwrite file" button runs `overwrite`; a forced save that fails is told again with no button,
 * since it was already forced, as in Conductor.
 */
export function tellSettingSaveFailed(
	error: AppError,
	overwrite: OverwriteAndSave,
	show: (toast: SettingSaveFailedToast) => void,
): void {
	const notice = settingSaveFailedNotice(error);
	const tellForcedFailure = (failure: AppError): void => {
		const again = settingSaveFailedNotice(failure);
		show({ title: again.title, description: again.description, action: null });
	};
	show({
		title: notice.title,
		description: notice.description,
		action: notice.overwritable
			? {
					label: OVERWRITE_FILE_LABEL,
					onClick: () => {
						fireAndForget(
							async () => {
								const saved = await overwrite();
								if (!saved.ok) tellForcedFailure(saved.error);
							},
							() => show({ title: SETTINGS_SAVE_FAILED_MESSAGE, description: null, action: null }),
						);
					},
				}
			: null,
	});
}
