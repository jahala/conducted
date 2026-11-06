/**
 * @feature PLAT-16 `conducted://` deep links
 * Owns: the Tauri door that turns the shell's `app://deep-link` event and the plugin's launch URLs
 * into `Platform.app.onDeepLink`.
 * Behaviour: docs/research/conductor/native-and-sidecar-map.md A8 (a link that launched the app is
 * read at cold start; a link received while the app runs arrives as an event) and services-map.md
 * 1.1 (deep-link events reach the app).
 */

import { describe, expect, it, vi } from "vitest";
import { createTauriAppInfo, EVENTS, type TauriBindings } from "./tauri.ts";

function listenableApp(launchUrls: string[] | null = null) {
	const listeners = new Map<string, (payload: unknown) => void>();
	const bindings: TauriBindings = {
		invoke: async <T>(): Promise<T> => launchUrls as T,
		listen: async <T>(event: string, handler: (payload: T) => void) => {
			listeners.set(event, handler as (payload: unknown) => void);
			return () => {
				listeners.delete(event);
			};
		},
	};
	const app = createTauriAppInfo(bindings, { version: "0.1.0", channel: "dev" });
	return { app, listeners };
}

describe("PLAT-16 Tauri deep-link event", () => {
	it("PLAT-16 delivers a conducted:// URL from the shell event", async () => {
		const { app, listeners } = listenableApp();
		const received: string[] = [];

		const unsubscribe = app.onDeepLink((url) => received.push(url));
		await vi.waitFor(() => expect(listeners.has(EVENTS.deepLink)).toBe(true));

		listeners.get(EVENTS.deepLink)?.("conducted://workspace?id=w1&session=s1");

		expect(received).toEqual(["conducted://workspace?id=w1&session=s1"]);
		unsubscribe();
		expect(listeners.has(EVENTS.deepLink)).toBe(false);
	});

	it("PLAT-16 delivers the URL that launched the app when it subscribes", async () => {
		const { app } = listenableApp(["conducted://workspace?id=launch"]);
		const received: string[] = [];

		const unsubscribe = app.onDeepLink((url) => received.push(url));

		await vi.waitFor(() => expect(received).toEqual(["conducted://workspace?id=launch"]));
		unsubscribe();
	});

	it("PLAT-16 stops delivering after unsubscribe", async () => {
		const { app, listeners } = listenableApp();
		const received: string[] = [];

		const unsubscribe = app.onDeepLink((url) => received.push(url));
		await vi.waitFor(() => expect(listeners.has(EVENTS.deepLink)).toBe(true));
		const listener = listeners.get(EVENTS.deepLink);

		unsubscribe();
		listener?.("conducted://workspace?id=late");

		expect(received).toEqual([]);
	});
});
