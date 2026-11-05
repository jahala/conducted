/**
 * Guards 7 to 10 of the test quality plan: the shapes a test must not take. Four guards read every
 * test file (Vitest and bun test files in TypeScript, `#[test]` functions in Rust) and list tests
 * that cannot fail, tests that mock the thing they test, stand-ins defined outside their home, and
 * tests that depend on real time or leak state.
 *
 * Each guard compares its findings per file with a committed baseline
 * (`scripts/guards/test-shapes-baseline.json`). It fails when a file's count rises, and also when
 * the baseline is higher than the real count, so every fix lowers the baseline (D055).
 *
 * Usage:
 *   bun scripts/guards/test-shapes.ts --write-baseline   rewrite the baseline from today's findings
 *   bun scripts/guards/test-shapes.ts --list [guard]     print every finding with its file and line
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { API } from "typescript/unstable/async";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { type Problem, read, rel as relativePath, walk } from "./lib.ts";
import { analyseRust } from "./test-shapes-rust.ts";
import { analyseTypeScript, type FileFacts, importsOf, STAND_IN_HOMES } from "./test-shapes-ts.ts";

export type GuardName =
	| "tests-cannot-fail"
	| "mocking-the-thing"
	| "stand-in-home"
	| "time-and-leaks";

export const GUARD_NAMES: GuardName[] = [
	"tests-cannot-fail",
	"mocking-the-thing",
	"stand-in-home",
	"time-and-leaks",
];

export interface Violation {
	guard: GuardName;
	/** Which rule inside the guard fired. */
	check: string;
	/** Path from the repository root. */
	file: string;
	line: number;
	message: string;
}

/** Findings per file, per guard. */
export type Baseline = Record<GuardName, Record<string, number>>;

export const BASELINE_PATH = "scripts/guards/test-shapes-baseline.json";

const TS_TEST = /^(apps|packages|scripts)\/.+\.test\.tsx?$/;
const RUST_FILE = /^apps\/desktop\/src-tauri\/.+\.rs$/;
const HOME_FILE = new RegExp(
	`^(${STAND_IN_HOMES.map((home) => home.replace(/\//g, "\\/")).join("|")}).+\\.tsx?$`,
);
const VIRTUAL_ROOT = "/shapes";

