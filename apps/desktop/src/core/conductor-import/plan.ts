/**
 * @feature APP-17 The import's plan: Conductor's rows in, our rows and what stays behind out
 * Owns: `planConductorImport`, the pure step that turns a snapshot of Conductor's database, the
 * repository folders it names and the rows Conducted already has into the rows to write, the
 * values to move into the Keychain, the settings files to write and the dry run's lists;
 * `conductorDatabasePath`, where Conductor keeps its database.
 * Behaviour: docs/plans/migrate-from-conductor.md ("What comes over", safety rules 5 and 7);
 * services-map.md 2.4.1 (workspace states: Conductor deletes failed and unfinished local
 * workspaces at start and treats `setting_up` as ready; `manual_status ?? derived_status`, with an
 * unknown status read as in progress), 2.4.5 and 5A.7 (review comments: GitHub ids, sources and
 * locations), 4.2.8 (env_vars scopes and contexts), 5B.5 (favourite models).
 * Must handle: every Conductor id kept as our id, so a second import finds what the first brought
 * (rule 7) and our GitHub sync updates an imported GitHub comment instead of adding a copy; an id
 * that could not be a file or ref name is left out; a project Conducted already has (same id or
 * same folder) is reused, never written twice; a project whose folder is gone, a cloud workspace,
 * a workspace Conductor would delete at start and a live workspace whose folder is not one of the
 * repository's worktrees are left out, each with its reason; an archived workspace keeps its
 * archived state; a chat or comment whose workspace stays behind stays behind too; at most four
 * favourites, as the model picker keeps; a setting or variable Conducted already has is kept.
 * Our design choice: an imported branch is never a placeholder, so Conducted never renames a branch
 * Conductor's workspace still uses (D124). An imported workspace has no setup log path, because
 * Conductor's log lives in Conductor's folder and removing the workspace would remove it.
 * Test first: a workspace whose folder is not among the repository's worktrees is left out with
 * the reason.
 */
import {
	type Host,
	LOCAL_HOST,
	type SessionConfig,
	zCodexPersonality,
	zEffort,
} from "@conducted/protocol";
import type {
	AgentKind,
	CommentId,
	RepoId,
	SectionId,
	SessionId,
	WorkspaceId,
} from "@conducted/shared";
import type { ConductorSecretMove, ConductorSnapshot } from "../../platform/platform.ts";
import { localSettingsFile, sharedSettingsFile } from "../app-paths.ts";
import type { EnvVar } from "../db/env-vars.ts";
import type { WorkspaceInsert } from "../db/workspaces.ts";
import { type FavoriteModel, MAX_FAVORITES } from "../favorite-model.ts";
import type { WorktreeEntry } from "../git/status.ts";
import type {
	DiffComment,
	KanbanStatus,
	Repo,
	ReviewCommentState,
	Section,
	Session,
	WorkspaceState,
} from "../model.ts";
import type { SettingValue } from "../registries/settings.ts";
import { sameFavoriteChoice } from "../services/favorite-models.ts";
import {
	envVarKeychainKey,
	type SettingsFileContents,
	validateEnvVarName,
} from "../services/settings.ts";
import { worktreeFolderFor } from "../services/workspace-creation.ts";
import { isReservedEnvVarName } from "../settings-helpers.ts";
import { NEW_CHAT_EFFORT_FALLBACK, NEW_CHAT_MODEL_FALLBACK } from "../workspace-helpers.ts";
import {
	type ConductorRepo,
	type ConductorRows,
	type ConductorWorkspace,
	conductorTime,
	parseConductorRows,
} from "./conductor-rows.ts";
import {
	conductorNameLines,
	EMPTY_SCRIPTS,
	hasScripts,
	type NameRename,
	type RepoScripts,
	renameConductorNames,
	type SCRIPT_KEYS,
	scriptFileCandidates,
	scriptsOf,
} from "./scripts.ts";
import { mapConductorSetting } from "./settings-map.ts";

/** Where Conductor keeps its database (overview.md, native-and-sidecar-map.md D1). */
export const conductorDatabasePath = (home: string): string =>
	`${home.replace(/\/+$/, "")}/Library/Application Support/com.conductor.app/conductor.db`;

/** The settings key Conductor sets once it has moved repo scripts into its settings files. */
export const CONDUCTOR_SCRIPTS_MIGRATED_KEY = "repo_conductor_config_file_migration_v2_complete";

