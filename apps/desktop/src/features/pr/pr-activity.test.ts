import { describe, expect, it } from "vitest";
import type { PrActivityEntry } from "../../core/model.ts";
import { sortActivity } from "./pr-activity.ts";

const commit = (id: string, at: number): PrActivityEntry => ({
	kind: "commit",
	id,
	at,
	sha: id,
	subject: `Commit ${id}`,
	authorName: "Ada",
});

const comment = (id: string, at: number): PrActivityEntry => ({
	kind: "comment",
	id,
	at,
	authorLogin: "octocat",
	authorAvatarUrl: null,
	body: `Comment ${id}`,
	filePath: null,
	line: null,
	commentId: id,
});

describe("PR-07 sortActivity", () => {
	it("puts the newest first for newest-first", () => {
		const sorted = sortActivity(
			[commit("old", 1), commit("new", 3), commit("mid", 2)],
			"newest-first",
		);
		expect(sorted.map((entry) => entry.id)).toEqual(["new", "mid", "old"]);
	});

	it("puts the oldest first for oldest-first", () => {
		const sorted = sortActivity(
			[commit("old", 1), commit("new", 3), commit("mid", 2)],
			"oldest-first",
		);
		expect(sorted.map((entry) => entry.id)).toEqual(["old", "mid", "new"]);
	});

	it("keeps equal times in id order", () => {
		const sorted = sortActivity([comment("b", 5), commit("a", 5), comment("c", 5)], "newest-first");
		expect(sorted.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
	});

	it("puts entries with no usable time last in either order", () => {
		const missing = { ...commit("missing", 0), at: Number.NaN };
		expect(sortActivity([missing, commit("dated", 1)], "newest-first").at(-1)?.id).toBe("missing");
		expect(sortActivity([missing, commit("dated", 1)], "oldest-first").at(-1)?.id).toBe("missing");
	});

	it("returns an empty list unchanged", () => {
		expect(sortActivity([], "newest-first")).toEqual([]);
	});
});
