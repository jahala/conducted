/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the Worker's answers to the MCP page's OAuth routes (the credentials and callback URL, a
 * connect, its status, a cancel, a disconnect, and the detection an import asks for) and the
 * page the browser shows when the provider sends it back to the callback.
 * Behaviour: Conductor's service routes, as its bundle calls them (main-BE1h_1MP.js @903202 to
 * @903900): the list carries `oauthCallbackUrl` and each server's `credential` (`m$e` @160364);
 * `connect` answers `authorizationUrl` and `state`; `connect/status?state=` answers `status`;
 * `connect/cancel` takes `{state}` and answers `cancelled`; `disconnect` answers an object. Ours
 * sit under `/mcp-oauth` behind the pairing token, beside `/settings`, which holds the servers.
 * Must handle: a server that does not exist (404) or does not use OAuth (400); a provider the
 * Worker cannot use (400 with the reason, which the page toasts); a callback with no or an unknown
 * state (400, nothing stored); and a callback page that loads nothing from anywhere.
 * Our design choice: the callback page is our own short text, because Conductor's callback page is
 * on its hosted service and not in its bundle. The callback URL is this Worker's own origin, so a
 * user who registers their own OAuth app copies it from the page.
 * Test first: mcp-oauth-routes.test.ts connects a server through the routes and the callback.
 */

import type { Env } from "./env.ts";
import type { McpOAuthRoute } from "./front-door.ts";
import { detectAuth, MCP_OAUTH_CALLBACK_PATH } from "./mcp-oauth.ts";
import { MCP_OAUTH_OBJECT } from "./mcp-oauth-store.ts";
import { type CloudMcpServer, readCloudSettings } from "./settings.ts";

/** The store every OAuth answer comes from. */
export function mcpOAuthStore(env: Pick<Env, "MCP_OAUTH">) {
	return env.MCP_OAUTH.getByName(MCP_OAUTH_OBJECT);
}

/** This Worker's callback URL, from the origin the request came to. */
export function callbackUrlFor(request: Request): string {
	return new URL(MCP_OAUTH_CALLBACK_PATH, request.url).toString();
}

const refusal = (error: string, status: number): Response => Response.json({ error }, { status });

async function stateOf(request: Request): Promise<string | null> {
	try {
		const body = (await request.json()) as { state?: unknown };
		return typeof body.state === "string" && body.state !== "" ? body.state : null;
	} catch {
		return null;
	}
}

/** Answers one authenticated MCP OAuth route. */
export async function answerMcpOAuth(
	request: Request,
	env: Env,
	route: McpOAuthRoute,
): Promise<Response> {
	const store = mcpOAuthStore(env);
	if (route.kind === "detect") {
		let url: string | null = null;
		try {
			const body = (await request.json()) as { url?: unknown };
			url = typeof body.url === "string" ? body.url : null;
		} catch {
			url = null;
		}
		if (url === null || !url.startsWith("https://")) {
			return refusal("Enter an HTTPS server URL", 400);
		}
		try {
			new URL(url);
		} catch {
			return refusal("Enter a valid server URL", 400);
		}
		return Response.json({ authType: await detectAuth({ fetch: (r) => fetch(r) }, url) });
	}
	const servers = (await readCloudSettings(env)).mcpServers;
	if (route.kind === "list") {
		return Response.json({
			callbackUrl: callbackUrlFor(request),
			servers: await store.credentials(servers),
		});
	}
	const server: CloudMcpServer | undefined = servers[route.name];
	if (route.kind === "disconnect") {
		await store.disconnect(route.name);
		return Response.json({});
	}
	if (route.kind === "status") {
		return Response.json({ status: await store.status(route.name, route.state) });
	}
	if (route.kind === "cancel") {
		const state = await stateOf(request);
		if (state === null) return refusal("Missing state", 400);
		return Response.json({ cancelled: await store.cancel(route.name, state) });
	}
	if (server === undefined) return refusal(`There is no MCP server named ${route.name}.`, 404);
	if (server.authType !== "oauth") return refusal(`${route.name} does not use OAuth.`, 400);
	const started = await store.begin(route.name, server, callbackUrlFor(request));
	if (!started.ok) return refusal(started.error, 400);
	return Response.json({ authorizationUrl: started.authorizationUrl, state: started.state });
}

const escapeHtml = (text: string): string =>
	text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");

/** A page that loads nothing and runs nothing: the browser only shows its text. */
function page(title: string, body: string, status: number): Response {
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:32rem;margin:20vh auto;padding:0 1.5rem;color:#1f2328}h1{font-size:1.25rem;font-weight:600;margin:0 0 .5rem}p{margin:0;color:#57606a}@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}p{color:#9198a1}}</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></body></html>`;
	return new Response(html, {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
			"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
			"referrer-policy": "no-referrer",
		},
	});
}

/** The callback the provider sends the browser to. It carries no pairing token: the state is the proof. */
export async function answerMcpOAuthCallback(request: Request, env: Env): Promise<Response> {
	if (request.method !== "GET") {
		return new Response("Method not allowed", { status: 405, headers: { allow: "GET" } });
	}
	const query = new URL(request.url).searchParams;
	const state = query.get("state");
	if (state === null || state === "") {
		return page("This sign-in link is not valid", "Go back to Conducted and connect again.", 400);
	}
	const servers = (await readCloudSettings(env)).mcpServers;
	const outcome = await mcpOAuthStore(env).complete(
		{
			state,
			code: query.get("code"),
			error: query.get("error"),
			errorDescription: query.get("error_description"),
			iss: query.get("iss"),
		},
		servers,
	);
	if (outcome.outcome === "connected") {
		return page(
			`${outcome.name} is connected`,
			"You can close this tab and go back to Conducted.",
			200,
		);
	}
	if (outcome.outcome === "failed") {
		return page(
			`Couldn't connect ${outcome.name}`,
			`${outcome.detail} Go back to Conducted and connect again.`,
			400,
		);
	}
	return page("This sign-in link has expired", "Go back to Conducted and connect again.", 400);
}
