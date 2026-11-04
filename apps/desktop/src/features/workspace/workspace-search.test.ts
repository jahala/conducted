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
});

describe("diff scope codec", () => {
	const scopes: DiffScope[] = [
		{ kind: "branch" },
		{ kind: "uncommitted" },
		{ kind: "target", branch: "release/1.0" },
		{ kind: "commit", sha: "abc1234" },
		{ kind: "turn", sessionId: "s-1" as SessionId, turnId: "t-1" as TurnId },
	];

	it.each(scopes)("round-trips %j", (scope) => {
		expect(parseDiffScope(formatDiffScope(scope))).toEqual(scope);
	});

	it.each(["", "other", "target:", "commit", "turn:only-one", "turn:a:b:c"])(
		"rejects %j",
		(text) => {
			expect(parseDiffScope(text)).toBeNull();
		},
	);
});
