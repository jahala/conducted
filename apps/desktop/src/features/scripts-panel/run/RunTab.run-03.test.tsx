/**
 * @feature RUN-03 One port per workspace, port detection and preview URLs
 * Owns: tests that the Run tab's Open menu lists the repository's preview URL entries, or the
 * run-output URL when none are set, that detected ports stay out of it, that Cmd+Shift+B opens the
 * first URL, that Open follows the in-app browser setting, and that a template entry that is not a
 * URL is named.
 * Test first: a template is labelled by its name, or by its expanded URL when the name is empty.
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
import type {
	PreviewUrlEntry,
	RepoConfigPatch,
	RunAction,
	Workspace,
} from "../../../core/model.ts";
import { createTestContainer, seedRepo, seedWorkspace } from "../../../test/container.ts";
import { renderWithRouter } from "../../../test/render-with-router.tsx";
import { WithSurfaces } from "../../../test/surfaces.tsx";
import { RunTab } from "./RunTab.tsx";

const dev: RunAction = {
	id: "dev-server",
	label: "Dev server",
	command: "bun dev",
	args: [],
	cwd: null,
	isDefault: true,
	hidden: false,
	icon: null,
	origin: "local",
	availableIn: ["local", "cloud"],
};

const config = (previewUrls: PreviewUrlEntry[]): RepoConfigPatch => ({
	runActions: [{ kind: "set", action: dev }],
	previewUrls,
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

async function setup(previewUrls: PreviewUrlEntry[] = []) {
	const test = createTestContainer();
	containers.push(test);
	const repo = await seedRepo(test.container);
	const workspace = await seedWorkspace(test.container, { repoId: repo.id, port: 55_000 });
	const updated = await test.container.services.repo.updateConfig(repo.id, config(previewUrls));
	if (!updated.ok) throw new Error(updated.error.message);
	const run: RunState = {
		actions: [dev],
		running: [
			{
				actionId: "dev-server",
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
	it("lists only the templates when they are set, and keeps detected ports out", async () => {
		const { test, workspace } = await setup([
			{ name: "App", url: "http://localhost:$PORT/app" },
			{ name: "", url: "https://example.test/preview" },
		]);

		renderTab(test, workspace);
		await screen.findByRole("button", { name: "Open" });

		fireEvent.keyDown(screen.getByRole("button", { name: "Choose preview URL" }), {
			key: "Enter",
		});

		expect(await screen.findByText("App")).toBeTruthy();
		expect(await screen.findByText("https://example.test/preview")).toBeTruthy();
		expect(screen.queryByText("Run output")).toBeNull();
		expect(screen.queryByText("Port 5173")).toBeNull();
		expect(screen.queryByText("http://localhost:3000")).toBeNull();
	});

	it("opens the first template URL with Open, and lists the others in the menu", async () => {
		const { test, workspace } = await setup([
			{ name: "First", url: "http://localhost:$PORT/first" },
			{ name: "Second", url: "http://localhost:$PORT/second" },
		]);
		const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");

		renderTab(test, workspace);
		fireEvent.click(await screen.findByRole("button", { name: "Open" }));

		expect(openUrl).toHaveBeenCalledWith("http://localhost:55000/first");

		fireEvent.keyDown(screen.getByRole("button", { name: "Choose preview URL" }), {
			key: "Enter",
		});

		expect(await screen.findByText("Second")).toBeTruthy();
	});

	it("opens the run output URL with Open when no template is set", async () => {
		const { test, workspace } = await setup();
		const openUrl = vi.spyOn(test.container.platform.opener, "openUrl");

		renderTab(test, workspace);
		const open = await screen.findByRole("button", { name: "Open" });
		expect(open.title).toBe("http://localhost:3000");
		fireEvent.click(open);

		expect(openUrl).toHaveBeenCalledWith("http://localhost:3000");
		expect(screen.queryByRole("button", { name: "Choose preview URL" })).toBeNull();
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
		const { test, workspace } = await setup([{ name: "Broken", url: "http://$HOST:$PORT/app" }]);

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
