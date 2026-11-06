import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCommandHandlers, runCommandHandlers } from "../../../app/command-dispatcher.ts";
import type { ChangedFile, DiffScope, Loadable } from "../../../core/api.ts";
import type { BranchCommit, GitState, Workspace } from "../../../core/model.ts";
import "../../../test/dom-polyfills.ts";

const workspaceId = "w1" as WorkspaceId;

const state = vi.hoisted(() => ({
	files: { state: "ready", data: [] } as Loadable<ChangedFile[]>,
	git: { state: "loading" } as Loadable<GitState>,
	commits: { state: "ready", data: [] } as Loadable<BranchCommit[]>,
	workspace: { state: "loading" } as Loadable<Workspace>,
	branches: { state: "ready", data: [] } as Loadable<string[]>,
	branchesThrow: null as Error | null,
	setViewed: vi.fn(),
	discardFile: vi.fn(),
	toast: { error: vi.fn() },
}));

vi.mock("../../../ui/Toast.tsx", () => ({
	toast: state.toast,
	toastError: vi.fn(),
}));

vi.mock("../../../core/hooks.ts", () => ({
	useChangedFiles: () => state.files,
	useGitState: () => state.git,
	useBranchCommits: () => state.commits,
	useWorkspace: () => state.workspace,
	useWorkspaceStatus: () => null,
	useSetting: () => false,
	useStack: () => ({ state: "ready", data: [] }),
	useBranches: () => {
		if (state.branchesThrow !== null) throw state.branchesThrow;
		return state.branches;
	},
	useLiveShortcut: () => null,
	useActions: () => ({
		git: { setViewed: state.setViewed, discardFile: state.discardFile },
		app: { copyText: vi.fn() },
	}),
}));

const { ChangesTab } = await import("./ChangesTab.tsx");
const { DiffScopeMenu } = await import("./DiffScopeMenu.tsx");

const file = (path: string, over: Partial<ChangedFile> = {}): ChangedFile => ({
	path,
	status: "modified",
	linesAdded: 1,
	linesRemoved: 1,
	binary: false,
	conflicted: false,
	viewed: false,
	...over,
});

const commit = (sha: string, subject: string): BranchCommit => ({
	sha,
	shortSha: sha.slice(0, 7),
	subject,
	authorName: "Ada",
	at: 1_700_000_000_000,
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
	state.files = { state: "ready", data: [] };
	state.git = { state: "ready", data: gitState() };
	state.commits = { state: "ready", data: [] };
	state.workspace = { state: "loading" };
	state.branches = { state: "ready", data: [] };
	state.branchesThrow = null;
	state.setViewed.mockReset();
	state.discardFile.mockReset();
	state.toast.error.mockReset();
});

afterEach(() => {
	cleanup();
	clearCommandHandlers();
	vi.restoreAllMocks();
});

const renderChanges = (onOpenFile = vi.fn()) => {
	render(
		<ChangesTab
			workspaceId={workspaceId}
			scope={{ kind: "branch" }}
			onScopeChange={vi.fn()}
			onOpenFile={onOpenFile}
		/>,
	);
	return onOpenFile;
};

