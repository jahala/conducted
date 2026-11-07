/**
 * @feature DATA-01 The contract between screens and services
 * Owns: the shape of every query hook and action that screens may use. Screens import hooks from
 * core/hooks.ts and never reach past them. Services implement them.
 * Behaviour: services-map.md part 1 (14 services over stores), ui-map.md (what each screen needs).
 * Our design choice: one typed API object instead of 14 singleton facades, so screens can be
 * tested by passing a different implementation.
 */
import type {
	AcpConfigOption,
	AgentInstall,
	AgentLogin,
	AgentProvider,
	FileChange,
	Host,
	InteractionAnswer,
	ModelInfo,
	SessionConfig,
	SlashCommand,
} from "@conducted/protocol";
import type {
	AcpAgent,
	AgentKind,
	AppError,
	CommentId,
	InteractionId,
	ManagedProgram,
	MessageId,
	RepoId,
	Result,
	SectionId,
	SessionId,
	SnippetId,
	TerminalId,
	TurnId,
	WorkspaceId,
} from "@conducted/shared";
import type { CloudDeployResult, CloudPairInput, CloudPairing } from "../platform/platform.ts";
import type {
	AgentConfigFile,
	AgentProgramView,
	ArtifactsView,
	BacklogWorkspace,
	BranchCommit,
	ChatView,
	ConfigSyncCategory,
	ConfigSyncChange,
	ConfigSyncResult,
	DiagnosticsCapture,
	DiffComment,
	EnvScope,
	EnvVarView,
	FileContent,
	GitHubAccess,
	GitHubOwner,
	GitHubRepoSummary,
	GitState,
	IssueView,
	KanbanStatus,
	LinearAccess,
	McpServerView,
	PlanEntry,
	PrActivityEntry,
	ProviderKeyView,
	PullRequestSummary,
	Repo,
	RepoConfig,
	RepoIconChoice,
	RepoNameCheck,
	RunAction,
	Section,
	Session,
	SetupView,
	Snippet,
	SparseCheckoutSettings,
	StackEntryView,
	SystemInfo,
	Terminal,
	TerminalConnection,
	Workspace,
	WorkspaceStatus,
} from "./model.ts";

// ---------------------------------------------------------------- query results

/** Every query hook returns one of these, so each screen designs its loading and error state. */
export type Loadable<T> =
	| { state: "loading" }
	| { state: "error"; error: AppError }
	| { state: "ready"; data: T };

export type DiffScope =
	| { kind: "branch" }
	| { kind: "uncommitted" }
	| { kind: "target"; branch: string }
	| { kind: "commit"; sha: string }
	| { kind: "turn"; sessionId: SessionId; turnId: TurnId }
	/**
	 * A run of adjacent pull requests of the workspace's GitHub stack, chosen in the stack view
	 * (PR-08, services-map 3.4.1 view mode `range`, 3.4.5). Numbers in the stack's order from trunk
	 * up. Only the checked-out pull request, or none of the stack's, shows the branch's own changes.
	 */
	| { kind: "range"; prNumbers: number[] };

export interface ChangedFile extends FileChange {
	conflicted: boolean;
	/** The user ticked "Viewed" for this version of the file. */
	viewed: boolean;
}

export interface FileDiff {
	path: string;
	oldText: string | null;
	newText: string | null;
	/** Unified diff text, for renderers that take a patch. */
	patch: string;
	binary: boolean;
	tooLarge: boolean;
}

/** A file or folder in the workspace, relative to its root. */
export interface FileEntry {
	path: string;
	isDirectory: boolean;
}

/** One line of a file that matches a content search. */
export interface ContentMatch {
	path: string;
	line: number;
	column: number;
	/** The text of the matching line. */
	preview: string;
}

export interface ContentSearchOptions {
	matchCase: boolean;
	wholeWord: boolean;
	regex: boolean;
}

/** The error codes `Actions.files.write` can fail with. */
export type FileWriteErrorCode = "changed_on_disk" | "missing" | "permission" | "other";

/** A port something listens on in the workspace's range, with the program behind it. */
export interface DetectedPort {
	port: number;
	pid: number;
	processName: string;
	/** The macOS app that owns the process, such as a browser or an Electron app. Null for a plain process. */
	appName: string | null;
}

export interface RunState {
	actions: RunAction[];
	running: {
		actionId: string;
		terminalId: TerminalId;
		url: string | null;
		/** Where the run is: waiting for the setup script to finish, or past it. */
		phase: "starting" | "waiting_for_setup" | "running" | "stopping";
	}[];
	spotlight: { active: boolean; terminalId: TerminalId | null };
	detectedPorts: DetectedPort[];
}

