import { describe, expect, it } from "vitest";
import {
	appDataPath,
	checkpointerScript,
	contextDir,
	draftFile,
	localSettingsFile,
	setupLogFile,
	sharedSettingsFile,
	userSettingsFile,
	viewedFilesFile,
} from "./app-paths.ts";

const paths = {
	home: "/Users/a/",
	appData: "/Users/a/Library/App/",
	temp: "/tmp",
	resources: "/App/Resources",
};

describe("app paths", () => {
	it("joins with single slashes whatever the trailing slashes", () => {
		expect(draftFile(paths, "s1")).toBe("/Users/a/Library/App/drafts/s1.json");
		expect(setupLogFile(paths, "w1")).toBe("/Users/a/Library/App/setup-logs/w1.log");
		expect(viewedFilesFile(paths, "w1")).toBe("/Users/a/Library/App/viewed-files/w1.json");
	});
	it("finds the helper scripts under the resources folder", () => {
		expect(checkpointerScript(paths)).toBe("/App/Resources/bin/checkpointer.sh");
	});
	it("names the three settings files", () => {
		expect(userSettingsFile(paths)).toBe("/Users/a/.conducted/settings.toml");
		expect(sharedSettingsFile("/repo")).toBe("/repo/.conducted/settings.toml");
		expect(localSettingsFile("/repo")).toBe("/repo/.conducted/settings.local.toml");
		expect(contextDir("/repo/ws")).toBe("/repo/ws/.context");
	});
	it("joins a feature's own folders under the app data folder", () => {
		expect(appDataPath(paths, "/git-cache/", "changes", "w1.json")).toBe(
			"/Users/a/Library/App/git-cache/changes/w1.json",
		);
	});
});
