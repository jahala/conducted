/**
 * Where the reference tools find the other app's bundle and the mapping drawn from it, and where the
 * screenshot run writes. All of it sits in the main checkout's git-ignored `.context/` folder, found
 * through git, so the tools work the same from the main checkout and from any worktree of it.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

/** The main checkout: the folder that holds the repository's shared `.git`. */
export function mainCheckout(cwd: string = import.meta.dir): string {
	const found = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
		cwd,
		encoding: "utf8",
	});
	if (found.status !== 0) throw new Error(`git found no repository at ${cwd}: ${found.stderr}`);
	return dirname(found.stdout.trim());
}

export interface ReferencePaths {
	/** The bundle: `index.html` and `assets/`. */
	bundle: string;
	/** The folder for what is drawn from the bundle: the call inventory and the mapping. */
	reference: string;
	mapping: string;
	inventory: string;
	/** Where the screenshot run writes its pictures and its log. */
	shots: string;
}

export function defaultPaths(main: string = mainCheckout()): ReferencePaths {
	const reference = join(main, ".context/day/conductor-ref");
	return {
		bundle: join(main, ".context/day/conductor-assets"),
		reference,
		mapping: join(reference, "mapping.ts"),
		inventory: join(reference, "call-inventory.json"),
		shots: join(main, ".context/shots/conductor-run"),
	};
}
