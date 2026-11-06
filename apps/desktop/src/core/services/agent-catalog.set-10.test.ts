import type { AgentProvider } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer } from "../../test/container.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { AgentCatalogService, providerKeychainRef } from "./agent-catalog.ts";

function serviceWith(request: SidecarClient["request"]): AgentCatalogService {
	return new AgentCatalogService({
		sidecar: { request },
		workspacePathOf: async () => ok("/workspace"),
		repoRootPathOf: async () => ok("/repo"),
	});
}

function deferredRequests() {
	const pending: ((value: unknown) => void)[] = [];
	const request = ((_method: string, _params: unknown) =>
		new Promise<unknown>((resolve) => pending.push(resolve))) as SidecarClient["request"];
	return { request, pending };
}

const deepseek: AgentProvider = {
	id: "deepseek",
	label: "DeepSeek",
	keyEnvVars: ["DEEPSEEK_API_KEY"],
};
const openrouter: AgentProvider = {
	id: "openrouter",
	label: "OpenRouter",
	keyEnvVars: ["OPENROUTER_API_KEY"],
};

describe("SET-10 provider catalogue in the agent catalogue service", () => {
	it("loads an agent's providers from the sidecar and keeps them under its agent key", async () => {
		const request = vi.fn().mockResolvedValue(ok({ providers: [deepseek] }));
		const service = serviceWith(request as unknown as SidecarClient["request"]);

		expect(await service.loadProviders("acp", "opencode")).toEqual(ok([deepseek]));
		expect(request).toHaveBeenCalledWith("listAgentProviders", {
			agent: "acp",
			acpAgent: "opencode",
		});
		expect(service.store.getState().providers?.["acp:opencode"]).toEqual({
			state: "ready",
			data: [deepseek],
		});
	});

	it("keeps the newer list when two loads for one agent answer out of order", async () => {
		const { request, pending } = deferredRequests();
		const service = serviceWith(request);

		const first = service.loadProviders("acp", "opencode");
		const second = service.loadProviders("acp", "opencode");
		expect(pending).toHaveLength(2);

		pending[1]?.(ok({ providers: [openrouter] }));
		await second;
		pending[0]?.(ok({ providers: [deepseek] }));
		await first;

		expect(service.store.getState().providers?.["acp:opencode"]).toEqual({
			state: "ready",
			data: [openrouter],
		});
	});

	it("shows the failure when the provider list cannot be read", async () => {
		const failure = appError("sidecar_down", "The sidecar is not running");
		const request = vi.fn().mockResolvedValue(err(failure));
		const service = serviceWith(request as unknown as SidecarClient["request"]);

		expect(await service.loadProviders("acp", "opencode")).toEqual(err(failure));
		expect(service.store.getState().providers?.["acp:opencode"]).toEqual({
			state: "error",
			error: failure,
		});
	});
});

describe("SET-10 an OpenCode variable that several providers share", () => {
	const zai = {
		agent: "acp" as const,
		acpAgent: "opencode" as const,
		provider: "zai",
		envVar: "ZHIPU_API_KEY",
	};
	const zhipuai = { ...zai, provider: "zhipuai" };

	it("keeps one row: saving it under one provider replaces the other provider's key", async () => {
		const test = createTestContainer();
		try {
			const catalog = test.container.services.agentCatalog;
			expect(await catalog.setProviderKey(zhipuai, { kind: "entered", value: "old" })).toEqual(
				ok(undefined),
			);
			expect(await catalog.setProviderKey(zai, { kind: "entered", value: "new" })).toEqual(
				ok(undefined),
			);

			const rows = await catalog.loadProviderKeys("acp", "opencode");
			expect(rows).toEqual(
				ok([
					{
						agent: "acp",
						acpAgent: "opencode",
						provider: "zai",
						envVar: "ZHIPU_API_KEY",
						source: "entered",
					},
				]),
			);
			expect(await test.memory.platform.keychain.get(providerKeychainRef(zhipuai))).toEqual(
				ok(null),
			);
			expect(await test.memory.platform.keychain.get(providerKeychainRef(zai))).toEqual(ok("new"));
		} finally {
			test.close();
		}
	});

	it("removes it for every provider when it is removed under one of them", async () => {
		const test = createTestContainer();
		try {
			const catalog = test.container.services.agentCatalog;
			expect(await catalog.setProviderKey(zai, { kind: "entered", value: "key" })).toEqual(
				ok(undefined),
			);

			expect(await catalog.removeProviderKey(zhipuai)).toEqual(ok(undefined));

			expect(await catalog.loadProviderKeys("acp", "opencode")).toEqual(ok([]));
			expect(await test.memory.platform.keychain.get(providerKeychainRef(zai))).toEqual(ok(null));
		} finally {
			test.close();
		}
	});

	it("keeps one key per provider for Claude, whose launch uses only the chosen provider", async () => {
		const test = createTestContainer();
		try {
			const catalog = test.container.services.agentCatalog;
			const claude = { agent: "claude" as const, acpAgent: null, envVar: "ANTHROPIC_MODEL" };
			expect(
				await catalog.setProviderKey(
					{ ...claude, provider: "bedrock" },
					{ kind: "entered", value: "a" },
				),
			).toEqual(ok(undefined));
			expect(
				await catalog.setProviderKey(
					{ ...claude, provider: "vertex" },
					{ kind: "entered", value: "b" },
				),
			).toEqual(ok(undefined));

			const rows = await catalog.loadProviderKeys("claude");
			expect(rows.ok && rows.value.map((row) => row.provider)).toEqual(["bedrock", "vertex"]);
		} finally {
			test.close();
		}
	});
});
