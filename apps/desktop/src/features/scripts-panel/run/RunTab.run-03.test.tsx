/**
 * @feature RUN-03 One port per workspace, port detection and preview URLs
 * Owns: tests that the Run tab's Open menu is built from the run output, the detected ports and
 * the repository template, that Cmd+Shift+B opens the first localhost URL, that Open follows the
 * in-app browser setting, and that a template entry that is not a URL is named.
 * Test first: the menu lists the run output, a detected port and the expanded template.
 */
import type { TerminalId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
	useSearch,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher, createCommandRegistry } from "../../../app/command-dispatcher.ts";
import type { RunState } from "../../../core/api.ts";
import { ServicesProvider } from "../../../core/context.tsx";
import type { RepoConfig, RunAction, Workspace } from "../../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
import { renderWithRouter } from "../../../test/render-with-router.tsx";
import { WithSurfaces } from "../../../test/surfaces.tsx";
import { RunTab } from "./RunTab.tsx";

const dev: RunAction = {
	id: "dev",
	label: "Dev server",
	command: "bun dev",
	args: [],
	cwd: null,
	isDefault: true,
	hidden: false,
	icon: null,
	origin: "local",
};

const config = (previewUrlTemplate: string | null): RepoConfig => ({
	setupScript: null,
	runScripts: [dev],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrlTemplate,
	spotlightTesting: false,
	autoRunAfterSetup: false,
	remoteName: "origin",
	prompts: {
		general: null,
		codeReview: null,
		createPr: null,
		fixErrors: null,
		resolveConflicts: null,
		renameBranch: null,
	},
});

/** Stands in for the workspace screen: it prints the tab and browser URL it was opened with. */
function BrowserTab() {
	const search = useSearch({ strict: false }) as { tab?: string; browserUrl?: string };
	return <p>{`${search.tab ?? ""} ${search.browserUrl ?? ""}`}</p>;
}

const containers: ReturnType<typeof createTestContainer>[] = [];

afterEach(() => {
	cleanup();
	globalThis.localStorage.clear();
	for (const test of containers.splice(0)) test.close();
});

async function setup(previewUrlTemplate: string | null = null) {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id, port: 55_000 });
	const updated = await test.container.services.repo.updateConfig(
		repo.id,
		config(previewUrlTemplate),
	);
	if (!updated.ok) throw new Error(updated.error.message);
	const run: RunState = {
		actions: [dev],
		running: [
			{
				actionId: "dev",
				terminalId: "t1" as TerminalId,
				url: "http://localhost:3000",
				phase: "running",
			},
		],
		spotlight: { active: false, terminalId: null },
		detectedPorts: [{ port: 5173, pid: 2, processName: "vite", appName: null }],
	};
	test.container.services.runScripts.store.setState((state) => ({
		...state,
		byWorkspace: { ...state.byWorkspace, [workspace.id]: run },
		phases: { ...state.phases, [workspace.id]: "running" },
	}));
	return { test, workspace };
}

function renderTab(test: ReturnType<typeof createTestContainer>, workspace: Workspace): void {
	renderWithRouter(
		<ServicesProvider container={test.container}>
			<CommandDispatcher registry={createCommandRegistry()}>
				<WithSurfaces>
					<RunTab workspaceId={workspace.id} />
				</WithSurfaces>
			</CommandDispatcher>
		</ServicesProvider>,
	);
}

describe("RUN-03 run tab preview URLs", () => {
	it("lists the run output, the detected ports and the expanded template", async () => {
		const { test, workspace } = await setup("http://localhost:$PORT/app");

		renderTab(test, workspace);
		await screen.findByRole("button", { name: "Open" });

		fireEvent.keyDown(screen.getByRole("button", { name: "Choose preview URL" }), {
			key: "Enter",
		});

		expect(await screen.findByText("Run output")).toBeTruthy();
		expect(await screen.findByText("Port 5173")).toBeTruthy();
		expect(await screen.findByText("Preview URL")).toBeTruthy();
	});

	it("opens the run output URL with Open", async () => {
		const { test, workspace } = await setup();
		const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");

		renderTab(test, workspace);
		fireEvent.click(await screen.findByRole("button", { name: "Open" }));

		expect(openUrl).toHaveBeenCalledWith("http://localhost:3000");
	});

	it("opens the localhost URL from Cmd+Shift+B", async () => {
		const { test, workspace } = await setup();
		const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");

		renderTab(test, workspace);
		await screen.findByRole("button", { name: "Open" });

		act(() => {
			document.dispatchEvent(
				new KeyboardEvent("keydown", {
					key: "b",
					metaKey: true,
					shiftKey: true,
					bubbles: true,
					cancelable: true,
				}),
			);
		});

		expect(openUrl).toHaveBeenCalledWith("http://localhost:3000");
	});

	it("names a template entry that is not a valid URL instead of dropping it silently", async () => {
		const { test, workspace } = await setup("http://$HOST:$PORT/app");

		renderTab(test, workspace);
		await screen.findByRole("button", { name: "Open" });

		expect(await screen.findByText("Unknown variable $HOST in the preview URL.")).toBeTruthy();
	});

	it("opens the in-app browser tab when the in-app browser setting is on", async () => {
		const { test, workspace } = await setup();
		const setting = await test.container.services.settings.set(
			"experimental_in_app_browser_preview",
			true,
		);
		if (!setting.ok) throw new Error(setting.error.message);
		const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");

		const rootRoute = createRootRoute();
		const tabRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: () => (
				<ServicesProvider container={test.container}>
					<CommandDispatcher registry={createCommandRegistry()}>
						<WithSurfaces>
							<RunTab workspaceId={workspace.id} />
						</WithSurfaces>
					</CommandDispatcher>
				</ServicesProvider>
			),
		});
		const workspaceRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/repository/$repositoryId/workspace/$workspaceId",
			component: BrowserTab,
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([tabRoute, workspaceRoute]),
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		render(<RouterProvider router={router} />);

		fireEvent.click(await screen.findByRole("button", { name: "Open" }));

		expect(await screen.findByText("browser http://localhost:3000")).toBeTruthy();
		expect(router.state.location.pathname).toBe(
			`/repository/${workspace.repoId}/workspace/${workspace.id}`,
		);
		expect(openUrl).not.toHaveBeenCalled();
	});
});
