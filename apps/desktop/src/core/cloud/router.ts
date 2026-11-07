/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Owns: sending a chat call to the sidecar that owns its workspace: the local sidecar for a Mac
 * workspace, the sandbox's sidecar through the Worker for a cloud one. It also removes the
 * provider keys from a cloud launch, because a real key must never enter a sandbox (the plan,
 * "Secrets never enter the sandbox"; CLOUD-05 swaps it back in at the Worker).
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 (the sidecar runs unchanged in the sandbox; its
 * NDJSON stream travels over the Worker's WebSocket), frontend.md 3c (a cloud host's chat goes to
 * the cloud sidecar).
 * Must handle: a call with a session id, a workspace context, a workspace path or a cwd resolves
 * its host; a call that names none of them goes to the local sidecar; a cloud `sendMessage`,
 * `warmAgent` or `runUtilityPrompt` carries the placeholder key instead of the user's; a local
 * call is passed through untouched.
 * Our design choice: the placeholder is the string the CLOUD-02 spike used,
 * `provided-by-worker`. The Worker's outbound handler replaces it for the model API only.
 * Test first: a cloud chat's sendMessage goes to the cloud tunnel with the placeholder, and a
 * local chat's goes to the local tunnel with its key.
 */
import type { Host } from "@conducted/protocol";
import type { SidecarClient } from "../sidecar/tunnel.ts";

type CloudHost = Extract<Host, { kind: "cloud" }>;

/** The key the sandbox's agent gets in place of the real provider key. */
export const CLOUD_PROVIDER_KEY_PLACEHOLDER = "provided-by-worker";
/**
 * Where the interim (CLOUD-02) sandbox image installs Claude Code. CLOUD-04 replaces this with the
 * sidecar's managed install; D101 records the interim choice.
 */
export const CLOUD_CLAUDE_PATH = "/usr/local/bin/claude";

type Params = Record<string, unknown>;

/** Methods whose launch carries provider keys. */
const LAUNCH_METHODS = new Set(["sendMessage", "warmAgent", "runUtilityPrompt"]);

/** The host a call belongs to, or null for the local sidecar. */
export type HostResolver = (method: string, params: unknown) => CloudHost | null;

export interface HostRoutedDeps {
	local: SidecarClient;
	/** The cloud tunnel for one Worker and sandbox, made on first use. */
	tunnelFor: (host: CloudHost) => SidecarClient;
	/** Which cloud host a request belongs to. */
	hostOf: HostResolver;
}

/**
 * Replaces every provider key with the placeholder the Worker understands, and drops the Mac's
 * program path: the sandbox image supplies its own agent programs (CLOUD-04).
 */
export function withoutProviderKeys(method: string, params: unknown): unknown {
	if (!LAUNCH_METHODS.has(method) || typeof params !== "object" || params === null) return params;
	const record = params as Params;
	const launch = record.launch;
	if (typeof launch !== "object" || launch === null) return params;
	const { executablePath: _macProgram, ...rest } = launch as Record<string, unknown>;
	const config = record.config;
	const agent =
		typeof config === "object" && config !== null
			? (config as { agent?: unknown }).agent
			: record.agent;
	if (agent === "claude") {
		// Until CLOUD-04 builds the product's image, the spike image has Claude at this path.
		rest.executablePath = CLOUD_CLAUDE_PATH;
	}
	const providerKeys = rest.providerKeys;
	if (typeof providerKeys !== "object" || providerKeys === null) {
		return { ...record, launch: rest };
	}
	const cleaned: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(providerKeys)) {
		const source =
			typeof value === "object" && value !== null && "source" in value
				? (value as { source?: unknown }).source
				: undefined;
		cleaned[name] = {
			value: CLOUD_PROVIDER_KEY_PLACEHOLDER,
			source: source === "this_mac" ? "this_mac" : "entered",
		};
	}
	return { ...record, launch: { ...rest, providerKeys: cleaned } };
}

/** A sidecar client that picks the tunnel by the workspace the call names. */
export function createHostRoutedSidecar(deps: HostRoutedDeps): SidecarClient {
	const tunnelFor = (host: CloudHost): SidecarClient => deps.tunnelFor(host);
	return {
		request: (method, params) => {
			const host = deps.hostOf(method, params);
			if (host === null) return deps.local.request(method, params);
			return tunnelFor(host).request(method, withoutProviderKeys(method, params) as typeof params);
		},
		notify: (method, params) => {
			const host = deps.hostOf(method, params);
			return host === null
				? deps.local.notify(method, params)
				: tunnelFor(host).notify(method, params);
		},
	};
}
