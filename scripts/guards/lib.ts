/**
 * Shared helpers for the guards: walking the repo and reading files. Every guard is a pure
 * function from a root folder to a list of problems, so tests can run it on a sample folder.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const SKIP_DIRS = new Set([
	"node_modules",
	"dist",
	"target",
	"gen",
	".vite",
	".git",
	".context",
	"icons",
]);

export interface Problem {
	guard: string;
	message: string;
}

export function* walk(root: string, dir: string, match: RegExp): Generator<string> {
	if (!existsSync(dir)) return;
	for (const name of readdirSync(dir)) {
		if (SKIP_DIRS.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* walk(root, path, match);
		else if (match.test(relative(root, path))) yield path;
	}
}

export const read = (path: string): string => readFileSync(path, "utf8");
export const rel = (root: string, path: string): string => relative(root, path);
