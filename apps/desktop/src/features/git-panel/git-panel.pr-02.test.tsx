/**
 * @feature PR-02 Create a pull request from the git panel
 * Owns: the Create PR button and Cmd+Shift+P both reach `pullRequests.create` for the panel's
 * workspace, and a second press (or a click) while the first runs creates nothing more.
 * Behaviour: services-map.md 3.7.1 (the app asks the agent to create the pull request), ui-map.md
 * 3.6 (the header's Create PR action) and 5.4 (Cmd+Shift+P).
 * Test first: Cmd+Shift+P maps to `git.createPr` and calls `pullRequests.create`; two presses while
 * the first is still running call it once.
 */
import type { Result, WorkspaceId } from "@conducted/shared";
import {
	act,
	cleanup,
	fireEvent,
	render as renderDom,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearCommandHandlers,
	commandForKeyPress,
	keyBindings,
	runCommandHandlers,
} from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import type { Loadable } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { GitState } from "../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";

const workspaceId = "w1" as WorkspaceId;

const state = vi.hoisted(() => ({
	git: { state: "loading" } as Loadable<GitState>,
	create: vi.fn(),
}));

// The test drives the hooks named here. Every other hook, and every service the panel reads, is
// the real container's, so a hook or service the panel starts to read later is already there.
vi.mock("../../core/hooks.ts", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../core/hooks.ts")>()),
	useGitState: () => state.git,
	useWorkspaceStatus: () => null,
	useSetting: () => false,
	useLiveShortcut: () => null,
	useActions: () => ({
		git: { commitAndPush: vi.fn() },
		pullRequests: { create: state.create, requestAiReview: vi.fn() },
		files: { open: vi.fn() },
	}),
}));

vi.mock("../../core/status/git-header.ts", () => ({
	computeGitHeader: () => ({
		kind: "changes",
		title: "Changes",
		tone: "attention",
		action: { id: "create_pr", label: "Create PR" },
	}),
}));

vi.mock("./changes/ChangesTab.tsx", () => ({ ChangesTab: () => <div>changes body</div> }));
vi.mock("./files/FilesTab.tsx", () => ({ FilesTab: () => <div>files body</div> }));
vi.mock("./checks/ChecksTab.tsx", () => ({ ChecksTab: () => <div>checks body</div> }));

const { GitPanel } = await import("./GitPanel.tsx");

let test: TestContainer | undefined;

beforeEach(() => {
	test = createTestContainer();
});

/** Renders over the real container, which beforeEach builds for each test. */
const render = (ui: ReactElement) =>
	renderDom(ui, {
		wrapper: ({ children }: { children: ReactNode }) => {
			if (test === undefined) throw new Error("The test container is built in beforeEach.");
			return (
				<ServicesProvider container={test.container}>
					<AppProviders client={createQueryClient(() => {})}>{children}</AppProviders>
				</ServicesProvider>
			);
		},
	});

const gitState = (): GitState => ({
	branch: "feat",
	uncommittedFiles: 1,
	changedFiles: 1,
	linesAdded: 1,
	linesRemoved: 0,
	hasConflicts: false,
	operation: "none",
	sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
	pullRequest: null,
	pullRequestUnavailable: "none",
	untrackedFilesTruncated: false,
	pendingPullRequestAction: null,
});

beforeEach(() => {
	clearCommandHandlers();
	state.git = { state: "ready", data: gitState() };
	state.create.mockReset();
	state.create.mockResolvedValue({ ok: true });
});

afterEach(() => {
	cleanup();
	clearCommandHandlers();
	test?.close();
	test = undefined;
});

describe("PR-02 git panel create PR", () => {
	it("sends the Create PR button to the pull request service", async () => {
		render(<GitPanel workspaceId={workspaceId} />);

		fireEvent.click(screen.getByRole("button", { name: /Create PR/ }));

		await waitFor(() => expect(state.create).toHaveBeenCalledWith(workspaceId, { draft: false }));
	});

	it("maps Cmd+Shift+P to git.createPr and runs the panel's handler", async () => {
		render(<GitPanel workspaceId={workspaceId} />);

		const press = {
			key: "p",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			shiftKey: true,
			isComposing: false,
			repeat: false,
		};
		expect(commandForKeyPress(press, ["global"], keyBindings())).toBe("git.createPr");
		expect(runCommandHandlers("git.createPr")).toBe(true);

		await waitFor(() => expect(state.create).toHaveBeenCalledWith(workspaceId, { draft: false }));
	});

	it("asks the agent for one pull request when Cmd+Shift+P is pressed twice while the first runs", async () => {
		let finish: (result: Result<void>) => void = () => {};
		state.create.mockReturnValueOnce(
			new Promise<Result<void>>((resolve) => {
				finish = resolve;
			}),
		);
		render(<GitPanel workspaceId={workspaceId} />);

		expect(runCommandHandlers("git.createPr")).toBe(true);
		expect(runCommandHandlers("git.createPr")).toBe(true);
		// The header button shares the guard with the shortcut.
		fireEvent.click(screen.getByRole("button", { name: /Create PR/ }));
		expect(state.create).toHaveBeenCalledTimes(1);

		// Once the first call has finished, the next press runs again.
		await act(async () => finish({ ok: true, value: undefined }));
		await waitFor(() => {
			runCommandHandlers("git.createPr");
			expect(state.create).toHaveBeenCalledTimes(2);
		});
	});
});
