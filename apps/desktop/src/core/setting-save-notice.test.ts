// @vitest-environment node
import { appError } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	SETTINGS_FILE_INVALID_MESSAGE,
	SETTINGS_SAVE_FAILED_MESSAGE,
} from "./services/settings.ts";
import { settingSaveFailedNotice } from "./setting-save-notice.ts";

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
		});
	});

	it("a save stopped by a settings file that does not parse is told as an invalid file", () => {
		const parse = appError("toml_invalid", "Invalid TOML document: unexpected end\n\n1: [models\n");
		const read = appError("settings_file_invalid", SETTINGS_FILE_INVALID_MESSAGE, parse);
		const refused = appError("settings_file_invalid", SETTINGS_FILE_INVALID_MESSAGE, read);
		expect(settingSaveFailedNotice(refused)).toEqual({
			title: "Can't save setting because your settings file is invalid",
			description: "Invalid TOML document: unexpected end\n\n1: [models",
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
		});
	});
});