export interface Draft {
	text: string;
	attachmentPaths: string[];
}

export interface CommandEntry {
	id: string;
	title: string;
	category: string;
	/** Display form, e.g. "⌘⇧P". Null when unbound. */
	shortcut: string | null;
	/** Display form of the shortcut the command ships with. Null when it ships unbound. */
	defaultShortcut: string | null;
	enabled: boolean;
}

export interface UpdateStatus {
	state: "idle" | "checking" | "available" | "downloading" | "ready_when_idle" | "error";
	version: string | null;
	/** Where the release notes for `version` are. Null when none are published. */
	notesUrl: string | null;
	error: string | null;
}

/** What happened when an archived workspace came back, so the screen can ask or warn. */
export interface UnarchiveOutcome {
	/** The old branch name is taken now; call again with `branchName`. Nothing changed yet. */
	needsBranchName: boolean;
	/** The worktree came back, but uncommitted changes saved at archive time could not be restored. */
	uncommittedChangesLost: boolean;
}

/** A suggested change: the replacement code and the original lines it replaces. */
export interface CommentSuggestion {
	code: string;
	baseCode: string;
}

/** What a new review comment carries besides its file, lines and text. */
export interface CommentDetails {
	/** Which side of a split diff the line numbers belong to. Default: additions. */
	side?: DiffComment["side"];
	/** Default: none. */
	suggestion?: CommentSuggestion | null;
	/** The comment this one answers. It must belong to the same workspace. Default: none. */
	replyToId?: CommentId | null;
	/** The thread the comment joins, usually the id of the thread's first comment. Default: none. */
	threadId?: string | null;
}

/** For each conflict in a file, top to bottom: keep the current side, the incoming side, or both. */
export type ConflictChoice = "current" | "incoming" | "both";

/** Names one provider key of an agent (see ProviderKeyView). */
export interface ProviderKeyRef {
	agent: AgentKind;
	acpAgent: AcpAgent | null;
	provider: string;
	envVar: string;
}

/** What the feedback form sends. Ours opens the project's issue page with the text filled in. */
export interface FeedbackInput {
	message: string;
	email: string | null;
	imagePaths: string[];
	/** Attach the recent app logs, with secrets removed. */
	includeLogs: boolean;
}

export interface SnippetInput {
	name: string;
	keyword: string | null;
	prompt: string;
}

export interface NewWorkspaceInput {
	repoId: RepoId;
	/** Where to branch from. Default: the repo's default branch on origin. */
	from:
		| { kind: "default" }
		| { kind: "branch"; name: string }
		| { kind: "pull_request"; number: number }
		| { kind: "issue"; provider: "github" | "linear"; id: string };
	/** First message for the first chat. Empty: create the workspace without starting a chat. */
	prompt: string;
	attachmentPaths: string[];
	config: SessionConfig;
	sectionId: SectionId | null;
}

// ---------------------------------------------------------------- queries

