/**
 * @feature DATA-01 Lookups across service stores
 * Owns: answering "which folder, branch and remote belong to this workspace or chat" from the
 * service stores that are already in memory, so services do not each repeat the join.
 * Behaviour: services-map.md 1.4 (the workspace service's dependency object: path, branch,
 * target, repository root), frontend.md 6 (what the sidecar needs to place a chat on disk).
 * Must handle: an unknown workspace, chat or repository returns an Err with a stable code and
 * never throws; the remote name is the part of the target branch before the first slash (for
 * example "origin" from "origin/main"); a target branch with no slash falls back to "origin";
 * the lookups read the stores when called, never at construction, because the services are built
 * in dependency order and some stores do not exist yet.
 * Our design choice: the remote is derived from `target_branch` because migration 0001 has no
 * remote column. Stores are passed as getters so construction order does not matter.
 * One home for the remote (DATA-09): the repo setting `remote_name` ("Remote origin" on the Git
 * page) is the only source. `remoteNameOf` reads `RepoConfig.remoteName` from the repo store; an
 * empty name means "origin". Once it is built, `gitContext` and `prContext` take their remote
 * from it and `remoteOf` goes away. A repo whose config is not loaded yet returns the error code
 * `repo_config_unloaded`, never a guessed name.
 * Test first: gitContext for a workspace targeting "upstream/dev" has remote "upstream".
 */
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import {
	appError,
	err,
	notImplemented,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import type { StoreApi } from "zustand/vanilla";
import type { Repo, Workspace } from "./model.ts";
import type { WorkspaceGitContext } from "./services/git.ts";
import type { PrWorkspaceContext } from "./services/github.ts";
import type { RepoState } from "./services/repo.ts";
import type { SessionsState } from "./services/sessions.ts";
import type { WorkspaceState } from "./services/workspace.ts";

export interface LookupSources {
	workspaces: () => StoreApi<WorkspaceState>;
	repos: () => StoreApi<RepoState>;
	sessions: () => StoreApi<SessionsState>;
}

export interface Lookups {
	workspace(id: WorkspaceId): Result<Workspace>;
	repoOf(id: WorkspaceId): Result<Repo>;
	workspaceOfSession(id: SessionId): Result<Workspace>;
	/** The git remote of the workspace's repository, from the repo setting (DATA-09). */
	remoteNameOf(id: WorkspaceId): Result<string>;
	gitContext(id: WorkspaceId): Result<WorkspaceGitContext>;
	prContext(id: WorkspaceId): Result<PrWorkspaceContext>;
	/** What the sidecar needs to place a chat on disk. */
	sidecarContext(id: WorkspaceId, userPreferences: string | undefined): Result<WorkspaceContext>;
	/** Folder of the workspace a chat belongs to. */
	workspacePathOfSession(id: SessionId): Result<string>;
	/** Workspace folder plus linked folders: where file tools may read and write. */
	allowedRoots(id: WorkspaceId): Result<string[]>;
}

export const remoteOf = (targetBranch: string): string => {
	const slash = targetBranch.indexOf("/");
	return slash > 0 ? targetBranch.slice(0, slash) : "origin";
};

export function createLookups(sources: LookupSources): Lookups {
	const workspace = (id: WorkspaceId): Result<Workspace> => {
		const found = sources.workspaces().getState().workspacesById[id];
		return found === undefined
			? err(appError("workspace_unknown", "That workspace no longer exists."))
			: ok(found);
	};
	const repoOf = (id: WorkspaceId): Result<Repo> => {
		const ws = workspace(id);
		if (!ws.ok) return ws;
		const repo = sources.repos().getState().reposById[ws.value.repoId];
		return repo === undefined
			? err(appError("repo_unknown", "That project was removed."))
			: ok(repo);
	};
	const workspaceOfSession = (id: SessionId): Result<Workspace> => {
		const session = sources.sessions().getState().sessions[id];
		return session === undefined
			? err(appError("session_unknown", "That chat no longer exists."))
			: workspace(session.workspaceId);
	};
	return {
		workspace,
		repoOf,
		workspaceOfSession,
		remoteNameOf: () => notImplemented("DATA-09"),
		gitContext(id) {
			const ws = workspace(id);
			if (!ws.ok) return ws;
			const repo = repoOf(id);
			if (!repo.ok) return repo;
			return ok({
				workspaceId: id,
				workspacePath: ws.value.path,
				repoRootPath: repo.value.rootPath,
				remote: remoteOf(ws.value.targetBranch),
				targetBranch: ws.value.targetBranch,
				branch: ws.value.branch,
			});
		},
		prContext(id) {
			const ws = workspace(id);
			if (!ws.ok) return ws;
			return ok({
				workspaceId: id,
				workspacePath: ws.value.path,
				branch: ws.value.branch,
				remote: remoteOf(ws.value.targetBranch),
				prNumber: ws.value.prNumber,
			});
		},
		sidecarContext(id, userPreferences) {
			const ws = workspace(id);
			if (!ws.ok) return ws;
			const repo = repoOf(id);
			if (!repo.ok) return repo;
			return ok({
				workspaceId: id,
				workspaceName: ws.value.directoryName,
				workspacePath: ws.value.path,
				repoRootPath: repo.value.rootPath,
				targetBranch: ws.value.targetBranch,
				placeholderBranch: ws.value.branchIsPlaceholder,
				port: ws.value.port,
				...(userPreferences === undefined ? {} : { userPreferences }),
			});
		},
		workspacePathOfSession(id) {
			const ws = workspaceOfSession(id);
			return ws.ok ? ok(ws.value.path) : ws;
		},
		allowedRoots(id) {
			const ws = workspace(id);
			return ws.ok ? ok([ws.value.path, ...ws.value.linkedPaths]) : ws;
		},
	};
}

/**
 * The config a new chat starts with: the default model and effort from settings, plan mode and
 * tool approvals from settings, and the workspace's linked folders as additional directories.
 */
export function defaultSessionConfig(
	workspaceId: WorkspaceId,
	lookups: Lookups,
	setting: <T>(key: string) => T,
): Result<SessionConfig> {
	const workspace = lookups.workspace(workspaceId);
	if (!workspace.ok) return workspace;
	const model = setting<string>("default_model");
	const effort = setting<string>("default_claude_effort_level") || "high";
	return ok({
		agent: "claude",
		model: model.length > 0 ? model : "default",
		effort: effort as SessionConfig["effort"],
		fastMode: setting<boolean>("default_fast_mode"),
		planMode: setting<boolean>("default_plan_mode"),
		requireToolApproval: setting<boolean>("tool_approvals_enabled"),
		additionalDirectories: workspace.value.linkedPaths,
		appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
	});
}
