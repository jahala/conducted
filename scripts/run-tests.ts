/**
 * Runs the tests: every test (`--all`, what `pnpm test` and the main line run), or only the tests
 * the changes since the main line can reach (the default, what `pnpm test:changed` and every pull
 * request run).
 *
 * How a changed-only run picks its tests:
 *  1. The changed files: everything that differs from the merge base with `--since` (default
 *     origin/main), plus staged, unstaged and untracked files.
 *  2. A change to anything on scripts/test-rules.ts's RUN_EVERYTHING list runs every test.
 *  3. Files that read a changed file by name are added to the changed files: a source file that
 *     names a changed file's base name (its folder and base name for a module), and the tests a
 *     READ_WHOLE folder rule names.
 *  4. Each runner's own import graph picks the tests those files can reach: Vitest's, through
 *     scripts/vitest-affected.ts; Bun's resolver for the bun-tested folders. `bun test --changed`
 *     is not used because it does not follow an import of a workspace package by name, so a
 *     change to packages/shared would select none of the sidecar's tests.
 *  5. When code changed and no test reaches it, the selection cannot be trusted: every test runs.
 *  6. The ALWAYS tests are added.
 *
 * Every test runs the packages side by side through `pnpm -r`; a selection runs its runners one
 * after another, each through its package's own `test` script. scripts/ always runs last, because
 * its boundaries test writes probe files into the packages' folders. When
 * CONDUCTED_TEST_REPORTS names a folder, the runners that will run are listed in its runners.txt
 * before any starts, so scripts/test-report.ts can tell a runner that crashed from one never asked.
 *
 * Usage: bun scripts/run-tests.ts [--all | --since <ref>] [--dry-run]
 */
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative } from "node:path";
import {
	ALWAYS,
	type AlwaysTest,
	type FolderRule,
	READ_WHOLE,
	RUN_EVERYTHING,
	type Rule,
} from "./test-rules.ts";

export interface Runner {
	/** The runner's name in runners.txt and its report's file name. */
	name: string;
	/** Its folder from the repository root. */
	dir: string;
	tool: "vitest" | "bun";
	/** The Vitest project its `test` script runs. */
	project?: string;
	/** Test files under `dir` that belong to another command. */
	excludes?: RegExp;
	/** The folder its report's paths start from (scripts/test-report.ts). */
	reportFrom: string;
}

/** Every runner `--all` runs: the workspace packages with a `test` script, then scripts/. */
export const RUNNERS: readonly Runner[] = [
	{
		name: "desktop",
		dir: "apps/desktop",
		tool: "vitest",
		project: "unit",
		excludes: /\.macos\.test\.[cm]?[jt]sx?$/,
		reportFrom: "apps/desktop",
	},
	{ name: "cloud", dir: "apps/cloud", tool: "vitest", reportFrom: "apps/cloud" },
	{ name: "sidecar", dir: "packages/sidecar", tool: "bun", reportFrom: "packages/sidecar" },
	{ name: "protocol", dir: "packages/protocol", tool: "bun", reportFrom: "packages/protocol" },
	{ name: "shared", dir: "packages/shared", tool: "bun", reportFrom: "packages/shared" },
	{ name: "scripts", dir: "scripts", tool: "bun", reportFrom: "." },
];

export type Plan =
	| { kind: "everything"; reasons: string[] }
	| {
			kind: "selected";
			/** Test files per runner name, from the repository root. Runners with none are left out. */
			files: Record<string, string[]>;
			/** How many of them only the ALWAYS list asked for. */
			alwaysOnly: number;
	  };

const MODULE = /\.[cm]?[jt]sx?$/;
const TEST = /[._](?:test|spec)\.[cm]?[jt]sx?$/;

/** Whether a change to `path` is a change to code a test could run. */
export const isCode = (path: string): boolean => MODULE.test(path) || path.endsWith(".sh");

/** True when `path` is under the folder `dir` (both from the repository root). */
const isUnder = (path: string, dir: string): boolean => path.startsWith(`${dir}/`);

/** The runner a test file belongs to, if any. */
export function runnerOf(file: string, runners: readonly Runner[] = RUNNERS): Runner | undefined {
	return runners.find(
		(runner) => isUnder(file, runner.dir) && !(runner.excludes?.test(file) ?? false),
	);
}

/** Each runner's test files among the tracked files. */
export function testFilesByRunner(
	tracked: readonly string[],
	runners: readonly Runner[] = RUNNERS,
): Record<string, string[]> {
	const byRunner: Record<string, string[]> = Object.fromEntries(runners.map((r) => [r.name, []]));
	for (const file of tracked) {
		if (!TEST.test(file)) continue;
		const runner = runnerOf(file, runners);
		if (runner !== undefined) byRunner[runner.name]?.push(file);
	}
	return byRunner;
}

