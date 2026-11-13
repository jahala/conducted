/**
 * @feature WS-07 Linked workspaces and extra folders
 * Owns: tests of the linked folders and workspaces shown above the composer, over the real
 * container.
 * Test first: a linked folder shows its name and path above the composer, and its X unlinks it.
 */
import type { WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { LinkedDirectoryChips } from "./LinkedDirectoryChips.tsx";

let active: TestContainer | undefined;

afterEach(() => {
	cleanup();
	active?.close();
	active = undefined;
});

/** The chips inside a router whose workspace route says which workspace it opened. */
function renderWithWorkspaceRoute(test: TestContainer, workspaceId: WorkspaceId) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const home = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <LinkedDirectoryChips workspaceId={workspaceId} />,
	});
	const opened = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: function Opened() {
			const { workspaceId: id } = opened.useParams();
			return <p>Workspace {id} opened</p>;
		},
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([home, opened]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={test.container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
}

function renderChips(test: TestContainer, workspaceId: WorkspaceId) {
	render(
		<ServicesProvider container={test.container}>
			<LinkedDirectoryChips workspaceId={workspaceId} />
		</ServicesProvider>,
	);
}

describe("WS-07 linked folders above the composer", () => {
	it("shows a linked folder's name and path, with Conductor's tooltip, and unlinks it", async () => {
		const test = createTestContainer();
		active = test;
		const workspace = await seedWorkspace(test.container, { linkedPaths: ["/code/shared-ui"] });
		renderChips(test, workspace.id);

		expect(await screen.findByText("shared-ui")).toBeTruthy();
		expect(screen.getByText("/code/shared-ui")).toBeTruthy();
		const chip = screen.getByText("shared-ui").closest("button") as HTMLButtonElement;
		fireEvent.focus(chip);
		expect(
			(
				await screen.findAllByText(
					"Files from this directory are accessible to the agent in this workspace.",
				)
			).length,
		).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole("button", { name: "Unlink directory shared-ui" }));

		await waitFor(() =>
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id]
					?.linkedPaths,
			).toEqual([]),
		);
	});

	it("shows nothing when nothing is linked", async () => {
		const test = createTestContainer();
		active = test;
		const workspace = await seedWorkspace(test.container);
		const { container } = render(
			<ServicesProvider container={test.container}>
				<LinkedDirectoryChips workspaceId={workspace.id} />
			</ServicesProvider>,
		);

		await waitFor(() =>
			expect(test.container.services.workspace.store.getState().loaded).toBe(true),
		);
		expect(container.textContent).toBe("");
	});

	// Conductor's chips for linked workspaces (renderApp `EYi` @9264300): the linked workspace's
	// project over its branch, which opens it and unlinks with its X; and on the linked workspace,
	// "Linked from" and the name of the workspace that links it, with no X.
	it("shows a linked workspace's chip with Conductor's tooltip, and opens it", async () => {
		const test = createTestContainer();
		active = test;
		const repo = await seedRepo(test.container, { name: "shared-ui" });
		const other = await seedWorkspace(test.container, {
			repoId: repo.id,
			branch: "sam/button-tokens",
			directoryName: "lisbon",
		});
		const workspace = await seedWorkspace(test.container, { linkedPaths: [other.path] });
		renderWithWorkspaceRoute(test, workspace.id);

		const open = await screen.findByRole("button", { name: "Open workspace shared-ui" });
		expect(open.textContent).toContain("sam/button-tokens");
		fireEvent.focus(open);
		expect(
			(
				await screen.findAllByText(
					"Files from this directory are accessible to Claude Code in this workspace.",
				)
			).length,
		).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: /^Unlink directory/ })).toBeNull();

		fireEvent.click(open);
		expect(await screen.findByText(`Workspace ${other.id} opened`)).toBeTruthy();
	});

	it("unlinks a linked workspace with its X", async () => {
		const test = createTestContainer();
		active = test;
		const repo = await seedRepo(test.container, { name: "shared-ui" });
		const other = await seedWorkspace(test.container, { repoId: repo.id });
		const workspace = await seedWorkspace(test.container, {
			linkedPaths: [other.path, "/code/notes"],
		});
		renderWithWorkspaceRoute(test, workspace.id);

		fireEvent.click(await screen.findByRole("button", { name: "Unlink workspace shared-ui" }));

		await waitFor(() =>
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id]
					?.linkedPaths,
			).toEqual(["/code/notes"]),
		);
	});

	it("shows Linked from on a workspace another one links, with Conductor's tooltip and no X", async () => {
		const test = createTestContainer();
		active = test;
		const linked = await seedWorkspace(test.container);
		await seedWorkspace(test.container, {
			linkedPaths: [linked.path],
			branch: "fix-login-redirect",
			branchIsPlaceholder: false,
		});
		renderWithWorkspaceRoute(test, linked.id);

		const chip = await screen.findByRole("button", { name: "Open workspace Fix login redirect" });
		expect(chip.textContent).toBe("Linked from Fix login redirect");
		fireEvent.focus(chip);
		expect(
			(await screen.findAllByText("Agents in Fix login redirect can access this workspace."))
				.length,
		).toBeGreaterThan(0);
		expect(screen.queryByRole("button", { name: /^Unlink workspace/ })).toBeNull();
	});
});
