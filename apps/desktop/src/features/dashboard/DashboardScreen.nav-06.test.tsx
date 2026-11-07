/**
 * @feature NAV-06 Kanban dashboard
 * Owns: tests of the Dashboard route over the real container and the app's own route tree:
 * dragging a card to another column stores its status, a failed write puts it back with a toast,
 * the status menu moves a card from the keyboard, the setting off sends the user Home, the empty
 * board offers 'New workspace', the project filter, and "Show N more" past ten cards.
 * Behaviour: ui-map.md 2, 3.8, 6 and 7.2.
 * Test first: Dropping a card on 'Done' calls workspaces.setKanbanStatus(id, 'done'); a failure
 * moves it back.
 */
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { createAppRouter } from "../../app/router.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { type HeldDatabase, holdingOnExecute } from "../../test/held-database.ts";
import { toast } from "../../ui/Toast.tsx";

type LooseComponent = (props: { children?: ReactNode } & Record<string, unknown>) => ReactNode;
const Services = ServicesProvider as unknown as LooseComponent;
const App = AppProviders as unknown as LooseComponent;

let opened: TestContainer | null = null;

/** The workspace repository's status write (core/db/workspaces.ts, WORKSPACES_SQL.setKanbanStatus). */
const SET_KANBAN_STATUS = "UPDATE workspaces SET kanban_status = $1, updated_at = $2 WHERE id = $3";

async function openDashboard(
	options: { enabled?: boolean; hold?: (held: HeldDatabase) => void } = {},
) {
	const test = createTestContainer({
		wrapDatabase: (database) => {
			if (options.hold === undefined) return database;
			const held = holdingOnExecute(database, SET_KANBAN_STATUS);
			options.hold(held);
			return held.database;
		},
	});
	opened = test;
	await test.container.services.settings.start();
	if (options.enabled !== false) {
		const set = await test.container.services.settings.set("dashboard_enabled", true);
		if (!set.ok) throw new Error(set.error.message);
	}
	return test;
}

async function mount(test: TestContainer) {
	await test.container.services.repo.start();
	await test.container.services.workspace.start();
	const router = createAppRouter(createMemoryHistory({ initialEntries: ["/dashboard"] }));
	render(
		createElement(
			Services,
			{ container: test.container },
			createElement(
				App,
				{ client: createQueryClient(() => {}) },
				createElement(RouterProvider, { router }),
			),
		),
	);
	await router.load();
	return router;
}

/** A drag's data, as the browser hands it from the card to the column. */
function dataTransfer() {
	const data = new Map<string, string>();
	return {
		setData: (type: string, value: string) => data.set(type, value),
		getData: (type: string) => data.get(type) ?? "",
		effectAllowed: "all",
		dropEffect: "none",
	};
}

function drag(card: HTMLElement, column: HTMLElement) {
	const transfer = dataTransfer();
	fireEvent.dragStart(card, { dataTransfer: transfer });
	fireEvent.dragOver(column, { dataTransfer: transfer });
	fireEvent.drop(column, { dataTransfer: transfer });
}

const column = (name: string) => screen.getByRole("region", { name });

afterEach(async () => {
	cleanup();
	toast.dismiss();
	if (opened === null) return;
	await opened.container.stop();
	opened.close();
	opened = null;
});

