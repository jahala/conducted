import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearCommandHandlers,
	commandForKeyPress,
	keyBindings,
	runCommandHandlers,
} from "../../app/command-dispatcher.ts";
import type { DiffScope, Loadable } from "../../core/api.ts";
import type { GitState, PullRequest } from "../../core/model.ts";
import "../../test/dom-polyfills.ts";

const workspaceId = "w1" as WorkspaceId;

const state = vi.hoisted(() => ({
	git: { state: "loading" } as Loadable<GitState>,
	commitAndPush: vi.fn(),
	create: vi.fn(),
	requestAiReview: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useGitState: () => state.git,
	useWorkspaceStatus: () => null,
	useSetting: () => false,
	useLiveShortcut: () => null,
	useActions: () => ({
		git: { commitAndPush: state.commitAndPush },
		pullRequests: { create: state.create, requestAiReview: state.requestAiReview },
		files: { open: vi.fn() },
	}),
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({ services: { git: { refresh: async () => ({ ok: true }) } } }),
}));

vi.mock("./changes/ChangesTab.tsx", () => ({ ChangesTab: () => <div>changes body</div> }));
vi.mock("./files/FilesTab.tsx", () => ({ FilesTab: () => <div>files body</div> }));
vi.mock("./checks/ChecksTab.tsx", () => ({ ChecksTab: () => <div>checks body</div> }));

const { GitPanel } = await import("./GitPanel.tsx");

const pullRequest = (over: Partial<PullRequest> = {}): PullRequest => ({
	number: 1,
	url: "https://example.test/pull/1",
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
	...over,
});

const gitState = (over: Partial<GitState> = {}): GitState => ({
	branch: "feat",
	uncommittedFiles: 0,
	changedFiles: 0,
	linesAdded: 0,
	linesRemoved: 0,
	hasConflicts: false,
	operation: "none",
	sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
	pullRequest: null,
	pullRequestUnavailable: "none",
	untrackedFilesTruncated: false,
	pendingPullRequestAction: null,
	...over,
});

beforeEach(() => {
	state.git = { state: "ready", data: gitState({ uncommittedFiles: 2, changedFiles: 2 }) };
	state.commitAndPush.mockReset();
	state.create.mockReset();
	state.requestAiReview.mockReset();
	state.commitAndPush.mockResolvedValue({ ok: true });
	state.create.mockResolvedValue({ ok: true });
	state.requestAiReview.mockResolvedValue({ ok: true });
});

afterEach(() => {
	cleanup();
	clearCommandHandlers();
});

describe("REV-01 git panel", () => {
	it("shows uncommitted changes and the main action from the git state", () => {
		render(<GitPanel workspaceId={workspaceId} />);
		expect(screen.getAllByText("Uncommitted changes").length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: /Commit and push/ })).toBeTruthy();
	});

	it("runs the header's main action", () => {
		render(<GitPanel workspaceId={workspaceId} />);
		fireEvent.click(screen.getByRole("button", { name: /Commit and push/ }));
		expect(state.commitAndPush).toHaveBeenCalledWith(workspaceId);
	});

	it("shows the changed count on the Changes tab", () => {
		render(<GitPanel workspaceId={workspaceId} />);
		expect(screen.getByRole("tab", { name: /Changes/ }).textContent).toContain("2");
	});

	it("does not offer the comments action until the review store exists", () => {
		state.git = {
			state: "ready",
			data: gitState({
				changedFiles: 1,
				pullRequest: pullRequest({ reviewDecision: "changes_requested" }),
			}),
		};
		render(<GitPanel workspaceId={workspaceId} />);
		expect(screen.queryByRole("button", { name: /Add all comments/ })).toBeNull();
		expect(screen.getAllByText("PR changes requested").length).toBeGreaterThan(0);
	});

	it("starts only one review when Review is pressed twice", () => {
		state.requestAiReview.mockReturnValue(new Promise(() => undefined));
		render(<GitPanel workspaceId={workspaceId} />);
		const button = screen.getByRole("button", { name: "Review" });
		fireEvent.click(button);
		fireEvent.click(button);
		expect(state.requestAiReview).toHaveBeenCalledTimes(1);
	});

	it("ignores a raw Cmd+Alt+U key press, which belongs to the command dispatcher", () => {
		const onScopeChange = vi.fn<(scope: DiffScope) => void>();
		render(<GitPanel workspaceId={workspaceId} onScopeChange={onScopeChange} />);
		fireEvent.keyDown(window, { key: "u", metaKey: true, altKey: true });
		expect(onScopeChange).not.toHaveBeenCalled();
	});

	it("Cmd+Alt+U switches to the uncommitted changes scope", () => {
		const onTabChange = vi.fn();
		const onScopeChange = vi.fn<(scope: DiffScope) => void>();
		render(
			<GitPanel
				workspaceId={workspaceId}
				tab="checks"
				onTabChange={onTabChange}
				scope={{ kind: "branch" }}
				onScopeChange={onScopeChange}
			/>,
		);
		const press = {
			key: "u",
			metaKey: true,
			ctrlKey: false,
			altKey: true,
			shiftKey: false,
			isComposing: false,
			repeat: false,
		};
		expect(commandForKeyPress(press, ["global"], keyBindings())).toBe("review.showUncommitted");
		expect(runCommandHandlers("review.showUncommitted")).toBe(true);
		expect(onTabChange).toHaveBeenCalledWith("changes");
		expect(onScopeChange).toHaveBeenCalledWith({ kind: "uncommitted" });
	});
});
