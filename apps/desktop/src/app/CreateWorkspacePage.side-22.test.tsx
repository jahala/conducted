/**
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: the tests for the new-workspace first-message field's '@' file list and '/' command list.
 * Behaviour: ui-map.md 3.5 (the '@' trigger searches the chosen repository's files and the '/'
 * trigger lists commands and skills, before a workspace exists).
 * Test first: typing '@app' offers the repository's file and choosing it inserts its path; typing
 * '/ski' offers the saved skill and choosing it inserts its name.
 */
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import { preWorkspaceSlashKey } from "../core/services/agent-catalog.ts";
import { createTestContainer, seedRepo } from "../test/container.ts";
import { CreateWorkspacePage, fileMentionAt, slashMentionAt } from "./CreateWorkspacePage.tsx";

afterEach(cleanup);

async function renderPage() {
	const test = createTestContainer();
	const repo = await seedRepo(test.container, { rootPath: "/code/projects/app" });
	test.memory.controls.files.set("/code/projects/app/src/app.ts", "export {};\n");
	const rootRoute = createRootRoute({ component: () => <Outlet /> });
	const createPageRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/create",
		validateSearch: (search: Record<string, unknown>) => search as { section?: string },
		component: () => <CreateWorkspacePage />,
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([createPageRoute]),
		history: createMemoryHistory({ initialEntries: ["/create"] }),
	});
	render(
		<ServicesProvider container={test.container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
	await router.load();
	return { test, repo, router };
}

describe("SIDE-22 new-workspace file mentions", () => {
	it("SIDE-22 typing '@' with a query offers the repository's files", async () => {
		const { test } = await renderPage();
		try {
			const input = (await screen.findByLabelText("First message")) as HTMLTextAreaElement;

			fireEvent.change(input, { target: { value: "@app" } });

			const option = await screen.findByRole("option", { name: /src\/app\.ts/ });
			fireEvent.click(option);
			expect(input.value).toBe("@src/app.ts ");
		} finally {
			test.close();
		}
	});

	it("SIDE-22 waits for two characters before searching the repository", async () => {
		const { test } = await renderPage();
		try {
			const search = vi.spyOn(test.container.services.workspaceFiles, "quickOpenRoot");
			const input = (await screen.findByLabelText("First message")) as HTMLTextAreaElement;

			fireEvent.change(input, { target: { value: "@s" } });

			expect(screen.queryByRole("option")).toBeNull();
			expect(search).not.toHaveBeenCalled();
		} finally {
			test.close();
		}
	});

	it("SIDE-22 reads the mention only when '@' starts the word under the caret", () => {
		expect(fileMentionAt("look at @src/ap", 15)).toEqual({ query: "src/ap", start: 8, end: 15 });
		expect(fileMentionAt("mail me@example", 15)).toBeNull();
		expect(fileMentionAt("plain text", 5)).toBeNull();
		expect(slashMentionAt("run /re", 7)).toEqual({ query: "re", start: 4, end: 7 });
		expect(slashMentionAt("https://example", 15)).toBeNull();
	});

	it("SIDE-22 typing '/' offers the repository's saved commands and skills", async () => {
		const { test, repo } = await renderPage();
		try {
			const service = test.container.services.agentCatalog;
			service.store.setState({
				preWorkspaceSlashCommands: {
					[preWorkspaceSlashKey(repo.rootPath, "claude")]: {
						state: "ready",
						data: [
							{ name: "review", description: "Review", source: "project", kind: "command" },
							{ name: "skill-creator", description: "Create", source: "user", kind: "skill" },
						],
					},
				},
			});
			const input = (await screen.findByLabelText("First message")) as HTMLTextAreaElement;

			fireEvent.change(input, { target: { value: "/ski" } });

			const option = await screen.findByRole("option", { name: /\/skill-creator/ });
			expect(option.textContent).toContain("Skills");
			fireEvent.click(option);
			expect(input.value).toBe("/skill-creator ");
		} finally {
			test.close();
		}
	});
});