/** Why the changed files need every test, one line per rule they hit; empty when none. */
export function runEverythingReasons(
	changed: readonly string[],
	rules: readonly Rule[] = RUN_EVERYTHING,
): string[] {
	const reasons: string[] = [];
	for (const rule of rules) {
		const glob = new Bun.Glob(rule.glob);
		const hit = changed.find((path) => glob.match(path));
		if (hit !== undefined) reasons.push(`${hit}: ${rule.why}`);
	}
	return reasons;
}

/**
 * The name a reader would use for a changed file: the base name of a data file, which tests often
 * join to a folder, and the folder and base name of a module, whose bare name (`index.ts`) is too
 * common to mean that file.
 */
export function nameOf(path: string): string {
	const name = basename(path);
	if (!MODULE.test(path)) return name;
	const folder = basename(dirname(path));
	return folder === "." ? name : `${folder}/${name}`;
}

/**
 * Files that read a changed file by name rather than by import: every source file whose code
 * names it, and the tests a READ_WHOLE rule lists for a folder it is in. A rule's runner folder
 * stands for every test file in it. `code` holds each source file's code without its comments
 * (see `codeOf`), because a comment that mentions a file does not read it.
 */
export function readersOf(
	changed: readonly string[],
	code: ReadonlyMap<string, string>,
	testFiles: readonly string[],
	rules: readonly FolderRule[] = READ_WHOLE,
): string[] {
	const readers = new Set<string>();
	const names = [...new Set(changed.map(nameOf))];
	for (const [path, text] of code) {
		if (names.some((name) => text.includes(name))) readers.add(path);
	}
	for (const rule of rules) {
		const glob = new Bun.Glob(rule.glob);
		if (!changed.some((path) => glob.match(path))) continue;
		for (const test of rule.tests) {
			if (TEST.test(test)) readers.add(test);
			else for (const file of testFiles) if (isUnder(file, test)) readers.add(file);
		}
	}
	for (const path of changed) readers.delete(path);
	return [...readers].sort();
}

const LOADERS: Record<string, "ts" | "tsx" | "js" | "jsx"> = {
	".ts": "ts",
	".mts": "ts",
	".cts": "ts",
	".tsx": "tsx",
	".js": "js",
	".mjs": "js",
	".cjs": "js",
	".jsx": "jsx",
};

/** A module's code with its comments and types removed, or its whole text when it does not parse. */
export function codeOf(file: string, source: string): string {
	const loader = LOADERS[extname(file)];
	if (loader === undefined) return source;
	try {
		return new Bun.Transpiler({ loader }).transformSync(source);
	} catch {
		return source;
	}
}

/**
 * The repository files a module imports at run time, resolved as Bun resolves them: workspace
 * packages to their real folders, and nothing in node_modules or Bun's built-ins. Type-only
 * imports are left out, because they never run. "unreadable" when the source does not parse.
 */
export function importsOf(file: string, source: string): string[] | "unreadable" {
	const loader = LOADERS[extname(file)];
	if (loader === undefined) return [];
	let found: { path: string }[];
	try {
		found = new Bun.Transpiler({ loader }).scanImports(source);
	} catch {
		return "unreadable";
	}
	const resolved: string[] = [];
	for (const { path } of found) {
		let target: string;
		try {
			target = Bun.resolveSync(path, dirname(file));
		} catch {
			// A package that is not installed here is outside the repository's graph.
			continue;
		}
		if (isAbsolute(target) && !target.includes("/node_modules/")) resolved.push(target);
	}
	return resolved;
}

/**
 * The tests that reach a related file through their imports, in the order given. A module whose
 * imports cannot be read counts as related, so a test that reaches it runs.
 */
export function testsReaching(
	tests: readonly string[],
	related: ReadonlySet<string>,
	imports: (file: string) => string[] | "unreadable",
): string[] {
	const importers = new Map<string, Set<string>>();
	const seen = new Set<string>();
	const unreadable: string[] = [];
	const queue = [...tests];
	for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
		if (seen.has(file)) continue;
		seen.add(file);
		const found = imports(file);
		if (found === "unreadable") {
			unreadable.push(file);
			continue;
		}
		for (const dependency of found) {
			const set = importers.get(dependency) ?? new Set<string>();
			importers.set(dependency, set);
			set.add(file);
			if (!seen.has(dependency)) queue.push(dependency);
		}
	}
	const affected = new Set<string>();
	const up = [...related, ...unreadable];
	for (let file = up.pop(); file !== undefined; file = up.pop()) {
		if (affected.has(file)) continue;
		affected.add(file);
		for (const importer of importers.get(file) ?? []) up.push(importer);
	}
	return tests.filter((test) => affected.has(test));
}

