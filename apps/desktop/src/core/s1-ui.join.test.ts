/**
 * @feature s1-ui Join the batch's features through the composition root
 * Owns: one test per feature in the batch: APP-08 start-up screens and notices, COMP-07 attachments,
 * REV-08 the file viewer, SET-04 environment variables and SET-09 provider keys. Each test builds the
 * real container with createTestContainer, then mounts the app's own route tree or the screen the app
 * mounts, and drives the feature the way a user does.
 * Behaviour: D054 (a feature is reachable from the composition root).
 * Test first: each test fails when its feature's container wiring or mount is removed.
 */
import { EditorView } from "@codemirror/view";
import type { AgentInstall, SessionConfig } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { CommandDispatcher } from "../app/command-dispatcher.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { useOverlayStore } from "../app/overlay-store.ts";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { AppProviders, createQueryClient } from "../app/providers.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { createAppRouter } from "../app/router.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real composer the app mounts
import { Composer } from "../features/composer/Composer.tsx";
import type { StartedApp } from "../main.tsx";
import { startApp } from "../main.tsx";
import { createTestContainer, seedWorkspace } from "../test/container.ts";
import type { Container } from "./container.ts";
import { ServicesProvider } from "./context.tsx";
import { providerKeychainRef } from "./services/agent-catalog.ts";

const h = createElement;

type LooseComponent = (props: { children?: ReactNode } & Record<string, unknown>) => ReactNode;

const Services = ServicesProvider as unknown as LooseComponent;
const App = AppProviders as unknown as LooseComponent;
const Dispatcher = CommandDispatcher as unknown as LooseComponent;

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

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

function renderInside(container: Container, node: ReactNode) {
	const client = createQueryClient(() => {});
	return render(h(Services, { container }, h(App, { client }, node)));
}

/** Mounts the app's own route tree at `path`, as main.tsx does. */
async function openApp(container: Container, path: string) {
	const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
	renderInside(container, h(RouterProvider, { router }));
	await router.load();
	return router;
}

afterEach(() => {
	cleanup();
	useOverlayStore.getState().close();
	vi.restoreAllMocks();
	window.localStorage.clear();
});

