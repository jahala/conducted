import { describe, expect, test } from "bun:test";
import { capSummary, MAX_SUMMARY_FILES, parseDiffSummary } from "./diff-summary.ts";

describe("SIDE-08 checkpoint diff summary", () => {
	test("a rename with added lines keeps the old path and the counts", () => {
		const nameStatus = "R090\0old name.ts\0new name.ts\0M\0a.ts\0";
		const numstat = "3\t1\t\0old name.ts\0new name.ts\0" + "5\t0\ta.ts\0";
		expect(parseDiffSummary(nameStatus, numstat)).toEqual([
			{
				path: "new name.ts",
				oldPath: "old name.ts",
				status: "renamed",
				linesAdded: 3,
				linesRemoved: 1,
				binary: false,
			},
			{ path: "a.ts", status: "modified", linesAdded: 5, linesRemoved: 0, binary: false },
		]);
	});

	test("a copy keeps the old path too", () => {
		const out = parseDiffSummary("C075\0source.ts\0copy.ts\0", "2\t0\t\0source.ts\0copy.ts\0");
		expect(out).toEqual([
			{
				path: "copy.ts",
				oldPath: "source.ts",
				status: "copied",
				linesAdded: 2,
				linesRemoved: 0,
				binary: false,
			},
		]);
	});

	test("a binary file has zero lines and the binary flag", () => {
		const out = parseDiffSummary("A\0logo.png\0", "-\t-\tlogo.png\0");
		expect(out).toEqual([
			{ path: "logo.png", status: "added", linesAdded: 0, linesRemoved: 0, binary: true },
		]);
	});

	test("a deleted file keeps its status", () => {
		const out = parseDiffSummary("D\0gone.ts\0", "0\t9\tgone.ts\0");
		expect(out).toEqual([
			{ path: "gone.ts", status: "deleted", linesAdded: 0, linesRemoved: 9, binary: false },
		]);
	});

	test("a type change is reported as modified", () => {
		const out = parseDiffSummary("T\0link\0", "");
		expect(out).toEqual([
			{ path: "link", status: "modified", linesAdded: 0, linesRemoved: 0, binary: false },
		]);
	});

	test("a path that only numstat knows is kept as modified", () => {
		expect(parseDiffSummary("", "1\t2\tonly.ts\0")).toEqual([
			{ path: "only.ts", status: "modified", linesAdded: 1, linesRemoved: 2, binary: false },
		]);
	});

	test("a name-status path missing from numstat keeps zero counts", () => {
		expect(parseDiffSummary("M\0a.ts\0", "")).toEqual([
			{ path: "a.ts", status: "modified", linesAdded: 0, linesRemoved: 0, binary: false },
		]);
	});

	test("paths with spaces, tabs and newlines survive the NUL-separated form", () => {
		const path = "odd name\twith\nlines.ts";
		const out = parseDiffSummary(`A\0${path}\0`, `7\t0\t${path}\0`);
		expect(out).toEqual([{ path, status: "added", linesAdded: 7, linesRemoved: 0, binary: false }]);
	});

	test("more than 200 files are omitted, exactly 200 are kept", () => {
		const make = (n: number) =>
			Array.from({ length: n }, (_, i) => ({
				path: `f${i}`,
				status: "added" as const,
				linesAdded: 0,
				linesRemoved: 0,
				binary: false,
			}));
		expect(capSummary(make(MAX_SUMMARY_FILES))).toHaveLength(MAX_SUMMARY_FILES);
		expect(capSummary(make(MAX_SUMMARY_FILES + 1))).toBeUndefined();
	});

	test("SIDE-08 an unknown status letter keeps its path and does not shift the next entry", () => {
		const out = parseDiffSummary("X\0Makefile\0M\0a.ts\0", "");
		expect(out.map((change) => [change.path, change.status])).toEqual([
			["Makefile", "modified"],
			["a.ts", "modified"],
		]);
	});
});
