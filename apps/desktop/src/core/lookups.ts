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
import {
	type Effort,
	type SessionConfig,
	type WorkspaceContext,
	zClaudeOutputStyle,
	zCodexPersonality,
	zEffort,
} from "@conducted/protocol";
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
import { getSettingDef } from "./registries/settings.ts";
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
			const repo = repoOf(id);
			if (!repo.ok) return repo;
			const remote = remoteNameOf(id);
			if (!remote.ok) return remote;
			const config = sources.repos().getState().configs[ws.value.repoId];
			if (config === undefined) return repoConfigUnloaded();
			return ok({
				workspaceId: id,
				workspacePath: ws.value.path,
				repoRootPath: repo.value.rootPath,
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
 * Reads one effort setting, refusing a value a chat cannot use. The key names the setting, so the
 * error points at the one the user must fix. An empty value means "the model's own default", which
 * only the caller can decide how to represent.
 */
export function parseEffortSetting(key: string, value: string): Result<Effort> {
	const parsed = zEffort.safeParse(value);
	if (parsed.success) return ok(parsed.data);
	const title = getSettingDef(key)?.title ?? key;
	return err(
		appError(
			"setting_invalid",
			`The effort level "${value}" for "${title}" is not one a chat can use. Pick another in Settings.`,
			parsed.error,
		),
	);
}

/**
 * The config a new chat starts with: the default model and effort from settings, plan mode and
 * tool approvals from settings, the workspace's linked folders as additional directories, and the
 * chat options the settings offer (AGENT-16): Claude's output style and Chrome switch, Codex's
 * personality and tool approval policy. Each runner reads only its own fields, so a chat that later
 * changes agent keeps them. Settings are read when the chat is created, so a change reaches new
 * chats and leaves existing ones as they are. Codex's sandbox has no setting; the runner uses full
 * access, as Conductor does.
 * Our design choice: the Codex tool approval setting "Always approve" is Codex's `never` policy;
 * "Default" sends no policy, so Codex follows the tool approvals switch.
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
	const effort = parseEffortSetting("default_claude_effort_level", effortSetting);
	if (!effort.ok) return effort;
	const options = chatOptionSettings(setting);
	if (!options.ok) return options;
	return ok({
		agent: "claude",
		model: model.length > 0 ? model : "default",
		effort: effort.value,
		fastMode: setting<boolean>("default_fast_mode"),
		planMode: setting<boolean>("default_plan_mode"),
		requireToolApproval: setting<boolean>("tool_approvals_enabled"),
		additionalDirectories: workspace.value.linkedPaths,
		appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
		...options.value,
	});
}

/**
 * The AGENT-16 chat options from settings. A setting at its "model default" value adds nothing; a
 * value no chat can use (for example one typed into settings.toml) is an error that names the
 * setting, never a quiet default.
 */
function chatOptionSettings(
	setting: <T>(key: string) => T,
): Result<
	Pick<
		SessionConfig,
		"claudeOutputStyle" | "claudeInChrome" | "codexPersonality" | "codexApprovalPolicy"
	>
> {
	const styleValue = setting<string>("default_claude_personality");
	const outputStyle = zClaudeOutputStyle.safeParse(styleValue);
	if (!outputStyle.success) return optionInvalid("default_claude_personality", styleValue);
	const personalityValue = setting<string>("default_codex_personality");
	const personality =
		personalityValue === "" ? undefined : zCodexPersonality.safeParse(personalityValue);
	if (personality !== undefined && !personality.success) {
		return optionInvalid("default_codex_personality", personalityValue);
	}
	return ok({
		...(outputStyle.data === "default" ? {} : { claudeOutputStyle: outputStyle.data }),
		...(setting<boolean>("chrome_mode_enabled") ? { claudeInChrome: true } : {}),
		...(personality === undefined ? {} : { codexPersonality: personality.data }),
		...(setting<string>("codex_tool_approval_policy") === "always_approve"
			? { codexApprovalPolicy: "never" as const }
			: {}),
	});
}

function optionInvalid(key: string, value: string): Result<never> {
	const title = getSettingDef(key)?.title ?? key;
	return err(
		appError(
			"setting_invalid",
			`The value "${value}" for "${title}" is not one a chat can use. Pick another in Settings.`,
		),
	);
}
