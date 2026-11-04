/**
 * @feature DATA-01 The contract between screens and services
 * Owns: the shape of every query hook and action that screens may use. Screens import hooks from
 * core/hooks.ts and never reach past them. Services implement them.
 * Behaviour: services-map.md part 1 (14 services over stores), ui-map.md (what each screen needs).
 * Our design choice: one typed API object instead of 14 singleton facades, so screens can be
 * tested by passing a different implementation.
 */
import type {
	AgentInstall,
	FileChange,
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
	MessageId,
	RepoId,
	Result,
	SectionId,
	SessionId,
	TerminalId,
	TurnId,
	WorkspaceId,
} from "@conducted/shared";
import type {
	ChatView,
	DiffComment,
	GitState,
	KanbanStatus,
	Repo,
	RepoConfig,
	Section,
	Session,
	Terminal,
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
	| { kind: "turn"; sessionId: SessionId; turnId: TurnId };

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

export interface RunState {
	actions: { id: string; label: string; command: string }[];
	running: { actionId: string; terminalId: TerminalId; url: string | null }[];
	spotlight: { active: boolean; terminalId: TerminalId | null };
	detectedPorts: number[];
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
	enabled: boolean;
}

export interface UpdateStatus {
	state: "idle" | "checking" | "available" | "downloading" | "ready_when_idle" | "error";
	version: string | null;
	error: string | null;
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
	useFileTree(workspaceId: WorkspaceId): Loadable<{ path: string; isDirectory: boolean }[]>;
	useDiffComments(workspaceId: WorkspaceId): Loadable<DiffComment[]>;
	useTerminals(workspaceId: WorkspaceId): Loadable<Terminal[]>;
	useRunState(workspaceId: WorkspaceId): Loadable<RunState>;
	useSetting<T>(key: string): T;
	useAgentInstalls(): Loadable<AgentInstall[]>;
	useModels(agent: AgentKind, acpAgent?: AcpAgent): Loadable<ModelInfo[]>;
	useSlashCommands(sessionId: SessionId): Loadable<SlashCommand[]>;
	useCommands(): CommandEntry[];
	useUpdateStatus(): UpdateStatus;
}

// ---------------------------------------------------------------- actions

type Act<A extends unknown[] = [], T = void> = (...args: A) => Promise<Result<T>>;

export interface Actions {
	projects: {
		addLocal: Act<[path: string], Repo>;
		clone: Act<[url: string, parentDir: string], Repo>;
		createFromTemplate: Act<[name: string, parentDir: string, template: string], Repo>;
		remove: Act<[repoId: RepoId]>;
		updateConfig: Act<[repoId: RepoId, config: RepoConfig]>;
	};
	workspaces: {
		create: Act<[input: NewWorkspaceInput], Workspace>;
		archive: Act<[id: WorkspaceId, options: { deleteBranch: boolean }]>;
		unarchive: Act<[id: WorkspaceId]>;
		remove: Act<[id: WorkspaceId]>;
		rename: Act<[id: WorkspaceId, name: string]>;
		setPinned: Act<[id: WorkspaceId, pinned: boolean]>;
		setKanbanStatus: Act<[id: WorkspaceId, status: KanbanStatus]>;
		setTargetBranch: Act<[id: WorkspaceId, branch: string]>;
		setLinkedPaths: Act<[id: WorkspaceId, paths: string[]]>;
		openIn: Act<[id: WorkspaceId, appName: string]>;
		markRead: Act<[id: WorkspaceId]>;
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
		queue: {
			edit: Act<[messageId: MessageId, text: string]>;
			remove: Act<[messageId: MessageId]>;
			reorder: Act<[sessionId: SessionId, orderedIds: MessageId[]]>;
			setPaused: Act<[sessionId: SessionId, paused: boolean]>;
			sendNowAsSteer: Act<[messageId: MessageId]>;
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
	};
	pullRequests: {
		/** Asks the agent to open the PR, with written instructions. */
		create: Act<[workspaceId: WorkspaceId]>;
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
	};
	comments: {
		add: Act<
			[
				workspaceId: WorkspaceId,
				file: string,
				line: number | null,
				endLine: number | null,
				body: string,
			],
			DiffComment
		>;
		edit: Act<[id: CommentId, body: string]>;
		remove: Act<[id: CommentId]>;
		setResolved: Act<[id: CommentId, resolved: boolean]>;
		/** Puts the open comments into the active chat's composer. */
		sendToChat: Act<[workspaceId: WorkspaceId, ids: CommentId[]]>;
	};
	run: {
		start: Act<[workspaceId: WorkspaceId, actionId: string]>;
		stop: Act<[workspaceId: WorkspaceId, actionId: string]>;
		startSpotlight: Act<[workspaceId: WorkspaceId]>;
		stopSpotlight: Act<[workspaceId: WorkspaceId]>;
	};
	terminals: {
		create: Act<[workspaceId: WorkspaceId], Terminal>;
		close: Act<[id: TerminalId]>;
	};
	settings: {
		set: Act<[key: string, value: unknown]>;
		setEnvVar: Act<[name: string, value: string, scope: { repoId: RepoId } | "global"]>;
		removeEnvVar: Act<[name: string, scope: { repoId: RepoId } | "global"]>;
	};
	agents: {
		login: Act<
			[agent: AgentKind, acpAgent?: AcpAgent],
			{ url?: string; code?: string; instructions: string }
		>;
		refresh: Act;
	};
	app: {
		runCommand: Act<[commandId: string]>;
		checkForUpdates: Act;
		installUpdate: Act;
		exportLogs: Act<[], string>;
		openUrl: Act<[url: string]>;
	};
}
