/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Owns: the Worker the Rust relay integration test runs in Cloudflare's local runtime. It is never
 * deployed: `wrangler.e2e.jsonc` points at it, and `wrangler.jsonc` keeps the real Worker.
 * Behaviour: docs/research/cloud-spike-2026-11-06.md, question 4 (the token travels in the
 * `Authorization` header and is checked on every route) and D101 (the relay frames one line).
 * Our design choice: the Durable Object here echoes each frame in place of the sandbox sidecar.
 * The relay route's sandbox needs a Docker container, so the integration test covers the relay's
 * headers and line framing against the real front door (front-door.ts, the same module the
 * deployed Worker uses) and leaves the sandboxed sidecar to the live run. No route exists here
 * that the deployed Worker does not have.
 * Must handle: a missing or wrong pairing token gets 401 before the Durable Object; a request to
 * the relay or terminal route that is not a WebSocket gets 426.
 * Test first: the relay's line reaches the Worker and its answer comes back.
 */
import { DurableObject } from "cloudflare:workers";
import { pairAnswer } from "./auth.ts";
import { routeRequest } from "./front-door.ts";

interface TestEnv {
	/** The echo Durable Object, one per workspace name. */
	WORKSPACE: DurableObjectNamespace;
	/** The test pairing token `wrangler dev` passes as a variable. */
	PAIRING_TOKEN: string;
}

/** Echoes every WebSocket frame, so the relay's framing is visible to the test. */
export class EchoWorkspace extends DurableObject {
	override async fetch(request: Request): Promise<Response> {
		const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
		server.accept();
		server.addEventListener("message", (event: MessageEvent) => {
			server.send(event.data);
		});
		return new Response(null, { status: 101, webSocket: client });
	}
}

export default {
	async fetch(request: Request, env: TestEnv): Promise<Response> {
		const routed = routeRequest(request, env.PAIRING_TOKEN);
		if ("refusal" in routed) return routed.refusal;
		if ("pair" in routed) return pairAnswer();
		if ("settings" in routed) return new Response("Not found", { status: 404 });
		return env.WORKSPACE.getByName(routed.route.name).fetch(request);
	},
} satisfies ExportedHandler<TestEnv>;
