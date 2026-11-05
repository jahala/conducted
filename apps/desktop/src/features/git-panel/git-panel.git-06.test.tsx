/**
 * @feature GIT-06 Pull and push from the git panel
 * Owns: the Pull button and Cmd+Shift+L both reach `git.pull`, and the panel reports the pull's
 * outcome: up to date shows the up-to-date toast, a fast-forward shows the "Pulled latest changes"
 * toast.
 * Behaviour: services-map.md 3.6.4 (fast-forward toast) and ui-map.md 5.4 (Cmd+Shift+L).
 * Test first: Cmd+Shift+L maps to `git.pullLatest` and calls the panel's handler.
 */
import { ok, type WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearCommandHandlers,
	commandForKeyPress,
	keyBindings,
	runCommandHandlers,
} from "../../app/command-dispatcher.ts";
import { createShellContainer } from "../../app/shell-test-support.ts";
import type { Loadable } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { GitState } from "../../core/model.ts";
import { PULL_UP_TO_DATE_MESSAGE, PULLED_LATEST_MESSAGE } from "../../core/services/git.ts";
import "../../test/dom-polyfills.ts";

const workspaceId = "w1" as WorkspaceId;

const state = vi.hoisted(() => ({
	git: { state: "loading" } as Loadable<GitState>,
	toast: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("../../ui/Toast.tsx", () => ({
	toast: { success: state.toast },
	toastError: state.toastError,
}));

// GIT-04 owns the git state hook and the header model, so this test supplies both and runs
// everything else over the real container.
vi.mock("../../core/hooks.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../core/hooks.ts")>();
	return { ...actual, useGitState: () => state.git };
});

vi.mock("../../core/status/git-header.ts", () => ({
	computeGitHeader: () => ({
		kind: "behind",
		title: "Behind by 2 commits",
		tone: "attention",
		action: { id: "pull", label: "Pull latest", waitingNote: null },
	}),
}));

vi.mock("./changes/ChangesTab.tsx", () => ({ ChangesTab: () => <div>changes body</div> }));
vi.mock("./files/FilesTab.tsx", () => ({ FilesTab: () => <div>files body</div> }));
vi.mock("./checks/ChecksTab.tsx", () => ({ ChecksTab: () => <div>checks body</div> }));

const { GitPanel } = await import("./GitPanel.tsx");

const gitState = (): GitState => ({
	branch: "feat",
	uncommittedFiles: 0,
	changedFiles: 1,
	linesAdded: 1,
	linesRemoved: 0,
	hasConflicts: false,
	operation: "none",
	sync: { ahead: 0, behind: 2, rewritten: false, hasUpstream: true },
	pullRequest: null,
	pullRequestUnavailable: "none",
	untrackedFilesTruncated: false,
	pendingPullRequestAction: null,
});

let container: ReturnType<typeof createShellContainer>["container"];

beforeEach(() => {
	clearCommandHandlers();
	state.git = { state: "ready", data: gitState() };
	state.toast.mockReset();
	state.toastError.mockReset();
	container = createShellContainer().container;
});

afterEach(() => {
	cleanup();
	clearCommandHandlers();
});

const renderPanel = () =>
	render(
		<ServicesProvider container={container}>
			<GitPanel workspaceId={workspaceId} />
		</ServicesProvider>,
	);

describe("GIT-06 git panel pull latest", () => {
	it("maps Cmd+Shift+L to git.pullLatest and runs the panel's handler", async () => {
		const pull = vi.spyOn(container.services.git, "pull").mockResolvedValue(ok("up_to_date"));
		renderPanel();

		const press = {
			key: "l",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			shiftKey: true,
			isComposing: false,
			repeat: false,
		};
		expect(commandForKeyPress(press, ["global"], keyBindings())).toBe("git.pullLatest");
		expect(runCommandHandlers("git.pullLatest")).toBe(true);

		await waitFor(() => expect(pull).toHaveBeenCalledWith(workspaceId));
	});

	it("shows the up-to-date toast when a pull finds nothing new", async () => {
		vi.spyOn(container.services.git, "pull").mockResolvedValue(ok("up_to_date"));
		renderPanel();

		fireEvent.click(screen.getByRole("button", { name: /Pull latest/ }));

		await waitFor(() => expect(state.toast).toHaveBeenCalledWith(PULL_UP_TO_DATE_MESSAGE));
	});

	it("shows the pulled-latest toast after a fast-forward", async () => {
		vi.spyOn(container.services.git, "pull").mockResolvedValue(ok("fast_forwarded"));
		renderPanel();

		fireEvent.click(screen.getByRole("button", { name: /Pull latest/ }));

		await waitFor(() => expect(state.toast).toHaveBeenCalledWith(PULLED_LATEST_MESSAGE));
	});

	it("shows the failure toast when the pull fails", async () => {
		const error = { code: "git_failed", message: "fatal: not a git repository" };
		vi.spyOn(container.services.git, "pull").mockResolvedValue({ ok: false, error });
		renderPanel();

		fireEvent.click(screen.getByRole("button", { name: /Pull latest/ }));

		await waitFor(() => expect(state.toastError).toHaveBeenCalledWith("Couldn't pull", error));
	});
});
