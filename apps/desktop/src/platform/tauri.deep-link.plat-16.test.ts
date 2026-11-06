/**
 * @feature PLAT-16 `conducted://` deep links
 * Owns: the Tauri door that turns the shell's `app://deep-link` event and the plugin's launch URLs
 * into `Platform.app.onDeepLink`.
 * Behaviour: docs/research/conductor/native-and-sidecar-map.md A8 (a link that launched the app is
 * read at cold start; a link received while the app runs arrives as an event) and services-map.md
 * 1.1 (deep-link events reach the app).
 */

import { describe, expect, it, vi } from "vitest";
import { COMMANDS, createTauriAppInfo, EVENTS, type TauriBindings } from "./tauri.ts";

interface Launch {
	urls: string[];
	rejected: { code: string; message: string }[];
}

function listenableApp(launch: Launch = { urls: [], rejected: [] }) {
	const listeners = new Map<string, (payload: unknown) => void>();
	const bindings: TauriBindings = {
		invoke: async <T>(command: string): Promise<T> => {
			if (command !== COMMANDS.deepLinkLaunch) throw new Error(`unexpected ${command}`);
			return launch as T;
		},
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
		const { app } = listenableApp({ urls: ["conducted://workspace?id=launch"], rejected: [] });
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

describe("PLAT-16 refused deep links", () => {
	const tooLong = {
		code: "deep_link_too_long",
		message: "A deep link longer than 65536 bytes was dropped.",
	};

	it("PLAT-16 hands a refusal from the shell event to the listener as an AppError", async () => {
		const { app, listeners } = listenableApp();
		const received: string[] = [];

		const unsubscribe = app.onDeepLinkRejected((rejection) =>
			received.push(`${rejection.code}: ${rejection.message}`),
		);
		await vi.waitFor(() => expect(listeners.has(EVENTS.deepLinkRejected)).toBe(true));
		listeners.get(EVENTS.deepLinkRejected)?.(tooLong);

		expect(received).toEqual([`${tooLong.code}: ${tooLong.message}`]);
		unsubscribe();
		expect(listeners.has(EVENTS.deepLinkRejected)).toBe(false);
	});

	it("PLAT-16 hands a refused launch link to the listener, and not to onDeepLink", async () => {
		const { app } = listenableApp({ urls: [], rejected: [tooLong] });
		const refused: string[] = [];
		const opened: string[] = [];

		const stopRefused = app.onDeepLinkRejected((rejection) => refused.push(rejection.code));
		const stopOpened = app.onDeepLink((url) => opened.push(url));

		await vi.waitFor(() => expect(refused).toEqual(["deep_link_too_long"]));
		expect(opened).toEqual([]);
		stopRefused();
		stopOpened();
	});
});
