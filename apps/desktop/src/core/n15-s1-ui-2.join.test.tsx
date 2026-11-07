/**
 * @feature n15-s1-ui-2 Join the batch's features through the composition root
 * Owns: one test per feature of the batch: COMP-10 the Codex goal bar, NAV-06 the Kanban dashboard,
 * PR-07 opening the pull request (Cmd+Shift+G and "Open pull requests in"), NAV-09 the Keyboard
 * shortcuts dialog, NAV-12 zen mode, NAV-13 the place name map, NAV-16 a workspace's draft marker
 * and PRJ-05 the repository icon. Each test builds the real container with createTestContainer,
 * mounts the app's own route tree as main.tsx does, and drives the feature the way a user does.
 * Behaviour: D054 (a feature is reachable from the composition root), D058 (the joining node).
 * Test first: each test fails when its feature's container wiring or mount is removed.
 */
import type { CodexGoal, SessionConfig } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the app's own route tree as main.tsx does
import { useOverlayStore } from "../app/overlay-store.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the app's own route tree as main.tsx does
import { AppProviders, createQueryClient } from "../app/providers.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the app's own route tree as main.tsx does
import { createAppRouter } from "../app/router.tsx";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";
import { answerSidecar, deliveredAsAsked } from "../test/sidecar-answers.ts";
import type { Container } from "./container.ts";
import { ServicesProvider } from "./context.tsx";
import type { PullRequest } from "./model.ts";

const h = createElement;
type LooseComponent = (props: { children?: ReactNode } & Record<string, unknown>) => ReactNode;
const Services = ServicesProvider as unknown as LooseComponent;
const App = AppProviders as unknown as LooseComponent;

const CODEX: SessionConfig = {
	agent: "codex",
	model: "gpt-5",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

const must = <T,>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

/** Mounts the app's own route tree at `path`, as main.tsx does. */
async function openApp(container: Container, path: string) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	render(
		h(
			Services,
			{ container },
			h(App, { client: createQueryClient(() => {}) }, h(RouterProvider, { router })),
		),
	);
	await router.load();
	return router;
}

let opened: TestContainer | null = null;

async function start(): Promise<TestContainer> {
	const test = createTestContainer();
	opened = test;
	must(await test.container.services.settings.start());
	return test;
}

const workspacePath = (workspace: { repoId: string; id: string }) =>
	`/repository/${workspace.repoId}/workspace/${workspace.id}`;

afterEach(async () => {
	cleanup();
	useOverlayStore.getState().close();
	vi.restoreAllMocks();
	if (opened === null) return;
	await opened.container.stop();
	opened.close();
	opened = null;
});

