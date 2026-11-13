// @vitest-environment node
import { type AppError, appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import {
	SETTINGS_FILE_INVALID_MESSAGE,
	SETTINGS_SAVE_FAILED_MESSAGE,
	type SettingsFileRefusal,
} from "./services/settings.ts";
import {
	type SettingSaveFailedToast,
	settingSaveFailedNotice,
	tellSettingSaveFailed,
} from "./setting-save-notice.ts";

// Conductor's rule, Uz in main @389863: a parse error gets the invalid-file title and its first
// six lines, then an ellipsis; any other failure gets "Failed to save setting" alone.
describe("SET-02 the toast for a failed setting save", () => {
	it("a failed write is told as Failed to save setting with no text under it", () => {
		const failed = appError(
			"setting_save_failed",
			SETTINGS_SAVE_FAILED_MESSAGE,
			appError("fs_io", "disk full"),
		);
		expect(settingSaveFailedNotice(failed)).toEqual({
			title: "Failed to save setting",
			description: null,
			overwritable: false,
		});
	});

	it("a save stopped by a settings file that does not parse is told as an invalid file", () => {
		const parse = appError("toml_invalid", "Invalid TOML document: unexpected end\n\n1: [models\n");
		const read = appError("settings_file_invalid", SETTINGS_FILE_INVALID_MESSAGE, parse);
		const refused = appError("settings_file_invalid", SETTINGS_FILE_INVALID_MESSAGE, read);
		expect(settingSaveFailedNotice(refused)).toEqual({
			title: "Can't save setting because your settings file is invalid",
			description: "Invalid TOML document: unexpected end\n\n1: [models",
			overwritable: false,
		});
	});

	it("quotes six lines of a long parse error, then an ellipsis", () => {
		const lines = ["one", "two", "three", "four", "five", "six", "seven", "eight"];
		const parse = appError("toml_invalid", lines.join("\n"));
		const refused = appError("settings_file_invalid", SETTINGS_FILE_INVALID_MESSAGE, parse);
		expect(settingSaveFailedNotice(refused).description).toBe(
			"one\ntwo\nthree\nfour\nfive\nsix\n…",
		);
	});

	it("tells a file that could not be read by its own words, not as an invalid file", () => {
		const unreadable = appError(
			"settings_file_unreadable",
			"Could not read /home/me/.conducted/settings.toml.",
			appError("fs_out_of_scope", "outside"),
		);
		const refused = appError(
			"settings_file_invalid",
			"Could not read /home/me/.conducted/settings.toml.",
			unreadable,
		);
		expect(settingSaveFailedNotice(refused)).toEqual({
			title: "Could not read /home/me/.conducted/settings.toml.",
			description: null,
			overwritable: false,
		});
	});
});

// Conductor's Uz (main @389730) adds an "Overwrite file" button to the invalid-file toast when the
// writer can force the save (@416065), and the button runs the same save forced. A forced save
// that fails is told again, with no button, since it was already forced.
describe("SET-02 the Overwrite file button of a failed setting save", () => {
	const parse = appError("toml_invalid", "Invalid TOML document: unexpected end");
	const refusal = (overwritable: boolean): SettingsFileRefusal => ({
		code: "settings_file_invalid",
		message: SETTINGS_FILE_INVALID_MESSAGE,
		cause: parse,
		overwritable,
	});

	/** Collects what is shown, and the forced saves the button starts, each answered in turn. */
	function recorder(answers: Result<void>[]) {
		const shown: SettingSaveFailedToast[] = [];
		const runs: Promise<Result<void>>[] = [];
		const overwrite = (): Promise<Result<void>> => {
			const run = Promise.resolve(answers.shift() ?? ok(undefined));
			runs.push(run);
			return run;
		};
		const show = (toast: SettingSaveFailedToast) => shown.push(toast);
		return { shown, runs, overwrite, show };
	}

	it("offers Overwrite file when the settings file can be overwritten", () => {
		const run = recorder([]);
		tellSettingSaveFailed(refusal(true), run.overwrite, run.show);
		expect(run.shown).toHaveLength(1);
		expect(run.shown[0]?.title).toBe(SETTINGS_FILE_INVALID_MESSAGE);
		expect(run.shown[0]?.action?.label).toBe("Overwrite file");
	});

	it("offers no button when there is nothing to overwrite from", () => {
		const run = recorder([]);
		tellSettingSaveFailed(refusal(false), run.overwrite, run.show);
		expect(run.shown[0]?.action).toBeNull();
		const failed: AppError = appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE);
		tellSettingSaveFailed(failed, run.overwrite, run.show);
		expect(run.shown[1]).toEqual({
			title: "Failed to save setting",
			description: null,
			action: null,
		});
	});

	it("pressing Overwrite file runs the forced save once and shows nothing more when it works", async () => {
		const run = recorder([ok(undefined)]);
		tellSettingSaveFailed(refusal(true), run.overwrite, run.show);
		run.shown[0]?.action?.onClick();
		expect(run.runs).toHaveLength(1);
		// The button's own reaction to the answer was queued first, so it has run by now.
		await run.runs[0];
		expect(run.shown).toHaveLength(1);
	});

	it("tells a forced save that fails again, with no second button", async () => {
		const run = recorder([err(appError("setting_save_failed", SETTINGS_SAVE_FAILED_MESSAGE))]);
		tellSettingSaveFailed(refusal(true), run.overwrite, run.show);
		run.shown[0]?.action?.onClick();
		await vi.waitFor(() => expect(run.shown).toHaveLength(2));
		expect(run.runs).toHaveLength(1);
		expect(run.shown[1]).toEqual({
			title: "Failed to save setting",
			description: null,
			action: null,
		});
	});

	it("tells a forced save that throws as a failed save", async () => {
		const shown: SettingSaveFailedToast[] = [];
		tellSettingSaveFailed(
			refusal(true),
			() => Promise.reject(new Error("bug")),
			(toast) => shown.push(toast),
		);
		shown[0]?.action?.onClick();
		await vi.waitFor(() => expect(shown).toHaveLength(2));
		expect(shown[1]).toEqual({ title: "Failed to save setting", description: null, action: null });
	});
});
