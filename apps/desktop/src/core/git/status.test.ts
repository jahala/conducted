import { describe, expect, it } from "vitest";
import {
	mergeChanges,
	operationFromMarkers,
	parseCommitLog,
	parseConflictedPaths,
	parseLeftRightCount,
	parseNameStatus,
	parseNumstat,
	parseWorktreeList,
	unquotePath,
} from "./status.ts";

describe("unquotePath", () => {
	it("leaves plain paths alone", () => {
		expect(unquotePath("src/a.ts")).toBe("src/a.ts");
	});
	it("decodes octal escapes as UTF-8 bytes", () => {
		expect(unquotePath('"caf\\303\\251.txt"')).toBe("café.txt");
	});
	it("decodes escaped quotes, tabs and backslashes", () => {
		expect(unquotePath('"a\\"b\\tc\\\\d"')).toBe('a"b\tc\\d');
	});
});

describe("parseNameStatus", () => {
	it("maps letters to statuses and reads renames", () => {
		const text = "A\tnew.ts\nM\told.ts\nD\tgone.ts\nR087\tfrom.ts\tto.ts\nT\ttype.ts\n";
		expect(parseNameStatus(text)).toEqual([
			{ path: "new.ts", status: "added" },
			{ path: "old.ts", status: "modified" },
			{ path: "gone.ts", status: "deleted" },
			{ path: "to.ts", oldPath: "from.ts", status: "renamed" },
		]);
	});
});

describe("parseNumstat", () => {
	it("reads counts and binary markers", () => {
		expect(parseNumstat("3\t1\ta.ts\n-\t-\timg.png\n")).toEqual([
			{ path: "a.ts", linesAdded: 3, linesRemoved: 1, binary: false },
			{ path: "img.png", linesAdded: 0, linesRemoved: 0, binary: true },
		]);
	});
	it("reads a brace rename as a rename to the new path", () => {
		const [entry] = parseNumstat("2\t2\tsrc/{a => b}/x.ts\n");
		expect(entry?.path).toBe("src/b/x.ts");
		expect(entry?.oldPath).toBe("src/a/x.ts");
	});
	it("reads a rename into or out of the top folder without double slashes", () => {
		const [entry] = parseNumstat("0\t0\t{ => lib}/x.ts\n");
		expect(entry?.path).toBe("lib/x.ts");
		expect(entry?.oldPath).toBe("x.ts");
	});
	it("reads a plain arrow rename and a /dev/null source", () => {
		expect(parseNumstat("1\t1\ta.ts => b.ts\n")[0]?.path).toBe("b.ts");
		const added = parseNumstat("4\t0\t/dev/null => c.ts\n")[0];
		expect(added?.path).toBe("c.ts");
		expect(added?.oldPath).toBeUndefined();
	});
	it("skips lines it cannot read", () => {
		expect(parseNumstat("garbage\n\n")).toEqual([]);
	});
});

describe("mergeChanges", () => {
	it("joins the two listings on the new path", () => {
		const changes = mergeChanges(
			parseNameStatus("R100\ta.ts\tb.ts\nM\tc.ts\n"),
			parseNumstat("0\t0\ta.ts => b.ts\n5\t2\tc.ts\n"),
		);
		expect(changes).toEqual([
			{
				path: "b.ts",
				oldPath: "a.ts",
				status: "renamed",
				linesAdded: 0,
				linesRemoved: 0,
				binary: false,
			},
			{ path: "c.ts", status: "modified", linesAdded: 5, linesRemoved: 2, binary: false },
		]);
	});
});

describe("parseConflictedPaths", () => {
	it("keeps only conflict codes", () => {
		const text = "UU a.ts\n M b.ts\nAA c.ts\nDD d.ts\nM  e.ts\n";
		expect(parseConflictedPaths(text)).toEqual(["a.ts", "c.ts", "d.ts"]);
	});
});

describe("operationFromMarkers", () => {
	it("prefers rebase, then merge, cherry-pick and revert", () => {
		expect(operationFromMarkers(new Set(["rebase-merge", "MERGE_HEAD"]))).toBe("rebase");
		expect(operationFromMarkers(new Set(["MERGE_HEAD"]))).toBe("merge");
		expect(operationFromMarkers(new Set(["CHERRY_PICK_HEAD"]))).toBe("cherry_pick");
		expect(operationFromMarkers(new Set(["REVERT_HEAD"]))).toBe("revert");
		expect(operationFromMarkers(new Set())).toBe("none");
	});
});

describe("parseLeftRightCount", () => {
	it("reads two counts", () => {
		expect(parseLeftRightCount("2\t5\n")).toEqual({ ok: true, value: { left: 2, right: 5 } });
	});
	it("returns an error value for other text", () => {
		const result = parseLeftRightCount("fatal: bad revision");
		expect(result.ok).toBe(false);
	});
});

describe("parseCommitLog", () => {
	it("keeps a subject that contains the separator", () => {
		const [commit] = parseCommitLog("abc|fix a|b bug|Ann|ann@x.io|1700000000\n");
		expect(commit).toEqual({
			hash: "abc",
			subject: "fix a|b bug",
			authorName: "Ann",
			authorEmail: "ann@x.io",
			authoredAt: 1700000000,
		});
	});
});

describe("parseWorktreeList", () => {
	it("reads branches and detached heads", () => {
		const text =
			"worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt/a\nHEAD def\ndetached\n";
		expect(parseWorktreeList(text)).toEqual([
			{ path: "/repo", branch: "main" },
			{ path: "/wt/a", branch: null },
		]);
	});
});
