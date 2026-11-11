/**
 * @feature s1-ui-3 Join the batch's features through the composition root
 * Owns: one test per feature in the batch: REV-11 conflict resolution, RUN-04 browser preview,
 * RUN-09 zsh shell integration, SET-05 MCP servers, SET-08 config sync, SET-11 environment
 * suggestions, and SET-12 config editors and the Claude in Chrome switch. Each test builds the
 * real container with createTestContainer and drives the real service, screen or route the app
 * mounts.
 * Behaviour: D054 (a feature is reachable from the composition root).
 * Test first: each test fails when its feature's container wiring or mount is removed.
 */
import type { AgentInstall, SessionConfig } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement as h, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { FileDiffPane } from "../features/file-viewer/FileDiffPane.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { McpServersPanel } from "../features/settings/agents/McpServersSection.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { AgentsPage } from "../features/settings/pages/AgentsPage.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { EnvironmentPage } from "../features/settings/pages/EnvironmentPage.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { GeneralPage } from "../features/settings/pages/GeneralPage.tsx";
// biome-ignore lint/style/noRestrictedImports: the join test mounts the real screens and the app route exactly as the app does
import { TabContent } from "../features/workspace/TabContent.tsx";
import { createTestContainer, seedWorkspace, type TestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { zshIntegrationDir } from "./services/shell-integration.ts";
import { zshIntegrationFiles } from "./services/terminals.ts";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

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

const preferences = {
	layout: "unified" as const,
	hideWhitespaceChanges: false,
	wrapLines: true,
	ligatures: true,
};

const conflict = (current: string, incoming: string): string =>
	`<<<<<<< HEAD\n${current}\n=======\n${incoming}\n>>>>>>> feature\n`;

type LooseComponent = (props: { children?: ReactNode } & Record<string, unknown>) => ReactNode;
const Services = ServicesProvider as unknown as LooseComponent;

const open: TestContainer[] = [];

function testContainer(): TestContainer {
	const test = createTestContainer();
	open.push(test);
	return test;
}

function renderInside(test: TestContainer, node: ReactNode): void {
	render(h(Services, { container: test.container }, node));
}

afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	for (const test of open.splice(0)) {
		await test.container.stop();
		test.close();
	}
});

describe("s1-ui-3 join REV-11 conflict resolution", () => {
	it("resolves a conflict from the file diff pane and stages the file", async () => {
		const test = testContainer();
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const workspace = await seedWorkspace(test.container, {
			path: "/code/workspaces/join-conflicts",
		});
		const text = conflict("ours", "theirs");
		const absolute = `${workspace.path}/a.ts`;
		test.memory.controls.files.set(absolute, text);
		vi.spyOn(test.container.services.fileDiff, "load").mockResolvedValue(
			ok({
				path: "a.ts",
				oldText: "before",
				newText: text,
				patch: "",
				binary: false,
				tooLarge: false,
			}),
		);
		const gitCalls: string[] = [];
		test.memory.controls.scriptShell((command) => {
			if (command.program !== "git") return null;
			gitCalls.push(command.args.join(" "));
			return ok({ stdout: "", stderr: "", exitCode: 0 });
		});

		render(
			h(
				QueryClientProvider,
				{ client },
				h(
					Services,
					{ container: test.container },
					h(FileDiffPane, {
						workspaceId: workspace.id,
						path: "a.ts",
						scope: { kind: "uncommitted" },
						preferences,
					}),
				),
			),
		);

		fireEvent.click(await screen.findByRole("button", { name: "Accept current change" }));
		fireEvent.click(screen.getByRole("button", { name: "Save resolution" }));

		await waitFor(() => expect(test.memory.controls.files.get(absolute)).toBe("ours\n"));
		expect(gitCalls.some((call) => call.includes("add"))).toBe(true);
		client.clear();
	});
});

describe("s1-ui-3 join RUN-04 browser preview", () => {
	it("shows the designed preview-off state from the workspace tab and opens the page outside", async () => {
		const test = testContainer();
		const workspace = await seedWorkspace(test.container);
		const opened: string[] = [];
		vi.spyOn(test.memory.platform.opener, "openUrl").mockImplementation(async (url) => {
			opened.push(url);
		});

		renderInside(
			test,
			h(TabContent, {
				workspaceId: workspace.id,
				search: {},
				onSearchChange: () => {},
				tab: { kind: "browser", url: "http://localhost:5173/" },
			}),
		);

		expect(await screen.findByText("In-app browser preview is off.")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Open preview in browser" }));

		await waitFor(() => expect(opened).toEqual(["http://localhost:5173/"]));
	});
});

describe("s1-ui-3 join RUN-09 zsh shell integration", () => {
	it("writes the shim and starts an interactive terminal with ZDOTDIR pointing at it", async () => {
		const test = testContainer();
		const workspace = await seedWorkspace(test.container);
		await test.container.platform.fs.mkdirp(workspace.path);
		await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
			workspace.id,
		]);
		const terminals = test.container.services.terminals;

		must(await test.container.start());

		const dir = zshIntegrationDir(test.container.platform.fs.paths);
		const files = zshIntegrationFiles();
		expect(await test.container.platform.fs.readText(`${dir}/.zshrc`)).toEqual(ok(files[".zshrc"]));

		must(await terminals.create(workspace.id));

		const spawn = test.memory.controls.ptySpawns.at(-1);
		expect(spawn?.env).toMatchObject({ ZDOTDIR: dir });
		expect(spawn?.env).not.toHaveProperty("CONDUCTED_USER_ZDOTDIR");
	});
});

