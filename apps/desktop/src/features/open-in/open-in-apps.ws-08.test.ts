/**
 * @feature WS-08 Open-in app catalog
 * Owns: tests for the app labels the shell detects, the visible menu order and the toast title of
 * an open failure.
 * Behaviour: ui-map.md 3.10; native-and-sidecar-map.md A3.
 * Test first: visibleOpenInApps with installed ["Finder", "Cursor", "Zed"] and recent ["Zed"]
 * puts Zed first and omits every other catalog app.
 */
import { appError } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { openInCatalog, openInFailureTitle, visibleOpenInApps } from "./open-in-apps.ts";

const labels = (apps: readonly { label: string }[]) => apps.map((app) => app.label);

describe("WS-08 open-in app catalog", () => {
	it("WS-08 lists the same app labels the Rust shell detects", () => {
		expect(labels(openInCatalog())).toEqual([
			"Finder",
			"Cursor",
			"Visual Studio Code",
			"Zed",
			"VSCodium",
			"Sublime Text",
			"PyCharm",
			"IntelliJ IDEA",
			"Android Studio",
			"Xcode",
			"Rider",
			"RubyMine",
			"WebStorm",
			"PhpStorm",
			"GoLand",
			"DataGrip",
			"Trae",
			"Antigravity",
			"Ghostty",
			"Alacritty",
			"iTerm",
			"WezTerm",
			"Warp",
			"Hyper",
			"Terminal",
			"GitHub Desktop",
			"Sourcetree",
			"Fork",
			"Kaleidoscope",
			"Devin Desktop",
		]);
	});

	it("WS-08 puts the most recently used installed app first", () => {
		const visible = visibleOpenInApps(openInCatalog(), ["Finder", "Cursor", "Zed"], ["Zed"]);
		expect(labels(visible)).toEqual(["Zed", "Finder", "Cursor"]);
	});

	it("WS-08 orders the rest by category and name", () => {
		const visible = visibleOpenInApps(
			openInCatalog(),
			["Finder", "Cursor", "Ghostty", "Xcode", "GitHub Desktop"],
			[],
		);
		expect(labels(visible)).toEqual(["Finder", "Cursor", "Xcode", "Ghostty", "GitHub Desktop"]);
	});

	it("WS-08 keeps Finder when nothing else is installed and drops unknown apps", () => {
		const visible = visibleOpenInApps(openInCatalog(), ["Slack"], []);
		expect(labels(visible)).toEqual(["Finder"]);
	});

	it("WS-08 drops duplicate and uninstalled recents", () => {
		const visible = visibleOpenInApps(
			openInCatalog(),
			["Finder", "Cursor"],
			["Cursor", "Cursor", "Slack"],
		);
		expect(labels(visible)).toEqual(["Cursor", "Finder"]);
	});

	it("WS-08 maps open failures to the toast titles Conductor shows", () => {
		expect(openInFailureTitle(appError("open_with_missing_path", "Missing."))).toBe(
			"This app can't open this path",
		);
		expect(openInFailureTitle(appError("open_with_unknown_app", "Unknown."))).toBe(
			"This app can't open this path",
		);
		expect(openInFailureTitle(appError("open_with_not_installed", "Not installed."))).toBe(
			"Failed to open editor",
		);
		expect(openInFailureTitle(appError("open_in_prepare_failed", "Prepare failed."))).toBe(
			"Failed to prepare file to open",
		);
		expect(openInFailureTitle(appError("open_in_no_default_app", "No default."))).toBe(
			"No default app configured",
		);
	});
});
