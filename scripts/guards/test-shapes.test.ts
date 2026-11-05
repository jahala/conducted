/**
 * The test-shapes guards must flag every planted sample, leave every look-alike alone, and hold
 * the baseline rule (D055): a count may not rise, and a baseline above the real count fails. Each
 * test builds its fixture tree in a temp folder it owns and removes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	BASELINE_PATH,
	checkMockingTheThing,
	checkStandInHome,
	checkTestsCannotFail,
	checkTimeAndLeaks,
	compareWithBaseline,
	countFindings,
	renderBaseline,
	scanTestShapes,
	type Violation,
	writeBaseline,
} from "./test-shapes.ts";
import { CLEAN, PLANTED, type Sample } from "./test-shapes-samples.ts";

let root = "";
const put = (path: string, text: string) => {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), text);
};
const plant = (sample: Sample) => {
	for (const [path, text] of Object.entries(sample.files)) put(path, text);
};

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "test-shapes-"));
});
afterEach(() => {
	// The test made this folder, so it removes it.
	rmSync(root, { recursive: true, force: true });
});

describe("planted samples", () => {
	for (const sample of PLANTED) {
		test(`flags ${sample.name}`, async () => {
			plant(sample);
			const found = await scanTestShapes(root);
			const hits = found.filter(
				(item) =>
					item.guard === sample.guard && item.check === sample.check && item.file === sample.file,
			);
			expect(hits).toHaveLength(sample.count);
			// The sample plants one shape, so nothing else may fire on it.
			expect(found.filter((item) => !hits.includes(item))).toEqual([]);
		});
	}

	test("every guard has at least one planted sample", () => {
		const guards = new Set(PLANTED.map((sample) => sample.guard));
		expect([...guards].sort()).toEqual([
			"mocking-the-thing",
			"stand-in-home",
			"tests-cannot-fail",
			"time-and-leaks",
		]);
	});
});

describe("look-alikes", () => {
	for (const sample of CLEAN) {
		test(`leaves alone ${sample.name}`, async () => {
			plant(sample);
			expect(await scanTestShapes(root)).toEqual([]);
		});
	}
});

describe("the baseline", () => {
	const violation = (file: string, guard: Violation["guard"] = "time-and-leaks"): Violation => ({
		guard,
		check: "real-time",
		file,
		line: 1,
		message: "waits",
	});

	test("counts per guard and file, sorted whatever the order of findings", () => {
		const forward = countFindings([
			violation("b.test.ts"),
			violation("a.test.ts"),
			violation("a.test.ts"),
		]);
		const backward = countFindings([
			violation("a.test.ts"),
			violation("a.test.ts"),
			violation("b.test.ts"),
		]);
		expect(renderBaseline(forward)).toBe(renderBaseline(backward));
		expect(Object.entries(forward["time-and-leaks"])).toEqual([
			["a.test.ts", 2],
			["b.test.ts", 1],
		]);
	});

	test("passes when the count equals the baseline", () => {
		expect(
			compareWithBaseline("time-and-leaks", [violation("a.test.ts")], { "a.test.ts": 1 }),
		).toEqual([]);
	});

	test("fails when a file's count rises, and names the site", () => {
		const problems = compareWithBaseline(
			"time-and-leaks",
			[violation("a.test.ts"), violation("a.test.ts")],
			{
				"a.test.ts": 1,
			},
		);
		expect(problems).toHaveLength(1);
		expect(problems[0]?.message).toContain("a.test.ts:1");
		expect(problems[0]?.message).toContain("baseline allows 1");
	});

	test("fails when a file is new and the baseline does not list it", () => {
		expect(compareWithBaseline("time-and-leaks", [violation("new.test.ts")], {})).toHaveLength(1);
	});

	test("fails when the baseline is higher than the real count, including a file with none left", () => {
		const problems = compareWithBaseline("time-and-leaks", [violation("a.test.ts")], {
			"a.test.ts": 3,
			"gone.test.ts": 1,
		});
		expect(problems.map((problem) => problem.message).join("\n")).toContain("baseline says 3");
		expect(problems.map((problem) => problem.message).join("\n")).toContain("baseline says 1");
	});

	test("ignores findings of the other guards", () => {
		expect(
			compareWithBaseline("time-and-leaks", [violation("a.test.ts", "mocking-the-thing")], {}),
		).toEqual([]);
	});
});

describe("the guards end to end", () => {
	const guards = [checkTestsCannotFail, checkMockingTheThing, checkStandInHome, checkTimeAndLeaks];
	const sample = PLANTED.find((item) => item.check === "real-time" && item.file.endsWith(".ts"));

	test("a violation with no baseline fails the guard that owns it, and only that one", async () => {
		if (sample === undefined) throw new Error("no real-time sample");
		plant(sample);
		const results = await Promise.all(guards.map((check) => check(root)));
		expect(results.map((problems) => problems.length)).toEqual([0, 0, 0, 1]);
	});

	test("the written baseline lets today's violations pass, and a new one fails", async () => {
		if (sample === undefined) throw new Error("no real-time sample");
		plant(sample);
		await writeBaseline(root);
		expect(await checkTimeAndLeaks(root)).toEqual([]);

		put(
			"apps/desktop/src/core/other.test.ts",
			`import { it } from "vitest";\n\nit("waits", async () => {\n\tawait new Promise((resolve) => setTimeout(resolve, 30));\n});\n`,
		);
		const problems = await checkTimeAndLeaks(root);
		expect(problems).toHaveLength(1);
		expect(problems[0]?.message).toContain("other.test.ts");
	});

	test("a fix that leaves the baseline too high fails until the baseline is lowered", async () => {
		if (sample === undefined) throw new Error("no real-time sample");
		plant(sample);
		await writeBaseline(root);
		// The fixed test still asserts, so the fix adds no other finding the writer would refuse.
		put(
			sample.file,
			`import { expect, it } from "vitest";\n\nit("is fixed", () => {\n\texpect(Number("2")).toBe(2);\n});\n`,
		);
		const problems = await checkTimeAndLeaks(root);
		expect(problems).toHaveLength(1);
		expect(problems[0]?.message).toContain("baseline says 1");

		await writeBaseline(root);
		expect(await checkTimeAndLeaks(root)).toEqual([]);
	});

	test("a regeneration that would raise a count is refused and names the rise (D055)", async () => {
		if (sample === undefined) throw new Error("no real-time sample");
		plant(sample);
		expect(await writeBaseline(root)).toEqual([]);
		const before = readFileSync(join(root, BASELINE_PATH), "utf8");
		put(
			"apps/desktop/src/core/other.test.ts",
			`import { it } from "vitest";\n\nit("waits", async () => {\n\tawait new Promise((resolve) => setTimeout(resolve, 30));\n});\n`,
		);
		const raised = await writeBaseline(root);
		expect(raised).toHaveLength(1);
		expect(raised[0]).toContain("apps/desktop/src/core/other.test.ts 0 -> 1");
		expect(readFileSync(join(root, BASELINE_PATH), "utf8")).toBe(before);
	});

	test("writing the baseline twice gives the same bytes", async () => {
		for (const item of PLANTED) plant(item);
		await writeBaseline(root);
		const first = readFileSync(join(root, BASELINE_PATH), "utf8");
		await writeBaseline(root);
		expect(readFileSync(join(root, BASELINE_PATH), "utf8")).toBe(first);
	});

	test("an unreadable baseline is reported, not thrown", async () => {
		put(BASELINE_PATH, "{ not json");
		const problems = await checkTimeAndLeaks(root);
		expect(problems).toHaveLength(1);
		expect(problems[0]?.message).toContain("cannot be read");
	});
});
