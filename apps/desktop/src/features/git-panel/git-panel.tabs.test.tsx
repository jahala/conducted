/**
 * @feature REV-01 Git panel tab bodies
 * Owns: tests that an unbuilt tab body (Checks) does not take the whole panel down, that the built
 * All files tab keeps the panel, and that a review request started in one workspace does not change
 * another workspace's panel.
 * Test first: choosing the Checks tab keeps the header and the tab strip, and the Changes tab
 * works again afterwards.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Loadable } from "../../core/api.ts";
import type { GitState } from "../../core/model.ts";
import "../../test/dom-polyfills.ts";

const state = vi.hoisted(() => ({
	git: { state: "loading" } as Loadable<GitState>,
	requestAiReview: vi.fn(),
}));

vi.mock("../../core/hooks.ts", () => ({
	useGitState: () => state.git,
	useWorkspaceStatus: () => null,
	useSetting: () => false,
	useLiveShortcut: () => null,
	useFileTree: () => ({ state: "loading" }),
	useWorkspace: () => ({ state: "loading" }),
	useSessions: () => ({ state: "loading" }),
	useChangedFiles: () => ({ state: "loading" }),
	useDiffComments: () => ({ state: "ready", data: [] }),
	useActions: () => ({
		git: {},
		pullRequests: { requestAiReview: state.requestAiReview },
		files: { open: vi.fn(), attachToChat: vi.fn() },
		app: { copyText: vi.fn() },
	}),
}));

vi.mock("../../core/context.tsx", () => ({
	useServices: () => ({ services: { git: { refresh: async () => ({ ok: true }) } } }),
}));

// The real header (GIT-04) is used here; an unbuilt tab must not take the rest of the panel down.
vi.mock("./changes/ChangesTab.tsx", () => ({ ChangesTab: () => <div>changes body</div> }));

const { GitPanel } = await import("./GitPanel.tsx");

const gitState: GitState = {
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
};

beforeEach(() => {
	state.git = { state: "ready", data: gitState };
	state.requestAiReview.mockReset();
});

afterEach(cleanup);

const choose = (name: string | RegExp) =>
	fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });

describe("REV-01 git panel with unbuilt tabs", () => {
	it("keeps the header and tab strip when moving to the Checks tab, and recovers", () => {
		render(<GitPanel workspaceId={"w1" as WorkspaceId} />);
		expect(screen.getByText("changes body")).toBeTruthy();

		choose("Checks");
		expect(screen.getByText("No pull request yet.")).toBeTruthy();
		expect(screen.getByRole("tab", { name: /Changes/ })).toBeTruthy();
		expect(screen.getAllByText("Uncommitted changes").length).toBeGreaterThan(0);

		choose(/^Changes/);
		expect(screen.getByText("changes body")).toBeTruthy();
	});

	it("keeps the panel when the built All files tab shows its loading state", () => {
		render(<GitPanel workspaceId={"w1" as WorkspaceId} />);
		choose("All files");
		expect(screen.getAllByRole("status", { name: "Loading files" }).length).toBeGreaterThan(0);
		expect(screen.getByRole("tab", { name: "Checks" })).toBeTruthy();
	});

	it("moves from an unbuilt tab to the built one without sticking on the first message", () => {
		render(<GitPanel workspaceId={"w1" as WorkspaceId} />);
		choose("Checks");
		choose("All files");
		expect(screen.queryByText(/Not built yet: PR-04/)).toBeNull();
		expect(screen.getAllByRole("status", { name: "Loading files" }).length).toBeGreaterThan(0);
	});
});

describe("REV-01 git panel review across workspaces", () => {
	it("leaves the new workspace's prompt and Review button alone when an old request ends", async () => {
		let finish: ((value: { ok: true; value: undefined }) => void) | undefined;
		state.requestAiReview.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const { rerender } = render(<GitPanel workspaceId={"w1" as WorkspaceId} />);
		fireEvent.click(screen.getByRole("button", { name: "Review" }));
		expect(state.requestAiReview).toHaveBeenCalledTimes(1);

		rerender(<GitPanel workspaceId={"w2" as WorkspaceId} />);
		// The review button of w2 is not held back by w1's request.
		expect(screen.getByRole("button", { name: "Review" }).hasAttribute("disabled")).toBe(false);

		finish?.({ ok: true, value: undefined });
		await waitFor(() => expect(screen.getByRole("button", { name: "Review" })).toBeTruthy());
		expect(screen.getByRole("button", { name: "Review" }).hasAttribute("disabled")).toBe(false);
	});
});
