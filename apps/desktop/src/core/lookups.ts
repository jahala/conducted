/**
 * @feature DATA-01 Lookups across service stores
 * Owns: answering "which folder, branch and remote belong to this workspace or chat" from the
 * service stores that are already in memory, so services do not each repeat the join.
 * Behaviour: services-map.md 1.4 (the workspace service's dependency object: path, branch,
 * target, repository root), frontend.md 6 (what the sidecar needs to place a chat on disk).
 * Must handle: an unknown workspace, chat or repository returns an Err with a stable code and
 * never throws; a repository whose config is not loaded yet returns `repo_config_unloaded`
 * rather than a guessed remote; an empty or whitespace-only remote name means "origin"; the
 * lookups read the stores when called, never at construction, because the services are built in
 * dependency order and some stores do not exist yet.
 * Our design choice: the repo setting `remote_name` ("Remote origin" on the Git page) is the one
 * home of a repository's remote (DATA-09), because the settings files are where the user sets it.
 * `remoteNameOf` reads `RepoConfig.remoteName` from the repo store, and `gitContext` and
 * `prContext` take their remote from it, so every git and pull request caller uses the same name.
 * `remoteNameOf` and the workspace service apply the same rule (`remoteNameFromConfig`): empty
 * means "origin", and a name git could read as an option is refused.
 * Stores are passed as getters so construction order does not matter.
 * Test first: a repo whose config names "upstream" gives "upstream" to gitContext and prContext,
 * even when the workspace's target branch names "origin/dev".
 */
import { type SessionConfig, type WorkspaceContext, zEffort } from "@conducted/protocol";
import {
	appError,
	err,
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
import { remoteNameFromConfig, type WorkspaceState } from "./services/workspace.ts";

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
	/** Fails with `repo_config_unloaded` until the repository's config is loaded. */
	prContext(id: WorkspaceId): Result<PrWorkspaceContext>;
	/** What the sidecar needs to place a chat on disk. */
	sidecarContext(id: WorkspaceId, userPreferences: string | undefined): Result<WorkspaceContext>;
	/** Folder of the workspace a chat belongs to. */
	workspacePathOfSession(id: SessionId): Result<string>;
	/** Workspace folder plus linked folders: where file tools may read and write. */
	allowedRoots(id: WorkspaceId): Result<string[]>;
}

/** The config read has not finished, so no remote name can be known yet. */
function repoConfigUnloaded(): Result<never> {
	return err(
		appError(
			"repo_config_unloaded",
			"The repository settings are still loading. Try again in a moment.",
		),
	);
}

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
	const remoteNameOf = (id: WorkspaceId): Result<string> => {
		const ws = workspace(id);
		if (!ws.ok) return ws;
		const config = sources.repos().getState().configs[ws.value.repoId];
		if (config === undefined) return repoConfigUnloaded();
		return remoteNameFromConfig(config);
	};
	return {
		workspace,
		repoOf,
		workspaceOfSession,
		remoteNameOf,
		gitContext(id) {
			const ws = workspace(id);
			if (!ws.ok) return ws;
			const repo = repoOf(id);
			if (!repo.ok) return repo;
			const remote = remoteNameOf(id);
			if (!remote.ok) return remote;
			return ok({
				workspaceId: id,
				workspacePath: ws.value.path,
				repoRootPath: repo.value.rootPath,
				remote: remote.value,
				targetBranch: ws.value.targetBranch,
				branch: ws.value.branch,
			});
		},
		prContext(id) {
			const ws = workspace(id);
			if (!ws.ok) return ws;
			const remote = remoteNameOf(id);
			if (!remote.ok) return remote;
			const config = sources.repos().getState().configs[ws.value.repoId];
			if (config === undefined) return repoConfigUnloaded();
			return ok({
				workspaceId: id,
				workspacePath: ws.value.path,
				branch: ws.value.branch,
				remote: remote.value,
				prNumber: ws.value.prNumber,
				targetBranch: ws.value.targetBranch,
				customPrompt: config.prompts.createPr,
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
	// An empty setting means "Model default", but a chat config needs a level, so it opens at
	// "high" until the protocol can say "the model's own default" (see the findings, CONTRACT).
	const effortSetting = setting<string>("default_claude_effort_level") || "high";
	const effort = zEffort.safeParse(effortSetting);
	if (!effort.success) {
		return err(
			appError(
				"setting_invalid",
				`The default effort level "${effortSetting}" is not one a chat can use. Pick another in Settings.`,
				effort.error,
			),
		);
	}
	return ok({
		agent: "claude",
		model: model.length > 0 ? model : "default",
		effort: effort.data,
		fastMode: setting<boolean>("default_fast_mode"),
		planMode: setting<boolean>("default_plan_mode"),
		requireToolApproval: setting<boolean>("tool_approvals_enabled"),
		additionalDirectories: workspace.value.linkedPaths,
		appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
	});
}
