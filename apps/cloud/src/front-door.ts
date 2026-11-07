/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Owns: the checks every request passes before a Durable Object is touched: the pairing token, the
 * route, the workspace name, the method, and the relay's upgrade header.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (the Worker authenticates and routes) and
 * docs/research/cloud-spike-2026-11-06.md, question 4 (the token is checked on every route in
 * constant time before any Durable Object starts).
 * Must handle: 401 before any Durable Object for a missing or wrong token; 404 for an unknown
 * route; 400 for a bad workspace name; 405 for the wrong method with an `allow` header; 426 for a
 * relay request that is not a WebSocket.
 * Our design choice: the front door is its own module so the Worker and the relay integration
 * test's Worker share the same checks, and the test needs no copy of them.
 * Test first: an unknown route refuses a request without the pairing token.
 */
import { isAuthorized } from "./auth.ts";

/** A workspace route: one workspace name and one action. */
export type CloudAction = "start" | "git" | "exec" | "files" | "state" | "rpc";

export interface CloudRoute {
	name: string;
	action: CloudAction;
}

const ROUTE = /^\/w\/([^/]+)\/(start|git|exec|files|state|rpc)$/;
/** A sandbox name is safe in a URL and stable across deploys. */
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const METHOD: Readonly<Record<CloudAction, "GET" | "POST">> = {
	state: "GET",
	rpc: "GET",
	start: "POST",
	git: "POST",
	exec: "POST",
	files: "POST",
};

/**
 * The route a request may reach, or the response that refuses it. A refusal is a finished answer:
 * no Durable Object is touched.
 */
export function routeRequest(
	request: Request,
	pairingToken: string | undefined,
): { route: CloudRoute } | { refusal: Response } {
	if (!isAuthorized(request, pairingToken)) {
		return { refusal: new Response("Unauthorized", { status: 401 }) };
	}
	const url = new URL(request.url);
	const match = ROUTE.exec(url.pathname);
	if (match === null) return { refusal: new Response("Not found", { status: 404 }) };
	const [, name, action] = match as unknown as [string, string, CloudAction];
	if (!NAME.test(name)) return { refusal: new Response("Bad workspace name", { status: 400 }) };
	const expected = METHOD[action];
	if (expected === undefined) return { refusal: new Response("Not found", { status: 404 }) };
	if (request.method !== expected) {
		return {
			refusal: new Response("Method not allowed", {
				status: 405,
				headers: { allow: expected },
			}),
		};
	}
	if (action === "rpc" && request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
		return { refusal: new Response("Expected a WebSocket", { status: 426 }) };
	}
	return { route: { name, action } };
}
