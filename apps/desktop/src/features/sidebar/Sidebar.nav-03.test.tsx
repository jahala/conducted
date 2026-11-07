/**
 * @feature NAV-03 Sidebar
 * Owns: tests that the live sidebar, over the real container and the app's providers, shows the
 * navigation rows, the no-projects empty state, and Help and Settings in its footer.
 * Test first: renders the navigation rows and, with no projects, the "Add a project to get started."
 * empty state.
 */
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { Sidebar } from "./Sidebar.tsx";

let open: TestContainer | null = null;

afterEach(() => {
	cleanup();
	open?.close();
	open = null;
});

/**
 * Mounts the sidebar as main.tsx does: the app's providers around the container. The projects are
 * read first, as the startup's "repos" step does, so an empty database means no projects.
 */
async function renderSidebar(): Promise<void> {
	open = createTestContainer();
	const started = await open.container.services.repo.start();
	if (!started.ok) throw new Error(started.error.message);
	renderWithRouter(
		<AppProviders client={createQueryClient(() => {})}>
			<ServicesProvider container={open.container}>
				<Sidebar />
			</ServicesProvider>
		</AppProviders>,
	);
}

describe("NAV-03 Sidebar", () => {
	it("shows the navigation rows and the no-projects empty state", async () => {
		await renderSidebar();
		expect(await screen.findByRole("link", { name: /Home/ })).toBeTruthy();
		expect(screen.getByRole("link", { name: /Create/ })).toBeTruthy();
		expect(screen.getByRole("button", { name: /Search/ })).toBeTruthy();
		expect(await screen.findByText("Add a project to get started.")).toBeTruthy();
	});

	it("makes Settings reachable from the footer", async () => {
		await renderSidebar();
		const settings = await screen.findByRole("link", { name: /Settings/ });
		expect(settings.getAttribute("href")).toBe("/settings");
	});

	it("has Conductor's footer: Help and Settings, and no add-project button", async () => {
		await renderSidebar();
		const settings = await screen.findByRole("link", { name: /Settings/ });
		const footer = settings.parentElement as HTMLElement;
		expect(within(footer).getByRole("button", { name: "Help" })).toBeTruthy();
		expect(within(footer).queryByRole("button", { name: /Add a project|Add project/ })).toBeNull();
	});

	it("opens the help menu from the footer", async () => {
		await renderSidebar();
		fireEvent.keyDown(await screen.findByRole("button", { name: "Help" }), { key: "Enter" });
		expect(await screen.findByRole("menuitem", { name: /Keyboard shortcuts/ })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: /Send feedback/ })).toBeTruthy();
		expect(screen.getByRole("menuitem", { name: /Diagnostics/ })).toBeTruthy();
	});
});
