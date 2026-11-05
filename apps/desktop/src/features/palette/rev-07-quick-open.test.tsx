/**
 * @feature REV-07 Quick open
 * Owns: tests for the Cmd+P file picker: fuzzy matching, keyboard selection, opening a file tab,
 * the first-50 limit and the no-workspace explanation.
 * Behaviour: ui-map.md 3.6, 3.10.
 * Test first: Typing 'appshell' lists 'src/app/AppShell.tsx'; Enter opens it as a file tab.
 */
import type { WorkspaceId } from "@conducted/shared";
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
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { QuickOpen } from "./QuickOpen.tsx";

afterEach(cleanup);

async function renderDialog(
	container: ReturnType<typeof createTestContainer>["container"],
	node: ReactNode,
	workspaceId: WorkspaceId,
) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/repository/$repositoryId/workspace/$workspaceId",
		component: () => node,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({
			initialEntries: [`/repository/r1/workspace/${workspaceId}`],
		}),
	});
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return router;
}

describe("REV-07 QuickOpen", () => {
	it("lists a file by part of its name and opens it as a file tab on Enter", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/quick" });
			test.memory.controls.files.set(`${workspace.path}/src/app/AppShell.tsx`, "export {};\n");
			const onOpenChange = vi.fn();
			const router = await renderDialog(
				test.container,
				<QuickOpen open onOpenChange={onOpenChange} workspaceId={workspace.id} />,
				workspace.id,
			);
			const field = screen.getByRole("textbox", { name: "Search files by name" });
			fireEvent.change(field, { target: { value: "appshell" } });
			const row = await screen.findByRole("button", { name: "src/app/AppShell.tsx" });
			fireEvent.keyDown(field, { key: "Enter" });
			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({
					tab: "file",
					path: "src/app/AppShell.tsx",
				}),
			);
			expect(row).toBeTruthy();
			expect(onOpenChange).toHaveBeenCalledWith(false);
		} finally {
			test.close();
		}
	});

	it("moves the selection with the arrow keys", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/arrows" });
			test.memory.controls.files.set(`${workspace.path}/src/alpha.ts`, "a\n");
			test.memory.controls.files.set(`${workspace.path}/src/alphabet.ts`, "b\n");
			const router = await renderDialog(
				test.container,
				<QuickOpen open onOpenChange={vi.fn()} workspaceId={workspace.id} />,
				workspace.id,
			);
			const field = screen.getByRole("textbox", { name: "Search files by name" });
			fireEvent.change(field, { target: { value: "alpha" } });
			await screen.findByRole("button", { name: "src/alpha.ts" });
			fireEvent.keyDown(field, { key: "ArrowDown" });
			fireEvent.keyDown(field, { key: "Enter" });
			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({ path: "src/alphabet.ts" }),
			);
		} finally {
			test.close();
		}
	});

	it("shows only the first 50 matches", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/many" });
			for (let index = 0; index < 60; index += 1) {
				test.memory.controls.files.set(
					`${workspace.path}/src/match-${String(index).padStart(2, "0")}.ts`,
					"x\n",
				);
			}
			await renderDialog(
				test.container,
				<QuickOpen open onOpenChange={vi.fn()} workspaceId={workspace.id} />,
				workspace.id,
			);
			fireEvent.change(screen.getByRole("textbox", { name: "Search files by name" }), {
				target: { value: "match" },
			});
			await screen.findByRole("button", { name: "src/match-00.ts" });
			expect(screen.getAllByRole("button", { name: /^src\/match-/ })).toHaveLength(50);
		} finally {
			test.close();
		}
	});

	it("explains that there is no workspace to search", async () => {
		const test = createTestContainer();
		try {
			await renderDialog(
				test.container,
				<QuickOpen open onOpenChange={vi.fn()} workspaceId={null} />,
				"none" as WorkspaceId,
			);
			expect(screen.getByText("Open a workspace to search its files.")).toBeTruthy();
			expect(screen.queryByRole("textbox")).toBeNull();
		} finally {
			test.close();
		}
	});
});
