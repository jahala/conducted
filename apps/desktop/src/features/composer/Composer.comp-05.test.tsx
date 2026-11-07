/**
 * @feature COMP-05 # PR and issue mentions
 * Owns: tests over the real container that typing '#' in the composer lists the repository's pull
 * requests and issues, and that choosing one writes its context file and inserts a chip.
 * Behaviour: ui-map.md 3.5 ('#': pull requests and issues; selecting writes a PR context file and
 * inserts a chip); services-map.md 5B.8.3 (`.context/pull-requests/<n>.md` and
 * `[GITHUB]-<n>.md`); inventory toast row 739 ("Failed to save PR context").
 * Test first: typing '#12' offers PR 12, and choosing it writes `.context/pull-requests/12.md`.
 */
import type { SessionConfig } from "@conducted/protocol";
import { ok, type Result } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandDispatcher } from "../../app/command-dispatcher.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { GithubAccess } from "../../core/services/github.ts";
import type { ShellOutput } from "../../platform/platform.ts";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";
import { toast } from "../../ui/Toast.tsx";
import { Composer } from "./Composer.tsx";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "claude-sonnet-4-5",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const REMOTE = "https://github.com/octo/repo.git";

const CONNECTED: GithubAccess = {
	status: "ok",
	login: "octo",
	host: "github.com",
	scopes: ["repo"],
	usesToken: false,
	gitProtocol: "https",
};

const pullRequest = {
	number: 12,
	title: "Fix the mention trigger",
	html_url: "https://github.com/octo/repo/pull/12",
	state: "open",
	updated_at: "2026-11-05T10:00:00Z",
	body: "The '#' menu drops the last letter.",
	head: { ref: "fix-mention" },
	user: { login: "octo" },
};

const issue = {
	number: 7,
	title: "Search drops the last letter",
	html_url: "https://github.com/octo/repo/issues/7",
	state: "open",
	updated_at: "2026-11-05T10:00:00Z",
	body: "Typing fast loses a letter.",
	user: { login: "octo" },
};

interface SetupOptions {
	access?: GithubAccess;
	pullNumbers?: number[];
	issues?: unknown[];
	pullReadFails?: boolean;
}

let active: TestContainer | undefined;

afterEach(() => {
	cleanup();
	toast.dismiss();
	vi.restoreAllMocks();
	active?.close();
	active = undefined;
});

const must = <T,>(result: Result<T>): T => {
	if (!result.ok) throw new Error(result.error.message);
	return result.value;
};

const shellOutput = (stdout = "", exitCode = 0): Result<ShellOutput> =>
	ok({ exitCode, stdout, stderr: "" });

function scriptGithub(test: TestContainer, options: SetupOptions): void {
	test.memory.controls.scriptShell((command) => {
		const args = command.args.join(" ");
		if (command.program === "git" && args.includes("remote get-url")) {
			return shellOutput(`${REMOTE}\n`);
		}
		if (command.program !== "gh") return null;
		if (args.includes("pulls/12")) {
			return options.pullReadFails === true
				? shellOutput("", 1)
				: shellOutput(JSON.stringify(pullRequest));
		}
		if (args.includes("pulls?")) {
			const listed = (options.pullNumbers ?? [12]).map((number) => ({
				...pullRequest,
				number,
			}));
			return shellOutput(JSON.stringify(listed));
		}
		if (args.includes("issues/7")) return shellOutput(JSON.stringify(issue));
		if (args.includes("issues?")) return shellOutput(JSON.stringify(options.issues ?? [issue]));
		return null;
	});
}

