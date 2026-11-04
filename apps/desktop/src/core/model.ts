/**
 * The app's domain types, shared by services (src/core) and screens (src/features).
 * Rows mirror migrations/0001_init.sql after parsing; view models are what screens render.
 * Screens never read the database: they get these types from services through hooks.
 */
import type {
	AgentItem,
	FileChange,
	Interaction,
	LiveState,
	Progress,
	SessionConfig,
} from "@conducted/protocol";
import type {
	AttachmentId,
	CommentId,
	InteractionId,
	MessageId,
	RepoId,
	Result,
	SectionId,
	SessionId,
	TerminalId,
	ToolUseId,
	TurnId,
	WorkspaceId,
} from "@conducted/shared";

// ---------------------------------------------------------------- stored entities

export interface Repo {
	id: RepoId;
	name: string;
	rootPath: string;
	remoteUrl: string | null;
	defaultBranch: string;
	icon: string | null;
	displayOrder: number;
	hidden: boolean;
	createdAt: number;
	updatedAt: number;
}

/** Per-repo configuration from `.conducted/settings.toml` (shared) merged with local settings. */
export interface RepoConfig {
	setupScript: string | null;
	runScripts: { id: string; label: string; command: string }[];
	runMode: "concurrent" | "exclusive";
	archiveScript: string | null;
	/** Files copied from the main clone into each new worktree, e.g. ".env". */
	copyFiles: string[];
	previewUrlTemplate: string | null;
	spotlightTesting: boolean;
	/** Start the repository's default run action once the setup script has finished. */
	autoRunAfterSetup: boolean;
	/** Name of the git remote this repository uses for fetch, push and pull requests. Null when it has none. */
	remoteName: string | null;
	prompts: {
		general: string | null;
		codeReview: string | null;
		createPr: string | null;
		fixErrors: string | null;
		resolveConflicts: string | null;
		renameBranch: string | null;
	};
}

export type WorkspaceState = "initializing" | "ready" | "failed" | "archiving" | "archived";
export type KanbanStatus = "backlog" | "in_progress" | "in_review" | "done" | "canceled";

export interface Workspace {
	id: WorkspaceId;
	repoId: RepoId;
	directoryName: string;
	path: string;
	branch: string;
	branchIsPlaceholder: boolean;
	displayName: string | null;
	targetBranch: string;
	state: WorkspaceState;
	kanbanStatus: KanbanStatus;
	port: number;
	pinnedAt: number | null;
	notes: string | null;
	linkedPaths: string[];
	prNumber: number | null;
	prTitle: string | null;
	prDescription: string | null;
	archiveCommit: string | null;
	lastActivityAt: number;
	createdAt: number;
	updatedAt: number;
}

export interface Session {
	id: SessionId;
	workspaceId: WorkspaceId;
	title: string | null;
	config: SessionConfig;
	agentSessionId: string | null;
	unreadCount: number;
	contextUsedTokens: number | null;
	contextWindowTokens: number | null;
	queuePausedAt: number | null;
	closedAt: number | null;
	lastUserMessageAt: number | null;
	createdAt: number;
	updatedAt: number;
}

export interface QueuedMessage {
	id: MessageId;
	sessionId: SessionId;
	text: string;
	attachmentPaths: string[];
	delivery: "queue" | "steer";
	position: number;
	state: "waiting" | "sending" | "failed";
	lastError: string | null;
}

export interface DiffComment {
	id: CommentId;
	workspaceId: WorkspaceId;
	filePath: string;
	line: number | null;
	endLine: number | null;
	body: string;
	author: { kind: "user" | "agent" | "github"; name: string | null };
	/** Which side of a split diff the comment is anchored to: removed lines or added lines. */
	side: "deletions" | "additions";
	threadId: string | null;
	replyToId: CommentId | null;
	suggestion: string | null;
	remoteUrl: string | null;
	resolved: boolean;
	outdated: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface Attachment {
	id: AttachmentId;
	sessionId: SessionId | null;
	kind: "file" | "image" | "text";
	originalName: string;
	path: string;
	isDraft: boolean;
}

export interface Terminal {
	id: TerminalId;
	workspaceId: WorkspaceId;
	kind: "terminal" | "setup" | "run" | "spotlight";
	title: string;
	cwd: string;
	startedAt: number;
	endedAt: number | null;
	exitCode: number | null;
}

export interface Section {
	id: SectionId;
	name: string;
	emoji: string | null;
	position: number;
	collapsed: boolean;
	workspaceIds: WorkspaceId[];
}

// ---------------------------------------------------------------- chat view models

/** One tool call with its result, as a card in the chat. */
export interface ToolCallView {
	toolUseId: ToolUseId;
	item: Extract<AgentItem, { kind: "tool_call" }>;
	result: Extract<AgentItem, { kind: "tool_result" }> | null;
	/** Calls made by a sub-agent started by this call. */
	children: ToolCallView[];
}

export type ChatBlock =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string; summarized: boolean }
	| { kind: "tool"; call: ToolCallView }
	| { kind: "todo"; item: Extract<AgentItem, { kind: "todo" }> }
	| { kind: "notice"; item: Extract<AgentItem, { kind: "notice" }> }
	| { kind: "error"; item: Extract<AgentItem, { kind: "error" }> };

