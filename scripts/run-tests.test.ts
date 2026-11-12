/**
 * The changed-only test run picks the tests a change can reach, and every test when it cannot
 * tell. The first part checks each rule on small inputs; the second asks the real repository, so
 * a leaf file selects few tests, a hub file many, a lockfile everything, and code no test reaches
 * everything.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	codeOf,
	commandFor,
	commandsFor,
	finishPlan,
	importsOf,
	nameOf,
	type Plan,
	planFor,
	RUNNERS,
	type Runner,
	readersOf,
	runEverythingReasons,
	runnerList,
	testFilesByRunner,
	testsReaching,
} from "./run-tests.ts";
import { ALWAYS, READ_WHOLE } from "./test-rules.ts";

const ROOT = join(import.meta.dir, "..");
/** A hang, never a slow machine: Vitest walks a cold module graph in a few seconds. */
const HANG = 120_000;

describe("the run-everything list", () => {
	test("a lockfile, a nested manifest or a workflow runs everything, and says which rule", () => {
		expect(runEverythingReasons(["pnpm-lock.yaml"])).toEqual([
			"pnpm-lock.yaml: the lockfile: any dependency may have changed",
		]);
		expect(runEverythingReasons(["apps/desktop/package.json"])).toHaveLength(1);
		expect(runEverythingReasons([".github/workflows/ci.yml"])).toHaveLength(1);
		expect(runEverythingReasons([".github/workflows/pages.yml"])).toEqual([]);
		expect(runEverythingReasons(["apps/desktop/src-tauri/migrations/0019_x.sql"])).toHaveLength(1);
	});

	test("a source file or a doc does not", () => {
		expect(runEverythingReasons(["apps/desktop/src/core/model.ts", "docs/design.md"])).toEqual([]);
	});
});

