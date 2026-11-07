/**
 * Guard: a file header claims only what a script can check.
 * Three rules, all read from the header comment at the top of a source file:
 *  - every `@feature` id is a row in docs/plans/backlog.md;
 *  - every code name in `Owns:` or `Exports:` appears in the file itself;
 *  - every `Test first:` line shares a phrase with a test title, so the test it names exists.
 * Findings are counted per file against scripts/guards/header-claims-baseline.json. A file may
 * not rise above its count, and the baseline may not sit above the real count, so every fix lowers
 * it (D055).
 *
 * Usage:
 *   bun scripts/guards/header-claims.ts --write-baseline   rewrite the baseline from today's findings
 *   bun scripts/guards/header-claims.ts --list             print every finding with its file
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Problem, read, rel, walk } from "./lib.ts";

export type HeaderRule = "feature-row" | "owned-name" | "test-first";

export const HEADER_RULES: HeaderRule[] = ["feature-row", "owned-name", "test-first"];

export const BASELINE_PATH = "scripts/guards/header-claims-baseline.json";

export interface HeaderFinding {
	rule: HeaderRule;
	file: string;
	message: string;
}

/** Findings per rule, per file. */
export type HeaderBaseline = Record<HeaderRule, Record<string, number>>;

/** The guard's scope: the same folders as the header and placeholder guards. */
const SOURCE = /^(apps|packages)\/.+\/src\/.+\.(ts|tsx|rs)$|^(bin|scripts)\/.+\.(sh|ts)$/;
const TEST = /\.test\.tsx?$/;
const DECLARATION = /\.d\.ts$/;

/** A label that starts the next field of a header, such as `Behaviour:` or `Must handle:`. */
const NEXT_FIELD = /^[A-Z][A-Za-z ]{1,30}:/;
/** The first token of an `@feature` line that is meant to be a backlog id. */
const FEATURE_LOOKS_LIKE_ID = /^[A-Z][A-Z0-9]*-\d+$/;
/** A backticked or called name that is code, not prose, a path or another module's property. */
const CODE_NAME = /^[A-Za-z_$][\w$]*(?:\(\))?$/;

