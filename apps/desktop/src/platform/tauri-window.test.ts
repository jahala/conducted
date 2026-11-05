/**
 * @feature PLAT-31 Window focus and blur events
 * Owns: tests for the Tauri window door: asking whether the window has focus and subscribing to
 * focus and blur.
 * Behaviour: services-map.md 1.1 and 6, native-and-sidecar-map.md A4 (`tauri://focus`,
 * `tauri://blur`).
 */

import { describe, expect, it } from "vitest";
import type { Unsubscribe } from "./platform.ts";
import { createTauriWindow, EVENTS, type TauriBindings } from "./tauri.ts";

type WindowHandler = () => void;

interface FakeWindow {
	bindings: TauriBindings;
	focused: boolean;
	listened: string[];
	stopped: string[];
	emit(event: string): void;
	listenerCount(): number;
}

function fakeWindow(focused = true): FakeWindow {
	const listeners = new Map<string, Set<WindowHandler>>();
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
			},
		} as TauriBindings,
		listened,
		stopped,
		emit: (event: string) => {
			for (const handler of [...(listeners.get(event) ?? [])]) handler();
		},
		listenerCount: () => {
			let count = 0;
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
			},
		});

		const stop: Unsubscribe = window.onFocusChanged(() => {});
		stop();
		for (const release of late) release();
		await flush();

		expect(stopped).toEqual([EVENTS.windowFocus, EVENTS.windowBlur]);
	});
});
