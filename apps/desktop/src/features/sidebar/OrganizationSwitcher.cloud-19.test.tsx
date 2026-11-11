/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: tests that the sidebar's organisation switcher, over the real container, lists this Mac
 * and, on a paired Mac, its Worker marked "Cloud organization"; that choosing an entry is saved
 * and decides which workspaces the sidebar lists; and that an unpaired Mac lists this Mac only.
 * Test first: choosing the cloud entry saves it and the sidebar lists that Worker's workspaces.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { renderWithRouter } from "../../test/render-with-router.tsx";
import { Sidebar } from "./Sidebar.tsx";

const WORKER = "https://conducted.example.workers.dev";

let open: TestContainer | null = null;

afterEach(() => {
	cleanup();
	open?.close();
	open = null;
});

async function renderSidebar(test: TestContainer): Promise<void> {
	for (const started of [
		await test.container.services.settings.start(),
		await test.container.services.cloudPairing.start(),
		await test.container.services.repo.start(),
	]) {
		if (!started.ok) throw new Error(started.error.message);
	}
	renderWithRouter(
		<AppProviders client={createQueryClient(() => {})}>
			<ServicesProvider container={test.container}>
				<Sidebar />
			</ServicesProvider>
		</AppProviders>,
	);
}

/** Opens a project's group: with no workspace open, Conductor's groups start closed. */
async function openProjectGroup(name: string): Promise<void> {
	const region = await screen.findByRole("region", { name });
	for (const trigger of within(region.parentElement as HTMLElement).queryAllByRole("button", {
		expanded: false,
	})) {
		fireEvent.click(trigger);
	}
}

/** Opens the switcher from its trigger, as a keyboard user does. */
async function openSwitcher(): Promise<HTMLElement> {
	fireEvent.keyDown(await screen.findByRole("button", { name: "Account menu" }), { key: "Enter" });
	return screen.findByRole("menu");
}

describe("CLOUD-19 the organisation switcher", () => {
	it("choosing the cloud entry saves it and the sidebar lists that Worker's workspaces", async () => {
		open = createTestContainer();
		const repo = await seedRepo(open.container, { name: "api" });
		await seedWorkspace(open.container, { repoId: repo.id, directoryName: "oslo" });
		await seedWorkspace(open.container, {
			repoId: repo.id,
			directoryName: "lisbon",
			path: "/workspace/ws-lisbon",
			host: { kind: "cloud", url: WORKER, vmId: "ws-lisbon" },
		});
		await renderSidebar(open);

		const trigger = await screen.findByRole("button", { name: "Account menu" });
		expect(within(trigger).getByText("My Mac")).toBeTruthy();
		await openProjectGroup("api");
		expect(await screen.findByText("Oslo")).toBeTruthy();
		expect(screen.queryByText("Lisbon")).toBeNull();

		const menu = await openSwitcher();
		const entries = within(menu).getAllByRole("menuitem");
		expect(entries.map((entry) => entry.textContent)).toEqual([
			expect.stringContaining("My Mac"),
			expect.stringContaining("conducted.example.workers.dev"),
			expect.stringContaining("Settings"),
		]);
		expect(within(entries[1] as HTMLElement).getByText("Cloud organization")).toBeTruthy();

		fireEvent.click(
			within(menu).getByRole("menuitem", { name: /conducted\.example\.workers\.dev/ }),
		);

		await waitFor(() =>
			expect(open?.container.services.settings.get("active_organization")).toBe("cloud"),
		);
		await openProjectGroup("api");
		expect(await screen.findByText("Lisbon")).toBeTruthy();
		expect(screen.queryByText("Oslo")).toBeNull();
		expect(
			within(screen.getByRole("button", { name: "Account menu" })).getByText(
				"conducted.example.workers.dev",
			),
		).toBeTruthy();
		const stored = await open.database.select<{ value: string }>(
			"SELECT value FROM settings WHERE key = 'active_organization'",
		);
		expect(stored.map((row) => JSON.parse(row.value))).toEqual(["cloud"]);
	});

	it("an unpaired Mac lists this Mac only, and a stored cloud choice reads as this Mac", async () => {
		open = createTestContainer();
		open.memory.controls.setCloudPairing({ paired: false, url: null });
		const saved = await open.container.services.settings.start();
		if (!saved.ok) throw new Error(saved.error.message);
		const set = await open.container.services.settings.set("active_organization", "cloud");
		if (!set.ok) throw new Error(set.error.message);
		await renderSidebar(open);

		const trigger = await screen.findByRole("button", { name: "Account menu" });
		expect(within(trigger).getByText("My Mac")).toBeTruthy();
		const menu = await openSwitcher();
		expect(
			within(menu)
				.getAllByRole("menuitem")
				.map((entry) => entry.textContent),
		).toEqual([expect.stringContaining("Settings")]);
	});

	it("says organizations are unavailable while data privacy is on", async () => {
		open = createTestContainer();
		const saved = await open.container.services.settings.start();
		if (!saved.ok) throw new Error(saved.error.message);
		const set = await open.container.services.settings.set("enterprise_data_privacy", true);
		if (!set.ok) throw new Error(set.error.message);
		await renderSidebar(open);

		const menu = await openSwitcher();
		expect(
			within(menu).getByText(
				"Organizations are unavailable when enterprise data privacy is enabled.",
			),
		).toBeTruthy();
	});
});
