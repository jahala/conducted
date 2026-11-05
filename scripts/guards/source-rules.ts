/**
 * Guards over source text:
 *  - headers: every source file opens with a doc comment; a file with placeholders names its
 *    feature with `@feature`.
 *  - markers: no TODO or FIXME comments, no `todo!`/`unimplemented!` in Rust, and no `rm` in
 *    scripts (scripts move files to the Trash).
 */
import { type Problem, placeholdersIn, read, rel, walk } from "./lib.ts";

const SOURCE = /^(apps|packages)\/.+\/src\/.+\.(ts|tsx|rs)$|^(bin|scripts)\/.+\.(sh|ts)$/;
const EXEMPT = /\.test\.tsx?$|\.d\.ts$|(^|\/)index\.ts$|^scripts\/guards\/fixtures\//;

/** True when the first non-blank, non-shebang line starts a comment. */
export function hasHeader(text: string): boolean {
	const lines = text.split("\n").filter((line) => line.trim() !== "");
	const first = lines.find((line) => !line.startsWith("#!"));
	if (first === undefined) return false;
	return /^\s*(\/\*\*|\/\/!|#\s)/.test(first);
}

export function checkHeaders(root: string): Problem[] {
	const problems: Problem[] = [];
	for (const path of walk(root, root, SOURCE)) {
		const file = rel(root, path);
		if (EXEMPT.test(file)) continue;
		const text = read(path);
		if (!hasHeader(text)) {
			problems.push({ guard: "headers", message: `${file} has no header comment` });
		} else if (placeholdersIn(text).length > 0 && !text.includes("@feature")) {
			problems.push({
				guard: "headers",
				message: `${file} has placeholders but its header names no @feature`,
			});
		}
	}
	return problems;
}

const MARKERS: { pattern: RegExp; files: RegExp; message: string }[] = [
	{
		pattern: /\b(TODO|FIXME|XXX)\b/,
		files: /\.(ts|tsx|rs|sh)$/,
		message: "has a TODO-style comment; use a backlog id and notImplemented instead",
	},
	{
		pattern: /\b(todo|unimplemented)!\s*\(/,
		files: /\.rs$/,
		message: 'uses todo!/unimplemented!; use not_implemented!("ID")',
	},
	{
		pattern: /(^|[;&|]\s*|\s)rm\s+(-\w+\s+)*[^\s]/m,
		files: /\.sh$/,
		message: "deletes with rm; move files to the Trash instead",
	},
];

const MARKER_SCOPE = /^(apps|packages)\/.+\/src\/|^(bin|scripts)\//;

export function checkMarkers(root: string): Problem[] {
	const problems: Problem[] = [];
	for (const path of walk(root, root, MARKER_SCOPE)) {
		const file = rel(root, path);
		if (/^scripts\/guards\//.test(file)) continue;
		const text = read(path);
		for (const marker of MARKERS) {
			if (!marker.files.test(file)) continue;
			const lines = text.split("\n");
			const at = lines.findIndex((line) => marker.pattern.test(line));
			if (at !== -1)
				problems.push({ guard: "markers", message: `${file}:${at + 1} ${marker.message}` });
		}
	}
	return problems;
}
