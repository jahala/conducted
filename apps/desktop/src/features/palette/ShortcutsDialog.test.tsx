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
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { GlobalOverlays } from "../../app/GlobalOverlays.tsx";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
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

		expect(screen.getByText("Show or hide the left sidebar")).toBeTruthy();
		expect(screen.getByText("Show or hide the right panel")).toBeTruthy();
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
		const theme = row("Switch between light and dark theme");

		fireEvent.click(
			within(theme).getByRole("button", {
				name: "Change shortcut for Switch between light and dark theme",
			}),
		);
		fireEvent.keyDown(within(theme).getByRole("button", { name: "Recording shortcut" }), {
			key: "k",
			metaKey: true,
		});

		expect(await screen.findByText("Already used by Open the command palette.")).toBeTruthy();
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
		const theme = row("Switch between light and dark theme");

		fireEvent.click(
			within(theme).getByRole("button", {
				name: "Change shortcut for Switch between light and dark theme",
			}),
		);
		fireEvent.keyDown(within(theme).getByRole("button", { name: "Recording shortcut" }), {
			key: "q",
			metaKey: true,
		});

		expect(await within(theme).findByRole("alert")).toHaveProperty(
			"textContent",
			expect.stringContaining("reserved for Quit the app"),
		);
		expect(set).not.toHaveBeenCalled();
	});

	it("shows a fixed command without an edit control", async () => {
		await mountDialog();
		expect(screen.getByText("Quit the app")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Change shortcut for Quit the app" })).toBeNull();
	});

	it("resets every change from the dialog", async () => {
		const { set } = await mountDialog({
			key: "keybinding_overrides_v1",
			value: JSON.stringify({ "app.toggleTheme": ["Cmd+K"] }),
		});
		const theme = row("Switch between light and dark theme");
		expect(within(theme).getByText("⌘K")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Reset all shortcuts" }));

		await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
		expect(set.mock.calls[0]).toEqual(["keybinding_overrides_v1", ""]);
	});

	it("shows the bindings the send-key mode gives the chat", async () => {
		await mountDialog({ key: "message_send_key", value: "cmd-enter" });

		expect(within(row("Send the message")).getByText("Command Enter")).toBeTruthy();
		expect(within(row("Insert a new line")).getByText("Enter")).toBeTruthy();
	});
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
