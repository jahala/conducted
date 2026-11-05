import type { RepoId, SessionId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { createLookups, remoteOf } from "./lookups.ts";
import type { Repo, RepoConfig, Session, Workspace } from "./model.ts";
import type { RepoState } from "./services/repo.ts";
import type { SessionsState } from "./services/sessions.ts";
import type { WorkspaceState } from "./services/workspace.ts";

const repo: Repo = {
	id: "r1" as RepoId,
	name: "app",
	rootPath: "/repos/app",
	remoteUrl: null,
	defaultBranch: "main",
	icon: null,
	displayOrder: 0,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
};
const workspace: Workspace = {
	id: "w1" as WorkspaceId,
	repoId: repo.id,
	directoryName: "oslo",
	path: "/ws/oslo",
	branch: "me/oslo",
	branchIsPlaceholder: true,
	displayName: null,
	targetBranch: "upstream/dev",
	state: "ready",
	kanbanStatus: "in_progress",
	port: 55_000,
	pinnedAt: null,
	notes: null,
	linkedPaths: ["/extra"],
	prNumber: 7,
	prTitle: null,
	prDescription: null,
	archiveCommit: null,
	archivedAt: null,
	activeSessionId: null,
	filesCopied: null,
	lastActivityAt: 1,
	createdAt: 1,
	updatedAt: 1,
};

const repoConfig = (createPr: string | null): RepoConfig => ({
	setupScript: null,
	runScripts: [],
	runMode: "concurrent",
	archiveScript: null,
	copyFiles: [],
	previewUrlTemplate: null,
	spotlightTesting: false,
	autoRunAfterSetup: false,
	remoteName: null,
	prompts: {
		general: null,
		codeReview: null,
		createPr,
		fixErrors: null,
		resolveConflicts: null,
		renameBranch: null,
	},
});

const makeLookups = (withRepo = true, configs: Record<string, RepoConfig> = {}) =>
	createLookups({
		workspaces: () =>
			createStore<WorkspaceState>(() => ({
				loaded: true,
				workspacesById: { [workspace.id]: workspace },
				setup: {},
				archiving: {},
			})),
		repos: () =>
			createStore<RepoState>(() => ({
				loaded: true,
				reposById: withRepo ? { [repo.id]: repo } : {},
				order: [],
				configs,
			})),
		sessions: () =>
			createStore<SessionsState>(() => ({
				loaded: true,
				sessions: { s1: { id: "s1" as SessionId, workspaceId: workspace.id } as Session },
				byWorkspace: {},
				liveStates: {},
				cancelling: {},
				events: {},
				progress: {},
				sending: {},
				openInteractions: {},
				viewingSessionId: null,
			})),
	});

describe("remoteOf", () => {
	it("takes the part before the first slash, else origin", () => {
		expect(remoteOf("upstream/dev")).toBe("upstream");
		expect(remoteOf("main")).toBe("origin");
	});
});

describe("createLookups", () => {
	it("builds the git context from the stores", () => {
		const result = makeLookups().gitContext("w1" as WorkspaceId);
		expect(result).toEqual({
			ok: true,
			value: {
				workspaceId: "w1",
				workspacePath: "/ws/oslo",
				repoRootPath: "/repos/app",
				remote: "upstream",
				targetBranch: "upstream/dev",
				branch: "me/oslo",
			},
		});
	});
	it("returns error values for unknown ids", () => {
		const lookups = makeLookups();
		expect(lookups.workspace("nope" as WorkspaceId)).toMatchObject({
			ok: false,
			error: { code: "workspace_unknown" },
		});
		expect(lookups.workspaceOfSession("nope" as SessionId)).toMatchObject({
			ok: false,
			error: { code: "session_unknown" },
		});
		expect(makeLookups(false).repoOf("w1" as WorkspaceId)).toMatchObject({
			ok: false,
			error: { code: "repo_unknown" },
		});
	});
	it("lists the workspace folder and linked folders as allowed roots", () => {
		expect(makeLookups().allowedRoots("w1" as WorkspaceId)).toEqual({
			ok: true,
			value: ["/ws/oslo", "/extra"],
		});
	});
	it("tells the sidecar about the placeholder branch and port", () => {
		const result = makeLookups().sidecarContext("w1" as WorkspaceId, undefined);
		expect(result).toMatchObject({
			ok: true,
			value: { placeholderBranch: true, port: 55_000, targetBranch: "upstream/dev" },
		});
	});
});

describe("PR-02 custom prompt from the loaded repo config", () => {
	it("returns the repo's Create PR prompt once its config is loaded", () => {
		const result = makeLookups(true, { [repo.id]: repoConfig("Use the release notes.") }).prContext(
			"w1" as WorkspaceId,
		);

		expect(result).toMatchObject({
			ok: true,
			value: { workspaceId: "w1", customPrompt: "Use the release notes." },
		});
	});

	it("refuses to guess a Create PR prompt before the config is loaded", () => {
		const result = makeLookups().prContext("w1" as WorkspaceId);

		expect(result).toMatchObject({
			ok: false,
			error: { code: "repo_config_unloaded" },
		});
	});

	it("keeps an empty Create PR prompt as null", () => {
		const result = makeLookups(true, { [repo.id]: repoConfig(null) }).prContext(
			"w1" as WorkspaceId,
		);

		expect(result).toMatchObject({ ok: true, value: { customPrompt: null } });
	});
});