describe("s1-ui join", () => {
	it("APP-08 warns in the sidebar footer when macOS is too old and remembers the dismissal", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			await test.container.services.repo.start();
			test.memory.controls.setSystemInfo({
				osVersion: "13.6.1",
				machineArch: "arm64",
				buildArch: "arm64",
			});

			await openApp(test.container, "/all-workspaces");

			expect(await screen.findByText("macOS 13.6.1 is too old")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Dismiss macOS version warning" }));
			await waitFor(() => expect(screen.queryByText("macOS 13.6.1 is too old")).toBeNull());
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("APP-08 blocks the real app entry on a database from a newer version", async () => {
		const test = createTestContainer();
		const root = document.createElement("div");
		document.body.appendChild(root);
		try {
			vi.spyOn(test.memory.platform.app, "dbVersionWarning").mockResolvedValue(
				ok({ databaseVersion: 12, appVersion: 11 }),
			);
			let app!: StartedApp;
			act(() => {
				app = startApp({
					root,
					platform: test.memory.platform,
					installHandlers: false,
				});
			});
			await app.started;

			expect(
				await screen.findByRole("heading", { name: "Database from a newer version" }),
			).toBeTruthy();

			vi.spyOn(app.container.services.runScripts, "stopAll").mockResolvedValue(ok(undefined));
			vi.spyOn(app.container.sidecar, "stop").mockImplementation(() => {});
			await app.container.stop();
			app.unmount();
		} finally {
			root.remove();
			test.close();
		}
	});

	it("COMP-07 adds a picked file to the composer's draft through the attachment action", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container, { path: "/join/comp-07" });
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			test.container.services.sessions.store.setState((state) => ({
				...state,
				viewingSessionId: session.id,
			}));
			test.memory.controls.files.set("/tmp/one.txt", "one");
			test.memory.controls.queueDialogAnswers({ files: ["/tmp/one.txt"] });

			render(
				h(
					Services,
					{ container: test.container },
					h(Dispatcher, {}, h(Composer, { workspaceId: workspace.id, sessionId: session.id })),
				),
			);
			await waitFor(() => expect(screen.getByLabelText("composer")).toBeTruthy());

			fireEvent.keyDown(document, { key: "u", metaKey: true });

			const list = await screen.findByRole("list", { name: "Attachments" });
			expect(list.textContent).toContain("one.txt");
			await waitFor(() =>
				expect(test.container.services.composer.draftOf(session.id).attachmentPaths).toHaveLength(
					1,
				),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("REV-08 opens a workspace file from the file action and shows its Markdown preview", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container, { path: "/join/rev-08" });
			await test.container.platform.fs.writeTextAtomic(
				`${workspace.path}/notes.md`,
				"# Joined preview",
			);
			vi.spyOn(test.container.services.fileDiff, "load").mockResolvedValue(
				ok({
					path: "notes.md",
					oldText: "",
					newText: "# Joined preview",
					patch: "",
					binary: false,
					tooLarge: false,
				}),
			);

			const router = await openApp(
				test.container,
				`/repository/${workspace.repoId}/workspace/${workspace.id}`,
			);
			const opened = await test.container.actions.files.open(workspace.id, "notes.md", "diff", {
				kind: "branch",
			});
			expect(opened.ok).toBe(true);

			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({
					tab: "file",
					path: "notes.md",
				}),
			);
			fireEvent.click(await screen.findByRole("button", { name: "Preview" }));

			expect(await screen.findByRole("heading", { name: "Joined preview" })).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("REV-08 keeps unsaved edits when the user opens another file and comes back", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container, { path: "/join/rev-08-draft" });
			await test.container.platform.fs.writeTextAtomic(`${workspace.path}/notes.md`, "draft me");
			await test.container.platform.fs.writeTextAtomic(`${workspace.path}/other.md`, "other");
			vi.spyOn(test.container.services.fileDiff, "load").mockResolvedValue(
				ok({
					path: "other.md",
					oldText: "",
					newText: "other",
					patch: "",
					binary: false,
					tooLarge: false,
				}),
			);
			const router = await openApp(
				test.container,
				`/repository/${workspace.repoId}/workspace/${workspace.id}`,
			);
			const files = test.container.actions.files;
			const branch = { kind: "branch" } as const;

			must(await files.open(workspace.id, "notes.md", "edit", branch));
			await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBeNull());
			const editor = document.querySelector<HTMLElement>(".cm-editor");
			const view = editor === null ? null : EditorView.findFromDOM(editor);
			if (view === null) throw new Error("No editor is mounted.");
			act(() => {
				view.dispatch({ changes: { from: view.state.doc.length, insert: " with edits" } });
			});

			must(await files.open(workspace.id, "other.md", "diff", branch));
			await waitFor(() =>
				expect(router.state.location.search).toMatchObject({ tab: "file", path: "other.md" }),
			);
			await waitFor(() => expect(document.querySelector(".cm-editor")).toBeNull());

			must(await files.open(workspace.id, "notes.md", "edit", branch));
			await waitFor(() =>
				expect(document.querySelector(".cm-content")?.textContent).toBe("draft me with edits"),
			);
			expect(screen.getByRole("status", { name: "Unsaved edits" })).toBeTruthy();
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("SET-04 saves an environment variable from the Environment page into the Keychain", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			await test.container.services.repo.start();

			await openApp(test.container, "/settings/environment");
			expect(await screen.findByRole("heading", { name: "Environment" })).toBeTruthy();

			fireEvent.change(screen.getByLabelText("Name"), { target: { value: "JOIN_TOKEN" } });
			fireEvent.change(screen.getByLabelText("Value"), {
				target: { value: "s3cret-value" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Add variable" }));

			expect(await screen.findByText("JOIN_TOKEN")).toBeTruthy();
			await waitFor(async () => {
				expect(await test.memory.platform.keychain.get("env:global:JOIN_TOKEN")).toEqual({
					ok: true,
					value: "s3cret-value",
				});
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("SET-09 saves an Anthropic API key from the Agents page's Providers dialog", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			await test.container.services.repo.start();
			const install: AgentInstall = { agent: "claude", installed: true, authenticated: false };
			test.container.services.agentCatalog.setInstalls([install]);
			vi.spyOn(test.container.actions.agents, "refresh").mockResolvedValue(ok(undefined));

			await openApp(test.container, "/settings/agents");

			fireEvent.click(await screen.findByRole("button", { name: "Providers" }));
			expect(await screen.findByRole("heading", { name: "Providers" })).toBeTruthy();

			fireEvent.change(screen.getByLabelText("Anthropic API key"), {
				target: { value: "sk-ant-join" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save key" }));

			const ref = providerKeychainRef({
				agent: "claude",
				acpAgent: null,
				provider: "anthropic",
				envVar: "ANTHROPIC_API_KEY",
			});
			await waitFor(async () => {
				expect(await test.memory.platform.keychain.get(ref)).toEqual({
					ok: true,
					value: "sk-ant-join",
				});
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