export interface Queries {
	useRepos(): Loadable<Repo[]>;
	useRepoConfig(repoId: RepoId): Loadable<RepoConfig>;
	useWorkspaces(): Loadable<Workspace[]>;
	useWorkspace(id: WorkspaceId): Loadable<Workspace>;
	useWorkspaceStatus(id: WorkspaceId): WorkspaceStatus | null;
	useSections(): Loadable<Section[]>;
	useSessions(workspaceId: WorkspaceId): Loadable<Session[]>;
	useChat(sessionId: SessionId): Loadable<ChatView>;
	useDraft(sessionId: SessionId): Draft;
	useGitState(workspaceId: WorkspaceId): Loadable<GitState>;
	useChangedFiles(workspaceId: WorkspaceId, scope: DiffScope): Loadable<ChangedFile[]>;
	useFileDiff(workspaceId: WorkspaceId, path: string, scope: DiffScope): Loadable<FileDiff>;
	useFileTree(workspaceId: WorkspaceId): Loadable<FileEntry[]>;
	useDiffComments(workspaceId: WorkspaceId): Loadable<DiffComment[]>;
	useTerminals(workspaceId: WorkspaceId): Loadable<Terminal[]>;
	useRunState(workspaceId: WorkspaceId): Loadable<RunState>;
	useSetting<T>(key: string): T;
	useAgentInstalls(): Loadable<AgentInstall[]>;
	useModels(agent: AgentKind, acpAgent?: AcpAgent, host?: Host): Loadable<ModelInfo[]>;
	useSlashCommands(sessionId: SessionId): Loadable<SlashCommand[]>;
	useCommands(): CommandEntry[];
	useUpdateStatus(): UpdateStatus;
	/** Commits on the workspace branch that are not on the target branch yet, newest first. */
	useBranchCommits(workspaceId: WorkspaceId): Loadable<BranchCommit[]>;
	/** Branch names of the repository, for the target branch picker. */
	useBranches(repoId: RepoId): Loadable<string[]>;
	/** The log text of one check run of the workspace's pull request. */
	useCheckLog(workspaceId: WorkspaceId, checkName: string): Loadable<string>;
	/** Commits, reviews, comments and status changes of the workspace's pull request. */
	usePullRequestActivity(workspaceId: WorkspaceId): Loadable<PrActivityEntry[]>;
	/** The stacked-PR chain the workspace's pull request belongs to, in order from trunk. */
	useStack(workspaceId: WorkspaceId): Loadable<StackEntryView[]>;
	/** A file read from the workspace folder, for the file viewer. */
	useFileContent(workspaceId: WorkspaceId, path: string): Loadable<FileContent>;
	/** The live connection to one terminal's process. */
	useTerminalConnection(id: TerminalId): Loadable<TerminalConnection>;
	/** The state of the workspace's setup script, for the Setup tab. */
	useSetupState(workspaceId: WorkspaceId): Loadable<SetupView>;
	/** Environment variables of one scope. Values are not included. */
	useEnvVars(scope: EnvScope): Loadable<EnvVarView[]>;
	/** Whether the `gh` command is installed and signed in. */
	useGitHubAccess(): Loadable<GitHubAccess>;
	/** Names of the apps on this Mac that the "Open in" menu can use. */
	useInstalledApps(): Loadable<string[]>;
	/** An "Open in" app's own icon as a PNG data URL; null when the app has no icon file. */
	useAppIcon(appName: string): Loadable<string | null>;
	/** The MCP servers of one chat and their status. */
	useMcpServers(sessionId: SessionId): Loadable<McpServerView[]>;
	/** What the diagnostics screen shows about the app, the machine and the agents. */
	useDiagnostics(): Loadable<DiagnosticsCapture>;
	/** Files and folders of the workspace whose path fuzzy-matches the query. */
	useFileSearch(workspaceId: WorkspaceId, query: string): Loadable<FileEntry[]>;
	/** Lines in the workspace's files that match the query. */
	useContentSearch(
		workspaceId: WorkspaceId,
		query: string,
		options: ContentSearchOptions,
	): Loadable<ContentMatch[]>;
	/** Chats of the workspace that were closed and can be reopened. */
	useClosedSessions(workspaceId: WorkspaceId): Loadable<Session[]>;
	/**
	 * How many files differ between the start of a turn and the working tree now: what a reset to
	 * that turn with "Also reset files" puts back.
	 */
	useChangedSinceTurn(sessionId: SessionId, turnId: TurnId): Loadable<number>;
	/** Workspaces saved to the backlog, not started yet. */
	useBacklogWorkspaces(): Loadable<BacklogWorkspace[]>;
	/** Open issues of a repository's GitHub project or of the user's Linear workspace, filtered by the query. */
	useIssues(repoId: RepoId, provider: IssueView["provider"], query: string): Loadable<IssueView[]>;
	/** Open pull requests of the repository, filtered by the query, for "Create from". */
	usePullRequestList(repoId: RepoId, query: string): Loadable<PullRequestSummary[]>;
	/** Files of the repository's main clone whose path fuzzy-matches the query, before a workspace exists. */
	useRepoFileSearch(repoId: RepoId, query: string): Loadable<FileEntry[]>;
	/** The Artifacts tab: files in the workspace's `.context` folder. */
	useArtifacts(workspaceId: WorkspaceId): Loadable<ArtifactsView>;
	/** Plans agents proposed in the workspace's chats, newest first. */
	usePlans(workspaceId: WorkspaceId): Loadable<PlanEntry[]>;
	/** The user's prompt snippets. */
	useSnippets(): Loadable<Snippet[]>;
	/** The agent programs the app downloads and keeps up to date, with the user's choice for each. */
	useAgentPrograms(): Loadable<AgentProgramView[]>;
	/** The helper programs the app downloads for its own commands (gh and watchexec). */
	useHelperPrograms(): Loadable<AgentProgramView[]>;
	/** The provider keys of an agent, without their values. */
	useProviderKeys(agent: AgentKind, acpAgent?: AcpAgent): Loadable<ProviderKeyView[]>;
	/** The providers an agent can use and the variables for their keys. */
	useAgentProviders(agent: AgentKind, acpAgent?: AcpAgent): Loadable<AgentProvider[]>;
	/** An ACP chat's own options beyond the model. Empty for other agents. */
	useAcpConfigOptions(sessionId: SessionId): Loadable<AcpConfigOption[]>;
	/** Claude's settings file or Codex's config file, for the editors on the Agents page. */
	useAgentConfigFile(agent: AgentConfigFile["agent"]): Loadable<AgentConfigFile>;
	/** What "Sync agent configs" would change, copying from one agent to the other. */
	useConfigSyncPreview(
		from: "claude" | "codex",
		categories: readonly ConfigSyncCategory[],
	): Loadable<ConfigSyncChange[]>;
	/** The GitHub accounts and organisations the user can clone from or create repositories under. */
	useGitHubOwners(): Loadable<GitHubOwner[]>;
	/** Repositories of a GitHub owner (the user's own when null), filtered by the query. */
	useGitHubRepos(owner: string | null, query: string): Loadable<GitHubRepoSummary[]>;
	/** Whether a repository name is free under an owner, for the quick start form. */
	useRepoNameCheck(owner: string, name: string): Loadable<RepoNameCheck>;
	/** Whether a Linear key is set and accepted. */
	useLinearAccess(): Loadable<LinearAccess>;
	/** The Worker this Mac is paired with, for the Connections page (CLOUD-07). */
	useCloudPairing(): Loadable<CloudPairing>;
	/** The terminals of a repository's main clone (the repository terminal and its earlier runs). */
	useRepoTerminals(repoId: RepoId): Loadable<Terminal[]>;
	/** The macOS version and CPU, for the old-system and wrong-build warnings. */
	useSystemInfo(): Loadable<SystemInfo>;
	/** Whether the app has Full Disk Access. */
	useFullDiskAccess(): Loadable<boolean>;
}

