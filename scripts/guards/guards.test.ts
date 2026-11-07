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
import { checkLifetimeLimits } from "./lifetime-limits.ts";
import { checkLocalStorageKeys } from "./local-storage-keys.ts";
import { checkMigrations } from "./migrations.ts";
import { checkModuleState } from "./module-state.ts";
import { checkSettingsKeys } from "./settings-keys.ts";
import { checkSidecarEdges } from "./sidecar-edges.ts";
import { checkSite } from "./site.ts";
import { checkHeaders, checkMarkers, checkOurName } from "./source-rules.ts";
import { checkTestScripts } from "./test-scripts.ts";
import { checkVersions, setVersion } from "./versions.ts";
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

	test("flags a link to this repository on GitHub that names a missing path", () => {
		put("docs/architecture.md", "");
		put(
			"README.md",
			[
				"[Architecture](https://github.com/jahala/conducted/blob/main/docs/architecture.md)",
				"[Gone](https://github.com/jahala/conducted/tree/main/docs/gone)",
				"[Releases](https://github.com/jahala/conducted/releases)",
				"![Screen](docs/site/images/missing.png)",
			].join("\n"),
		);
		const messages = checkDocs(root).map((p) => p.message);
		expect(messages).toEqual([
			"README.md names docs/gone, which does not exist",
			"README.md names docs/site/images/missing.png, which does not exist",
		]);
	});

	test("flags an HTML image in a doc whose file does not exist", () => {
		put("docs/site/images/home-light.png", "png");
		put(
			"README.md",
			'<picture><source srcset="docs/site/images/home-dark.png" media="(prefers-color-scheme: dark)"><img src="docs/site/images/home-light.png" alt=""></picture>\n',
		);
		expect(checkDocs(root).map((p) => p.message)).toEqual([
			"README.md names docs/site/images/home-dark.png, which does not exist",
		]);
	});

	test("flags a brief over its line bound", () => {
		put("CLAUDE.md", "line\n".repeat(200));
		expect(checkDocs(root).some((p) => p.message.startsWith("CLAUDE.md has"))).toBe(true);
	});
});

