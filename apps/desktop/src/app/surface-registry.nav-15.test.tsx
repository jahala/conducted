/**
 * @feature NAV-15 Terminals and previews that survive tab switches
 * Owns: tests over the real container and the real app router that a terminal tab draws its terminal
 * through the shell's surface layer: the terminal stays mounted with its shell across tab switches,
 * takes focus when its tab is shown again, and is unmounted once its tab leaves the strip.
 * Behaviour: ui-map.md 1.1 (a surface layer mounted once at the root keeps terminals alive over
 * anchors), 8; services-map.md 1.5 (surface layout registry).
 * Test first: switching from a terminal tab to a chat and back keeps the same terminal element
 * mounted, hidden in between.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId, TerminalId, WorkspaceId } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServicesProvider } from "../core/context.tsx";
import type { RunAction, Workspace } from "../core/model.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";
import { toast } from "../ui/Toast.tsx";
import { AppProviders, createQueryClient } from "./providers.tsx";
import { createAppRouter } from "./router.tsx";

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

/** Where jsdom puts every anchor, since it has no layout. */
const ANCHOR_BOX = { x: 300, y: 80, width: 640, height: 400 };

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

let open: TestContainer | null = null;

afterEach(async () => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	if (open !== null) {
		await open.container.stop();
		open.close();
		open = null;
	}
});

/**
 * jsdom has no layout, so every box is empty and an anchor would never get a slot. Anchors get one
 * fixed box; every other element keeps jsdom's own answer.
 */
function giveAnchorsABox(): void {
	const measure = Element.prototype.getBoundingClientRect;
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
		if (!this.hasAttribute("data-surface-anchor")) return measure.call(this);
		const { x, y, width, height } = ANCHOR_BOX;
		return {
			x,
			y,
			width,
			height,
			left: x,
			top: y,
			right: x + width,
			bottom: y + height,
			toJSON: () => ANCHOR_BOX,
		} as DOMRect;
	});
}

interface OpenedApp {
	test: TestContainer;
	workspace: Workspace;
	terminalId: TerminalId;
	spawns: ReturnType<typeof vi.spyOn>;
}

/** A ready workspace with one chat and one running terminal, opened on the terminal tab. */
async function openTerminalTab(): Promise<OpenedApp> {
	const test = createTestContainer();
	open = test;
	const { container } = test;
	const seeded = await seedWorkspace(container);
	await container.platform.fs.mkdirp(seeded.path);
	await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [seeded.id]);
	must(await container.services.workspace.start());
	const workspace = container.services.workspace.store.getState().workspacesById[seeded.id];
	if (workspace === undefined) throw new Error("The seeded workspace did not load.");
	must(await container.services.settings.start());
	const chat = must(await container.services.sessions.create(workspace.id, CONFIG));
	must(await container.services.sessions.start());
	must(await container.actions.sessions.rename(chat.id as SessionId, "Alpha chat"));
	const spawns = vi.spyOn(container.platform.pty, "spawn");
	const terminal = must(await container.services.terminals.create(workspace.id as WorkspaceId));
	giveAnchorsABox();

	const router = createAppRouter(
		createMemoryHistory({
			initialEntries: [
				`/repository/${workspace.repoId}/workspace/${workspace.id}?tab=terminal&terminalId=${terminal.id}`,
			],
		}),
	);
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return { test, workspace, terminalId: terminal.id, spawns };
}

/** The terminal's view in the shell's surface layer. The Scripts panel draws its own view as well. */
function terminalElement(terminalId: TerminalId): HTMLElement | null {
	return document.querySelector<HTMLElement>(
		`[data-surface-layer] [data-terminal-view="${terminalId}"]`,
	);
}

/** A tab of the centre's strip, not the Scripts panel's tab with the same name. */
function centreTab(name: string): HTMLElement {
	return within(screen.getByRole("tablist", { name: "Workspace tabs" })).getByRole("tab", { name });
}

