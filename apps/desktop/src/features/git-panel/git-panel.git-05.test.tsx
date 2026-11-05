/**
 * @feature GIT-05 Commit and push from the git panel
 * Owns: the Commit and push button and Cmd+Shift+Y both reach `git.commitAndPush` for the panel's
 * workspace.
 * Behaviour: services-map.md 3.5 (the app asks the agent to commit and push) and ui-map.md 5.4
 * (Cmd+Shift+Y).
 * Test first: Cmd+Shift+Y maps to `git.commitAndPush` and calls the panel's handler.
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
import "../../test/dom-polyfills.ts";

const workspaceId = "w1" as WorkspaceId;

const state = vi.hoisted(() => ({
	git: { state: "loading" } as Loadable<GitState>,
}));

// GIT-04 owns the git state hook and the header model, so this test supplies both and runs
// everything else over the real container.
vi.mock("../../core/hooks.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../../core/hooks.ts")>();
	return { ...actual, useGitState: () => state.git };
});

vi.mock("../../core/status/git-header.ts", () => ({
	computeGitHeader: () => ({
		kind: "changes",
		title: "Changes",
		tone: "attention",
		action: { id: "commit_and_push", label: "Commit and push", waitingNote: null },
	}),
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
			<GitPanel workspaceId={workspaceId} />
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
});
