/**
 * @feature CLOUD-05 Secrets stay outside the sandbox: the outbound handler swaps in the model key and GitHub token
 * Owns: every HTTP and HTTPS request from the sandbox's container. It allows GitHub's hosts, the
 * model APIs, the package registries CLOUD-04 lists and the personal cloud MCP servers' URL
 * prefixes, swaps the sandbox's placeholder credentials for the Worker's secrets, and refuses
 * every other host.
 * Behaviour: cloud-and-remote.md Part 1 ("Secrets never enter the sandbox"; the sandbox gets a
 * placeholder key and the Worker's outbound handler swaps in the real credential for the model
 * API and for `git` and `gh`), services-map.md 3.9 (git and `gh` reach GitHub without a token
 * inside the sandbox), D101 (the desktop launch carries `provided-by-worker`) and D102 (the
 * package hosts).
 * Must handle: a host outside the allow-list (403 naming the host), a missing model key (503 and
 * no request), a model API over plain HTTP (403), a redirect (the client asks again, so the next
 * hop is checked too), and a credential that never appears in a response or a log line.
 * Our design choice: redirects are answered to the sandbox rather than followed, so each hop
 * comes back through the same allow-list and credential swap.
 * Test first: replaces the sandbox's placeholder Anthropic key with the Worker's real key.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { WORKSPACE_NAME } from "./args.ts";
import { turnEndWorkspaceName } from "./backup.ts";
import type { Env } from "./env.ts";
import {
	gitHubAuthFor,
	gitHubAuthorization,
	isPackageRegistryHost,
	modelProviderFor,
	type OutboundSecrets,
} from "./outbound-hosts.ts";
import { type CloudMcpServer, cloudMcpServerForUrl, readCloudSettings } from "./settings.ts";

export type { OutboundSecrets } from "./outbound-hosts.ts";

const HTTPS = "https:";
const PLAIN_HTTP = "http:";

/** A plain-text answer, so the sandbox's client prints a sentence rather than a stack trace. */
function sentence(message: string, status: number): Response {
	return new Response(`${message}\n`, {
		status,
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
}

/** The request as it leaves the Worker. A manual redirect returns the hop for the client to repeat. */
function forwarded(request: Request, headers: Headers): Request {
	return new Request(request, { headers, redirect: "manual" });
}

/**
 * What to send for `request`: a prepared Request to fetch, or the Response the sandbox should see.
 * The Worker's secrets never reach the sandbox and never enter the answer.
 */
export function outboundRequest(
	request: Request,
	secrets: OutboundSecrets,
	mcpServers: Readonly<Record<string, CloudMcpServer>> = {},
): Request | Response {
	const url = new URL(request.url);

	// A cloud MCP server's URL is its own allow-list entry. The sandbox holds only placeholders;
	// the Worker puts the real token or header values in (CLOUD-17).
	const mcp = cloudMcpServerForUrl(request.url, mcpServers);
	if (mcp !== null) {
		if (url.protocol !== HTTPS) {
			return sentence(`${url.hostname} is reachable over HTTPS only`, 403);
		}
		const headers = new Headers(request.headers);
		const server = mcp.server;
		if (server.authType === "bearer") {
			if (server.bearerToken === undefined || server.bearerToken === "") {
				return sentence(`The Workspace has no MCP credential for ${mcp.name}.`, 503);
			}
			headers.set("authorization", `Bearer ${server.bearerToken}`);
		} else if (server.authType === "headers") {
			for (const [name, value] of Object.entries(server.headers ?? {})) {
				headers.set(name, value);
			}
		}
		return forwarded(request, headers);
	}

	const model = modelProviderFor(url.hostname);
	if (model !== undefined) {
		if (url.protocol !== HTTPS) {
			return sentence(`${url.hostname} is reachable over HTTPS only`, 403);
		}
		const key = secrets[model.secret];
		if (key === undefined || key === "") {
			return sentence(`The Workspace has no ${model.secret} in its Worker secrets.`, 503);
		}
		const headers = new Headers(request.headers);
		for (const name of model.clear) headers.delete(name);
		headers.set(model.header, `${model.prefix}${key}`);
		return forwarded(request, headers);
	}

	const auth = gitHubAuthFor(url.hostname);
	if (auth !== undefined) {
		if (url.protocol !== HTTPS) {
			return sentence(`${url.hostname} is reachable over HTTPS only`, 403);
		}
		const headers = new Headers(request.headers);
		const token = secrets.GITHUB_TOKEN;
		if (token === undefined || token === "") {
			// Without a token public work still runs; private work gets GitHub's own 401.
			headers.delete("authorization");
		} else {
			headers.set("authorization", gitHubAuthorization(auth, token));
		}
		return forwarded(request, headers);
	}

	if (isPackageRegistryHost(url.hostname)) {
		if (url.protocol !== HTTPS && url.protocol !== PLAIN_HTTP) {
			return sentence(`${url.hostname} is reachable over HTTP and HTTPS only`, 403);
		}
		return forwarded(request, new Headers(request.headers));
	}

	console.log(`outbound refused: ${url.protocol}//${url.hostname}${url.pathname}`);
	return sentence(`${url.hostname} is not reachable from this sandbox`, 403);
}

/**
 * Every request from the sandbox's container reaches this Worker entrypoint. It sends the
 * prepared request on and hands the answer back unchanged.
 */
export class Outbound extends WorkerEntrypoint<Env> {
	override async fetch(request: Request): Promise<Response> {
		// The sandbox entry's turn-end call asks the workspace's Durable Object for a backup (D105).
		const backupOf = turnEndWorkspaceName(new URL(request.url));
		if (backupOf !== null) {
			if (request.method !== "POST") {
				return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
			}
			if (!WORKSPACE_NAME.test(backupOf))
				return new Response("Bad workspace name", { status: 400 });
			return Response.json(await this.env.WORKSPACE.getByName(backupOf).backupAtTurnEnd());
		}
		// The personal cloud MCP servers are the Worker's saved settings. A settings read that
		// fails leaves them empty, so model, GitHub and package traffic still works; the settings
		// page is where a broken bucket is reported.
		let mcpServers: Readonly<Record<string, CloudMcpServer>> = {};
		try {
			mcpServers = (await readCloudSettings(this.env)).mcpServers;
		} catch (error) {
			console.error(`outbound could not read cloud MCP settings: ${String(error)}`);
		}
		const prepared = outboundRequest(request, this.env, mcpServers);
		if (prepared instanceof Response) return prepared;
		return fetch(prepared);
	}
}
