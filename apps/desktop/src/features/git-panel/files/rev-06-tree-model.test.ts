import { describe, expect, it } from "vitest";
import type { FileTreeEntry } from "./file-tree-model.ts";
import { buildFileTreeRows } from "./file-tree-model.ts";

const file = (path: string): FileTreeEntry => ({ path, isDirectory: false });
const paths = (rows: ReturnType<typeof buildFileTreeRows>): string[] => rows.map((row) => row.path);

describe("REV-06 file tree model", () => {
	it("shows a collapsed folder as one row and expands its children when asked", () => {
		const entries = [file("a/b.ts"), file("a/c.ts"), file("d.ts")];
		const collapsed = buildFileTreeRows(entries, new Set(), "");
		expect(paths(collapsed)).toEqual(["a", "d.ts"]);
		expect(collapsed[0]).toMatchObject({ isDirectory: true, expanded: false, depth: 0 });

		const expanded = buildFileTreeRows(entries, new Set(["a"]), "");
		expect(expanded).toEqual([
			{ path: "a", name: "a", depth: 0, isDirectory: true, expanded: true },
			{ path: "a/b.ts", name: "b.ts", depth: 1, isDirectory: false, expanded: false },
			{ path: "a/c.ts", name: "c.ts", depth: 1, isDirectory: false, expanded: false },
			{ path: "d.ts", name: "d.ts", depth: 0, isDirectory: false, expanded: false },
		]);
	});

	it("keeps only matching files and their parents visible while filtering", () => {
		const entries = [file("src/a.ts"), file("README.md")];
		expect(paths(buildFileTreeRows(entries, new Set(), "read"))).toEqual(["README.md"]);
		expect(paths(buildFileTreeRows(entries, new Set(), "a.ts"))).toEqual(["src", "src/a.ts"]);
		expect(paths(buildFileTreeRows(entries, new Set(), "SRC/A"))).toEqual(["src", "src/a.ts"]);
	});

	it("puts folders before files at each level, both alphabetically", () => {
		const entries = [file("z.ts"), file("a/x.ts"), file("b.ts")];
		expect(paths(buildFileTreeRows(entries, new Set(), ""))).toEqual(["a", "b.ts", "z.ts"]);
	});

	it("builds rows for a very large tree without dropping entries", () => {
		const entries: FileTreeEntry[] = [];
		for (let index = 0; index < 100_000; index++) {
			entries.push(file(`folder/file-${index}.ts`));
		}
		const collapsed = buildFileTreeRows(entries, new Set(), "");
		expect(collapsed).toHaveLength(1);
		const expanded = buildFileTreeRows(entries, new Set(["folder"]), "");
		expect(expanded).toHaveLength(100_001);
		expect(expanded[1]).toMatchObject({ path: "folder/file-0.ts", depth: 1 });
	});
});