/**
 * The plan from what each runner's graph reached. Code that changed but that no test reaches
 * means the selection missed something, so every test runs. Otherwise the ALWAYS tests are added.
 */
export function finishPlan(
	changed: readonly string[],
	reached: Readonly<Record<string, readonly string[]>>,
	always: readonly AlwaysTest[] = ALWAYS,
	runners: readonly Runner[] = RUNNERS,
): Plan {
	const code = changed.filter(isCode);
	const total = Object.values(reached).reduce((sum, files) => sum + files.length, 0);
	if (code.length > 0 && total === 0) {
		const named = code.slice(0, 3).join(", ") + (code.length > 3 ? ", ..." : "");
		return {
			kind: "everything",
			reasons: [`no test reaches the changed code (${named}), so every test runs`],
		};
	}
	const files: Record<string, string[]> = {};
	let alwaysOnly = 0;
	for (const runner of runners) {
		const chosen = new Set(reached[runner.name] ?? []);
		for (const test of always) {
			if (runnerOf(test.file, runners)?.name !== runner.name || chosen.has(test.file)) continue;
			chosen.add(test.file);
			alwaysOnly += 1;
		}
		if (chosen.size > 0) files[runner.name] = [...chosen].sort();
	}
	return { kind: "selected", files, alwaysOnly };
}

/**
 * The command that runs a runner's tests: all of them, or the files given. A package runs through
 * its own `test` script, which writes its JUnit report; scripts/ has no package, so its command
 * names the report itself when `reports` names a folder.
 */
export function commandFor(
	runner: Runner,
	files: readonly string[] | "all",
	reports?: string,
): string[] {
	if (runner.name === "scripts") {
		const paths = files === "all" ? ["./scripts"] : files.map((file) => `./${file}`);
		const report = reports
			? ["--reporter=junit", `--reporter-outfile=${join(reports, "scripts.xml")}`]
			: [];
		// As the packages' own test scripts do: a timeout catches a hang, never slowness.
		return ["bun", "test", "--timeout", "60000", ...report, ...paths];
	}
	const paths =
		files === "all"
			? []
			: files.map((file) => {
					const path = relative(runner.dir, file);
					return runner.tool === "bun" ? `./${path}` : path;
				});
	return ["pnpm", "--dir", runner.dir, "run", "test", ...paths];
}

/** The runners a plan runs and the commands that run them, in order. */
export function commandsFor(
	plan: Plan,
	reports?: string,
	runners: readonly Runner[] = RUNNERS,
): { runners: Runner[]; commands: string[][] } {
	if (plan.kind === "everything") {
		// `pnpm -r` runs every package's `test` script side by side; scripts/ runs after it.
		const scripts = runners.filter((runner) => runner.name === "scripts");
		return {
			runners: [...runners],
			commands: [
				["pnpm", "-r", "--no-bail", "test"],
				...scripts.map((runner) => commandFor(runner, "all", reports)),
			],
		};
	}
	const chosen = runners.filter((runner) => plan.files[runner.name] !== undefined);
	return {
		runners: chosen,
		commands: chosen.map((runner) => commandFor(runner, plan.files[runner.name] ?? [], reports)),
	};
}

/** The lines of runners.txt: `name=folder` for each runner that will run. */
export const runnerList = (runners: readonly Runner[]): string =>
	runners.map((runner) => `${runner.name}=${runner.reportFrom}\n`).join("");

// Real path: Bun's resolver answers with real paths, and the graph compares the two.
const ROOT = realpathSync(join(import.meta.dir, ".."));

