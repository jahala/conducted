import { describe, expect, it } from "vitest";
import {
	failedCommandError,
	httpsFallbackEnv,
	isGitLockError,
	isSshBlockedError,
} from "./runner.ts";

describe("isGitLockError", () => {
	it("recognises an index lock", () => {
		expect(isGitLockError("fatal: Unable to create '/r/.git/index.lock': File exists.")).toBe(true);
	});
	it("recognises a ref lock race", () => {
		expect(
			isGitLockError(
				"error: cannot lock ref 'refs/remotes/origin/x': is at abc123 but expected def456",
			),
		).toBe(true);
	});
	it("ignores other errors", () => {
		expect(isGitLockError("fatal: not a git repository")).toBe(false);
	});
});

describe("isSshBlockedError", () => {
	it("matches the three blocked-SSH messages", () => {
		expect(isSshBlockedError("ssh: connect to host github.com port 22: Operation timed out")).toBe(
			true,
		);
		expect(isSshBlockedError("kex_exchange_identification: Connection closed")).toBe(true);
		expect(isSshBlockedError("Permission denied (publickey).")).toBe(false);
	});
});

describe("httpsFallbackEnv", () => {
	it("declares as many config pairs as it counts", () => {
		const env = httpsFallbackEnv();
		const count = Number(env.GIT_CONFIG_COUNT);
		for (let i = 0; i < count; i++) {
			expect(env[`GIT_CONFIG_KEY_${i}`]).toBeDefined();
			expect(env[`GIT_CONFIG_VALUE_${i}`]).toBeDefined();
		}
	});
});

describe("failedCommandError", () => {
	it("uses stderr when there is some", () => {
		const error = failedCommandError(
			{ program: "git", args: ["push"] },
			{ exitCode: 1, stdout: "", stderr: " rejected \n" },
		);
		expect(error).toEqual({ code: "git_failed", message: "rejected" });
	});
});
