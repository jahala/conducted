/**
 * The app's domain types, shared by services (src/core) and screens (src/features).
 * Rows mirror the migrations (0001 to 0009) after parsing; view models are what screens render.
 * Screens never read the database: they get these types from services through hooks.
 */
import type {
	AgentItem,
	CodexGoal,
	FileChange,
	Host,
	Interaction,
	LiveState,
	Progress,
	SessionConfig,
	UserMessageSender,
} from "@conducted/protocol";
import type {
	AcpAgent,
	AgentKind,
	AttachmentId,
	CommentId,
	InteractionId,
	MessageId,
	RepoId,
	Result,
	SectionId,
	SessionId,
	SnippetId,
	TerminalId,
	ToolUseId,
	TurnId,
	WorkspaceId,
} from "@conducted/shared";
import type { ProgramStatus } from "../platform/platform.ts";

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

/** A repository icon the user picks. A file is copied into app storage; null removes the icon. */
export type RepoIconChoice =
	| { kind: "emoji"; emoji: string }
	| { kind: "file"; path: string }
	| null;

/** Where a run action may run: this Mac and/or a cloud workspace (services-map 5A.1.6). */
export type ActionTarget = "local" | "cloud";

/** One run action of a repository (the Run button and the actions menu). */
export interface RunAction {
	id: string;
	label: string;
	command: string;
	/** Arguments added after the command, each quoted. */
	args: string[];
	/** The folder it runs in. May contain $NAME variables from the run environment. Null: the workspace folder. */
	cwd: string | null;
	/** The action the Run button and "run after setup" start. Without one, the first action is the default. */
	isDefault: boolean;
	/** Hidden for this user only. The shared settings file still lists it. */
	hidden: boolean;
	icon: string | null;
	/** Where it is defined: the shared repo file, this Mac only, or a local change to a shared one. */
	origin: "shared" | "local" | "changed_locally";
	/** Where the action may run. The default is both the Mac and a cloud workspace. */
	availableIn: readonly ActionTarget[];
	/**
	 * On an expanded entry in a cloud workspace, the host this variant runs on. Absent when the
	 * action has a single target (services-map 5A.1.6).
	 */
	runAvailability?: ActionTarget;
}

/** One preview URL template: the name its menu entry shows and the URL with the port variable. */
export interface PreviewUrlEntry {
	/** The menu label. Empty means the expanded URL is shown. */
	name: string;
	/** The template, such as `http://localhost:$CONDUCTED_PORT`. */
	url: string;
}

/** Per-repo configuration from `.conducted/settings.toml` (shared) merged with local settings. */
export interface RepoConfig {
	setupScript: string | null;
	runScripts: RunAction[];
	runMode: "concurrent" | "exclusive";
	archiveScript: string | null;
	/** Files copied from the main clone into each new worktree, e.g. ".env". */
	copyFiles: string[];
	/** The ordered preview URL templates (RUN-03). The first is the terminal panel's Open URL. */
	previewUrls: PreviewUrlEntry[];
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
	linkedPaths: string[];
	prNumber: number | null;
	prTitle: string | null;
	prDescription: string | null;
	archiveCommit: string | null;
	/** When the workspace was archived. Archive-based lifetimes count from it (DATA-02, DATA-06). */
	archivedAt: number | null;
	/** The chat tab that was open last, restored after a restart. */
	activeSessionId: SessionId | null;
	/** How many files were copied into the new worktree during setup, for the Setup tab. */
	filesCopied: number | null;
	/**
	 * Where its git, shell, files, terminals and chats run: this Mac, or a cloud sandbox (CLOUD-01).
	 * Every call checks it first (core/host.ts).
	 */
	host: Host;
	lastActivityAt: number;
	createdAt: number;
	updatedAt: number;
}

/**
 * A workspace saved to the backlog: everything needed to start it later, but no worktree, branch
 * or port yet (WS-11). Starting it creates the workspace with the same id.
 */
export interface BacklogWorkspace {
	id: WorkspaceId;
	/** Null when its repository was removed; the user picks another before starting it. */
	repoId: RepoId | null;
	/** The name the user gave it, shown in the sidebar. Null: the first line of the prompt. */
	displayName: string | null;
	/** The first message for the first chat. */
	prompt: string;
	attachmentPaths: string[];
	config: SessionConfig;
	sectionId: SectionId | null;
	createdAt: number;
	updatedAt: number;
}

