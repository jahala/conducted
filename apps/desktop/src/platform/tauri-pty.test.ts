// @vitest-environment node
/**
 * @feature PLAT-07 Terminals over PTY with flow control and screen text
 * Owns: tests for the Tauri side of the terminal door: command names and arguments, the output
 * Channel, and the exit event, including an exit that arrives before the spawn answer.
 * Behaviour: native-and-sidecar-map.md A2 (pty commands) and docs/plans/tauri-commands.md.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMANDS, createTauriPty, EVENTS, type TauriBindings } from "./tauri.ts";

type Handler = (payload: unknown) => void;

interface Harness {
	bindings: TauriBindings;
	calls: { command: string; args?: Record<string, unknown> }[];
	/** Delivers an event to every listener of that name, like the Rust shell would. */
	emit(event: string, payload: unknown): void;
	/** Sends one message through the Channel the spawn call received. */
	sendOutput(text: string): void;
	active(event: string): number;
}

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

function harness(options: {
	onInvoke?: (command: string, emit: Harness["emit"]) => unknown;
	listen?: () => Promise<never>;
}): Harness {
	const handlers = new Map<string, Set<Handler>>();
	const calls: Harness["calls"] = [];
	let channelId: number | null = null;
	const emit: Harness["emit"] = (event, payload) => {
		for (const handler of [...(handlers.get(event) ?? [])]) handler(payload);
	};
	const bindings: TauriBindings = {
		invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
			calls.push({ command, args });
			const channel = args?.onOutput as { id?: number } | undefined;
			if (channel?.id !== undefined) channelId = channel.id;
			const answer = options.onInvoke?.(command, emit);
			if (answer instanceof Error) throw answer;
			return answer as T;
		},
		listen: async <T>(event: string, handler: (payload: T) => void) => {
			if (options.listen) return options.listen();
			const set = handlers.get(event) ?? new Set<Handler>();
			handlers.set(event, set);
			set.add(handler as Handler);
			return () => {
				set.delete(handler as Handler);
			};
		},
	};
	return {
		bindings,
		calls,
		emit,
		sendOutput: (text) => {
			if (channelId === null) throw new Error("No Channel was passed to the spawn call.");
			callbacks.get(channelId)?.({
				index: 0,
				message: { data: btoa(text), byteLength: text.length },
			});
		},
		active: (event) => handlers.get(event)?.size ?? 0,
	};
}

const SPAWN = { cwd: "/work", cols: 80, rows: 24 };

describe("PLAT-07 Tauri terminals", () => {
	it("reports an exit that arrives before the spawn answer", async () => {
		const h = harness({
			onInvoke: (command, emit) => {
				if (command !== COMMANDS.ptySpawn) return undefined;
				// The command ends at once: the event is emitted before the answer reaches the UI.
				emit(EVENTS.ptyExit, { id: "pty-1", exitCode: 5 });
				return { id: "pty-1", pid: 10 };
			},
		});
		const spawned = await createTauriPty(h.bindings).spawn(SPAWN);
		if (!spawned.ok) throw new Error("spawn failed");
		const codes: (number | null)[] = [];
		spawned.value.onExit((code) => codes.push(code));
		await Promise.resolve();
		expect(codes).toEqual([5]);
		expect(h.active(EVENTS.ptyExit)).toBe(0);
	});

	it("ignores the exit of another terminal and releases its listener at its own exit", async () => {
		const h = harness({ onInvoke: () => ({ id: "pty-1", pid: 10 }) });
		const spawned = await createTauriPty(h.bindings).spawn(SPAWN);
		if (!spawned.ok) throw new Error("spawn failed");
		const codes: (number | null)[] = [];
		spawned.value.onExit((code) => codes.push(code));
		h.emit(EVENTS.ptyExit, { id: "other", exitCode: 1 });
		expect(codes).toEqual([]);
		expect(h.active(EVENTS.ptyExit)).toBe(1);
		h.emit(EVENTS.ptyExit, { id: "pty-1", exitCode: null });
		expect(codes).toEqual([null]);
		expect(h.active(EVENTS.ptyExit)).toBe(0);
	});

	it("returns an Err, and spawns nothing, when the exit listener cannot be set up", async () => {
		const h = harness({
			listen: () => Promise.reject(new Error("no event bus")),
			onInvoke: () => ({ id: "pty-1", pid: 10 }),
		});
		const spawned = await createTauriPty(h.bindings).spawn(SPAWN);
		expect(spawned).toMatchObject({ ok: false, error: { code: "tauri_error" } });
		expect(h.calls).toEqual([]);
	});

	it("releases the exit listener when the spawn command fails", async () => {
		const h = harness({
			onInvoke: () =>
				Object.assign(new Error("x"), { code: "pty_spawn_failed", message: "no cwd" }),
		});
		const spawned = await createTauriPty(h.bindings).spawn(SPAWN);
		expect(spawned.ok).toBe(false);
		expect(h.active(EVENTS.ptyExit)).toBe(0);
	});

	it("holds output until a listener is attached, then delivers it in order", async () => {
		const h = harness({ onInvoke: () => ({ id: "pty-1", pid: 10 }) });
		const spawned = await createTauriPty(h.bindings).spawn(SPAWN);
		if (!spawned.ok) throw new Error("spawn failed");
		h.sendOutput("hello");
		const seen: string[] = [];
		const stop = spawned.value.onData((chunk) => seen.push(new TextDecoder().decode(chunk)));
		expect(seen).toEqual(["hello"]);
		stop();
		stop();
	});

	it("sends each handle call to its command with the terminal id", async () => {
		const h = harness({
			onInvoke: (command) => {
				if (command === COMMANDS.ptySpawn) return { id: "pty-1", pid: 10 };
				if (command === COMMANDS.ptyScreenText) return "screen";
				return undefined;
			},
		});
		const spawned = await createTauriPty(h.bindings).spawn(SPAWN);
		if (!spawned.ok) throw new Error("spawn failed");
		const handle = spawned.value;
		await handle.write("ls\n");
		await handle.resize(100, 30);
		expect(await handle.screenText(50)).toBe("screen");
		await handle.kill();
		expect(h.calls.slice(1)).toEqual([
			{ command: COMMANDS.ptyWrite, args: { id: "pty-1", data: "ls\n" } },
			{ command: COMMANDS.ptyResize, args: { id: "pty-1", cols: 100, rows: 30 } },
			{ command: COMMANDS.ptyScreenText, args: { id: "pty-1", maxLines: 50 } },
			{ command: COMMANDS.ptyKill, args: { id: "pty-1" } },
		]);
	});
});
