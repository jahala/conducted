import type { WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { buildScriptEnv, terminalLimit } from "./terminals.ts";

describe("buildScriptEnv", () => {
	const input = {
		workspace: {
			id: "w1" as WorkspaceId,
			directoryName: "oslo",
			path: "/ws/oslo",
			port: 55_010,
			targetBranch: "origin/main",
		},
		repoRootPath: "/repos/app",
		defaultBranch: "main",
		userEnv: { FOO: "1", CONDUCTED_PORT: "1" },
	};
	it("sets the workspace variables from the workspace", () => {
		const env = buildScriptEnv(input);
		expect(env.CONDUCTED_PORT).toBe("55010");
		expect(env.CONDUCTED_WORKSPACE_PATH).toBe("/ws/oslo");
		expect(env.CONDUCTED_ROOT_PATH).toBe("/repos/app");
		expect(env.CONDUCTED_DEFAULT_BRANCH).toBe("main");
		expect(env.CONDUCTED_WORKSPACE_NAME).toBe("oslo");
	});
	it("keeps user variables but never lets them replace ours", () => {
		const env = buildScriptEnv(input);
		expect(env.FOO).toBe("1");
		expect(env.CONDUCTED_PORT).toBe("55010");
	});
});

describe("terminalLimit", () => {
	it("allows ten terminals in tab freak mode and five otherwise", () => {
		expect(terminalLimit(true)).toBe(10);
		expect(terminalLimit(false)).toBe(5);
	});
});
