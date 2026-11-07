/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Owns: the Worker's front door: it checks the pairing token on every request and routes each
 * workspace's git, shell, file and sidecar-relay calls to that workspace's Durable Object.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (the desktop reaches the user's Worker over
 * HTTPS and one WebSocket; the Worker authenticates and routes). The sandbox's outbound
 * credential swap is outbound.ts (CLOUD-05). Route list and measurements:
 * docs/research/cloud-spike-2026-11-06.md.
 * Must handle: 401 before any Durable Object for a missing or wrong token; 404 for an unknown
 * route; 400 for a bad workspace name or body; 405 for the wrong method; 426 for a non-WebSocket
 * relay request; the sandbox's own error text in a 500 rather than a stack.
 * Our design choice: the route names are ours (`/w/<name>/<action>`), matching the spike's shape,
 * because the research gives Conductor's cloud backend only as a concept.
 * Test first: every route answers 401 without the token, and a good token reaches the route.
 */
import { INVALID_BODY, zExecBody, zFileBody, zGitBody } from "./args.ts";
import { isAuthorized } from "./auth.ts";
import type { Env } from "./env.ts";
import { Outbound } from "./outbound.ts";
import { Workspace } from "./workspace.ts";

export { Outbound, Workspace };

const ROUTE = /^\/w\/([^/]+)\/(start|git|exec|files|state|rpc)$/;
/** A sandbox name is safe in a URL and stable across deploys. */
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const METHOD: Readonly<Record<string, "GET" | "POST">> = {
	state: "GET",
	rpc: "GET",
	start: "POST",
	git: "POST",
	exec: "POST",
	files: "POST",
};

function failure(error: unknown): Response {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`route failed: ${message}`);
	return Response.json({ error: message }, { status: 500 });
}

async function bodyOf<T>(
	request: Request,
	schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
): Promise<T | null> {
	let parsed: unknown;
	try {
		parsed = await request.json();
	} catch {
		return null;
	}
	const result = schema.safeParse(parsed);
	return result.success ? result.data : null;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (!isAuthorized(request, env.PAIRING_TOKEN)) {
			return new Response("Unauthorized", { status: 401 });
		}
		const url = new URL(request.url);
		const match = ROUTE.exec(url.pathname);
		if (match === null) return new Response("Not found", { status: 404 });
		const [, name, action] = match as unknown as [string, string, string];
		if (!NAME.test(name)) return new Response("Bad workspace name", { status: 400 });
		const expected = METHOD[action];
		if (expected === undefined) return new Response("Not found", { status: 404 });
		if (request.method !== expected) {
			return new Response("Method not allowed", {
				status: 405,
				headers: { allow: expected },
			});
		}
		const workspace = env.WORKSPACE.getByName(name);
		try {
			switch (action) {
				case "state":
					return Response.json(await workspace.state());
				case "start":
					return Response.json(await workspace.start());
				case "git": {
					const body = await bodyOf(request, zGitBody);
					if (body === null) return new Response(INVALID_BODY, { status: 400 });
					return Response.json(await workspace.git(body.args, body.cwd));
				}
				case "exec": {
					const body = await bodyOf(request, zExecBody);
					if (body === null) return new Response(INVALID_BODY, { status: 400 });
					return Response.json(await workspace.exec(body));
				}
				case "files": {
					const body = await bodyOf(request, zFileBody);
					if (body === null) return new Response(INVALID_BODY, { status: 400 });
					return Response.json(await workspace.filesOperation(body));
				}
				case "rpc":
					if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
						return new Response("Expected a WebSocket", { status: 426 });
					}
					return workspace.fetch(request);
			}
			return new Response("Not found", { status: 404 });
		} catch (error) {
			return failure(error);
		}
	},
} satisfies ExportedHandler<Env>;