/** Reads every test file under `root` and returns all findings, sorted by file and line. */
export async function scanTestShapes(root: string): Promise<Violation[]> {
	const tsFiles = new Set<string>();
	for (const path of walk(root, root, TS_TEST)) tsFiles.add(relativePath(root, path));
	for (const path of walk(root, root, HOME_FILE)) tsFiles.add(relativePath(root, path));
	const found: Violation[] = [];

	if (tsFiles.size > 0) {
		const names = [...tsFiles].sort();
		const files: Record<string, string> = {};
		for (const name of names) files[`${VIRTUAL_ROOT}/${name}`] = read(join(root, name));
		files[`${VIRTUAL_ROOT}/tsconfig.json`] = JSON.stringify({
			compilerOptions: { jsx: "preserve", noLib: true, noResolve: true, types: [] },
			files: names,
		});
		const api = new API({ cwd: VIRTUAL_ROOT, fs: createVirtualFileSystem(files) });
		try {
			const snapshot = await api.updateSnapshot({
				openProject: `${VIRTUAL_ROOT}/tsconfig.json`,
			});
			const project = snapshot.getProjects()[0];
			if (project === undefined) throw new Error("the TypeScript server opened no project");
			const exists = (name: string): boolean => existsSync(join(root, name));
			for (const name of names) {
				const sf = await project.program.getSourceFile(`${VIRTUAL_ROOT}/${name}`);
				if (sf === undefined) throw new Error(`the TypeScript server could not parse ${name}`);
				const facts: FileFacts = {
					rel: name,
					sf,
					lines: sf.text.split("\n"),
					isTest: TS_TEST.test(name),
					inHome: HOME_FILE.test(name),
					imports: importsOf(sf),
					subject: (name.split("/").at(-1) ?? "").split(".")[0] ?? "",
				};
				found.push(...analyseTypeScript(facts, exists));
			}
		} finally {
			await api.close();
		}
	}

	for (const path of walk(root, root, RUST_FILE)) {
		found.push(...analyseRust(relativePath(root, path), read(path)));
	}
	return found.sort(
		(a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.message.localeCompare(b.message),
	);
}

/** Counts findings per guard and file, in a fixed order so the baseline file never churns. */
export function countFindings(found: Violation[]): Baseline {
	const baseline: Baseline = {
		"tests-cannot-fail": {},
		"mocking-the-thing": {},
		"stand-in-home": {},
		"time-and-leaks": {},
	};
	for (const item of found) {
		const files = baseline[item.guard];
		files[item.file] = (files[item.file] ?? 0) + 1;
	}
	for (const guard of GUARD_NAMES) {
		baseline[guard] = Object.fromEntries(
			Object.entries(baseline[guard]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
		);
	}
	return baseline;
}

export const renderBaseline = (baseline: Baseline): string =>
	`${JSON.stringify(baseline, null, "\t")}\n`;

type BaselineRead = { baseline: Baseline } | { problem: Problem };

function readBaseline(root: string, guard: GuardName): BaselineRead {
	const path = join(root, BASELINE_PATH);
	const empty = countFindings([]);
	if (!existsSync(path)) return { baseline: empty };
	try {
		const parsed = JSON.parse(read(path)) as Partial<Baseline>;
		return { baseline: { ...empty, ...parsed } };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		return { problem: { guard, message: `${BASELINE_PATH} cannot be read: ${reason}` } };
	}
}

const REGENERATE = "run `bun scripts/guards/test-shapes.ts --write-baseline` to lower it";
const SITE_LIMIT = 8;

/** Compares one guard's findings with its baseline: a file may not rise, and may not sit above. */
export function compareWithBaseline(
	guard: GuardName,
	found: Violation[],
	baseline: Record<string, number>,
): Problem[] {
	const sites = new Map<string, Violation[]>();
	for (const item of found.filter((entry) => entry.guard === guard)) {
		sites.set(item.file, [...(sites.get(item.file) ?? []), item]);
	}
	const problems: Problem[] = [];
	const files = [...new Set([...sites.keys(), ...Object.keys(baseline)])].sort();
	for (const file of files) {
		const real = sites.get(file) ?? [];
		const allowed = baseline[file] ?? 0;
		if (real.length > allowed) {
			const shown = real
				.slice(0, SITE_LIMIT)
				.map((item) => `${file}:${item.line} ${item.message}`)
				.join("; ");
			const more = real.length > SITE_LIMIT ? `; and ${real.length - SITE_LIMIT} more` : "";
			problems.push({
				guard,
				message: `${file} has ${real.length} ${guard} findings, the baseline allows ${allowed}: ${shown}${more}`,
			});
		} else if (real.length < allowed) {
			problems.push({
				guard,
				message: `${file} has ${real.length} ${guard} findings but the baseline says ${allowed}; ${REGENERATE}`,
			});
		}
	}
	return problems;
}

async function checkGuard(root: string, guard: GuardName): Promise<Problem[]> {
	const loaded = readBaseline(root, guard);
	if ("problem" in loaded) return [loaded.problem];
	return compareWithBaseline(guard, await scanTestShapes(root), loaded.baseline[guard]);
}

/** Guard 7: tests that cannot fail. */
export const checkTestsCannotFail = (root: string): Promise<Problem[]> =>
	checkGuard(root, "tests-cannot-fail");

/** Guard 8: tests that mock the thing they test. */
export const checkMockingTheThing = (root: string): Promise<Problem[]> =>
	checkGuard(root, "mocking-the-thing");

/** Guard 9: stand-ins defined outside their home, and homes without a contract test. */
export const checkStandInHome = (root: string): Promise<Problem[]> =>
	checkGuard(root, "stand-in-home");

/** Guard 10: real time and leaked state in tests. */
export const checkTimeAndLeaks = (root: string): Promise<Problem[]> =>
	checkGuard(root, "time-and-leaks");

/** Rewrites the baseline from today's findings. Output is sorted, so the same tree gives the same bytes. */
/**
 * The counts that a regeneration would raise. A first baseline may hold any counts; once one
 * exists it may only shrink (D055), so a rise is refused and named.
 */
export function risesOver(current: Baseline | null, next: Baseline): string[] {
	if (current === null) return [];
	const raised: string[] = [];
	for (const guard of GUARD_NAMES) {
		for (const [file, count] of Object.entries(next[guard])) {
			const before = current[guard]?.[file] ?? 0;
			if (count > before) raised.push(`${guard}: ${file} ${before} -> ${count}`);
		}
	}
	return raised;
}

export async function writeBaseline(root: string): Promise<string[]> {
	const found = await scanTestShapes(root);
	const next = countFindings(found);
	const path = join(root, BASELINE_PATH);
	const current = existsSync(path) ? (JSON.parse(read(path)) as Baseline) : null;
	const raised = risesOver(current, next);
	if (raised.length > 0) return raised;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, renderBaseline(next));
	return [];
}

if (import.meta.main) {
	const root = join(import.meta.dir, "../..");
	const args = process.argv.slice(2);
	if (args.includes("--write-baseline")) {
		const raised = await writeBaseline(root);
		if (raised.length > 0) {
			console.error(
				`A baseline may only shrink (D055). These counts would rise:\n  ${raised.join("\n  ")}`,
			);
			process.exit(1);
		}
		console.log(`wrote ${BASELINE_PATH}`);
	} else if (args.includes("--list")) {
		const only = args.find((arg) => (GUARD_NAMES as string[]).includes(arg));
		for (const item of (await scanTestShapes(root)).filter(
			(entry) => only === undefined || entry.guard === only,
		)) {
			console.log(`${item.guard}\t${item.check}\t${item.file}:${item.line}\t${item.message}`);
		}
	} else {
		console.log("usage: bun scripts/guards/test-shapes.ts --write-baseline | --list [guard]");
		process.exit(2);
	}
}
