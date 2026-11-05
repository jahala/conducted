import type { AgentInstall } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { AgentCatalogService } from "./agent-catalog.ts";

const claude = (changes: Partial<AgentInstall> = {}): AgentInstall => ({
	agent: "claude",
	installed: false,
	...changes,
});

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
