/**
 * @feature NAV-14 Shortcut and menu dispatcher
 * Owns: tests for the root listeners and the handler hook: menu events, deep links, key presses and
 * the menu accelerators going out to the Rust shell.
 * Behaviour: ui-map.md 1.1, 5.4, 8.
 * Test first: the modal handler wins, then the base handler runs after the modal unmounts.
 */
import { ok } from "@conducted/shared";
import { act, cleanup, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContainer } from "../core/container.ts";
import { ServicesProvider } from "../core/context.tsx";
import { tomlCodec } from "../core/services/toml-codec.ts";
import { createMemoryPlatform } from "../platform/memory.ts";
import type { Database, MenuShortcut, Platform } from "../platform/platform.ts";
import {
	type CommandHandlerFn,
	useCommandDispatcher,
	useCommandHandler,
} from "./command-dispatcher.ts";
import { useOverlayStore } from "./overlay-store.ts";

const unusedDatabase: Database = {
	execute: () => Promise.reject(new Error("NAV-14 does not use the database.")),
	select: () => Promise.reject(new Error("NAV-14 does not use the database.")),
	transaction: () => Promise.reject(new Error("NAV-14 does not use the database.")),
};

const clock = { now: () => 1_000 };
const ids = { uuid: () => "id" };

function buildHarness() {
	const memory = createMemoryPlatform({ clock, ids, database: unusedDatabase });
	const menuListeners = new Set<(commandId: string) => void>();
	const deepLinkListeners = new Set<(url: string) => void>();
	const shortcutCalls: (readonly MenuShortcut[])[] = [];

	const platform: Platform = {
		...memory.platform,
		app: {
			...memory.platform.app,
			onDeepLink: (listener) => {
				deepLinkListeners.add(listener);
				return () => deepLinkListeners.delete(listener);
			},
		},
		menu: {
			setShortcuts: (shortcuts) => {
				shortcutCalls.push(shortcuts);
				return memory.platform.menu.setShortcuts(shortcuts);
			},
			onCommand: (listener) => {
				menuListeners.add(listener);
				return () => menuListeners.delete(listener);
			},
		},
	};

	const container = createContainer({
		platform,
		clock,
		ids,
		toml: tomlCodec,
		placeNames: { pick: () => "place" },
		sound: { play: async () => {} },
		windowFocused: () => true,
	});

	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={container}>{children}</ServicesProvider>
	);

	return {
		container,
		memory,
		menuListeners,
		deepLinkListeners,
		shortcutCalls,
		wrapper,
	};
}

function lastShortcutFor(calls: readonly (readonly MenuShortcut[])[], commandId: string) {
	const last = calls[calls.length - 1] ?? [];
	return last.find((shortcut) => shortcut.commandId === commandId)?.accelerator ?? null;
}

function ModalRegistration({ handler }: { handler: CommandHandlerFn }) {
	useCommandHandler("app.commandPalette", "modal", handler);
	return null;
}

function HandlerHarness({
	modalOpen,
	base,
	modal,
}: {
	modalOpen: boolean;
	base: CommandHandlerFn;
	modal: CommandHandlerFn;
}) {
	useCommandDispatcher();
	useCommandHandler("app.commandPalette", "base", base);
	return modalOpen ? <ModalRegistration handler={modal} /> : null;
}

