/**
 * @feature NAV-14 Shortcut and menu dispatcher
 * Owns: tests for the root listeners and the handler hook: menu events, deep links, key presses and
 * the menu accelerators going out to the Rust shell.
 * Behaviour: ui-map.md 1.1, 5.4, 8.
 * Test first: the modal handler wins, then the base handler runs after the modal unmounts.
 */
import { appError, err, ok } from "@conducted/shared";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContainer } from "../core/container.ts";
import { ServicesProvider } from "../core/context.tsx";
import { tomlCodec } from "../core/services/toml-codec.ts";
import { createMemoryPlatform } from "../platform/memory.ts";
import type { Database, MenuShortcut, Platform } from "../platform/platform.ts";
import { Toaster } from "../ui/Toast.tsx";
import {
	CommandDispatcher,
	type CommandHandlerFn,
	CommandHint,
	type CommandRegistry,
	createCommandRegistry,
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

function BaseRegistration({ handler }: { handler: CommandHandlerFn }) {
	useCommandHandler("app.commandPalette", "base", handler);
	return null;
}

function ModalRegistration({ handler }: { handler: CommandHandlerFn }) {
	useCommandHandler("app.commandPalette", "modal", handler);
	return null;
}

function HandlerHarness({
	registry,
	modalOpen,
	base,
	modal,
}: {
	registry: CommandRegistry;
	modalOpen: boolean;
	base: CommandHandlerFn;
	modal: CommandHandlerFn;
}) {
	return (
		<CommandDispatcher registry={registry}>
			<BaseRegistration handler={base} />
			{modalOpen ? <ModalRegistration handler={modal} /> : null}
		</CommandDispatcher>
	);
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
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

		await waitFor(() => expect(shortcutCalls.length).toBeGreaterThan(0));
		expect(shortcutCalls[0]).toContainEqual({
			commandId: "view.toggleLeftSidebar",
			accelerator: "CmdOrCtrl+B",
		});
	});

	it("updates the menu accelerators after a rebind", async () => {
		const { container, shortcutCalls, wrapper } = buildHarness();
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });
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
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

		act(() => {
			for (const listener of menuListeners) listener("app.commandPalette");
		});

		expect(run).toHaveBeenCalledWith("app.commandPalette");
	});

	it("shows the user a command that failed to run", async () => {
		const { container, menuListeners, wrapper } = buildHarness();
		vi.spyOn(container.services.commands, "run").mockResolvedValue(
			err(appError("archive_failed", "The workspace is busy")),
		);
		render(
			<>
				<Toaster />
				<CommandDispatcher>{null}</CommandDispatcher>
			</>,
			{ wrapper },
		);

		act(() => {
			for (const listener of menuListeners) listener("app.commandPalette");
		});

		expect(await screen.findByText("The workspace is busy")).toBeTruthy();
	});

	it("reports a menu event for an id the registry does not know", () => {
		const { container, memory, menuListeners, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

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
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

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
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

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

	it("leaves the composer's Enter to the composer", () => {
		const { container, wrapper } = buildHarness();
		container.services.sessions.store.setState({ viewingSessionId: "s" as never });
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

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

		expect(event.defaultPrevented).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});

	it("leaves Cmd+Enter to the composer in Cmd+Enter mode", () => {
		const { container, wrapper } = buildHarness();
		const state = container.services.settings.store.getState();
		act(() => {
			container.services.settings.store.setState({
				values: { ...state.values, message_send_key: "cmd-enter" },
			});
		});
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

		const input = document.createElement("textarea");
		document.body.appendChild(input);
		input.focus();
		const event = new KeyboardEvent("keydown", {
			key: "Enter",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			input.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(false);
		expect(run).not.toHaveBeenCalled();
	});

	it("does not run a menu command that is disabled", () => {
		const { container, menuListeners, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

		act(() => {
			for (const listener of menuListeners) listener("workspace.archive");
		});

		expect(run).not.toHaveBeenCalled();
	});

	it("forwards a deep link to the caller and stops listening on unmount", () => {
		const { deepLinkListeners, menuListeners, wrapper } = buildHarness();
		const onDeepLink = vi.fn();
		const { unmount } = renderHook(
			() => useCommandDispatcher(createCommandRegistry(), { onDeepLink }),
			{ wrapper },
		);

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
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

		act(() => {
			for (const listener of deepLinkListeners) listener("conducted://settings");
		});

		expect(run).toHaveBeenCalledWith("app.openSettings");
	});

	it("reports a deep link that no command opens", () => {
		const { container, deepLinkListeners, memory, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

		act(() => {
			for (const listener of deepLinkListeners) listener("conducted://workspace?id=w1");
		});

		expect(run).not.toHaveBeenCalled();
		expect(memory.controls.logs.some((entry) => entry.message.includes("deep link"))).toBe(true);
	});
});

describe("NAV-14 CommandDispatcher", () => {
	it("mounts the listeners and sends a menu command through the shared registry", () => {
		const { container, menuListeners, shortcutCalls, wrapper } = buildHarness();
		const registry = createCommandRegistry();
		const handler = vi.fn(() => true);
		registry.register("app.commandPalette", "base", handler);
		vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));

		render(<CommandDispatcher registry={registry} />, { wrapper });

		expect(shortcutCalls.length).toBeGreaterThan(0);
		act(() => {
			for (const listener of menuListeners) listener("app.commandPalette");
		});
		expect(handler).toHaveBeenCalledTimes(1);
	});
});

describe("NAV-14 CommandHint", () => {
	it("reads the live binding and follows a rebind", async () => {
		const { container, wrapper } = buildHarness();
		const rendered = render(<CommandHint commandId="app.commandPalette" />, { wrapper });
		expect(rendered.getByText("⌘K")).toBeTruthy();

		act(() => {
			const state = container.services.settings.store.getState();
			container.services.settings.store.setState({
				values: {
					...state.values,
					keybinding_overrides_v1: JSON.stringify({ "app.commandPalette": ["Cmd+J"] }),
				},
			});
		});

		await waitFor(() => expect(rendered.getByText("⌘J")).toBeTruthy());
	});

	it("renders nothing for an unbound command", () => {
		const { wrapper } = buildHarness();
		const rendered = render(<CommandHint commandId="nav.nextUnread" />, { wrapper });
		expect(rendered.container.querySelector("kbd")).toBeNull();
	});
});

describe("NAV-14 useCommandHandler", () => {
	it("runs the modal handler while mounted, then the base handler after it unmounts", () => {
		const { container, menuListeners, wrapper } = buildHarness();
		const registry = createCommandRegistry();
		const base = vi.fn(() => true);
		const modal = vi.fn(() => true);
		vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));

		const { rerender } = render(
			<HandlerHarness registry={registry} modalOpen base={base} modal={modal} />,
			{ wrapper },
		);

		act(() => {
			for (const listener of menuListeners) listener("app.commandPalette");
		});
		expect(modal).toHaveBeenCalledTimes(1);
		expect(base).not.toHaveBeenCalled();

		rerender(<HandlerHarness registry={registry} modalOpen={false} base={base} modal={modal} />);
		act(() => {
			for (const listener of menuListeners) listener("app.commandPalette");
		});
		expect(modal).toHaveBeenCalledTimes(1);
		expect(base).toHaveBeenCalledTimes(1);
	});
});
