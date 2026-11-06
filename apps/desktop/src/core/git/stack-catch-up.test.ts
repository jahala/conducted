/**
 * @feature PR-12 Catch up a stack branch after GitHub rewrites it
 * Owns: the baseline ref name, the NUL path parser, the ignored-file collision guard, the
 * sequence-editor environment and the abort command.
 * Behaviour: services-map.md 3.8.3 (steps 4 and 6).
 * Test first: an ignored `build/` folder collides with an added `build/out.js`.
 */
import { describe, expect, it } from "vitest";
import {
	catchUpGuardEnv,
	hasIgnoredPathCollision,
	parseNulPaths,
	rebaseAbortCommand,
	syncedBaselineRef,
} from "./stack-catch-up.ts";

describe("PR-12 stack catch-up refs", () => {
	it("keeps the stack sync baseline in a per-worktree ref", () => {
		expect(syncedBaselineRef("abc")).toBe("refs/worktree/conducted/synced/abc");
	});
});

describe("PR-12 reading git's NUL separated paths", () => {
	it("keeps every path and drops the empty tail", () => {
		expect(parseNulPaths("a\0b c\0\0")).toEqual(["a", "b c"]);
		expect(parseNulPaths("")).toEqual([]);
	});
});

describe("PR-12 the ignored-file collision guard", () => {
	it("catches an added file under an ignored folder", () => {
		expect(hasIgnoredPathCollision(["build/"], ["build/out.js"])).toBe(true);
	});

	it("catches an added file at an ignored file's path", () => {
		expect(hasIgnoredPathCollision(["notes.log"], ["notes.log"])).toBe(true);
	});

	it("compares paths in NFC, lower case", () => {
		expect(hasIgnoredPathCollision(["Caf\u00e9/"], ["cafe\u0301/out.js"])).toBe(true);
	});

	it("leaves an unrelated added file alone", () => {
		expect(hasIgnoredPathCollision(["build/"], ["src/out.js"])).toBe(false);
		expect(hasIgnoredPathCollision([], ["src/out.js"])).toBe(false);
	});
});

describe("PR-12 the sequence-editor guard", () => {
	it("passes the planned refs as CONDUCTED_ variables, never inside a shell string", () => {
		const env = catchUpGuardEnv({
			headRef: "refs/heads/feat-b",
			localOid: "local-1",
			upstreamRef: "refs/remotes/origin/feat-b",
			upstreamOid: "upstream-1",
			remote: "origin",
			remoteIdentity: "hash-1",
		});

		expect(env.CONDUCTED_CATCH_UP_HEAD_REF).toBe("refs/heads/feat-b");
		expect(env.CONDUCTED_CATCH_UP_LOCAL_OID).toBe("local-1");
		expect(env.CONDUCTED_CATCH_UP_UPSTREAM_REF).toBe("refs/remotes/origin/feat-b");
		expect(env.CONDUCTED_CATCH_UP_UPSTREAM_OID).toBe("upstream-1");
		expect(env.CONDUCTED_CATCH_UP_REMOTE).toBe("origin");
		expect(env.CONDUCTED_CATCH_UP_REMOTE_ID).toBe("hash-1");
		expect(env.GIT_SEQUENCE_EDITOR).toContain("rebase-merge/head-name");
		expect(env.GIT_SEQUENCE_EDITOR).toContain("rebase-merge/orig-head");
		expect(env.GIT_SEQUENCE_EDITOR).not.toContain("feat-b");
		expect(env.GIT_SEQUENCE_EDITOR).not.toContain("origin");
	});

	it("aborts a rebase that stopped partway", () => {
		expect(rebaseAbortCommand()).toEqual({
			program: "git",
			args: ["rebase", "--abort"],
			retryOnLock: false,
		});
	});
});
