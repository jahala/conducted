/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Makes `env` from `cloudflare:test` carry this Worker's bindings. The Workers test types read
 * `Cloudflare.Env`, which is empty without `wrangler types`, so the two names meet here.
 */
import type { Env as WorkerEnv } from "./env.ts";

declare global {
	namespace Cloudflare {
		interface Env extends WorkerEnv {}
	}
}
