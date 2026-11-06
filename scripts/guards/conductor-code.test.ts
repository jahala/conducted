import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Fingerprints,
	findConductorCode,
	readFingerprints,
	rollingHash,
	scanWindows,
	sha256,
	WINDOW,
} from "./conductor-code.ts";

// Made-up "bundle" text of our own, standing in for the other app's code.
const CODE =
	'async function q7(t){const e=await call("load_widget_tray",{tray:t,verbose:!0});return e.items.map(n=>n.id)}';
const WINDOW_TEXT = CODE.slice(10, 10 + WINDOW);
const PAGE = "<!doctype html><title>widget tray</title>\n";
const fingerprints: Fingerprints = {
	source: "a made-up bundle",
	names: [sha256("tray-Ab3dE6gH.js")],
	contents: [sha256(PAGE)],
	windows: [{ rolling: rollingHash(WINDOW_TEXT), sha256: sha256(WINDOW_TEXT) }],
};

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "conductor-code-"));
	writeFileSync(join(dir, "pasted.ts"), `export const ours = 1;\n${CODE}\n`);
	writeFileSync(join(dir, "renamed.html"), PAGE);
	writeFileSync(join(dir, "tray-Ab3dE6gH.js"), "");
	writeFileSync(join(dir, "notes.md"), "The bundle loads `tray-Ab3dE6gH.js` first.\n");
	writeFileSync(join(dir, "clean.ts"), "export const nothing = 0;\n");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the conductor-code guard", () => {
	test("flags pasted code, a renamed copy and a file named like a chunk", () => {
		const problems = findConductorCode(
			dir,
			["clean.ts", "notes.md", "pasted.ts", "renamed.html", "tray-Ab3dE6gH.js"],
			fingerprints,
		);
		expect(problems.map((problem) => problem.message)).toEqual([
			`pasted.ts holds 1 stretch(es) of Conductor's code, the first at character ${23 + 10}`,
			"renamed.html is a copy of a file of Conductor's bundle",
			"tray-Ab3dE6gH.js is named like a file of Conductor's bundle",
		]);
	});

	test("passes prose that only cites a chunk's name", () => {
		expect(findConductorCode(dir, ["notes.md", "clean.ts"], fingerprints)).toEqual([]);
	});

	test("the rolling scan finds a window at every offset, including the first and the last", () => {
		const text = `${WINDOW_TEXT}--${WINDOW_TEXT}`;
		const windows = new Map([[rollingHash(WINDOW_TEXT), new Set([sha256(WINDOW_TEXT)])]]);
		expect(scanWindows(text, windows)).toEqual([0, WINDOW + 2]);
	});

	test("the committed fingerprints hold hashes of every kind and nothing else", () => {
		const committed = readFingerprints(join(import.meta.dir, "../.."));
		expect(committed.names.length).toBeGreaterThan(0);
		expect(committed.contents.length).toBeGreaterThan(0);
		expect(committed.windows.length).toBeGreaterThan(0);
		const hashes = [
			...committed.names,
			...committed.contents,
			...committed.windows.map((w) => w.sha256),
		];
		expect(hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
	});
});