export interface Session {
	id: SessionId;
	workspaceId: WorkspaceId;
	title: string | null;
	config: SessionConfig;
	agentSessionId: string | null;
	/**
	 * A chat forked from a turn: the agent's own id of the last message the fork keeps, where its
	 * first send resumes the origin's agent session (CHAT-16). Null once that send is recorded.
	 */
	forkResumeNativeMessageId: string | null;
	unreadCount: number;
	/** The last used token count an agent reported: a cache of the newest usage event (CHAT-14). */
	contextUsedTokens: number | null;
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

/**
 * Where a review comment is in its life. draft: being written. pending: saved, not yet in a chat.
 * ready_for_review: added to the composer. reviewed: sent to the agent with a message. hidden:
 * dismissed by the user; a GitHub comment stays hidden after the next sync. superseded: replaced
 * by a newer review of the same workspace.
 */
export type ReviewCommentState =
	| "draft"
	| "pending"
	| "ready_for_review"
	| "reviewed"
	| "hidden"
	| "superseded";

export interface DiffComment {
	id: CommentId;
	workspaceId: WorkspaceId;
	/** Null for a comment on the pull request itself, with no file (REV-13). */
	filePath: string | null;
	line: number | null;
	endLine: number | null;
	body: string;
	author: {
		kind: "user" | "agent" | "github";
		name: string | null;
		/** The GitHub author's avatar image, shown beside the comment. */
		avatarUrl: string | null;
	};
	state: ReviewCommentState;
	/** Which side of a split diff the comment is anchored to: removed lines or added lines. */
	side: "deletions" | "additions";
	threadId: string | null;
	replyToId: CommentId | null;
	/** Replacement code the comment suggests. Null: no suggested change. */
	suggestion: string | null;
	/** The original lines the suggestion replaces, as they were when it was written. */
	suggestionBaseCode: string | null;
	remoteUrl: string | null;
	resolved: boolean;
	outdated: boolean;
	createdAt: number;
	updatedAt: number;
}

export interface Attachment {
	id: AttachmentId;
	sessionId: SessionId | null;
	/** review: a review comment written to a file for the agent; `commentId` names the comment. */
	kind: "file" | "image" | "pdf" | "text" | "review";
	originalName: string;
	path: string;
	isDraft: boolean;
	/** The review comment this attachment carried, so the app knows which messages sent it. */
	commentId: CommentId | null;
}

export interface Terminal {
	id: TerminalId;
	/** The workspace it belongs to. Null for a repository terminal (one per repository). */
	workspaceId: WorkspaceId | null;
	/** Set for a repository terminal, which runs in the main clone. Null for a workspace terminal. */
	repoId: RepoId | null;
	kind: "terminal" | "setup" | "run" | "spotlight";
	title: string;
	cwd: string;
	/**
	 * Where its tab belongs: the centre strip or the right panel's scripts panel. A terminal made
	 * from one strip's "+" opens there and is listed only there (ui-map 3.2, 3.7).
	 */
	placement: "centre" | "panel";
	/** Where the terminal runs: the Mac, or the sandbox of a cloud workspace (CLOUD-11). */
	hostKind: "local" | "cloud";
	/** A command typed into the shell when it starts, for example a "big terminal" preset. */
	startCommand: string | null;
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

/** A saved prompt the user inserts with its keyword or from the snippet picker (COMP-09). */
export interface Snippet {
	id: SnippetId;
	name: string;
	/** Typed after the snippet trigger to insert it. Null: only the picker inserts it. */
	keyword: string | null;
	prompt: string;
	createdAt: number;
	updatedAt: number;
}

// ---------------------------------------------------------------- chat view models

/** One tool call with its result, as a card in the chat. */
export interface ToolCallView {
	toolUseId: ToolUseId;
	item: Extract<AgentItem, { kind: "tool_call" }>;
	result: Extract<AgentItem, { kind: "tool_result" }> | null;
	/** What a sub-agent started by this call showed, in order, kept inside its card. */
	blocks: ChatBlock[];
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
	/** user: the user's message started it. agent: the agent started it by itself (AGENT-15). */
	startedBy: "user" | "agent";
	/** Null for a turn the agent started by itself. */
	userMessage: {
		messageId: MessageId;
		text: string;
		attachmentPaths: string[];
		at: number;
		/** Who sent it, when it was not typed in this app (the "Sent via" label). */
		sender: UserMessageSender | null;
	} | null;
	/** Messages steered into this turn while it ran. */
	steers: { messageId: MessageId; text: string; at: number; consumed: boolean }[];
	blocks: ChatBlock[];
	startCheckpointId: string | null;
	endCheckpointId: string | null;
	changes: FileChange[];
	outcome: "running" | "success" | "error" | "cancelled" | "interrupted" | "unrecorded";
	error: string | null;
	/** When the turn started and ended, in milliseconds since the epoch. Null end while it runs. */
	startedAt: number;
	endedAt: number | null;
	usage: {
		costUsd: number | null;
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens: number;
		cacheWriteTokens: number;
		/** Whether the turn ran in fast mode, when the agent reports it. */
		fastMode: boolean | null;
		model: string | null;
	} | null;
	reverted: boolean;
}

export interface ChatView {
	session: Session;
	turns: ChatTurn[];
	liveState: LiveState;
	queued: QueuedMessage[];
	openInteraction: {
		interactionId: InteractionId;
		interaction: Interaction;
		/** When the agent stops waiting, for Codex requests. Null: no limit. */
		expiresAt: number | null;
		/** The agent stopped waiting before the user answered. The card says it timed out. */
		timedOut: boolean;
	} | null;
	progress: ProgressView | null;
	/** The Codex goal of the chat, for the goal bar. Null when it has none or is not Codex. */
	goal: CodexGoal | null;
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

/** waiting: the check is queued behind something, such as a required approval or a free runner. */
export type CheckState =
	| "pending"
	| "waiting"
	| "running"
	| "success"
	| "failure"
	| "cancelled"
	| "skipped";

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

/** A workspace's sparse checkout, which git itself stores (services-map.md 3.11, 5A.5.3). */
export interface SparseCheckoutSettings {
	enabled: boolean;
	/** The directories git includes, empty when sparse checkout is off. */
	directories: string[];
	/** The top-level folders of the checked-out commit, the choices to offer the user. */
	topLevelDirectories: string[];
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

/** GitHub's `mergeStateStatus` of a pull request, which the stack readiness rules read. */
export type MergeStateStatus =
	| "CLEAN"
	| "DIRTY"
	| "BEHIND"
	| "UNSTABLE"
	| "BLOCKED"
	| "DRAFT"
	| "HAS_HOOKS"
	| "UNKNOWN";

/** One member of a stacked-PR chain, in order from trunk. */
export interface StackEntryView {
	number: number;
	title: string;
	branch: string;
	state: "open" | "draft" | "merged" | "closed";
	isCurrent: boolean;
	needsRestack: boolean;
	/** GitHub's merge state of this pull request; null when the readiness read gave no answer. */
	mergeStateStatus: MergeStateStatus | null;
	/** The commit id of the pull request's head branch. */
	headSha: string;
	/** The commit id of the pull request's base, which is the head of the entry below in a synced stack. */
	baseSha: string;
}

/** One entry of the PR tab's activity list, built from the GitHub data the services fetch. */
export type PrActivityEntry =
	| { kind: "commit"; id: string; at: number; sha: string; subject: string; authorName: string }
	| {
			kind: "comment";
			id: string;
			at: number;
			authorLogin: string;
			authorAvatarUrl: string | null;
			body: string;
			/** Set for review thread comments. */
			filePath: string | null;
			line: number | null;
			commentId: string | null;
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
	/** A pull request action that is running, so its button shows progress. Null when none is. */
	pendingPullRequestAction: PullRequestAction | null;
}

/** The pull request actions a button can start. A second press while one runs is ignored. */
export type PullRequestAction =
	| "merging"
	| "enabling_auto_merge"
	| "disabling_auto_merge"
	| "marking_ready"
	| "approving"
	| "requesting_review"
	| "updating"
	| "syncing_stack";

// ---------------------------------------------------------------- derived workspace status

/** What the sidebar, Home cards and tabs show. Produced by core/status/workspace-status.ts. */
export type WorkspaceStatus =
	| {
			kind: "lifecycle";
			label: "unstarted" | "initializing" | "setting_up" | "failed" | "archiving";
	  }
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
	/** How many files were copied into the worktree before the script ran. Null when unknown. */
	filesCopied: number | null;
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
	/** Where the agent says the server was configured; null when it does not say. */
	source: "user" | "project" | "local" | "plugin" | null;
	/** How the agent says it reaches the server; null when it does not say. */
	transport: "stdio" | "http" | "sse" | null;
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

// ---------------------------------------------------------------- GitHub, Linear and issues

/** An issue that can start a workspace or be attached as context (WS-02, PR-09, PR-11). */
export interface IssueView {
	provider: "github" | "linear";
	/** The provider's id. GitHub: the issue number as text. Linear: its id. */
	id: string;
	/** What the user sees, for example "#42" or "ENG-12". */
	identifier: string;
	title: string;
	url: string;
	state: string;
	/** The branch name the provider suggests, when it has one (Linear). */
	branchName: string | null;
	updatedAt: number;
}

/** A pull request of a repository, for the "Create from" list (WS-02). */
export interface PullRequestSummary {
	number: number;
	title: string;
	/** The head branch. */
	branch: string;
	authorLogin: string | null;
	authorAvatarUrl: string | null;
	state: "open" | "draft" | "merged" | "closed";
	updatedAt: number;
}

/** A GitHub account or organisation the user may create or clone repositories under (PRJ-02, PRJ-03). */
export interface GitHubOwner {
	login: string;
	kind: "user" | "organization";
	avatarUrl: string | null;
}

/** A GitHub repository, for the clone picker. */
export interface GitHubRepoSummary {
	owner: string;
	name: string;
	description: string | null;
	isPrivate: boolean;
	cloneUrl: string;
	updatedAt: number;
}

/** Whether a repository name is free under an owner, for the quick start form. */
export type RepoNameCheck = "available" | "taken" | "invalid";

/** The Linear status the Account page shows (D035: a personal API key). */
export type LinearAccess =
	| { state: "signed_out" }
	| { state: "key_rejected" }
	| { state: "unknown"; reason: "offline" | "check_failed" }
	| { state: "signed_in"; name: string; organization: string | null };

// ---------------------------------------------------------------- composer sources

/** A plan an agent proposed in this workspace, for "@" and "Add plans" (COMP-04, CHAT-26). */
export interface PlanEntry {
	sessionId: SessionId;
	sessionTitle: string | null;
	turnId: TurnId;
	/** Which plan this is: `${eventId}:${callIndex}`, the agent event and the call's place in it. */
	planId: string;
	/** The plan's first heading or first line. */
	title: string;
	at: number;
}

/** One entry of the Artifacts tab: a file in the workspace's `.context` folder (REV-10). */
export interface ArtifactEntry {
	/** Relative to the `.context` folder. */
	path: string;
	isDirectory: boolean;
	sizeBytes: number;
	modifiedAt: number;
}

export interface ArtifactsView {
	entries: ArtifactEntry[];
	/** True while more pages are left to load. */
	hasMore: boolean;
	/**
	 * How many files of the whole `.context` folder the list leaves out: the files the app keeps
	 * for itself. Every page reports the same total.
	 */
	omitted: number;
}

// ---------------------------------------------------------------- agents and their programs

/** A managed program and the user's choice for it, for the Agents and Advanced pages (D021, D024). */
export interface AgentProgramView {
	status: ProgramStatus;
	/** The path the user chose in settings instead of the managed copy. Null: the managed copy. */
	userPath: string | null;
}
export type { ProgramState, ProgramStatus, SystemInfo } from "../platform/platform.ts";

/** One provider key of an agent on the Agents page. The value itself stays in the Keychain. */
export interface ProviderKeyView {
	agent: AgentKind;
	acpAgent: AcpAgent | null;
	/** The provider, for example "anthropic", "bedrock" or an OpenCode provider id. */
	provider: string;
	/** The environment variable the key is given to the agent as, for example ANTHROPIC_API_KEY. */
	envVar: string;
	/** entered: typed on the page and kept in the Keychain. this_mac: read from the Mac's environment. Null: not set. */
	source: "entered" | "this_mac" | null;
}

/** An agent's own settings file, for the editors on the Agents page (SET-12). */
export interface AgentConfigFile {
	agent: "claude" | "codex";
	/** For example ~/.claude/settings.json or ~/.codex/config.toml. */
	path: string;
	/** The file's text. Empty when the file does not exist yet. */
	text: string;
	exists: boolean;
	modifiedAt: number | null;
}

/** What "Sync agent configs" can copy between Claude Code and Codex (SET-08). */
export type ConfigSyncCategory = "mcp_servers" | "slash_commands" | "skills";

/** One change the sync would make, shown in its diff step. */
export interface ConfigSyncChange {
	category: ConfigSyncCategory;
	name: string;
	change: "add" | "update";
	/** A short text diff of the entry, for the review step. */
	diff: string;
}

export interface ConfigSyncResult {
	applied: number;
	failures: { category: ConfigSyncCategory; name: string; message: string }[];
}
