/**
 * Planted samples for the test-shapes guards. Each planted sample holds a small fixture tree with
 * one shape a guard must flag. Each clean sample is its look-alike that must pass. The guard tests
 * write these trees to a temp folder and scan them.
 */

export interface Sample {
	name: string;
	/** Fixture tree: path from the repository root to file text. */
	files: Record<string, string>;
}

export interface PlantedSample extends Sample {
	guard: "tests-cannot-fail" | "mocking-the-thing" | "stand-in-home" | "time-and-leaks";
	check: string;
	/** File that must carry the finding. */
	file: string;
	/** How many findings of this check the file must carry. */
	count: number;
}

const UNIT = "apps/desktop/src/core/thing.test.ts";
const COMPONENT = "apps/desktop/src/features/panel/Panel.test.tsx";
const SIDECAR = "packages/sidecar/src/session/turn.test.ts";
const RUST = "apps/desktop/src-tauri/src/engine.rs";
const HOME_FAKES = "apps/desktop/src/test/fakes.ts";

const test = (body: string): string => `import { expect, it, vi } from "vitest";\n\n${body}\n`;

export const PLANTED: PlantedSample[] = [
	// Guard 7: tests that cannot fail.
	{
		name: "a test with no expect",
		guard: "tests-cannot-fail",
		check: "no-assertion",
		file: UNIT,
		count: 1,
		files: { [UNIT]: test(`it("runs", () => {\n\tconst total = 1 + 1;\n\tvoid total;\n});`) },
	},
	{
		name: "a Rust test with no assert and no panic path",
		guard: "tests-cannot-fail",
		check: "no-assertion",
		file: RUST,
		count: 1,
		files: {
			[RUST]: `//! Sample.\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() {\n        let _total = 1 + 1;\n    }\n}\n`,
		},
	},
	{
		name: "a constant imported from the module under test compared with a literal",
		guard: "tests-cannot-fail",
		check: "constant-echo",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`import { LIMIT } from "./thing.ts";\n\nit("has a limit", () => {\n\texpect(LIMIT).toBe(5);\n});`,
			),
		},
	},
	{
		name: "an expected value imported from the module under test",
		guard: "tests-cannot-fail",
		check: "imported-expected",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`import { LIMIT, compute } from "./thing.ts";\n\nit("computes the limit", () => {\n\texpect(compute()).toBe(LIMIT);\n});`,
			),
		},
	},
	{
		name: "a Rust test that only compares a constant with a literal",
		guard: "tests-cannot-fail",
		check: "constant-echo",
		file: RUST,
		count: 1,
		files: {
			[RUST]: `//! Sample.\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn retries() {\n        assert_eq!(MAX_RETRIES, 3);\n    }\n}\n`,
		},
	},
	{
		name: "a loop assertion with no check that the list is not empty",
		guard: "tests-cannot-fail",
		check: "empty-loop",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`it("every item is valid", () => {\n\tconst items = build();\n\tfor (const item of items) {\n\t\texpect(item.valid).toBe(true);\n\t}\n});`,
			),
		},
	},
	{
		name: "an every assertion with no check that the list is not empty",
		guard: "tests-cannot-fail",
		check: "empty-loop",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`it("every item is valid", () => {\n\tconst items = build();\n\texpect(items.every((item) => item.valid)).toBe(true);\n});`,
			),
		},
	},
	{
		name: "a Rust loop assertion with no check that the list is not empty",
		guard: "tests-cannot-fail",
		check: "empty-loop",
		file: RUST,
		count: 1,
		files: {
			[RUST]: `//! Sample.\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn every_item_is_valid() {\n        let items = build();\n        for item in &items {\n            assert!(item.valid);\n        }\n    }\n}\n`,
		},
	},
	{
		name: "a Rust all() assertion with no check that the list is not empty",
		guard: "tests-cannot-fail",
		check: "empty-loop",
		file: RUST,
		count: 1,
		files: {
			[RUST]: `//! Sample.\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn every_item_is_valid() {\n        let items = build();\n        assert!(items.iter().all(|item| item.valid));\n    }\n}\n`,
		},
	},

	// Guard 8: mocking the thing.
	{
		name: "a mock of the module under test",
		guard: "mocking-the-thing",
		check: "mocks-subject",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`vi.mock("./thing.ts", () => ({ compute: () => 1 }));\n\nit("computes", () => {\n\texpect(1).toBe(1);\n});`,
			),
		},
	},
	{
		name: "a mock of a module in the test's own folder",
		guard: "mocking-the-thing",
		check: "mocks-neighbour",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`vi.mock("./helper.ts", () => ({ help: () => 1 }));\n\nit("computes", () => {\n\texpect(1).toBe(1);\n});`,
			),
		},
	},
	{
		name: "a bun mock.module of a module in the test's own folder",
		guard: "mocking-the-thing",
		check: "mocks-neighbour",
		file: SIDECAR,
		count: 1,
		files: {
			[SIDECAR]: `import { expect, mock, test } from "bun:test";\n\nmock.module("./helper.ts", () => ({ help: () => 1 }));\n\ntest("computes", () => {\n\texpect(1).toBe(1);\n});\n`,
		},
	},
	{
		name: "a component test that mocks core/hooks.ts",
		guard: "mocking-the-thing",
		check: "mocks-core",
		file: COMPONENT,
		count: 1,
		files: {
			[COMPONENT]: test(
				`vi.mock("../../core/hooks.ts", () => ({ useSetting: () => 1 }));\n\nit("renders", () => {\n\texpect(1).toBe(1);\n});`,
			),
		},
	},
	{
		name: "a hand-built object cast to Container",
		guard: "mocking-the-thing",
		check: "hand-cast-container",
		file: COMPONENT,
		count: 1,
		files: {
			[COMPONENT]: test(
				`it("renders", () => {\n\tconst container = { services: {} } as unknown as Container;\n\texpect(container).toBeDefined();\n});`,
			),
		},
	},
	{
		name: "a hand-built object cast to a Deps type",
		guard: "mocking-the-thing",
		check: "hand-cast-deps",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`it("builds", () => {\n\tconst service = new Thing({} as unknown as ThingServiceDeps);\n\texpect(service).toBeDefined();\n});`,
			),
		},
	},

	// Guard 9: one home for stand-ins.
	{
		name: "a Fake class in a test file outside the home",
		guard: "stand-in-home",
		check: "stand-in-outside-home",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`class FakeApp {\n\tsent: string[] = [];\n}\n\nit("sends", () => {\n\texpect(new FakeApp().sent).toEqual([]);\n});`,
			),
		},
	},
	{
		name: "a git runner fake in a test file outside the home",
		guard: "stand-in-home",
		check: "stand-in-outside-home",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`const fakeGit = (): GitRunner => ({ run: async () => ok(output(0)) });\n\nit("runs", () => {\n\texpect(fakeGit()).toBeDefined();\n});`,
			),
		},
	},
	{
		name: "a fake file system in a test file outside the home",
		guard: "stand-in-home",
		check: "stand-in-outside-home",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`const makeFs = () => ({ files: new Map<string, string>() });\n\nit("reads", () => {\n\texpect(makeFs().files.size).toBe(0);\n});`,
			),
		},
	},
	{
		name: "a stand-in in the home whose header names no contract test",
		guard: "stand-in-home",
		check: "no-contract-test",
		file: HOME_FAKES,
		count: 1,
		files: { [HOME_FAKES]: `/**\n * Fakes for tests.\n */\nexport class FakeApp {}\n` },
	},
	{
		name: "a stand-in in the home whose contract test does not exist",
		guard: "stand-in-home",
		check: "no-contract-test",
		file: HOME_FAKES,
		count: 1,
		files: {
			[HOME_FAKES]: `/**\n * Fakes for tests.\n * Contract test: apps/desktop/src/test/missing.test.ts\n */\nexport class FakeApp {}\n`,
		},
	},

	// Guard 10: time and leaks.
	{
		name: "a real timer wait in a file without fake timers",
		guard: "time-and-leaks",
		check: "real-time",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`it("waits", async () => {\n\tawait new Promise((resolve) => setTimeout(resolve, 30));\n\texpect(1).toBe(1);\n});`,
			),
		},
	},
	{
		name: "a sleep in a file without fake timers",
		guard: "time-and-leaks",
		check: "real-time",
		file: SIDECAR,
		count: 1,
		files: {
			[SIDECAR]: `import { expect, test } from "bun:test";\n\ntest("waits", async () => {\n\tawait Bun.sleep(30);\n\texpect(1).toBe(1);\n});\n`,
		},
	},
	{
		name: "microtasks counted in a loop to let work settle",
		guard: "time-and-leaks",
		check: "microtask-count",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`it("settles", async () => {\n\tfor (let turn = 0; turn < 5; turn += 1) await Promise.resolve();\n\texpect(1).toBe(1);\n});`,
			),
		},
	},
	{
		name: "two awaited Promise.resolve calls in a row",
		guard: "time-and-leaks",
		check: "microtask-count",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`it("settles", async () => {\n\tawait Promise.resolve();\n\tawait Promise.resolve();\n\texpect(1).toBe(1);\n});`,
			),
		},
	},
	{
		name: "a temp folder made at module level with no cleanup",
		guard: "time-and-leaks",
		check: "module-level-temp",
		file: SIDECAR,
		count: 1,
		files: {
			[SIDECAR]: `import { expect, test } from "bun:test";\nimport { mkdtempSync } from "node:fs";\n\nconst folder = mkdtempSync("/tmp/sample-");\n\ntest("uses it", () => {\n\texpect(folder).toBeDefined();\n});\n`,
		},
	},
	{
		name: "a spy restored inside the test body",
		guard: "time-and-leaks",
		check: "restore-in-body",
		file: COMPONENT,
		count: 1,
		files: {
			[COMPONENT]: test(
				`it("logs", () => {\n\tconst log = vi.spyOn(console, "error").mockImplementation(() => {});\n\texpect(log).toBeDefined();\n\tlog.mockRestore();\n});`,
			),
		},
	},
	{
		name: "an id source that returns one constant",
		guard: "time-and-leaks",
		check: "constant-id",
		file: UNIT,
		count: 1,
		files: {
			[UNIT]: test(
				`const ids = { uuid: () => "id-1" };\n\nit("makes ids", () => {\n\texpect(ids.uuid()).toBe("id-1");\n});`,
			),
		},
	},
	{
		name: "a Rust test that hides a failed remove_dir_all",
		guard: "time-and-leaks",
		check: "silent-removal",
		file: RUST,
		count: 1,
		files: {
			[RUST]: `//! Sample.\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn cleans_up() {\n        let dir = make();\n        assert!(dir.exists());\n        std::fs::remove_dir_all(&dir).ok();\n    }\n}\n`,
		},
	},
];

