/**
 * The third-party notices (issue #577, D148): how entries are written, how the guard tells a
 * committed file from what ships, and what the collection finds in this repository. The last
 * block reads the real pnpm and Cargo data, so it shows the shipped set is the one the file lists.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { collectAll, runCommand } from "./collect.ts";
import {
	entriesIn,
	entryKey,
	NOT_DECLARED,
	type NoticeEntry,
	noticesProblems,
	renderNotices,
	textId,
} from "./notices.ts";

const ROOT = join(import.meta.dir, "../..");
const FILE = "apps/desktop/src-tauri/THIRD-PARTY-NOTICES.txt";
const APACHE = "Apache License\nVersion 2.0, January 2004\n";

const zod: NoticeEntry = {
	ecosystem: "npm",
	name: "zod",
	version: "4.6.7",
	licence: "MIT",
	shipsIn: ["web UI", "sidecar"],
	files: [{ name: "LICENSE", text: "MIT License\r\n\r\nCopyright (c) Colin McDonnell\r\n\r\n" }],
};
const serde: NoticeEntry = {
	ecosystem: "cargo",
	name: "serde",
	version: "1.0.228",
	licence: "MIT OR Apache-2.0",
	shipsIn: ["app binary"],
	files: [
		{ name: "LICENSE-APACHE", text: APACHE },
		{ name: "LICENSE-MIT", text: "Copyright (c) David Tolnay\n" },
	],
};
const tokio: NoticeEntry = {
	ecosystem: "cargo",
	name: "tokio",
	version: "1.48.0",
	licence: "MIT",
	shipsIn: ["app binary"],
	files: [{ name: "LICENSE", text: APACHE }],
};
const bare: NoticeEntry = {
	ecosystem: "cargo",
	name: "objc2",
	version: "0.6.5",
	licence: NOT_DECLARED,
	shipsIn: ["app binary"],
	files: [],
};

describe("renderNotices", () => {
	test("writes each package with its licence, its parts and its files word for word", () => {
		const text = renderNotices([zod]);

		expect(text).toContain(
			"npm: zod 4.6.7\nLicence: MIT\nShips in: web UI, sidecar\n" +
				`${"-".repeat(80)}\nFile: LICENSE\n\nMIT License\n\nCopyright (c) Colin McDonnell\n`,
		);
		expect(text).toContain("- npm packages: 1\n- Rust crates: 0\n- Other software: 0\n");
	});

	test("says so when a package carries no licence file, and fills nothing in", () => {
		const text = renderNotices([bare]);

		expect(text).toContain(
			`cargo: objc2 0.6.5\nLicence: ${NOT_DECLARED}\nShips in: app binary\n${"-".repeat(80)}\nThe package carries no licence or notice file.\n`,
		);
	});

	test("gives a text two files carry once, at the end, and each file names it", () => {
		const text = renderNotices([serde, tokio]);
		const id = textId(APACHE.trimEnd());

		expect(text.split(APACHE.trimEnd()).length - 1).toBe(1);
		expect(text).toContain(
			`File: LICENSE-APACHE\n\nThe text is ${id} under "Shared licence texts"`,
		);
		expect(text).toContain(`File: LICENSE\n\nThe text is ${id} under "Shared licence texts"`);
		expect(text).toContain(`Text ${id}\n${"-".repeat(80)}\n${APACHE.trimEnd()}\n`);
		// A text only one file carries stays in its entry.
		expect(text).toContain("File: LICENSE-MIT\n\nCopyright (c) David Tolnay\n");
	});

	test("writes the same file whatever order the packages come in", () => {
		expect(renderNotices([tokio, zod, bare, serde])).toBe(renderNotices([serde, bare, zod, tokio]));
	});

	test("reads each entry back by its key", () => {
		const blocks = entriesIn(renderNotices([zod, serde, bare]));

		expect([...blocks.keys()].sort()).toEqual([
			"cargo objc2 0.6.5",
			"cargo serde 1.0.228",
			"npm zod 4.6.7",
		]);
	});
});

describe("noticesProblems", () => {
	const committed = renderNotices([zod, serde]);

	test("finds nothing when the file is what ships", () => {
		expect(noticesProblems(committed, [serde, zod], FILE)).toEqual([]);
	});

	test("names a package that ships but is not in the file", () => {
		expect(noticesProblems(committed, [zod, serde, tokio], FILE)).toEqual([
			`cargo tokio 1.48.0 ships but is not in ${FILE}.`,
			`Run \`bun scripts/notices/generate.ts\` and commit ${FILE}.`,
		]);
	});

	test("names a package the file lists that no longer ships", () => {
		expect(noticesProblems(committed, [zod], FILE)).toEqual([
			`cargo serde 1.0.228 is in ${FILE} but no longer ships.`,
			`Run \`bun scripts/notices/generate.ts\` and commit ${FILE}.`,
		]);
	});

	test("names a package whose licence files changed", () => {
		const relicensed = { ...zod, files: [{ name: "LICENSE", text: "ISC License\n" }] };

		expect(noticesProblems(committed, [relicensed, serde], FILE)).toEqual([
			"npm zod 4.6.7 has changed: its licence or files differ.",
			`Run \`bun scripts/notices/generate.ts\` and commit ${FILE}.`,
		]);
	});

	test("reports a missing file", () => {
		expect(noticesProblems(null, [zod], FILE)).toEqual([
			`${FILE} is missing.`,
			`Run \`bun scripts/notices/generate.ts\` and commit ${FILE}.`,
		]);
	});
});

describe("what this repository ships", () => {
	let entries: NoticeEntry[] = [];
	let keys = new Set<string>();

	beforeAll(() => {
		const collected = collectAll(ROOT, runCommand);
		if (!collected.ok) throw new Error(collected.error.message);
		entries = collected.value;
		keys = new Set(entries.map(entryKey));
	});

	const find = (ecosystem: string, name: string): NoticeEntry | undefined =>
		entries.find((entry) => entry.ecosystem === ecosystem && entry.name === name);

	test("the committed file is current, and fails once a dependency is added without it", () => {
		const committed = readFileSync(join(ROOT, FILE), "utf8");
		expect(noticesProblems(committed, entries, FILE)).toEqual([]);

		const added: NoticeEntry = {
			ecosystem: "npm",
			name: "left-pad",
			version: "1.3.0",
			licence: "WTFPL",
			shipsIn: ["web UI"],
			files: [{ name: "LICENSE", text: "DO WHAT THE F*CK YOU WANT TO PUBLIC LICENSE\n" }],
		};
		expect(noticesProblems(committed, [...entries, added], FILE)[0]).toBe(
			`npm left-pad 1.3.0 ships but is not in ${FILE}.`,
		);
	});

	test("credits the icon sets the issue names, through their packages' own files", () => {
		const icons = find("npm", "react-icons");
		expect(icons?.files.map((file) => file.name)).toEqual(["LICENSE"]);
		const text = icons?.files[0]?.text ?? "";
		expect(text).toContain("Font Awesome 5");
		expect(text).toContain("CC BY 4.0");
		expect(text).toContain("VS Code Icons");
		expect(text).toContain("Devicons");
		expect(find("npm", "material-icon-theme")?.files[0]?.text).toContain("Philipp Kief");
		expect(find("npm", "simple-icons")?.licence).toBe("CC0-1.0");
	});

	test("lists each part's runtime packages, the build tools' code, Bun and the fonts", () => {
		expect(find("npm", "@anthropic-ai/claude-agent-sdk")?.shipsIn).toEqual(["sidecar"]);
		expect(find("npm", "@cloudflare/sandbox")?.shipsIn).toEqual(["cloud"]);
		expect(find("npm", "zod")?.shipsIn).toEqual(["web UI", "sidecar", "cloud"]);
		expect(find("npm", "tailwindcss")?.note).toContain("A build tool");
		expect(find("cargo", "tauri")?.shipsIn).toEqual(["app binary"]);
		expect(find("other", "Bun")?.version).toBe(
			readFileSync(join(ROOT, ".bun-version"), "utf8").trim(),
		);
		expect(find("other", "Bun")?.files[0]?.text).toContain("JavaScriptCore");
		expect(find("other", "Geist")?.files[0]?.text).toContain("SIL OPEN FONT LICENSE");
	});

	test("leaves out what never ships: test tools, platform-only programs, our own code", () => {
		expect(find("npm", "vitest")).toBeUndefined();
		expect(find("npm", "sql.js")).toBeUndefined();
		expect([...keys].some((key) => key.includes("claude-agent-sdk-darwin"))).toBe(false);
		expect([...keys].some((key) => key.includes("@conducted/"))).toBe(false);
		expect(find("cargo", "conducted")).toBeUndefined();
		// The end-to-end build's WebDriver server is behind the `e2e` feature, off in a release.
		expect(find("cargo", "tauri-plugin-wdio-webdriver")).toBeUndefined();
	});
});
