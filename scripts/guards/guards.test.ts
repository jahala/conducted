/**
 * Each guard must catch the break it exists for. These tests build a small sample repo in the
 * run's temp folder, plant one problem, and assert the guard reports it, and that the clean sample
 * passes.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkDataModel, renderTables } from "./data-model.ts";
import { checkDocs } from "./docs.ts";
import { compareHeaderClaims, countHeaderClaims, findHeaderClaims } from "./header-claims.ts";
import { placeholdersIn } from "./lib.ts";
import { checkMigrations } from "./migrations.ts";
import { checkHeaders, checkMarkers } from "./source-rules.ts";
import { checkTestScripts } from "./test-scripts.ts";
import { checkVersions } from "./versions.ts";
import { checkWorkflows } from "./workflows.ts";

let root = "";
const put = (path: string, text: string) => {
	mkdirSync(dirname(join(root, path)), { recursive: true });
	writeFileSync(join(root, path), text);
};

const SQL = `-- Things. Lifetime: forever.
CREATE TABLE things (id TEXT);
`;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "guards-"));
});
afterEach(() => {
	// The test made this folder, so it removes it.
	rmSync(root, { recursive: true, force: true });
});

describe("data-model", () => {
	test("flags a table without a lifetime, and a stale doc", () => {
		put("apps/desktop/src-tauri/migrations/0001_init.sql", "CREATE TABLE things (id TEXT);\n");
		put("docs/data-model.md", "<!-- generated:tables -->\n<!-- /generated:tables -->\n");
		const messages = checkDataModel(root).map((p) => p.message);
		expect(messages.some((m) => m.includes('no "Lifetime:"'))).toBe(true);
		expect(messages.some((m) => m.includes("out of date"))).toBe(true);
	});

	test("passes when every table has a lifetime and the doc is current", () => {
		put("apps/desktop/src-tauri/migrations/0001_init.sql", SQL);
		const table = renderTables([
			{ name: "things", migration: "0001_init.sql", summary: "Things.", lifetime: "forever." },
		]);
		put("docs/data-model.md", `# Data\n\n${table}\n`);
		expect(checkDataModel(root)).toEqual([]);
	});
});

describe("data-model table syntax", () => {
	test("a lowercase, quoted or IF NOT EXISTS table is still checked for a lifetime", () => {
		put(
			"apps/desktop/src-tauri/migrations/0001_init.sql",
			[
				"create table lower_one (id TEXT);",
				'CREATE TABLE IF NOT EXISTS "quoted_one" (id TEXT);',
				"  CREATE VIRTUAL TABLE fts_one USING fts5(body);",
			].join("\n"),
		);
		put("docs/data-model.md", "<!-- generated:tables -->\n<!-- /generated:tables -->\n");
		const messages = checkDataModel(root).map((p) => p.message);
		for (const name of ["lower_one", "quoted_one", "fts_one"]) {
			expect(messages.some((m) => m.startsWith(`table ${name} `))).toBe(true);
		}
		expect(messages.some((m) => m.startsWith("table IF "))).toBe(false);
	});
});

describe("migrations", () => {
	test("flags an edited locked migration and an unlocked new one", () => {
		put("apps/desktop/src-tauri/migrations/0001_init.sql", SQL);
		put("apps/desktop/src-tauri/migrations/0002_more.sql", SQL);
		put("apps/desktop/src-tauri/migrations/migrations.lock", `${"0".repeat(64)}  0001_init.sql\n`);
		const messages = checkMigrations(root).map((p) => p.message);
		expect(messages.some((m) => m.startsWith("0001_init.sql was edited"))).toBe(true);
		expect(messages.some((m) => m.startsWith("0002_more.sql is not in"))).toBe(true);
	});
});

describe("docs", () => {
	test("flags a link and a backticked path that do not exist", () => {
		put("packages/real/file.ts", "");
		put(
			"docs/guide.md",
			"See [the plan](plans/missing.md), `packages/real/file.ts` and `packages/gone.ts`.\n",
		);
		const messages = checkDocs(root).map((p) => p.message);
		expect(messages).toContain("docs/guide.md names docs/plans/missing.md, which does not exist");
		expect(messages).toContain("docs/guide.md names packages/gone.ts, which does not exist");
		expect(messages.some((m) => m.includes("packages/real/file.ts"))).toBe(false);
	});

	test("flags a brief over its line bound", () => {
		put("CLAUDE.md", "line\n".repeat(200));
		expect(checkDocs(root).some((p) => p.message.startsWith("CLAUDE.md has"))).toBe(true);
	});
});

describe("headers", () => {
	test("flags a file without a header and a placeholder without @feature", () => {
		put("packages/a/src/bare.ts", "export const x = 1;\n");
		put(
			"packages/a/src/stub.ts",
			'/** Something. */\nimport { notImplemented } from "x";\nexport const f = () => notImplemented("CHAT-01");\n',
		);
		put("packages/a/src/good.ts", "/**\n * @feature CHAT-01 Good\n */\nexport const y = 2;\n");
		const messages = checkHeaders(root).map((p) => p.message);
		expect(messages).toContain("packages/a/src/bare.ts has no header comment");
		expect(messages).toContain(
			"packages/a/src/stub.ts has placeholders but its header names no @feature",
		);
		expect(messages.some((m) => m.includes("good.ts"))).toBe(false);
	});
});

describe("headers in nested scripts", () => {
	test("flags a script in a sub-folder of scripts/ without a header", () => {
		put("scripts/overnight/bare.ts", "export const x = 1;\n");
		put("scripts/overnight/good.ts", "/** Does a thing. */\nexport const y = 2;\n");
		const messages = checkHeaders(root).map((p) => p.message);
		expect(messages).toContain("scripts/overnight/bare.ts has no header comment");
		expect(messages.some((m) => m.includes("good.ts"))).toBe(false);
	});
});

