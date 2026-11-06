/**
 * @feature REV-05 AI code review in a new chat
 * Owns: the Git panel's part in starting a review: the Cmd+Shift+R command reaches the Review
 * button's action.
 * Behaviour: ui-map.md 3.6 (Review button, tooltip shortcut Cmd+Shift+R).
 * Test first: dispatching review.start while the panel is mounted calls requestAiReview with no
 * extra instructions.
 */
import type { WorkspaceId } from "@conducted/shared";
import { cleanup, render as renderDom } from "@testing-library/react";
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
import "../../test/dom-polyfills.ts";

const state = vi.hoisted(() => ({
	git: { state: "loading" } as Loadable<GitState>,
	requestAiReview: vi.fn(),
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
		pullRequests: { create: vi.fn(), requestAiReview: state.requestAiReview },
		files: { open: vi.fn() },
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

const gitState: GitState = {
	branch: "feat",
	uncommittedFiles: 0,
	changedFiles: 2,
	linesAdded: 10,
	linesRemoved: 2,
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
	state.requestAiReview.mockResolvedValue({ ok: true, value: undefined });
});

afterEach(() => {
	cleanup();
	clearCommandHandlers();
	test?.close();
	test = undefined;
});

describe("REV-05 review shortcut", () => {
	it("starts a review with no extra instructions when Cmd+Shift+R is dispatched", async () => {
		render(<GitPanel workspaceId={"w1" as WorkspaceId} />);
		const press = {
			key: "r",
			metaKey: true,
			ctrlKey: false,
			altKey: false,
			shiftKey: true,
			isComposing: false,
			repeat: false,
		};

		expect(commandForKeyPress(press, ["global"], keyBindings())).toBe("review.start");
		expect(runCommandHandlers("review.start")).toBe(true);
		await vi.waitFor(() => expect(state.requestAiReview).toHaveBeenCalledWith("w1", null));
	});
});