function git(args: string[]): string[] {
	const result = Bun.spawnSync(["git", ...args], { cwd: ROOT, stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`);
	}
	return result.stdout.toString().split("\0").filter(Boolean);
}

/** Files changed since the merge base with `since`, plus staged, unstaged and untracked files. */
export function changedSince(since: string): string[] {
	return [
		...new Set([
			...git(["diff", "--name-only", "--no-renames", "-z", `${since}...HEAD`]),
			...git(["diff", "--name-only", "--no-renames", "-z", "--cached"]),
			...git(["diff", "--name-only", "--no-renames", "-z"]),
			...git(["ls-files", "-z", "--others", "--exclude-standard"]),
		]),
	].sort();
}

/** Asks Vitest which of a runner's tests the related files can affect. */
function vitestReaching(runner: Runner, related: readonly string[]): string[] {
	const result = Bun.spawnSync(
		[
			"node",
			join(ROOT, "scripts/vitest-affected.ts"),
			join(ROOT, runner.dir),
			runner.project ?? "-",
			...related.map((file) => join(ROOT, file)),
		],
		{ cwd: ROOT, stdout: "pipe", stderr: "inherit" },
	);
	if (result.exitCode !== 0) throw new Error(`Vitest could not list ${runner.name}'s tests`);
	const lines = result.stdout.toString().trim().split("\n");
	const files = JSON.parse(lines.at(-1) ?? "[]") as string[];
	return files.map((file) => relative(ROOT, file)).filter((file) => !runner.excludes?.test(file));
}

/** The plan for a set of changed files (from the repository root), read from this checkout. */
export function planFor(changed: readonly string[]): Plan {
	const reasons = runEverythingReasons(changed);
	if (reasons.length > 0) return { kind: "everything", reasons };

	const tracked = git(["ls-files", "-z"]);
	const tests = testFilesByRunner(tracked);
	const sources = new Map<string, string>();
	for (const file of tracked) {
		if (MODULE.test(file) && existsSync(join(ROOT, file)))
			sources.set(file, readFileSync(join(ROOT, file), "utf8"));
	}
	const code = new Map([...sources].map(([file, text]) => [file, codeOf(file, text)]));
	const related = [
		...new Set([...changed, ...readersOf(changed, code, Object.values(tests).flat())]),
	];
	const absolute = new Set(related.map((file) => join(ROOT, file)));
	const imports = (file: string): string[] | "unreadable" => {
		const text = sources.get(relative(ROOT, file));
		if (text !== undefined) return importsOf(file, text);
		return existsSync(file) ? importsOf(file, readFileSync(file, "utf8")) : [];
	};
	const reached: Record<string, string[]> = {};
	for (const runner of RUNNERS) {
		const own = tests[runner.name] ?? [];
		reached[runner.name] =
			runner.tool === "vitest"
				? vitestReaching(runner, related)
				: testsReaching(
						own.map((file) => join(ROOT, file)),
						absolute,
						imports,
					).map((file) => relative(ROOT, file));
	}
	return finishPlan(changed, reached);
}

function report(result: Plan, changed: readonly string[] | null, since: string, list: boolean) {
	if (changed !== null) console.log(`Changed since ${since}: ${changed.length} file(s).`);
	if (result.kind === "everything") {
		console.log("Running every test:");
		for (const reason of result.reasons) console.log(`  ${reason}`);
		return;
	}
	const count = Object.values(result.files).reduce((sum, files) => sum + files.length, 0);
	console.log(
		`Running ${count} test file(s) these changes can reach, ${result.alwaysOnly} of them only because they always run:`,
	);
	for (const [name, files] of Object.entries(result.files)) {
		console.log(`  ${name.padEnd(9)} ${files.length}`);
		if (list) for (const file of files) console.log(`    ${file}`);
	}
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const all = args.includes("--all");
	const dryRun = args.includes("--dry-run");
	const sinceAt = args.indexOf("--since");
	const since = sinceAt >= 0 ? args[sinceAt + 1] : "origin/main";
	const known = new Set(["--all", "--dry-run", "--since", since]);
	if (since === undefined || args.some((arg) => !known.has(arg)) || (all && sinceAt >= 0)) {
		console.error("Usage: bun scripts/run-tests.ts [--all | --since <ref>] [--dry-run]");
		process.exit(64);
	}

	const changed = all ? null : changedSince(since);
	const plan: Plan =
		changed === null
			? { kind: "everything", reasons: ["--all asks for every test"] }
			: planFor(changed);
	report(plan, changed, since, dryRun);
	if (dryRun) process.exit(0);

	const reports = process.env.CONDUCTED_TEST_REPORTS || undefined;
	const { runners, commands } = commandsFor(plan, reports);
	if (reports) writeFileSync(join(reports, "runners.txt"), runnerList(runners));

	const failed: string[] = [];
	for (const command of commands) {
		const shown = command.length > 7 ? [...command.slice(0, 7), "..."] : command;
		console.log(`\n$ ${shown.join(" ")}`);
		const child = Bun.spawnSync(command, { cwd: ROOT, stdio: ["inherit", "inherit", "inherit"] });
		if (child.exitCode !== 0) failed.push(shown.join(" "));
	}
	if (failed.length > 0)
		console.error(`\nFailed:\n${failed.map((line) => `  ${line}`).join("\n")}`);
	process.exit(failed.length === 0 ? 0 : 1);
}
