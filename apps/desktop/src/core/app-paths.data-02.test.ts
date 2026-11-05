import { describe, expect, it } from "vitest";
import {
	draftAttachmentsRoot,
	draftFile,
	terminalHistoryDir,
	terminalHistoryFile,
} from "./app-paths.ts";

const paths = {
	home: "/Users/a/",
	appData: "/Users/a/Library/App/",
	temp: "/tmp",
	resources: "/App/Resources",
};

describe("DATA-02 app paths", () => {
	it("joins appData, drafts and the chat id with single slashes", () => {
		expect(draftFile(paths, "s1")).toBe("/Users/a/Library/App/drafts/s1.json");
		expect(draftFile({ ...paths, appData: "/Users/a/Library/App" }, "s1")).toBe(
			"/Users/a/Library/App/drafts/s1.json",
		);
	});

	it("names the staging root and the saved terminal scrollback", () => {
		expect(draftAttachmentsRoot(paths)).toBe("/Users/a/Library/App/draft-attachments");
		expect(terminalHistoryDir(paths)).toBe("/Users/a/Library/App/terminal-history");
		expect(terminalHistoryFile(paths, "term-1")).toBe(
			"/Users/a/Library/App/terminal-history/term-1.bin",
		);
	});
});
