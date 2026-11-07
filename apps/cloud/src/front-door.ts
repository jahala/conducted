/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * @feature CLOUD-07 Pair the desktop app with the user's Worker
 * @feature CLOUD-09 Cloud terminals, run scripts and previews
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * @feature CLOUD-17 Cloud settings page
 * Owns: the checks every request passes after the unauthenticated preview path and before a
 * Durable Object is touched: the pairing token, the pairing check, the cloud settings read and
 * write, the route, the workspace name, the method, and the WebSocket upgrade for the relay and
 * terminal streams.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (the Worker authenticates and routes) and
 * docs/research/cloud-spike-2026-11-06.md, question 4 (the token is checked on every route in
 * constant time before any Durable Object starts). CLOUD-07: `/pair` answers with the Worker's own
 * name after the token check.
 * Must handle: 401 before any Durable Object for a missing or wrong token; 404 for an unknown
 * route; 400 for a bad workspace name; 405 for the wrong method with an `allow` header; 426 for a
 * relay, terminal or tunnel request that is not a WebSocket.
 * Our design choice: the front door is its own module so the Worker and the relay integration
 * test's Worker share the same checks, and the test needs no copy of them.
 * Test first: an unknown route refuses a request without the pairing token.
 */
import { WORKSPACE_NAME } from "./args.ts";
import { isAuthorized, PAIR_PATH } from "./auth.ts";

/** A workspace route: one workspace name and one action. */
export type CloudAction =
	| "start"
	| "stop"
	| "remove"
	| "git"
	| "exec"
	| "files"
	| "state"
	| "ports"
	| "rpc"
	| "terminal"
	| "tunnel"
	| "preview-url";

export interface CloudRoute {
	name: string;
	action: CloudAction;
}

/** What an authenticated request is: a route, the pairing check, cloud settings, or a refusal. */
export type FrontDoor =
	| { route: CloudRoute }
	| { pair: true }
	| { settings: "read" | "write" }
	| { refusal: Response };

/** The one path that holds the Mac's personal cloud settings (CLOUD-17). */
export const SETTINGS_PATH = "/settings";

const ROUTE =
	/^\/w\/([^/]+)\/(start|stop|remove|git|exec|files|state|ports|rpc|terminal|tunnel|preview-url)$/;

const METHOD: Readonly<Record<CloudAction, "GET" | "POST">> = {
	state: "GET",
	ports: "GET",
	rpc: "GET",
	terminal: "GET",
	tunnel: "GET",
	"preview-url": "POST",
	start: "POST",
	stop: "POST",
	remove: "POST",
	git: "POST",
	exec: "POST",
	files: "POST",
};

/** The streams that must arrive as a WebSocket, never a plain GET. */
const STREAMS: ReadonlySet<CloudAction> = new Set(["rpc", "terminal", "tunnel"]);

/**
 * The route a request may reach, or the response that refuses it. A refusal is a finished answer:
 * no Durable Object is touched.
 */
export function routeRequest(request: Request, pairingToken: string | undefined): FrontDoor {
	if (!isAuthorized(request, pairingToken)) {
		return { refusal: new Response("Unauthorized", { status: 401 }) };
	}
	const url = new URL(request.url);
	if (url.pathname === PAIR_PATH) {
		if (request.method !== "GET") {
			return {
				refusal: new Response("Method not allowed", {
					status: 405,
					headers: { allow: "GET" },
				}),
			};
		}
		return { pair: true };
	}
	if (url.pathname === SETTINGS_PATH) {
		if (request.method !== "GET" && request.method !== "POST") {
			return {
				refusal: new Response("Method not allowed", {
					status: 405,
					headers: { allow: "GET, POST" },
				}),
			};
		}
		return { settings: request.method === "GET" ? "read" : "write" };
	}
	const match = ROUTE.exec(url.pathname);
	if (match === null) return { refusal: new Response("Not found", { status: 404 }) };
	const [, name, action] = match as unknown as [string, string, CloudAction];
	if (!WORKSPACE_NAME.test(name)) {
		return { refusal: new Response("Bad workspace name", { status: 400 }) };
	}
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
	if (STREAMS.has(action) && request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
		return { refusal: new Response("Expected a WebSocket", { status: 426 }) };
	}
	return { route: { name, action } };
}