/** The surface host that draws a terminal: the element the layer shows, hides and focuses. */
function surfaceOf(terminalId: TerminalId): HTMLElement {
	const host = terminalElement(terminalId)?.closest<HTMLElement>("[data-surface-id]");
	if (host === null || host === undefined) {
		throw new Error(`Terminal ${terminalId} is not drawn in a surface.`);
	}
	return host;
}

describe("NAV-15 terminal tabs draw through the shell's surface layer", () => {
	it("keeps the terminal and its shell mounted across a tab switch and focuses it on return", async () => {
		const { terminalId, spawns } = await openTerminalTab();

		await waitFor(() => expect(terminalElement(terminalId)).not.toBeNull());
		const first = terminalElement(terminalId);
		expect(screen.getByRole("main").contains(first)).toBe(false);
		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("true"));
		await waitFor(() => expect(surfaceOf(terminalId).contains(document.activeElement)).toBe(true));

		await waitFor(() => expect(centreTab("Alpha chat")).toBeTruthy());
		fireEvent.click(centreTab("Alpha chat"));

		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("false"));
		expect(terminalElement(terminalId)).toBe(first);
		expect(surfaceOf(terminalId).hidden).toBe(true);

		fireEvent.click(centreTab("Terminal 1"));

		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("true"));
		expect(terminalElement(terminalId)).toBe(first);
		await waitFor(() => expect(surfaceOf(terminalId).contains(document.activeElement)).toBe(true));
		// One shell for the whole time: the switch neither killed nor restarted it.
		expect(spawns).toHaveBeenCalledTimes(1);
	});

	it("unmounts the terminal once its tab leaves the strip", async () => {
		const { test, workspace, terminalId } = await openTerminalTab();
		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("true"));
		await waitFor(() => expect(centreTab("Alpha chat")).toBeTruthy());
		fireEvent.click(centreTab("Alpha chat"));
		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("false"));

		// Closed while hidden: the close removes its row, and the strip reloads from the database.
		must(await test.container.actions.terminals.close(terminalId));
		await act(async () => {
			must(await test.container.services.terminals.loadWorkspace(workspace.id as WorkspaceId));
		});

		const strip = screen.getByRole("tablist", { name: "Workspace tabs" });
		await waitFor(() =>
			expect(within(strip).queryByRole("tab", { name: "Terminal 1" })).toBeNull(),
		);
		expect(terminalElement(terminalId)).toBeNull();
		expect(document.querySelector("[data-surface-id]")).toBeNull();
	});

	it("closing the terminal tab removes the tab and unmounts its terminal", async () => {
		const { test, terminalId } = await openTerminalTab();
		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("true"));
		const strip = screen.getByRole("tablist", { name: "Workspace tabs" });

		fireEvent.click(within(strip).getByRole("button", { name: "Close Terminal 1" }));

		await waitFor(() =>
			expect(within(strip).queryByRole("tab", { name: "Terminal 1" })).toBeNull(),
		);
		expect(terminalElement(terminalId)).toBeNull();
		expect(document.querySelector("[data-surface-id]")).toBeNull();
		// The closed terminal has no panel tab either: the panel lists only its own terminals (#482).
		expect(document.querySelector(`[data-terminal-tab="${terminalId}"]`)).toBeNull();
		const rows = await test.database.select<{ id: string }>(
			"SELECT id FROM terminals WHERE id = $1",
			[terminalId],
		);
		expect(rows).toEqual([]);
	});

	it("unmounts the terminal when its workspace is archived", async () => {
		const { test, workspace, terminalId } = await openTerminalTab();
		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("true"));

		await test.database.execute(
			"UPDATE workspaces SET state = 'archived', archived_at = 1 WHERE id = $1",
			[workspace.id],
		);
		await act(async () => {
			must(await test.container.services.workspace.start());
		});

		await waitFor(() => expect(terminalElement(terminalId)).toBeNull());
		expect(document.querySelector("[data-surface-id]")).toBeNull();
	});
});

