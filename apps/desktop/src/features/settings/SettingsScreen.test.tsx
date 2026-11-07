import { ok, type RepoId } from "@conducted/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedRepo, type TestContainer } from "../../test/container.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { SettingsScreen } from "./SettingsScreen.tsx";

let test: TestContainer | undefined;

afterEach(() => {
	cleanup();
	test?.close();
	test = undefined;
});

async function mount(ui: ReactNode, before?: (mounted: TestContainer) => Promise<void>) {
	test = createTestContainer();
	await test.container.services.settings.start();
	await before?.(test);
	renderWithRouter(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>{ui}</AppProviders>
		</ServicesProvider>,
	);
	return test.container;
}

/** Cursor is installed and is the default Open in app. */
async function withCursorDefault(mounted: TestContainer) {
	vi.spyOn(mounted.container.platform.opener, "installedApps").mockResolvedValue([
		"Finder",
		"Cursor",
	]);
	mounted.container.services.settings.store.setState((state) => ({
		values: { ...state.values, default_open_in: "Cursor" },
	}));
}

describe("SET-02 SettingsScreen", () => {
	it("renders the Git page", async () => {
		await mount(<SettingsScreen page="git" />);
		expect(await screen.findByRole("heading", { name: "Git" })).toBeTruthy();
		// Conductor's branch name prefix is a group of radios.
		expect(screen.getByRole("group", { name: "Branch name prefix" })).toBeTruthy();
	});

	it("opens settings.toml in the default app from the top bar", async () => {
		const container = await mount(<SettingsScreen page="general" />, withCursorDefault);
		const openFile = vi
			.spyOn(container.actions.settings, "openFile")
			.mockResolvedValue(ok(undefined));
		const topBar = await screen.findByTestId("settings-top-bar");
		expect(topBar.hasAttribute("data-tauri-drag-region")).toBe(true);

		fireEvent.click(await within(topBar).findByRole("button", { name: "Open settings.toml" }));

		await waitFor(() => expect(openFile).toHaveBeenCalledWith("user", "Cursor"));
	});

	it("opens a repository's settings.local.toml, and copies its path from the menu", async () => {
		let repoId = "" as RepoId;
		const container = await mount(<SettingsScreen page="general" />, async (mounted) => {
			await withCursorDefault(mounted);
			repoId = (await seedRepo(mounted.container, { name: "atlas" })).id;
		});
		cleanup();
		renderWithRouter(
			<ServicesProvider container={container}>
				<AppProviders client={createQueryClient(() => {})}>
					<SettingsScreen page={`repo:${repoId}:scripts`} />
				</AppProviders>
			</ServicesProvider>,
		);
		const openFile = vi
			.spyOn(container.actions.settings, "openFile")
			.mockResolvedValue(ok(undefined));
		const filePath = vi
			.spyOn(container.actions.settings, "filePath")
			.mockResolvedValue(ok("/repos/atlas/.conducted/settings.local.toml"));
		const copyText = vi.spyOn(container.actions.app, "copyText").mockResolvedValue(ok(undefined));
		const topBar = await screen.findByTestId("settings-top-bar");

		fireEvent.click(
			await within(topBar).findByRole("button", { name: "Open settings.local.toml" }),
		);
		await waitFor(() => expect(openFile).toHaveBeenCalledWith({ repoId }, "Cursor"));

		fireEvent.click(within(topBar).getByRole("button", { name: "Open in..." }));
		const menu = await screen.findByRole("menu", { name: "Open in" });
		expect(within(menu).getByRole("menuitem", { name: /Finder/ })).toBeTruthy();
		fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy path" }));
		await waitFor(() =>
			expect(copyText).toHaveBeenCalledWith("/repos/atlas/.conducted/settings.local.toml"),
		);
		expect(filePath).toHaveBeenCalledWith({ repoId });
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
