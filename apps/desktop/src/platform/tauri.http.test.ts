// @vitest-environment node
/**
 * @feature PLAT-30 HTTP from Rust: fetch and download with progress, checksum, cancel
 * Owns: tests for the Tauri side of the HTTP door: the command names and arguments, the progress
 * Channel, the download handle's id and the cancel call.
 * Behaviour: native-and-sidecar-map.md A2 (native_http.rs) and docs/plans/tauri-commands.md.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMANDS, createTauriHttp, type TauriBindings } from "./tauri.ts";

type Progress = { receivedBytes: number; totalBytes: number | null };

const callbacks = new Map<number, (message: unknown) => void>();
let nextCallbackId = 1;

beforeEach(() => {
	callbacks.clear();
	Object.assign(globalThis, {
		window: {
			__TAURI_INTERNALS__: {
				transformCallback: (callback: (message: unknown) => void) => {
					const id = nextCallbackId++;
					callbacks.set(id, callback);
					return id;
				},
				unregisterCallback: (id: number) => {
					callbacks.delete(id);
				},
			},
		},
	});
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

interface Harness {
	bindings: TauriBindings;
	calls: { command: string; args?: Record<string, unknown> }[];
	/** Sends one progress message through the Channel the download call received. */
	sendProgress(message: Progress): void;
}

function harness(answer: (command: string) => unknown): Harness {
	const calls: Harness["calls"] = [];
	let channelId: number | null = null;
	const bindings: TauriBindings = {
		invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
			calls.push({ command, args });
			const channel = args?.onProgress as { id?: number } | undefined;
			if (channel?.id !== undefined) channelId = channel.id;
			const value = answer(command);
			if (value instanceof Error) throw value;
			return value as T;
		},
		listen: async () => () => {},
	};
	return {
		bindings,
		calls,
		sendProgress: (message) => {
			if (channelId === null) throw new Error("No Channel was passed to the download call.");
			callbacks.get(channelId)?.(message);
		},
	};
}

/** The Rust error a command rejects with. */
const rustError = (code: string, message: string): Error => {
	const error = new Error(message) as Error & { code: string };
	error.code = code;
	return error;
};

describe("PLAT-30 Tauri HTTP", () => {
	it("sends a fetch request through http_fetch and returns its answer", async () => {
		const response = {
			status: 200,
			headers: { "content-type": "application/json" },
			body: "{}",
		};
		const h = harness(() => response);
		const request = {
			url: "https://api.linear.app/graphql",
			method: "POST" as const,
			headers: { "x-api-key": "key" },
			body: "{}",
			timeoutMs: 5_000,
		};
		const result = await createTauriHttp(h.bindings).fetch(request);
		expect(result).toEqual({ ok: true, value: response });
		expect(h.calls).toEqual([{ command: COMMANDS.httpFetch, args: { request } }]);
	});

	it("turns a Rust error into an Err", async () => {
		const h = harness(() => {
			throw rustError("http_url_not_allowed", "The host is not on the allow-list.");
		});
		const result = await createTauriHttp(h.bindings).fetch({
			url: "https://evil.example/file",
			method: "GET",
		});
		expect(result).toEqual({
			ok: false,
			error: { code: "http_url_not_allowed", message: "The host is not on the allow-list." },
		});
	});

	it("starts a download with a fresh id and a progress Channel", async () => {
		const h = harness(() => ({ path: "/tmp/agent.bin", sizeBytes: 3, sha256: "abc" }));
		const http = createTauriHttp(h.bindings);
		const first = http.download({
			url: "https://api.linear.app/a",
			destinationPath: "/tmp/agent.bin",
			expectedSha256: "abc",
		});
		const second = http.download({
			url: "https://api.linear.app/b",
			destinationPath: "/tmp/other.bin",
		});
		expect(first.id.length).toBeGreaterThan(0);
		expect(second.id).not.toBe(first.id);
		const args = h.calls[0]?.args as Record<string, unknown>;
		expect(args.id).toBe(first.id);
		expect(args.url).toBe("https://api.linear.app/a");
		expect(args.destinationPath).toBe("/tmp/agent.bin");
		expect(args.expectedSha256).toBe("abc");
		expect(args.onProgress).toBeDefined();
		await expect(first.done).resolves.toEqual({
			ok: true,
			value: { path: "/tmp/agent.bin", sizeBytes: 3, sha256: "abc" },
		});
	});

	it("forwards progress messages to onProgress", () => {
		const h = harness(() => ({ path: "/tmp/agent.bin", sizeBytes: 10, sha256: "abc" }));
		const seen: [number, number | null][] = [];
		createTauriHttp(h.bindings).download({
			url: "https://api.linear.app/a",
			destinationPath: "/tmp/agent.bin",
			onProgress: (received, total) => seen.push([received, total]),
		});
		h.sendProgress({ receivedBytes: 5, totalBytes: 10 });
		h.sendProgress({ receivedBytes: 10, totalBytes: 10 });
		expect(seen).toEqual([
			[5, 10],
			[10, 10],
		]);
	});

	it("reports a failed download through done", async () => {
		const h = harness(() => {
			throw rustError("http_checksum_mismatch", "The file does not match.");
		});
		const handle = createTauriHttp(h.bindings).download({
			url: "https://api.linear.app/a",
			destinationPath: "/tmp/agent.bin",
		});
		await expect(handle.done).resolves.toEqual({
			ok: false,
			error: { code: "http_checksum_mismatch", message: "The file does not match." },
		});
	});

	it("cancels the download by the id it handed out", async () => {
		const h = harness((command) =>
			command === COMMANDS.httpDownload
				? { path: "/tmp/agent.bin", sizeBytes: 0, sha256: "" }
				: undefined,
		);
		const handle = createTauriHttp(h.bindings).download({
			url: "https://api.linear.app/a",
			destinationPath: "/tmp/agent.bin",
		});
		await handle.cancel();
		expect(h.calls.at(-1)).toEqual({
			command: COMMANDS.httpCancel,
			args: { id: handle.id },
		});
	});

	it("rejects when the cancel command fails", async () => {
		const h = harness((command) => {
			if (command === COMMANDS.httpDownload) {
				return { path: "/tmp/agent.bin", sizeBytes: 0, sha256: "" };
			}
			throw rustError("http_state_poisoned", "The download list cannot be read.");
		});
		const handle = createTauriHttp(h.bindings).download({
			url: "https://api.linear.app/a",
			destinationPath: "/tmp/agent.bin",
		});
		await expect(handle.cancel()).rejects.toEqual({
			code: "http_state_poisoned",
			message: "The download list cannot be read.",
		});
	});
});
