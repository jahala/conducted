import { describe, expect, test } from "bun:test";
import type { WorkspaceContext } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import {
	buildAgentEnv,
	parseEnvDump,
	STRIPPED_ENV_NAMES,
	STRIPPED_ENV_PREFIXES,
	stripProviderSecrets,
	workspaceEnv,
} from "./env.ts";

const M = "@@MARK@@";

const workspace: WorkspaceContext = {
	workspaceId: "w1" as WorkspaceId,
	workspaceName: "lisbon",
	workspacePath: "/work/lisbon",
	repoRootPath: "/repos/conducted",
	targetBranch: "origin/main",
	placeholderBranch: false,
	host: { kind: "local" },
	port: 5100,
};

describe("SIDE-10 environment dump parsing", () => {
	test("skips start-up noise and keeps multi-line values and values with =", () => {
		const dump = `welcome banner\n${M}A=1\0B=line1\nline2\0C=x=y\0NOEQUALS\0${M}trailing`;
		const result = parseEnvDump(dump, M);
		expect(result).toEqual({ ok: true, value: { A: "1", B: "line1\nline2", C: "x=y" } });
	});

	test("reports a missing or unterminated dump", () => {
		expect(parseEnvDump("nothing", M).ok).toBe(false);
		expect(parseEnvDump(`${M}A=1`, M).ok).toBe(false);
	});

	test("skips entries without a name", () => {
		const result = parseEnvDump(`${M}=empty\0KEEP=1\0${M}`, M);
		expect(result).toEqual({ ok: true, value: { KEEP: "1" } });
	});
});

describe("SIDE-10 provider secrets", () => {
	test("removes the shared provider keys, exported functions and the capture folder", () => {
		const out = stripProviderSecrets({
			ANTHROPIC_API_KEY: "k",
			OPENAI_API_KEY: "k",
			CODEX_ACCESS_TOKEN: "k",
			CLAUDE_CODE_OAUTH_TOKEN: "k",
			CODEX_API_KEY: "k",
			CURSOR_API_KEY: "k",
			CONDUCTED_CWD: "/somewhere",
			BASH_FUNC_foo: "() { :; }",
			PATH: "/bin",
			GH_TOKEN: "keep",
		});
		expect(out).toEqual({ PATH: "/bin", GH_TOKEN: "keep" });
	});

	test("the shared list has no duplicates", () => {
		expect(new Set(STRIPPED_ENV_NAMES).size).toBe(STRIPPED_ENV_NAMES.length);
		expect(STRIPPED_ENV_PREFIXES).toEqual(["BASH_FUNC_"]);
	});
});

describe("SIDE-10 agent environment", () => {
	test("sets every workspace variable the research lists, including the local flag", () => {
		const env = workspaceEnv("s1" as SessionId, workspace);
		expect(env).toMatchObject({
			CONDUCTED_SESSION_ID: "s1",
			CONDUCTED_WORKSPACE_ID: "w1",
			CONDUCTED_WORKSPACE_NAME: "lisbon",
			CONDUCTED_WORKSPACE_PATH: "/work/lisbon",
			CONDUCTED_ROOT_PATH: "/repos/conducted",
			CONDUCTED_DEFAULT_BRANCH: "origin/main",
			CONDUCTED_PORT: "5100",
			CONDUCTED_IS_LOCAL: "true",
			DISABLE_AUTO_UPDATE: "true",
		});
	});

	test("builds from the captured environment without secrets, then the workspace, then overrides", () => {
		const env = buildAgentEnv(
			{
				ANTHROPIC_API_KEY: "old",
				OPENAI_API_KEY: "old",
				BASH_FUNC_jump: "() { :; }",
				PATH: "/bin",
				CONDUCTED_PORT: "1",
			},
			"s1" as SessionId,
			workspace,
			{ ANTHROPIC_API_KEY: "mine", PATH: "/custom/bin" },
		);
		expect(env.ANTHROPIC_API_KEY).toBe("mine");
		expect(env.OPENAI_API_KEY).toBeUndefined();
		expect(env.BASH_FUNC_jump).toBeUndefined();
		expect(env.PATH).toBe("/custom/bin");
		expect(env.CONDUCTED_PORT).toBe("5100");
		expect(env.CONDUCTED_SESSION_ID).toBe("s1");
		expect(env.CONDUCTED_WORKSPACE_ID).toBe("w1");
		expect(env.CONDUCTED_WORKSPACE_NAME).toBe("lisbon");
		expect(env.CONDUCTED_IS_LOCAL).toBe("true");
	});
});