describe("REV-01 changes tab", () => {
	it("shows only the rows that match the filter", () => {
		state.files = {
			state: "ready",
			data: [file("src/a/x.ts"), file("src/b/y.ts"), file("README.md")],
		};
		renderChanges();
		expect(screen.getByLabelText("Open src/a/x.ts")).toBeTruthy();
		expect(screen.getByLabelText("Open src/b/y.ts")).toBeTruthy();
		fireEvent.change(screen.getByRole("textbox", { name: "Filter changed files" }), {
			target: { value: "src/a" },
		});
		expect(screen.getByLabelText("Open src/a/x.ts")).toBeTruthy();
		expect(screen.queryByLabelText("Open src/b/y.ts")).toBeNull();
		expect(screen.queryByLabelText("Open README.md")).toBeNull();
	});

	it("opens a file in diff mode when its row is clicked", () => {
		state.files = { state: "ready", data: [file("src/a/x.ts")] };
		const onOpenFile = renderChanges();
		fireEvent.click(screen.getByLabelText("Open src/a/x.ts"));
		expect(onOpenFile).toHaveBeenCalledWith("src/a/x.ts");
	});

	it("shows the untracked note only for scopes that include the working tree", () => {
		state.files = { state: "ready", data: [file("src/a.ts")] };
		state.git = { state: "ready", data: gitState({ untrackedFilesTruncated: true }) };
		const { rerender } = render(
			<ChangesTab
				workspaceId={workspaceId}
				scope={{ kind: "branch" }}
				onScopeChange={vi.fn()}
				onOpenFile={vi.fn()}
			/>,
		);
		expect(screen.getByRole("note").textContent).toContain("Some untracked files");
		rerender(
			<ChangesTab
				workspaceId={workspaceId}
				scope={{ kind: "commit", sha: "abc" }}
				onScopeChange={vi.fn()}
				onOpenFile={vi.fn()}
			/>,
		);
		expect(screen.queryByRole("note")).toBeNull();
	});

	it("asks the user to finish a rebase before showing changes", () => {
		state.git = { state: "ready", data: gitState({ operation: "rebase" }) };
		renderChanges();
		expect(screen.getByRole("heading", { name: "Finish the rebase" })).toBeTruthy();
	});

	it("shows the error's own message when the changed files cannot be read", () => {
		state.files = { state: "error", error: { code: "git_failed", message: "fatal: bad object" } };
		renderChanges();
		expect(screen.getByRole("heading", { name: "No git status" })).toBeTruthy();
		expect(screen.getByText("fatal: bad object")).toBeTruthy();
	});

	it("opens the selected file's diff when the open-diff command runs", () => {
		state.files = { state: "ready", data: [file("src/a/x.ts")] };
		const onOpenFile = renderChanges();
		expect(runCommandHandlers("review.openDiff")).toBe(false);
		fireEvent.click(screen.getByLabelText("Open src/a/x.ts"));
		onOpenFile.mockClear();
		expect(runCommandHandlers("review.openDiff")).toBe(true);
		expect(onOpenFile).toHaveBeenCalledWith("src/a/x.ts");
	});

	it("offers Discard changes on a branch scope but not on a single commit", async () => {
		state.files = { state: "ready", data: [file("src/a/x.ts")] };
		const props = { workspaceId, onScopeChange: vi.fn(), onOpenFile: vi.fn() };
		const { rerender } = render(<ChangesTab {...props} scope={{ kind: "branch" }} />);
		fireEvent.contextMenu(screen.getByLabelText("Open src/a/x.ts"));
		expect(await screen.findByText("Discard changes")).toBeTruthy();
		fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
		rerender(<ChangesTab {...props} scope={{ kind: "commit", sha: "abc" }} />);
		fireEvent.contextMenu(screen.getByLabelText("Open src/a/x.ts"));
		expect(screen.queryByText("Discard changes")).toBeNull();
	});

	it("says changes appear here when the list is empty", () => {
		renderChanges();
		expect(screen.getByRole("heading", { name: "Changes appear here" })).toBeTruthy();
	});

	it("CHAT-15 refuses a single-file revert in a per-turn view", async () => {
		state.files = { state: "ready", data: [file("src/a/x.ts")] };
		const props = { workspaceId, onScopeChange: vi.fn(), onOpenFile: vi.fn() };
		render(
			<ChangesTab
				{...props}
				scope={{ kind: "turn", sessionId: "s1" as never, turnId: "t1" as never }}
			/>,
		);
		fireEvent.contextMenu(screen.getByLabelText("Open src/a/x.ts"));
		fireEvent.click(await screen.findByRole("menuitem", { name: "Discard changes" }));
		// Discard asks first, because it cannot be undone (the row menu's confirm, REV-06).
		expect(await screen.findByRole("heading", { name: "Discard file changes?" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(state.toast.error).toHaveBeenCalledWith("Reverting to a turn is not supported yet.");
		expect(state.discardFile).not.toHaveBeenCalled();
	});
});

describe("REV-01 diff scope menu", () => {
	it("keeps the menu working when the branch list fails to load", async () => {
		state.workspace = { state: "ready", data: { repoId: "r1" } as Workspace };
		state.branchesThrow = new Error("The branch list could not be read.");
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		render(
			<DiffScopeMenu workspaceId={workspaceId} scope={{ kind: "branch" }} onChange={vi.fn()} />,
		);
		const trigger = screen.getByRole("button", { name: "Diff scope" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		const sub = await screen.findByRole("menuitem", { name: "Target branch" });
		fireEvent.keyDown(sub, { key: "ArrowRight" });
		// The inline boundary says its area and the failure on one line.
		expect(await screen.findByText("Target branch: This part failed to load.")).toBeTruthy();
		expect(screen.getByRole("menuitemradio", { name: /Uncommitted changes/ })).toBeTruthy();
	});

	it("shows no file count while the git state is loading", async () => {
		state.git = { state: "loading" };
		render(
			<DiffScopeMenu workspaceId={workspaceId} scope={{ kind: "branch" }} onChange={vi.fn()} />,
		);
		const trigger = screen.getByRole("button", { name: "Diff scope" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		await screen.findByRole("menuitemradio", { name: /Uncommitted changes/ });
		expect(screen.queryByText(/files? changed/)).toBeNull();
	});

	it("choosing a commit entry reports the commit scope", async () => {
		state.commits = {
			state: "ready",
			data: [commit("aaa1111", "First"), commit("bbb2222", "Second")],
		};
		const onChange = vi.fn<(scope: DiffScope) => void>();
		render(
			<DiffScopeMenu workspaceId={workspaceId} scope={{ kind: "branch" }} onChange={onChange} />,
		);
		const trigger = screen.getByRole("button", { name: "Diff scope" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitemradio", { name: /Second/ }));
		expect(onChange).toHaveBeenCalledWith({ kind: "commit", sha: "bbb2222" });
	});

	it("names a range scope by its stack pull requests (PR-08)", () => {
		const { rerender } = render(
			<DiffScopeMenu
				workspaceId={workspaceId}
				scope={{ kind: "range", prNumbers: [10] }}
				onChange={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "Diff scope" }).textContent).toBe("Changes in #10");
		rerender(
			<DiffScopeMenu
				workspaceId={workspaceId}
				scope={{ kind: "range", prNumbers: [10, 11] }}
				onChange={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "Diff scope" }).textContent).toBe("Changes in 2 PRs");
	});

	it("switches to uncommitted changes from the menu", async () => {
		const onChange = vi.fn<(scope: DiffScope) => void>();
		render(
			<DiffScopeMenu workspaceId={workspaceId} scope={{ kind: "branch" }} onChange={onChange} />,
		);
		const trigger = screen.getByRole("button", { name: "Diff scope" });
		trigger.focus();
		fireEvent.keyDown(trigger, { key: "Enter" });
		fireEvent.click(await screen.findByRole("menuitemradio", { name: /Uncommitted changes/ }));
		expect(onChange).toHaveBeenCalledWith({ kind: "uncommitted" });
	});
});
