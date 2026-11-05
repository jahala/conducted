/**
 * @feature NAV-04 Sidebar sections
 * Owns: tests for the user's sections: dropping a workspace into one, the error path, deleting a
 * section, reordering section headers, and the create-in-section action.
 * Test first: Placing a workspace into a section calls sections.place with the section id and the
 * drop position.
 */
import { appError, err, ok, type Result, type SectionId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedRepo, seedWorkspace } from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { SectionList } from "./SectionList.tsx";
import { WORKSPACE_DRAG_MIME } from "./use-workspace-drag.ts";

afterEach(cleanup);

const must = <T,>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

function renderWith(container: ReturnType<typeof createTestContainer>["container"], ui: ReactNode) {
	const rootRoute = createRootRoute();
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => <>{ui}</>,
	});
	const createRouteNode = createRoute({
		getParentRoute: () => rootRoute,
		path: "/create",
		component: () => <p>create</p>,
	});
	const workspaceRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => <p>workspace</p>,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, createRouteNode, workspaceRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return render(
		<ServicesProvider container={container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
}

const dropData = (id: string) => ({
	getData: (type: string) => (type === WORKSPACE_DRAG_MIME ? id : ""),
	setData: vi.fn(),
});

describe("NAV-04 SectionList", () => {
	it("places a workspace dropped into a section at the drop position", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const workspace = await seedWorkspace(test.container, { repoId: repo.id });
			const service = test.container.services.sections;
			const created = must(await service.create("Review", null));
			const place = vi
				.spyOn(test.container.actions.sections, "place")
				.mockResolvedValue(ok(undefined));
			renderWith(
				test.container,
				<SectionList sections={service.store.getState().sections} workspaces={[workspace]} />,
			);
			const region = await screen.findByRole("region", { name: "Review" });
			fireEvent.drop(region, { dataTransfer: dropData(workspace.id) });
			await waitFor(() => expect(place).toHaveBeenCalledWith(workspace.id, created.id, 0));
		} finally {
			test.close();
		}
	});

	it("shows the failure toast and keeps the saved order when a move fails", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const first = await seedWorkspace(test.container, { repoId: repo.id });
			const second = await seedWorkspace(test.container, { repoId: repo.id });
			const dragged = await seedWorkspace(test.container, { repoId: repo.id });
			const service = test.container.services.sections;
			const created = must(await service.create("Review", null));
			must(await service.place(first.id, created.id, 0));
			must(await service.place(second.id, created.id, 1));
			vi.spyOn(test.container.actions.sections, "place").mockResolvedValue(
				err(appError("db", "The database is locked.")),
			);
			const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
			try {
				renderWith(
					test.container,
					<SectionList
						sections={service.store.getState().sections}
						workspaces={[first, second, dragged]}
					/>,
				);
				const region = await screen.findByRole("region", { name: "Review" });
				fireEvent.drop(region, { dataTransfer: dropData(dragged.id) });
				await waitFor(() =>
					expect(toasted).toHaveBeenCalledWith("Couldn't move workspace", {
						description: "The database is locked.",
					}),
				);
				expect(service.store.getState().sections[0]?.workspaceIds).toEqual([first.id, second.id]);
			} finally {
				toasted.mockRestore();
			}
		} finally {
			test.close();
		}
	});

	it("asks before deleting a section and then removes it", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.sections;
			const created = must(await service.create("Review", null));
			const remove = vi
				.spyOn(test.container.actions.sections, "remove")
				.mockResolvedValue(ok(undefined));
			renderWith(
				test.container,
				<SectionList sections={service.store.getState().sections} workspaces={[]} />,
			);
			const trigger = await screen.findByRole("button", { name: "Actions for Review" });
			trigger.focus();
			fireEvent.keyDown(trigger, { key: "Enter" });
			fireEvent.click(await screen.findByRole("menuitem", { name: "Delete section" }));
			fireEvent.click(await screen.findByRole("button", { name: "Delete section" }));
			await waitFor(() => expect(remove).toHaveBeenCalledWith(created.id));
		} finally {
			test.close();
		}
	});

	it("reorders sections when one header is dropped on another", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.sections;
			const alpha = must(await service.create("Alpha", null));
			const beta = must(await service.create("Beta", null));
			const reorder = vi
				.spyOn(test.container.actions.sections, "reorder")
				.mockResolvedValue(ok(undefined));
			renderWith(
				test.container,
				<SectionList sections={service.store.getState().sections} workspaces={[]} />,
			);
			const alphaTrigger = await screen.findByRole("button", { name: "Alpha" });
			const betaTrigger = screen.getByRole("button", { name: "Beta" });
			fireEvent.dragStart(alphaTrigger, { dataTransfer: { setData: vi.fn() } });
			const betaHeader = betaTrigger.parentElement;
			if (betaHeader === null) throw new Error("The section header is missing.");
			fireEvent.dragOver(betaHeader);
			fireEvent.drop(betaHeader);
			await waitFor(() =>
				expect(reorder).toHaveBeenCalledWith([beta.id as SectionId, alpha.id as SectionId]),
			);
		} finally {
			test.close();
		}
	});

	it("moves a section to the first position when dropped on the top half of a header", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.sections;
			const alpha = must(await service.create("Alpha", null));
			const beta = must(await service.create("Beta", null));
			const reorder = vi
				.spyOn(test.container.actions.sections, "reorder")
				.mockResolvedValue(ok(undefined));
			renderWith(
				test.container,
				<SectionList sections={service.store.getState().sections} workspaces={[]} />,
			);
			const alphaTrigger = await screen.findByRole("button", { name: "Alpha" });
			const betaTrigger = screen.getByRole("button", { name: "Beta" });
			const alphaHeader = alphaTrigger.parentElement;
			if (alphaHeader === null) throw new Error("The section header is missing.");
			vi.spyOn(alphaHeader, "getBoundingClientRect").mockReturnValue({
				top: 0,
				height: 20,
			} as DOMRect);
			fireEvent.dragStart(betaTrigger, { dataTransfer: { setData: vi.fn() } });
			fireEvent.dragOver(alphaHeader);
			fireEvent.drop(alphaHeader, { clientY: 5 });
			await waitFor(() =>
				expect(reorder).toHaveBeenCalledWith([beta.id as SectionId, alpha.id as SectionId]),
			);
		} finally {
			test.close();
		}
	});

	it("offers Create in section with the section in the create link", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.sections;
			const created = must(await service.create("Review", null));
			renderWith(
				test.container,
				<SectionList sections={service.store.getState().sections} workspaces={[]} />,
			);
			const link = await screen.findByRole("link", { name: "Create workspace in Review" });
			expect(link.getAttribute("href")).toBe(`/create?section=${created.id}`);
		} finally {
			test.close();
		}
	});
});

