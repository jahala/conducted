import { describe, expect, it } from "vitest";
import { activeTabKey, resolveActiveTab } from "./active-tab.ts";

describe("resolveActiveTab", () => {
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

describe("activeTabKey", () => {
	it("differs between two terminals and is stable for one", () => {
		const a = resolveActiveTab({ tab: "terminal", terminalId: "t1" });
		const b = resolveActiveTab({ tab: "terminal", terminalId: "t2" });
		expect(activeTabKey(a)).not.toBe(activeTabKey(b));
		expect(activeTabKey(a)).toBe(
			activeTabKey(resolveActiveTab({ tab: "terminal", terminalId: "t1" })),
		);
	});
});