describe("header claims", () => {
	const backlog = "| ID | Feature |\n| --- | --- |\n| CHAT-01 | One |\n";

	test("flags an unknown @feature, a missing owned name and a Test first with no test", () => {
		put("docs/plans/backlog.md", backlog);
		put(
			"packages/a/src/good.ts",
			"/**\n * @feature CHAT-01 One\n * Owns: the parser, `parseThing`.\n * Test first: a thing parses to a value.\n */\nexport function parseThing(): number {\n\treturn 1;\n}\n",
		);
		put(
			"packages/a/src/good.test.ts",
			'/** Tests the parser. */\ntest("a thing parses to a value", () => {});\n',
		);
		put(
			"packages/a/src/plain.ts",
			"/**\n * @feature catalogue A state\n * Owns: values only.\n * Test first: not applicable; it holds values only.\n */\nexport const value = 1;\n",
		);
		put(
			"packages/a/src/bad.ts",
			"/**\n * @feature NOPE-99 Gone\n * Owns: `missingThing`.\n * Test first: a witness that no test names.\n */\nexport const other = 1;\n",
		);
		const findings = findHeaderClaims(root);
		expect(findings.map((finding) => finding.message)).toEqual([
			"@feature NOPE-99 is not a backlog row",
			"Owns names missingThing, which is not in the file",
			"Test first names no test: a witness that no test names.",
		]);
		expect(findings.some((finding) => finding.file.includes("good.ts"))).toBe(false);
	});

	test("a baseline that sits above the real count is reported, so it must shrink", () => {
		put("docs/plans/backlog.md", backlog);
		put(
			"packages/a/src/bad.ts",
			"/**\n * @feature NOPE-99 Gone\n * Owns: `missingThing`.\n */\nexport const other = 1;\n",
		);
		const found = findHeaderClaims(root);
		const baseline = countHeaderClaims(found);
		baseline["owned-name"]["packages/a/src/bad.ts"] = 3;
		const problems = compareHeaderClaims(found, baseline);
		expect(
			problems.some((problem) =>
				problem.message.includes("has 1 owned-name findings but the baseline says 3"),
			),
		).toBe(true);
	});
});

describe("placeholders", () => {
	test("all three spellings are found, with their ids", () => {
		const text =
			'notImplemented("CHAT-03");\nnot_implemented!("PLAT-04")\nnot_implemented "SIDE-01"';
		expect(placeholdersIn(text)).toEqual(["CHAT-03", "PLAT-04", "SIDE-01"]);
		expect(placeholdersIn('notImplemented("not an id")')).toEqual([]);
	});
});

describe("test-scripts", () => {
	const manifest = (scripts: Record<string, string>) => JSON.stringify({ scripts });

	test("flags a test script that passes with no tests, and tests nothing runs", () => {
		put("apps/a/package.json", manifest({ test: "vitest run --passWithNoTests" }));
		put("packages/b/package.json", manifest({}));
		put("packages/b/src/b.test.ts", "");
		put("packages/c/package.json", manifest({ test: "bun test" }));
		put("packages/c/src/c.test.ts", "");
		put("packages/d/package.json", manifest({}));
		const messages = checkTestScripts(root).map((p) => p.message);
		expect(messages).toEqual([
			"apps/a/package.json has a test script that passes when no tests are found",
			'packages/b/package.json has test files but no "test" script, so nothing runs them',
		]);
	});
});

describe("workflows", () => {
	test("flags a job without a timeout and passes one with it", () => {
		put(
			".github/workflows/ci.yml",
			"name: CI\non: push\njobs:\n  fast:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps: []\n  slow:\n    runs-on: macos-latest\n    steps: []\n",
		);
		expect(checkWorkflows(root).map((p) => p.message)).toEqual([
			".github/workflows/ci.yml: job slow has no timeout-minutes",
		]);
	});
});

describe("markers", () => {
	test("flags TODO comments, todo! in Rust and rm in scripts", () => {
		put("packages/a/src/x.ts", "/** x */\n// TODO later\n");
		put("apps/b/src/y.rs", "//! y\nfn f() { todo!() }\n");
		put("bin/z.sh", '#!/usr/bin/env bash\n# z\nrm -rf "$dir"\n');
		put(
			"bin/ok.sh",
			'#!/usr/bin/env bash\n# Moves files to the Trash, never deletes.\ntrash "$dir"\n',
		);
		const messages = checkMarkers(root).map((p) => p.message);
		expect(messages.some((m) => m.startsWith("packages/a/src/x.ts:2"))).toBe(true);
		expect(messages.some((m) => m.startsWith("apps/b/src/y.rs:2"))).toBe(true);
		expect(messages.some((m) => m.startsWith("bin/z.sh:3"))).toBe(true);
		expect(messages.some((m) => m.startsWith("bin/ok.sh"))).toBe(false);
	});
});

describe("versions", () => {
	test("flags a version file that disagrees", () => {
		put("package.json", '{"version":"0.2.0"}');
		put("apps/desktop/package.json", '{"version":"0.2.0"}');
		put("apps/desktop/src-tauri/tauri.conf.json", '{"version":"0.2.0"}');
		put("apps/desktop/src-tauri/Cargo.toml", '[package]\nname = "conducted"\nversion = "0.1.0"\n');
		put(
			"apps/desktop/src-tauri/Cargo.lock",
			'[[package]]\nname = "conducted"\nversion = "0.2.0"\n',
		);
		const messages = checkVersions(root).map((p) => p.message);
		expect(messages).toEqual([
			"apps/desktop/src-tauri/Cargo.toml has version 0.1.0, expected 0.2.0",
		]);
	});
});