describe("files read by name", () => {
	const code = new Map([
		["scripts/check-stubs.ts", codeOf("check-stubs.ts", 'read("docs/plans/backlog.md");')],
		["apps/desktop/src/x.test.ts", codeOf("x.test.ts", 'join(dir, "tauri.conf.json");')],
		[
			"apps/desktop/src/comment.ts",
			codeOf("comment.ts", "// see backlog.md and tauri.conf.json\n"),
		],
		["scripts/reads-module.test.ts", codeOf("r.test.ts", 'read("src/platform/tauri.ts");')],
		["apps/desktop/src/imports.ts", codeOf("imports.ts", 'import "./tauri.ts";')],
	]);

	test("a data file is named by its base name, a module by its folder and base name", () => {
		expect(nameOf("apps/desktop/src-tauri/tauri.conf.json")).toBe("tauri.conf.json");
		expect(nameOf("apps/desktop/src/platform/tauri.ts")).toBe("platform/tauri.ts");
	});

	test("code that names a changed file reads it; a comment that names it does not", () => {
		expect(readersOf(["docs/plans/backlog.md"], code, [], [])).toEqual(["scripts/check-stubs.ts"]);
		expect(readersOf(["apps/desktop/src-tauri/tauri.conf.json"], code, [], [])).toEqual([
			"apps/desktop/src/x.test.ts",
		]);
		expect(readersOf(["apps/desktop/src/platform/tauri.ts"], code, [], [])).toEqual([
			"scripts/reads-module.test.ts",
		]);
	});

	test("a folder rule adds its tests, and a runner's folder stands for all of its tests", () => {
		const rules = [
			{ glob: "bin/**", why: "on PATH", tests: ["packages/sidecar/src/host.test.ts"] },
			{ glob: "packages/shared/**", why: "the Worker imports it", tests: ["apps/cloud"] },
		];
		const tests = ["apps/cloud/src/a.test.ts", "apps/cloud/sandbox/b.test.ts", "scripts/c.test.ts"];
		expect(readersOf(["bin/tool.sh"], new Map(), tests, rules)).toEqual([
			"packages/sidecar/src/host.test.ts",
		]);
		expect(readersOf(["packages/shared/src/result.ts"], new Map(), tests, rules)).toEqual([
			"apps/cloud/sandbox/b.test.ts",
			"apps/cloud/src/a.test.ts",
		]);
	});

	test("every test a rule names exists", () => {
		const named = [...READ_WHOLE.flatMap((rule) => rule.tests), ...ALWAYS.map((test) => test.file)];
		expect(named.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
	});
});

describe("Bun's import graph", () => {
	const made: string[] = [];
	afterAll(() => {
		for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	/** A workspace in a temp folder: `files` written under it, `links` as symlinks. */
	function workspace(files: Record<string, string>, links: Record<string, string> = {}): string {
		const root = realpathSync(mkdtempSync(join(tmpdir(), "run-tests-graph-")));
		made.push(root);
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
		for (const [path, target] of Object.entries(links)) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			symlinkSync(join(root, target), join(root, path));
		}
		return root;
	}

	const imports = (file: string) =>
		existsSync(file) ? importsOf(file, readFileSync(file, "utf8")) : [];

	test("a test reaches a file through a workspace package imported by name", () => {
		const root = workspace(
			{
				"shared/package.json": '{ "name": "@x/shared", "exports": { ".": "./src/index.ts" } }',
				"shared/src/index.ts": 'export * from "./result.ts";',
				"shared/src/result.ts": "export const ok = 1;",
				"sidecar/src/config.ts": 'import { ok } from "@x/shared";\nexport const c = ok;',
				"sidecar/src/config.test.ts": 'import { c } from "./config.ts";\nc;',
				"sidecar/src/other.test.ts": 'import "node:fs";\nexport {};',
			},
			{ "sidecar/node_modules/@x/shared": "shared" },
		);
		const tests = [
			join(root, "sidecar/src/config.test.ts"),
			join(root, "sidecar/src/other.test.ts"),
		];
		expect(testsReaching(tests, new Set([join(root, "shared/src/result.ts")]), imports)).toEqual([
			join(root, "sidecar/src/config.test.ts"),
		]);
	});

	test("an import of types alone is not an edge, since it never runs", () => {
		const root = workspace({
			"types.ts": "export interface T { a: number }",
			"a.test.ts": 'import type { T } from "./types.ts";\nconst t: T = { a: 1 };\nt;',
		});
		const related = new Set([join(root, "types.ts")]);
		expect(testsReaching([join(root, "a.test.ts")], related, imports)).toEqual([]);
	});

	test("a test that reaches a file which does not parse runs whatever changed", () => {
		const root = workspace({
			"broken.ts": "export const = ;",
			"fine.ts": "export const fine = 1;",
			"a.test.ts": 'import "./fine.ts";',
			"b.test.ts": 'import "./broken.ts";',
		});
		const tests = [join(root, "a.test.ts"), join(root, "b.test.ts")];
		expect(testsReaching(tests, new Set(), imports)).toEqual([join(root, "b.test.ts")]);
	});
});

describe("the plan", () => {
	const always = [{ file: "packages/shared/src/secret-names.test.ts", why: "secrets" }];

	test("code that changed but that no test reaches runs everything", () => {
		const plan = finishPlan(["spike/probe.mjs"], { desktop: [], sidecar: [] }, always);
		expect(plan.kind).toBe("everything");
	});

	test("a change with no code runs only the tests that always run", () => {
		expect(finishPlan(["docs/design.md"], { desktop: [] }, always)).toEqual({
			kind: "selected",
			files: { shared: ["packages/shared/src/secret-names.test.ts"] },
			alwaysOnly: 1,
		});
	});

	test("the reached tests and the always tests are merged per runner, each once", () => {
		const plan = finishPlan(
			["packages/shared/src/secret-names.ts"],
			{
				shared: ["packages/shared/src/secret-names.test.ts"],
				desktop: ["apps/desktop/src/a.test.ts"],
			},
			always,
		);
		expect(plan).toEqual({
			kind: "selected",
			files: {
				desktop: ["apps/desktop/src/a.test.ts"],
				shared: ["packages/shared/src/secret-names.test.ts"],
			},
			alwaysOnly: 0,
		});
	});

	test("the desktop's macOS tests are not the desktop runner's", () => {
		const tracked = [
			"apps/desktop/src/a.test.tsx",
			"apps/desktop/src/z.macos.test.ts",
			"scripts/b.test.ts",
			"scripts/b.ts",
		];
		expect(testFilesByRunner(tracked)).toMatchObject({
			desktop: ["apps/desktop/src/a.test.tsx"],
			scripts: ["scripts/b.test.ts"],
		});
	});
});

describe("the commands", () => {
	const runner = (name: string): Runner => {
		const found = RUNNERS.find((item) => item.name === name);
		if (found === undefined) throw new Error(`no runner named ${name}`);
		return found;
	};

	test("each runner runs its files through its own test script, from its folder", () => {
		expect(commandFor(runner("desktop"), ["apps/desktop/src/a.test.tsx"])).toEqual([
			"pnpm",
			"--dir",
			"apps/desktop",
			"run",
			"test",
			"src/a.test.tsx",
		]);
		expect(commandFor(runner("sidecar"), ["packages/sidecar/src/a.test.ts"])).toEqual([
			"pnpm",
			"--dir",
			"packages/sidecar",
			"run",
			"test",
			"./src/a.test.ts",
		]);
		expect(commandFor(runner("scripts"), ["scripts/a.test.ts"], "/r")).toEqual([
			"bun",
			"test",
			"--timeout",
			"60000",
			"--reporter=junit",
			"--reporter-outfile=/r/scripts.xml",
			"./scripts/a.test.ts",
		]);
	});

	test("everything runs the packages side by side, then scripts/, and lists every runner", () => {
		const everything: Plan = { kind: "everything", reasons: [] };
		const { runners, commands } = commandsFor(everything);
		expect(commands).toEqual([
			["pnpm", "-r", "--no-bail", "test"],
			["bun", "test", "--timeout", "60000", "./scripts"],
		]);
		expect(runnerList(runners)).toBe(
			"desktop=apps/desktop\ncloud=apps/cloud\nsidecar=packages/sidecar\nprotocol=packages/protocol\nshared=packages/shared\nscripts=.\n",
		);
	});

	test("a selected run lists only the runners it starts", () => {
		const plan: Plan = {
			kind: "selected",
			files: { shared: ["packages/shared/src/a.test.ts"] },
			alwaysOnly: 0,
		};
		expect(runnerList(commandsFor(plan).runners)).toBe("shared=packages/shared\n");
	});

	test("the runners are the workspace packages with a test script, plus scripts/", () => {
		const workspaces = [
			"apps/cloud",
			"apps/desktop",
			"packages/protocol",
			"packages/shared",
			"packages/sidecar",
		];
		const withTests = workspaces.filter((dir) => {
			const manifest = JSON.parse(readFileSync(join(ROOT, dir, "package.json"), "utf8")) as {
				scripts?: Record<string, string>;
			};
			return manifest.scripts?.test !== undefined;
		});
		expect(RUNNERS.map((item) => item.dir).sort()).toEqual([...withTests, "scripts"].sort());
	});
});

describe("the real repository", () => {
	const tracked = Bun.spawnSync(["git", "ls-files"], { cwd: ROOT }).stdout.toString().split("\n");
	const all = testFilesByRunner(tracked);
	const count = (plan: Plan, runner: string): number =>
		plan.kind === "selected" ? (plan.files[runner]?.length ?? 0) : Number.POSITIVE_INFINITY;
	const desktopTotal = all.desktop?.length ?? 0;

	test(
		"a leaf screen file selects few desktop tests",
		() => {
			const plan = planFor(["apps/desktop/src/features/sidebar/RepoIconPicker.tsx"]);
			expect(plan.kind).toBe("selected");
			expect(count(plan, "desktop")).toBeGreaterThan(0);
			expect(count(plan, "desktop")).toBeLessThan(desktopTotal / 5);
		},
		HANG,
	);

	test(
		"the shared package selects most tests of every package that imports it by name",
		() => {
			const plan = planFor(["packages/shared/src/result.ts"]);
			expect(count(plan, "desktop")).toBeGreaterThan(desktopTotal / 2);
			expect(count(plan, "sidecar")).toBeGreaterThan((all.sidecar?.length ?? 0) / 2);
			expect(count(plan, "cloud")).toBe(all.cloud?.length ?? 0);
		},
		HANG,
	);

	test("a lockfile change runs everything", () => {
		expect(planFor(["pnpm-lock.yaml"]).kind).toBe("everything");
	});

	test(
		"code no test reaches runs everything rather than nothing",
		() => {
			// Found, not named: a test that names a file reads it, and so would reach it.
			const spike = tracked.find((file) => file.startsWith("spike/") && file.endsWith(".mjs"));
			expect(spike).toBeDefined();
			expect(planFor([spike ?? ""]).kind).toBe("everything");
		},
		HANG,
	);

	test(
		"a Rust file the contract test reads selects that test",
		() => {
			const plan = planFor(["apps/desktop/src-tauri/src/menu.rs"]);
			expect(plan.kind === "selected" ? plan.files.desktop : []).toContain(
				"apps/desktop/src/platform/tauri-contract.test.ts",
			);
			expect(plan.kind === "selected" ? plan.files.desktop : []).toContain(
				"apps/desktop/src/app/command-dispatcher.test.ts",
			);
		},
		HANG,
	);
});
