/**
 * @feature PLAT-11 Native notifications, dock badge, click opens a deep link
 * Owns: tests for the Tauri notifications door: showing a notification, setting the Dock badge,
 * and delivering a clicked deep link from the pending queue.
 * Behaviour: docs/research/conductor/native-and-sidecar-map.md A2 and A5,
 * services-map.md 5B.2.5, docs/plans/tauri-commands.md.
 */

import { describe, expect, it, vi } from "vitest";
import { COMMANDS, createTauriNotifications, EVENTS, type TauriBindings } from "./tauri.ts";

interface Call {
	command: string;
	args?: Record<string, unknown>;
}

function harness(handler: (command: string, args?: Record<string, unknown>) => unknown): {
	bindings: TauriBindings;
	calls: Call[];
	emit: (event: string, payload?: unknown) => void;
	listening: () => boolean;
} {
	const calls: Call[] = [];
	const listeners = new Map<string, (payload: unknown) => void>();
	const bindings: TauriBindings = {
		invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
			calls.push({ command, args });
			return handler(command, args) as T;
		},
		listen: async <T>(event: string, listener: (payload: T) => void) => {
			listeners.set(event, listener as (payload: unknown) => void);
			return () => {
				listeners.delete(event);
			};
		},
	};
	return {
		bindings,
		calls,
		emit: (event, payload) => listeners.get(event)?.(payload),
		listening: () => listeners.has(EVENTS.notificationClicked),
	};
}

const flush = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

describe("PLAT-11 Tauri notifications", () => {
	it("PLAT-11 sends a notification with its deep link", async () => {
		const { bindings, calls } = harness(() => undefined);
		const notifications = createTauriNotifications(bindings);

		await notifications.notify({
			title: "Agent finished",
			body: "Click to view session.",
			deepLink: "conducted://workspace?id=w1&session=s1",
		});

		expect(calls).toEqual([
			{
				command: COMMANDS.notify,
				args: {
					request: {
						title: "Agent finished",
						body: "Click to view session.",
						deepLink: "conducted://workspace?id=w1&session=s1",
					},
				},
			},
		]);
	});

	it("PLAT-11 reports a refused notification", async () => {
		const { bindings } = harness(() => {
			throw { code: "notification_denied", message: "Notifications are off." };
		});
		const notifications = createTauriNotifications(bindings);

		await expect(notifications.notify({ title: "Agent", body: "Done" })).rejects.toMatchObject({
			code: "notification_denied",
		});
	});

	it("PLAT-11 sends the Dock badge count and the clear", async () => {
		const { bindings, calls } = harness(() => undefined);
		const notifications = createTauriNotifications(bindings);

		await notifications.setDockBadge(3);
		await notifications.setDockBadge(null);

		expect(calls).toEqual([
			{ command: COMMANDS.setDockBadge, args: { count: 3 } },
			{ command: COMMANDS.setDockBadge, args: { count: null } },
		]);
	});

	it("PLAT-11 drains queued clicks on subscribe and on each click event", async () => {
		const answers: string[][] = [["conducted://workspace?id=w1"], ["conducted://workspace?id=w2"]];
		const { bindings, emit, listening } = harness((command) => {
			if (command === COMMANDS.notificationTakePending) return answers.shift() ?? [];
			return undefined;
		});
		const notifications = createTauriNotifications(bindings);
		const received: string[] = [];

		const unsubscribe = notifications.onClicked((deepLink) => received.push(deepLink));
		await vi.waitFor(() => expect(received).toEqual(["conducted://workspace?id=w1"]));

		await vi.waitFor(() => expect(listening()).toBe(true));
		emit(EVENTS.notificationClicked);
		await vi.waitFor(() =>
			expect(received).toEqual(["conducted://workspace?id=w1", "conducted://workspace?id=w2"]),
		);

		answers.push(["conducted://workspace?id=w3"]);
		unsubscribe();
		emit(EVENTS.notificationClicked);
		await flush();
		expect(received).toHaveLength(2);
	});
});
