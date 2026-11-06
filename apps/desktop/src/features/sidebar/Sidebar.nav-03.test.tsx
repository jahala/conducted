/**
 * @feature NAV-03 Sidebar
 * Owns: tests that the live sidebar, over the real container and the app's providers, shows the
 * navigation rows, the no-projects empty state and Settings in its footer.
 * Test first: renders the navigation rows and, with no projects, the "No projects yet" empty state.
 */
import { cleanup, screen } from "@testing-library/react";
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
		expect(await screen.findByText("No projects yet")).toBeTruthy();
	});

	it("makes Settings reachable from the footer", async () => {
		await renderSidebar();
		const settings = await screen.findByRole("link", { name: /Settings/ });
		expect(settings.getAttribute("href")).toBe("/settings");
	});
});
