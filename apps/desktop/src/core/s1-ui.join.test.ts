/**
 * @feature s1-ui Join the batch's features through the composition root
 * Owns: one test per feature in the batch: APP-08 start-up screens and notices, COMP-07 attachments,
 * REV-08 the file viewer, REV-10 the Artifacts tab, SET-04 environment variables, SET-09 provider keys
 * and SET-10 OpenCode providers, plus the launch a chat sends: the variables the repository scripts
 * get, only the chosen sign-in's keys, and one value for an OpenCode variable two providers share.
 * Also joins APP-06 the update notice and the restart when the last chat is idle, PR-10 linking a
 * pull request by URL or number, and RUN-05 page annotations sent to the chat.
 * Each test builds the real container with createTestContainer, then mounts the app's own route
 * tree or the screen the app mounts, and drives the feature the way a user does.
 * Behaviour: D054 (a feature is reachable from the composition root).
 * Test first: each test fails when its feature's container wiring or mount is removed.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { EditorView } from "@codemirror/view";
import {
	type AgentInstall,
	type AgentLaunch,
	type AgentProvider,
	idleLiveState,
	type SessionConfig,
} from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../test/container.ts";
import { answerSidecar, deliveredAsAsked } from "../test/sidecar-answers.ts";
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

interface SentLaunch {
	method: string;
	id: number;
	params: { launch?: AgentLaunch };
}

/** Answers every sendMessage at once and keeps the last one the container sent to the sidecar. */
function captureSends(test: TestContainer): { last(): SentLaunch | null } {
	const transport = test.memory.platform.sidecar;
	const originalSend = transport.send.bind(transport);
	let sent: SentLaunch | null = null;
	transport.send = async (line) => {
		const answered = await originalSend(line);
		const parsed = JSON.parse(line) as SentLaunch;
		if (parsed.method === "sendMessage") {
			sent = parsed;
			queueMicrotask(() =>
				test.memory.controls.emitSidecarLine(
					JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: { deliveredAs: "new_turn" } }),
				),
			);
		}
		return answered;
	};
	return { last: () => sent };
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
			expect(screen.getByRole("status", { name: "Unsaved changes" })).toBeTruthy();
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

			fireEvent.click(screen.getByRole("button", { name: "Add environment variable" }));
			fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "JOIN_TOKEN" } });
			fireEvent.change(screen.getByLabelText("Value"), {
				target: { value: "s3cret-value" },
			});
			fireEvent.click(screen.getByRole("button", { name: /^Save/ }));

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
			fireEvent.keyDown(screen.getByRole("combobox", { name: "Provider" }), { key: "Enter" });
			fireEvent.keyDown(await screen.findByRole("option", { name: "Anthropic API key" }), {
				key: "Enter",
			});

			fireEvent.change(await screen.findByLabelText("Anthropic API key"), {
				target: { value: "sk-ant-join" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save Anthropic API key" }));

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
	it("SET-04 gives an agent's launch the repository scripts' variables, and the same error", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container, { path: "/join/set-04" });
			const settings = test.container.services.settings;
			must(await settings.setEnvVar("SHARED", "from-global", "global"));
			must(await settings.setEnvVar("ONLY_GLOBAL", "global-only", "global"));
			must(await settings.setEnvVar("SHARED", "from-repo", { repoId: workspace.repoId }));
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			must(await test.container.services.sessions.send(session.id, "hello", [], "auto"));

			const forScripts = must(await settings.environmentFor(workspace.repoId));
			expect(forScripts).toEqual({ ONLY_GLOBAL: "global-only", SHARED: "from-repo" });
			expect(sends.last()?.params.launch?.env).toMatchObject(forScripts);

			must(await test.memory.platform.keychain.delete("env:global:ONLY_GLOBAL"));
			const scriptsFailure = await settings.environmentFor(workspace.repoId);
			const launchFailure = await test.container.services.sessions.send(
				session.id,
				"again",
				[],
				"auto",
			);
			expect(scriptsFailure.ok).toBe(false);
			expect(launchFailure.ok).toBe(false);
			if (scriptsFailure.ok || launchFailure.ok) return;
			expect(launchFailure.error.code).toBe(scriptsFailure.error.code);
			expect(launchFailure.error.message).toBe(scriptsFailure.error.message);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("SET-09 launches Claude with only the chosen sign-in, and a key from this Mac as a marker", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container, { path: "/join/set-09" });
			const keys = test.container.actions.agents;
			const claude = { agent: "claude" as const, acpAgent: null, provider: "anthropic" };
			must(
				await keys.setProviderKey(
					{ ...claude, envVar: "CLAUDE_CODE_OAUTH_TOKEN" },
					{ kind: "entered", value: "oauth-token" },
				),
			);
			must(
				await keys.setProviderKey({ ...claude, envVar: "ANTHROPIC_API_KEY" }, { kind: "this_mac" }),
			);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));

			must(await test.container.services.sessions.send(session.id, "subscription", [], "auto"));
			expect(sends.last()?.params.launch?.providerKeys).toEqual({
				CLAUDE_CODE_OAUTH_TOKEN: { value: "oauth-token", source: "entered" },
			});

			must(await test.container.services.settings.set("claude_provider", "anthropic"));
			must(await test.container.services.sessions.send(session.id, "api key", [], "auto"));
			expect(sends.last()?.params.launch?.providerKeys).toEqual({
				ANTHROPIC_API_KEY: { value: "", source: "this_mac" },
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});

describe("s1-ui join REV-10 and SET-10", () => {
	it("REV-10 lists the workspace's .context artifacts in the git panel and attaches one", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container, { path: "/join/rev-10" });
			test.memory.controls.files.set("/join/rev-10/.context/notes.md", "notes");
			test.memory.controls.files.set("/join/picked/artifact.txt", "picked");
			test.memory.controls.queueDialogAnswers({ files: ["/join/picked/artifact.txt"] });
			test.memory.controls.scriptShell((command) => {
				if (command.program !== "cp") return null;
				const [, source, target] = command.args;
				const contents = source === undefined ? undefined : test.memory.controls.files.get(source);
				if (contents === undefined || target === undefined) {
					return ok({ exitCode: 1, stdout: "", stderr: "missing source" });
				}
				test.memory.controls.files.set(target, contents);
				return ok({ exitCode: 0, stdout: "", stderr: "" });
			});
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.workspace.setActiveSession(workspace.id, session.id));

			await openApp(test.container, `/repository/${workspace.repoId}/workspace/${workspace.id}`);

			fireEvent.mouseDown(await screen.findByRole("tab", { name: "Artifacts" }), {
				button: 0,
			});

			expect(await screen.findByText("notes.md")).toBeTruthy();
			fireEvent.click(screen.getByRole("button", { name: "Upload files" }));

			const uploaded = await screen.findByText("artifact.txt");
			const card = uploaded.closest("li");
			if (card === null) throw new Error("the uploaded artifact has no card");
			fireEvent.click(within(card).getByRole("button", { name: "Attach to chat" }));

			await waitFor(() =>
				expect(test.container.services.composer.draftOf(session.id).attachmentPaths).toEqual([
					"/join/rev-10/.context/artifact.txt",
				]),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("SET-10 lists the OpenCode providers, saves a key, filters models, and sends the key", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			await test.container.services.settings.start();
			await test.container.services.repo.start();
			const workspace = await seedWorkspace(test.container, { path: "/join/set-10" });
			const install: AgentInstall = {
				agent: "acp",
				acpAgent: "opencode",
				installed: true,
			};
			test.container.services.agentCatalog.setInstalls([install]);
			vi.spyOn(test.container.actions.agents, "refresh").mockResolvedValue(ok(undefined));

			await openApp(test.container, "/settings/agents");
			fireEvent.click(await screen.findByRole("button", { name: "Providers" }));

			await waitFor(() =>
				expect(
					test.memory.controls.sidecarSent.some((line) => line.includes('"listAgentProviders"')),
				).toBe(true),
			);
			const request = test.memory.controls.sidecarSent
				.flatMap((line) => {
					try {
						return [JSON.parse(line) as { id?: number; method?: string }];
					} catch {
						return [];
					}
				})
				.find((sent) => sent.method === "listAgentProviders");
			if (request?.id === undefined) throw new Error("no listAgentProviders request");
			const providers: AgentProvider[] = [
				{ id: "deepseek", label: "DeepSeek", keyEnvVars: ["DEEPSEEK_API_KEY"] },
				{
					id: "custom",
					label: "Custom provider",
					keyEnvVars: ["OPENAI_API_KEY", "OPENCODE_WORKSPACE_ID"],
				},
			];
			test.memory.controls.emitSidecarLine(
				JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { providers } }),
			);

			// The answer reaches the store a few microtasks later, so wait for the catalogue to show.
			fireEvent.keyDown(await screen.findByRole("combobox", { name: "Provider" }), {
				key: "Enter",
			});
			fireEvent.keyDown(await screen.findByRole("option", { name: "DeepSeek" }), {
				key: "Enter",
			});

			fireEvent.change(await screen.findByLabelText("DeepSeek"), {
				target: { value: "sk-deepseek-join" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save DeepSeek key" }));

			const key = {
				agent: "acp" as const,
				acpAgent: "opencode" as const,
				provider: "deepseek",
				envVar: "DEEPSEEK_API_KEY",
			};
			await waitFor(async () => {
				expect(await test.memory.platform.keychain.get(providerKeychainRef(key))).toEqual({
					ok: true,
					value: "sk-deepseek-join",
				});
			});

			fireEvent.change(screen.getByLabelText("Filter models"), {
				target: { value: "deepseek/deepseek-chat" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Save filter" }));
			await waitFor(() =>
				expect(test.container.services.settings.get("visible_provider_models")).toBe(
					"deepseek/deepseek-chat",
				),
			);

			const session = must(
				await test.container.services.sessions.create(workspace.id, {
					...CONFIG,
					agent: "acp",
					acpAgent: "opencode",
					model: "deepseek/deepseek-chat",
				}),
			);
			must(await test.container.services.sessions.send(session.id, "hello", [], "auto"));
			expect(sends.last()?.params.launch?.providerKeys).toEqual({
				DEEPSEEK_API_KEY: { value: "sk-deepseek-join", source: "entered" },
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("SET-10 launches OpenCode with the newest key of a variable two providers share", async () => {
		const test = createTestContainer();
		try {
			const sends = captureSends(test);
			must(await test.container.sidecar.start());
			await test.container.services.settings.start();
			const workspace = await seedWorkspace(test.container, { path: "/join/set-10-shared" });
			const shared = {
				agent: "acp" as const,
				acpAgent: "opencode" as const,
				envVar: "ZHIPU_API_KEY",
			};
			const keys = test.container.actions.agents;
			must(
				await keys.setProviderKey(
					{ ...shared, provider: "zhipuai" },
					{ kind: "entered", value: "older" },
				),
			);
			must(
				await keys.setProviderKey(
					{ ...shared, provider: "zai" },
					{ kind: "entered", value: "newer" },
				),
			);
			const session = must(
				await test.container.services.sessions.create(workspace.id, {
					...CONFIG,
					agent: "acp",
					acpAgent: "opencode",
					model: "zai/glm-4.6",
				}),
			);

			must(await test.container.services.sessions.send(session.id, "hello", [], "auto"));
			expect(sends.last()?.params.launch?.providerKeys).toEqual({
				ZHIPU_API_KEY: { value: "newer", source: "entered" },
			});

			must(await keys.removeProviderKey({ ...shared, provider: "zhipuai" }));
			must(await test.container.services.sessions.send(session.id, "again", [], "auto"));
			expect(sends.last()?.params.launch?.providerKeys).toEqual({});
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});

const WORKING_LIVE_STATE = { ...idleLiveState, status: "working" as const };

/** A local page for the preview frame to load with a scriptable document. */
function servePreviewPage(): Promise<{ server: Server; url: string }> {
	return new Promise((resolve, reject) => {
		const server = createServer((_request, response) => response.end("<p>preview</p>"));
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address() as AddressInfo;
			resolve({ server, url: `http://127.0.0.1:${address.port}` });
		});
	});
}

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve) => {
		if (!server.listening) {
			resolve();
			return;
		}
		server.close(() => resolve());
	});
}

describe("s1-ui join APP-06 update notice", () => {
	it("shows the idle restart in the sidebar and restarts once the last working chat goes idle", async () => {
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			must(await test.container.services.settings.set("auto_restart_on_update_when_idle", true));
			vi.spyOn(test.container.platform.updater, "check").mockResolvedValue(
				ok({ version: "9.9.9", notes: "Faster diffs." }),
			);
			vi.spyOn(test.container.platform.updater, "install").mockResolvedValue(ok(undefined));
			const relaunch = vi
				.spyOn(test.container.platform.updater, "relaunch")
				.mockResolvedValue(undefined);

			must(await test.container.start());
			await openApp(test.container, "/all-workspaces");
			must(await test.container.actions.app.checkForUpdates());
			test.container.services.sessions.store.setState({
				liveStates: { "chat-1": WORKING_LIVE_STATE },
			});
			must(await test.container.actions.app.installUpdate());

			expect(test.container.services.updates.store.getState().state).toBe("ready_when_idle");
			expect(relaunch).not.toHaveBeenCalled();
			expect(
				await screen.findByText("Will automatically restart when all agents are idle"),
			).toBeTruthy();

			test.container.services.sessions.store.setState({ liveStates: {} });

			await waitFor(() => expect(relaunch).toHaveBeenCalledTimes(1));
			await waitFor(() =>
				expect(
					screen.queryByText("Will automatically restart when all agents are idle"),
				).toBeNull(),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});

describe("s1-ui join PR-10 link a pull request", () => {
	it("links a pull request from the workspace screen through the pr.link command", async () => {
		const remoteUrl = "https://github.com/octo/repo.git";
		const prJson = JSON.stringify({
			number: 123,
			title: "Link me",
			html_url: "https://github.com/octo/repo/pull/123",
			state: "open",
			draft: false,
			merged_at: null,
			updated_at: "2026-11-05T09:00:00Z",
			body: "The pull request body",
			user: { login: "ada", avatar_url: "https://avatars.example/ada.png" },
			head: { ref: "feature/link" },
		});
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			must(
				await test.container.services.settings.set(
					"keybinding_overrides_v1",
					JSON.stringify({ "pr.link": ["Cmd+Shift+9"] }),
				),
			);
			const repo = await seedRepo(test.container, {
				rootPath: "/join/pr-10",
				remoteUrl,
			});
			must(await test.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/workspaces/join-pr-10",
				branch: "feature/link",
			});
			test.memory.controls.scriptShell((command) => {
				if (command.program === "git" && command.args.includes("get-url")) {
					return ok({ exitCode: 0, stdout: `${remoteUrl}\n`, stderr: "" });
				}
				if (
					command.program === "gh" &&
					command.args[0] === "api" &&
					command.args[1]?.endsWith("/pulls/123") === true
				) {
					return ok({ exitCode: 0, stdout: prJson, stderr: "" });
				}
				return ok({ exitCode: 0, stdout: "", stderr: "" });
			});

			await openApp(test.container, `/repository/${repo.id}/workspace/${workspace.id}`);
			fireEvent.keyDown(document, { key: "9", metaKey: true, shiftKey: true });

			fireEvent.change(await screen.findByLabelText("PR URL or number"), {
				target: { value: "https://github.com/octo/repo/pull/123" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Link" }));

			await waitFor(() => {
				const stored =
					test.container.services.workspace.store.getState().workspacesById[workspace.id];
				expect(stored?.prNumber).toBe(123);
				expect(stored?.prTitle).toBe("Link me");
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});

describe("s1-ui join PR-10 link from the workspace actions menu", () => {
	it("opens the Link pull request dialog with no keybinding", async () => {
		const remoteUrl = "https://github.com/octo/repo.git";
		const prJson = JSON.stringify({
			number: 123,
			title: "Link me",
			html_url: "https://github.com/octo/repo/pull/123",
			state: "open",
			draft: false,
			merged_at: null,
			updated_at: "2026-11-05T09:00:00Z",
			body: "The pull request body",
			user: { login: "ada", avatar_url: "https://avatars.example/ada.png" },
			head: { ref: "feature/link" },
		});
		const test = createTestContainer();
		try {
			await test.container.services.settings.start();
			const repo = await seedRepo(test.container, {
				rootPath: "/join/pr-10-menu",
				remoteUrl,
			});
			must(await test.container.services.repo.loadConfig(repo.id));
			const workspace = await seedWorkspace(test.container, {
				repoId: repo.id,
				path: "/code/workspaces/join-pr-10-menu",
				branch: "feature/link",
				branchIsPlaceholder: false,
			});
			test.memory.controls.scriptShell((command) => {
				if (command.program === "git" && command.args.includes("get-url")) {
					return ok({ exitCode: 0, stdout: `${remoteUrl}\n`, stderr: "" });
				}
				if (
					command.program === "gh" &&
					command.args[0] === "api" &&
					command.args[1]?.endsWith("/pulls/123") === true
				) {
					return ok({ exitCode: 0, stdout: prJson, stderr: "" });
				}
				return ok({ exitCode: 0, stdout: "", stderr: "" });
			});

			await openApp(test.container, `/repository/${repo.id}/workspace/${workspace.id}`);

			// The Workspace actions menu is the sidebar row's right-click menu, as in Conductor (D098).
			const row = await screen.findByRole("link", { name: /feature\/link/i });
			fireEvent.contextMenu(row);
			fireEvent.click(await screen.findByRole("menuitem", { name: "Link pull request" }));

			fireEvent.change(await screen.findByLabelText("PR URL or number"), {
				target: { value: "123" },
			});
			fireEvent.click(screen.getByRole("button", { name: "Link" }));

			await waitFor(() => {
				const stored =
					test.container.services.workspace.store.getState().workspacesById[workspace.id];
				expect(stored?.prNumber).toBe(123);
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});

describe("s1-ui join RUN-05 page annotations", () => {
	it("sends annotations made in the workspace's browser tab to its chat", async () => {
		const test = createTestContainer();
		const preview = await servePreviewPage();
		try {
			await test.container.services.settings.start();
			must(await test.container.services.settings.set("experimental_in_app_browser_preview", true));
			const workspace = await seedWorkspace(test.container, {
				path: "/code/workspaces/join-run-05",
				port: 5173,
			});
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.start());
			must(await test.container.services.workspace.setActiveSession(workspace.id, session.id));
			must(await test.container.sidecar.start());
			const calls = answerSidecar(test, deliveredAsAsked);

			await openApp(
				test.container,
				`/repository/${workspace.repoId}/workspace/${workspace.id}?tab=browser&browserUrl=${encodeURIComponent(preview.url)}`,
			);

			const frame = (await screen.findByTitle("Preview")) as HTMLIFrameElement;
			frame.removeAttribute("src");
			const page = frame.contentDocument;
			if (page === null) throw new Error("the preview is not scriptable");
			page.body.innerHTML = '<button id="first">First</button><button id="second">Second</button>';
			fireEvent.load(frame);

			fireEvent.click(await screen.findByRole("button", { name: "Annotate" }));
			const first = page.querySelector("#first");
			if (first === null) throw new Error("the preview has no first button");
			fireEvent.click(first);
			fireEvent.change(screen.getByLabelText("Note"), { target: { value: "First note" } });
			fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));
			await screen.findByText("First note");

			const second = page.querySelector("#second");
			if (second === null) throw new Error("the preview has no second button");
			fireEvent.click(second);
			fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Second note" } });
			fireEvent.click(screen.getByRole("button", { name: "Save annotation" }));
			await screen.findByText("Second note");

			fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

			await waitFor(() =>
				expect(calls.filter((call) => call.method === "sendMessage")).toHaveLength(1),
			);
			const message = String(
				calls.find((call) => call.method === "sendMessage")?.params.text ?? "",
			);
			expect(message).toContain("First note");
			expect(message).toContain("Second note");
			expect(message.indexOf("First note")).toBeLessThan(message.indexOf("Second note"));
		} finally {
			await test.container.stop();
			test.close();
			await closeServer(preview.server);
		}
	});
});