export function headerOf(text: string, extension: string): string[] | null {
	const lines = text.split("\n");
	if (extension === "rs") {
		if (!lines[0]?.startsWith("//!")) return null;
		const header: string[] = [];
		for (const line of lines) {
			if (!line.startsWith("//!")) break;
			header.push(line.replace(/^\/\/!\s?/, ""));
		}
		return header;
	}
	if (extension === "sh") {
		const header: string[] = [];
		let index = 0;
		if (lines[0]?.startsWith("#!")) index++;
		while (index < lines.length && lines[index]?.trim() === "") index++;
		for (; index < lines.length; index++) {
			const line = lines[index] ?? "";
			if (!line.startsWith("#")) break;
			header.push(line.replace(/^#\s?/, ""));
		}
		return header.length > 0 ? header : null;
	}
	if (!lines[0]?.startsWith("/*")) return null;
	const header: string[] = [];
	for (const line of lines) {
		header.push(
			line
				.replace(/^\/\*\*?\s?/, "")
				.replace(/\s*\*\/\s*$/, "")
				.replace(/^\s*\*\s?/, ""),
		);
		if (line.includes("*/")) break;
	}
	return header;
}

/** The text after a field label, up to the next field or a blank line. */
export function fieldText(lines: string[], names: string[]): string | null {
	const start = lines.findIndex((line) => names.some((name) => line.startsWith(`${name}:`)));
	if (start === -1) return null;
	const first = lines[start] ?? "";
	const label = first.slice(0, first.indexOf(":") + 1);
	const body = [first.slice(label.length)];
	for (let index = start + 1; index < lines.length; index++) {
		const line = lines[index] ?? "";
		if (line.trim() === "" || NEXT_FIELD.test(line) || line.startsWith("@feature")) break;
		body.push(line);
	}
	return body.join(" ").trim();
}

function words(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[`"'“”‘’]/g, " ")
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/([a-z])([0-9])/g, "$1 $2")
		.replace(/([0-9])([a-z])/g, "$1 $2")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter((word) => word !== "");
}

/** The longest run of words that appears in both lists. */
export function sharedRun(a: string[], b: string[]): number {
	let best = 0;
	let previous = new Uint16Array(b.length + 1);
	for (let i = 1; i <= a.length; i++) {
		const current = new Uint16Array(b.length + 1);
		for (let j = 1; j <= b.length; j++) {
			if (a[i - 1] === b[j - 1]) {
				current[j] = (previous[j - 1] ?? 0) + 1;
				best = Math.max(best, current[j] ?? 0);
			}
		}
		previous = current;
	}
	return best;
}

const STOP_WORDS = new Set(
	"the a an and or of to in on for with is are it its this that as at by from be not no one two three then when after before while without into their there these those has have had was were will would can could should each every all any some same only more than but also first second test".split(
		" ",
	),
);

/** True when the line names a test whose title echoes it. */
export function namesATest(line: string, titles: string[][]): boolean {
	const tokens = words(line);
	if (tokens.length === 0) return false;
	const significant = [
		...new Set(tokens.filter((word) => word.length > 1 && !STOP_WORDS.has(word))),
	];
	for (const title of titles) {
		if (sharedRun(tokens, title) >= 3) return true;
		if (significant.length < 2) continue;
		const set = new Set(title);
		const shared = significant.filter((word) => set.has(word)).length;
		if (shared / significant.length >= 0.6) return true;
	}
	return false;
}

/** Every test title in the repo, as word lists. TS tests and Rust test functions both count. */
function testTitles(root: string): string[][] {
	const titles: string[][] = [];
	for (const path of walk(root, root, /\.(ts|tsx|rs)$/)) {
		const file = rel(root, path);
		if (!(TEST.test(file) || file.endsWith(".rs"))) continue;
		const text = read(path);
		if (file.endsWith(".rs")) {
			for (const match of text.matchAll(/#\[(?:tokio::)?test\]\s*(?:async\s*)?fn\s+(\w+)/g)) {
				titles.push(words(match[1]?.replace(/_/g, " ") ?? ""));
			}
			continue;
		}
		for (const match of text.matchAll(
			/\b(?:it|test|describe)(?:\.\w+)?\(\s*["'`]([^"'`]+)["'`]/g,
		)) {
			titles.push(words(match[1] ?? ""));
		}
		for (const match of text.matchAll(
			/\b(?:it|test|describe)\.each\([^)]*\)\s*\(\s*["'`]([^"'`]+)["'`]/g,
		)) {
			titles.push(words(match[1] ?? ""));
		}
	}
	return titles;
}

function backlogIds(root: string): Set<string> {
	const path = join(root, "docs/plans/backlog.md");
	const ids = new Set<string>();
	if (!existsSync(path)) return ids;
	for (const line of read(path).split("\n")) {
		const match = line.match(/^\|\s*([A-Z][A-Z0-9]*-\d+)\s*\|/);
		if (match?.[1]) ids.add(match[1]);
	}
	return ids;
}

/** The code names a header says the file owns or exports. */
function ownedNames(lines: string[]): string[] {
	const text = fieldText(lines, ["Owns", "Exports"]);
	if (text === null) return [];
	const names = new Set<string>();
	for (const match of text.matchAll(/`([^`]+)`/g)) {
		const name = (match[1] ?? "").trim();
		if (CODE_NAME.test(name)) names.add(name.replace(/\(\)$/, ""));
	}
	for (const match of text.matchAll(
		/\b([a-z][A-Za-z0-9_]*\(\)|[A-Z][a-z]+(?:[A-Z][A-Za-z0-9]*)+\(\))/g,
	)) {
		names.add((match[1] ?? "").replace(/\(\)$/, ""));
	}
	return [...names];
}

/** The guard without its baseline: every finding on this tree. */
export function findHeaderClaims(root: string): HeaderFinding[] {
	const ids = backlogIds(root);
	const titles = testTitles(root);
	const findings: HeaderFinding[] = [];
	for (const path of walk(root, root, SOURCE)) {
		const file = rel(root, path);
		if (DECLARATION.test(file)) continue;
		const extension = file.split(".").at(-1) ?? "";
		const text = read(path);
		const lines = headerOf(text, extension);
		if (lines === null) continue;
		const headerLength = text.split("\n").findIndex((line) => line.includes("*/"));
		const body =
			extension === "rs" || extension === "sh"
				? afterRustOrShellHeader(text, extension)
				: text
						.split("\n")
						.slice(headerLength + 1)
						.join("\n");

		for (const line of lines) {
			const match = line.match(/@feature\s+(\S+)/);
			const id = match?.[1];
			if (id && FEATURE_LOOKS_LIKE_ID.test(id) && !ids.has(id)) {
				findings.push({
					rule: "feature-row",
					file,
					message: `@feature ${id} is not a backlog row`,
				});
			}
		}

		for (const name of ownedNames(lines)) {
			if (!body.includes(name)) {
				findings.push({
					rule: "owned-name",
					file,
					message: `Owns names ${name}, which is not in the file`,
				});
			}
		}

		const testFirst = fieldText(lines, ["Test first"]);
		if (testFirst !== null && !/^(not applicable|none)\b/i.test(testFirst)) {
			if (!namesATest(testFirst, titles)) {
				findings.push({
					rule: "test-first",
					file,
					message: `Test first names no test: ${testFirst.slice(0, 90)}`,
				});
			}
		}
	}
	return findings;
}

function afterRustOrShellHeader(text: string, extension: string): string {
	const lines = text.split("\n");
	let index = 0;
	if (extension === "sh") {
		if (lines[0]?.startsWith("#!")) index++;
		while (index < lines.length && (lines[index] ?? "").trim() === "") index++;
	}
	while (
		index < lines.length &&
		(lines[index] ?? "").startsWith(extension === "rs" ? "//!" : "#")
	) {
		index++;
	}
	return lines.slice(index).join("\n");
}

/** Counts findings per rule and file, in a fixed order so the baseline file never churns. */
export function countHeaderClaims(found: HeaderFinding[]): HeaderBaseline {
	const baseline: HeaderBaseline = { "feature-row": {}, "owned-name": {}, "test-first": {} };
	for (const finding of found) {
		const files = baseline[finding.rule];
		files[finding.file] = (files[finding.file] ?? 0) + 1;
	}
	for (const rule of HEADER_RULES) {
		baseline[rule] = Object.fromEntries(
			Object.entries(baseline[rule]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
		);
	}
	return baseline;
}

export const renderBaseline = (baseline: HeaderBaseline): string =>
	`${JSON.stringify(baseline, null, "\t")}\n`;

const REGENERATE = "run `bun scripts/guards/header-claims.ts --write-baseline` to lower it";
const SITE_LIMIT = 8;

/** Compares findings with the baseline: a file may not rise, and may not sit above it. */
export function compareHeaderClaims(found: HeaderFinding[], baseline: HeaderBaseline): Problem[] {
	const problems: Problem[] = [];
	for (const rule of HEADER_RULES) {
		const sites = new Map<string, HeaderFinding[]>();
		for (const finding of found.filter((item) => item.rule === rule)) {
			sites.set(finding.file, [...(sites.get(finding.file) ?? []), finding]);
		}
		const files = [...new Set([...sites.keys(), ...Object.keys(baseline[rule])])].sort();
		for (const file of files) {
			const real = sites.get(file) ?? [];
			const allowed = baseline[rule][file] ?? 0;
			if (real.length > allowed) {
				const shown = real
					.slice(0, SITE_LIMIT)
					.map((item) => item.message)
					.join("; ");
				const more = real.length > SITE_LIMIT ? `; and ${real.length - SITE_LIMIT} more` : "";
				problems.push({
					guard: "header-claims",
					message: `${file} has ${real.length} ${rule} findings, the baseline allows ${allowed}: ${shown}${more}`,
				});
			} else if (real.length < allowed) {
				problems.push({
					guard: "header-claims",
					message: `${file} has ${real.length} ${rule} findings but the baseline says ${allowed}; ${REGENERATE}`,
				});
			}
		}
	}
	return problems;
}

export function checkHeaderClaims(root: string): Problem[] {
	const path = join(root, BASELINE_PATH);
	if (!existsSync(path)) return compareHeaderClaims(findHeaderClaims(root), countHeaderClaims([]));
	try {
		const baseline = JSON.parse(read(path)) as Partial<HeaderBaseline>;
		return compareHeaderClaims(findHeaderClaims(root), {
			"feature-row": baseline["feature-row"] ?? {},
			"owned-name": baseline["owned-name"] ?? {},
			"test-first": baseline["test-first"] ?? {},
		});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return [{ guard: "header-claims", message: `${BASELINE_PATH} cannot be read: ${reason}` }];
	}
}

/** Writes the baseline from today's findings. It refuses to raise a file's count (D055). */
export function writeBaseline(root: string): string[] {
	const next = countHeaderClaims(findHeaderClaims(root));
	const path = join(root, BASELINE_PATH);
	const current = existsSync(path) ? (JSON.parse(read(path)) as Partial<HeaderBaseline>) : null;
	const raised: string[] = [];
	if (current !== null) {
		for (const rule of HEADER_RULES) {
			for (const [file, count] of Object.entries(next[rule])) {
				const before = current[rule]?.[file] ?? 0;
				if (count > before) raised.push(`${rule}: ${file} ${before} -> ${count}`);
			}
		}
	}
	if (raised.length > 0) return raised;
	mkdirSync(join(root, "scripts/guards"), { recursive: true });
	writeFileSync(path, renderBaseline(next));
	return [];
}

if (import.meta.main) {
	const root = join(import.meta.dir, "../..");
	const args = process.argv.slice(2);
	if (args.includes("--write-baseline")) {
		const raised = writeBaseline(root);
		if (raised.length > 0) {
			console.error(
				`A baseline may only shrink (D055). These counts would rise:\n  ${raised.join("\n  ")}`,
			);
			process.exit(1);
		}
		console.log(`wrote ${BASELINE_PATH}`);
	} else if (args.includes("--list")) {
		for (const finding of findHeaderClaims(root)) {
			console.log(`${finding.rule}\t${finding.file}\t${finding.message}`);
		}
	} else {
		console.log("usage: bun scripts/guards/header-claims.ts --write-baseline | --list");
		process.exit(2);
	}
}
