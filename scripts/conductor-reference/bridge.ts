/**
 * The bridge page of the live reference run (stage 2): what our app's own window loads in place of our
 * UI (live-config.ts points its `frontendDist` here). It has our real `window.__TAURI_INTERNALS__`
 * and runs on the reference server's jobs:
 *
 * - `{ job, command, args }`: calls our real `invoke` and posts `{ job, ok, value | error }` back. A
 *   `__CHANNEL__:<n>` string anywhere in the arguments stands for a channel of the page that asked; it
 *   becomes a real channel of this page, and each of its messages is posted back as
 *   `{ kind: "channel", channel: n, message }`. `{ payload, headers }` arguments marked `bytes` go as
 *   a byte body with those headers, as Tauri's fs plugin sends them.
 * - `{ listen }`: listens to one of our app's events and posts each as `{ kind: "event", event, payload }`.
 *
 * It answers nothing itself: every value it posts came from our app's own commands, plugins or events.
 * The server serves this file with its types stripped and calls `installBridge`, as it does the
 * stand-in (standin.ts), so it has no imports.
 */

export interface BridgeBoot {
	base: string;
}

type Job = { job: number; command: string; args: unknown; bytes?: boolean } | { listen: string };

interface Internals {
	invoke(
		command: string,
		args?: unknown,
		options?: { headers?: Record<string, string> },
	): Promise<unknown>;
	transformCallback(callback: (payload: unknown) => void, once?: boolean): number;
}

interface BridgeHost {
	fetch: typeof fetch;
	console: Pick<Console, "error">;
	__TAURI_INTERNALS__?: Internals;
}

/** Replaces every `__CHANNEL__:<n>` string in `value`, keeping the rest as it is. */
export function rewriteChannels(value: unknown, channel: (n: number) => string): unknown {
	if (typeof value === "string") {
		const match = /^__CHANNEL__:(\d+)$/.exec(value);
		return match === null ? value : channel(Number(match[1]));
	}
	if (Array.isArray(value)) return value.map((item) => rewriteChannels(item, channel));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, rewriteChannels(item, channel)]),
		);
	}
	return value;
}

/** An error as plain JSON: Tauri rejects with a string or an object such as `{ code, message }`. */
export function plainError(cause: unknown): unknown {
	if (cause instanceof Error) return { code: "bridge_error", message: cause.message };
	if (typeof cause === "object" && cause !== null) return JSON.parse(JSON.stringify(cause));
	return cause;
}

export function installBridge(host: BridgeHost, boot: BridgeBoot): void {
	const internals = host.__TAURI_INTERNALS__;
	if (internals === undefined) throw new Error("The bridge page has no Tauri internals.");
	const channels = new Map<number, string>();
	const post = async (path: string, body: unknown): Promise<void> => {
		await host.fetch(`${boot.base}${path}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	};
	const channelFor = (n: number): string => {
		let real = channels.get(n);
		if (real === undefined) {
			const id = internals.transformCallback((message) => {
				post("/bridge/push", { kind: "channel", channel: n, message }).catch((cause: unknown) =>
					host.console.error("[bridge] channel message lost:", cause),
				);
			});
			real = `__CHANNEL__:${id}`;
			channels.set(n, real);
		}
		return real;
	};

	const run = async (job: Job): Promise<void> => {
		if ("listen" in job) {
			const event = job.listen;
			const handler = internals.transformCallback((payload) => {
				const { payload: value } = payload as { payload: unknown };
				post("/bridge/push", { kind: "event", event, payload: value }).catch((cause: unknown) =>
					host.console.error("[bridge] event lost:", cause),
				);
			});
			await internals.invoke("plugin:event|listen", {
				event,
				target: { kind: "Any" },
				handler,
			});
			return;
		}
		let answer: { job: number; ok: boolean; value?: unknown; error?: unknown };
		try {
			const args = rewriteChannels(job.args, channelFor);
			let value: unknown;
			if (job.bytes === true) {
				const { payload, headers } = args as { payload: number[]; headers: Record<string, string> };
				value = await internals.invoke(job.command, new Uint8Array(payload), { headers });
			} else value = await internals.invoke(job.command, args);
			if (value instanceof ArrayBuffer) value = { bytes: Array.from(new Uint8Array(value)) };
			answer = { job: job.job, ok: true, value: value ?? null };
		} catch (cause) {
			answer = { job: job.job, ok: false, error: plainError(cause) };
		}
		await post("/bridge/done", answer);
	};

	const stream = async (): Promise<void> => {
		const response = await host.fetch(`${boot.base}/bridge/jobs`);
		const reader = response.body?.getReader();
		if (reader === undefined) throw new Error("The reference server sent no job stream.");
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
				if (line.trim() !== "") {
					run(JSON.parse(line) as Job).catch((cause: unknown) =>
						host.console.error("[bridge] job failed:", cause),
					);
				}
				newline = buffered.indexOf("\n");
			}
		}
	};
	stream().catch((cause: unknown) => host.console.error("[bridge] job stream ended:", cause));
}
