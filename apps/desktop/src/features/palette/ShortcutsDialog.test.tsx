/**
 * @feature NAV-09 Shortcuts dialog
 * Owns: tests for the dialog that lists, searches and rebinds shortcuts, and for the Cmd+Alt+/
 * shortcut that opens it through the real app root.
 * Behaviour: ui-map.md 5.2 (Keyboard shortcuts dialog with "Search shortcuts..."), 5.4 (the list,
 * the overrides setting, reserved keys and Cmd+Alt+/).
 * Test first: Searching 'sidebar' lists the two sidebar toggles; a conflicting binding shows a
 * warning naming the other command.
 */
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CommandDispatcher,
	commandForKeyPress,
	keyBindings,
} from "../../app/command-dispatcher.ts";
import { GlobalOverlays } from "../../app/GlobalOverlays.tsx";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import {
	formatShortcut,
	getCommand,
	parseShortcut,
	type ShortcutOverrides,
} from "../../core/registries/commands.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import "../../test/dom-polyfills.ts";
import { ShortcutsDialog } from "./ShortcutsDialog.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	useOverlayStore.getState().close();
	test?.close();
	test = undefined;
});

async function mountDialog(setting: { key: string; value: string } | null = null) {
	test = createTestContainer();
	await test.container.services.settings.start();
	if (setting !== null) {
		const saved = await test.container.actions.settings.set(setting.key, setting.value);
		if (!saved.ok) throw new Error(saved.error.message);
	}
	const set = vi.spyOn(test.container.actions.settings, "set");
	render(
		<ServicesProvider container={test.container}>
			<ShortcutsDialog open onOpenChange={() => undefined} workspaceId={null} />
		</ServicesProvider>,
	);
	return { test, set };
}

function row(title: string): HTMLElement {
	return screen.getByRole("group", { name: title });
}

