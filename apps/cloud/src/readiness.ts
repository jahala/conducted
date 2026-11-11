/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the Worker's answer to "can this Worker create a cloud workspace": whether it holds a
 * GitHub token and which model keys it holds, as booleans only.
 * Behaviour: Conductor's new-workspace page reads its readiness from its own service before it
 * lets a cloud workspace launch (renderApp `RYa`, @11441691: GitHub access, an agent API key, a
 * ready computer). Our cloud has no shared computer, so the Worker answers for the two secrets
 * its outbound handler swaps in (D104): `GITHUB_TOKEN` for git and gh, and a model key.
 * Must handle: a secret that is unset or empty counts as missing; no secret's value, length or
 * prefix ever leaves the Worker; the route starts no Durable Object, so it answers before the
 * first workspace exists.
 * Our design choice: the route is `GET /readiness`, behind the same token check as every route.
 * D127 records it.
 * Test first: the readiness answer reports which secrets are set and never their values.
 */
import type { Env } from "./env.ts";

/** The one path that answers which secrets the Worker holds. */
export const READINESS_PATH = "/readiness";

/** What the Worker can do for a cloud workspace, as the new-workspace page reads it. */
export interface Readiness {
	/** True when the outbound handler has a GitHub token to swap in for git and gh. */
	github: boolean;
	/** True for each model API whose key the outbound handler can swap in. */
	agents: { anthropic: boolean; openai: boolean; cursor: boolean };
}

const held = (value: string | undefined): boolean => typeof value === "string" && value !== "";

/** Which secrets `env` holds, as booleans. */
export function readinessOf(
	env: Pick<Env, "GITHUB_TOKEN" | "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "CURSOR_API_KEY">,
): Readiness {
	return {
		github: held(env.GITHUB_TOKEN),
		agents: {
			anthropic: held(env.ANTHROPIC_API_KEY),
			openai: held(env.OPENAI_API_KEY),
			cursor: held(env.CURSOR_API_KEY),
		},
	};
}
