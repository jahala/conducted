/**
 * Shared helpers for the guards and the scripts beside them: walking the repo, reading files and
 * recognising a placeholder. Every guard is a pure function from a root folder to a list of
 * problems, so tests can run it on a sample folder.
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

/**
 * Every file under `dir` whose path from `root` matches, in name order. The disk's own order differs
 * between macOS and Linux, so sorting keeps every guard's output the same on both.
 */
export function* walk(root: string, dir: string, match: RegExp): Generator<string> {
	if (!existsSync(dir)) return;
	for (const name of readdirSync(dir).sort()) {
		if (SKIP_DIRS.has(name)) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) yield* walk(root, path, match);
		else if (match.test(relative(root, path))) yield path;
	}
}

export const read = (path: string): string => readFileSync(path, "utf8");
export const rel = (root: string, path: string): string => relative(root, path);

/** The folders and file kinds that hold the product's code: where placeholders and headers live. */
const CODE_FOLDERS = ["apps", "packages", "bin"] as const;
const CODE_FILE = /\.(ts|tsx|rs|sh)$/;

/**
 * Every code file under the code folders, as [path from the root, text]. One home for the scope, so
 * the stub check, the node gate and the issue sync read the same files.
 */
export function readCodeFiles(root: string): [string, string][] {
	const files: [string, string][] = [];
	for (const top of CODE_FOLDERS) {
		for (const path of walk(root, join(root, top), CODE_FILE)) {
			files.push([relative(root, path), readFileSync(path, "utf8")]);
		}
	}
	return files;
}

/** A test file: it may mention a placeholder (to assert it throws) without being one. */
export const TEST_FILE = /\.test\.tsx?$/;
export const isTestFile = (path: string): boolean => TEST_FILE.test(path);

/** The id shape of a backlog feature, for example `CHAT-03`. */
export const FEATURE_ID = "[A-Z]+-\\d{2}";

/**
 * Matches `notImplemented("ID")`, `not_implemented!("ID")` and `not_implemented "ID"`. The id is
 * capture group 1. One home for the rule, so the stub check, the node gate and the header guard
 * agree on what a placeholder is.
 */
export const placeholderPattern = (id: string = FEATURE_ID): RegExp =>
	new RegExp(`not_?[iI]mplemented!?\\s*\\(?\\s*"(${id})"`, "g");

/** Every feature id that has a placeholder in this source text, once per placeholder. */
export const placeholdersIn = (text: string): string[] =>
	[...text.matchAll(placeholderPattern())].map((match) => match[1] ?? "");
