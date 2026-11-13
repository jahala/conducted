/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Tests the Worker's OAuth for cloud MCP servers inside Cloudflare's local runtime, on the token
 * store Durable Object's own storage, against the provider in oauth-test-provider.ts: a connect
 * and its callback leave an active token, an expired token is refreshed once however many ask, a
 * refused refresh needs re-auth, and a changed server never gets the old token.
 * Test first: a connect, the provider's redirect and the callback leave an active token.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
	accessToken,
	beginConnect,
	cancelConnect,
	completeConnect,
	connectStatus,
	credentials,
	detectAuth,
	type OAuthDeps,
	prune,
	REFRESH_MARGIN_MS,
	tokenRejected,
} from "./mcp-oauth.ts";
import { ISSUER, RESOURCE, TestProvider } from "./oauth-test-provider.ts";
import type { CloudMcpServer } from "./settings.ts";

const CALLBACK = "https://worker.test/mcp-oauth/callback";
const SERVER: CloudMcpServer = { url: RESOURCE, authType: "oauth" };

let objects = 0;

/** Runs `body` with the flow's effects: a fresh store object, the provider and a test clock. */
async function withFlow(
	provider: TestProvider,
	body: (deps: OAuthDeps, clock: { now: number }) => Promise<void>,
): Promise<void> {
	objects += 1;
	const stub = env.MCP_OAUTH.getByName(`test-${objects}`);
	await runInDurableObject(stub, async (_instance, state) => {
		const clock = { now: Date.UTC(2026, 10, 13, 9) };
		await body(
			{
				storage: state.storage,
				fetch: provider.fetch,
				now: () => clock.now,
				randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
				inflight: new Map(),
			},
			clock,
		);
	});
}

/** Connects `name` all the way: the connect, the provider's approval and the callback. */
async function connect(
	deps: OAuthDeps,
	provider: TestProvider,
	name = "probe",
	server = SERVER,
): Promise<{ state: string; authorizationUrl: URL }> {
	const started = await beginConnect(deps, name, server, CALLBACK);
	if (!started.ok) throw new Error(started.error);
	const back = await provider.approve(started.value.authorizationUrl);
	const outcome = await completeConnect(
		deps,
		{
			state: back.searchParams.get("state"),
			code: back.searchParams.get("code"),
			error: null,
			errorDescription: null,
			iss: back.searchParams.get("iss"),
		},
		{ [name]: server },
	);
	expect(outcome).toEqual({ outcome: "connected", name });
	return { state: started.value.state, authorizationUrl: new URL(started.value.authorizationUrl) };
}

