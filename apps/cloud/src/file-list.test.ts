/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Tests the recursive listing a mirror is built from: folders and files, a symlink that is listed
 * but not followed, `.git` staying out, a vanished entry, and the cap that reports a truncated
 * tree instead of exhausting the Worker.
 */
import { describe, expect, it } from "vitest";
import { type ListedStat, type ListingFiles, walkFileTree } from "./file-list.ts";

/** A small in-memory sandbox folder tree. */
function fakeFiles(tree: Record<string, (string | { symlinkTo: string })[]>): ListingFiles {
	const stats = new Map<string, ListedStat>();
	const children = new Map<string, string[]>();
	for (const [folder, entries] of Object.entries(tree)) {
		const names: string[] = [];
		for (const entry of entries) {
			const name = typeof entry === "string" ? entry : entry.symlinkTo;
			names.push(name);
			const path = `${folder === "/" ? "" : folder}/${name}`;
			stats.set(path, {
				type: typeof entry === "string" ? "file" : "symlink",
				size: 3,
				modifiedAt: new Date(1_700_000_000_000),
			});
		}
		children.set(folder, names);
	}
	for (const folder of Object.keys(tree)) {
		stats.set(folder, {
			type: "directory",
			size: 0,
			modifiedAt: new Date(1_700_000_000_000),
		});
	}
	return {
		readDirectory: async (path) => {
			const names = children.get(path);
			if (names === undefined) throw new Error("not a folder");
			return names.map((name) => ({ name }));
		},
		stat: async (path) => {
			const known = stats.get(path);
			if (known !== undefined) return known;
			if (children.has(path)) {
				return { type: "directory", size: 0, modifiedAt: new Date(1_700_000_000_000) };
			}
			throw new Error("missing");
		},
	};
}

describe("CLOUD-11 the sandbox file listing", () => {
	it("lists nested files, skips .git and does not follow a symlink", async () => {
		const files = fakeFiles({
			"/workspace": ["src", ".git", "README.md", { symlinkTo: "escape" }],
			"/workspace/src": ["app.ts"],
		});
		const tree = await walkFileTree("/workspace", files);
		expect(tree.truncated).toBe(false);
		expect(tree.entries.map((entry) => entry.path)).toEqual([
			"/workspace/src",
			"/workspace/README.md",
			"/workspace/escape",
			"/workspace/src/app.ts",
		]);
		expect(tree.entries.find((entry) => entry.path === "/workspace/escape")?.isSymlink).toBe(true);
		expect(tree.entries.find((entry) => entry.path === "/workspace/src")?.isDirectory).toBe(true);
	});

	it("reports a tree cut at the cap", async () => {
		const files = fakeFiles({ "/workspace": ["a", "b", "c"] });
		const tree = await walkFileTree("/workspace", files, 2);
		expect(tree.truncated).toBe(true);
		expect(tree.entries).toHaveLength(2);
	});

	it("leaves out an entry that vanishes between listing and stat", async () => {
		const files = fakeFiles({ "/workspace": ["kept", "gone"] });
		const stat = files.stat;
		const listing: ListingFiles = {
			readDirectory: files.readDirectory,
			stat: async (path) => {
				if (path.endsWith("/gone")) throw new Error("vanished");
				return stat(path);
			},
		};
		const tree = await walkFileTree("/workspace", listing);
		expect(tree.entries.map((entry) => entry.path)).toEqual(["/workspace/kept"]);
	});
});