/** One turn: the user's message and everything the agent did in reply. */
export interface ChatTurn {
	turnId: TurnId;
	userMessage: { messageId: MessageId; text: string; attachmentPaths: string[]; at: number };
	/** Messages steered into this turn while it ran. */
	steers: { messageId: MessageId; text: string; at: number; consumed: boolean }[];
	blocks: ChatBlock[];
	startCheckpointId: string | null;
	endCheckpointId: string | null;
	changes: FileChange[];
	outcome: "running" | "success" | "error" | "cancelled" | "interrupted";
	error: string | null;
	usage: { costUsd: number | null; inputTokens: number; outputTokens: number } | null;
	reverted: boolean;
}

export interface ChatView {
	session: Session;
	turns: ChatTurn[];
	liveState: LiveState;
	queued: QueuedMessage[];
	openInteraction: { interactionId: InteractionId; interaction: Interaction } | null;
	progress: ProgressView | null;
}

/** The agent's progress tracker for a chat (shape owned by @conducted/protocol). */
export type ProgressView = Progress;
export type { ProgressBlock, ProgressStepStatus } from "@conducted/protocol";

// ---------------------------------------------------------------- git and PR state

export interface BranchSync {
	ahead: number;
	behind: number;
	/** The remote branch was rewritten (force-pushed) since our last fetch. */
	rewritten: boolean;
	hasUpstream: boolean;
}

export type CheckState = "pending" | "running" | "success" | "failure" | "cancelled" | "skipped";

export interface CheckRun {
	name: string;
	state: CheckState;
	url: string | null;
	startedAt: number | null;
	completedAt: number | null;
	/** The repository's branch protection requires this check to pass before merging. */
	required: boolean;
}

export interface PullRequest {
	number: number;
	url: string;
	title: string;
	body: string;
	state: "open" | "draft" | "merged" | "closed";
	mergeable: "mergeable" | "conflicting" | "unknown";
	reviewDecision: "approved" | "changes_requested" | "review_required" | null;
	checks: CheckRun[];
	inMergeQueue: boolean;
	autoMergeEnabled: boolean;
	baseBranch: string;
	authorLogin: string | null;
	/** The signed-in GitHub user opened this PR. They cannot approve it. */
	viewerDidAuthor: boolean;
	/** The signed-in user has write, maintain or admin permission on the repository. */
	viewerCanMerge: boolean;
	/** The repository's preferred merge method: squash first, then rebase, then merge commit. */
	mergeMethod: "squash" | "rebase" | "merge";
	reviewers: ReviewerView[];
	deployments: DeploymentView[];
	/** Milliseconds since the Unix epoch. */
	updatedAt: number;
}

export type ReviewerState =
	| "approved"
	| "changes_requested"
	| "commented"
	| "dismissed"
	| "awaiting";

export interface ReviewerView {
	login: string;
	avatarUrl: string | null;
	state: ReviewerState;
}

export type DeploymentProvider =
	| "vercel"
	| "cloudflare"
	| "netlify"
	| "render"
	| "railway"
	| "fly"
	| "amplify"
	| "heroku"
	| "github_pages"
	| "other";

export type DeploymentState = "pending" | "deploying" | "deployed" | "failed" | "inactive";

export interface DeploymentView {
	environment: string;
	provider: DeploymentProvider;
	state: DeploymentState;
	url: string | null;
	updatedAt: number;
}

/** One commit on the workspace branch that is not on the target branch yet. */
export interface BranchCommit {
	sha: string;
	shortSha: string;
	subject: string;
	authorName: string;
	/** Milliseconds since the Unix epoch. */
	at: number;
}

/** One member of a stacked-PR chain, in order from trunk. */
export interface StackEntryView {
	number: number;
	title: string;
	branch: string;
	state: "open" | "draft" | "merged" | "closed";
	isCurrent: boolean;
	needsRestack: boolean;
}

/** One entry of the PR tab's activity list, built from the GitHub data the services fetch. */
export type PrActivityEntry =
	| { kind: "commit"; id: string; at: number; sha: string; subject: string; authorName: string }
	| {
			kind: "review";
			id: string;
			at: number;
			authorLogin: string;
			state: "approved" | "changes_requested" | "commented" | "dismissed";
			body: string;
	  }
	| {
			kind: "comment";
			id: string;
			at: number;
			authorLogin: string;
			body: string;
			/** Set for review thread comments. */
			filePath: string | null;
			line: number | null;
			commentId: string | null;
	  }
	| {
			kind: "status";
			id: string;
			at: number;
			change: "ready_for_review" | "merged" | "closed" | "reopened";
	  };

/** The tabs of the Git panel. The workspace URL stores the active one. */
export const GIT_PANEL_TABS = ["files", "changes", "checks"] as const;
export type GitPanelTab = (typeof GIT_PANEL_TABS)[number];

