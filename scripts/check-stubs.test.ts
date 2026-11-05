/**
 * The stub check must catch each way the backlog and the code can disagree, and must read
 * placeholders the same way the node gate and the header guard do.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findPlaceholders, stubProblems } from "./check-stubs.ts";
import type { BacklogRow } from "./issues/model.ts";

const row = (id: string, status: BacklogRow["status"], needs: string[] = []): BacklogRow => ({
	id,
	title: id,
	owner: "D/core",
	research: "",
	priority: 1,
	status,
	needs,
	epic: "x",
});

test("a clean backlog and code report nothing", () => {
	const found = new Map([["CHAT-01", ["a.ts"]]]);
	expect(stubProblems([row("CHAT-01", "stub"), row("CHAT-02", "done")], found, [])).toEqual([]);
});

test("each disagreement is named", () => {
	const found = new Map([
		["CHAT-02", ["a.ts"]],
		["GHOST-01", ["b.ts"]],
	]);
	const problems = stubProblems(
		[row("CHAT-01", "stub", ["SIDE-09"]), row("CHAT-02", "done")],
		found,
		['CHAT-03 has status "wip"; use stub, done or planned'],
	);
	expect(problems).toEqual([
		'CHAT-03 has status "wip"; use stub, done or planned',
		"CHAT-01 needs SIDE-09, which is not in the backlog",
		"CHAT-02 is marked done but still has placeholders: a.ts",
		"GHOST-01 is used in b.ts but missing from the backlog",
		"CHAT-01 is marked stub but no placeholder exists in the code",
	]);
});

test("a planned row may hold a placeholder or none", () => {
	expect(stubProblems([row("CLOUD-01", "planned")], new Map(), [])).toEqual([]);
	expect(stubProblems([row("CLOUD-01", "planned")], new Map([["CLOUD-01", ["a.ts"]]]), [])).toEqual(
		[],
	);
});

let root = "";
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "stubs-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

test("placeholders are read from all three spellings and skip test files", () => {
	const put = (path: string, text: string) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	};
	put("packages/a/src/a.ts", 'notImplemented("CHAT-01");');
	put("apps/b/src/b.rs", 'not_implemented!("PLAT-02");');
	put("bin/c.sh", 'not_implemented "SIDE-03"');
	put("packages/a/src/a.test.tsx", 'expect(() => notImplemented("TEST-09")).toThrow();');
	const found = findPlaceholders(root);
	expect([...found.keys()].sort()).toEqual(["CHAT-01", "PLAT-02", "SIDE-03"]);
});
