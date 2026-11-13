/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Tests the Worker's MCP OAuth routes inside Cloudflare's local runtime, end to end: the settings
 * route saves an OAuth server, the connect route answers the provider's sign-in URL, the provider
 * sends the browser to the callback without the pairing token, the list shows the server
 * connected, and the outbound handler gives the sandbox's request the token in place of the
 * placeholder, refreshed when it expired. The Worker's network is the provider in
 * oauth-test-provider.ts, put in place of `fetch` for the test.
 * Test first: a connect through the routes and the callback leaves the server connected, and the
 * sandbox's request reaches the server with the token.
 */
import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "./env.ts";
import { RESOURCE, TestProvider } from "./oauth-test-provider.ts";
import { Outbound } from "./outbound.ts";
import { CLOUD_MCP_PLACEHOLDER, CLOUD_SETTINGS_KEY } from "./settings.ts";

const BASE = "https://cloud.test";
const AUTH = { authorization: "Bearer test-pairing-token" };

const get = (path: string, headers: Record<string, string> = AUTH): Promise<Response> =>
	SELF.fetch(`${BASE}${path}`, { headers });

const post = (path: string, body?: unknown, headers: Record<string, string> = AUTH) =>
	SELF.fetch(`${BASE}${path}`, {
		method: "POST",
		headers: { ...headers, "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});

const settings = (servers: Record<string, unknown>) => ({
	gitIdentity: null,
	envVars: {},
	mcpServers: servers,
});

let provider: TestProvider;
const original = globalThis.fetch;

beforeEach(() => {
	provider = new TestProvider({ expiresIn: 3600 });
	globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
		provider.fetch(input instanceof Request ? input : new Request(input, init));
});

afterEach(async () => {
	globalThis.fetch = original;
	await post("/settings", settings({}));
	await env.BACKUPS.delete(CLOUD_SETTINGS_KEY);
});

/**
 * The sandbox's request through the real outbound entrypoint, with only the placeholder. It waits
 * for the work the handler leaves running after its answer, as the runtime does.
 */
async function fromSandbox(): Promise<Response> {
	const context = createExecutionContext();
	const outbound = new Outbound(context, env as unknown as Env);
	const answer = await outbound.fetch(
		new Request(RESOURCE, {
			method: "POST",
			headers: { authorization: `Bearer ${CLOUD_MCP_PLACEHOLDER}` },
			body: "{}",
		}),
	);
	await waitOnExecutionContext(context);
	return answer;
}

describe("CLOUD-17 the MCP OAuth routes", () => {
	it("needs the pairing token, except on the callback", async () => {
		expect((await get("/mcp-oauth", {})).status).toBe(401);
		expect((await post("/mcp-oauth/probe/connect", undefined, {})).status).toBe(401);
		expect((await get("/mcp-oauth/probe/status?state=x", {})).status).toBe(401);
		expect((await post("/mcp-oauth/probe/disconnect", undefined, {})).status).toBe(401);
		const callback = await get("/mcp-oauth/callback?state=nope&code=x", {});
		expect(callback.status).toBe(400);
		expect(callback.headers.get("content-type")).toContain("text/html");
		expect(callback.headers.get("content-security-policy")).toContain("default-src 'none'");
		expect(await callback.text()).toContain("This sign-in link has expired");
	});

	it("answers the callback URL and no credentials before a connect", async () => {
		const answer = await get("/mcp-oauth");
		expect(answer.status).toBe(200);
		expect(await answer.json()).toEqual({
			callbackUrl: "https://cloud.test/mcp-oauth/callback",
			servers: {},
		});
	});

	it("refuses to connect a server that is missing or does not use OAuth", async () => {
		expect((await post("/mcp-oauth/probe/connect")).status).toBe(404);
		await post("/settings", settings({ probe: { url: RESOURCE, authType: "none" } }));
		const refused = await post("/mcp-oauth/probe/connect");
		expect(refused.status).toBe(400);
		expect(await refused.json()).toEqual({ error: "probe does not use OAuth." });
		expect((await get("/mcp-oauth/probe/status")).status).toBe(400);
		expect((await get("/mcp-oauth/probe/connect")).status).toBe(405);
	});

	it("connects through the callback, and the sandbox's request carries the token", async () => {
		const saved = await post(
			"/settings",
			settings({ probe: { url: RESOURCE, authType: "oauth" } }),
		);
		expect(saved.status).toBe(200);
		// Saved but not connected: the Worker holds no token to send.
		expect((await fromSandbox()).status).toBe(503);
		const started = await post("/mcp-oauth/probe/connect");
		expect(started.status).toBe(200);
		const { authorizationUrl, state } = (await started.json()) as {
			authorizationUrl: string;
			state: string;
		};
		expect((await (await get(`/mcp-oauth/probe/status?state=${state}`)).json()) as unknown).toEqual(
			{
				status: "pending",
			},
		);
		const back = await provider.approve(authorizationUrl);
		expect(back.origin + back.pathname).toBe("https://cloud.test/mcp-oauth/callback");
		// The browser carries no pairing token back.
		const page = await SELF.fetch(back.toString());
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("probe is connected");
		expect((await (await get(`/mcp-oauth/probe/status?state=${state}`)).json()) as unknown).toEqual(
			{
				status: "absent",
			},
		);
		const listed = (await (await get("/mcp-oauth")).json()) as {
			servers: Record<string, { status: string }>;
		};
		expect(listed.servers.probe?.status).toBe("active");

		const answer = await fromSandbox();
		expect(answer.status).toBe(200);
		// No token reached the desktop's answers.
		for (const token of provider.accessTokens) {
			expect(JSON.stringify(listed)).not.toContain(token);
		}
	});

	it("forgets the tokens when the server is deleted or disconnected", async () => {
		await post("/settings", settings({ probe: { url: RESOURCE, authType: "oauth" } }));
		const { authorizationUrl } = (await (await post("/mcp-oauth/probe/connect")).json()) as {
			authorizationUrl: string;
		};
		await SELF.fetch((await provider.approve(authorizationUrl)).toString());
		expect((await fromSandbox()).status).toBe(200);
		expect((await post("/mcp-oauth/probe/disconnect")).status).toBe(200);
		expect((await fromSandbox()).status).toBe(503);
		const listed = (await (await get("/mcp-oauth")).json()) as { servers: object };
		expect(listed.servers).toEqual({});
	});

	it("refreshes when the server refuses the token", async () => {
		await post("/settings", settings({ probe: { url: RESOURCE, authType: "oauth" } }));
		const { authorizationUrl } = (await (await post("/mcp-oauth/probe/connect")).json()) as {
			authorizationUrl: string;
		};
		await SELF.fetch((await provider.approve(authorizationUrl)).toString());
		// The provider forgets the access token, as a revoked one: the server answers 401.
		provider.accessTokens.clear();
		expect((await fromSandbox()).status).toBe(401);
		// The outbound handler marked it refused, so the next request refreshes first.
		expect((await fromSandbox()).status).toBe(200);
		expect(provider.grants).toEqual(["authorization_code", "refresh_token"]);
	});

	it("tells the import which servers need OAuth", async () => {
		const answer = await post("/mcp-oauth/detect", { url: RESOURCE });
		expect(await answer.json()).toEqual({ authType: "oauth" });
		expect((await post("/mcp-oauth/detect", { url: "http://plain.example" })).status).toBe(400);
	});
});
