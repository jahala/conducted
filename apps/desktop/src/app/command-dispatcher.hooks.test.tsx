/**
 * @feature NAV-14 Shortcut and menu dispatcher
 * Owns: tests for the root listeners and the handler hook: menu events, deep links, key presses,
 * keys while a dialog is open, and the menu accelerators going out to the Rust shell.
 * Behaviour: ui-map.md 1.1, 5.4, 8.
 * Test first: the modal handler wins, then the base handler runs after the modal unmounts.
 */
import { appError, err, ok, type SessionId } from "@conducted/shared";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContainer } from "../core/container.ts";
import { ServicesProvider } from "../core/context.tsx";
import type { CommandId } from "../core/registries/commands.ts";
import { tomlCodec } from "../core/services/toml-codec.ts";
import { createMemoryPlatform } from "../platform/memory.ts";
import type { Database, MenuShortcut, Platform } from "../platform/platform.ts";
import { createTestIds } from "../test/ids.ts";
import { Dialog, DialogContent } from "../ui/Dialog.tsx";
import { Popover } from "../ui/Popover.tsx";
import { Toaster } from "../ui/Toast.tsx";
import {
	CommandDispatcher,
	type CommandHandlerFn,
	CommandHint,
	type CommandRegistry,
	createCommandRegistry,
	FIXED_MENU_COMMAND_IDS,
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
function buildHarness(options: { rejectFixed?: boolean } = {}) {
	const ids = createTestIds();
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
				if (options.rejectFixed === true) {
					// The Rust shell keeps Cmd+Q and Cmd+, fixed and refuses a binding for them.
					const applied = shortcuts
						.map((shortcut) => shortcut.commandId)
						.filter((commandId) => !FIXED_MENU_COMMAND_IDS.includes(commandId));
					const rejected = shortcuts
						.map((shortcut) => shortcut.commandId)
						.filter((commandId) => FIXED_MENU_COMMAND_IDS.includes(commandId));
					return Promise.resolve(ok({ applied, rejected }));
				}
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
		// This test starts no background work, so nothing is reported.
		reportFailure: () => undefined,
		showToast: () => undefined,
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

function ConfirmingDialog({ handler }: { handler: CommandHandlerFn }) {
	useCommandHandler("dialog.confirm", "modal", handler);
	return (
		<div role="dialog" aria-label="Start workspace">
			<input aria-label="Branch name" />
		</div>
	);
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

	it("sends no accelerator for a menu item Rust keeps fixed", async () => {
		const { shortcutCalls, wrapper } = buildHarness();
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

		await waitFor(() => expect(shortcutCalls.length).toBeGreaterThan(0));
		expect(FIXED_MENU_COMMAND_IDS.length).toBeGreaterThan(0);
		const sent = shortcutCalls[0] ?? [];
		for (const commandId of FIXED_MENU_COMMAND_IDS) {
			expect(sent.find((shortcut) => shortcut.commandId === commandId)).toBeUndefined();
		}
	});

	it("logs no menu warning on a clean start", async () => {
		const { memory, shortcutCalls, wrapper } = buildHarness({ rejectFixed: true });
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

		await waitFor(() => expect(shortcutCalls.length).toBeGreaterThan(0));
		await act(async () => {
			await Promise.resolve();
		});
		expect(
			memory.controls.logs.some((entry) => entry.message.startsWith("The menu rejected shortcuts")),
		).toBe(false);
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

	it("leaves Cmd+Enter alone in a dialog that has no confirm action", async () => {
		const { container, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run");
		render(
			<>
				<Toaster />
				<CommandDispatcher>
					<div role="dialog" aria-label="Quick open">
						<input aria-label="Search files" />
					</div>
				</CommandDispatcher>
			</>,
			{ wrapper },
		);
		const field = screen.getByLabelText("Search files");
		field.focus();

		const event = new KeyboardEvent("keydown", {
			key: "Enter",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			field.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(false);
		expect(run).not.toHaveBeenCalled();
		await act(async () => {});
		expect(screen.queryByText(/confirm the open dialog/i)).toBeNull();
	});

	it("runs the open dialog's confirm handler on Cmd+Enter", () => {
		const { container, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run");
		const confirm = vi.fn(() => true);
		render(
			<CommandDispatcher>
				<ConfirmingDialog handler={confirm} />
			</CommandDispatcher>,
			{ wrapper },
		);
		const field = screen.getByLabelText("Branch name");
		field.focus();

		const event = new KeyboardEvent("keydown", {
			key: "Enter",
			metaKey: true,
			bubbles: true,
			cancelable: true,
		});
		act(() => {
			field.dispatchEvent(event);
		});

		expect(confirm).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
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

	it("PLAT-16 shows 'Invalid deep link' for a link the shell refused", async () => {
		const { memory, wrapper } = buildHarness();
		render(
			<>
				<Toaster />
				<CommandDispatcher>{null}</CommandDispatcher>
			</>,
			{ wrapper },
		);

		act(() => {
			memory.controls.emitDeepLinkRejected(
				appError("deep_link_too_long", "A deep link longer than 65536 bytes was dropped."),
			);
		});

		expect(await screen.findByText("Invalid deep link")).toBeTruthy();
	});

	it("reports a deep link when no opener is mounted", () => {
		const { container, deepLinkListeners, memory, wrapper } = buildHarness();
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		renderHook(() => useCommandDispatcher(createCommandRegistry()), { wrapper });

		act(() => {
			for (const listener of deepLinkListeners) listener("conducted://workspace?id=w1");
		});

		expect(run).not.toHaveBeenCalled();
		expect(memory.controls.logs.some((entry) => entry.message.includes("deep-link opener"))).toBe(
			true,
		);
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

/** A screen's handler for one command, so a test sees whether a key reached it. */
function Handles({ commandId, handler }: { commandId: CommandId; handler: CommandHandlerFn }) {
	useCommandHandler(commandId, "base", handler);
	return null;
}

/** A chat on screen, so the chat commands are enabled, as they are while the user works in one. */
function viewChat(harness: ReturnType<typeof buildHarness>): void {
	harness.container.services.sessions.setViewing("on-screen" as SessionId);
}

/** Presses a key on the focused element, as the browser does, and hands back the event. */
function press(init: KeyboardEventInit): KeyboardEvent {
	const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
	const target = document.activeElement ?? document.body;
	act(() => {
		target.dispatchEvent(event);
	});
	return event;
}

const FORK = { key: "Enter", metaKey: true, altKey: true };
const APPROVE_PLAN = { key: "Enter", metaKey: true, shiftKey: true };

// Conductor's root key listener runs a handler while a dialog is open only when the handler was
// registered inside that dialog, or its command is marked global (renderApp @680362; the table's
// global flags from main @3778851). Issue #597.
describe("NAV-14 keys while a dialog is open", () => {
	it("does nothing for an app shortcut such as fork or approve plan while a dialog is open", () => {
		const harness = buildHarness();
		const { container, wrapper } = harness;
		viewChat(harness);
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		const fork = vi.fn(() => true);
		const approve = vi.fn(() => true);
		render(
			<CommandDispatcher>
				<Handles commandId="chat.fork" handler={fork} />
				<Handles commandId="chat.approvePlan" handler={approve} />
				<Dialog open>
					<DialogContent title="Rename chat">
						<input aria-label="Name" />
					</DialogContent>
				</Dialog>
			</CommandDispatcher>,
			{ wrapper },
		);
		screen.getByLabelText("Name").focus();

		const forked = press(FORK);
		const approved = press(APPROVE_PLAN);

		expect(fork).not.toHaveBeenCalled();
		expect(approve).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
		expect(forked.defaultPrevented).toBe(false);
		expect(approved.defaultPrevented).toBe(false);
	});

	it("does nothing for a chat field's shortcut typed in a dialog's field", () => {
		const harness = buildHarness();
		const { container, wrapper } = harness;
		viewChat(harness);
		vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		const findNext = vi.fn(() => true);
		render(
			<CommandDispatcher>
				<Handles commandId="chat.findNext" handler={findNext} />
				<Dialog open>
					<DialogContent title="Rename chat">
						<input aria-label="Name" />
					</DialogContent>
				</Dialog>
			</CommandDispatcher>,
			{ wrapper },
		);
		screen.getByLabelText("Name").focus();

		press({ key: "g", metaKey: true });

		expect(findNext).not.toHaveBeenCalled();
	});

	it("does nothing for an app shortcut while an overlay such as quick open is open", () => {
		const harness = buildHarness();
		const { container, wrapper } = harness;
		viewChat(harness);
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		const fork = vi.fn(() => true);
		render(
			<CommandDispatcher>
				<Handles commandId="chat.fork" handler={fork} />
			</CommandDispatcher>,
			{ wrapper },
		);
		act(() => {
			useOverlayStore.getState().show("quick-open");
		});

		press(FORK);

		expect(fork).not.toHaveBeenCalled();
		expect(run).not.toHaveBeenCalled();
	});

	it("still runs the dialog's own keys: Cmd+Enter confirms and Escape closes", () => {
		const harness = buildHarness();
		const { wrapper } = harness;
		viewChat(harness);
		const confirm = vi.fn();
		const openChange = vi.fn();
		render(
			<CommandDispatcher>
				<Dialog open onOpenChange={openChange}>
					<DialogContent title="Rename chat" onConfirm={confirm}>
						<input aria-label="Name" />
					</DialogContent>
				</Dialog>
			</CommandDispatcher>,
			{ wrapper },
		);
		screen.getByLabelText("Name").focus();

		press({ key: "Enter", metaKey: true });
		press({ key: "Escape" });

		expect(confirm).toHaveBeenCalledTimes(1);
		expect(openChange).toHaveBeenCalledWith(false);
	});

	it("runs a dialog command's handler, such as the open dialog's confirm", () => {
		const harness = buildHarness();
		const { wrapper } = harness;
		viewChat(harness);
		const confirm = vi.fn(() => true);
		render(
			<CommandDispatcher>
				<Dialog open>
					<DialogContent title="New workspace">
						<ConfirmingDialog handler={confirm} />
					</DialogContent>
				</Dialog>
			</CommandDispatcher>,
			{ wrapper },
		);
		screen.getByLabelText("Branch name").focus();

		const event = press({ key: "Enter", metaKey: true });

		expect(confirm).toHaveBeenCalledTimes(1);
		expect(event.defaultPrevented).toBe(true);
	});

	it("still runs the commands Conductor keeps over a dialog, such as Cmd+K for the palette", () => {
		const harness = buildHarness();
		const { container, wrapper } = harness;
		viewChat(harness);
		const run = vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		render(
			<CommandDispatcher>
				<Dialog open>
					<DialogContent title="Rename chat">
						<input aria-label="Name" />
					</DialogContent>
				</Dialog>
			</CommandDispatcher>,
			{ wrapper },
		);
		screen.getByLabelText("Name").focus();

		const event = press({ key: "k", metaKey: true });

		expect(run).toHaveBeenCalledWith("app.commandPalette");
		expect(event.defaultPrevented).toBe(true);
	});

	// A popover is not a dialog in Conductor (only its dialogs set the active dialog id), so app
	// shortcuts keep working while one is open. Radix gives a popover's panel the dialog role too.
	it("keeps app shortcuts working while a popover is open", () => {
		const harness = buildHarness();
		const { container, wrapper } = harness;
		viewChat(harness);
		vi.spyOn(container.services.commands, "run").mockResolvedValue(ok(undefined));
		const fork = vi.fn(() => true);
		render(
			<CommandDispatcher>
				<Handles commandId="chat.fork" handler={fork} />
				<Popover open trigger={<button type="button">Model</button>}>
					<input aria-label="Filter models" />
				</Popover>
			</CommandDispatcher>,
			{ wrapper },
		);
		const field = screen.getByLabelText("Filter models");
		expect(field.closest("[role='dialog']")).not.toBeNull();
		field.focus();

		press(FORK);

		expect(fork).toHaveBeenCalledTimes(1);
	});
});
