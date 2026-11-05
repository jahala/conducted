import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { ACP_AGENTS } from "@conducted/shared";
import {
	ACP_MODEL_LIST_CAP_MS,
	modelCatalogWaitMs,
	modelOptionFromConfig,
	modelsFromConfigOptions,
} from "./adapter.ts";
import { OPENCODE_CONFIG_CONTENT, OPENCODE_MCP_TOOL_TIMEOUT_MS } from "./opencode.ts";
import { ACP_ADAPTERS } from "./registry.ts";

function opencodeValue(
	adapter: typeof ACP_ADAPTERS.opencode,
	requireToolApproval: boolean,
	context: { agentVersion?: string; env?: Record<string, string> } = {},
): Record<string, unknown> {
	const result = adapter.permissionEnv(requireToolApproval, context);
	if (!result.ok) throw new Error(result.error.message);
	const text = result.value[OPENCODE_CONFIG_CONTENT];
	expect(typeof text).toBe("string");
	return JSON.parse(text ?? "{}") as Record<string, unknown>;
}

describe("AGENT-12 ACP adapters", () => {
	test("there is one adapter per ACP agent id, and each carries its own id", () => {
		for (const id of ACP_AGENTS) expect(ACP_ADAPTERS[id].id).toBe(id);
	});

	test("OpenCode runs `opencode acp` from version 1.16.2", () => {
		const adapter = ACP_ADAPTERS.opencode;
		expect(adapter.command).toEqual({ executable: "opencode", args: ["acp"] });
		expect(adapter.minimumVersion).toBe("1.16.2");
		expect(adapter.waitForModelCatalogMs).toBe(15_000);
		expect(ACP_MODEL_LIST_CAP_MS).toBe(90_000);
		expect(modelCatalogWaitMs(15_000, 0)).toBe(15_000);
		expect(modelCatalogWaitMs(200_000, 0)).toBe(90_000);
		expect(modelCatalogWaitMs(15_000, 89_000)).toBe(1_000);
		expect(modelCatalogWaitMs(15_000, 100_000)).toBe(0);
	});

	test("Pi runs pi-acp, maps its find tool to glob, and carries no version floor", () => {
		expect(ACP_ADAPTERS.pi.command).toEqual({ executable: "pi-acp", args: [] });
		expect(ACP_ADAPTERS.pi.toolNameHints.find).toBe("glob");
		expect(ACP_ADAPTERS.pi.minimumVersion).toBeUndefined();
		const env = ACP_ADAPTERS.pi.permissionEnv(true);
		expect(env.ok).toBe(true);
		if (env.ok) expect(env.value).toEqual({});
	});

	test("OpenCode's approval policy becomes its config environment", () => {
		const ask = opencodeValue(ACP_ADAPTERS.opencode, true, { agentVersion: "1.18.18" });
		expect(ask.permission).toEqual({ "*": "ask" });
		const allow = opencodeValue(ACP_ADAPTERS.opencode, false, { agentVersion: "1.18.18" });
		expect(allow.permission).toEqual({ "*": "allow" });
	});

	test("OpenCode refuses to guess a config shape when its version is unknown", () => {
		const missing = ACP_ADAPTERS.opencode.permissionEnv(true);
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.error.code).toBe("opencode_version_unknown");

		const unreadable = ACP_ADAPTERS.opencode.permissionEnv(true, { agentVersion: "dev" });
		expect(unreadable.ok).toBe(false);
		if (!unreadable.ok) expect(unreadable.error.code).toBe("opencode_version_unknown");
	});

	test("OpenCode 1 and 2 each get the MCP tool timeout in their own config shape", () => {
		const one = opencodeValue(ACP_ADAPTERS.opencode, true, { agentVersion: "1.18.18" });
		expect(one.experimental).toEqual({ mcp_timeout: OPENCODE_MCP_TOOL_TIMEOUT_MS });
		expect(one.mcp).toBeUndefined();

		const two = opencodeValue(ACP_ADAPTERS.opencode, true, { agentVersion: "2.0.0" });
		expect(two.mcp).toEqual({ timeout: { execution: OPENCODE_MCP_TOOL_TIMEOUT_MS } });
		expect(two.experimental).toBeUndefined();
		expect(OPENCODE_MCP_TOOL_TIMEOUT_MS).toBeGreaterThanOrEqual(600_000);
	});

	test("the config environment merges the user's own JSON instead of replacing it", () => {
		const merged = opencodeValue(ACP_ADAPTERS.opencode, true, {
			agentVersion: "1.18.18",
			env: {
				[OPENCODE_CONFIG_CONTENT]: JSON.stringify({
					model: "anthropic/claude-sonnet-5-5",
					permission: { bash: "allow" },
					experimental: { somethingElse: true },
				}),
			},
		});
		expect(merged.model).toBe("anthropic/claude-sonnet-5-5");
		expect(merged.permission).toEqual({ bash: "allow", "*": "ask" });
		expect(merged.experimental).toEqual({
			somethingElse: true,
			mcp_timeout: OPENCODE_MCP_TOOL_TIMEOUT_MS,
		});
	});

	test("an MCP timeout the user already raised stays above our floor", () => {
		const merged = opencodeValue(ACP_ADAPTERS.opencode, true, {
			agentVersion: "1.18.18",
			env: {
				[OPENCODE_CONFIG_CONTENT]: JSON.stringify({ experimental: { mcp_timeout: 900_000 } }),
			},
		});
		expect(merged.experimental).toEqual({ mcp_timeout: 900_000 });
	});

	test("an existing config that is not a JSON object is reported, not dropped", () => {
		const result = ACP_ADAPTERS.opencode.permissionEnv(true, {
			agentVersion: "1.18.18",
			env: { [OPENCODE_CONFIG_CONTENT]: "not json" },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("opencode_config_invalid");
	});

	test("OpenCode checks a slash command before it is sent", () => {
		const check = ACP_ADAPTERS.opencode.checkPrompt;
		expect(check).toBeDefined();
		if (check === undefined) return;
		expect(check("/review the diff", ["review"]).ok).toBe(true);
		expect(check("plain text", ["review"]).ok).toBe(true);
		expect(check("/Users/me/file.ts fails to parse", ["review"]).ok).toBe(true);
		expect(check("/tmp/a-file.ts", ["review"]).ok).toBe(true);
		const unknown = check("/deploy now", ["review"]);
		expect(unknown.ok).toBe(false);
		if (!unknown.ok) expect(unknown.error.code).toBe("opencode_command_unknown");
	});

	test("OpenCode keeps its sessions in the workspace with a stable id prefix", () => {
		const storage = ACP_ADAPTERS.opencode.sessionStorage;
		expect(storage).toBeDefined();
		if (storage === undefined) return;
		const value = storage("/tmp/work");
		expect(value.sessionIdPrefix).toBe("opencode-");
		expect(value.env.OPENCODE_DB).toBe(join("/tmp/work", ".context", "opencode", "opencode.db"));
	});

	test("ACP models come from the model config option", () => {
		const options = [
			{
				type: "select",
				id: "model",
				name: "Model",
				category: "model",
				currentValue: "m2",
				options: [
					{ value: "m1", name: "Model One" },
					{ value: "m2", name: "Model Two" },
				],
			},
		] as unknown as SessionConfigOption[];
		expect(modelOptionFromConfig(options)?.id).toBe("model");
		const models = modelsFromConfigOptions(options);
		expect(models.map((model) => model.id)).toEqual(["m1", "m2"]);
		expect(models.map((model) => model.label)).toEqual(["Model One", "Model Two"]);
		expect(models.map((model) => model.isDefault)).toEqual([false, true]);
		expect(modelsFromConfigOptions([])).toEqual([]);
	});
});
