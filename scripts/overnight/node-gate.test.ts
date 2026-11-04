/**
 * The node gate must find leftover placeholders and tests named after the feature, in TypeScript
 * and in Rust.
 */
import { expect, test } from "bun:test";
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
