/**
 * @feature REV-07 Search in files
 * Owns: tests for the Cmd+Shift+F dialog: matches grouped by file, the three match options, the
 * pattern error, the two-character minimum and opening a match.
 * Behaviour: ui-map.md 3.6, 3.10.
 * Test first: Searching 'retry' returns matches grouped by file; turning on 'Whole word' removes
 * 'retrying'.
 */
import type { WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { SearchInFiles } from "./SearchInFiles.tsx";

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

async function setup() {
	const test = createTestContainer();
	const workspace = await seedWorkspace(test.container, { path: "/code/workspaces/search" });
	const files = test.memory.controls.files;
	files.set(`${workspace.path}/src/retry.ts`, "retry now\nretrying later\n");
	files.set(`${workspace.path}/src/other.ts`, "retry here\n");
	files.set(`${workspace.path}/src/case.ts`, "Retry now\n");
	return { test, workspace };
}

describe("REV-07 SearchInFiles", () => {
	it("groups matches by file", async () => {
		const { test, workspace } = await setup();
		try {
			await renderDialog(
				test.container,
				<SearchInFiles open onOpenChange={vi.fn()} workspaceId={workspace.id} />,
				workspace.id,
			);
			fireEvent.change(screen.getByRole("searchbox", { name: "Search file contents" }), {
				target: { value: "retry" },
			});
			const retryGroup = await screen.findByRole("region", { name: "src/retry.ts" });
			const otherGroup = await screen.findByRole("region", { name: "src/other.ts" });
			expect(within(retryGroup).getByRole("button", { name: "src/retry.ts:2" })).toBeTruthy();
			expect(within(otherGroup).getByRole("button", { name: "src/other.ts:1" })).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("removes a longer word when Whole word is on", async () => {
		const { test, workspace } = await setup();
		try {
			await renderDialog(
				test.container,
				<SearchInFiles open onOpenChange={vi.fn()} workspaceId={workspace.id} />,
				workspace.id,
			);
			fireEvent.change(screen.getByRole("searchbox", { name: "Search file contents" }), {
				target: { value: "retry" },
			});
			await screen.findByRole("button", { name: "src/retry.ts:2" });
			fireEvent.click(screen.getByRole("button", { name: "Whole word" }));
			await waitFor(() =>
				expect(screen.queryByRole("button", { name: "src/retry.ts:2" })).toBeNull(),
			);
			expect(await screen.findByRole("button", { name: "src/retry.ts:1" })).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("removes different casing when Match case is on", async () => {
		const { test, workspace } = await setup();
		try {
			await renderDialog(
				test.container,
				<SearchInFiles open onOpenChange={vi.fn()} workspaceId={workspace.id} />,
				workspace.id,
			);
			fireEvent.change(screen.getByRole("searchbox", { name: "Search file contents" }), {
				target: { value: "Retry" },
			});
			await screen.findByRole("region", { name: "src/retry.ts" });
			fireEvent.click(screen.getByRole("button", { name: "Match case" }));
			await waitFor(() =>
				expect(screen.queryByRole("region", { name: "src/retry.ts" })).toBeNull(),
			);
			expect(await screen.findByRole("region", { name: "src/case.ts" })).toBeTruthy();
		} finally {
			test.close();
		}
	});

	it("shows the pattern error and no matches for a bad regular expression", async () => {
		const { test, workspace } = await setup();
		try {
			await renderDialog(
				test.container,
				<SearchInFiles open onOpenChange={vi.fn()} workspaceId={workspace.id} />,
				workspace.id,
			);
			fireEvent.click(screen.getByRole("button", { name: "Regular expression" }));
			fireEvent.change(screen.getByRole("searchbox", { name: "Search file contents" }), {
				target: { value: "([a" },
			});
			const alert = await screen.findByRole("alert");
			expect(alert.textContent).toContain("Invalid pattern");
			expect(screen.queryByRole("region", { name: /^src\// })).toBeNull();
		} finally {
			test.close();
		}
	});

	it("waits for two characters and says so", async () => {
		const { test, workspace } = await setup();
		try {
			await renderDialog(
				test.container,
				<SearchInFiles open onOpenChange={vi.fn()} workspaceId={workspace.id} />,
				workspace.id,
			);
			fireEvent.change(screen.getByRole("searchbox", { name: "Search file contents" }), {
				target: { value: "r" },
			});
			expect(screen.getByText("Type at least 2 characters to search.")).toBeTruthy();
			expect(screen.queryByRole("region", { name: /^src\// })).toBeNull();
		} finally {
			test.close();
		}
	});

	it("opens a match as a file tab", async () => {
		const { test, workspace } = await setup();
		try {
			const router = await renderDialog(
				test.container,
				<SearchInFiles open onOpenChange={vi.fn()} workspaceId={workspace.id} />,
				workspace.id,
			);
			fireEvent.change(screen.getByRole("searchbox", { name: "Search file contents" }), {
				target: { value: "retry" },
			});
			const row = await screen.findByRole("button", { name: "src/retry.ts:1" });
			fireEvent.click(row);
			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({
					tab: "file",
					path: "src/retry.ts",
				}),
			);
		} finally {
			test.close();
		}
	});
});
