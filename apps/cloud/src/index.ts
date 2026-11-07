/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * @feature CLOUD-06 Keep work across sandbox restarts
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * @feature CLOUD-12 SSH into a cloud workspace and open it in a local editor
 * @feature CLOUD-17 Cloud settings page
 * Owns: the Worker's front door: it checks the pairing token on every request, answers the
 * desktop's pairing check (`/pair`), reads and writes the Mac's personal cloud settings at
 * `/settings`, and routes each workspace's git, shell, file, terminal, preview and sidecar-relay
 * calls to that workspace's Durable Object. Its outbound handler also carries the sandbox entry's
 * turn-end backup call.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (the desktop reaches the user's Worker over
 * HTTPS and one WebSocket; the Worker authenticates and routes). CLOUD-10 adds the tunnel route
 * the Rust shell piped a local listener into, beside the preview route (D110). The sandbox's outbound
 * credential swap is outbound.ts (CLOUD-05), which also carries the sandbox entry's turn-end
 * backup call (D105), and the unauthenticated preview path, whose capability token is checked
 * here (D108). Route list and measurements: docs/research/cloud-spike-2026-11-06.md.
 * Must handle: 401 before any Durable Object for a missing or wrong token; 404 for an unknown
 * route; 400 for a bad workspace name or body; 405 for the wrong method; 426 for a non-WebSocket
 * relay request; the sandbox's own error text in a 500 rather than a stack.
 * Our design choice: the route names are ours (`/w/<name>/<action>`), matching the spike's shape,
 * because the research gives Conductor's cloud backend only as a concept. The authenticated checks
 * live in front-door.ts, so the relay's integration test runs the same checks as the deployed
 * Worker.
 * Test first: every route answers 401 without the token, and a good token reaches the route.
 */
import { DirectoryBackupGateway } from "@cloudflare/sandbox";
import {
	INVALID_BODY,
	WORKSPACE_NAME,
	zExecBody,
	zFileBody,
	zGitBody,
	zPreviewBody,
	zSshKeyBody,
} from "./args.ts";
import { pairAnswer } from "./auth.ts";
import type { Env } from "./env.ts";
import { routeRequest } from "./front-door.ts";
import { Outbound } from "./outbound.ts";
import { readCloudSettings, writeCloudSettings, zCloudSettings } from "./settings.ts";
import { previewToken, previewTokenMatches } from "./terminal.ts";
import { Workspace } from "./workspace.ts";

export { DirectoryBackupGateway, Outbound, Workspace };

/** A preview URL carries its capability in the path, so a browser needs no pairing token. */
const PREVIEW_PROXY = /^\/w\/([^/]+)\/preview\/([A-Za-z0-9_-]{43})\/(\d{1,5})(\/.*)?$/;
/** Ports a preview or a forward may not use. 22 is SSH, as the research names. */
const RESERVED_PORTS = new Set([22]);

/** A preview or forward port, or null when the number is not one it may use. */
function forwardablePort(raw: string | null): number | null {
	if (raw === null || !/^\d{1,5}$/.test(raw)) return null;
	const port = Number(raw);
	return port >= 1 && port <= 65535 && !RESERVED_PORTS.has(port) ? port : null;
}

/** The absolute preview URL for one port. */
async function previewUrl(request: Request, env: Env, name: string, port: number): Promise<string> {
	const token = await previewToken(env.PAIRING_TOKEN, name, port);
	return new URL(`/w/${name}/preview/${token}/${port}/`, request.url).toString();
}

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
		const url = new URL(request.url);
		const preview = PREVIEW_PROXY.exec(url.pathname);
		if (preview !== null) {
			const [, name, token, rawPort, rest] = preview as unknown as [
				string,
				string,
				string,
				string,
				string | undefined,
			];
			if (!WORKSPACE_NAME.test(name)) return new Response("Bad workspace name", { status: 400 });
			const port = forwardablePort(rawPort);
			if (port === null) return new Response("Bad preview port", { status: 400 });
			const expectedToken = await previewToken(env.PAIRING_TOKEN, name, port);
			if (!previewTokenMatches(expectedToken, token)) {
				return new Response("Forbidden", { status: 403 });
			}
			const workspace = env.WORKSPACE.getByName(name);
			try {
				// The Durable Object's own `fetch` answers the proxy, because the Response may hold a
				// WebSocket or a stream that RPC cannot serialize.
				return await workspace.fetch(request);
			} catch (error) {
				return failure(error);
			}
		}
		const routed = routeRequest(request, env.PAIRING_TOKEN);
		if ("refusal" in routed) return routed.refusal;
		if ("pair" in routed) return pairAnswer();
		if ("settings" in routed) {
			if (routed.settings === "read") {
				try {
					return Response.json(await readCloudSettings(env));
				} catch (error) {
					return failure(error);
				}
			}
			let parsed: unknown;
			try {
				parsed = await request.json();
			} catch {
				return new Response(INVALID_BODY, { status: 400 });
			}
			const body = zCloudSettings.safeParse(parsed);
			if (!body.success) {
				// The page shows the reason, so a refused name says what to change.
				return Response.json(
					{ error: body.error.issues[0]?.message ?? INVALID_BODY },
					{ status: 400 },
				);
			}
			try {
				await writeCloudSettings(env, body.data);
				return Response.json(body.data);
			} catch (error) {
				return failure(error);
			}
		}
		const { name, action } = routed.route;
		const workspace = env.WORKSPACE.getByName(name);
		try {
			switch (action) {
				case "state":
					return Response.json(await workspace.state());
				case "ports":
					return Response.json(await workspace.listeningPorts());
				case "start":
					return Response.json(await workspace.start());
				case "stop":
					return Response.json(await workspace.stop());
				case "remove":
					return Response.json(await workspace.remove());
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
					return workspace.fetch(request);
				case "terminal":
					return workspace.fetch(request);
				case "tunnel": {
					const port = forwardablePort(url.searchParams.get("port"));
					if (port === null) return new Response("Bad tunnel port", { status: 400 });
					return workspace.fetch(request);
				}
				case "ssh":
					// The SSH response holds a WebSocket, which RPC cannot serialize; the Durable
					// Object's own fetch answers it, as it does the relay and the terminal.
					return workspace.fetch(request);
				case "ssh-key": {
					const body = await bodyOf(request, zSshKeyBody);
					if (body === null) return new Response(INVALID_BODY, { status: 400 });
					return Response.json(await workspace.installSshKey(body.publicKey));
				}
				case "preview-url": {
					const body = await bodyOf(request, zPreviewBody);
					if (body === null) return new Response(INVALID_BODY, { status: 400 });
					const port = forwardablePort(String(body.port));
					if (port === null) return new Response("Bad preview port", { status: 400 });
					return Response.json({ url: await previewUrl(request, env, name, port) });
				}
			}
			return new Response("Not found", { status: 404 });
		} catch (error) {
			return failure(error);
		}
	},
} satisfies ExportedHandler<Env>;