describe("s1-ui-3 join SET-05 MCP servers", () => {
	it("loads the open chat's servers and shows a failed server's log", async () => {
		const test = testContainer();
		const workspace = await seedWorkspace(test.container);
		const created = must(await test.container.services.sessions.create(workspace.id, CONFIG));
		test.container.services.sessions.setViewing(created.id);
		vi.spyOn(test.container.sidecar, "request").mockResolvedValue({
			ok: true,
			value: {
				servers: [
					{
						name: "github",
						status: "failed",
						scope: "project",
						error: "permission denied",
					},
				],
			},
		});

		renderInside(test, h(McpServersPanel));

		expect(await screen.findByText("permission denied")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "View log" }));

		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("github")).toBeTruthy();
		const log = within(dialog).getByRole("list", { name: "MCP server log" });
		expect(within(log).getByText("permission denied")).toBeTruthy();
	});
});

describe("s1-ui-3 join SET-08 config sync", () => {
	it("previews and copies a slash command from the General settings row", async () => {
		const test = testContainer();
		await test.container.services.settings.start();
		const home = test.container.platform.fs.paths.home;
		test.memory.controls.addFolder(`${home}/.claude/commands`);
		test.memory.controls.files.set(`${home}/.claude/commands/review.md`, "Review the changes\n");

		renderInside(test, h(GeneralPage));

		fireEvent.click(screen.getByRole("button", { name: "Sync" }));
		const dialog = within(await screen.findByRole("dialog"));
		expect(await dialog.findByText("review")).toBeTruthy();
		expect(dialog.getByText("Add")).toBeTruthy();

		fireEvent.click(dialog.getByRole("button", { name: "Sync" }));

		expect(await dialog.findByText("Copied 1 entry.")).toBeTruthy();
		expect(await test.container.platform.fs.readText(`${home}/.codex/prompts/review.md`)).toEqual(
			ok("Review the changes\n"),
		);
	});
});

describe("s1-ui-3 join SET-11 documented variable names", () => {
	it("offers the unset proxy names in the Environment table and fills only the name", async () => {
		const test = testContainer();
		await test.container.services.settings.start();
		must(await test.container.services.settings.setEnvVar("HTTPS_PROXY", "value", "global"));

		renderInside(test, h(EnvironmentPage));
		await screen.findByText("HTTPS_PROXY");
		fireEvent.click(screen.getByRole("button", { name: /Show documented variables/ }));

		expect(screen.queryByRole("button", { name: "Set HTTPS_PROXY" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Set HTTP_PROXY" }));

		await waitFor(() =>
			expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("HTTP_PROXY"),
		);
		expect((screen.getByLabelText("Value") as HTMLTextAreaElement).value).toBe("");
	});
});

describe("s1-ui-3 join SET-12 config editors and Chrome switch", () => {
	it("turns on Claude in Chrome and saves an edit to Claude's settings file", async () => {
		const test = testContainer();
		const installs: AgentInstall[] = [
			{ agent: "claude", installed: true, authenticated: true },
			{ agent: "codex", installed: true, authenticated: true },
		];
		vi.spyOn(test.container.services.agentCatalog, "refresh").mockResolvedValue(ok(undefined));
		test.container.services.agentCatalog.setInstalls(installs);
		const path = `${test.container.platform.fs.paths.home}/.claude/settings.json`;
		expect(await test.container.platform.fs.writeTextAtomic(path, '{"model":"opus"}')).toEqual(
			ok(undefined),
		);

		renderInside(test, h(AgentsPage));
		await screen.findByRole("heading", { name: "Claude Code" });

		const toggle = await screen.findByRole("switch", { name: "Use Claude Code with Chrome" });
		expect(toggle.getAttribute("aria-checked")).toBe("false");
		fireEvent.click(toggle);
		await waitFor(() =>
			expect(test.container.services.settings.get("chrome_mode_enabled")).toBe(true),
		);

		fireEvent.click(screen.getByRole("button", { name: "Claude settings" }));
		const dialog = within(await screen.findByRole("dialog"));
		const editor = await dialog.findByRole("textbox", { name: "Claude settings" });
		await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('{"model":"opus"}'));
		fireEvent.change(editor, { target: { value: '{"model":"sonnet"}' } });
		fireEvent.click(dialog.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(test.container.platform.fs.readText(path)).resolves.toEqual(ok('{"model":"sonnet"}')),
		);
	});
});
