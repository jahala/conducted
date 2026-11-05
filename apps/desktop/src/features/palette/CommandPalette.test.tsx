/**
 * @feature NAV-08 Command palette
 * Owns: tests that open the palette through the real app root and exercise its workspaces, tabs, shortcuts and
 * empty state.
 * Behaviour: ui-map.md 5.1 (tabs and placeholders, workspace actions), 5.4 (Cmd+K).
 * Test first: typing "arch" lists "Archive workspace" when a workspace is open and not when none is.
 */
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { createAppRouter } from "../../app/router.tsx";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { Workspace } from "../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";

const containers: { close(): void }[] = [];

afterEach(() => {
	cleanup();
	useOverlayStore.getState().close();
	for (const container of containers.splice(0)) container.close();
});

interface Mounted {
	container: Container;
	workspace: Workspace | null;
}

async function mountApp(withWorkspace: boolean): Promise<Mounted> {
	const test = createTestContainer();
	containers.push(test);
	await test.container.services.settings.start();
	const repo = await seedRepo(test.container, { name: "conducted" });
	const workspace = withWorkspace
		? await seedWorkspace(test.container, {
				repoId: repo.id,
				directoryName: "fix-login",
			})
		: null;
	const path =
		workspace === null ? "/" : `/repository/${workspace.repoId}/workspace/${workspace.id}`;
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	useOverlayStore.getState().show("palette");
	return { container: test.container, workspace };
}

async function openPalette(withWorkspace: boolean) {
	const mounted = await mountApp(withWorkspace);
	const input = await screen.findByPlaceholderText("Type a command or search...");
	return { ...mounted, input };
}

async function mountBare() {
	const test = createTestContainer();
	containers.push(test);
	await test.container.services.settings.start();
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
	render(
		<ServicesProvider container={test.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	useOverlayStore.getState().show("palette");
	return test.container;
}

describe("NAV-08 CommandPalette", () => {
	it("lists Archive workspace for a matching query when a workspace is open", async () => {
		const { input } = await openPalette(true);
		fireEvent.change(input, { target: { value: "arch" } });
		expect(await screen.findByText("Archive workspace")).toBeTruthy();
	});

	it("hides workspace actions when no workspace is open", async () => {
		const { input } = await openPalette(false);
		fireEvent.change(input, { target: { value: "arch" } });
		expect(await screen.findByText("View archived workspaces")).toBeTruthy();
		expect(screen.queryByText("Archive workspace")).toBeNull();
	});

	it("changes the placeholder with the tab and cycles tabs with Tab and Shift+Tab", async () => {
		const { input } = await openPalette(false);
		fireEvent.click(screen.getByRole("tab", { name: "Workspaces" }));
		expect(input.getAttribute("placeholder")).toBe("Search workspaces...");

		fireEvent.keyDown(input, { key: "Tab" });
		expect(input.getAttribute("placeholder")).toBe("Search projects...");

		fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
		expect(input.getAttribute("placeholder")).toBe("Search workspaces...");
	});

	it("lists settings pages on the settings tab", async () => {
		await openPalette(false);
		fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
		expect(await screen.findByText("General")).toBeTruthy();
		expect(screen.getByText("Claude Code")).toBeTruthy();
	});

	it("shows the loading spinner before the stores have loaded", async () => {
		await mountBare();
		expect(await screen.findByRole("status", { name: "Loading the command palette" })).toBeTruthy();
	});

	it("shows No results found for a query with no matches", async () => {
		const { input } = await openPalette(false);
		fireEvent.change(input, { target: { value: "zzzzzz" } });
		expect(await screen.findByText("No results found")).toBeTruthy();
	});
});