describe("NAV-09 ShortcutsDialog", () => {
	it("searches by name and lists the two sidebar toggles", async () => {
		await mountDialog();
		fireEvent.change(screen.getByPlaceholderText("Search shortcuts..."), {
			target: { value: "sidebar" },
		});

		expect(screen.getByText("Toggle left sidebar")).toBeTruthy();
		expect(screen.getByText("Toggle right sidebar")).toBeTruthy();
	});

	it("says so when nothing matches the search", async () => {
		await mountDialog();
		fireEvent.change(screen.getByPlaceholderText("Search shortcuts..."), {
			target: { value: "zzzzzz" },
		});

		expect(screen.getByText("No shortcuts match your search.")).toBeTruthy();
	});

	it("reports a conflict with the other command and saves the replacement", async () => {
		const { set } = await mountDialog();
		const theme = row("Toggle theme (dark/light)");

		fireEvent.click(
			within(theme).getByRole("button", {
				name: "Change shortcut for Toggle theme (dark/light)",
			}),
		);
		fireEvent.keyDown(within(theme).getByRole("button", { name: "Recording shortcut" }), {
			key: "k",
			metaKey: true,
		});

		expect(await screen.findByText("Already used by Command palette.")).toBeTruthy();
		expect(set).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Replace" }));
		await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
		expect(set.mock.calls[0]?.[0]).toBe("keybinding_overrides_v1");
		const saved = JSON.parse(String(set.mock.calls[0]?.[1])) as Record<string, string[]>;
		expect(saved["app.toggleTheme"]).toEqual(["Cmd+K"]);
		expect(saved["app.commandPalette"]).toEqual([]);
	});

	it("refuses to bind a reserved key", async () => {
		const { set } = await mountDialog();
		const theme = row("Toggle theme (dark/light)");

		fireEvent.click(
			within(theme).getByRole("button", {
				name: "Change shortcut for Toggle theme (dark/light)",
			}),
		);
		fireEvent.keyDown(within(theme).getByRole("button", { name: "Recording shortcut" }), {
			key: "q",
			metaKey: true,
		});

		expect(await within(theme).findByRole("alert")).toHaveProperty(
			"textContent",
			expect.stringContaining("reserved for Quit"),
		);
		expect(set).not.toHaveBeenCalled();
	});

	it("shows a fixed command without an edit control", async () => {
		await mountDialog();
		expect(screen.getByText("Quit")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Change shortcut for Quit" })).toBeNull();
	});

	it("resets every change from the dialog", async () => {
		const { set } = await mountDialog({
			key: "keybinding_overrides_v1",
			value: JSON.stringify({ "app.toggleTheme": ["Cmd+K"] }),
		});
		const theme = row("Toggle theme (dark/light)");
		expect(within(theme).getByText("⌘K")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Reset all shortcuts" }));

		await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
		expect(set.mock.calls[0]).toEqual(["keybinding_overrides_v1", ""]);
	});

	it("shows the bindings the send-key mode gives the chat", async () => {
		await mountDialog({ key: "message_send_key", value: "cmd-enter" });

		expect(within(row("Submit message")).getByText("Command Enter")).toBeTruthy();
		expect(within(row("New line in chat")).getByText("Enter")).toBeTruthy();
	});
});

/** The Enter key the dispatcher runs `commandId` on, found by asking it about each candidate. */
function dispatcherKey(commandId: string, overrides: ShortcutOverrides): string | null {
	const command = getCommand(commandId);
	if (command === undefined) return null;
	for (const spec of ["Enter", "Cmd+Enter", "Alt+Enter", "Shift+Enter"]) {
		const parsed = parseShortcut(spec);
		if (!parsed.ok) continue;
		const press = {
			key: "Enter",
			metaKey: parsed.value.cmd,
			ctrlKey: parsed.value.ctrl,
			altKey: parsed.value.alt,
			shiftKey: parsed.value.shift,
			isComposing: false,
			repeat: false,
		};
		const bindings = keyBindings(overrides);
		if (commandForKeyPress(press, [command.scope], bindings, "mod_enter") === commandId) {
			return spec;
		}
	}
	return null;
}

describe("NAV-09 the dialog agrees with the dispatcher on the send keys", () => {
	const sendCommands = [
		"chat.newLine",
		"chat.submit",
		"chat.submitOpposite",
		"chat.question.submit",
	];
	const cases: { name: string; overrides: ShortcutOverrides }[] = [
		{ name: "the defaults", overrides: {} },
		{ name: "a rebind to the default key", overrides: { "chat.submit": ["Enter"] } },
	];
	for (const { name, overrides } of cases) {
		it(`shows the key the dispatcher runs each send command on, with ${name}`, async () => {
			test = createTestContainer();
			await test.container.services.settings.start();
			for (const [key, value] of [
				["message_send_key", "cmd-enter"],
				[
					"keybinding_overrides_v1",
					Object.keys(overrides).length === 0 ? "" : JSON.stringify(overrides),
				],
			] as const) {
				const saved = await test.container.actions.settings.set(key, value);
				if (!saved.ok) throw new Error(saved.error.message);
			}
			render(
				<ServicesProvider container={test.container}>
					<ShortcutsDialog open onOpenChange={() => undefined} workspaceId={null} />
				</ServicesProvider>,
			);

			for (const commandId of sendCommands) {
				const key = dispatcherKey(commandId, overrides);
				expect(key, commandId).not.toBeNull();
				const title = getCommand(commandId)?.title ?? commandId;
				expect(within(row(title)).getByText(formatShortcut(key ?? ""))).toBeTruthy();
			}
		});
	}
});

describe("NAV-09 Cmd+Alt+/", () => {
	it("opens the Keyboard shortcuts dialog through the root dispatcher", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		const rootRoute = createRootRoute();
		const route = createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: () => (
				<CommandDispatcher>
					<GlobalOverlays />
				</CommandDispatcher>
			),
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([route]),
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		render(
			<ServicesProvider container={test.container}>
				<AppProviders client={createQueryClient(() => {})}>
					<RouterProvider router={router} />
				</AppProviders>
			</ServicesProvider>,
		);
		await router.load();

		fireEvent.keyDown(document, { key: "/", metaKey: true, altKey: true });

		expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
		expect(screen.getByPlaceholderText("Search shortcuts...")).toBeTruthy();
	});
});