describe("NAV-06 Kanban dashboard", () => {
	it("stores the status of a card dropped on Done", async () => {
		const test = await openDashboard();
		const workspace = await seedWorkspace(test.container, {
			directoryName: "oslo",
			branch: "oslo",
		});
		await mount(test);
		const card = await within(column("In progress")).findByText("Oslo");

		drag(card.closest("article") as HTMLElement, column("Done"));

		expect(await within(column("Done")).findByText("Oslo")).toBeTruthy();
		await waitFor(() =>
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id]
					?.kanbanStatus,
			).toBe("done"),
		);
		const stored = await test.database.select<{ kanban_status: string }>(
			"SELECT kanban_status FROM workspaces WHERE id = $1",
			[workspace.id],
		);
		expect(stored.map((row) => row.kanban_status)).toEqual(["done"]);
	});

	it("puts a card back and says why when the status cannot be stored", async () => {
		const test = await openDashboard();
		const workspace = await seedWorkspace(test.container, {
			directoryName: "oslo",
			branch: "oslo",
		});
		await mount(test);
		const card = await within(column("In progress")).findByText("Oslo");
		// The row is gone, so the write fails while the board still shows the card.
		await test.database.execute("DELETE FROM workspaces WHERE id = $1", [workspace.id]);

		drag(card.closest("article") as HTMLElement, column("Done"));

		expect(await screen.findByText("Couldn't change the workspace status")).toBeTruthy();
		expect(within(column("In progress")).getByText("Oslo")).toBeTruthy();
		expect(within(column("Done")).queryByText("Oslo")).toBeNull();
	});

	it("moves a card from its status menu", async () => {
		const test = await openDashboard();
		await seedWorkspace(test.container, { directoryName: "oslo", branch: "oslo" });
		await mount(test);
		const trigger = await screen.findByRole("button", { name: "Status: In progress" });

		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "In review" }));

		expect(await within(column("In review")).findByText("Oslo")).toBeTruthy();
	});

	it("keeps a card moved twice in its last column while the first write answers", async () => {
		let held: HeldDatabase | null = null;
		const test = await openDashboard({
			hold: (database) => {
				held = database;
			},
		});
		const workspace = await seedWorkspace(test.container, {
			directoryName: "oslo",
			branch: "oslo",
		});
		await mount(test);
		const writes = held as unknown as HeldDatabase;
		const moveTo = async (status: string) => {
			const current = await screen.findByRole("button", { name: /^Status: / });
			fireEvent.keyDown(current, { key: "Enter" });
			fireEvent.click(await screen.findByRole("menuitemradio", { name: status }));
		};
		await moveTo("In review");
		expect(await within(column("In review")).findByText("Oslo")).toBeTruthy();
		await moveTo("Done");
		expect(await within(column("Done")).findByText("Oslo")).toBeTruthy();
		await waitFor(() => expect(writes.held()).toBe(2));

		// The first write answers while the second is still on its way.
		await writes.releaseNext();
		await waitFor(() =>
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id]
					?.kanbanStatus,
			).toBe("in_review"),
		);
		expect(within(column("Done")).getByText("Oslo")).toBeTruthy();
		expect(within(column("In review")).queryByText("Oslo")).toBeNull();

		await writes.releaseNext();
		await waitFor(() =>
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id]
					?.kanbanStatus,
			).toBe("done"),
		);
		expect(within(column("Done")).getByText("Oslo")).toBeTruthy();
	});

	it("sends the user Home while the Dashboard setting is off", async () => {
		const test = await openDashboard({ enabled: false });
		const router = await mount(test);
		await waitFor(() => expect(router.state.location.pathname).toBe("/"));
	});

	it("offers 'New workspace' on an empty board and opens the create screen", async () => {
		const test = await openDashboard();
		const repo = await seedRepo(test.container);
		const router = await mount(test);

		fireEvent.click(await screen.findByRole("button", { name: "New workspace" }));

		await waitFor(() => expect(router.state.location.pathname).toBe("/create"));
		expect(router.state.location.search).toMatchObject({ repo: repo.id });
	});

	it("filters the board by project once there is more than one", async () => {
		const test = await openDashboard();
		const first = await seedRepo(test.container, { name: "alpha" });
		const second = await seedRepo(test.container, { name: "beta" });
		await seedWorkspace(test.container, {
			repoId: first.id,
			directoryName: "oslo",
			branch: "oslo",
		});
		await seedWorkspace(test.container, {
			repoId: second.id,
			directoryName: "bergen",
			branch: "bergen",
		});
		await mount(test);
		const board = () => within(column("In progress"));
		expect(await board().findByText("Bergen")).toBeTruthy();
		const filter = screen.getByRole("group", { name: "Filter by project" });

		fireEvent.click(within(filter).getByRole("button", { name: "alpha" }));

		await waitFor(() => expect(board().queryByText("Bergen")).toBeNull());
		expect(board().getByText("Oslo")).toBeTruthy();
		fireEvent.click(within(filter).getByRole("button", { name: "All projects" }));
		expect(await board().findByText("Bergen")).toBeTruthy();
	});

	it("shows ten cards a column and the rest behind 'Show N more'", async () => {
		const test = await openDashboard();
		const repo = await seedRepo(test.container);
		for (let index = 0; index < 12; index += 1) {
			await seedWorkspace(test.container, {
				repoId: repo.id,
				directoryName: `place-${index}`,
				branch: `place-${index}`,
			});
		}
		await mount(test);
		const backlog = await screen.findByRole("list", { name: "In progress workspaces" });
		await waitFor(() => expect(within(backlog).getAllByRole("article")).toHaveLength(10));

		fireEvent.click(within(backlog).getByRole("button", { name: "Show 2 more" }));

		expect(within(backlog).getAllByRole("article")).toHaveLength(12);
		expect(within(backlog).getByRole("button", { name: "Show less" })).toBeTruthy();
	});
});
