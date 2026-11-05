import type { FileChange, LiveState } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Container } from "./container.ts";
import { ServicesProvider } from "./context.tsx";
import type { ChangesSnapshot } from "./git/status.ts";
import { useWorkspaceStatus } from "./hooks.ts";
import type { PullRequest, Session, Workspace, WorkspaceStatus } from "./model.ts";
import { GitService, type GitServiceDeps } from "./services/git.ts";
import { GithubService, type GithubServiceDeps, type WorkspacePrEntry } from "./services/github.ts";
import { SessionsService, type SessionsServiceDeps } from "./services/sessions.ts";
import { WorkspaceService, type WorkspaceServiceDeps } from "./services/workspace.ts";

const workspaceId = "ws-1" as WorkspaceId;
const sessionId = "chat-1" as SessionId;

const idle: LiveState = {
	status: "idle",
	pendingSteerIds: [],
	backgroundTasks: [],
	fastModeAvailable: true,
};

const working: LiveState = { ...idle, status: "working" };

function makeServices() {
	return {
		workspace: new WorkspaceService({} as WorkspaceServiceDeps),
		sessions: new SessionsService({} as SessionsServiceDeps),
		git: new GitService({} as GitServiceDeps),
		github: new GithubService({} as GithubServiceDeps),
	};
}

type TestServices = ReturnType<typeof makeServices>;

function renderStatus(services: TestServices) {
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={{ services } as unknown as Container}>{children}</ServicesProvider>
	);
	return renderHook(() => useWorkspaceStatus(workspaceId), { wrapper });
}

function setWorkspace(services: TestServices, state: Workspace["state"]): void {
	services.workspace.store.setState({
		workspacesById: { [workspaceId]: { state } as unknown as Workspace },
	});
}

function setSettingUp(services: TestServices, running: boolean): void {
	services.workspace.store.setState({
		setup: { [workspaceId]: running ? "running" : "idle" },
	});
}

function setChat(
	services: TestServices,
	liveState: LiveState,
	options: { closed?: boolean; cancelling?: boolean } = {},
): void {
	services.sessions.store.setState({
		sessions: {
			[sessionId]: { closedAt: options.closed === true ? 1 : null } as Session,
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

function setGit(services: TestServices, value: ChangesSnapshot | null): void {
	services.git.store.setState({
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
	services: TestServices,
	value: PullRequest | null,
	unavailable: WorkspacePrEntry["unavailable"] = "none",
): void {
	services.github.store.setState({
		byWorkspace: { [workspaceId]: { pullRequest: value, unavailable, fetchedAt: 0 } },
	});
}

function label(status: WorkspaceStatus | null): string {
	return status === null ? "none" : `${status.kind}:${status.label}`;
}

afterEach(cleanup);

describe("WS-09 useWorkspaceStatus", () => {
	it("lets a working chat outrank a merged pull request", () => {
		const services = makeServices();
		setWorkspace(services, "ready");
		setChat(services, working);
		setGit(services, snapshot());
		setPullRequest(services, pullRequest({ state: "merged" }));

		const { result } = renderStatus(services);
		expect(label(result.current)).toBe("agent:working");
	});

	it("labels the git state from the git and pull request entries", () => {
		const services = makeServices();
		setWorkspace(services, "ready");
		setChat(services, idle);
		setGit(services, snapshot());
		setPullRequest(services, pullRequest({ state: "merged" }));

		const { result } = renderStatus(services);
		expect(label(result.current)).toBe("git:merged");
	});

	it("follows each store after the first render", () => {
		const services = makeServices();
		setWorkspace(services, "ready");
		setChat(services, idle);
		setGit(services, snapshot());

		const { result } = renderStatus(services);
		expect(label(result.current)).toBe("git:clean");

		act(() => {
			services.sessions.store.setState({ liveStates: { [sessionId]: working } });
		});
		expect(label(result.current)).toBe("agent:working");

		act(() => {
			setWorkspace(services, "archived");
		});
		expect(result.current).toBeNull();
	});

	it("reports the lifecycle labels from the workspace state", () => {
		const services = makeServices();
		setWorkspace(services, "initializing");
		setChat(services, idle);
		setGit(services, snapshot());

		const { result } = renderStatus(services);
		expect(label(result.current)).toBe("lifecycle:initializing");

		act(() => {
			setSettingUp(services, true);
		});
		expect(label(result.current)).toBe("lifecycle:setting_up");

		act(() => {
			setWorkspace(services, "failed");
		});
		expect(label(result.current)).toBe("lifecycle:failed");
	});

	it("ignores closed chats", () => {
		const services = makeServices();
		setWorkspace(services, "ready");
		setChat(services, working, { closed: true });
		setGit(services, snapshot());
		setPullRequest(services, pullRequest({ state: "merged" }));

		const { result } = renderStatus(services);
		expect(label(result.current)).toBe("git:merged");
	});

	it("shows changes and never claims clean while git state has not loaded", () => {
		const services = makeServices();
		setWorkspace(services, "ready");
		setChat(services, idle);

		const withoutGit = renderStatus(services);
		expect(withoutGit.result.current).toBeNull();

		act(() => {
			setGit(
				services,
				snapshot({ files: [changedFile("src/app.ts")], uncommittedFiles: 1, changedFiles: 1 }),
			);
		});
		expect(label(withoutGit.result.current)).toBe("git:changes");
	});

	it("reads the status from the git service's own counts", () => {
		const services = makeServices();
		setWorkspace(services, "ready");
		setChat(services, idle);
		// A working-tree change is enough for "changes" even when the file list itself is empty.
		setGit(services, snapshot({ files: [], uncommittedFiles: 1, changedFiles: 0 }));

		const { result } = renderStatus(services);
		expect(label(result.current)).toBe("git:changes");
	});

	it("returns null for an unknown workspace", () => {
		const services = makeServices();
		const { result } = renderStatus(services);
		expect(result.current).toBeNull();
	});
});