async function setup(options: SetupOptions = {}) {
	const test = createTestContainer();
	active = test;
	const repo = await seedRepo(test.container, { remoteUrl: REMOTE });
	must(await test.container.services.repo.loadConfig(repo.id));
	const workspace = await seedWorkspace(test.container, { repoId: repo.id });
	const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
	test.container.services.sessions.store.setState((state) => ({
		...state,
		viewingSessionId: session.id,
	}));
	test.container.services.github.store.setState((state) => ({
		...state,
		access: options.access ?? CONNECTED,
	}));
	scriptGithub(test, options);

	let editor: Editor | null = null;
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>
			<CommandDispatcher>{children}</CommandDispatcher>
		</ServicesProvider>
	);
	render(
		<Composer
			workspaceId={workspace.id}
			sessionId={session.id}
			onEditorReady={(next) => {
				editor = next;
			}}
		/>,
		{ wrapper },
	);
	await waitFor(() => expect(editor).not.toBeNull());
	return { test, workspace, session, editor: () => editor as unknown as Editor };
}

describe("COMP-05 # mentions in the composer", () => {
	it("offers PR 12 for '#12' and writes its context file when chosen", async () => {
		const { test, workspace, editor } = await setup();

		act(() => editor().commands.insertContent("#12"));
		const row = await screen.findByRole("option", { name: /#12/ });
		expect(row.textContent).toContain("Fix the mention trigger");
		fireEvent.click(row);

		const path = `${workspace.path}/.context/pull-requests/12.md`;
		await waitFor(() => expect(test.memory.controls.files.has(path)).toBe(true));
		expect(test.memory.controls.files.get(path)).toContain("Fix the mention trigger");
		await waitFor(() => expect(editor().getText()).toContain("⟦pr:12⟧"));
		expect(screen.getByText("#12 Fix the mention trigger")).toBeTruthy();
	});

	it("offers an issue and writes its GitHub context file when chosen", async () => {
		const { test, workspace, editor } = await setup();

		act(() => editor().commands.insertContent("#7"));
		const row = await screen.findByRole("option", { name: /#7/ });
		expect(row.textContent).toContain("Search drops the last letter");
		fireEvent.click(row);

		const relative = ".context/attachments/github-7/[GITHUB]-7.md";
		const path = `${workspace.path}/${relative}`;
		await waitFor(() => expect(test.memory.controls.files.has(path)).toBe(true));
		expect(test.memory.controls.files.get(path)).toContain("Typing fast loses a letter.");
		await waitFor(() => expect(editor().getText()).toContain(`⟦file:${relative}⟧`));
	});

	it("Enter on the open '#' menu chooses its row, and with no row yet sends nothing", async () => {
		const { test, workspace, editor } = await setup({ pullNumbers: [12], issues: [] });
		const send = vi.spyOn(test.container.actions.sessions, "send");
		const textbox = screen.getByRole("textbox", { name: "composer" });

		act(() => editor().commands.insertContent("#12"));
		fireEvent.keyDown(textbox, { key: "Enter" });
		await screen.findByRole("option", { name: /#12/ });
		fireEvent.keyDown(textbox, { key: "Enter" });

		const path = `${workspace.path}/.context/pull-requests/12.md`;
		await waitFor(() => expect(test.memory.controls.files.has(path)).toBe(true));
		await waitFor(() => expect(editor().getText()).toContain("⟦pr:12⟧"));
		expect(send).not.toHaveBeenCalled();
	});

	it("tells a signed-out user how to connect GitHub", async () => {
		const { editor } = await setup({ access: { status: "signed_out" } });

		act(() => editor().commands.insertContent("#12"));

		expect(await screen.findByText('Run "gh auth login" to connect GitHub.')).toBeTruthy();
	});

	it("shows 'Failed to save PR context' and inserts no chip when the write fails", async () => {
		const error = vi.spyOn(toast, "error").mockReturnValue("toast-id");
		const { test, workspace, editor } = await setup({ pullReadFails: true });

		act(() => editor().commands.insertContent("#12"));
		fireEvent.click(await screen.findByRole("option", { name: /#12/ }));

		await waitFor(() =>
			expect(error).toHaveBeenCalledWith(
				"Failed to save PR context",
				expect.objectContaining({ description: expect.any(String) }),
			),
		);
		expect(test.memory.controls.files.has(`${workspace.path}/.context/pull-requests/12.md`)).toBe(
			false,
		);
		expect(editor().getText()).toBe("#12");
	});
});
