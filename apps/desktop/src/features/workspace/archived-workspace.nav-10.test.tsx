/**
 * @feature NAV-10 An archived workspace's tabs
 * Owns: tests, over the real container, that an archived workspace keeps its chats readable with the
 * archived bar for a composer, and that its file tabs show the archived notice.
 * Behaviour: ui-map.md 3.3 ("This workspace is archived." with "Unarchive"), 3.2 ("Workspace archived").
 * Conductor draws session tabs as usual and the notice only on file, terminal and browser tabs
 * (renderApp @10062129).
 * Test first: an archived workspace's chat tab shows the chat with the archived bar and no composer.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { VirtuosoMockContext } from "react-virtuoso";
import { afterEach, describe, expect, it } from "vitest";
import { clearCommandHandlers, useCommandDispatcher } from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import type { Container } from "../../core/container.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";
import { TabContent } from "./TabContent.tsx";
import type { WorkspaceSearch } from "./workspace-search.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

function Dispatcher({ children }: { children: ReactNode }) {
	useCommandDispatcher();
	return <>{children}</>;
}

let test: TestContainer | undefined;

afterEach(async () => {
	cleanup();
	clearCommandHandlers();
	if (test !== undefined) {
		await test.container.stop();
		test.close();
		test = undefined;
	}
});

function archive(container: Container, id: WorkspaceId): void {
	container.services.workspace.store.setState((state) => {
		const row = state.workspacesById[id];
		if (row === undefined) return state;
		return {
			workspacesById: {
				...state.workspacesById,
				[id]: { ...row, state: "archived", archivedAt: 10 },
			},
		};
	});
}

async function mount(container: Container, workspaceId: WorkspaceId, search: WorkspaceSearch) {
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<TabContent workspaceId={workspaceId} search={search} onSearchChange={() => {}} />
		),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<VirtuosoMockContext.Provider value={{ viewportHeight: 800, itemHeight: 200 }}>
					<Dispatcher>
						<RouterProvider router={router} />
					</Dispatcher>
				</VirtuosoMockContext.Provider>
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
}

describe("NAV-10 an archived workspace's tabs", () => {
	it("keeps the chat readable and puts the archived bar where the composer was", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const chat = must(await test.container.services.sessions.create(workspace.id, CONFIG));
		archive(test.container, workspace.id);

		await mount(test.container, workspace.id, { tab: "session", sessionId: chat.id });

		expect(await screen.findByText("This workspace is archived.")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Unarchive" })).toBeTruthy();
		expect(screen.queryByText("Workspace archived")).toBeNull();
		expect(screen.queryByRole("button", { name: /send/i })).toBeNull();
	});

	it("shows the composer again for a ready workspace", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		const chat = must(await test.container.services.sessions.create(workspace.id, CONFIG));

		await mount(test.container, workspace.id, { tab: "session", sessionId: chat.id });

		await waitFor(() => expect(document.querySelector("[data-region='composer']")).not.toBeNull());
		expect(screen.queryByText("This workspace is archived.")).toBeNull();
	});

	it("shows the archived notice on a file tab", async () => {
		test = createTestContainer();
		const workspace = await seedWorkspace(test.container);
		archive(test.container, workspace.id);

		await mount(test.container, workspace.id, { tab: "file", path: "src/a.ts" });

		expect(await screen.findByText("Workspace archived")).toBeTruthy();
		expect(
			screen.getByText("Unarchive this workspace to view files, terminals, and browser previews."),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Unarchive" })).toBeTruthy();
	});
});
