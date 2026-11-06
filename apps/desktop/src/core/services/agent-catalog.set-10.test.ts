import type { AgentProvider } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { AgentCatalogService } from "./agent-catalog.ts";

function serviceWith(request: SidecarClient["request"]): AgentCatalogService {
	return new AgentCatalogService({
		sidecar: { request },
		workspacePathOf: async () => ok("/workspace"),
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