/** Everything the Git panel header needs. Computed by services/git.ts. */
export interface GitState {
	branch: string;
	uncommittedFiles: number;
	changedFiles: number;
	linesAdded: number;
	linesRemoved: number;
	hasConflicts: boolean;
	operation: "none" | "rebase" | "merge" | "cherry_pick" | "revert";
	sync: BranchSync;
	pullRequest: PullRequest | null;
	/** Why PR info is missing, when it is. */
	pullRequestUnavailable: "none" | "offline" | "no_github_access" | "not_github" | "loading" | null;
	/** The list of untracked files was cut off because the repository has too many of them. */
	untrackedFilesTruncated: boolean;
}

// ---------------------------------------------------------------- derived workspace status

/** What the sidebar, Home cards and tabs show. Produced by core/status/workspace-status.ts. */
export type WorkspaceStatus =
	| { kind: "lifecycle"; label: "initializing" | "setting_up" | "failed" | "archiving" }
	| {
			kind: "agent";
			label:
				| "needs_plan_review"
				| "needs_permission"
				| "needs_answer"
				| "working"
				| "cancelling"
				| "waiting";
	  }
	| {
			kind: "git";
			label:
				| "merged"
				| "in_merge_queue"
				| "ready_to_merge"
				| "draft_pr"
				| "merge_conflict"
				| "checks_failing"
				| "checks_running"
				| "pr_open"
				| "changes"
				| "clean";
	  };

// ---------------------------------------------------------------- files, terminals, setup

/** What the file viewer gets when it reads a file from the workspace folder. */
export type FileContent =
	| { kind: "text"; text: string; modifiedAt: number; sizeBytes: number }
	| {
			kind: "binary";
			sizeBytes: number;
			modifiedAt: number;
			/** A URL the webview may load for images, PDF and video. Null when none can be made. */
			previewUrl: string | null;
	  }
	| { kind: "too_large"; sizeBytes: number }
	| { kind: "missing" };

export type TerminalUnsubscribe = () => void;

/**
 * What a terminal view needs from the services: input, resize, output, exit, and saved history.
 * Screens may not reach the Platform, so the services hand the view this narrow object.
 */
export interface TerminalConnection {
	/** Saved scrollback to replay before live output. Empty for a new terminal. */
	history: Uint8Array;
	/** The terminal's process ended. Input and resize are no longer possible. */
	ended: { exitCode: number | null } | null;
	write(data: string): Promise<Result<void>>;
	resize(cols: number, rows: number): Promise<Result<void>>;
	/** Output chunks. Call `ack` with the byte count once a chunk has been written to the screen. */
	onData(listener: (chunk: Uint8Array) => void): TerminalUnsubscribe;
	ack(bytes: number): void;
	onExit(listener: (exitCode: number | null) => void): TerminalUnsubscribe;
}

export type SetupState =
	| "idle"
	| "detecting"
	| "running"
	| "stopping"
	| "completed"
	| "failed"
	| "cancelled";

/** The state of a workspace's setup script, for the Setup tab. */
export interface SetupView {
	state: SetupState;
	hasScript: boolean;
	exitCode: number | null;
	/** The live terminal while running. */
	terminalId: TerminalId | null;
	log: "live" | "saved" | "missing" | "expired";
	/** Set when a quit or crash ended the run, e.g. "The app quit while setup was running." */
	interruptedReason: string | null;
}

// ---------------------------------------------------------------- settings and diagnostics

export type EnvScope = "global" | { repoId: RepoId };

/**
 * One variable row for the Environment page. The value is not in the row: the page asks for it on
 * reveal, so it does not sit in screen state by default.
 */
export interface EnvVarView {
	name: string;
	scope: EnvScope;
	hasValue: boolean;
	/** In a repository scope: a global variable of the same name is replaced here. */
	overridesGlobal: boolean;
	/** In the global scope: a repository replaces it for that repository. */
	overriddenInRepos: number;
}

/** The GitHub status the Account page shows, from the `gh` command. */
export type GitHubAccess =
	| { state: "gh_missing" }
	| { state: "signed_out" }
	| { state: "unknown"; reason: "offline" | "check_failed" }
	| { state: "signed_in"; login: string; host: string; scopes: string[]; usesToken: boolean };

/** One MCP server row for the list and the status dialog. */
export interface McpServerView {
	name: string;
	/** Where the server was configured: the user's agent config or the project's. */
	source: "user" | "project";
	transport: "stdio" | "http" | "sse";
	status: "connected" | "needs_auth" | "failed" | "pending" | "disabled";
	toolCount: number | null;
	error: string | null;
	/** Last lines of the server's log, newest last. Empty when none were captured. */
	logTail: string[];
}

/** What the diagnostics screen captures about the app, the machine and the agents. */
export interface DiagnosticsCapture {
	app: { version: string; channel: "dev" | "release" };
	os: { name: string; version: string; arch: string };
	shell: string;
	path: string;
	env: Record<string, string>;
	agents: { name: string; installed: boolean; version: string | null; path: string | null }[];
	sidecar: { running: boolean; logPath: string | null };
	capturedAt: number;
}
