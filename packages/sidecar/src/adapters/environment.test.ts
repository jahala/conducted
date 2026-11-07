/**
 * @feature SIDE-25 Sidecar adapters in their own edge modules
 * Owns: tests for the environment edge over the process facts passed in.
 * Test first: the parent pid comes from the launcher environment and falls back to the real parent.
 */
import { describe, expect, test } from "bun:test";
import { createProcessEnvironment, newEnvironmentMarker, PARENT_PID_ENV } from "./environment.ts";

const TEST_ENV = { HOME: "/Users/someone", PATH: "/usr/bin", UNSET: undefined };

function environment(overrides: Partial<{ pid: number; ppid: number }> = {}) {
	const state = { pid: overrides.pid ?? 10, ppid: overrides.ppid ?? 20, platform: "darwin" };
	return {
		state,
		value: createProcessEnvironment({
			env: TEST_ENV,
			pid: () => state.pid,
			ppid: () => state.ppid,
			execPath: () => "/Applications/Conducted.app/Contents/MacOS/sidecar",
			platform: () => state.platform,
			arch: () => "arm64",
		}),
	};
}

describe("SIDE-25 environment edge", () => {
	test("SIDE-25 the snapshot keeps defined values and drops undefined ones", () => {
		const { value } = environment();
		expect(value.snapshot()).toEqual({ HOME: "/Users/someone", PATH: "/usr/bin" });
	});

	test("SIDE-25 the target is the live environment object", () => {
		const { value } = environment();
		expect(value.target()).toBe(TEST_ENV);
	});

	test("SIDE-25 the parent pid comes from the launcher environment", () => {
		const { value } = environment({ ppid: 20 });
		expect(value.parentPid({ [PARENT_PID_ENV]: "4321" })).toBe(4321);
	});

	test("SIDE-25 the parent pid falls back to the real parent when it is missing or invalid", () => {
		const { value } = environment({ ppid: 20 });
		expect(value.parentPid({})).toBe(20);
		expect(value.parentPid({ [PARENT_PID_ENV]: "not-a-pid" })).toBe(20);
		expect(value.parentPid({ [PARENT_PID_ENV]: "-1" })).toBe(20);
	});

	test("SIDE-25 the process facts are read live, never frozen at construction", () => {
		const { state, value } = environment();
		state.pid = 11;
		state.ppid = 21;
		state.platform = "linux";
		expect(value.pid).toBe(11);
		expect(value.ppid).toBe(21);
		expect(value.execPath).toContain("sidecar");
		expect(value.platform).toBe("linux");
		expect(value.arch).toBe("arm64");
	});

	test("SIDE-25 each environment marker is fresh", () => {
		const first = newEnvironmentMarker();
		const second = newEnvironmentMarker();
		expect(first).toMatch(/^__conducted_env_[0-9a-f]{16}__$/);
		expect(second).not.toBe(first);
	});
});