const DEV_ACTION: RunAction = {
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

/** Two ready workspaces of one repository with a "Dev server" action, opened on the first. */
async function openRunWorkspace() {
	const test = createTestContainer();
	open = test;
	const { container } = test;
	const repo = await seedRepo(container);
	const first = await seedWorkspace(container, { repoId: repo.id });
	const second = await seedWorkspace(container, { repoId: repo.id });
	for (const seeded of [first, second]) {
		await container.platform.fs.mkdirp(seeded.path);
		await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [seeded.id]);
	}
	must(await container.services.workspace.start());
	must(await container.services.settings.start());
	must(await container.services.repo.updateConfig(repo.id, { runScripts: [DEV_ACTION] }));
	const realSpawn = container.platform.pty.spawn.bind(container.platform.pty);
	// seam: NAV-15 the memory PTY ends a script at once; a dev server keeps running until stopped.
	const spawns = vi
		.spyOn(container.platform.pty, "spawn")
		.mockImplementation(({ command: _script, ...shell }) => realSpawn(shell));
	giveAnchorsABox();

	const router = createAppRouter(
		createMemoryHistory({
			initialEntries: [`/repository/${repo.id}/workspace/${first.id}`],
		}),
	);
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<RouterProvider router={router} />
			</AppProviders>
		</ServicesProvider>,
	);
	await router.load();
	return { test, router, repoId: repo.id, first, second, spawns };
}

describe("NAV-15 the Run tab's terminal draws through the shell's surface layer", () => {
	it("keeps the running action's terminal mounted while another workspace is open", async () => {
		const { test, router, repoId, first, second, spawns } = await openRunWorkspace();
		await screen.findByRole("button", { name: "Run Dev server" });

		must(await test.container.actions.run.start(first.id as WorkspaceId, "dev-server"));
		const running = test.container.services.runScripts.store.getState().byWorkspace[first.id];
		const terminalId = running?.running[0]?.terminalId;
		if (terminalId === undefined) throw new Error("The action did not start.");
		await waitFor(() => expect(terminalElement(terminalId)).not.toBeNull());
		const shown = terminalElement(terminalId);
		expect(screen.getByRole("main").contains(shown)).toBe(false);
		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("true"));

		await act(async () => {
			await router.navigate({
				to: "/repository/$repositoryId/workspace/$workspaceId",
				params: { repositoryId: repoId, workspaceId: second.id },
			});
		});
		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("false"));
		expect(terminalElement(terminalId)).toBe(shown);

		await act(async () => {
			await router.navigate({
				to: "/repository/$repositoryId/workspace/$workspaceId",
				params: { repositoryId: repoId, workspaceId: first.id },
			});
		});
		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("true"));
		expect(terminalElement(terminalId)).toBe(shown);
		expect(spawns).toHaveBeenCalledTimes(1);
	});

	it("shows the stopped action's output again after a workspace switch", async () => {
		const { test, router, repoId, first, second } = await openRunWorkspace();
		await screen.findByRole("button", { name: "Run Dev server" });
		must(await test.container.actions.run.start(first.id as WorkspaceId, "dev-server"));
		const running = test.container.services.runScripts.store.getState().byWorkspace[first.id];
		const terminalId = running?.running[0]?.terminalId;
		if (terminalId === undefined) throw new Error("The action did not start.");
		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("true"));
		const shown = terminalElement(terminalId);
		must(await test.container.actions.run.stop(first.id as WorkspaceId, "dev-server"));
		await waitFor(() =>
			expect(test.container.services.runScripts.store.getState().phases[first.id]).toBe("stopped"),
		);

		for (const workspaceId of [second.id, first.id]) {
			await act(async () => {
				await router.navigate({
					to: "/repository/$repositoryId/workspace/$workspaceId",
					params: { repositoryId: repoId, workspaceId },
				});
			});
		}

		await waitFor(() => expect(surfaceOf(terminalId).dataset.surfaceVisible).toBe("true"));
		expect(terminalElement(terminalId)).toBe(shown);
		expect(screen.queryByText("Run output appears here.")).toBeNull();
	});
});
