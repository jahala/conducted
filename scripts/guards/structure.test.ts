/**
 * Each structure guard must catch the break it exists for. These tests build a small sample repo
 * in the run's temp folder, plant one problem per rule, and assert the guard reports it, and that
 * the clean sample passes. The two compiler guards open the sample through the real TypeScript
 * API, so they prove the type checker finds the planted users and the planted missing keys.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	BASELINE,
	checkMigrationList,
	checkPlaceholderTests,
	checkShellPrograms,
	checkTauriCommands,
	checkTestOnlyExports,
	checkUnwiredDeps,
	commandEntries,
	commandFunctions,
	isTestPath,
	listedMigrations,
	measureAgainst,
	nextBaseline,
	programLiterals,
	registeredCommands,
	scanTestOnlyExports,
	scanUnwiredDeps,
} from "./structure.ts";

const COMPILER_TIMEOUT_MS = 60_000;

let root = "";
const put = (path: string, text: string) => {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), text);
};
const messages = (problems: { message: string }[]) => problems.map((p) => p.message);

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "structure-guards-"));
});
afterEach(() => {
	// The test made this folder, so it removes it.
	rmSync(root, { recursive: true, force: true });
});

const HEAD =
	"| ID | Feature | Owner | Research | P | Status | Needs |\n|---|---|---|---|---|---|---|\n";
const BACKLOG = `## Things (CHAT)\n\n${HEAD}| CHAT-01 | One | D/x | r | 1 | done |  |\n| CHAT-02 | Two | D/x | r | 1 | stub |  |\n| CHAT-03 | Three | D/x | r | 1 | planned |  |\n`;
const putBacklog = () => put("docs/plans/backlog.md", BACKLOG);

describe("commands", () => {
	const LIB = "tauri::generate_handler![\n    health,\n    shell::shell_run,\n    orphan,\n]";
	const SHELL = [
		"#[tauri::command]",
		"pub async fn shell_run() {}",
		"",
		"#[tauri::command]",
		"#[allow(unused_variables)]",
		"pub fn forgotten() {}",
	].join("\n");
	const ADAPTER = [
		"export const COMMANDS = {",
		'\thealth: "health",',
		'\tshellRun: "shell_run",',
		'\tsoon: "soon_cmd", // CHAT-02',
		'\tlying: "lying_cmd", // CHAT-01',
		'\tuntagged: "untagged_cmd",',
		'\tunknown: "unknown_cmd", // CHAT-77',
		"} as const;",
	].join("\n");

	test("reads the command functions, the handler list and the COMMANDS entries", () => {
		expect(commandFunctions(SHELL)).toEqual(["shell_run", "forgotten"]);
		expect([...(registeredCommands(LIB) ?? [])]).toEqual(["health", "shell_run", "orphan"]);
		expect(commandEntries(ADAPTER)?.map((e) => [e.key, e.tag])).toEqual([
			["health", null],
			["shellRun", null],
			["soon", "CHAT-02"],
			["lying", "CHAT-01"],
			["untagged", null],
			["unknown", "CHAT-77"],
		]);
	});

	test("flags a command that is not registered, a name nobody calls and a name with no handler", () => {
		putBacklog();
		put("apps/desktop/src-tauri/src/lib.rs", LIB);
		put("apps/desktop/src-tauri/src/shell.rs", SHELL);
		put("apps/desktop/src/platform/tauri.ts", ADAPTER);
		const found = messages(checkTauriCommands(root));
		expect(found).toContain(
			"apps/desktop/src-tauri/src/shell.rs: command forgotten is not in generate_handler! in apps/desktop/src-tauri/src/lib.rs",
		);
		expect(found).toContain(
			"apps/desktop/src-tauri/src/lib.rs registers orphan, which has no name in COMMANDS in apps/desktop/src/platform/tauri.ts",
		);
		expect(
			found.some(
				(m) => m.startsWith('COMMANDS.lying ("lying_cmd")') && m.includes("row CHAT-01 is done"),
			),
		).toBe(true);
		expect(
			found.some(
				(m) => m.startsWith('COMMANDS.untagged ("untagged_cmd")') && m.includes("no backlog tag"),
			),
		).toBe(true);
		expect(
			found.some((m) => m.startsWith('COMMANDS.unknown ("unknown_cmd")') && m.includes("CHAT-77")),
		).toBe(true);
		// A name with no handler is fine while its row is not done.
		expect(found.some((m) => m.includes("soon_cmd"))).toBe(false);
		expect(found).toHaveLength(5);
	});

	test("passes when every command is registered and every name is registered or tagged", () => {
		putBacklog();
		put("apps/desktop/src-tauri/src/lib.rs", "generate_handler![health, shell::shell_run]");
		put("apps/desktop/src-tauri/src/shell.rs", "#[tauri::command]\nfn shell_run() {}\n");
		put(
			"apps/desktop/src/platform/tauri.ts",
			'export const COMMANDS = {\n\thealth: "health",\n\tshellRun: "shell_run",\n\tsoon: "soon_cmd", // CHAT-02\n} as const;\n',
		);
		expect(checkTauriCommands(root)).toEqual([]);
	});
});

describe("programs", () => {
	test("reads the literals and flags a program missing from ALLOWED_PROGRAMS, compared by file name", () => {
		expect(
			programLiterals('run({ program: "git" }); x({ program:"/bin/echo" }); y({ program: name })'),
		).toEqual(["git", "/bin/echo"]);
		put(
			"apps/desktop/src-tauri/src/shell.rs",
			'pub const ALLOWED_PROGRAMS: &[&str] = &[\n    "git",\n    "echo",\n];\n',
		);
		put("apps/desktop/src/core/a.ts", 'run({ program: "git" });\nrun({ program: "/bin/echo" });\n');
		put(
			"apps/desktop/src/core/b.ts",
			'run({ program: "xcodebuild" });\nrun({ program: "xcodebuild" });\n',
		);
		put("apps/desktop/src/core/b.test.ts", 'run({ program: "curl" });\n');
		expect(messages(checkShellPrograms(root))).toEqual([
			'apps/desktop/src/core/b.ts starts "xcodebuild", which is not in ALLOWED_PROGRAMS in apps/desktop/src-tauri/src/shell.rs',
		]);
	});
});

describe("migration-list", () => {
	const entry = (version: number, file: string) =>
		`        Migration {\n            version: ${version},\n            description: "x",\n            sql: include_str!("../migrations/${file}"),\n            kind: MigrationKind::Up,\n        },\n`;
	const db = (...entries: string[]) => `vec![\n${entries.join("")}]\n`;

	test("reads the listed migrations", () => {
		expect(listedMigrations(db(entry(1, "0001_a.sql"), entry(2, "0002_b.sql")))).toEqual([
			{ version: 1, file: "0001_a.sql" },
			{ version: 2, file: "0002_b.sql" },
		]);
	});

	test("flags a file the list forgot, a listed file that is gone, an unlocked one and a wrong version", () => {
		put("apps/desktop/src-tauri/migrations/0001_a.sql", "");
		put("apps/desktop/src-tauri/migrations/0002_b.sql", "");
		put("apps/desktop/src-tauri/migrations/0003_forgotten.sql", "");
		put("apps/desktop/src-tauri/migrations/migrations.lock", `${"0".repeat(64)}  0001_a.sql\n`);
		put(
			"apps/desktop/src-tauri/src/db.rs",
			db(entry(1, "0001_a.sql"), entry(5, "0002_b.sql"), entry(3, "0004_gone.sql")),
		);
		const found = messages(checkMigrationList(root));
		expect(found).toContain(
			"0003_forgotten.sql is not in migrations() in apps/desktop/src-tauri/src/db.rs",
		);
		expect(found).toContain(
			"apps/desktop/src-tauri/src/db.rs lists 0004_gone.sql, which does not exist",
		);
		expect(found).toContain(
			"apps/desktop/src-tauri/src/db.rs lists 0002_b.sql, which is not in migrations.lock",
		);
		expect(found).toContain(
			"apps/desktop/src-tauri/src/db.rs gives 0002_b.sql version 5, but its file number is 2",
		);
		expect(found.some((m) => m.includes("0001_a.sql"))).toBe(false);
	});

	test("passes when the files, the list and the lock agree", () => {
		put("apps/desktop/src-tauri/migrations/0001_a.sql", "");
		put("apps/desktop/src-tauri/migrations/0002_b.sql", "");
		put(
			"apps/desktop/src-tauri/migrations/migrations.lock",
			`${"0".repeat(64)}  0001_a.sql\n${"1".repeat(64)}  0002_b.sql\n`,
		);
		put("apps/desktop/src-tauri/src/db.rs", db(entry(1, "0001_a.sql"), entry(2, "0002_b.sql")));
		expect(checkMigrationList(root)).toEqual([]);
	});
});

describe("baseline", () => {
	test("a count above the baseline fails and names what was found", () => {
		const found = [
			{ file: "a.ts", name: "one" },
			{ file: "a.ts", name: "two" },
		];
		expect(messages(measureAgainst("g", found, { "a.ts": 1 }))).toEqual([
			"a.ts has 2 (baseline 1): one, two",
		]);
		expect(messages(measureAgainst("g", found, {}))).toEqual(["a.ts has 2 (baseline 0): one, two"]);
	});

	test("a baseline above the real count fails, so every fix lowers it (D055)", () => {
		const found = [{ file: "a.ts", name: "one" }];
		const found2 = messages(measureAgainst("g", found, { "a.ts": 3, "gone.ts": 1 }));
		expect(found2.some((m) => m.startsWith("a.ts has 1, but the baseline says 3"))).toBe(true);
		expect(found2.some((m) => m.startsWith("gone.ts has 0, but the baseline says 1"))).toBe(true);
	});

	test("an equal count passes", () => {
		expect(measureAgainst("g", [{ file: "a.ts", name: "one" }], { "a.ts": 1 })).toEqual([]);
	});

	test("a regenerated baseline never rises once one exists", () => {
		const none = { "placeholder-tests": [], "test-only-exports": [], "unwired-deps": [] };
		const found = {
			...none,
			"unwired-deps": [
				{ file: "a.ts", name: "x" },
				{ file: "a.ts", name: "y" },
			],
		};
		expect(nextBaseline(null, found).raised).toEqual([]);
		expect(nextBaseline({ "unwired-deps": { "a.ts": 2 } }, found).raised).toEqual([]);
		expect(nextBaseline({ "unwired-deps": { "a.ts": 1 } }, found).raised).toEqual([
			"unwired-deps: a.ts 1 -> 2",
		]);
		expect(nextBaseline({ "unwired-deps": { "a.ts": 5 } }, found).baseline["unwired-deps"]).toEqual(
			{ "a.ts": 2 },
		);
	});
});

describe("placeholder-tests", () => {
	test("flags placeholder text and a read of a backlog status, and ignores comments and clean tests", () => {
		put(
			"apps/desktop/src/ui/a.test.tsx",
			'it("x", () => {\n\texpect(screen.getByText("Not built yet: PR-04")).toBeTruthy();\n});\n// Not built yet is only mentioned here.\n',
		);
		put(
			"apps/desktop/src/core/b.test.ts",
			'const backlog = readFileSync("docs/plans/backlog.md", "utf8");\nexpect(statusOf("SET-01")).toBe("done");\n',
		);
		put("apps/desktop/src/core/c.test.ts", 'expect(add(1, 2)).toBe(3);\nconst s = "done";\n');
		put(
			"packages/shared/src/not-implemented.test.ts",
			'expect(m).toBe("Not implemented: CHAT-03");\n',
		);
		const found = messages(checkPlaceholderTests(root));
		expect(found).toEqual([
			"apps/desktop/src/core/b.test.ts has 1 (baseline 0): line 2",
			"apps/desktop/src/ui/a.test.tsx has 1 (baseline 0): line 2",
		]);
	});

	test("passes at its baseline and fails when the baseline is stale", () => {
		put("apps/desktop/src/ui/a.test.tsx", 'expect(x).toBe("Not built yet");\n');
		put(BASELINE, JSON.stringify({ "placeholder-tests": { "apps/desktop/src/ui/a.test.tsx": 1 } }));
		expect(checkPlaceholderTests(root)).toEqual([]);
		put(BASELINE, JSON.stringify({ "placeholder-tests": { "apps/desktop/src/ui/a.test.tsx": 2 } }));
		expect(messages(checkPlaceholderTests(root))[0]).toContain("but the baseline says 2");
	});
});

const TSCONFIG = JSON.stringify({
	compilerOptions: {
		target: "ES2023",
		lib: ["ES2023"],
		module: "ESNext",
		moduleResolution: "bundler",
		strict: true,
		noEmit: true,
		allowImportingTsExtensions: true,
		types: [],
	},
	include: ["src"],
});

describe("test-only-exports", () => {
	const plant = () => {
		putBacklog();
		put("apps/desktop/tsconfig.json", TSCONFIG);
		put("packages/sidecar/tsconfig.json", TSCONFIG);
		put(
			"apps/desktop/src/a.ts",
			[
				"/** @feature CHAT-01 A */",
				"export function testedOnly() { return 1; }",
				"export function used() { return 2; }",
				"export class TestedClass {}",
				"export const arrowTestedOnly = () => 3;",
				"export function usedInside() { return 4; }",
				"export function other() { return usedInside(); }",
				"export function viaBarrel() { return 5; }",
				"",
			].join("\n"),
		);
		put("apps/desktop/src/index.ts", 'export { viaBarrel } from "./a.ts";\n');
		put(
			"apps/desktop/src/b.ts",
			'/** B */\nimport { other, used } from "./a.ts";\nimport { viaBarrel } from "./index.ts";\nexport function live() { return used() + other() + viaBarrel(); }\n',
		);
		put(
			"apps/desktop/src/main.ts",
			'/** Main */\nimport { live } from "./b.ts";\nexport const answer = live();\n',
		);
		put(
			"apps/desktop/src/a.test.ts",
			'import { arrowTestedOnly, TestedClass, testedOnly, used, usedInside, viaBarrel } from "./a.ts";\nimport { live } from "./b.ts";\nvoid [arrowTestedOnly(), new TestedClass(), testedOnly(), used(), usedInside(), viaBarrel(), live()];\n',
		);
		put(
			"apps/desktop/src/stubbed.ts",
			"/** @feature CHAT-02 Stub */\nexport function stubbed() { return 1; }\n",
		);
		put(
			"apps/desktop/src/stubbed.test.ts",
			'import { stubbed } from "./stubbed.ts";\nvoid stubbed();\n',
		);
		// A planned feature is not built either, so its file is skipped like a stub's.
		put(
			"apps/desktop/src/planned.ts",
			"/** @feature CHAT-03 Planned */\nexport function planned() { return 1; }\n",
		);
		put(
			"apps/desktop/src/planned.test.ts",
			'import { planned } from "./planned.ts";\nvoid planned();\n',
		);
		put(
			"apps/desktop/src/helpers-test-support.ts",
			"/** Helper */\nexport function helperOnlyForTests() { return 1; }\n",
		);
		put(
			"apps/desktop/src/helpers.test.ts",
			'import { helperOnlyForTests } from "./helpers-test-support.ts";\nvoid helperOnlyForTests();\n',
		);
	};

	test(
		"flags a function, a class and an arrow function that only tests use, and nothing that production uses",
		async () => {
			plant();
			const found = await scanTestOnlyExports(root);
			expect(found.map((v) => `${v.file} ${v.name}`).sort()).toEqual([
				"apps/desktop/src/a.ts TestedClass",
				"apps/desktop/src/a.ts arrowTestedOnly",
				"apps/desktop/src/a.ts testedOnly",
			]);
		},
		COMPILER_TIMEOUT_MS,
	);

	test(
		"fails without a baseline, passes with an exact one and fails when it is stale",
		async () => {
			plant();
			expect(messages(await checkTestOnlyExports(root))).toEqual([
				"apps/desktop/src/a.ts has 3 (baseline 0): testedOnly, TestedClass, arrowTestedOnly",
			]);
			put(BASELINE, JSON.stringify({ "test-only-exports": { "apps/desktop/src/a.ts": 3 } }));
			expect(await checkTestOnlyExports(root)).toEqual([]);
			put(BASELINE, JSON.stringify({ "test-only-exports": { "apps/desktop/src/a.ts": 4 } }));
			expect(messages(await checkTestOnlyExports(root))[0]).toContain("but the baseline says 4");
		},
		COMPILER_TIMEOUT_MS,
	);

	test("a project that is missing is a problem, not a skip", async () => {
		expect(messages(await checkTestOnlyExports(root))[0]).toBe(
			"apps/desktop/tsconfig.json does not exist",
		);
	});
});