describe("NAV-04 SectionList errors and manual order", () => {
	it("reports a failed section reorder and keeps the saved order", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.sections;
			must(await service.create("Alpha", null));
			must(await service.create("Beta", null));
			vi.spyOn(test.container.actions.sections, "reorder").mockResolvedValue(
				err(appError("db", "The database is locked.")),
			);
			const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
			try {
				renderWith(
					test.container,
					<SectionList sections={service.store.getState().sections} workspaces={[]} />,
				);
				const alphaTrigger = await screen.findByRole("button", { name: "Alpha" });
				const betaTrigger = screen.getByRole("button", { name: "Beta" });
				fireEvent.dragStart(alphaTrigger, { dataTransfer: { setData: vi.fn() } });
				const betaHeader = betaTrigger.parentElement;
				if (betaHeader === null) throw new Error("The section header is missing.");
				fireEvent.dragOver(betaHeader);
				fireEvent.drop(betaHeader);
				await waitFor(() =>
					expect(toasted).toHaveBeenCalledWith("Couldn't reorder section", {
						description: "The database is locked.",
					}),
				);
			} finally {
				toasted.mockRestore();
			}
		} finally {
			test.close();
		}
	});

	it("reports a failed delete and keeps the section", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.sections;
			must(await service.create("Review", null));
			vi.spyOn(test.container.actions.sections, "remove").mockResolvedValue(
				err(appError("db", "The database is locked.")),
			);
			const toasted = vi.spyOn(toast, "error").mockReturnValue("t");
			try {
				renderWith(
					test.container,
					<SectionList sections={service.store.getState().sections} workspaces={[]} />,
				);
				const trigger = await screen.findByRole("button", { name: "Actions for Review" });
				trigger.focus();
				fireEvent.keyDown(trigger, { key: "Enter" });
				fireEvent.click(await screen.findByRole("menuitem", { name: "Delete section" }));
				fireEvent.click(await screen.findByRole("button", { name: "Delete section" }));
				await waitFor(() =>
					expect(toasted).toHaveBeenCalledWith("Couldn't delete section", {
						description: "The database is locked.",
					}),
				);
				expect(service.store.getState().sections).toHaveLength(1);
			} finally {
				toasted.mockRestore();
			}
		} finally {
			test.close();
		}
	});

	it("renames a section from its row menu", async () => {
		const test = createTestContainer();
		try {
			const service = test.container.services.sections;
			must(await service.create("Review", null));
			const rename = vi
				.spyOn(test.container.actions.sections, "rename")
				.mockResolvedValue(ok(undefined));
			renderWith(
				test.container,
				<SectionList sections={service.store.getState().sections} workspaces={[]} />,
			);
			const trigger = await screen.findByRole("button", { name: "Actions for Review" });
			trigger.focus();
			fireEvent.keyDown(trigger, { key: "Enter" });
			fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
			fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), {
				target: { value: "In review" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save" }));
			await waitFor(() =>
				expect(rename).toHaveBeenCalledWith(
					service.store.getState().sections[0]?.id,
					"In review",
					null,
				),
			);
		} finally {
			test.close();
		}
	});

	it("reorders rows inside a section when manual order is on", async () => {
		const test = createTestContainer();
		try {
			const repo = await seedRepo(test.container);
			const first = await seedWorkspace(test.container, { repoId: repo.id });
			const second = await seedWorkspace(test.container, { repoId: repo.id });
			const service = test.container.services.sections;
			const created = must(await service.create("Review", null));
			must(await service.place(first.id, created.id, 0));
			must(await service.place(second.id, created.id, 1));
			test.container.services.settings.store.setState((state) => ({
				...state,
				loaded: true,
				values: { ...state.values, manual_workspace_order: true },
			}));
			const place = vi
				.spyOn(test.container.actions.sections, "place")
				.mockResolvedValue(ok(undefined));
			renderWith(
				test.container,
				<SectionList sections={service.store.getState().sections} workspaces={[first, second]} />,
			);
			const region = await screen.findByRole("region", { name: "Review" });
			const firstRow = region.querySelector(`[data-workspace-id="${first.id}"]`);
			const secondRow = region.querySelector(`[data-workspace-id="${second.id}"]`);
			if (firstRow === null || secondRow === null) throw new Error("A row is missing.");
			fireEvent.dragStart(firstRow, { dataTransfer: { setData: vi.fn() } });
			fireEvent.dragOver(secondRow);
			fireEvent.drop(secondRow, { dataTransfer: dropData(first.id) });
			await waitFor(() => expect(place).toHaveBeenCalledWith(first.id, created.id, 1));
		} finally {
			test.close();
		}
	});
});
