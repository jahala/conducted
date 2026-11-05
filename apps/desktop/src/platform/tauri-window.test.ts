/**
 * @feature PLAT-31 Window focus and blur events
 * Owns: tests for the Tauri window door: asking whether the window has focus, subscribing to
 * focus and blur, and turning Tauri's drag and drop events into the Platform's file drop events
 * (PLAT-33).
 * Behaviour: services-map.md 1.1 and 6, native-and-sidecar-map.md A4 (`tauri://focus`,
 * `tauri://blur`, drag and drop).
 */

import { describe, expect, it } from "vitest";
import type { FileDropEvent, Unsubscribe } from "./platform.ts";
import { createTauriWindow, EVENTS, type TauriBindings, type TauriDragDropEvent } from "./tauri.ts";

type WindowHandler = () => void;

interface FakeWindow {
	bindings: TauriBindings;
	focused: boolean;
	listened: string[];
	stopped: string[];
	dragHandlers: Set<(event: TauriDragDropEvent) => void>;
	emit(event: string): void;
	emitDrag(event: TauriDragDropEvent): void;
	listenerCount(): number;
}

function fakeWindow(focused = true): FakeWindow {
	const listeners = new Map<string, Set<WindowHandler>>();
	const dragHandlers = new Set<(event: TauriDragDropEvent) => void>();
	const listened: string[] = [];
	const stopped: string[] = [];
	const state: FakeWindow = {
		focused,
		bindings: {
			invoke: async () => undefined,
			listen: async () => () => {},
			window: {
				isFocused: async () => state.focused,
				listen: async <T>(event: string, handler: (payload: T) => void) => {
					listened.push(event);
					let handlers = listeners.get(event);
					if (handlers === undefined) {
						handlers = new Set();
						listeners.set(event, handlers);
					}
					const wrapped = () => handler(undefined as T);
					handlers.add(wrapped);
					return () => {
						stopped.push(event);
						handlers.delete(wrapped);
					};
				},
				onDragDropEvent: async (handler) => {
					dragHandlers.add(handler);
					return () => dragHandlers.delete(handler);
				},
			},
		} as TauriBindings,
		listened,
		stopped,
		dragHandlers,
		emit: (event: string) => {
			for (const handler of [...(listeners.get(event) ?? [])]) handler();
		},
		emitDrag: (event) => {
			for (const handler of [...dragHandlers]) handler(event);
		},
		listenerCount: () => {
			let count = dragHandlers.size;
			for (const handlers of listeners.values()) count += handlers.size;
			return count;
		},
	};
	return state;
}

const flush = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

describe("PLAT-31 Tauri window focus", () => {
	it("PLAT-31 isFocused returns the window's current focus", async () => {
		const fake = fakeWindow(true);
		const window = createTauriWindow(fake.bindings);

		expect(await window.isFocused()).toBe(true);

		fake.focused = false;
		expect(await window.isFocused()).toBe(false);
	});

	it("PLAT-31 onFocusChanged turns tauri://focus and tauri://blur into true and false", async () => {
		const fake = fakeWindow();
		const window = createTauriWindow(fake.bindings);
		const seen: boolean[] = [];

		const stop = window.onFocusChanged((focused) => seen.push(focused));
		await flush();

		expect(fake.listened).toEqual([EVENTS.windowFocus, EVENTS.windowBlur]);
		expect(EVENTS.windowFocus).toBe("tauri://focus");
		expect(EVENTS.windowBlur).toBe("tauri://blur");

		fake.emit(EVENTS.windowFocus);
		fake.emit(EVENTS.windowBlur);
		expect(seen).toEqual([true, false]);

		stop();
		expect(fake.stopped).toEqual([EVENTS.windowFocus, EVENTS.windowBlur]);
		expect(fake.listenerCount()).toBe(0);

		fake.emit(EVENTS.windowFocus);
		expect(seen).toEqual([true, false]);
	});

	it("PLAT-31 unsubscribing twice releases each listener once", async () => {
		const fake = fakeWindow();
		const window = createTauriWindow(fake.bindings);

		const stop = window.onFocusChanged(() => {});
		await flush();
		stop();
		stop();

		expect(fake.stopped).toEqual([EVENTS.windowFocus, EVENTS.windowBlur]);
	});

	it("PLAT-31 an unsubscribe before the listen call resolves releases the listener at once", async () => {
		const late: (() => void)[] = [];
		const stopped: string[] = [];
		const window = createTauriWindow({
			invoke: async <T>() => undefined as T,
			listen: async () => () => {},
			window: {
				isFocused: async () => true,
				listen: <T>(event: string, _handler: (payload: T) => void) =>
					new Promise<() => void>((resolve) => {
						late.push(() => resolve(() => stopped.push(event)));
					}),
				onDragDropEvent: async () => () => {},
			},
		});

		const stop: Unsubscribe = window.onFocusChanged(() => {});
		stop();
		for (const release of late) release();
		await flush();

		expect(stopped).toEqual([EVENTS.windowFocus, EVENTS.windowBlur]);
	});
});

describe("PLAT-33 Tauri file drop events", () => {
	it("PLAT-33 turns drag enter, over, drop and leave into real paths and pixel positions", async () => {
		const fake = fakeWindow();
		const window = createTauriWindow(fake.bindings);
		const seen: FileDropEvent[] = [];

		const stop = window.onFileDrop((event) => seen.push(event));
		await flush();

		fake.emitDrag({
			type: "enter",
			paths: ["/Users/me/one.txt", "/Users/me/two.png"],
			position: { x: 12, y: 34 },
		});
		fake.emitDrag({ type: "over", position: { x: 20, y: 40 } });
		fake.emitDrag({ type: "drop", paths: ["/Users/me/one.txt"], position: { x: 22, y: 44 } });
		fake.emitDrag({ type: "leave" });

		expect(seen).toEqual([
			{ kind: "enter", paths: ["/Users/me/one.txt", "/Users/me/two.png"], x: 12, y: 34 },
			{ kind: "over", x: 20, y: 40 },
			{ kind: "drop", paths: ["/Users/me/one.txt"], x: 22, y: 44 },
			{ kind: "leave" },
		]);
		stop();
	});

	it("PLAT-33 unsubscribing twice releases the drag listener once", async () => {
		const fake = fakeWindow();
		const window = createTauriWindow(fake.bindings);
		const seen: FileDropEvent[] = [];

		const stop = window.onFileDrop((event) => seen.push(event));
		await flush();
		stop();
		stop();

		fake.emitDrag({ type: "over", position: { x: 1, y: 2 } });
		expect(seen).toEqual([]);
		expect(fake.listenerCount()).toBe(0);
	});
});
