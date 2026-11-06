/**
 * The page side of the reference stand-in: Tauri's `window.__TAURI_INTERNALS__` for a frontend running
 * in a plain browser. The server (server.ts) injects it as a classic script before the frontend's own
 * module, so it is in place before any of the frontend's code runs.
 *
 * - `invoke` posts every call to the reference backend on the same origin and resolves or rejects with
 *   its answer. The event plugin's `listen` and `unlisten` are kept here, since the callbacks live in
 *   the page.
 * - `transformCallback` and `unregisterCallback` keep callbacks by number, as Tauri does; events and
 *   channel messages from the backend arrive on one streamed response and are handed to them.
 * - `metadata` names the current window and webview, and the boot data can add the other globals a
 *   frontend reads synchronously (such as the OS plugin's values).
 * - `convertFileSrc` points at the backend's asset route, which answers nothing and logs the request.
 * - `__REFERENCE_ACTIVITY__` counts calls and those still waiting, so the screenshot run (run.ts) can
 *   tell when the page has stopped asking.
 *
 * The server serves this file with its types stripped and calls `installStandin` with the session's
 * boot data. It has no imports, so it runs as one classic script.
 */

export interface StandinBoot {
	/** The page session id the backend keyed this page's databases and log by. */
	session: string;
	/** The path every backend route sits under, such as `/__reference`. */
	base: string;
	windowLabel: string;
	webviewLabel: string;
	globals: Record<string, unknown>;
}

type Callback = (payload: unknown) => void;
type Push =
	| { kind: "event"; event: string; payload: unknown }
	| { kind: "channel"; channel: number; message: unknown };

interface Host {
	fetch: typeof fetch;
	console: Pick<Console, "error">;
	[name: string]: unknown;
}

export function installStandin(host: Host, boot: StandinBoot): void {
	const callbacks = new Map<number, Callback>();
	const listeners = new Map<number, { event: string; handler: number }>();
	let nextId = 1;

	const transformCallback = (callback?: Callback, once = false): number => {
		const id = nextId++;
		callbacks.set(id, (payload) => {
			if (once) callbacks.delete(id);
			callback?.(payload);
		});
		return id;
	};
	const unregisterCallback = (id: number): void => {
		callbacks.delete(id);
	};
	const unregisterListener = (_event: string, eventId: number): void => {
		listeners.delete(eventId);
	};

	const headers = { "content-type": "application/json", "x-reference-session": boot.session };
	const activity = { calls: 0, pending: 0 };
	const post = async (command: string, args: unknown): Promise<unknown> => {
		activity.calls += 1;
		activity.pending += 1;
		try {
			const response = await host.fetch(`${boot.base}/invoke`, {
				method: "POST",
				headers,
				body: JSON.stringify({ command, args: args ?? {} }),
			});
			const answer = (await response.json()) as { ok: boolean; value?: unknown; error?: unknown };
			if (answer.ok) return answer.value;
			throw answer.error;
		} finally {
			activity.pending -= 1;
		}
	};

	const invoke = async (command: string, args?: Record<string, unknown>): Promise<unknown> => {
		if (command === "plugin:event|listen") {
			const eventId = nextId++;
			listeners.set(eventId, { event: String(args?.event), handler: Number(args?.handler) });
			return eventId;
		}
		if (command === "plugin:event|unlisten") {
			listeners.delete(Number(args?.eventId));
			return null;
		}
		return await post(command, args);
	};

	const deliver = (push: Push): void => {
		if (push.kind === "channel") {
			callbacks.get(push.channel)?.(push.message);
			return;
		}
		for (const [id, listener] of [...listeners]) {
			if (listener.event !== push.event) continue;
			callbacks.get(listener.handler)?.({ event: push.event, id, payload: push.payload });
		}
	};

	const stream = async (): Promise<void> => {
		const response = await host.fetch(`${boot.base}/events`, { headers });
		const reader = response.body?.getReader();
		if (reader === undefined) throw new Error("The reference backend sent no event stream.");
		const decoder = new TextDecoder();
		let buffered = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return;
			buffered += decoder.decode(value, { stream: true });
			let newline = buffered.indexOf("\n");
			while (newline !== -1) {
				const line = buffered.slice(0, newline);
				buffered = buffered.slice(newline + 1);
				if (line.trim() !== "") deliver(JSON.parse(line) as Push);
				newline = buffered.indexOf("\n");
			}
		}
	};

	host.__TAURI_INTERNALS__ = {
		invoke,
		transformCallback,
		unregisterCallback,
		convertFileSrc: (path: string, protocol = "asset") =>
			`${boot.base}/asset?${new URLSearchParams({ protocol, path }).toString()}`,
		metadata: {
			currentWindow: { label: boot.windowLabel },
			currentWebview: { windowLabel: boot.windowLabel, label: boot.webviewLabel },
		},
	};
	host.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener };
	host.__REFERENCE_ACTIVITY__ = activity;
	for (const [name, value] of Object.entries(boot.globals)) host[name] = value;
	stream().catch((cause: unknown) => host.console.error("[reference] event stream ended:", cause));
}