beforeEach(() => {
	useOverlayStore.setState({ open: null });
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

describe("NAV-14 useCommandDispatcher", () => {
	it("pushes the registry's accelerators to the menu on mount", async () => {
		const { shortcutCalls, wrapper } = buildHarness();
		renderHook(() => useCommandDispatcher(), { wrapper });

		await waitFor(() => expect(shortcutCalls.length).toBeGreaterThan(0));
		expect(shortcutCalls[0]).toContainEqual({
			commandId: "view.toggleLeftSidebar",
			accelerator: "CmdOrCtrl+B",
		});
	});

	it("updates the menu accelerators after a rebind", async () => {
		const { container, shortcutCalls, wrapper } = buildHarness();
		renderHook(() => useCommandDispatcher(), { wrapper });
		await waitFor(() => expect(shortcutCalls.length).toBeGreaterThan(0));

		act(() => {
			const state = container.services.settings.store.getState();
			container.services.settings.store.setState({
				values: {
					...state.values,
					keybinding_overrides_v1: JSON.stringify({ "view.toggleLeftSidebar": ["Cmd+Shift+B"] }),
				},
			});
		});

		await waitFor(() =>
			expect(lastShortcutFor(shortcutCalls, "view.toggleLeftSidebar")).toBe("CmdOrCtrl+Shift+B"),
		);
	});

	it("runs the command a menu event names", () => {
		const { container, menuListeners, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(), { wrapper });

		act(() => {
			for (const listener of menuListeners) listener("app.commandPalette");
		});

		expect(run).toHaveBeenCalledWith("app.commandPalette");
	});

	it("reports a menu event for an id the registry does not know", () => {
		const { container, memory, menuListeners, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(), { wrapper });

		act(() => {
			for (const listener of menuListeners) listener("no.such.command");
		});

		expect(run).not.toHaveBeenCalled();
		expect(memory.controls.logs.some((entry) => entry.message.includes("no.such.command"))).toBe(
			true,
		);
	});

	it("turns a global key press into a command and swallows it", () => {
		const { container, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(), { wrapper });

		const event = new KeyboardEvent("keydown", {
			key: "k",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			document.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(true);
		expect(run).toHaveBeenCalledWith("app.commandPalette");
	});

	it("does not swallow the key of a disabled command", () => {
		const { container, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(), { wrapper });

		const event = new KeyboardEvent("keydown", {
			key: "a",
			metaKey: true,
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			document.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});

	it("uses the chat-input scope while a text field has focus", () => {
		const { container, wrapper } = buildHarness();
		container.services.sessions.store.setState({ viewingSessionId: "s" as never });
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(), { wrapper });

		const input = document.createElement("textarea");
		document.body.appendChild(input);
		input.focus();
		const event = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			input.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(true);
		expect(run).toHaveBeenCalledWith("chat.submit");
	});

	it("forwards a deep link to the caller and stops listening on unmount", () => {
		const { deepLinkListeners, menuListeners, wrapper } = buildHarness();
		const onDeepLink = vi.fn();
		const { unmount } = renderHook(() => useCommandDispatcher({ onDeepLink }), { wrapper });

		act(() => {
			for (const listener of deepLinkListeners) listener("conducted://workspace?id=w1");
		});
		expect(onDeepLink).toHaveBeenCalledWith("conducted://workspace?id=w1");

		unmount();
		expect(deepLinkListeners.size).toBe(0);
		expect(menuListeners.size).toBe(0);
	});

	it("opens settings for a settings deep link when no caller handles deep links", () => {
		const { container, deepLinkListeners, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(), { wrapper });

		act(() => {
			for (const listener of deepLinkListeners) listener("conducted://settings");
		});

		expect(run).toHaveBeenCalledWith("app.openSettings");
	});

	it("reports a deep link that no command opens", () => {
		const { container, deepLinkListeners, memory, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(), { wrapper });

		act(() => {
			for (const listener of deepLinkListeners) listener("conducted://workspace?id=w1");
		});

		expect(run).not.toHaveBeenCalled();
		expect(memory.controls.logs.some((entry) => entry.message.includes("deep link"))).toBe(true);
	});
});

describe("NAV-14 useCommandHandler", () => {
	it("runs the modal handler while mounted, then the base handler after it unmounts", () => {
		const { container, menuListeners, wrapper } = buildHarness();
		const base = vi.fn(() => true);
		const modal = vi.fn(() => true);
		vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));

		const { rerender } = render(<HandlerHarness modalOpen base={base} modal={modal} />, {
			wrapper,
		});

		act(() => {
			for (const listener of menuListeners) listener("app.commandPalette");
		});
		expect(modal).toHaveBeenCalledTimes(1);
		expect(base).not.toHaveBeenCalled();

		rerender(<HandlerHarness modalOpen={false} base={base} modal={modal} />);
		act(() => {
			for (const listener of menuListeners) listener("app.commandPalette");
		});
		expect(modal).toHaveBeenCalledTimes(1);
		expect(base).toHaveBeenCalledTimes(1);
	});
});
