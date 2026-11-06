/**
 * The CI failure list must name every failed test by its file from the repository root, keep a
 * failure that no test case names, and never read a missing or broken report as a clean run.
 */
import { describe, expect, test } from "bun:test";
import {
	needsAttention,
	parseRunners,
	type RunnerResult,
	readJUnit,
	renderSummary,
} from "./test-report.ts";

const ROOT = "/repo";

/** The shape Vitest's JUnit reporter writes: one suite per file, describes joined into the name. */
const VITEST = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="4" failures="2" errors="0" time="1.2">
    <testsuite name="src/features/git-panel/git-panel.git-17.test.tsx" timestamp="2026-11-06T00:00:00.000Z" hostname="runner" tests="3" failures="1" errors="0" skipped="1" time="0.5">
        <testcase classname="src/features/git-panel/git-panel.git-17.test.tsx" name="GIT-17 panel &gt; shows a toast" time="0.1">
            <failure message="[vitest] No &quot;Toaster&quot; export is defined on the mock" type="Error">
Error: [vitest] No "Toaster" export is defined on the mock
 ❯ src/app/providers.tsx:40:5
            </failure>
        </testcase>
        <testcase classname="src/features/git-panel/git-panel.git-17.test.tsx" name="GIT-17 panel &gt; passes" time="0.01">
        </testcase>
        <testcase classname="src/features/git-panel/git-panel.git-17.test.tsx" name="GIT-17 panel &gt; later" time="0">
            <skipped/>
        </testcase>
    </testsuite>
    <testsuite name="src/app/broken.test.tsx" timestamp="2026-11-06T00:00:00.000Z" hostname="runner" tests="1" failures="1" errors="0" skipped="0" time="0">
        <testcase classname="src/app/broken.test.tsx" name="src/app/broken.test.tsx" time="0">
            <failure type="Error">
Error: Failed to load url ./missing.ts
            </failure>
        </testcase>
    </testsuite>
</testsuites>
`;

/** A runner that nests a suite per describe and puts the file on each element. */
const NESTED = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="2" failures="1" skipped="0">
  <testsuite name="src/session/turn.test.ts" file="src/session/turn.test.ts" tests="2" failures="1">
    <testsuite name="SIDE-04 turn" file="src/session/turn.test.ts" line="10" tests="2" failures="1">
      <testcase name="ends once" classname="SIDE-04 turn" file="src/session/turn.test.ts" line="11" />
      <testcase name="drops a late answer" classname="SIDE-04 turn" file="src/session/turn.test.ts" line="20">
        <failure type="AssertionError" />
      </testcase>
    </testsuite>
  </testsuite>
</testsuites>
`;