// ---------------------------------------------------------------- actions

type Act<A extends unknown[] = [], T = void> = (...args: A) => Promise<Result<T>>;

export interface Actions {
	projects: {
		addLocal: Act<[path: string], Repo>;
		clone: Act<[url: string, parentDir: string], Repo>;
		createFromTemplate: Act<[name: string, parentDir: string, template: string], Repo>;
		/** Creates a GitHub repository for a local project and pushes it. Returns the repository URL. */
		createGitHubRepo: Act<
			[repoId: RepoId, input: { owner: string; name: string; isPrivate: boolean }],
			string
		>;
		remove: Act<[repoId: RepoId]>;
		/** The branch new workspaces of this project start from (SET-07). */
		setDefaultBranch: Act<[repoId: RepoId, branch: string]>;
		/** Saves the sidebar's project order by drag (NAV-04). */
		reorder: Act<[orderedIds: RepoId[]]>;
		updateConfig: Act<[repoId: RepoId, config: RepoConfig]>;
		setIcon: Act<[repoId: RepoId, icon: RepoIconChoice]>;
		/** Drops this Mac's change to a shared run action, so the shared version applies again. */
		resetRunAction: Act<[repoId: RepoId, actionId: string]>;
		/** Hides or shows a run action for this user only. */
		setRunActionHidden: Act<[repoId: RepoId, actionId: string, hidden: boolean]>;
	};
	workspaces: {
		create: Act<[input: NewWorkspaceInput], Workspace>;
		archive: Act<[id: WorkspaceId, options: { deleteBranch: boolean }]>;
		/** `clearChats` is "Clear & unarchive": the chats are removed before the workspace comes back. */
		unarchive: Act<
			[id: WorkspaceId, options: { branchName: string | null; clearChats: boolean }],
			UnarchiveOutcome
		>;
		remove: Act<[id: WorkspaceId]>;
		rename: Act<[id: WorkspaceId, name: string]>;
		setPinned: Act<[id: WorkspaceId, pinned: boolean]>;
		setKanbanStatus: Act<[id: WorkspaceId, status: KanbanStatus]>;
		setTargetBranch: Act<[id: WorkspaceId, branch: string]>;
		setLinkedPaths: Act<[id: WorkspaceId, paths: string[]]>;
		openIn: Act<[id: WorkspaceId, appName: string]>;
		markRead: Act<[id: WorkspaceId]>;
		markUnread: Act<[id: WorkspaceId]>;
		/** Remembers the open chat tab, so it is open again after a restart. */
		setActiveSession: Act<[id: WorkspaceId, sessionId: SessionId]>;
		/** Runs setup again for a workspace whose setup or creation failed. */
		retrySetup: Act<[id: WorkspaceId]>;
		/** The first message of a workspace whose creation failed, so the user can send it again. */
		recoverPrompt: Act<[id: WorkspaceId], Draft>;
		/** Saves a workspace without making a worktree. */
		addToBacklog: Act<[input: NewWorkspaceInput], BacklogWorkspace>;
		/** Starts a backlog workspace: worktree, setup, and the first message. */
		startFromBacklog: Act<[id: WorkspaceId], Workspace>;
		removeFromBacklog: Act<[id: WorkspaceId]>;
		/** Chooses the repository a backlog workspace starts in, when its own was removed. */
		setBacklogRepo: Act<[id: WorkspaceId, repoId: RepoId]>;
	};
	sections: {
		create: Act<[name: string, emoji: string | null], Section>;
		rename: Act<[id: SectionId, name: string, emoji: string | null]>;
		remove: Act<[id: SectionId]>;
		/** Moves a workspace into a section (or out, with null) at a position. */
		place: Act<[workspaceId: WorkspaceId, sectionId: SectionId | null, position: number]>;
		reorder: Act<[orderedIds: SectionId[]]>;
		setCollapsed: Act<[id: SectionId, collapsed: boolean]>;
	};
	sessions: {
		create: Act<[workspaceId: WorkspaceId, config: SessionConfig], Session>;
		close: Act<[id: SessionId]>;
		reopen: Act<[id: SessionId]>;
		rename: Act<[id: SessionId, title: string]>;
		/** Sends now, queues, or steers, depending on state and the follow-up setting. */
		send: Act<
			[id: SessionId, text: string, attachmentPaths: string[], delivery: "auto" | "queue" | "steer"]
		>;
		cancel: Act<[id: SessionId]>;
		answer: Act<[id: SessionId, interactionId: InteractionId, answer: InteractionAnswer]>;
		updateConfig: Act<[id: SessionId, config: SessionConfig]>;
		revertTo: Act<[id: SessionId, turnId: TurnId]>;
		forkFrom: Act<[id: SessionId, turnId: TurnId], Session>;
		saveDraft: (id: SessionId, draft: Draft) => void;
		copyTranscript: Act<[id: SessionId, detail: "concise" | "full"]>;
		/**
		 * Sends an approved plan to a chat that carries it out ("Hand off"): the chosen one, or a new
		 * chat when `target` is null. Returns that chat.
		 */
		startFromPlan: Act<[id: SessionId, planText: string, target: SessionId | null], Session>;
		markRead: Act<[id: SessionId]>;
		markUnread: Act<[id: SessionId]>;
		/** Sends a message that failed to send ("Message not sent") again. */
		retryFailedSend: Act<[id: SessionId, messageId: MessageId]>;
		/** Drops a message that failed to send, and puts its text back in the composer. */
		discardFailedSend: Act<[id: SessionId, messageId: MessageId]>;
		/** Retries a failed turn's message in a new chat of the same workspace. */
		retryInNewChat: Act<[id: SessionId, turnId: TurnId], Session>;
		/** Stops the agent and starts it again with the chat's history (/restart). */
		restartAgent: Act<[id: SessionId]>;
		/** Asks the agent to summarise its context now (/compact). */
		compact: Act<[id: SessionId]>;
		/** Turns auto-approval of file edits on or off for the live chat. */
		setAutoApproveEdits: Act<[id: SessionId, enabled: boolean]>;
		/** Sets one of an ACP chat's own options. */
		setAcpOption: Act<[id: SessionId, optionId: string, value: string | boolean]>;
		/** Creates a workspace from a turn's checkpoint and moves a copy of the chat there. */
		forkToWorkspace: Act<[id: SessionId, turnId: TurnId], Workspace>;
		/** The Codex goal bar and /goal. */
		goal: {
			set: Act<[id: SessionId, objective: string]>;
			change: Act<[id: SessionId, action: "pause" | "resume" | "clear"]>;
		};
		queue: {
			edit: Act<[messageId: MessageId, text: string]>;
			remove: Act<[messageId: MessageId]>;
			reorder: Act<[sessionId: SessionId, orderedIds: MessageId[]]>;
			setPaused: Act<[sessionId: SessionId, paused: boolean]>;
			sendNowAsSteer: Act<[messageId: MessageId]>;
			/** Sends a queued message that failed to send again, once the chat can take it. */
			retry: Act<[messageId: MessageId]>;
		};
	};
	git: {
		/** Asks the agent to commit and push, in the active chat. */
		commitAndPush: Act<[workspaceId: WorkspaceId]>;
		pull: Act<[workspaceId: WorkspaceId]>;
		push: Act<[workspaceId: WorkspaceId]>;
		/** Asks the agent to resolve conflicts, in the active chat. */
		resolveConflicts: Act<[workspaceId: WorkspaceId]>;
		renameBranch: Act<[workspaceId: WorkspaceId, name: string]>;
		discardFile: Act<[workspaceId: WorkspaceId, path: string]>;
		setViewed: Act<[workspaceId: WorkspaceId, path: string, viewed: boolean]>;
		/** Fetches, checks out another branch and fast-forwards it. */
		switchBranch: Act<[workspaceId: WorkspaceId, branch: string]>;
		/**
		 * "Continue" after a merge or from a detached HEAD: a new branch from the target (or from
		 * HEAD), keeping the chats. Null name: a generated one.
		 */
		continueOnNewBranch: Act<[workspaceId: WorkspaceId, name: string | null]>;
		/** Opens the file's diff in the external diff tool chosen in settings. */
		openInDiffTool: Act<[workspaceId: WorkspaceId, path: string]>;
		/** The workspace's sparse checkout and the top-level folders it can include. */
		sparseCheckoutSettings: Act<[workspaceId: WorkspaceId], SparseCheckoutSettings>;
		/** Includes only these directories in the worktree. An empty list turns sparse checkout off. */
		setSparseCheckoutDirectories: Act<[workspaceId: WorkspaceId, directories: string[]]>;
	};
	pullRequests: {
		/** Asks the agent to open the PR, with written instructions; `draft` asks for a draft PR. */
		create: Act<[workspaceId: WorkspaceId, options: { draft: boolean }]>;
		markReady: Act<[workspaceId: WorkspaceId]>;
		merge: Act<[workspaceId: WorkspaceId]>;
		setAutoMerge: Act<[workspaceId: WorkspaceId, enabled: boolean]>;
		approve: Act<[workspaceId: WorkspaceId]>;
		/** Sends failing checks and their logs to the agent. */
		fixErrors: Act<[workspaceId: WorkspaceId]>;
		rerunFailedChecks: Act<[workspaceId: WorkspaceId]>;
		updateTitleAndBody: Act<[workspaceId: WorkspaceId, title: string, body: string]>;
		/** Starts a new chat that reviews the workspace diff. */
		requestAiReview: Act<[workspaceId: WorkspaceId, extraInstructions: string | null], Session>;
		/** Asks these GitHub users for a review. */
		requestReview: Act<[workspaceId: WorkspaceId, logins: string[]]>;
		removeReviewRequest: Act<[workspaceId: WorkspaceId, login: string]>;
		/** Links an existing pull request by its URL or number. */
		link: Act<[workspaceId: WorkspaceId, urlOrNumber: string]>;
		/** Opens GitHub's page for creating a pull request from the workspace branch. */
		openOnGithub: Act<[workspaceId: WorkspaceId]>;
		/** Brings every branch of the workspace's GitHub stack up to date (`gh stack sync`). */
		syncStack: Act<[workspaceId: WorkspaceId]>;
		/** Merges the workspace's GitHub stack ("Merge stack"). */
		mergeStack: Act<[workspaceId: WorkspaceId]>;
	};
	issues: {
		/** Writes the issue as a context file in the workspace and returns its path. */
		attachToWorkspace: Act<
			[workspaceId: WorkspaceId, issue: Pick<IssueView, "provider" | "id">],
			string
		>;
	};
	comments: {
		/** A null file makes a comment on the pull request itself. */
		add: Act<
			[
				workspaceId: WorkspaceId,
				file: string | null,
				line: number | null,
				endLine: number | null,
				body: string,
				details?: CommentDetails,
			],
			DiffComment
		>;
		/**
		 * Changes a comment's text, and its suggested change when `suggestion` is given (null removes
		 * it). An edit never moves a comment to another side or thread.
		 */
		edit: Act<[id: CommentId, body: string, details?: Pick<CommentDetails, "suggestion">]>;
		remove: Act<[id: CommentId]>;
		setResolved: Act<[id: CommentId, resolved: boolean]>;
		/** Hides a comment, or brings it back. A hidden GitHub comment stays hidden after a sync. */
		setHidden: Act<[id: CommentId, hidden: boolean]>;
		/** Marks every pending comment of the workspace ready for review. */
		markAllReady: Act<[workspaceId: WorkspaceId]>;
		/** Puts the open comments into the active chat's composer. */
		sendToChat: Act<[workspaceId: WorkspaceId, ids: CommentId[]]>;
	};
	run: {
		start: Act<[workspaceId: WorkspaceId, actionId: string]>;
		stop: Act<[workspaceId: WorkspaceId, actionId: string]>;
		startSpotlight: Act<[workspaceId: WorkspaceId]>;
		stopSpotlight: Act<[workspaceId: WorkspaceId]>;
		/** Brings the app that listens on a detected port to the front, instead of opening a new window. */
		activateApp: Act<[workspaceId: WorkspaceId, port: number]>;
	};
	terminals: {
		/** `command` is typed into the new shell when it starts. */
		create: Act<[workspaceId: WorkspaceId, options?: { command?: string }], Terminal>;
		/** Opens the repository's terminal in its main clone, creating it the first time. */
		openForRepo: Act<[repoId: RepoId], Terminal>;
		/** Starts a new shell in a terminal whose shell has ended, below a divider line. */
		restart: Act<[id: TerminalId]>;
		/** Runs a shell code block from the chat in a new terminal and returns it. */
		runCommand: Act<[workspaceId: WorkspaceId, command: string], Terminal>;
		close: Act<[id: TerminalId]>;
	};
	files: {
		/**
		 * Saves a file. Fails with code "changed_on_disk" (a FileWriteErrorCode) when the file changed
		 * since `expectedModifiedAt`.
		 */
		write: Act<
			[workspaceId: WorkspaceId, path: string, text: string, expectedModifiedAt: number],
			{ modifiedAt: number }
		>;
		/** Puts files from the workspace into the active chat's composer. */
		attachToChat: Act<[workspaceId: WorkspaceId, paths: string[]]>;
		/** Opens a file in the app's file tab, as a diff or in the editor. */
		open: Act<[workspaceId: WorkspaceId, path: string, mode: "diff" | "edit", scope: DiffScope]>;
		/**
		 * Resolves the conflicts of a file with one choice per conflict, saves it, and stages it when
		 * no conflict markers remain. `seenText` is the text the choices were made on; a file that no
		 * longer holds it is refused unchanged.
		 */
		resolveConflicts: Act<
			[workspaceId: WorkspaceId, path: string, choices: ConflictChoice[], seenText: string]
		>;
		/** Shows a workspace file selected in a Finder window. */
		reveal: Act<[workspaceId: WorkspaceId, path: string]>;
		/** Opens a workspace file in the named app, the one the "Open in" menu opens by default. */
		openInApp: Act<[workspaceId: WorkspaceId, path: string, appName: string]>;
	};
	artifacts: {
		/** Loads the next page of the Artifacts tab. */
		loadMore: Act<[workspaceId: WorkspaceId]>;
		/** Copies files into the workspace's `.context` folder. */
		upload: Act<[workspaceId: WorkspaceId, paths: string[]]>;
	};
	mcp: {
		/** Asks the agent to check its MCP servers again. */
		refresh: Act<[sessionId: SessionId]>;
	};
	attachments: {
		/** Copies files into app storage for a chat and returns where the copies are. */
		add: Act<[sessionId: SessionId, paths: string[]], string[]>;
		/** Attaches another chat's transcript as a file. Fails for a chat with no messages. */
		addChatTranscript: Act<[sessionId: SessionId, fromSessionId: SessionId], string>;
		/** Attaches a plan an agent proposed as a file. */
		addPlan: Act<[sessionId: SessionId, plan: Pick<PlanEntry, "sessionId" | "planId">], string>;
		/** Attaches the current output of the workspace's terminal as a file. */
		addTerminalOutput: Act<[sessionId: SessionId], string>;
		/** Attaches text as a file, for example a terminal selection. */
		addText: Act<[sessionId: SessionId, fileName: string, text: string], string>;
		copyImage: Act<[path: string]>;
		/** Saves a copy where the user picks. Null when the user cancels. */
		saveAs: Act<[path: string], string | null>;
		/** Opens the file in its default macOS app. */
		openExternally: Act<[path: string]>;
	};
	snippets: {
		create: Act<[input: SnippetInput], Snippet>;
		update: Act<[id: SnippetId, input: SnippetInput]>;
		remove: Act<[id: SnippetId]>;
	};
	settings: {
		set: Act<[key: string, value: unknown]>;
		setEnvVar: Act<[name: string, value: string, scope: { repoId: RepoId } | "global"]>;
		removeEnvVar: Act<[name: string, scope: { repoId: RepoId } | "global"]>;
		/**
		 * Removes one repository's own value of a setting from its local settings file, so the
		 * repository's shared settings.toml (or a layer above it) applies again.
		 */
		resetForRepo: Act<[repoId: RepoId, key: string]>;
		/** Where the user's settings file, or one project's local settings file, lives. */
		filePath: Act<[file: "user" | { repoId: RepoId }], string>;
		/** Opens that settings file in the named app, creating it empty when it is missing. */
		openFile: Act<[file: "user" | { repoId: RepoId }, appName: string]>;
	};
	agents: {
		login: Act<[agent: AgentKind, acpAgent?: AcpAgent], AgentLogin>;
		/** Waits for a sign-in to end. A key the agent hands back is stored in the Keychain. */
		finishLogin: Act<
			[loginId: string, code?: string],
			{ outcome: "signed_in" | "failed" | "cancelled"; message: string | null }
		>;
		cancelLogin: Act<[loginId: string]>;
		refresh: Act;
		/** Stores a key typed on the page, or uses the one from this Mac's environment. */
		setProviderKey: Act<
			[key: ProviderKeyRef, value: { kind: "entered"; value: string } | { kind: "this_mac" }]
		>;
		removeProviderKey: Act<[key: ProviderKeyRef]>;
		/** Saves an agent's own settings file. Fails with "changed_on_disk" when it changed since it was read. */
		saveConfigFile: Act<
			[agent: AgentConfigFile["agent"], text: string, expectedModifiedAt: number | null]
		>;
		/** Copies MCP servers, slash commands or skills from one agent's config to the other's. */
		syncConfigs: Act<
			[from: "claude" | "codex", categories: ConfigSyncCategory[]],
			ConfigSyncResult
		>;
	};
	programs: {
		/** Downloads and installs a program. Also the Retry after a failed download. */
		install: Act<[program: ManagedProgram]>;
		redownload: Act<[program: ManagedProgram]>;
		remove: Act<[program: ManagedProgram]>;
	};
	accounts: {
		/** Stores the GitHub token `gh` uses (D029), or removes it with null. */
		setGitHubToken: Act<[token: string | null]>;
		/** Stores the personal Linear API key (D035), or removes it with null. */
		setLinearKey: Act<[key: string | null]>;
	};
	cloud: {
		/** Checks the URL and token with the Worker, then keeps them in the Keychain (CLOUD-07). */
		pair: Act<[input: CloudPairInput], CloudPairing>;
		/** Removes this Mac's pairing with its Worker. */
		unpair: Act<[], void>;
		/** Deploys the app's bundled Worker to the user's account and pairs this Mac (CLOUD-08). */
		deploy: Act<[], CloudDeployResult>;
		/** Deletes the Worker, its container application and its bucket, and unpairs (CLOUD-08). */
		uninstall: Act<[], void>;
	};
	app: {
		runCommand: Act<[commandId: string]>;
		checkForUpdates: Act;
		installUpdate: Act;
		exportLogs: Act<[], string>;
		openUrl: Act<[url: string]>;
		/** Shows the system folder dialog. The result is null when the user cancels. */
		pickFolder: Act<[title: string], string | null>;
		/** Shows the system dialog for one file. The result is null when the user cancels. */
		pickFile: Act<[title: string], string | null>;
		recheckGitHubAccess: Act;
		/** Writes the redacted diagnostics report to a file and starts a chat with it attached. */
		createDiagnosticsChat: Act<[workspaceId: WorkspaceId]>;
		copyText: Act<[text: string]>;
		sendFeedback: Act<[input: FeedbackInput]>;
		openSidecarLogs: Act;
		openFullDiskAccessSettings: Act;
		/** Plays a completion sound now, for the General page's "Test". */
		testCompletionSound: Act<[soundId: string]>;
		/** Opens a terminal that runs the Xcode licence command, when git is blocked by it. */
		runXcodeLicenseFix: Act;
	};
}
