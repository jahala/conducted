import type { AgentInstall, Host, ModelInfo } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { AgentCatalogService, modelsKey } from "./agent-catalog.ts";

const claude = (changes: Partial<AgentInstall> = {}): AgentInstall => ({
	agent: "claude",
	installed: false,
	...changes,
});

function serviceWith(
	request: SidecarClient["request"],
	options: {
		cloudClientFor?: (host: Extract<Host, { kind: "cloud" }>) => Pick<SidecarClient, "request">;
	} = {},
): AgentCatalogService {
	return new AgentCatalogService({
		sidecar: { request },
		...(options.cloudClientFor === undefined ? {} : { cloudClientFor: options.cloudClientFor }),
		launchFor: async () => ok({ env: {}, providerKeys: {} }),
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

describe("SET-03 agent catalogue installs", () => {
	it("keeps the newer install list when two refreshes answer out of order", async () => {
		const { request, pending } = deferredRequests();
		const service = serviceWith(request);
		const older = claude({ installed: false });
		const newer = claude({ installed: true, version: "2.0.0", path: "/bin/claude" });

		const first = service.refresh();
		const second = service.refresh();
		expect(pending).toHaveLength(2);

		pending[1]?.(ok({ agents: [newer] }));
		await second;
		pending[0]?.(ok({ agents: [older] }));
		expect(await first).toEqual(ok(undefined));

		expect(service.store.getState().installs).toEqual({ state: "ready", data: [newer] });
	});

	it("lets a notification replace a refresh that is still in flight", async () => {
		const { request, pending } = deferredRequests();
		const service = serviceWith(request);
		const older = claude({ installed: false });
		const newer = claude({ installed: true, version: "3.0.0", path: "/bin/claude" });

		const refresh = service.refresh();
		service.setInstalls([newer]);
		pending[0]?.(ok({ agents: [older] }));
		await refresh;

		expect(service.store.getState().installs).toEqual({ state: "ready", data: [newer] });
	});

	it("shows the failure when the install list cannot be read", async () => {
		const failure = appError("sidecar_down", "The sidecar is not running");
		const requestMock = vi.fn().mockResolvedValue(err(failure));
		const service = serviceWith(requestMock as unknown as SidecarClient["request"]);

		expect(await service.refresh()).toEqual(err(failure));
		expect(service.store.getState().installs).toEqual({ state: "error", error: failure });
		expect(requestMock).toHaveBeenCalledWith("getAgentInstalls", {});
	});

	it("takes a notification without a request", () => {
		const service = serviceWith(vi.fn() as unknown as SidecarClient["request"]);
		const install = claude({ installed: true });

		service.setInstalls([install]);

		expect(service.store.getState().installs).toEqual({ state: "ready", data: [install] });
	});
});

const model = (id: string): ModelInfo => ({
	id,
	label: id,
	status: "picker",
	isNew: false,
	isDefault: false,
	efforts: ["high"],
	defaultEffort: "high",
	effortAxis: "effort",
	liveEffortChange: false,
	supportsFastMode: false,
});

describe("SET-03 agent catalogue model lists", () => {
	it("keeps the newer model list when two requests for one agent key answer out of order", async () => {
		const { request, pending } = deferredRequests();
		const service = serviceWith(request);
		const older = [model("older")];
		const newer = [model("newer")];

		const first = service.loadModels("acp", "opencode");
		const second = service.loadModels("acp", "opencode");
		// Each list builds the agent's launch first, so the requests go out once it is built.
		await vi.waitFor(() => expect(pending).toHaveLength(2));

		pending[1]?.(ok({ models: newer }));
		expect(await second).toEqual(ok(newer));
		pending[0]?.(ok({ models: older }));
		expect(await first).toEqual(ok(older));

		expect(service.store.getState().models["acp:opencode"]).toEqual({
			state: "ready",
			data: newer,
		});
	});

	it("CLOUD-04 keeps a cloud workspace's model list apart from the local one", async () => {
		const local = vi.fn().mockResolvedValue(ok({ models: [model("local")] }));
		const cloud = vi.fn().mockResolvedValue(ok({ models: [model("cloud")] }));
		const service = serviceWith(local as unknown as SidecarClient["request"], {
			cloudClientFor: () => ({ request: cloud as unknown as SidecarClient["request"] }),
		});
		const host = {
			kind: "cloud" as const,
			url: "https://worker.example",
			vmId: "sandbox-1",
		};

		expect(await service.loadModels("claude")).toEqual(ok([model("local")]));
		expect(await service.loadModels("claude", undefined, host)).toEqual(ok([model("cloud")]));

		expect(local).toHaveBeenCalledTimes(1);
		expect(cloud).toHaveBeenCalledTimes(1);
		expect(service.store.getState().models["claude"]).toEqual({
			state: "ready",
			data: [model("local")],
		});
		expect(service.store.getState().models[modelsKey(host, "claude")]).toEqual({
			state: "ready",
			data: [model("cloud")],
		});
	});

	it("CLOUD-04 a cloud list without a cloud client fails, never the local sidecar's list", async () => {
		const local = vi.fn().mockResolvedValue(ok({ models: [model("local")] }));
		const service = serviceWith(local as unknown as SidecarClient["request"]);
		const host = {
			kind: "cloud" as const,
			url: "https://worker.example",
			vmId: "sandbox-1",
		};

		const result = await service.loadModels("claude", undefined, host);

		expect(result.ok).toBe(false);
		expect(local).not.toHaveBeenCalled();
		expect(service.store.getState().models[modelsKey(host, "claude")]?.state).toBe("error");
		expect(service.store.getState().models["claude"]).toBeUndefined();
	});
});

describe("SET-03 agent catalogue sign-in", () => {
	it("starts a sign-in for the agent and returns its instructions", async () => {
		const flow = {
			loginId: "login-1",
			instructions: "Run claude setup-token, then paste the code.",
			command: "claude setup-token",
		};
		const requestMock = vi.fn().mockResolvedValue(ok(flow));
		const service = serviceWith(requestMock as unknown as SidecarClient["request"]);

		expect(await service.login("claude")).toEqual(ok(flow));
		expect(requestMock).toHaveBeenCalledWith("startAgentLogin", {
			agent: "claude",
			acpAgent: undefined,
		});
	});

	it("passes the pasted code and reports the outcome", async () => {
		const requestMock = vi.fn().mockResolvedValue(ok({ outcome: "signed_in" }));
		const service = serviceWith(requestMock as unknown as SidecarClient["request"]);

		expect(await service.finishLogin("login-1", "123-456")).toEqual(
			ok({ outcome: "signed_in", message: null }),
		);
		expect(requestMock).toHaveBeenCalledWith("finishAgentLogin", {
			loginId: "login-1",
			code: "123-456",
		});
	});

	it("refuses an API key instead of dropping it when no Keychain store exists", async () => {
		const requestMock = vi.fn().mockResolvedValue(ok({ outcome: "signed_in", apiKey: "sk-live" }));
		const service = serviceWith(requestMock as unknown as SidecarClient["request"]);

		const result = await service.finishLogin("login-1");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("agent_key_not_stored");
	});

	it("cancels a flow through the sidecar", async () => {
		const requestMock = vi.fn().mockResolvedValue(ok({}));
		const service = serviceWith(requestMock as unknown as SidecarClient["request"]);

		expect(await service.cancelLogin("login-1")).toEqual(ok(undefined));
		expect(requestMock).toHaveBeenCalledWith("cancelAgentLogin", { loginId: "login-1" });
	});
});
