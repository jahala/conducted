import type { FileChange, LiveState } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContainer, type TestContainer } from "../test/container.ts";
import { ServicesProvider } from "./context.tsx";
import { sampleWorkspace } from "./db/test-fixtures.ts";
import type { ChangesSnapshot } from "./git/status.ts";
import { useWorkspaceStatus } from "./hooks.ts";
import type { PullRequest, Session, Workspace, WorkspaceStatus } from "./model.ts";
import type { WorkspacePrEntry } from "./services/github.ts";

const workspaceId = "ws-1" as WorkspaceId;
const sessionId = "chat-1" as SessionId;

const idle: LiveState = {
	status: "idle",
	pendingSteerIds: [],
	backgroundTasks: [],
	fastModeAvailable: true,
};

const working: LiveState = { ...idle, status: "working" };

function renderStatus() {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	return renderHook(() => useWorkspaceStatus(workspaceId), { wrapper });
}

function setWorkspace(state: Workspace["state"]): void {
	test.container.services.workspace.store.setState({
		workspacesById: { [workspaceId]: { ...sampleWorkspace, id: workspaceId, state } },
	});
}

function setSettingUp(running: boolean): void {
	test.container.services.workspace.store.setState({
		setup: { [workspaceId]: running ? "running" : "idle" },
	});
}

function setChat(
	liveState: LiveState,
	options: { closed?: boolean; cancelling?: boolean } = {},
): void {
	test.container.services.sessions.store.setState({
		sessions: {
			[sessionId]: {
				closedAt: options.closed === true ? 1 : null,
				config: {
					agent: "claude",
					model: "",
					effort: "high",
					fastMode: false,
				} as Session["config"],
			} as Session,
		},
		byWorkspace: { [workspaceId]: [sessionId] },
		liveStates: { [sessionId]: liveState },
		cancelling: { [sessionId]: options.cancelling === true },
	});
}

function snapshot(overrides: Partial<ChangesSnapshot> = {}): ChangesSnapshot {
	return {
		depth: "full",
		branch: "feature",
		mergeBase: "abc123",
		mergeBaseError: null,
		files: [],
		conflictedPaths: [],
		untrackedTruncated: false,
		uncommittedFiles: 0,
		changedFiles: 0,
		operation: "none",
		commits: [],
		sync: { ahead: 0, behind: 0, rewritten: false, hasUpstream: true },
		behindTarget: 0,
		...overrides,
	};
}

function changedFile(path: string): FileChange {
	return {
		path,
		status: "modified",
		linesAdded: 1,
		linesRemoved: 0,
		binary: false,
	};
}

function setGit(value: ChangesSnapshot | null): void {
	test.container.services.git.store.setState({
		byWorkspace: { [workspaceId]: { snapshot: value, error: null, refreshedAt: 0 } },
	});
}

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
	return {
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
		...overrides,
	};
}

function setPullRequest(
	value: PullRequest | null,
	unavailable: WorkspacePrEntry["unavailable"] = "none",
): void {
	test.container.services.github.store.setState({
		byWorkspace: { [workspaceId]: { pullRequest: value, unavailable, fetchedAt: 0 } },
	});
}

function label(status: WorkspaceStatus | null): string {
	return status === null ? "none" : `${status.kind}:${status.label}`;
}

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	test.close();
});

describe("WS-09 useWorkspaceStatus", () => {
	it("lets a working chat outrank a merged pull request", () => {
		setWorkspace("ready");
		setChat(working);
		setGit(snapshot());
		setPullRequest(pullRequest({ state: "merged" }));

		const { result } = renderStatus();
		expect(label(result.current)).toBe("agent:working");
	});

	it("labels the git state from the git and pull request entries", () => {
		setWorkspace("ready");
		setChat(idle);
		setGit(snapshot());
		setPullRequest(pullRequest({ state: "merged" }));

		const { result } = renderStatus();
		expect(label(result.current)).toBe("git:merged");
	});

	it("follows each store after the first render", () => {
		setWorkspace("ready");
		setChat(idle);
		setGit(snapshot());

		const { result } = renderStatus();
		expect(label(result.current)).toBe("git:clean");

		act(() => {
			test.container.services.sessions.store.setState({ liveStates: { [sessionId]: working } });
		});
		expect(label(result.current)).toBe("agent:working");

		act(() => {
			setWorkspace("archived");
		});
		expect(result.current).toBeNull();
	});

	it("reports the lifecycle labels from the workspace state", () => {
		setWorkspace("initializing");
		setChat(idle);
		setGit(snapshot());

		const { result } = renderStatus();
		expect(label(result.current)).toBe("lifecycle:initializing");

		act(() => {
			setSettingUp(true);
		});
		expect(label(result.current)).toBe("lifecycle:setting_up");

		act(() => {
			setWorkspace("failed");
		});
		expect(label(result.current)).toBe("lifecycle:failed");
	});

	it("ignores closed chats", () => {
		setWorkspace("ready");
		setChat(working, { closed: true });
		setGit(snapshot());
		setPullRequest(pullRequest({ state: "merged" }));

		const { result } = renderStatus();
		expect(label(result.current)).toBe("git:merged");
	});

	it("shows changes and never claims clean while git state has not loaded", () => {
		setWorkspace("ready");
		setChat(idle);

		const withoutGit = renderStatus();
		expect(withoutGit.result.current).toBeNull();

		act(() => {
			setGit(
				snapshot({ files: [changedFile("src/app.ts")], uncommittedFiles: 1, changedFiles: 1 }),
			);
		});
		expect(label(withoutGit.result.current)).toBe("git:changes");
	});

	it("reads the status from the git service's own counts", () => {
		setWorkspace("ready");
		setChat(idle);
		// A working-tree change is enough for "changes" even when the file list itself is empty.
		setGit(snapshot({ files: [], uncommittedFiles: 1, changedFiles: 0 }));

		const { result } = renderStatus();
		expect(label(result.current)).toBe("git:changes");
	});

	it("returns null for an unknown workspace", () => {
		const { result } = renderStatus();
		expect(result.current).toBeNull();
	});
});
