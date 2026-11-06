import type { SessionId, TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { DiffScope } from "../../core/api.ts";
import { formatDiffScope, parseDiffScope, zWorkspaceSearch } from "./workspace-search.ts";

describe("zWorkspaceSearch", () => {
	it("drops an unknown tab instead of failing", () => {
		const parsed = zWorkspaceSearch.parse({ tab: "nope", path: "src/a.ts" });
		expect(parsed.tab).toBeUndefined();
		expect(parsed.path).toBe("src/a.ts");
	});

	it("turns a numeric path from the URL parser back into a string", () => {
		expect(zWorkspaceSearch.parse({ path: 404 }).path).toBe("404");
	});

	it("drops a non-positive line", () => {
		expect(zWorkspaceSearch.parse({ line: 0 }).line).toBeUndefined();
	});

	it("accepts an empty search", () => {
		expect(zWorkspaceSearch.parse({})).toEqual({});
	});

	it("keeps the pull request number the PR tab shows", () => {
		expect(zWorkspaceSearch.parse({ tab: "pr", pr: 42 })).toEqual({ tab: "pr", pr: 42 });
		expect(zWorkspaceSearch.parse({ tab: "pr", pr: "42" })).toEqual({ tab: "pr", pr: 42 });
	});

	it("drops a pull request number that is not a positive whole number", () => {
		expect(zWorkspaceSearch.parse({ tab: "pr", pr: 0 }).pr).toBeUndefined();
		expect(zWorkspaceSearch.parse({ tab: "pr", pr: "nope" }).pr).toBeUndefined();
	});

	it("keeps the git panel tab and diff scope", () => {
		expect(zWorkspaceSearch.parse({ gitTab: "changes", scope: "target:main" })).toEqual({
			gitTab: "changes",
			scope: "target:main",
		});
	});
});

describe("diff scope codec", () => {
	const scopes: DiffScope[] = [
		{ kind: "branch" },
		{ kind: "uncommitted" },
		{ kind: "target", branch: "release/1.0" },
		{ kind: "commit", sha: "abc1234" },
		{ kind: "turn", sessionId: "s-1" as SessionId, turnId: "t-1" as TurnId },
		{ kind: "range", prNumbers: [10] },
		{ kind: "range", prNumbers: [10, 11, 12] },
	];

	it.each(scopes)("round-trips %j", (scope) => {
		expect(parseDiffScope(formatDiffScope(scope))).toEqual(scope);
	});

	it.each([
		"",
		"other",
		"target:",
		"commit",
		"turn:only-one",
		"turn:a:b:c",
		"range:",
		"range:0",
		"range:1:x",
		"range:-2",
	])("rejects %j", (text) => {
		expect(parseDiffScope(text)).toBeNull();
	});
});
