/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Owns: what a relayed line says about a turn, so the Durable Object can hold the sandbox awake
 * while work runs and let it sleep when the work is done.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1, "Keeping the agent alive" (the Durable Object
 * must hold an alarm while a turn runs; the spike could read turn state only while the desktop was
 * connected, because the state flows through the relay).
 * Must handle: a line that is not JSON, a binary frame, and a JSON-RPC method with nothing to say
 * about turns all report "no change"; a `sendMessage` request starts a turn; the sidecar's
 * `liveState` notification says working or idle. Anything else is left alone.
 * Test first: `sendMessage` reports working, a working and an idle `liveState` report themselves,
 * and a malformed line reports nothing.
 */

export type TurnSignal = "working" | "idle";

/** A binary frame as text; null when the bytes are not UTF-8. */
export function textOf(frame: string | ArrayBuffer): string | null {
	if (typeof frame === "string") return frame;
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(frame);
	} catch {
		return null;
	}
}

/**
 * The turn state a relayed line changes, or null when it says nothing about a turn.
 * The UI sends `sendMessage` as a JSON-RPC request; the sidecar sends `liveState` as a notification.
 */
export function turnSignalOf(line: string): TurnSignal | null {
	let message: unknown;
	try {
		message = JSON.parse(line);
	} catch {
		return null;
	}
	if (typeof message !== "object" || message === null) return null;
	const method = (message as { method?: unknown }).method;
	if (method === "sendMessage") return "working";
	if (method !== "liveState") return null;
	const params = (message as { params?: unknown }).params;
	if (typeof params !== "object" || params === null) return null;
	const live = (params as { liveState?: unknown }).liveState;
	if (typeof live !== "object" || live === null) return null;
	const status = (live as { status?: unknown }).status;
	return status === "working" || status === "idle" ? status : null;
}
