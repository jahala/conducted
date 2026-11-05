/**
 * @feature NAV-10 Tab strip
 * Owns: tests of the tab strip over the real container: real chats become tabs, the real history button and
 * "New tab" menu are mounted, closing a chat removes its tab, and the tab shortcuts work when the key is
 * pressed into the root command dispatcher.
 * Behaviour: ui-map.md 3.2 (tab strip), 5.4 (next tab, close tab).
 * Test first: two open chats show two tabs, and clicking the second selects it.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import { TabStrip } from "./TabStrip.tsx";
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

afterEach(cleanup);

/** A workspace with two titled chats, the first one open in the URL, and the strip mounted under the dispatcher. */
async function mountStrip(test: ReturnType<typeof createTestContainer>) {
	const workspace = await seedWorkspace(test.container);
	const { sessions } = test.container.services;
	const alpha = must(await sessions.create(workspace.id, CONFIG));
	const beta = must(await sessions.create(workspace.id, CONFIG));
	must(await sessions.start());
	must(await test.container.actions.sessions.rename(alpha.id, "Alpha chat"));
	must(await test.container.actions.sessions.rename(beta.id, "Beta chat"));

	const onSearchChange = vi.fn<(patch: Partial<WorkspaceSearch>) => void>();
	const search: WorkspaceSearch = { tab: "session", sessionId: alpha.id };
	const rootRoute = createRootRoute();
	const route = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => (
			<CommandDispatcher>
				<TabStrip
					workspaceId={workspace.id as WorkspaceId}
					search={search}
					onSearchChange={onSearchChange}
				/>
			</CommandDispatcher>
		),
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([route]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	render(
		<ServicesProvider container={test.container}>
			<RouterProvider router={router} />
		</ServicesProvider>,
	);
	await router.load();
	return { alpha, beta, onSearchChange, workspaceId: workspace.id };
}

const sessionTarget = (id: SessionId) => ({ tab: "session", sessionId: id });

describe("NAV-10 tab strip over the real container", () => {
	it("shows a tab for each open chat and selects the one the user clicks", async () => {
		const test = createTestContainer();
		try {
			const { beta, onSearchChange } = await mountStrip(test);

			expect(await screen.findByRole("tab", { name: "Alpha chat" })).toBeTruthy();
			expect(screen.getByRole("tab", { name: "Alpha chat" }).getAttribute("aria-selected")).toBe(
				"true",
			);
			expect(screen.getByRole("tab", { name: "Beta chat" }).getAttribute("aria-selected")).toBe(
				"false",
			);

			fireEvent.click(screen.getByRole("tab", { name: "Beta chat" }));

			expect(onSearchChange).toHaveBeenCalledWith(sessionTarget(beta.id));
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("mounts the real chat history button and the New tab menu", async () => {
		const test = createTestContainer();
		try {
			await mountStrip(test);

			expect(await screen.findByRole("button", { name: "View chat history" })).toBeTruthy();
			expect(screen.getByRole("button", { name: "New tab" })).toBeTruthy();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("removes the tab of a closed chat and opens the other one", async () => {
		const test = createTestContainer();
		try {
			const { beta, onSearchChange } = await mountStrip(test);

			fireEvent.click(await screen.findByRole("button", { name: "Close Alpha chat" }));

			await waitFor(() => expect(screen.queryByRole("tab", { name: "Alpha chat" })).toBeNull());
			expect(onSearchChange).toHaveBeenCalledWith(sessionTarget(beta.id));
			expect(screen.getByRole("tab", { name: "Beta chat" })).toBeTruthy();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("goes to the next tab when Cmd+Alt+Right is pressed into the root dispatcher", async () => {
		const test = createTestContainer();
		try {
			const { beta, onSearchChange } = await mountStrip(test);
			await screen.findByRole("tab", { name: "Beta chat" });

			fireEvent.keyDown(document.body, { key: "ArrowRight", metaKey: true, altKey: true });

			await waitFor(() => expect(onSearchChange).toHaveBeenCalledWith(sessionTarget(beta.id)));
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});

	it("closes the open chat when Cmd+W is pressed into the root dispatcher", async () => {
		const test = createTestContainer();
		try {
			await mountStrip(test);
			await screen.findByRole("tab", { name: "Alpha chat" });

			fireEvent.keyDown(document.body, { key: "w", metaKey: true });

			await waitFor(() => expect(screen.queryByRole("tab", { name: "Alpha chat" })).toBeNull());
			expect(screen.getByRole("tab", { name: "Beta chat" })).toBeTruthy();
		} finally {
			cleanup();
			await test.container.stop();
			test.close();
		}
	});
});
