/**
 * The node gate must find leftover placeholders and tests named after the feature, in TypeScript
 * and in Rust.
 */
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodeFiles } from "../guards/lib.ts";
import { placeholdersFor, testsFor } from "./node-gate.ts";

test("placeholders for the id are found, other ids are not", () => {
	const files: [string, string][] = [
		["a.ts", 'return notImplemented("CHAT-03");'],
		["b.rs", 'not_implemented!("PLAT-03")'],
		["c.ts", 'notImplemented("CHAT-30")'],
	];
	expect(placeholdersFor("CHAT-03", files)).toEqual(["a.ts"]);
	expect(placeholdersFor("PLAT-03", files)).toEqual(["b.rs"]);
});

test("a test file that mentions a placeholder does not count as a placeholder", () => {
	const files: [string, string][] = [
		["a.test.ts", 'expect(() => notImplemented("CHAT-03")).toThrow();'],
		["a.ts", "export const done = 1;"],
	];
	expect(placeholdersFor("CHAT-03", files)).toEqual([]);
});

test("the sources of a folder are read from the code folders only", () => {
	const root = mkdtempSync(join(tmpdir(), "gate-"));
	try {
		mkdirSync(join(root, "packages/a/src"), { recursive: true });
		mkdirSync(join(root, "docs"), { recursive: true });
		writeFileSync(join(root, "packages/a/src/a.ts"), 'notImplemented("CHAT-03");');
		writeFileSync(join(root, "docs/b.ts"), 'notImplemented("CHAT-04");');
		const files = readCodeFiles(root);
		expect(files.map(([path]) => path)).toEqual(["packages/a/src/a.ts"]);
		expect(placeholdersFor("CHAT-03", files)).toEqual(["packages/a/src/a.ts"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("tests named after the id count, in TypeScript and Rust", () => {
	const files: [string, string][] = [
		["x.test.ts", 'describe("CHAT-03 Steer", () => {})'],
		["y.test.ts", 'describe("CHAT-30 Other", () => {})'],
		["shell.rs", "#[cfg(test)]\nmod tests {\n    #[test]\n    fn plat_03_runs_a_command() {}\n}"],
	];
	expect(testsFor("CHAT-03", files)).toEqual(["x.test.ts"]);
	expect(testsFor("PLAT-03", files)).toEqual(["shell.rs"]);
	expect(testsFor("PLAT-04", files)).toEqual([]);
});
