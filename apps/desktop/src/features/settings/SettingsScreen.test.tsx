import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { SettingsScreen } from "./SettingsScreen.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

async function mount(ui: ReactNode) {
	test = createTestContainer();
	await test.container.services.settings.start();
	renderWithRouter(<ServicesProvider container={test.container}>{ui}</ServicesProvider>);
	return test.container;
}

describe("SET-02 SettingsScreen", () => {
	it("renders the Git page", async () => {
		await mount(<SettingsScreen page="git" />);
		expect(await screen.findByRole("heading", { name: "Git" })).toBeTruthy();
		expect(screen.getByRole("combobox", { name: "Branch name prefix" })).toBeTruthy();
	});

	it("renders the page-not-found state for an unknown page", async () => {
		await mount(<SettingsScreen page="nope" />);
		expect(await screen.findByRole("heading", { name: "Settings page not found" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Go to General" })).toBeTruthy();
	});

	it("focuses the search box when Cmd+F is pressed", async () => {
		await mount(
			<CommandDispatcher>
				<SettingsScreen page="general" />
			</CommandDispatcher>,
		);
		await screen.findByRole("heading", { name: "General" });

		fireEvent.keyDown(screen.getByTestId("settings-screen"), { key: "f", metaKey: true });

		expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search settings" }));
	});

	it("clears the search on the first Escape and leaves on the second", async () => {
		const onBack = vi.fn();
		await mount(
			<CommandDispatcher>
				<SettingsScreen page="general" onBack={onBack} />
			</CommandDispatcher>,
		);
		const input = (await screen.findByRole("searchbox", {
			name: "Search settings",
		})) as HTMLInputElement;
		fireEvent.change(input, { target: { value: "zoom" } });

		fireEvent.keyDown(input, { key: "Escape" });
		expect(input.value).toBe("");
		expect(onBack).not.toHaveBeenCalled();

		fireEvent.keyDown(input, { key: "Escape" });
		await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
	});

	it("opens a search result's page and highlights the setting", async () => {
		const onNavigate = vi.fn();
		await mount(<SettingsScreen page="general" onNavigate={onNavigate} />);
		const input = await screen.findByRole("searchbox", { name: "Search settings" });
		fireEvent.change(input, { target: { value: "send key" } });

		fireEvent.click(await screen.findByRole("button", { name: /Send messages with/ }));

		expect(onNavigate).toHaveBeenCalledWith({ kind: "user", page: "general" });
		await waitFor(() =>
			expect(
				document
					.querySelector('[data-setting-key="message_send_key"]')
					?.getAttribute("data-highlighted"),
			).toBe("true"),
		);
	});

	it("says the projects are loading while the project list is read", async () => {
		await mount(<SettingsScreen page="general" />);
		await screen.findByRole("heading", { name: "General" });

		expect(screen.getByText("Loading projects…")).toBeTruthy();
		expect(screen.queryByText(/No projects yet/)).toBeNull();
	});

	it("highlights a searched setting on the Appearance page", async () => {
		await mount(<SettingsScreen page="appearance" onNavigate={vi.fn()} />);
		const input = await screen.findByRole("searchbox", { name: "Search settings" });
		fireEvent.change(input, { target: { value: "zoom" } });

		fireEvent.click(await screen.findByRole("button", { name: /App zoom/ }));

		await waitFor(() =>
			expect(
				document
					.querySelector('[data-setting-key="zoom_level_v2"]')
					?.getAttribute("data-highlighted"),
			).toBe("true"),
		);
	});
});
