import { expect, test } from "bun:test";
import type { WorkspaceContext } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { buildAgentEnv, parseEnvDump, stripProviderSecrets } from "./env.ts";

const M = "@@MARK@@";

test("parseEnvDump skips start-up noise and keeps multi-line values", () => {
	const dump = `welcome banner\n${M}A=1\0B=line1\nline2\0C=x=y\0NOEQUALS\0${M}trailing`;
	const result = parseEnvDump(dump, M);
	expect(result).toEqual({ ok: true, value: { A: "1", B: "line1\nline2", C: "x=y" } });
});

test("parseEnvDump reports a missing or unterminated dump", () => {
	expect(parseEnvDump("nothing", M).ok).toBe(false);
	expect(parseEnvDump(`${M}A=1`, M).ok).toBe(false);
});

test("stripProviderSecrets removes provider keys and exported functions only", () => {
	const out = stripProviderSecrets({
		ANTHROPIC_API_KEY: "k",
		OPENAI_API_KEY: "k",
		BASH_FUNC_foo: "() { :; }",
		PATH: "/bin",
		GH_TOKEN: "keep",
	});
	expect(out).toEqual({ PATH: "/bin", GH_TOKEN: "keep" });
});

test("user overrides win and may re-add a provider key", () => {
	const workspace: WorkspaceContext = {
		workspacePath: "/w",
		repoRootPath: "/r",
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 5100,
	};
	const env = buildAgentEnv(
		{ ANTHROPIC_API_KEY: "old", PATH: "/bin" },
		"s1" as SessionId,
		workspace,
		{ ANTHROPIC_API_KEY: "mine" },
	);
	expect(env.ANTHROPIC_API_KEY).toBe("mine");
	expect(env.CONDUCTED_PORT).toBe("5100");
	expect(env.CONDUCTED_SESSION_ID).toBe("s1");
});
