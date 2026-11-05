import { describe, expect, it } from "vitest";
import type { GrepMatch, TreeEntry } from "./platform.ts";
import { COMMANDS, createTauriFileSearch, type TauriBindings } from "./tauri.ts";

interface Call {
	command: string;
	args?: Record<string, unknown>;
}

function bindings(handler: (command: string, args?: Record<string, unknown>) => unknown): {
	calls: Call[];
	bindings: TauriBindings;
} {
	const calls: Call[] = [];
	return {
		calls,
		bindings: {
			invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
				calls.push({ command, args });
				return handler(command, args) as T;
			},
			listen: async () => () => {},
		},
	};
}

describe("PLAT-06 Tauri file search", () => {
	it("lists the tree through search_list_tree", async () => {
		const entry: TreeEntry = { path: "/repo/src/a.ts", isDirectory: false };
		const { calls, bindings: fake } = bindings(() => [entry]);
		const search = createTauriFileSearch(fake);

		const result = await search.listTree("/repo");

		expect(result).toEqual({ ok: true, value: [entry] });
		expect(calls).toEqual([{ command: COMMANDS.searchListTree, args: { root: "/repo" } }]);
	});

	it("ranks files through search_fuzzy", async () => {
		const entry: TreeEntry = { path: "/repo/src/alpha.ts", isDirectory: false };
		const { calls, bindings: fake } = bindings(() => [entry]);
		const search = createTauriFileSearch(fake);

		const result = await search.fuzzyMatch("/repo", "alpha", 5);

		expect(result).toEqual({ ok: true, value: [entry] });
		expect(calls).toEqual([
			{
				command: COMMANDS.searchFuzzy,
				args: { root: "/repo", query: "alpha", limit: 5 },
			},
		]);
	});

	it("searches contents through search_grep", async () => {
		const match: GrepMatch = {
			path: "/repo/src/a.ts",
			line: 2,
			column: 7,
			preview: "const retry = 1;",
		};
		const { calls, bindings: fake } = bindings(() => [match]);
		const search = createTauriFileSearch(fake);
		const options = { caseSensitive: true, wholeWord: false, regex: false, limit: 20 };

		const result = await search.grep("/repo", "retry", options);

		expect(result).toEqual({ ok: true, value: [match] });
		expect(calls).toEqual([
			{
				command: COMMANDS.searchGrep,
				args: { root: "/repo", query: "retry", options },
			},
		]);
	});

	it("turns a Rust search error into an Err", async () => {
		const { bindings: fake } = bindings(() => {
			throw { code: "search_bad_root", message: "Not a folder: /missing" };
		});
		const search = createTauriFileSearch(fake);

		const result = await search.listTree("/missing");

		expect(result).toEqual({
			ok: false,
			error: { code: "search_bad_root", message: "Not a folder: /missing" },
		});
	});
});
