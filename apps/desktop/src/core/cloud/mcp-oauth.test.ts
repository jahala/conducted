/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Tests the MCP page's OAuth calls to the paired Worker: the list it reads, a connect, a
 * connect's status, a cancel and a disconnect, an unpaired Mac and a Worker's refusal.
 * Test first: reads a connected server's status and connects another.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Cloud } from "../../platform/platform.ts";
import { createCloudMcpOAuth, normalizeOAuthView } from "./mcp-oauth.ts";

const PAIRED = { paired: true, url: "https://w.example.dev" } as const;

function fakeCloud(answer: (request: { method: string; path: string; body?: unknown }) => unknown) {
	const requests: { method: string; path: string; body?: unknown }[] = [];
	const cloud = {
		request: async (request: { method: string; path: string; body?: unknown }) => {
			requests.push(request);
			return answer(request);
		},
	} as unknown as Pick<Cloud, "request">;
	return { cloud, requests };
}

const answered = (status: number, body: unknown) => ok({ status, body: JSON.stringify(body) });

describe("CLOUD-17 the cloud MCP OAuth service", () => {
	it("reads a connected server's status and connects another", async () => {
		const { cloud, requests } = fakeCloud((request) => {
			if (request.path === "/mcp-oauth") {
				return answered(200, {
					callbackUrl: "https://w.example.dev/mcp-oauth/callback",
					servers: { linear: { status: "active" } },
				});
			}
			if (request.path === "/mcp-oauth/notion/connect") {
				return answered(200, { authorizationUrl: "https://auth.example/a", state: "s1" });
			}
			if (request.path === "/mcp-oauth/notion/status?state=s1") {
				return answered(200, { status: "pending" });
			}
			if (request.path === "/mcp-oauth/notion/cancel") return answered(200, { cancelled: true });
			return null;
		});
		const service = createCloudMcpOAuth({ cloud, pairing: () => PAIRED });
		const loaded = await service.load();
		expect(loaded.ok && loaded.value).toEqual({
			callbackUrl: "https://w.example.dev/mcp-oauth/callback",
			credentials: { linear: { status: "active" } },
		});
		expect(service.store.getState().state).toBe("ready");
		const started = await service.connect("notion");
		expect(started.ok && started.value).toEqual({
			authorizationUrl: "https://auth.example/a",
			state: "s1",
		});
		expect(await service.status("notion", "s1")).toEqual(ok("pending"));
		expect(await service.cancel("notion", "s1")).toEqual(ok(true));
		expect(requests.find((request) => request.path.endsWith("/cancel"))?.body).toEqual({
			state: "s1",
		});
	});

	it("makes no request for an unpaired Mac", async () => {
		const { cloud, requests } = fakeCloud(() => answered(200, {}));
		const service = createCloudMcpOAuth({ cloud, pairing: () => ({ paired: false, url: null }) });
		const loaded = await service.load();
		expect(loaded.ok).toBe(false);
		expect(requests).toEqual([]);
	});

	it("gives the Worker's own reason when it refuses a connect", async () => {
		const { cloud } = fakeCloud(() =>
			answered(400, { error: "The server's authorization server published no metadata." }),
		);
		const service = createCloudMcpOAuth({ cloud, pairing: () => PAIRED });
		const started = await service.connect("own");
		expect(started.ok).toBe(false);
		if (started.ok) return;
		expect(started.error.message).toBe("The server's authorization server published no metadata.");
	});

	it("leaves out a credential that is not one of Conductor's statuses", () => {
		expect(
			normalizeOAuthView({
				callbackUrl: "https://w/cb",
				servers: { a: { status: "active" }, b: { status: "weird" } },
			}),
		).toEqual({ callbackUrl: "https://w/cb", credentials: { a: { status: "active" } } });
		expect(normalizeOAuthView({ servers: {} })).toBeNull();
	});
});
