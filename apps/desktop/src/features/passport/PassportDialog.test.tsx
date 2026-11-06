/**
 * @feature NAV-13 Passport
 * Owns: tests that reach the Passport through the real app root and container: its title, the map
 * markers, the place labels, archived places, the empty state and opening a workspace.
 * Test first: a workspace named 'Lisbon' appears as a marker; an archived one is marked archived in
 * text.
 */
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { createAppRouter } from "../../app/router.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import type { Workspace } from "../../core/model.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let test: TestContainer | undefined;

afterEach(async () => {
	cleanup();
	useOverlayStore.getState().close();
	if (test !== undefined) {
		await test.container.stop();
		test.close();
		test = undefined;
	}
});

async function mountRoot(container: TestContainer) {
	await container.container.services.settings.start();
	must(await container.container.services.workspace.start());
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/"] }));
	render(
		<ServicesProvider container={container.container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	act(() => useOverlayStore.getState().show("passport"));
	return router;
}

async function archiveWorkspace(container: TestContainer, workspace: Workspace) {
	await container.container.platform.db.execute(
		"UPDATE workspaces SET state = 'archived', archive_commit = $1, archived_at = $2 WHERE id = $3",
		["abc123", 1000, workspace.id],
	);
	must(await container.container.services.workspace.start());
}

describe("NAV-13 passport dialog", () => {
	it("plots a workspace named Lisbon and shows the passport labels", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container, { name: "conducted" });
		await seedWorkspace(test.container, { repoId: repo.id, directoryName: "lisbon-v2" });
		await mountRoot(test);

		expect(await screen.findByText("Conductor Passport")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Lisbon" })).toBeTruthy();
		expect(screen.getByText("CITIES VISITED")).toBeTruthy();
		expect(screen.getByText("[CLICK TO OPEN]")).toBeTruthy();
		expect(screen.getByText("[NOT VISITED]")).toBeTruthy();

		const places = screen.getByRole("list", { name: "Places" });
		expect(within(places).getByText("Lisbon")).toBeTruthy();
		expect(within(places).getByText("Portugal")).toBeTruthy();
	});

	it("lists an archived workspace and marks it archived in text", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container, { name: "conducted" });
		const oslo = await seedWorkspace(test.container, {
			repoId: repo.id,
			directoryName: "oslo",
		});
		await archiveWorkspace(test, oslo);
		await mountRoot(test);

		expect(await screen.findByText("Conductor Passport")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Oslo, archived" })).toBeTruthy();

		const places = screen.getByRole("list", { name: "Places" });
		expect(within(places).getByText("Oslo")).toBeTruthy();
		expect(within(places).getByText("[ARCHIVED]")).toBeTruthy();
	});

	it("explains that there is nothing to plot yet", async () => {
		test = createTestContainer();
		await mountRoot(test);

		expect(await screen.findByText("No workspaces yet")).toBeTruthy();
	});

	it("opens the workspace whose marker is chosen and closes the dialog", async () => {
		test = createTestContainer();
		const repo = await seedRepo(test.container, { name: "conducted" });
		const lisbon = await seedWorkspace(test.container, {
			repoId: repo.id,
			directoryName: "lisbon",
		});
		const router = await mountRoot(test);

		fireEvent.click(await screen.findByRole("button", { name: "Lisbon" }));

		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				`/repository/${lisbon.repoId}/workspace/${lisbon.id}`,
			),
		);
		expect(useOverlayStore.getState().open).toBeNull();
	});
});