export const IMPORT_KINDS = [
	"repos",
	"workspaces",
	"chats",
	"reviewComments",
	"sections",
	"favoriteModels",
	"settings",
	"environmentVariables",
	"scripts",
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export interface KindCount {
	/** Rows of this kind in Conductor's database. */
	found: number;
	toImport: number;
	/** Rows a previous import or the user already brought into Conducted. */
	alreadyThere: number;
	leftOut: number;
}

export interface LeftOut {
	kind: ImportKind;
	/** A name the user knows the item by. Never a value of a setting or variable. */
	label: string;
	reason: string;
}

/** A part of an imported item that does not come over, such as a project's icon. */
export interface PartNote {
	kind: ImportKind;
	label: string;
	reason: string;
}

/** Something of Conductor's the import does not bring, counted from the copy. */
export interface NotBrought {
	what: string;
	count: number | null;
	reason: string;
}

export interface ScriptRename extends NameRename {
	repoName: string;
	file: string;
}

export interface ScriptMention {
	repoName: string;
	/** Relative to the repository's folder. */
	file: string;
	line: number;
	name: string;
	newName: string;
}

/** What the dry run shows. It holds names, counts and reasons, never a secret value. */
export interface ImportPreview {
	kinds: Record<ImportKind, KindCount>;
	leftOut: LeftOut[];
	parts: PartNote[];
	notBrought: NotBrought[];
	renames: ScriptRename[];
	scriptMentions: ScriptMention[];
	/** The settings files the import writes, each a new file. */
	files: string[];
}

/** One settings file to write, as a new file, with the scripts it holds. */
export interface SettingsFileWrite {
	path: string;
	repoRootPath: string;
	scope: "shared" | "local";
	scripts: RepoScripts;
}

export interface SectionWrite {
	section: Section;
	createdAt: number;
}

/** Everything the import writes. Workspace ports are chosen when it writes. */
export interface ImportRows {
	repos: Repo[];
	workspaces: Omit<WorkspaceInsert, "port">[];
	sessions: Session[];
	/** Open chat tabs to set once the chats exist. */
	activeSessions: { workspaceId: WorkspaceId; sessionId: SessionId }[];
	diffComments: DiffComment[];
	sections: SectionWrite[];
	favoriteModels: FavoriteModel[];
	settings: { key: string; value: SettingValue }[];
	envVars: EnvVar[];
}

export interface ImportPlan {
	rows: ImportRows;
	secretMoves: ConductorSecretMove[];
	files: SettingsFileWrite[];
	preview: ImportPreview;
}

/** A repository folder Conductor names, as the dry run found it on disk. */
export interface RepoFolder {
	exists: boolean;
	/** `git worktree list` of the repository; null when it could not be listed. */
	worktrees: readonly WorktreeEntry[] | null;
	/** Conductor's `.conductor/settings.toml`, parsed; null when there is none. */
	shared: SettingsFileContents | null;
	/** Conductor's `.conductor/settings.local.toml`, parsed; null when there is none. */
	local: SettingsFileContents | null;
	/** Conductor files of this repository that exist but could not be read, relative. */
	unreadable: string[];
	conductorJson: boolean;
	/** Whether Conducted's own settings files already exist. */
	conductedShared: boolean;
	conductedLocal: boolean;
	/** Text of the repository files the scripts name, by relative path. */
	scriptFiles: Readonly<Record<string, string>>;
}

/** What Conducted already holds, so nothing is written twice. */
export interface ConductedState {
	repos: readonly Repo[];
	workspaces: readonly {
		id: string;
		repoId: string;
		path: string;
		directoryName: string;
		state: WorkspaceState;
	}[];
	sessionIds: ReadonlySet<string>;
	commentIds: ReadonlySet<string>;
	sectionIds: ReadonlySet<string>;
	sectionCount: number;
	favorites: readonly FavoriteModel[];
	settingKeys: ReadonlySet<string>;
	globalEnvVarNames: ReadonlySet<string>;
	/** Keychain keys that already hold a value, among the ones the import would write. */
	keychainKeysInUse: ReadonlySet<string>;
}

/** The agents' model ids, for a favourite that names only its model. Null: the list could not be read. */
export type OfferedModels = Partial<
	Record<"claude" | "codex" | "cursor", readonly string[] | null>
>;

/** The config a new chat starts with (lookups.ts `newChatConfig`); an imported chat starts from it. */
export type ChatDefaults = SessionConfig;

export interface PlanInput {
	snapshot: ConductorSnapshot;
	/** Where Conducted puts workspaces, for an archived workspace whose folder Conductor did not name. */
	workspacesRoot: string;
	conducted: ConductedState;
	/** By Conductor's `root_path`. */
	folders: Readonly<Record<string, RepoFolder>>;
	offeredModels: OfferedModels;
	chatDefaults: ChatDefaults;
	/** The import's own time, for a row whose time Conductor's database does not hold. */
	now: number;
}

/** An id that can be part of a file name or a git ref, as UUIDs and GitHub comment ids are. */
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const basename = (path: string): string => path.replace(/\/+$/, "").split("/").pop() ?? path;

const KANBAN: Readonly<Record<string, KanbanStatus>> = {
	backlog: "backlog",
	"in-progress": "in_progress",
	"in-review": "in_review",
	done: "done",
	canceled: "canceled",
};

const REVIEW_STATES: ReadonlySet<string> = new Set<ReviewCommentState>([
	"draft",
	"pending",
	"ready_for_review",
	"reviewed",
	"hidden",
	"superseded",
]);

const emptyCounts = (): Record<ImportKind, KindCount> =>
	Object.fromEntries(
		IMPORT_KINDS.map((kind) => [kind, { found: 0, toImport: 0, alreadyThere: 0, leftOut: 0 }]),
	) as Record<ImportKind, KindCount>;

const TABLE_KIND: Readonly<Record<string, ImportKind>> = {
	repos: "repos",
	workspaces: "workspaces",
	sessions: "chats",
	diff_comments: "reviewComments",
	navigation_sections: "sections",
	navigation_section_memberships: "sections",
	favorite_models: "favoriteModels",
	settings: "settings",
	env_vars: "environmentVariables",
};

/** Conductor's state as ours, or the reason the workspace stays behind. */
function workspaceState(state: string | null): WorkspaceState | { reason: string } {
	switch (state) {
		case "ready":
		case "setting_up":
			return "ready";
		case "archived":
			return "archived";
		case "initializing":
		case "failed":
			return {
				reason:
					"It never finished setting up, and Conductor removes such workspaces when it starts.",
			};
		case "unstarted":
		case "sleeping":
			return { reason: "It is a cloud workspace on Conductor's servers." };
		default:
			return { reason: "Conductor's database gives it a state Conducted does not know." };
	}
}

function stringList(raw: string | null): string[] | null {
	if (raw === null || raw.trim() === "") return [];
	try {
		const value: unknown = JSON.parse(raw);
		return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
	} catch {
		return null;
	}
}

/** The worktree that is this workspace's folder, or null. */
function worktreeOf(
	workspace: ConductorWorkspace,
	repoRoot: string,
	worktrees: readonly WorktreeEntry[],
): WorktreeEntry | null {
	const own = worktrees.filter((entry) => entry.path.replace(/\/+$/, "") !== repoRoot);
	if (workspace.workspace_path !== null) {
		const exact = own.find((entry) => entry.path === workspace.workspace_path);
		if (exact !== undefined) return exact;
	}
	const named = own.filter((entry) => basename(entry.path) === workspace.directory_name);
	return named.length === 1 ? (named[0] ?? null) : null;
}

function agentOf(type: string | null): AgentKind | { reason: string } {
	// A chat from before Conductor recorded its agent ran Claude, the only agent Conductor had then.
	if (type === null || type === "claude") return "claude";
	if (type === "codex" || type === "cursor") return type;
	if (type === "acp") {
		return {
			reason:
				"Conductor keeps an OpenCode or Pi chat's settings in a form the import does not read yet.",
		};
	}
	return { reason: "Conductor names an agent Conducted does not know." };
}

const effortOf = (raw: string | null): SessionConfig["effort"] => {
	const parsed = zEffort.safeParse(raw);
	return parsed.success ? parsed.data : NEW_CHAT_EFFORT_FALLBACK;
};

interface FavoriteConfig {
	type: string | null;
	model: string | null;
	agent: string | null;
	effortLevel: string | null;
	fastMode: boolean;
}

function favoriteConfig(raw: string | null): FavoriteConfig | null {
	if (raw === null) return null;
	try {
		const value: unknown = JSON.parse(raw);
		if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
		const record = value as Record<string, unknown>;
		const textOf = (key: string): string | null =>
			typeof record[key] === "string" ? (record[key] as string) : null;
		return {
			type: textOf("type"),
			model: textOf("model"),
			agent: textOf("harness") ?? textOf("agent"),
			effortLevel: textOf("effortLevel"),
			fastMode: record.fastMode === true,
		};
	} catch {
		return null;
	}
}

/** Builds the plan. Pure: every fact it needs is in `input`. */
export function planConductorImport(input: PlanInput): ImportPlan {
	const { conducted, now } = input;
	const { rows, unreadable } = parseConductorRows(input.snapshot);
	const kinds = emptyCounts();
	const leftOut: LeftOut[] = [];
	const parts: PartNote[] = [];
	const leave = (kind: ImportKind, label: string, reason: string): void => {
		kinds[kind].leftOut++;
		leftOut.push({ kind, label, reason });
	};
	const already = (kind: ImportKind): void => {
		kinds[kind].alreadyThere++;
	};
	for (const [table, count] of Object.entries(unreadable)) {
		const kind = TABLE_KIND[table];
		if (kind === undefined || count === undefined) continue;
		kinds[kind].found += count;
		kinds[kind].leftOut += count;
		leftOut.push({
			kind,
			label: `${count} ${count === 1 ? "row" : "rows"} of ${table}`,
			reason: "The row's id or a column the import needs is missing or of another type.",
		});
	}
	const timeOr = (value: string | number | null, fallback: number): number =>
		conductorTime(value) ?? fallback;

	// ---- projects
	const repoById = new Map<string, Repo>();
	const newRepos: Repo[] = [];
	const ourRepos = conducted.repos;
	const repoLabel = (repo: ConductorRepo): string =>
		repo.name ?? (repo.root_path === null ? repo.id : basename(repo.root_path));
	for (const repo of rows.repos) {
		kinds.repos.found++;
		const label = repoLabel(repo);
		if (!SAFE_ID.test(repo.id)) {
			leave("repos", label, "Its id cannot be used as a Conducted id.");
			continue;
		}
		const root = repo.root_path?.replace(/\/+$/, "") ?? null;
		if (root === null || !root.startsWith("/")) {
			leave("repos", label, "Conductor names no folder for it.");
			continue;
		}
		const existing =
			ourRepos.find((ours) => ours.id === repo.id) ??
			ourRepos.find((ours) => ours.rootPath.replace(/\/+$/, "") === root);
		if (existing !== undefined) {
			already("repos");
			repoById.set(repo.id, existing);
			continue;
		}
		if (input.folders[root]?.exists !== true) {
			leave("repos", label, "Its folder is not on this Mac.");
			continue;
		}
		const createdAt = timeOr(repo.created_at, now);
		const made: Repo = {
			id: repo.id as RepoId,
			name: label,
			rootPath: root,
			remoteUrl: repo.remote_url,
			defaultBranch: repo.default_branch ?? "main",
			icon: null,
			displayOrder: repo.display_order ?? 0,
			hidden: repo.hidden,
			createdAt,
			updatedAt: timeOr(repo.updated_at, createdAt),
		};
		if (repo.icon !== null) {
			parts.push({
				kind: "repos",
				label,
				reason: "Its icon stays in Conductor; choose it again in the project's settings.",
			});
		}
		newRepos.push(made);
		repoById.set(repo.id, made);
	}
	kinds.repos.toImport = newRepos.length;

	// ---- workspaces
	const usedPaths = new Set(conducted.workspaces.map((workspace) => workspace.path));
	const usedNames = new Set(
		conducted.workspaces.map((workspace) => `${workspace.repoId}\u0000${workspace.directoryName}`),
	);
	const existingWorkspaces = new Map(
		conducted.workspaces.map((workspace) => [workspace.id, workspace]),
	);
	/** Workspaces the chats, comments and sections may point at: imported now or already there. */
	const workspaceTargets = new Map<string, { state: WorkspaceState; label: string }>();
	const conductorWorkspaceLabel = new Map<string, string>();
	const newWorkspaces: Omit<WorkspaceInsert, "port">[] = [];
	const unreadWorkspaces = new Set<string>();
	for (const workspace of rows.workspaces) {
		kinds.workspaces.found++;
		const label = workspace.workspace_name ?? workspace.directory_name ?? workspace.local_id;
		conductorWorkspaceLabel.set(workspace.local_id, label);
		if (!SAFE_ID.test(workspace.local_id)) {
			leave("workspaces", label, "Its id cannot be used as a Conducted id.");
			continue;
		}
		const existing = existingWorkspaces.get(workspace.local_id);
		if (existing !== undefined) {
			already("workspaces");
			workspaceTargets.set(workspace.local_id, { state: existing.state, label });
			continue;
		}
		const cloudHost = workspace.hosting_server_url;
		if (cloudHost !== null && cloudHost !== "" && cloudHost !== "/") {
			leave("workspaces", label, "It is a cloud workspace on Conductor's servers.");
			continue;
		}
		const repo =
			workspace.repository_id === null ? undefined : repoById.get(workspace.repository_id);
		if (repo === undefined) {
			leave("workspaces", label, "Its project does not come over.");
			continue;
		}
		const state = workspaceState(workspace.state);
		if (typeof state !== "string") {
			leave("workspaces", label, state.reason);
			continue;
		}
		const directoryName = workspace.directory_name;
		if (directoryName === null || directoryName === "") {
			leave("workspaces", label, "Conductor names no folder for it.");
			continue;
		}
		let path: string;
		let branch = workspace.branch;
		if (state === "archived") {
			path =
				workspace.workspace_path ??
				worktreeFolderFor(input.workspacesRoot, repo.name, directoryName);
		} else {
			const worktrees = input.folders[repo.rootPath]?.worktrees ?? null;
			if (worktrees === null) {
				leave("workspaces", label, "The project's worktrees could not be listed.");
				continue;
			}
			const worktree = worktreeOf(workspace, repo.rootPath, worktrees);
			if (worktree === null) {
				leave("workspaces", label, "Its folder is not a worktree of the project any more.");
				continue;
			}
			path = worktree.path;
			branch ??= worktree.branch;
		}
		if (branch === null || branch === "") {
			leave("workspaces", label, "Conductor names no branch for it.");
			continue;
		}
		if (usedPaths.has(path)) {
			leave("workspaces", label, "Conducted already has a workspace in its folder.");
			continue;
		}
		const nameKey = `${repo.id}\u0000${directoryName}`;
		if (usedNames.has(nameKey)) {
			leave("workspaces", label, "Conducted already has a workspace of that name in the project.");
			continue;
		}
		usedPaths.add(path);
		usedNames.add(nameKey);
		const linked = stringList(workspace.linked_directory_paths);
		if (linked === null) {
			parts.push({
				kind: "workspaces",
				label,
				reason: "Its linked folders could not be read; link them again.",
			});
		}
		const createdAt = timeOr(workspace.created_at, now);
		const updatedAt = timeOr(workspace.updated_at, createdAt);
		const host: Host = LOCAL_HOST;
		newWorkspaces.push({
			id: workspace.local_id as WorkspaceId,
			repoId: repo.id,
			directoryName,
			path,
			branch,
			branchIsPlaceholder: false,
			displayName: workspace.user_set_workspace_name ? workspace.workspace_name : null,
			targetBranch: workspace.intended_target_branch ?? repo.defaultBranch,
			state,
			kanbanStatus:
				KANBAN[workspace.manual_status ?? workspace.derived_status ?? ""] ?? "in_progress",
			pinnedAt: conductorTime(workspace.pinned_at),
			linkedPaths: linked ?? [],
			prNumber: null,
			prTitle: workspace.pr_title,
			prDescription: workspace.pr_description,
			archiveCommit: workspace.archive_commit,
			archivedAt: null,
			activeSessionId: null,
			filesCopied: workspace.initialization_files_copied,
			host,
			lastActivityAt: timeOr(workspace.last_activity_at, updatedAt),
			createdAt,
			updatedAt,
			setupLogPath: null,
		});
		workspaceTargets.set(workspace.local_id, { state, label });
		if (workspace.unread) unreadWorkspaces.add(workspace.local_id);
	}
	kinds.workspaces.toImport = newWorkspaces.length;

	// ---- chats
	const newSessions: Session[] = [];
	for (const session of rows.sessions) {
		kinds.chats.found++;
		const workspaceLabel =
			session.workspace_id === null
				? "no workspace"
				: (conductorWorkspaceLabel.get(session.workspace_id) ?? session.workspace_id);
		const title = session.title === null || session.title === "Untitled" ? null : session.title;
		const label = title ?? `A chat in ${workspaceLabel}`;
		if (!SAFE_ID.test(session.id)) {
			leave("chats", label, "Its id cannot be used as a Conducted id.");
			continue;
		}
		if (conducted.sessionIds.has(session.id)) {
			already("chats");
			continue;
		}
		const target =
			session.workspace_id === null ? undefined : workspaceTargets.get(session.workspace_id);
		if (target === undefined) {
			leave("chats", label, "Its workspace does not come over.");
			continue;
		}
		if (session.remote_archived_at !== null) {
			leave("chats", label, "It is archived on Conductor's servers.");
			continue;
		}
		const agent = agentOf(session.agent_type);
		if (typeof agent !== "string") {
			leave("chats", label, agent.reason);
			continue;
		}
		const personality = zCodexPersonality.safeParse(session.agent_personality);
		const config: SessionConfig = {
			...input.chatDefaults,
			agent,
			model: session.model ?? NEW_CHAT_MODEL_FALLBACK,
			effort: effortOf(
				agent === "codex" ? session.codex_thinking_level : session.claude_effort_level,
			),
			fastMode: session.fast_mode,
			planMode: session.permission_mode === "plan",
			...(agent === "codex" && personality.success ? { codexPersonality: personality.data } : {}),
		};
		const createdAt = timeOr(session.created_at, now);
		const updatedAt = timeOr(session.updated_at, createdAt);
		newSessions.push({
			id: session.id as SessionId,
			workspaceId: session.workspace_id as WorkspaceId,
			title,
			config,
			agentSessionId: session.claude_session_id,
			forkResumeNativeMessageId: null,
			unreadCount: Math.max(0, session.unread_count ?? 0),
			contextUsedTokens:
				session.context_token_count !== null && session.context_token_count > 0
					? session.context_token_count
					: null,
			queuePausedAt: conductorTime(session.queue_paused_at),
			closedAt: session.is_hidden ? updatedAt : null,
			lastUserMessageAt: conductorTime(session.last_user_message_at),
			createdAt,
			updatedAt,
		});
	}
	kinds.chats.toImport = newSessions.length;
	// A workspace Conductor marks unread shows unread here through its newest chat, as
	// `markWorkspaceUnread` does.
	for (const workspaceId of unreadWorkspaces) {
		const own = newSessions.filter((session) => session.workspaceId === workspaceId);
		if (own.length === 0 || own.some((session) => session.unreadCount > 0)) continue;
		const newest = [...own].sort((a, b) => b.createdAt - a.createdAt)[0];
		if (newest !== undefined) newest.unreadCount = 1;
	}
	const importedSessionIds = new Set(newSessions.map((session) => session.id as string));
	const activeSessions: ImportRows["activeSessions"] = [];
	for (const workspace of rows.workspaces) {
		const active = workspace.active_session_id;
		if (active === null || !newWorkspaces.some((made) => made.id === workspace.local_id)) continue;
		if (importedSessionIds.has(active) || conducted.sessionIds.has(active)) {
			activeSessions.push({
				workspaceId: workspace.local_id as WorkspaceId,
				sessionId: active as SessionId,
			});
		}
	}

	// ---- review comments
	const newComments: DiffComment[] = [];
	for (const comment of rows.diff_comments) {
		kinds.reviewComments.found++;
		const label = comment.file_path ?? "A comment on the pull request";
		if (!SAFE_ID.test(comment.id)) {
			leave("reviewComments", label, "Its id cannot be used as a Conducted id.");
			continue;
		}
		if (conducted.commentIds.has(comment.id)) {
			already("reviewComments");
			continue;
		}
		const target =
			comment.workspace_id === null ? undefined : workspaceTargets.get(comment.workspace_id);
		if (target === undefined) {
			leave("reviewComments", label, "Its workspace does not come over.");
			continue;
		}
		if (target.state === "archived" || target.state === "archiving") {
			leave(
				"reviewComments",
				label,
				"Its workspace is archived; review comments come over for open workspaces.",
			);
			continue;
		}
		if (comment.state === null || !REVIEW_STATES.has(comment.state)) {
			leave("reviewComments", label, "It has no review state Conducted knows (an old row).");
			continue;
		}
		if (comment.body === null) {
			leave("reviewComments", label, "It has no text.");
			continue;
		}
		const location = comment.location;
		const onFile = comment.file_path !== null && comment.file_path !== "";
		if (location !== "original" && location !== "modified" && location !== "file") {
			leave("reviewComments", label, "Conductor anchors it in a way Conducted does not know.");
			continue;
		}
		if (location !== "file" && !onFile) {
			leave("reviewComments", label, "It names no file.");
			continue;
		}
		const fromGithub = comment.remote_url !== null || comment.id.startsWith("github-");
		const kind = fromGithub ? "github" : comment.author !== null ? "agent" : "user";
		const createdAt = timeOr(comment.created_at, now);
		newComments.push({
			id: comment.id as CommentId,
			workspaceId: comment.workspace_id as WorkspaceId,
			filePath: onFile ? comment.file_path : null,
			line: location === "file" ? null : comment.line_number,
			endLine: location === "file" ? null : comment.end_line_number,
			body: comment.body,
			author: {
				kind,
				name: kind === "user" ? null : comment.author,
				avatarUrl: comment.author_avatar_url,
			},
			state: comment.state as ReviewCommentState,
			side: location === "original" ? "deletions" : "additions",
			threadId: comment.thread_id,
			replyToId: comment.reply_to_comment_id as CommentId | null,
			suggestion: null,
			suggestionBaseCode: comment.suggestion_base_code,
			remoteUrl: comment.remote_url,
			resolved: comment.is_resolved,
			outdated: comment.is_outdated,
			createdAt,
			updatedAt: timeOr(comment.updated_at, createdAt),
		});
	}
	kinds.reviewComments.toImport = newComments.length;

	// ---- sidebar sections
	const newSections: SectionWrite[] = [];
	const sortedSections = [...rows.navigation_sections].sort(
		(a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id),
	);
	for (const section of sortedSections) {
		kinds.sections.found++;
		if (!SAFE_ID.test(section.id)) {
			leave("sections", section.name, "Its id cannot be used as a Conducted id.");
			continue;
		}
		if (conducted.sectionIds.has(section.id)) {
			already("sections");
			continue;
		}
		const members = rows.navigation_section_memberships
			.filter(
				(member) => member.section_id === section.id && workspaceTargets.has(member.workspace_id),
			)
			.sort(
				(a, b) =>
					(conductorTime(a.created_at) ?? 0) - (conductorTime(b.created_at) ?? 0) ||
					a.workspace_id.localeCompare(b.workspace_id),
			);
		newSections.push({
			section: {
				id: section.id as SectionId,
				name: section.name,
				emoji: section.emoji,
				position: conducted.sectionCount + newSections.length,
				collapsed: false,
				workspaceIds: [...new Set(members.map((member) => member.workspace_id as WorkspaceId))],
			},
			createdAt: timeOr(section.created_at, now),
		});
	}
	kinds.sections.toImport = newSections.length;

	// ---- favourite models
	const newFavorites: FavoriteModel[] = [];
	const sortedFavorites = [...rows.favorite_models].sort(
		(a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id),
	);
	for (const favorite of sortedFavorites) {
		kinds.favoriteModels.found++;
		const parsed = favoriteConfig(favorite.configuration);
		const label = parsed?.model ?? favorite.id;
		if (conducted.favorites.some((ours) => ours.id === favorite.id)) {
			already("favoriteModels");
			continue;
		}
		if (parsed === null) {
			leave("favoriteModels", label, "Conductor's stored choice could not be read.");
			continue;
		}
		if (parsed.type === "acp") {
			leave("favoriteModels", label, "Conductor's OpenCode and Pi favourites name no model.");
			continue;
		}
		if (parsed.model === null) {
			leave("favoriteModels", label, "It names no model.");
			continue;
		}
		const model = parsed.model;
		const offering = (["claude", "codex", "cursor"] as const).filter((agent) =>
			(input.offeredModels[agent] ?? []).includes(model),
		);
		const named = parsed.agent;
		const agent: AgentKind | null =
			named === "claude" || named === "codex" || named === "cursor"
				? named
				: offering.length === 1
					? (offering[0] ?? null)
					: null;
		if (agent === null) {
			const unread = (["claude", "codex", "cursor"] as const).some(
				(name) => (input.offeredModels[name] ?? null) === null,
			);
			leave(
				"favoriteModels",
				label,
				offering.length > 1
					? "More than one agent offers this model, and Conductor does not say which."
					: unread
						? "Not every agent's model list could be read, so the import cannot tell which agent offers this model. Run the dry run again once the agents are ready."
						: "Conducted's agents do not offer this model.",
			);
			continue;
		}
		const config = {
			agent,
			model,
			effort: effortOf(parsed.effortLevel),
			fastMode: parsed.fastMode,
		};
		if (
			[...conducted.favorites, ...newFavorites].some((ours) =>
				sameFavoriteChoice(ours.config, config),
			)
		) {
			already("favoriteModels");
			continue;
		}
		if (conducted.favorites.length + newFavorites.length >= MAX_FAVORITES) {
			leave("favoriteModels", label, `Conducted keeps at most ${MAX_FAVORITES} favourites.`);
			continue;
		}
		newFavorites.push({
			id: favorite.id,
			config,
			position: conducted.favorites.length + newFavorites.length,
		});
	}
	kinds.favoriteModels.toImport = newFavorites.length;

	// ---- settings
	const newSettings: ImportRows["settings"] = [];
	const scriptsMigrated = rows.settings.some(
		(row) => row.key === CONDUCTOR_SCRIPTS_MIGRATED_KEY && row.deprecated_at === null,
	);
	for (const setting of rows.settings) {
		if (setting.key === CONDUCTOR_SCRIPTS_MIGRATED_KEY) continue;
		kinds.settings.found++;
		const mapped = mapConductorSetting(setting);
		if (mapped.kind === "left_out") {
			leave("settings", setting.key, mapped.reason);
			continue;
		}
		if (
			conducted.settingKeys.has(mapped.key) ||
			newSettings.some((row) => row.key === mapped.key)
		) {
			already("settings");
			continue;
		}
		newSettings.push({ key: mapped.key, value: mapped.value });
	}
	kinds.settings.toImport = newSettings.length;

	// ---- environment variables
	const newEnvVars: EnvVar[] = [];
	const secretMoves: ConductorSecretMove[] = [];
	for (const variable of rows.env_vars) {
		kinds.environmentVariables.found++;
		const name = variable.key;
		if (variable.context === "cloud") {
			leave(
				"environmentVariables",
				name,
				"It is for Conductor's cloud workspaces; Conducted's cloud variables live with your Worker.",
			);
			continue;
		}
		if (variable.scope !== "shared" || variable.context !== "local") {
			leave("environmentVariables", name, "Conductor keeps it in a scope Conducted does not know.");
			continue;
		}
		if (!validateEnvVarName(name).ok || isReservedEnvVarName(name)) {
			leave("environmentVariables", name, "Conducted cannot use this name for a variable.");
			continue;
		}
		if (conducted.globalEnvVarNames.has(name)) {
			already("environmentVariables");
			continue;
		}
		if (!variable.has_value) {
			leave(
				"environmentVariables",
				name,
				"Its value is in Conductor's Keychain item, which the import does not read. Enter it again on the Environment page.",
			);
			continue;
		}
		const keychainKey = envVarKeychainKey("global", name);
		if (conducted.keychainKeysInUse.has(keychainKey)) {
			leave(
				"environmentVariables",
				name,
				"Conducted's Keychain already holds a value under this name, and the import does not replace it.",
			);
			continue;
		}
		newEnvVars.push({ name, scope: "global", repoId: null, keychainRef: keychainKey });
		secretMoves.push({
			name,
			scope: variable.scope,
			context: variable.context,
			keychainKey,
		});
	}
	kinds.environmentVariables.toImport = newEnvVars.length;

	// ---- repository scripts
	const files: SettingsFileWrite[] = [];
	const renames: ScriptRename[] = [];
	const scriptMentions: ScriptMention[] = [];
	const notBrought: NotBrought[] = [];
	const scriptRepos = new Map<string, { repo: Repo; conductor: ConductorRepo }>();
	for (const conductor of rows.repos) {
		const repo = repoById.get(conductor.id);
		if (repo !== undefined) scriptRepos.set(repo.rootPath, { repo, conductor });
	}
	for (const { repo, conductor } of scriptRepos.values()) {
		const folder = input.folders[repo.rootPath];
		if (folder === undefined || !folder.exists) continue;
		for (const file of folder.unreadable) {
			kinds.scripts.found++;
			leave("scripts", `${repo.name}: ${file}`, "The file could not be read as TOML.");
		}
		if (folder.conductorJson) {
			parts.push({
				kind: "scripts",
				label: `${repo.name}: conductor.json`,
				reason: "Conductor no longer reads conductor.json; its settings files are what it runs.",
			});
		}
		const shared = folder.shared === null ? EMPTY_SCRIPTS : scriptsOf(folder.shared);
		let local = folder.local === null ? EMPTY_SCRIPTS : scriptsOf(folder.local);
		if (!scriptsMigrated) local = withColumns(local, conductor);
		const targets = [
			{
				scope: "shared" as const,
				scripts: shared,
				exists: folder.conductedShared,
				path: sharedSettingsFile(repo.rootPath),
			},
			{
				scope: "local" as const,
				scripts: local,
				exists: folder.conductedLocal,
				path: localSettingsFile(repo.rootPath),
			},
		];
		for (const target of targets) {
			if (!hasScripts(target.scripts)) continue;
			kinds.scripts.found++;
			const relative = target.path.slice(repo.rootPath.length + 1);
			if (target.exists) {
				already("scripts");
				parts.push({
					kind: "scripts",
					label: `${repo.name}: ${relative}`,
					reason: "Conducted already has this settings file, and the import does not change it.",
				});
				continue;
			}
			const renamed = renameConductorNames(target.scripts);
			files.push({
				path: target.path,
				repoRootPath: repo.rootPath,
				scope: target.scope,
				scripts: renamed.scripts,
			});
			for (const rename of renamed.renames) {
				renames.push({ ...rename, repoName: repo.name, file: relative });
			}
			for (const candidate of scriptFileCandidates(target.scripts)) {
				const text = folder.scriptFiles[candidate];
				if (text === undefined) continue;
				for (const line of conductorNameLines(text)) {
					if (
						scriptMentions.some(
							(seen) =>
								seen.repoName === repo.name &&
								seen.file === candidate &&
								seen.line === line.line &&
								seen.name === line.name,
						)
					)
						continue;
					scriptMentions.push({ repoName: repo.name, file: candidate, ...line });
				}
			}
		}
	}
	kinds.scripts.toImport = files.length;

	// ---- what stays in Conductor
	const counts = input.snapshot.counts;
	const sum = (...tables: string[]): number | null => {
		const values = tables
			.map((table) => counts[table])
			.filter((value): value is number => typeof value === "number");
		return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
	};
	notBrought.push(
		{
			what: "chat history",
			count: sum("session_events", "session_messages"),
			reason:
				"Chats come over without their messages; each one resumes from the agent's own transcript. The history comes over once a check on real data shows it maps whole (D100).",
		},
		{
			what: "terminal tabs",
			count: sum("terminal_sessions"),
			reason: "Conducted keeps its own terminals.",
		},
		{
			what: "port forwards",
			count: sum("port_forwards"),
			reason: "They belong to Conductor's cloud workspaces.",
		},
		{
			what: "attachments",
			count: sum("attachments"),
			reason: "They belong to chat history, which stays behind.",
		},
		{
			what: "messages waiting to send",
			count: sum("session_messages_outbox", "session_assets_outbox"),
			reason: "Conductor's own delivery queue.",
		},
		{
			what: "account links",
			count: sum("identity_associations"),
			reason: "They link to Conductor's servers.",
		},
		{
			what: "settings in ~/.conductor/settings.toml",
			count: null,
			reason:
				"The import reads Conductor's database and repository scripts, not its user settings file.",
		},
	);

	return {
		rows: {
			repos: newRepos,
			workspaces: newWorkspaces,
			sessions: newSessions,
			activeSessions,
			diffComments: newComments,
			sections: newSections,
			favoriteModels: newFavorites,
			settings: newSettings,
			envVars: newEnvVars,
		},
		secretMoves,
		files,
		preview: {
			kinds,
			leftOut,
			parts,
			notBrought,
			renames,
			scriptMentions,
			files: files.map((file) => file.path),
		},
	};
}

/**
 * Before Conductor moved repo scripts into its settings files, they lived in `repos` columns, and
 * its migration put them into the local file. A file's own value wins over a column.
 */
function withColumns(local: RepoScripts, repo: ConductorRepo): RepoScripts {
	const values = { ...local.values };
	const columns: Partial<Record<(typeof SCRIPT_KEYS)[number], string | null>> = {
		setup_script: repo.setup_script,
		run_script: repo.run_script,
		archive_script: repo.archive_script,
		run_script_mode: repo.run_script_mode,
	};
	const scripted = [columns.setup_script, columns.run_script, columns.archive_script].some(
		(value) => value !== null && value !== undefined && value !== "",
	);
	if (!scripted) return local;
	for (const [key, value] of Object.entries(columns) as [keyof typeof columns, string | null][]) {
		if (value !== null && value !== "" && values[key] === undefined) values[key] = value;
	}
	return { values, actions: local.actions };
}

/** Rows of `rows` by kind, for the counts the import checks after it writes. */
export const plannedCounts = (rows: ImportRows): Record<string, number> => ({
	repos: rows.repos.length,
	workspaces: rows.workspaces.length,
	sessions: rows.sessions.length,
	diffComments: rows.diffComments.length,
	sections: rows.sections.length,
	sectionMembers: rows.sections.reduce(
		(total, write) => total + write.section.workspaceIds.length,
		0,
	),
	favoriteModels: rows.favoriteModels.length,
	settings: rows.settings.length,
	envVars: rows.envVars.length,
});

export type { ConductorRows };
