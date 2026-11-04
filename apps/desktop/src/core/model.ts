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
	SessionConfig,
} from "@conducted/protocol";
import type {
	AttachmentId,
	CommentId,
	InteractionId,
	MessageId,
	RepoId,
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
	progress: { title?: string; steps: { label: string; status: string }[] } | null;
}

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
}

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