/** Look-alikes that a guard must leave alone. Every one must produce no finding at all. */
export const CLEAN: Sample[] = [
	{
		name: "tests that assert, directly or through a helper in the file",
		files: {
			[UNIT]: test(
				`const expectValid = (value: number) => {\n\texpect(value).toBeGreaterThan(0);\n};\n\nit("asserts", () => {\n\texpect(1).toBe(1);\n});\n\nit("asserts through a helper", () => {\n\texpectValid(1);\n});`,
			),
		},
	},
	{
		name: "a Rust test with an assert, an unwrap, or a helper that asserts",
		files: {
			[RUST]: `//! Sample.\n#[cfg(test)]\nmod tests {\n    fn check(value: i32) {\n        assert_eq!(value, 2);\n    }\n\n    #[test]\n    fn asserts() {\n        assert_eq!(1 + 1, 2);\n    }\n\n    #[test]\n    fn unwraps() {\n        let _value = parse().unwrap();\n    }\n\n    #[test]\n    fn through_a_helper() {\n        check(2);\n    }\n\n    #[test]\n    fn compares_a_constant_with_a_result() {\n        assert_eq!(MAX_RETRIES, 3);\n        assert_eq!(retries(), 3);\n    }\n}\n`,
		},
	},
	{
		name: "a constant from another module, and a computed value against a literal",
		files: {
			[UNIT]: test(
				`import { compute } from "./thing.ts";\nimport { LIMIT } from "./other.ts";\n\nit("computes", () => {\n\texpect(compute()).toBe(5);\n\texpect(LIMIT).toBe(5);\n});`,
			),
		},
	},
	{
		name: "loops that prove the list is not empty first",
		files: {
			[UNIT]: test(
				`it("checks each item", () => {\n\tconst items = build();\n\texpect(items).toHaveLength(2);\n\tfor (const item of items) {\n\t\texpect(item.valid).toBe(true);\n\t}\n});\n\nit("checks a literal list", () => {\n\tfor (const item of [1, 2, 3]) {\n\t\texpect(item).toBeGreaterThan(0);\n\t}\n});\n\nit("finds a member first", () => {\n\tconst items = build();\n\texpect(items.some((item) => item.id === 1)).toBe(true);\n\texpect(items.every((item) => item.valid)).toBe(true);\n});`,
			),
		},
	},
	{
		name: "Rust loops that prove the list is not empty first",
		files: {
			[RUST]: `//! Sample.\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn checks_each_item() {\n        let items = build();\n        assert!(!items.is_empty());\n        for item in &items {\n            assert!(item.valid);\n        }\n    }\n\n    #[test]\n    fn checks_a_count() {\n        let items = build();\n        assert_eq!(items.len(), 2);\n        assert!(items.iter().all(|item| item.valid));\n    }\n}\n`,
		},
	},
	{
		name: "mocks of packages, of modules in other folders, and a mock with a seam comment",
		files: {
			[UNIT]: test(
				`vi.mock("node:fs");\nvi.mock("../other/place.ts", () => ({ place: 1 }));\n// seam: APP-01 the helper reads the real clock\nvi.mock("./helper.ts", () => ({ help: () => 1 }));\n\nit("computes", () => {\n\texpect(1).toBe(1);\n});`,
			),
			[COMPONENT]: test(
				`// seam: NAV-03 the hook needs a window\nvi.mock("../../core/hooks.ts", () => ({ useSetting: () => 1 }));\n\nit("renders", () => {\n\texpect(1).toBe(1);\n});`,
			),
		},
	},
	{
		name: "casts that are not a Container or a Deps type",
		files: {
			[UNIT]: test(
				`it("casts", () => {\n\tconst id = "w1" as WorkspaceId;\n\texpect(id).toBe("w1");\n});`,
			),
		},
	},
	{
		name: "a stand-in in the home with a contract test that exists",
		files: {
			[HOME_FAKES]: `/**\n * Fakes for tests.\n * Contract test: apps/desktop/src/test/fakes.contract.test.ts\n */\nexport class FakeApp {}\n`,
			"apps/desktop/src/test/fakes.contract.test.ts": test(
				`it("matches the real app", () => {\n\texpect(1).toBe(1);\n});`,
			),
		},
	},
	{
		name: "fake timers, a hang guard, a poll loop and a sleep helper",
		files: {
			[UNIT]: test(
				`it("uses fake timers", async () => {\n\tvi.useFakeTimers();\n\tawait new Promise((resolve) => setTimeout(resolve, 30));\n\texpect(1).toBe(1);\n});`,
			),
			[SIDECAR]: `import { expect, test } from "bun:test";\n\nconst sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));\n\nasync function waitFor(check: () => boolean): Promise<void> {\n\twhile (!check()) await new Promise<void>((resolve) => setTimeout(resolve, 0));\n}\n\ntest("guards against a hang", async () => {\n\tawait new Promise<void>((resolve, reject) => {\n\t\tconst guard = setTimeout(() => reject(new Error("hung")), 1000);\n\t\tclearTimeout(guard);\n\t\tresolve();\n\t});\n\tawait waitFor(() => true);\n\texpect(typeof sleep).toBe("function");\n});\n`,
		},
	},
	{
		name: "a temp folder that afterAll removes, restore in a finally block and in afterEach",
		files: {
			[SIDECAR]: `import { afterAll, expect, test } from "bun:test";\nimport { mkdtempSync, rmSync } from "node:fs";\n\nconst folder = mkdtempSync("/tmp/sample-");\n\nafterAll(() => {\n\trmSync(folder, { recursive: true, force: true });\n});\n\ntest("uses it", () => {\n\texpect(folder).toBeDefined();\n});\n`,
			[COMPONENT]: test(
				`it("restores in a finally block", () => {\n\tconst log = vi.spyOn(console, "error").mockImplementation(() => {});\n\ttry {\n\t\texpect(log).toBeDefined();\n\t} finally {\n\t\tlog.mockRestore();\n\t}\n});`,
			),
		},
	},
	{
		name: "an id source that counts, and a Rust test that checks its cleanup",
		files: {
			[UNIT]: test(
				`let next = 0;\nconst ids = { uuid: () => \`id-\${++next}\` };\n\nit("makes ids", () => {\n\texpect(ids.uuid()).not.toBe(ids.uuid());\n});`,
			),
			[RUST]: `//! Sample.\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn cleans_up() {\n        let dir = make();\n        assert!(dir.exists());\n        std::fs::remove_dir_all(&dir).expect("the folder goes away");\n    }\n}\n`,
		},
	},
];