describe("unwired-deps", () => {
	const plant = () => {
		putBacklog();
		put("apps/desktop/tsconfig.json", TSCONFIG);
		put("packages/sidecar/tsconfig.json", TSCONFIG);
		put(
			"apps/desktop/src/core/svc.ts",
			[
				"export interface SvcDeps {",
				"\tneeded: () => number;",
				"\textra?: () => number;",
				"\tlabel?: string;",
				"}",
				"export class Svc {",
				"\tconstructor(readonly deps: SvcDeps) {}",
				"}",
				"export function makeSvc(deps: SvcDeps) { return new Svc(deps); }",
				"",
			].join("\n"),
		);
		put(
			"apps/desktop/src/core/container.ts",
			[
				'import { makeSvc, Svc } from "./svc.ts";',
				"const extra = { extra: () => 2 };",
				"export function build() {",
				"\tconst wired = new Svc({ needed: () => 1, extra: () => 2 });",
				"\tconst spread = new Svc({ needed: () => 1, ...extra });",
				"\tconst left = new Svc({ needed: () => 1 });",
				"\tconst viaFunction = makeSvc({ needed: () => 1 });",
				"\t// unwired: CHAT-02 waits for the second chat",
				"\tconst excused = new Svc({ needed: () => 1 });",
				"\t// unwired: CHAT-01 is done, so this excuse is a lie",
				"\tconst lying = new Svc({ needed: () => 1 });",
				"\tconst option = Object.keys({ a: 1 });",
				"\treturn [wired, spread, left, viaFunction, excused, lying, option];",
				"}",
				"",
			].join("\n"),
		);
		put("packages/sidecar/src/modes/sidecar-mode.ts", "export const mode = 1;\n");
	};

	test(
		"flags an optional dependency the root leaves out, unless an unwired marker names a row that is not done",
		async () => {
			plant();
			const found = await scanUnwiredDeps(root);
			expect(found.map((v) => `${v.file} ${v.name}`)).toEqual([
				"apps/desktop/src/core/container.ts Svc.extra",
				"apps/desktop/src/core/container.ts makeSvc.extra",
				"apps/desktop/src/core/container.ts Svc.extra",
			]);
		},
		COMPILER_TIMEOUT_MS,
	);

	test(
		"fails without a baseline and passes at the exact one",
		async () => {
			plant();
			expect(messages(await checkUnwiredDeps(root))[0]).toContain(
				"container.ts has 3 (baseline 0)",
			);
			put(
				BASELINE,
				JSON.stringify({ "unwired-deps": { "apps/desktop/src/core/container.ts": 3 } }),
			);
			expect(await checkUnwiredDeps(root)).toEqual([]);
		},
		COMPILER_TIMEOUT_MS,
	);

	test("a missing composition root is a problem, not a skip", async () => {
		expect(messages(await checkUnwiredDeps(root))[0]).toBe(
			"apps/desktop/tsconfig.json does not exist",
		);
	});
});

describe("test paths", () => {
	test("files under a test or test-support folder count as test code", () => {
		expect(isTestPath("apps/desktop/src/test/container.ts")).toBe(true);
		expect(isTestPath("packages/sidecar/src/test-support/fake-app.ts")).toBe(true);
		expect(isTestPath("packages/sidecar/src/session/manager.test.ts")).toBe(true);
		expect(isTestPath("packages/sidecar/src/session/manager.ts")).toBe(false);
		expect(isTestPath("apps/desktop/src/core/testing-mode.ts")).toBe(false);
	});
});