describe("n15-s1-ui-2 join", () => {
	it("COMP-10 shows a Codex chat's reported goal above its composer and pauses it", async () => {
		const test = await start();
		const workspace = await seedWorkspace(test.container);
		const session = must(await test.container.services.sessions.create(workspace.id, CODEX));
		must(await test.container.services.workspace.setActiveSession(workspace.id, session.id));
		must(await test.container.sidecar.start());
		const calls = answerSidecar(test, deliveredAsAsked);
		await openApp(test.container, workspacePath(workspace));
		await screen.findByRole("textbox", { name: "composer" });

		const goal: CodexGoal = { objective: "Ship the importer", status: "active" };
		act(() => {
			test.memory.controls.emitSidecarLine(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "goalChanged",
					params: { sessionId: session.id, goal },
				}),
			);
		});
		expect(await screen.findByText("Pursuing goal")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Pause goal" }));

		await waitFor(() =>
			expect(
				calls.filter((call) => call.method === "sendMessage").map((call) => call.params.text),
			).toEqual(["/goal pause"]),
		);
	});

	it("NAV-06 opens the dashboard from the sidebar and moves a card from its status menu", async () => {
		const test = await start();
		must(await test.container.services.settings.set("dashboard_enabled", true));
		const workspace = await seedWorkspace(test.container, {
			branch: "oslo",
			branchIsPlaceholder: false,
		});
		const router = await openApp(test.container, "/all-workspaces");

		fireEvent.click(await screen.findByRole("link", { name: /Dashboard/ }));
		await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
		const inProgress = await screen.findByRole("region", { name: "In progress" });
		// A workspace is named in words, as Conductor names it.
		expect(await within(inProgress).findByText("Oslo")).toBeTruthy();
		fireEvent.keyDown(within(inProgress).getByRole("button", { name: "Status: In progress" }), {
			key: "Enter",
		});
		fireEvent.click(await screen.findByRole("menuitemradio", { name: "Done" }));

		expect(
			await within(screen.getByRole("region", { name: "Done" })).findByText("Oslo"),
		).toBeTruthy();
		await waitFor(() =>
			expect(
				test.container.services.workspace.store.getState().workspacesById[workspace.id]
					?.kanbanStatus,
			).toBe("done"),
		);
	});

	it("PR-07 opens the workspace's pull request with Cmd+Shift+G where the setting says", async () => {
		const test = await start();
		must(await test.container.services.settings.set("pull_request_open_target", "linear"));
		const workspace = await seedWorkspace(test.container);
		const pullRequest: PullRequest = {
			number: 12,
			url: "https://github.com/me/project/pull/12",
			title: "A change",
			body: "",
			state: "open",
			mergeable: "mergeable",
			reviewDecision: null,
			checks: [],
			inMergeQueue: false,
			autoMergeEnabled: false,
			baseBranch: "main",
			authorLogin: "octocat",
			viewerDidAuthor: false,
			viewerCanMerge: true,
			mergeMethod: "squash",
			reviewers: [],
			deployments: [],
			updatedAt: 0,
		};
		// The git state the git service reads on a real Mac; the shell here answers nothing.
		test.container.services.git.store.setState({
			byWorkspace: {
				[workspace.id]: {
					snapshot: {
						depth: "full",
						branch: workspace.branch,
						mergeBase: "abc123",
						mergeBaseError: null,
						files: [],
						conflictedPaths: [],
						untrackedTruncated: false,
						uncommittedFiles: 0,
						changedFiles: 1,
						operation: "none",
						commits: [],
						sync: { ahead: 1, behind: 0, rewritten: false, hasUpstream: true },
						behindTarget: 0,
					},
					error: null,
					refreshedAt: 1,
				},
			},
		});
		test.container.services.github.store.setState({
			byWorkspace: { [workspace.id]: { pullRequest, unavailable: "none", fetchedAt: 1 } },
		});
		const openUrl = vi
			.spyOn(test.container.actions.app, "openUrl")
			.mockResolvedValue(ok(undefined));
		await openApp(test.container, workspacePath(workspace));
		await screen.findByRole("complementary", { name: "Changes and scripts" });

		fireEvent.keyDown(document.body, { key: "g", metaKey: true, shiftKey: true });

		await waitFor(() =>
			expect(openUrl).toHaveBeenCalledWith("https://linear.review/me/project/pull/12"),
		);
	});

	it("NAV-09 opens the Keyboard shortcuts dialog with Cmd+Alt+/", async () => {
		const test = await start();
		await openApp(test.container, "/all-workspaces");

		fireEvent.keyDown(document.body, { key: "/", metaKey: true, altKey: true });

		expect(await screen.findByRole("dialog", { name: "Keyboard shortcuts" })).toBeTruthy();
	});

	it("NAV-12 hides both panels of a workspace with Cmd+. and brings them back", async () => {
		const test = await start();
		const workspace = await seedWorkspace(test.container);
		await openApp(test.container, workspacePath(workspace));
		const right = await screen.findByRole("complementary", { name: "Changes and scripts" });

		fireEvent.keyDown(document, { key: ".", metaKey: true });
		await waitFor(() => expect(right.getAttribute("data-right-panel-open")).toBe("false"));
		fireEvent.keyDown(document, { key: ".", metaKey: true });
		await waitFor(() => expect(right.getAttribute("data-right-panel-open")).toBe("true"));
	});

	it("NAV-13 opens the place name map from the command palette and plots a workspace", async () => {
		const test = await start();
		const repo = await seedRepo(test.container);
		await seedWorkspace(test.container, { repoId: repo.id, directoryName: "lisbon" });
		await openApp(test.container, "/all-workspaces");

		fireEvent.keyDown(document.body, { key: "k", metaKey: true });
		const palette = await screen.findByRole("dialog");
		fireEvent.change(within(palette).getByRole("combobox"), { target: { value: "Passport" } });
		fireEvent.click(await within(palette).findByRole("option", { name: /Passport/ }));

		const places = await screen.findByRole("list", { name: "Places" });
		expect(within(places).getByText("Lisbon")).toBeTruthy();
	});

	it("NAV-16 marks a workspace whose chat has a draft in the sidebar", async () => {
		const test = await start();
		const workspace = await seedWorkspace(test.container, { branch: "oslo" });
		const session = must(await test.container.services.sessions.create(workspace.id, CODEX));
		must(await test.container.services.sessions.start());
		test.container.services.composer.saveDraft(session.id, {
			text: "fix the login",
			attachmentPaths: [],
		});
		const router = await openApp(test.container, "/all-workspaces");
		// With no workspace open, Conductor's project groups start closed: open the workspace's.
		const create = await screen.findByRole("link", { name: /^Create workspace in / });
		const group = create.closest("[role=region], section") as HTMLElement;
		fireEvent.click(within(group).getByRole("button", { expanded: false }));

		fireEvent.click(await screen.findByRole("button", { name: "Open draft" }));

		await waitFor(() => expect(router.state.location.pathname).toBe(workspacePath(workspace)));
		expect(router.state.location.search).toMatchObject({ sessionId: session.id });
	});

	// The sidebar follows Conductor: inside a project group the row leaves its avatar to the group's
	// header, so the chosen icon shows there, beside the workspace header's own avatar.
	it("PRJ-05 shows the repository's chosen icon in the sidebar group and the workspace header", async () => {
		const test = await start();
		const repo = await seedRepo(test.container, { name: "conducted", icon: "emoji:🦊" });
		const workspace = await seedWorkspace(test.container, { repoId: repo.id });
		await openApp(test.container, workspacePath(workspace));

		await waitFor(() =>
			expect(screen.getByRole("img", { name: "conducted icon" }).textContent).toBe("🦊"),
		);
		const group = await screen.findByRole("region", { name: "conducted" });
		expect(within(group).getByText("🦊")).toBeTruthy();
	});
});
