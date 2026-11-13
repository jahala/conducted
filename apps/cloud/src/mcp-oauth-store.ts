/**
 * @feature CLOUD-17 MCP servers in the cloud sandbox
 * Owns: the one Durable Object that keeps the cloud MCP servers' OAuth tokens, registered clients
 * and sign-ins in flight, and answers the front door and the outbound handler about them.
 * Behaviour: mcp-oauth.ts holds the flow; this object gives it storage, the network and the clock.
 * Must handle: two sandboxes asking for an expired token at once (one refresh, because one object
 * serves every request and its in-memory list of refreshes in flight is the only one).
 * Our design choice: a Durable Object rather than the settings bucket, because a refresh token a
 * provider rotates may be spent once only; two Workers refreshing it at once would lose the grant.
 * The tokens never leave this object except as the header the outbound handler sends.
 * Test first: refreshes an expired token once for two requests at the same moment.
 */
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env.ts";
import {
	accessToken,
	beginConnect,
	type CallbackOutcome,
	type CallbackQuery,
	type ConnectStatus,
	cancelConnect,
	completeConnect,
	connectStatus,
	credentials,
	disconnect,
	type McpCredential,
	type OAuthDeps,
	prune,
	tokenRejected,
} from "./mcp-oauth.ts";
import type { CloudMcpServer } from "./settings.ts";

/** The one object's name: a Worker belongs to one Mac (D106), so one store holds every token. */
export const MCP_OAUTH_OBJECT = "user";

export class McpOAuth extends DurableObject<Env> {
	readonly #inflight = new Map<string, Promise<string | null>>();

	#deps(): OAuthDeps {
		return {
			storage: this.ctx.storage,
			fetch: (request) => fetch(request),
			now: () => Date.now(),
			randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
			inflight: this.#inflight,
		};
	}

	async begin(
		name: string,
		server: CloudMcpServer,
		callbackUrl: string,
	): Promise<{ ok: true; authorizationUrl: string; state: string } | { ok: false; error: string }> {
		const started = await beginConnect(this.#deps(), name, server, callbackUrl);
		return started.ok ? { ok: true, ...started.value } : { ok: false, error: started.error };
	}

	complete(
		query: CallbackQuery,
		servers: Record<string, CloudMcpServer>,
	): Promise<CallbackOutcome> {
		return completeConnect(this.#deps(), query, servers);
	}

	status(name: string, state: string): Promise<ConnectStatus> {
		return connectStatus(this.#deps(), name, state);
	}

	cancel(name: string, state: string): Promise<boolean> {
		return cancelConnect(this.#deps(), name, state);
	}

	disconnect(name: string): Promise<void> {
		return disconnect(this.#deps(), name);
	}

	credentials(servers: Record<string, CloudMcpServer>): Promise<Record<string, McpCredential>> {
		return credentials(this.#deps(), servers);
	}

	accessToken(name: string, server: CloudMcpServer): Promise<string | null> {
		return accessToken(this.#deps(), name, server);
	}

	tokenRejected(name: string, token: string): Promise<void> {
		return tokenRejected(this.#deps(), name, token);
	}

	prune(
		before: Record<string, CloudMcpServer>,
		after: Record<string, CloudMcpServer>,
	): Promise<void> {
		return prune(this.#deps(), before, after);
	}
}
