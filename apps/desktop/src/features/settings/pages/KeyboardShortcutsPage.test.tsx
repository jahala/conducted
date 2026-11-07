import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../../core/context.tsx";
import { COMMANDS } from "../../../core/registries/commands.ts";
import { createTestContainer, type TestContainer } from "../../../test/container.ts";
import { KeyboardShortcutsPage } from "./KeyboardShortcutsPage.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

describe("SET-02 KeyboardShortcutsPage", () => {
	it("records a shortcut and reports the command that already uses it", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		const set = vi.spyOn(test.container.actions.settings, "set");
		render(
			<ServicesProvider container={test.container}>
				<KeyboardShortcutsPage />
			</ServicesProvider>,
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Change shortcut for Toggle theme (dark/light)",
			}),
		);
		const recorder = screen.getByRole("button", { name: "Recording shortcut" });
		fireEvent.keyDown(recorder, { key: "k", metaKey: true });

		expect(await screen.findByText(/Already used by Command palette/)).toBeTruthy();
		expect(set).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Replace" }));
		await waitFor(() => expect(set).toHaveBeenCalledTimes(1));
		expect(set.mock.calls[0]?.[0]).toBe("keybinding_overrides_v1");
		const palette = COMMANDS.find((command) => command.title === "Command palette");
		const saved = JSON.parse(String(set.mock.calls[0]?.[1])) as Record<string, string[]>;
		expect(saved["app.toggleTheme"]).toEqual(["Cmd+K"]);
		expect(saved[palette?.id ?? "missing"]).toEqual([]);
	});

	it("refuses a reserved key, as the shortcuts dialog does", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		const set = vi.spyOn(test.container.actions.settings, "set");
		render(
			<ServicesProvider container={test.container}>
				<KeyboardShortcutsPage />
			</ServicesProvider>,
		);

		fireEvent.click(
			screen.getByRole("button", {
				name: "Change shortcut for Toggle theme (dark/light)",
			}),
		);
		fireEvent.keyDown(screen.getByRole("button", { name: "Recording shortcut" }), {
			key: "q",
			metaKey: true,
		});

		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			expect.stringContaining("reserved for Quit"),
		);
		expect(set).not.toHaveBeenCalled();
	});

	it("lists each category as one bordered list, with Conductor's search and no category line per row", async () => {
		test = createTestContainer();
		await test.container.services.settings.start();
		render(
			<ServicesProvider container={test.container}>
				<KeyboardShortcutsPage />
			</ServicesProvider>,
		);

		const search = screen.getByRole("searchbox", { name: "Search keyboard shortcuts" });
		expect(search.getAttribute("placeholder")).toBe("Search keyboard shortcuts...");
		const general = screen.getByRole("heading", { name: "General" });
		const list = general.parentElement?.querySelector("[data-shortcut-list]");
		if (!(list instanceof HTMLElement)) throw new Error("no shortcut list under General");
		// The category is the list's heading only, never a line under each row.
		expect(within(list).queryByText("General")).toBeNull();
		expect(
			within(list).getByRole("button", { name: "Change shortcut for Toggle theme (dark/light)" }),
		).toBeTruthy();
		// Settings and Quit keep their keys: a lock, no pencil.
		expect(within(list).queryByRole("button", { name: /shortcut for Settings/ })).toBeNull();
		expect(within(list).getAllByText("Fixed shortcut").length).toBeGreaterThan(0);
	});
});
