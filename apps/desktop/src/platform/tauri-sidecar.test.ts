/**
 * @feature PLAT-09 Sidecar launcher: spawn, socket relay, restart, parent watchdog
 * Owns: the Tauri transport for the sidecar: one command per action and one listener per event.
 * Behaviour: native-and-sidecar-map.md A2 (the commands behind the sidecar group) and A4
 * (`rpc_from_sidecar`).
 * Test first: `ensureStarted` calls `sidecar_ensure_started`, `send` passes the line through, and
 * `onLine` delivers the string payload until it is unsubscribed.
 */
import { describe, expect, it } from "vitest";
import { COMMANDS, createTauriSidecar, EVENTS, type TauriBindings } from "./tauri.ts";

type ListenHandler = (payload: unknown) => void;

interface FakeBindings {
	bindings: TauriBindings;
	calls: { command: string; args?: Record<string, unknown> }[];
	listeners: Map<string, ListenHandler>;
	stopped: string[];
	emit(event: string, payload: unknown): Promise<void>;
}

function fakeBindings(
	invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> = async () =>
		undefined,
): FakeBindings {
	const calls: { command: string; args?: Record<string, unknown> }[] = [];
	const listeners = new Map<string, ListenHandler>();
	const stopped: string[] = [];
	const bindings: TauriBindings = {
		invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
			calls.push({ command, args });
			return (await invoke(command, args)) as T;
		},
		listen: async (event, handler) => {
			listeners.set(event, handler as ListenHandler);
			return () => {
				stopped.push(event);
				listeners.delete(event);
			};
		},
	};
	return {
		bindings,
		calls,
		listeners,
		stopped,
		emit: async (event, payload) => {
			listeners.get(event)?.(payload);
			await Promise.resolve();
		},
	};
}

const flush = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

describe("PLAT-09 sidecar transport", () => {
	it("PLAT-09 ensureStarted calls sidecar_ensure_started and returns its result", async () => {
		const fake = fakeBindings();
		const result = await createTauriSidecar(fake.bindings).ensureStarted();
		expect(result).toEqual({ ok: true, value: undefined });
		expect(fake.calls).toEqual([{ command: COMMANDS.sidecarEnsureStarted, args: undefined }]);
	});

	it("PLAT-09 ensureStarted turns a command rejection into Err", async () => {
		const fake = fakeBindings(async () => {
			throw { code: "sidecar_binary_missing", message: "No sidecar." };
		});
		const result = await createTauriSidecar(fake.bindings).ensureStarted();
		expect(result).toEqual({
			ok: false,
			error: { code: "sidecar_binary_missing", message: "No sidecar." },
		});
	});

	it("PLAT-09 send passes the line to sidecar_send", async () => {
		const fake = fakeBindings();
		const result = await createTauriSidecar(fake.bindings).send('{"jsonrpc":"2.0"}');
		expect(result.ok).toBe(true);
		expect(fake.calls).toEqual([
			{ command: COMMANDS.sidecarSend, args: { line: '{"jsonrpc":"2.0"}' } },
		]);
	});

	it("PLAT-09 send reports sidecar_not_running as Err", async () => {
		const fake = fakeBindings(async () => {
			throw { code: "sidecar_not_running", message: "The sidecar is not running." };
		});
		const result = await createTauriSidecar(fake.bindings).send("line");
		expect(result).toEqual({
			ok: false,
			error: { code: "sidecar_not_running", message: "The sidecar is not running." },
		});
	});

	it("PLAT-09 logPath returns the path from sidecar_log_path", async () => {
		const fake = fakeBindings(async () => "/data/logs/sidecar-42.log");
		const path = await createTauriSidecar(fake.bindings).logPath();
		expect(path).toBe("/data/logs/sidecar-42.log");
		expect(fake.calls).toEqual([{ command: COMMANDS.sidecarLogPath, args: undefined }]);
	});

	it("PLAT-09 logPath throws the AppError when the command fails", async () => {
		const fake = fakeBindings(async () => {
			throw { code: "sidecar_not_running", message: "The sidecar has not started yet." };
		});
		await expect(createTauriSidecar(fake.bindings).logPath()).rejects.toEqual({
			code: "sidecar_not_running",
			message: "The sidecar has not started yet.",
		});
	});

	it("PLAT-09 onLine delivers the string payload and stops after unsubscribe", async () => {
		const fake = fakeBindings();
		const received: string[] = [];
		const unsubscribe = createTauriSidecar(fake.bindings).onLine((line) => received.push(line));
		await flush();
		await fake.emit(EVENTS.sidecarLine, "hello");
		expect(received).toEqual(["hello"]);
		unsubscribe();
		expect(fake.stopped).toEqual([EVENTS.sidecarLine]);
		await fake.emit(EVENTS.sidecarLine, "after");
		expect(received).toEqual(["hello"]);
	});

	it("PLAT-09 onRestart fires on the restart event and stops after unsubscribe", async () => {
		const fake = fakeBindings();
		let fired = 0;
		const unsubscribe = createTauriSidecar(fake.bindings).onRestart(() => {
			fired += 1;
		});
		await flush();
		await fake.emit(EVENTS.sidecarRestart, { willRetry: true });
		expect(fired).toBe(1);
		unsubscribe();
		expect(fake.stopped).toEqual([EVENTS.sidecarRestart]);
		await fake.emit(EVENTS.sidecarRestart, { willRetry: false });
		expect(fired).toBe(1);
	});
});