describe("site", () => {
	const plantSite = (index: string) => {
		put("docs/site/index.html", index);
		put("docs/site/changelog.html", '<link href="../style.css"><!-- site:releases -->');
		put("docs/site/style.css", "body { font-family: Geist; }");
		put("docs/site/images/home.png", "png");
		put("CHANGELOG.md", "# Changelog\n");
		for (const name of ["Geist-Variable.woff2", "GeistMono-Variable.woff2", "OFL.txt"]) {
			put(`apps/desktop/src/assets/fonts/${name}`, "font");
		}
		put("docs/architecture.md", "");
		put("README.md", "# Conducted\n\n### Build from source\n");
	};

	test("passes a site whose every link resolves", () => {
		plantSite(
			'<link href="style.css"><img src="images/home.png"><a href="changelog/">Changelog</a><a href="https://github.com/jahala/conducted/blob/main/docs/architecture.md">Docs</a><!-- site:download --><!-- site:recent-releases -->',
		);
		expect(checkSite(root)).toEqual([]);
	});

	test("flags a missing image and a repository path that does not exist", () => {
		plantSite(
			'<link href="style.css"><img src="images/home.png"><img src="images/gone.png"><a href="https://github.com/jahala/conducted/blob/main/docs/gone.md">Gone</a><!-- site:download --><!-- site:recent-releases -->',
		);
		expect(checkSite(root).map((p) => p.message)).toEqual([
			"index.html links to images/gone.png, which the site does not have",
			"the site links to docs/gone.md on GitHub, which does not exist",
		]);
	});

	test("flags a link to a README heading that does not exist", () => {
		plantSite(
			'<link href="style.css"><img src="images/home.png"><a href="https://github.com/jahala/conducted#build-from-source">Build</a><a href="https://github.com/jahala/conducted#install">Install</a><!-- site:download --><!-- site:recent-releases -->',
		);
		put("README.md", "# Conducted\n\n## Install\n\n### Build from source\n");
		expect(checkSite(root)).toEqual([]);
		put("README.md", "# Conducted\n\n## Install\n");
		expect(checkSite(root).map((p) => p.message)).toEqual([
			"the site links to README.md#build-from-source, which has no such heading",
		]);
	});

	test("flags a site that cannot be built", () => {
		expect(checkSite(root).map((p) => p.message)).toContain(
			"docs/site/index.html is missing; the site needs it",
		);
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
			"name: CI\non: push\njobs:\n  fast:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n    steps:\n      - run: echo ok\n  slow:\n    runs-on: macos-latest\n    steps:\n      - run: echo ok\n",
		);
		expect(checkWorkflows(root).map((p) => p.message)).toEqual([
			".github/workflows/ci.yml: job slow has no timeout-minutes",
		]);
	});

	test("flags a workflow that is not valid YAML or has an invalid job", () => {
		put(
			".github/workflows/broken.yml",
			"name: Broken\non: push\njobs:\n  broken:\n    runs-on: [\n",
		);
		expect(checkWorkflows(root).some((p) => p.message.includes("broken.yml"))).toBe(true);
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

describe("our name", () => {
	test("flags Conductor's name in a product string, never in a comment or a test", () => {
		put(
			"apps/desktop/src/core/a.ts",
			'/** Reads the settings, as Conductor does. */\nexport const m = "Conductor could not connect.";\n',
		);
		put(
			"apps/desktop/src/features/b.tsx",
			"/** b */\n// Conductor's layout.\nexport const B = () => (\n\t<p>\n\t\t{/* Conductor's order:\n\t\tthe sound first. */}\n\t\tSaved in Conductor\n\t</p>\n);\n",
		);
		put(
			"packages/c/src/c.ts",
			'/** c */\nexport const url = "https://conductor.build"; // Conductor\'s site\n',
		);
		put("apps/desktop/src/core/a.test.ts", 'const text = "Conductor";\n');
		put("apps/desktop/src-tauri/src/d.rs", '//! d\nconst M: &str = "Open in Conductor";\n');
		const messages = checkOurName(root).map((p) => p.message);
		expect(messages).toEqual([
			"apps/desktop/src-tauri/src/d.rs:2 names Conductor in a product string; our app is Conducted",
			"apps/desktop/src/core/a.ts:2 names Conductor in a product string; our app is Conducted",
			"apps/desktop/src/features/b.tsx:7 names Conductor in a product string; our app is Conducted",
		]);
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
		put("apps/cloud/sandbox/image.ts", 'export const IMAGE = {\n\tappVersion: "0.2.0",\n};\n');
		put("apps/cloud/sandbox/Dockerfile", "FROM node\nENV CONDUCTED_APP_VERSION=0.2.0\n");
		const messages = checkVersions(root).map((p) => p.message);
		expect(messages).toEqual([
			"apps/desktop/src-tauri/Cargo.toml has version 0.1.0, expected 0.2.0",
		]);
	});

	test("flags the sandbox image when it still names the last release's version", () => {
		put("package.json", '{"version":"0.3.0"}');
		put("apps/desktop/package.json", '{"version":"0.3.0"}');
		put("apps/desktop/src-tauri/tauri.conf.json", '{"version":"0.3.0"}');
		put("apps/desktop/src-tauri/Cargo.toml", '[package]\nname = "conducted"\nversion = "0.3.0"\n');
		put(
			"apps/desktop/src-tauri/Cargo.lock",
			'[[package]]\nname = "conducted"\nversion = "0.3.0"\n',
		);
		put("apps/cloud/sandbox/image.ts", 'export const IMAGE = {\n\tappVersion: "0.2.1",\n};\n');
		put("apps/cloud/sandbox/Dockerfile", "FROM node\nENV CONDUCTED_APP_VERSION=0.2.1\n");
		const messages = checkVersions(root).map((p) => p.message);
		expect(messages).toEqual([
			"apps/cloud/sandbox/image.ts has version 0.2.1, expected 0.3.0",
			"apps/cloud/sandbox/Dockerfile has version 0.2.1, expected 0.3.0",
		]);
	});

	test("setVersion writes the version into the sandbox image's two copies", () => {
		expect(setVersion("apps/cloud/sandbox/image.ts", '\tappVersion: "0.2.1",\n', "0.3.1")).toBe(
			'\tappVersion: "0.3.1",\n',
		);
		expect(
			setVersion("apps/cloud/sandbox/Dockerfile", "ENV CONDUCTED_APP_VERSION=0.2.1\n", "0.3.1"),
		).toBe("ENV CONDUCTED_APP_VERSION=0.3.1\n");
	});
});

describe("module-state", () => {
	const doc = (rows: string[]) =>
		[
			"# Architecture",
			"",
			"### Module-level state",
			"",
			"| Kind | Where | Name | Why |",
			"| --- | --- | --- | --- |",
			...rows,
			"",
			"## Shared helpers",
			"",
		].join("\n");
	const zustand = (file: string, name: string) =>
		`| zustand store | \`${file}\` | \`${name}\` | the web view's own UI state |`;
	const rustStatic = (file: string, name: string) =>
		`| Rust static | \`${file}\` | \`${name}\` | a lock that serialises two threads |`;

	test("flags a new zustand store and a new Rust cache or lock", () => {
		put(
			"docs/architecture.md",
			doc([
				zustand("apps/desktop/src/ui/Toast.tsx", "useWorkspaceToastStore"),
				rustStatic("apps/desktop/src-tauri/src/terminal_history.rs", "CACHED_KEY"),
			]),
		);
		put(
			"apps/desktop/src/ui/Toast.tsx",
			"export const useWorkspaceToastStore = create<State>()(() => ({}));\n",
		);
		put(
			"apps/desktop/src/features/new/store.ts",
			"export const useNewStore = create<State>()(() => ({}));\n",
		);
		put(
			"apps/desktop/src-tauri/src/terminal_history.rs",
			"static CACHED_KEY: OnceLock<u8> = OnceLock::new();\n",
		);
		put(
			"apps/desktop/src-tauri/src/new_cache.rs",
			"static CACHE: OnceLock<u8> = OnceLock::new();\n",
		);
		const messages = checkModuleState(root).map((p) => p.message);
		expect(messages.some((m) => m.startsWith("apps/desktop/src/features/new/store.ts"))).toBe(true);
		expect(messages.some((m) => m.startsWith("apps/desktop/src-tauri/src/new_cache.rs"))).toBe(
			true,
		);
		expect(
			messages.some(
				(m) =>
					m.startsWith("apps/desktop/src/ui/Toast.tsx") ||
					m.startsWith("apps/desktop/src-tauri/src/terminal_history.rs"),
			),
		).toBe(false);
	});

	test("a store the doc names passes, even one an earlier copy did not", () => {
		put(
			"docs/architecture.md",
			doc([zustand("apps/desktop/src/features/doc-only/store.ts", "useDocOnlyStore")]),
		);
		put(
			"apps/desktop/src/features/doc-only/store.ts",
			"export const useDocOnlyStore = create<State>()(() => ({}));\n",
		);
		const messages = checkModuleState(root).map((p) => p.message);
		expect(messages.some((m) => m.startsWith("apps/desktop/src/features/doc-only/store.ts"))).toBe(
			false,
		);
	});

	test("a module the doc leaves out fails, even one an earlier copy allowed", () => {
		put(
			"docs/architecture.md",
			doc([zustand("apps/desktop/src/ui/Toast.tsx", "useWorkspaceToastStore")]),
		);
		put(
			"apps/desktop/src/app/overlay-store.ts",
			"export const useOverlayStore = create<State>()(() => ({}));\n",
		);
		const messages = checkModuleState(root).map((p) => p.message);
		expect(messages.some((m) => m.startsWith("apps/desktop/src/app/overlay-store.ts"))).toBe(true);
	});

	test("reports architecture.md when it has no module-level state table", () => {
		put("docs/architecture.md", "# Architecture\n");
		const messages = checkModuleState(root).map((p) => p.message);
		expect(messages.some((m) => m.includes("Module-level state"))).toBe(true);
	});
});

describe("sidecar-edges", () => {
	const doc = (rows: string[]) =>
		[
			"# Architecture",
			"",
			"### Sidecar I/O edges",
			"",
			"| Module | Why it is the edge |",
			"| --- | --- |",
			...rows,
			"",
			"## Shared helpers",
			"",
		].join("\n");

	test("flags an unnamed module that reads a file, and lets an adapter through", () => {
		put(
			"docs/architecture.md",
			doc(["| `packages/sidecar/src/util/read-text.ts` | the read-a-text-file helper |"]),
		);
		put(
			"packages/sidecar/src/new-thing.ts",
			'import { readFile } from "node:fs/promises";\nexport const x = readFile;\n',
		);
		put(
			"packages/sidecar/src/adapters/files.ts",
			'import { readFile } from "node:fs/promises";\nexport const x = readFile;\n',
		);
		put(
			"packages/sidecar/src/util/read-text.ts",
			'import { readFile } from "node:fs/promises";\nexport const x = readFile;\n',
		);
		put("packages/sidecar/src/note.ts", "/** Uses Bun.spawn. */\nexport const x = 1;\n");
		const messages = checkSidecarEdges(root).map((p) => p.message);
		expect(messages.some((m) => m.startsWith("packages/sidecar/src/new-thing.ts"))).toBe(true);
		expect(messages.some((m) => m.startsWith("packages/sidecar/src/note.ts"))).toBe(false);
		expect(messages.some((m) => m.startsWith("packages/sidecar/src/adapters/files.ts"))).toBe(
			false,
		);
		expect(messages.some((m) => m.startsWith("packages/sidecar/src/util/read-text.ts"))).toBe(
			false,
		);
	});

	test("a module the table names passes, even one an earlier copy did not", () => {
		put(
			"docs/architecture.md",
			doc(["| `packages/sidecar/src/doc-only.ts` | the edge the doc names |"]),
		);
		put(
			"packages/sidecar/src/doc-only.ts",
			'import { readFile } from "node:fs/promises";\nexport const x = readFile;\n',
		);
		const messages = checkSidecarEdges(root).map((p) => p.message);
		expect(messages.some((m) => m.startsWith("packages/sidecar/src/doc-only.ts"))).toBe(false);
	});

	test("a module the table leaves out fails, even one an earlier copy allowed", () => {
		put(
			"docs/architecture.md",
			doc(["| `packages/sidecar/src/doc-only.ts` | the edge the doc names |"]),
		);
		put(
			"packages/sidecar/src/util/read-text.ts",
			'import { readFile } from "node:fs/promises";\nexport const x = readFile;\n',
		);
		const messages = checkSidecarEdges(root).map((p) => p.message);
		expect(messages.some((m) => m.startsWith("packages/sidecar/src/util/read-text.ts"))).toBe(true);
	});

	test("reports architecture.md when it has no sidecar edges table", () => {
		put("docs/architecture.md", "# Architecture\n");
		const messages = checkSidecarEdges(root).map((p) => p.message);
		expect(messages.some((m) => m.includes("Sidecar I/O edges"))).toBe(true);
	});
});

describe("lifetime-limits", () => {
	const CONTAINER = "apps/desktop/src/core/container.ts";
	const REGISTRY = "apps/desktop/src/core/registries/settings.ts";

	test("flags a settings key for a lifetime limit and a container that stops passing the defaults", () => {
		put(REGISTRY, 'const SETTINGS = [{ key: "tool_output_max_bytes" }];\n');
		put(CONTAINER, "const limits = settings.value;\n");
		const messages = checkLifetimeLimits(root).map((p) => p.message);
		expect(messages.some((m) => m.includes("tool_output_max_bytes"))).toBe(true);
		expect(messages.some((m) => m.includes("DEFAULT_LIFETIME_LIMITS"))).toBe(true);
	});

	test("passes when no setting names a limit and the container passes the defaults", () => {
		put(REGISTRY, 'const SETTINGS = [{ key: "terminal_scrollback_limit_bytes" }];\n');
		put(CONTAINER, "run({ limits: DEFAULT_LIFETIME_LIMITS });\n");
		expect(checkLifetimeLimits(root)).toEqual([]);
	});
});

describe("settings-keys", () => {
	test("flags a bookkeeping key the data model does not name", () => {
		put("docs/data-model.md", "# Data\n\nThe key `data_lifetime_last_run_at`.\n");
		put(
			"apps/desktop/src/core/db/lifetime.ts",
			'export const LIFETIME_LAST_RUN_KEY = "data_lifetime_last_run_at";\n',
		);
		put("apps/desktop/src/core/db/extra.ts", 'export const EXTRA_KEY = "conducted_extra";\n');
		const messages = checkSettingsKeys(root).map((p) => p.message);
		expect(messages.some((m) => m.includes("conducted_extra"))).toBe(true);
		expect(messages.some((m) => m.includes("data_lifetime_last_run_at"))).toBe(false);
	});
});

describe("local-storage-keys", () => {
	test("flags a key the data model does not name and ignores a comment", () => {
		put("docs/data-model.md", "# Data\n\nKey `conducted.panel-layout:`.\n");
		put(
			"apps/desktop/src/app/layout-persistence.ts",
			'const STORAGE_PREFIX = "conducted.panel-layout:";\n',
		);
		put("apps/desktop/src/app/new-key.ts", 'const KEY = "conducted.new-key";\n');
		put(
			"apps/desktop/src/app/note.ts",
			"/** Uses `conducted.not-a-key`. */\nexport const x = 1;\n",
		);
		const messages = checkLocalStorageKeys(root).map((p) => p.message);
		expect(messages.some((m) => m.includes("conducted.new-key"))).toBe(true);
		expect(messages.some((m) => m.includes("conducted.panel-layout"))).toBe(false);
		expect(messages.some((m) => m.includes("conducted.not-a-key"))).toBe(false);
	});
});
