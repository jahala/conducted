/**
 * @feature GIT-05 Commit and push from the git panel
 * Owns: the Commit and push button and Cmd+Shift+Y both reach `git.commitAndPush` for the panel's
 * workspace, Cmd+Shift+Y does nothing when the header offers no commit and push action, and a
 * second press (or a click) while the first runs sends the agent nothing more.
 * Behaviour: services-map.md 3.5 (the app asks the agent to commit and push) and ui-map.md 5.4
 * (Cmd+Shift+Y).
 * Test first: Cmd+Shift+Y maps to `git.commitAndPush` and calls the panel's handler when the
 * header offers it; a clean header leaves the git service untouched; two presses while the first
 * is still running call the service once.
 */
import { ok, type Result, type WorkspaceId } from "@conducted/shared";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearCommandHandlers,
	commandForKeyPress,
	keyBindings,
	runCommandHandlers,
} from "../../app/command-dispatcher.ts";
import { AppProviders, createQueryClient } from "../../app/providers.tsx";
import { createShellContainer } from "../../app/shell-test-support.ts";
import type { Loadable } from "../../core/api.ts";
import { ServicesProvider } from "../../core/context.tsx";
import type { GitState } from "../../core/model.ts";
import type { GitHeader } from "../../core/status/git-header.ts";
import "../../test/dom-polyfills.ts";

const workspaceId = "w1" as WorkspaceId;

const state = vi.hoisted(() => ({
	git: { state: "loading" } as Loadable<GitState>,
	header: {
		kind: "changes",
		title: "Changes",
		tone: "attention",
		action: { id: "commit_and_push", label: "Commit and push", waitingNote: null },
	} as GitHeader,
}));

// GIT-04 owns the git state hook and the header model, so this test supplies both and runs
// everything else over the real container.
vi.mock("../../core/hooks.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../core/hooks.ts")>();
	return { ...actual, useGitState: () => state.git };
});

vi.mock("../../core/status/git-header.ts", () => ({
	computeGitHeader: () => state.header,
}));

vi.mock("./changes/ChangesTab.tsx", () => ({ ChangesTab: () => <div>changes body</div> }));
vi.mock("./files/FilesTab.tsx", () => ({ FilesTab: () => <div>files body</div> }));
vi.mock("./checks/ChecksTab.tsx", () => ({ ChecksTab: () => <div>checks body</div> }));

const { GitPanel } = await import("./GitPanel.tsx");

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

let container: ReturnType<typeof createShellContainer>["container"];

beforeEach(() => {
	clearCommandHandlers();
	state.git = { state: "ready", data: gitState() };
	state.header = {
		kind: "changes",
		title: "Changes",
		tone: "attention",
		action: { id: "commit_and_push", label: "Commit and push", waitingNote: null },
	};
	container = createShellContainer().container;
	vi.spyOn(container.services.git, "commitAndPush").mockResolvedValue(ok(undefined));
});

afterEach(() => {
	cleanup();
	clearCommandHandlers();
});

const renderPanel = () =>
	render(
		<ServicesProvider container={container}>
			<AppProviders client={createQueryClient(() => {})}>
				<GitPanel workspaceId={workspaceId} />
			</AppProviders>
		</ServicesProvider>,
	);

describe("GIT-05 git panel commit and push", () => {
	it("sends the Commit and push button to the git service", async () => {
		renderPanel();

		fireEvent.click(screen.getByRole("button", { name: /Commit and push/ }));

		await waitFor(() =>
			expect(container.services.git.commitAndPush).toHaveBeenCalledWith(workspaceId),
		);
	});

	it("maps Cmd+Shift+Y to git.commitAndPush and runs the panel's handler", async () => {
		renderPanel();

		const press = {
			key: "y",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			shiftKey: true,
			isComposing: false,
			repeat: false,
		};
		expect(commandForKeyPress(press, ["global"], keyBindings())).toBe("git.commitAndPush");
		expect(runCommandHandlers("git.commitAndPush")).toBe(true);

		await waitFor(() =>
			expect(container.services.git.commitAndPush).toHaveBeenCalledWith(workspaceId),
		);
	});

	it("sends the agent one message when Cmd+Shift+Y is pressed twice while the first runs", async () => {
		const commit = vi.mocked(container.services.git.commitAndPush);
		let finish: (result: Result<void>) => void = () => {};
		commit.mockReturnValueOnce(
			new Promise<Result<void>>((resolve) => {
				finish = resolve;
			}),
		);
		renderPanel();

		expect(runCommandHandlers("git.commitAndPush")).toBe(true);
		expect(runCommandHandlers("git.commitAndPush")).toBe(true);
		// The header button shares the guard with the shortcut.
		fireEvent.click(screen.getByRole("button", { name: /Commit and push/ }));
		expect(commit).toHaveBeenCalledTimes(1);

		// Once the first call has finished, the next press runs again.
		await act(async () => finish(ok(undefined)));
		await waitFor(() => {
			runCommandHandlers("git.commitAndPush");
			expect(commit).toHaveBeenCalledTimes(2);
		});
	});

	it("does not ask the agent to commit and push when the header has no such action", () => {
		state.header = { kind: "clean", title: "No changes", tone: "neutral", action: null };
		renderPanel();

		expect(runCommandHandlers("git.commitAndPush")).toBe(true);
		expect(container.services.git.commitAndPush).not.toHaveBeenCalled();
	});
});