describe("reading a report", () => {
	test("a Vitest report names each failed test by its path from the root, with its first message line", () => {
		const read = readJUnit(VITEST, "apps/desktop", ROOT);
		expect(read.tests).toBe(4);
		expect(read.unnamed).toBe(0);
		expect(read.failed).toEqual([
			{
				file: "apps/desktop/src/features/git-panel/git-panel.git-17.test.tsx",
				title: "GIT-17 panel > shows a toast",
				message: '[vitest] No "Toaster" export is defined on the mock',
			},
			{
				file: "apps/desktop/src/app/broken.test.tsx",
				title: "src/app/broken.test.tsx",
				message: "Error: Failed to load url ./missing.ts",
			},
		]);
	});

	test("nested suites become the describe part of the title, and a bare failure keeps an empty message", () => {
		const read = readJUnit(NESTED, "packages/sidecar", ROOT);
		expect(read.tests).toBe(2);
		expect(read.failed).toEqual([
			{
				file: "packages/sidecar/src/session/turn.test.ts",
				title: "SIDE-04 turn > drops a late answer",
				message: "",
			},
		]);
	});

	test("an absolute file path is shown from the root, and scripts at the root keep their path", () => {
		const absolute = NESTED.replaceAll(
			'file="src/session/turn.test.ts"',
			'file="/repo/packages/sidecar/src/session/turn.test.ts"',
		);
		expect(readJUnit(absolute, "packages/sidecar", ROOT).failed[0]?.file).toBe(
			"packages/sidecar/src/session/turn.test.ts",
		);
		const scripts = NESTED.replaceAll("src/session/turn.test.ts", "scripts/release.test.ts");
		expect(readJUnit(scripts, ".", ROOT).failed[0]?.file).toBe("scripts/release.test.ts");
	});

	test("failures the totals count but no test case names are kept as unnamed", () => {
		const read = readJUnit(NESTED.replace('failures="1" skipped="0"', 'failures="3"'), ".", ROOT);
		expect(read.failed).toHaveLength(1);
		expect(read.unnamed).toBe(2);
	});

	test("a failure outside any test case is named after its suite", () => {
		const xml = `<testsuites failures="1"><testsuite name="src/a.test.ts"><error message="beforeAll threw"/></testsuite></testsuites>`;
		expect(readJUnit(xml, "packages/shared", ROOT).failed).toEqual([
			{
				file: "packages/shared/src/a.test.ts",
				title: "(outside any test)",
				message: "beforeAll threw",
			},
		]);
	});

	test("text that is not a JUnit report, or totals that are not counts, are refused", () => {
		expect(() => readJUnit("<html><body>502</body></html>", ".", ROOT)).toThrow("testsuites");
		expect(() => readJUnit('<testsuites failures="many"></testsuites>', ".", ROOT)).toThrow(
			"not counts",
		);
	});
});

describe("the summary", () => {
	const desktop: RunnerResult = { runner: "desktop", ...readJUnit(VITEST, "apps/desktop", ROOT) };
	const sidecar: RunnerResult = {
		runner: "sidecar",
		...readJUnit(NESTED, "packages/sidecar", ROOT),
	};

	test("lists every failed test under its file, files in order", () => {
		const text = renderSummary([sidecar, desktop]);
		expect(text.split("\n")[0]).toBe("## Tests: 3 failed in 3 files");
		const files = text.split("\n").filter((line) => line.startsWith("### "));
		expect(files).toEqual([
			"### apps/desktop/src/app/broken.test.tsx",
			"### apps/desktop/src/features/git-panel/git-panel.git-17.test.tsx",
			"### packages/sidecar/src/session/turn.test.ts",
		]);
		expect(text).toContain(
			'- GIT-17 panel > shows a toast: [vitest] No "Toaster" export is defined on the mock',
		);
		expect(text).toContain("- SIDE-04 turn > drops a late answer\n");
		expect(needsAttention([sidecar, desktop])).toBe(true);
	});

	test("a missing report is named and needs attention even when every other runner passed", () => {
		const clean: RunnerResult = { runner: "shared", tests: 5, failed: [], unnamed: 0 };
		const missing: RunnerResult = { runner: "protocol", problem: "protocol.xml was not written" };
		const text = renderSummary([clean, missing]);
		expect(text).toContain("No usable report from protocol: protocol.xml was not written");
		expect(needsAttention([clean, missing])).toBe(true);
		expect(needsAttention([clean])).toBe(false);
		expect(text.split("\n")[0]).toBe("## Tests: 0 failed, and 1 report missing or unreadable");
		expect(renderSummary([clean])).toBe("## Tests: 5 ran in 1 report, none failed\n");
	});

	test("unnamed failures are reported with their runner", () => {
		const result: RunnerResult = { runner: "sidecar", tests: 2, failed: [], unnamed: 2 };
		const text = renderSummary([result]);
		expect(text.split("\n")[0]).toBe("## Tests: 2 failed");
		expect(text).toContain("The sidecar report counts 2 more failure(s) that no test names");
		expect(needsAttention([result])).toBe(true);
	});
});

test("runners are named with the folder their paths start from", () => {
	expect(parseRunners(["desktop=apps/desktop", "scripts=."])).toEqual([
		{ name: "desktop", folder: "apps/desktop" },
		{ name: "scripts", folder: "." },
	]);
	expect(() => parseRunners(["desktop"])).toThrow("is not <runner>=<folder>");
});
