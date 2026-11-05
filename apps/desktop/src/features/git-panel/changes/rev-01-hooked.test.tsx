import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	setViewed: vi.fn(),
	discardFile: vi.fn(),
}));

vi.mock("../../../core/hooks.ts", () => ({
	useChangedFiles: () => state.files,
	useGitState: () => state.git,
	useBranchCommits: () => state.commits,
	useWorkspace: () => state.workspace,
	useBranches: () => state.branches,
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
	state.setViewed.mockReset();
	state.discardFile.mockReset();
});

afterEach(cleanup);

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

	it("says changes appear here when the list is empty", () => {
		renderChanges();
		expect(screen.getByRole("heading", { name: "Changes appear here" })).toBeTruthy();
	});
});

describe("REV-01 diff scope menu", () => {
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
