/**
 * @feature NAV-16 Draft markers on the Create row and on workspaces
 * Owns: tests for the marker itself, the new-workspace draft behind the Create row, and the "Open draft"
 * button on a workspace row: a draft saved on disk shows it, an unreadable draft is read once and toasts
 * nothing from the sidebar, and 300 workspaces read only the drafts that exist.
 * Behaviour: ui-map.md 4.3, coverage/inventory-controls.md.
 * Test first: a draft of "   " with no attachments renders no marker; "fix the login" renders one.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateWorkspacePage } from "../../app/CreateWorkspacePage.tsx";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { draftFile } from "../../core/app-paths.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { Repo, Workspace } from "../../core/model.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { Toaster, toast } from "../../ui/Toast.tsx";
import { NEW_WORKSPACE_DRAFT_ID } from "../composer/draft-sources.ts";
import { DraftMarker } from "./DraftMarker.tsx";
import { SidebarNav } from "./SidebarNav.tsx";
import { WorkspaceRow } from "./WorkspaceRow.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

let open: TestContainer | null = null;

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	open?.close();
	open = null;
});

const must = <T,>(
	result: { ok: true; value: T } | { ok: false; error: { message: string } },
): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

describe("NAV-16 DraftMarker", () => {
	it("renders no Create-row marker for whitespace without attachments", () => {
		const { container } = render(
			<DraftMarker place="create-row" draft={{ text: "   ", attachmentPaths: [] }} />,
		);
		expect(container.firstChild).toBeNull();
		expect(screen.queryByRole("img", { name: "Draft" })).toBeNull();
	});

	it("renders the Create-row marker for a draft with text", () => {
		render(
			<DraftMarker place="create-row" draft={{ text: "fix the login", attachmentPaths: [] }} />,
		);
		expect(screen.getByRole("img", { name: "Draft" })).toBeTruthy();
	});

	it("renders the Create-row marker for attachments with no text", () => {
		render(
			<DraftMarker
				place="create-row"
				draft={{ text: "", attachmentPaths: ["/app/draft-attachments/s1/shot.png"] }}
			/>,
		);
		expect(screen.getByRole("img", { name: "Draft" })).toBeTruthy();
	});

	it("renders an Open draft button with the Draft tooltip and calls back on click", async () => {
		const onOpenDraft = vi.fn();
		render(
			<DraftMarker
				place="workspace-row"
				draft={{ text: "fix the login", attachmentPaths: [] }}
				onOpenDraft={onOpenDraft}
			/>,
		);
		const button = screen.getByRole("button", { name: "Open draft" });
		expect(button.getAttribute("data-testid")).toBe("workspace-draft-indicator");
		expect(button.getAttribute("title")).toBe("Draft");
		fireEvent.focus(button);
		const tooltip = await screen.findByRole("tooltip");
		expect(tooltip.textContent).toBe("Draft");
		fireEvent.click(button);
		expect(onOpenDraft).toHaveBeenCalledTimes(1);
	});

	it("renders no workspace-row button for an empty draft", () => {
		const { container } = render(
			<DraftMarker
				place="workspace-row"
				draft={{ text: "", attachmentPaths: [] }}
				onOpenDraft={vi.fn()}
			/>,
		);
		expect(container.firstChild).toBeNull();
	});
});

describe("NAV-16 Create row marker", () => {
	it("shows when the new-workspace draft has text, and hides for whitespace", async () => {
		open = createTestContainer();
		const test = open;
		must(await test.container.services.settings.start());
		const rootRoute = createRootRoute({ component: () => <SidebarNav /> });
		const router = createRouter({
			routeTree: rootRoute.addChildren([
				createRoute({ getParentRoute: () => rootRoute, path: "/", component: () => null }),
				createRoute({ getParentRoute: () => rootRoute, path: "/create", component: () => null }),
			]),
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		render(
			<ServicesProvider container={test.container}>
				<RouterProvider router={router} />
			</ServicesProvider>,
		);
		await screen.findByRole("link", { name: /Create/ });

		act(() => {
			test.container.services.composer.saveDraft(NEW_WORKSPACE_DRAFT_ID, {
				text: "fix the login",
				attachmentPaths: [],
			});
		});
		expect(await screen.findByRole("img", { name: "Draft" })).toBeTruthy();

		act(() => {
			test.container.services.composer.saveDraft(NEW_WORKSPACE_DRAFT_ID, {
				text: "   ",
				attachmentPaths: [],
			});
		});
		await waitFor(() => expect(screen.queryByRole("img", { name: "Draft" })).toBeNull());
	});

	it("keeps typing in the Create page as the draft the Create row marks", async () => {
		open = createTestContainer();
		const test = open;
		must(await test.container.services.settings.start());
		await seedRepo(test.container);
		const rootRoute = createRootRoute({
			component: () => (
				<>
					<SidebarNav />
					<Outlet />
				</>
			),
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([
				createRoute({
					getParentRoute: () => rootRoute,
					path: "/create",
					component: () => <CreateWorkspacePage />,
				}),
			]),
			history: createMemoryHistory({ initialEntries: ["/create"] }),
		});
		render(
			<AppProviders client={createQueryClient(() => {})}>
				<ServicesProvider container={test.container}>
					<RouterProvider router={router} />
				</ServicesProvider>
			</AppProviders>,
		);
		const input = await screen.findByLabelText("First message");
		fireEvent.change(input, { target: { value: "fix the login" } });

		expect(await screen.findByRole("img", { name: "Draft" })).toBeTruthy();
	});
});

describe("NAV-16 workspace row marker", () => {
	async function setup() {
		open = createTestContainer();
		const test = open;
		const repo = await seedRepo(test.container);
		const workspace = await seedWorkspace(test.container, { repoId: repo.id });
		const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
		must(await test.container.services.sessions.start());
		return { test, repo, workspace, session };
	}

	function renderRow(test: TestContainer, repo: Repo, workspace: Workspace | Workspace[]) {
		const rows = Array.isArray(workspace) ? workspace : [workspace];
		const rootRoute = createRootRoute();
		const indexRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/",
			component: () => (
				<>
					{rows.map((row) => (
						<WorkspaceRow
							key={row.id}
							workspace={row}
							repo={repo}
							selected={false}
							shortcutIndex={null}
							now={1_000}
						/>
					))}
					<Toaster />
				</>
			),
		});
		const workspaceRoute = createRoute({
			getParentRoute: () => rootRoute,
			path: "/repository/$repositoryId/workspace/$workspaceId",
			validateSearch: (search: Record<string, unknown>) => search,
			component: () => <p>workspace</p>,
		});
		const router = createRouter({
			routeTree: rootRoute.addChildren([indexRoute, workspaceRoute]),
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		render(
			<ServicesProvider container={test.container}>
				<RouterProvider router={router} />
			</ServicesProvider>,
		);
		return { router };
	}

	it("shows Open draft for a workspace with a draft and opens its chat", async () => {
		const { test, repo, workspace, session } = await setup();
		test.container.services.composer.saveDraft(session.id, {
			text: "fix the login",
			attachmentPaths: [],
		});
		const { router } = renderRow(test, repo, workspace);

		const button = await screen.findByRole("button", { name: "Open draft" });
		fireEvent.click(button);

		await waitFor(() =>
			expect(router.state.location.pathname).toBe(
				`/repository/${repo.id}/workspace/${workspace.id}`,
			),
		);
		expect(router.state.location.search).toMatchObject({
			tab: "session",
			sessionId: session.id,
		});
	});

	it("shows no marker for a workspace whose only draft is whitespace", async () => {
		const { test, repo, workspace, session } = await setup();
		test.container.services.composer.saveDraft(session.id, {
			text: "   ",
			attachmentPaths: [],
		});
		renderRow(test, repo, workspace);

		await screen.findByRole("link");
		expect(screen.queryByRole("button", { name: "Open draft" })).toBeNull();
	});

	/** Writes a chat's draft file as an earlier run of the app left it. */
	async function saveDraftFile(
		test: TestContainer,
		sessionId: SessionId,
		text: string,
	): Promise<string> {
		const path = draftFile(test.memory.platform.fs.paths, sessionId);
		must(await test.memory.platform.fs.mkdirp(path.slice(0, path.lastIndexOf("/"))));
		test.memory.controls.files.set(path, text);
		return path;
	}

	it("shows Open draft for a draft saved on disk in an earlier run", async () => {
		const { test, repo, workspace, session } = await setup();
		await saveDraftFile(
			test,
			session.id,
			JSON.stringify({ text: "fix the login", attachmentPaths: [] }),
		);

		renderRow(test, repo, workspace);

		expect(await screen.findByRole("button", { name: "Open draft" })).toBeTruthy();
	});

	it("reads an unreadable draft once and says nothing from the sidebar while other drafts change", async () => {
		const { test, repo, workspace, session } = await setup();
		const broken = await saveDraftFile(test, session.id, "{ not json");
		const readText = vi.spyOn(test.memory.platform.fs, "readText");
		renderRow(test, repo, workspace);
		await waitFor(() =>
			expect(readText.mock.calls.filter(([path]) => path === broken)).toHaveLength(1),
		);

		for (const text of ["f", "fi", "fix"]) {
			act(() => {
				test.container.services.composer.saveDraft(NEW_WORKSPACE_DRAFT_ID, {
					text,
					attachmentPaths: [],
				});
			});
		}
		await screen.findByRole("link");

		expect(readText.mock.calls.filter(([path]) => path === broken)).toHaveLength(1);
		expect(screen.queryByText("Couldn't load the draft")).toBeNull();
		expect(screen.queryByRole("button", { name: "Open draft" })).toBeNull();
	});

	it("reads only the drafts that exist for a sidebar of 300 workspaces", async () => {
		open = createTestContainer();
		const test = open;
		const repo = await seedRepo(test.container);
		const workspaces: Workspace[] = [];
		const sessions: SessionId[] = [];
		for (let index = 0; index < 300; index += 1) {
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				directoryName: `place-${index}`,
				branch: `place-${index}`,
			});
			workspaces.push(workspace);
			sessions.push(must(await test.container.services.sessions.create(workspace.id, CONFIG)).id);
		}
		must(await test.container.services.sessions.start());
		const withDrafts = [sessions[3], sessions[150], sessions[299]] as SessionId[];
		for (const sessionId of withDrafts) {
			await saveDraftFile(test, sessionId, JSON.stringify({ text: "unsent", attachmentPaths: [] }));
		}
		const readText = vi.spyOn(test.memory.platform.fs, "readText");
		const readDir = vi.spyOn(test.memory.platform.fs, "readDir");

		renderRow(test, repo, workspaces);

		await waitFor(() =>
			expect(screen.getAllByRole("button", { name: "Open draft" })).toHaveLength(3),
		);
		const draftsFolder = draftFile(test.memory.platform.fs.paths, "x").replace(/x\.json$/, "");
		const draftReads = readText.mock.calls.filter(([path]) => path.startsWith(draftsFolder));
		expect(draftReads.map(([path]) => path).sort()).toEqual(
			withDrafts.map((id) => draftFile(test.memory.platform.fs.paths, id)).sort(),
		);
		expect(
			readDir.mock.calls.filter(([path]) => path.startsWith(draftsFolder.replace(/\/$/, ""))),
		).toHaveLength(1);
	});
});
