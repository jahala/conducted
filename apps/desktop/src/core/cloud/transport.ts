/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Owns: the `SidecarTransport` the JSON-RPC tunnel speaks to a sidecar inside a sandbox. It opens
 * the Worker's relay, forwards lines, and turns a closed relay into a restart signal, exactly as
 * the Rust shell does for the local sidecar's socket.
 * Behaviour: docs/plans/cloud-and-remote.md Part 1 ("the Rust shell owns the cloud connection")
 * and cloud-spike-2026-11-06.md question 3 (the relay carries the same NDJSON protocol).
 * Must handle: a line with a newline is refused with `sidecar_bad_line`; opening twice returns the
 * same relay; a closed relay clears the relay so the tunnel's reconnect opens a new one; a line
 * that arrives before a UI listener is attached is dropped as the local transport does; close ends
 * the relay and silences its listeners.
 * Test first: open, send and receive one line, then a closed relay reports one restart.
 */
import type { Host } from "@conducted/protocol";
import { appError, err, LineSplitter, ok, type Result } from "@conducted/shared";
import type { Cloud, CloudRelay, SidecarTransport, Unsubscribe } from "../../platform/platform.ts";

type CloudHost = Extract<Host, { kind: "cloud" }>;

/** A transport with an explicit end, so the container can close it when the app stops. */
export interface CloudTransport extends SidecarTransport {
	close(): Promise<void>;
}

/** The Worker's relay as the tunnel's line transport. */
export function createCloudTransport(cloud: Cloud, host: CloudHost): CloudTransport {
	let relay: CloudRelay | null = null;
	let opening: Promise<Result<void>> | null = null;
	let stopRelay: Unsubscribe | null = null;
	let stopClosed: Unsubscribe | null = null;
	/**
	 * Text from the Worker that has not ended in a newline yet. Each character is looked at once, so
	 * a long line costs time in proportion to its length (#617).
	 */
	let buffered = new LineSplitter();
	const lineListeners = new Set<(line: string) => void>();
	const restartListeners = new Set<() => void>();

	const detach = (): void => {
		stopRelay?.();
		stopClosed?.();
		stopRelay = null;
		stopClosed = null;
	};

	const deliver = (text: string): void => {
		for (const line of buffered.push(text)) {
			if (line.trim() === "") continue;
			for (const listener of lineListeners) listener(line);
		}
	};

	const open = async (): Promise<Result<void>> => {
		const opened = await cloud.openRelay({ url: host.url, vmId: host.vmId });
		if (!opened.ok) return opened;
		relay = opened.value;
		buffered = new LineSplitter();
		stopRelay = relay.onLine((line) => deliver(line));
		stopClosed = relay.onClosed(() => {
			detach();
			relay = null;
			opening = null;
			for (const listener of restartListeners) listener();
		});
		return ok(undefined);
	};

	return {
		ensureStarted: () => {
			if (relay !== null) return Promise.resolve(ok(undefined));
			opening ??= open().then((result) => {
				if (!result.ok) opening = null;
				return result;
			});
			return opening;
		},
		send: async (line) => {
			if (line.includes("\n") || line.includes("\r")) {
				return err(appError("sidecar_bad_line", "A sidecar line cannot hold a newline."));
			}
			if (relay === null) {
				return err(appError("sidecar_not_running", "The cloud sidecar is not connected."));
			}
			return relay.send(line);
		},
		onLine: (listener) => {
			lineListeners.add(listener);
			return () => lineListeners.delete(listener);
		},
		onRestart: (listener) => {
			restartListeners.add(listener);
			return () => restartListeners.delete(listener);
		},
		logPath: () => Promise.resolve("cloud"),
		close: async () => {
			const current = relay;
			detach();
			relay = null;
			opening = null;
			if (current !== null) await current.close();
		},
	};
}