describe("CLOUD-17 OAuth for cloud MCP servers", () => {
	it("connects through the provider's metadata, a registered client and PKCE", async () => {
		const provider = new TestProvider();
		await withFlow(provider, async (deps) => {
			const { state, authorizationUrl } = await connect(deps, provider);
			const params = authorizationUrl.searchParams;
			expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(`${ISSUER}/authorize`);
			expect(params.get("redirect_uri")).toBe(CALLBACK);
			expect(params.get("code_challenge_method")).toBe("S256");
			expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
			expect(params.get("resource")).toBe(RESOURCE);
			expect(params.get("scope")).toBe("mcp");
			expect(params.get("state")).toBe(state);
			expect(provider.registrations).toBe(1);
			expect(provider.grants).toEqual(["authorization_code"]);

			const saved = await credentials(deps, { probe: SERVER });
			expect(saved.probe?.status).toBe("active");
			// The status check finds nothing waiting any more, so the page reads the list again.
			expect(await connectStatus(deps, "probe", state)).toBe("absent");
			expect(await cancelConnect(deps, "probe", state)).toBe(false);

			const token = await accessToken(deps, "probe", SERVER);
			expect(token).not.toBeNull();
			expect(provider.accessTokens.has(token as string)).toBe(true);
			// The answer the desktop reads never holds a token.
			expect(JSON.stringify(saved)).not.toContain(token as string);
		});
	});

	it("reuses the registered client on the next connect", async () => {
		const provider = new TestProvider();
		await withFlow(provider, async (deps) => {
			await connect(deps, provider);
			await connect(deps, provider);
			expect(provider.registrations).toBe(1);
		});
	});

	it("waits while the browser is open, and a cancel stops the wait", async () => {
		const provider = new TestProvider();
		await withFlow(provider, async (deps) => {
			const started = await beginConnect(deps, "probe", SERVER, CALLBACK);
			if (!started.ok) throw new Error(started.error);
			expect(await connectStatus(deps, "probe", started.value.state)).toBe("pending");
			expect(await connectStatus(deps, "probe", "another-state")).toBe("absent");
			expect(await cancelConnect(deps, "probe", started.value.state)).toBe(true);
			expect(await connectStatus(deps, "probe", started.value.state)).toBe("absent");
			// The provider's late redirect finds nothing to finish.
			const back = await provider.approve(started.value.authorizationUrl);
			expect(
				await completeConnect(
					deps,
					{
						state: back.searchParams.get("state"),
						code: back.searchParams.get("code"),
						error: null,
						errorDescription: null,
						iss: null,
					},
					{ probe: SERVER },
				),
			).toEqual({ outcome: "unknown" });
			expect(await credentials(deps, { probe: SERVER })).toEqual({});
		});
	});

	it("gives up on a sign-in after 600 seconds", async () => {
		const provider = new TestProvider();
		await withFlow(provider, async (deps, clock) => {
			const started = await beginConnect(deps, "probe", SERVER, CALLBACK);
			if (!started.ok) throw new Error(started.error);
			const back = await provider.approve(started.value.authorizationUrl);
			clock.now += 600_001;
			expect(
				await completeConnect(
					deps,
					{
						state: back.searchParams.get("state"),
						code: back.searchParams.get("code"),
						error: null,
						errorDescription: null,
						iss: null,
					},
					{ probe: SERVER },
				),
			).toEqual({ outcome: "unknown" });
			expect(await connectStatus(deps, "probe", started.value.state)).toBe("absent");
		});
	});

	it("fails the attempt when the provider sends an error back", async () => {
		const provider = new TestProvider();
		await withFlow(provider, async (deps) => {
			const started = await beginConnect(deps, "probe", SERVER, CALLBACK);
			if (!started.ok) throw new Error(started.error);
			const outcome = await completeConnect(
				deps,
				{
					state: started.value.state,
					code: null,
					error: "access_denied",
					errorDescription: "The user said no.",
					iss: null,
				},
				{ probe: SERVER },
			);
			expect(outcome).toEqual({ outcome: "failed", name: "probe", detail: "The user said no." });
			expect(await connectStatus(deps, "probe", started.value.state)).toBe("failed");
		});
	});

	it("refuses a callback from another issuer", async () => {
		const provider = new TestProvider();
		await withFlow(provider, async (deps) => {
			const started = await beginConnect(deps, "probe", SERVER, CALLBACK);
			if (!started.ok) throw new Error(started.error);
			const back = await provider.approve(started.value.authorizationUrl);
			const outcome = await completeConnect(
				deps,
				{
					state: back.searchParams.get("state"),
					code: back.searchParams.get("code"),
					error: null,
					errorDescription: null,
					iss: "https://evil.test",
				},
				{ probe: SERVER },
			);
			expect(outcome.outcome).toBe("failed");
			expect(provider.grants).toEqual([]);
		});
	});

	it("refreshes an expired token once for two requests at the same moment", async () => {
		const provider = new TestProvider({ expiresIn: 120 });
		await withFlow(provider, async (deps, clock) => {
			await connect(deps, provider);
			const first = await accessToken(deps, "probe", SERVER);
			clock.now += 120_000 - REFRESH_MARGIN_MS + 1;
			const [left, right] = await Promise.all([
				accessToken(deps, "probe", SERVER),
				accessToken(deps, "probe", SERVER),
			]);
			expect(left).toBe(right);
			expect(left).not.toBe(first);
			expect(provider.accessTokens.has(left as string)).toBe(true);
			expect(provider.grants).toEqual(["authorization_code", "refresh_token"]);
			// The rotated refresh token is the one kept: a second expiry refreshes again.
			clock.now += 120_000;
			const third = await accessToken(deps, "probe", SERVER);
			expect(third).not.toBe(left);
			expect(provider.grants).toEqual(["authorization_code", "refresh_token", "refresh_token"]);
		});
	});

	it("needs re-auth when the provider refuses the refresh", async () => {
		const provider = new TestProvider({ expiresIn: 120 });
		await withFlow(provider, async (deps, clock) => {
			await connect(deps, provider);
			provider.refreshTokens.clear();
			clock.now += 120_000;
			expect(await accessToken(deps, "probe", SERVER)).toBeNull();
			const saved = await credentials(deps, { probe: SERVER });
			expect(saved.probe).toMatchObject({
				status: "needs_reauth",
				statusDetail: "The refresh token is not valid.",
			});
			expect(await accessToken(deps, "probe", SERVER)).toBeNull();
		});
	});

	it("refreshes on the next request after the server refused the token", async () => {
		const provider = new TestProvider();
		await withFlow(provider, async (deps) => {
			await connect(deps, provider);
			const first = (await accessToken(deps, "probe", SERVER)) as string;
			await tokenRejected(deps, "probe", first);
			const next = await accessToken(deps, "probe", SERVER);
			expect(next).not.toBe(first);
			expect(provider.grants.at(-1)).toBe("refresh_token");
		});
	});

	it("uses the client the user gave, with its secret, and registers none", async () => {
		const provider = new TestProvider({
			registration: false,
			knownClient: { id: "my-app", secret: "my-secret" },
		});
		const server: CloudMcpServer = {
			url: RESOURCE,
			authType: "oauth",
			oauthClientId: "my-app",
			oauthClientSecret: "my-secret",
		};
		await withFlow(provider, async (deps) => {
			const { authorizationUrl } = await connect(deps, provider, "probe", server);
			expect(authorizationUrl.searchParams.get("client_id")).toBe("my-app");
			expect(provider.registrations).toBe(0);
			expect(provider.clientProofs).toEqual(["basic"]);
			expect(await accessToken(deps, "probe", server)).not.toBeNull();
			// Another client ID on the same server is not given this client's token.
			expect(await accessToken(deps, "probe", { ...server, oauthClientId: "other" })).toBeNull();
		});
	});

	it("asks for a client ID when the provider registers none", async () => {
		const provider = new TestProvider({ registration: false });
		await withFlow(provider, async (deps) => {
			const started = await beginConnect(deps, "probe", SERVER, CALLBACK);
			expect(started).toEqual({
				ok: false,
				error:
					"This server does not register clients itself. Enter a client ID under Advanced client identity.",
			});
		});
	});

	it("never sends a token to a server on another origin, and a save there forgets it", async () => {
		const provider = new TestProvider();
		await withFlow(provider, async (deps) => {
			await connect(deps, provider);
			const moved: CloudMcpServer = { url: "https://other.example/mcp", authType: "oauth" };
			expect(await accessToken(deps, "probe", moved)).toBeNull();
			// A new path on the same origin keeps the connection, as Conductor's does.
			const repathed: CloudMcpServer = { url: `${RESOURCE}/v2`, authType: "oauth" };
			expect(await accessToken(deps, "probe", repathed)).not.toBeNull();
			await prune(deps, { probe: SERVER }, { probe: moved });
			expect(await accessToken(deps, "probe", SERVER)).toBeNull();
			expect(await credentials(deps, { probe: SERVER })).toEqual({});
		});
	});

	it("forgets a deleted server's tokens and registration", async () => {
		const provider = new TestProvider();
		await withFlow(provider, async (deps) => {
			await connect(deps, provider);
			await prune(deps, { probe: SERVER }, {});
			expect(await deps.storage.list({ prefix: "" })).toEqual(new Map());
		});
	});

	it("tells a server that needs OAuth from one that does not", async () => {
		const provider = new TestProvider();
		expect(await detectAuth({ fetch: provider.fetch }, RESOURCE)).toBe("oauth");
		const open = async (request: Request): Promise<Response> =>
			new URL(request.url).pathname === "/mcp"
				? Response.json({ jsonrpc: "2.0", id: 0, result: {} })
				: new Response("not found", { status: 404 });
		expect(await detectAuth({ fetch: open }, "https://open.example/mcp")).toBe("none");
	});
});
