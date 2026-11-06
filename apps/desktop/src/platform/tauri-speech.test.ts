// @vitest-environment node
/**
 * @feature PLAT-12 On-device dictation
 * Owns: tests for the Tauri speech door: the four command names, the event Channel and the
 * microphone-level events, and a rejected command becoming an `AppError`.
 * Behaviour: docs/plans/tauri-commands.md, native-and-sidecar-map.md A2 and A5,
 * services-map.md 5B.3.1.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpeechEvent } from "./platform.ts";
import { COMMANDS, createTauriSpeech, type TauriBindings } from "./tauri.ts";

interface Call {
	command: string;
	args?: Record<string, unknown>;
}

const callbacks = new Map<number, (message: unknown) => void>();
let nextCallbackId = 1;

beforeEach(() => {
	callbacks.clear();
	nextCallbackId = 1;
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

function harness(handler: (command: string, args?: Record<string, unknown>) => unknown): {
	bindings: TauriBindings;
	calls: Call[];
	send(event: SpeechEvent): void;
} {
	const calls: Call[] = [];
	let channelId: number | null = null;
	let messageIndex = 0;
	const bindings: TauriBindings = {
		invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
			calls.push({ command, args });
			const channel = args?.onEvent as { id?: number } | undefined;
			if (channel?.id !== undefined) channelId = channel.id;
			const answer = handler(command, args);
			if (answer instanceof Error) throw answer;
			return answer as T;
		},
		listen: async () => () => {},
	};
	return {
		bindings,
		calls,
		send: (event) => {
			if (channelId === null) throw new Error("No Channel was passed to speech_start.");
			callbacks.get(channelId)?.({ index: messageIndex++, message: event });
		},
	};
}

describe("PLAT-12 Tauri dictation", () => {
	it("PLAT-12 asks whether on-device dictation is available", async () => {
		const h = harness(() => true);
		const speech = createTauriSpeech(h.bindings);

		expect(await speech.available()).toBe(true);
		expect(h.calls).toEqual([{ command: COMMANDS.speechAvailable, args: undefined }]);
	});

	it("PLAT-12 hides dictation when the availability check fails", async () => {
		const h = harness(() => {
			throw Object.assign(new Error("no bridge"), {
				code: "speech_start_failed",
				message: "no bridge",
			});
		});

		expect(await createTauriSpeech(h.bindings).available()).toBe(false);
	});

	it("PLAT-12 passes a Channel and forwards its events to the listener", async () => {
		const h = harness(() => undefined);
		const speech = createTauriSpeech(h.bindings);
		const events: SpeechEvent[] = [];

		const started = await speech.start((event) => events.push(event));
		expect(started).toEqual({ ok: true, value: undefined });

		const channel = h.calls[0]?.args?.onEvent as { id: number };
		expect(typeof channel.id).toBe("number");
		h.send({ kind: "partial", text: "the quick" });
		h.send({ kind: "level", value: 0.5 });
		h.send({ kind: "final", text: "the quick brown fox" });
		h.send({ kind: "ended" });

		expect(events).toEqual([
			{ kind: "partial", text: "the quick" },
			{ kind: "level", value: 0.5 },
			{ kind: "final", text: "the quick brown fox" },
			{ kind: "ended" },
		]);
	});

	it("PLAT-12 turns a refused start into an AppError", async () => {
		const h = harness(() => {
			throw { code: "speech_busy", message: "Dictation is already running." };
		});

		const started = await createTauriSpeech(h.bindings).start(() => {});

		expect(started).toEqual({
			ok: false,
			error: expect.objectContaining({
				code: "speech_busy",
				message: "Dictation is already running.",
			}),
		});
	});

	it("PLAT-12 stops and cancels through their commands", async () => {
		const h = harness(() => undefined);
		const speech = createTauriSpeech(h.bindings);

		await speech.stop();
		await speech.cancel();

		expect(h.calls).toEqual([
			{ command: COMMANDS.speechStop, args: undefined },
			{ command: COMMANDS.speechCancel, args: undefined },
		]);
	});

	it("PLAT-12 throws the AppError when stop is refused", async () => {
		const h = harness(() => {
			throw { code: "speech_stop_failed", message: "No audio device." };
		});

		await expect(createTauriSpeech(h.bindings).stop()).rejects.toMatchObject({
			code: "speech_stop_failed",
			message: "No audio device.",
		});
	});
});
