import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../../../core/api.ts";
import { buildChangedTree, filterChangedFiles } from "./changed-file-tree.ts";

const file = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({
	path,
	status: "modified",
	linesAdded: 1,
	linesRemoved: 1,
	binary: false,
	conflicted: false,
	viewed: false,
	...over,
});

const paths = (nodes: ReturnType<typeof buildChangedTree>): string[] =>
	nodes.map((node) => (node.kind === "file" ? node.file.path : `folder:${node.path}`));

describe("REV-01 changed file tree", () => {
	it("groups files into one folder, folders before files at the root", () => {
		const nodes = buildChangedTree(
			[file("src/a/x.ts"), file("src/a/y.ts"), file("README.md")],
			"folders",
			new Set(),
		);
		expect(paths(nodes)).toEqual(["folder:src/a", "src/a/x.ts", "src/a/y.ts", "README.md"]);
		expect(nodes[0]).toMatchObject({ kind: "folder", depth: 0, linesAdded: 2, linesRemoved: 2 });
		expect(nodes[1]).toMatchObject({ kind: "file", depth: 1 });
		expect(nodes[3]).toMatchObject({ kind: "file", depth: 0 });
	});

	it("returns flat file rows at depth 0, conflicted first", () => {
		const nodes = buildChangedTree(
			[file("src/b.ts"), file("src/a.ts", { conflicted: true, linesAdded: 9 })],
			"flat",
			new Set(),
		);
		expect(paths(nodes)).toEqual(["src/a.ts", "src/b.ts"]);
		expect(nodes.every((node) => node.kind === "file" && node.depth === 0)).toBe(true);
	});

	it("hides the files and child folders of a collapsed folder", () => {
		const nodes = buildChangedTree(
			[file("src/a/x.ts", { linesAdded: 4, linesRemoved: 2 }), file("src/b/y.ts")],
			"folders",
			new Set(["src/a"]),
		);
		expect(paths(nodes)).toEqual(["folder:src/a", "folder:src/b", "src/b/y.ts"]);
		expect(nodes[0]).toMatchObject({ kind: "folder", linesAdded: 4, linesRemoved: 2 });
	});

	it("merges a chain of single-child folders into one row", () => {
		const nodes = buildChangedTree([file("src/features/diff/x.ts")], "folders", new Set());
		expect(paths(nodes)).toEqual(["folder:src/features/diff", "src/features/diff/x.ts"]);
	});

	it("sums the line counts of every file under a folder", () => {
		const nodes = buildChangedTree(
			[
				file("src/a/x.ts", { linesAdded: 3, linesRemoved: 1 }),
				file("src/a/deep/y.ts", { linesAdded: 2, linesRemoved: 4 }),
			],
			"folders",
			new Set(),
		);
		expect(nodes[0]).toMatchObject({ kind: "folder", linesAdded: 5, linesRemoved: 5 });
	});

	it("filters on the path and the old path of a renamed file, ignoring case", () => {
		const files = [file("src/a/x.ts"), file("src/b/y.ts", { oldPath: "Legacy/Y.ts" })];
		expect(filterChangedFiles(files, "SRC/A").map((entry) => entry.path)).toEqual(["src/a/x.ts"]);
		expect(filterChangedFiles(files, "legacy").map((entry) => entry.path)).toEqual(["src/b/y.ts"]);
		expect(filterChangedFiles(files, "  ").map((entry) => entry.path)).toEqual([
			"src/a/x.ts",
			"src/b/y.ts",
		]);
	});
});
