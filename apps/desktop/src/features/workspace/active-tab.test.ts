import { describe, expect, it } from "vitest";
import {
	activeTabFromDescriptor,
	activeTabKey,
	resolveActiveTab,
	searchPatchFor,
	tabRef,
} from "./active-tab.ts";
import type { TabDescriptor } from "./tab-layout.ts";

describe("NAV-10 resolveActiveTab", () => {
	it("opens a file in diff mode on the branch scope by default", () => {
		expect(resolveActiveTab({ tab: "file", path: "a.ts" })).toEqual({
			kind: "file",
			path: "a.ts",
			mode: "diff",
			scope: { kind: "branch" },
			line: null,
		});
	});

	it("reads the scope and line of a file tab", () => {
		const tab = resolveActiveTab({ tab: "file", path: "a.ts", scope: "commit:abc", line: 12 });
		expect(tab).toMatchObject({ scope: { kind: "commit", sha: "abc" }, line: 12 });
	});

	it("falls back to the branch scope for an unreadable scope", () => {
		expect(resolveActiveTab({ tab: "file", path: "a.ts", scope: "nonsense" })).toMatchObject({
			scope: { kind: "branch" },
		});
	});

	it("gives none when the id of a tab is missing", () => {
		expect(resolveActiveTab({ tab: "terminal" })).toEqual({ kind: "none" });
		expect(resolveActiveTab({ tab: "session" })).toEqual({ kind: "none" });
		expect(resolveActiveTab({})).toEqual({ kind: "none" });
	});

	it("opens the pull request tab without an id", () => {
		expect(resolveActiveTab({ tab: "pr" })).toEqual({ kind: "pr" });
	});
});

describe("NAV-10 activeTabKey", () => {
	it("differs between two terminals and is stable for one", () => {
		const a = resolveActiveTab({ tab: "terminal", terminalId: "t1" });
		const b = resolveActiveTab({ tab: "terminal", terminalId: "t2" });
		expect(activeTabKey(a)).not.toBe(activeTabKey(b));
		expect(activeTabKey(a)).toBe(
			activeTabKey(resolveActiveTab({ tab: "terminal", terminalId: "t1" })),
		);
	});

	it("is the one tab ref used by the strip and the split panes", () => {
		expect(tabRef(resolveActiveTab({ tab: "session", sessionId: "s1" }))).toBe("session:s1");
		expect(tabRef(resolveActiveTab({ tab: "pr" }))).toBe("pr");
		expect(tabRef({ kind: "none" })).toBeNull();
		expect(activeTabKey({ kind: "none" })).toBe("none");
	});
});

describe("NAV-10 activeTabFromDescriptor", () => {
	it("keeps a file tab's mode, scope and line", () => {
		const descriptor: TabDescriptor = {
			kind: "file",
			ref: "file:a.ts",
			title: "a.ts",
			mode: "edit",
			scope: { kind: "target", branch: "main" },
			line: 12,
		};
		expect(activeTabFromDescriptor(descriptor)).toEqual({
			kind: "file",
			path: "a.ts",
			mode: "edit",
			scope: { kind: "target", branch: "main" },
			line: 12,
		});
	});

	it("round-trips a tab into the search that opens it", () => {
		const tab = resolveActiveTab({ tab: "file", path: "a.ts", scope: "commit:abc", line: 4 });
		expect(searchPatchFor(tab)).toEqual({ tab: "file", path: "a.ts" });
		expect(searchPatchFor({ kind: "none" })).toEqual({
			tab: undefined,
			sessionId: undefined,
			terminalId: undefined,
			path: undefined,
			commentId: undefined,
			browserUrl: undefined,
		});
	});
});
