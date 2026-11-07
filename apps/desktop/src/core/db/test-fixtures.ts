/**
 * @feature DATA-01 Sample values for the repository tests
 * Owns: one valid example of every stored entity, shared by rows.test.ts and schema.test.ts so
 * the two tests agree on what a good row looks like.
 * Behaviour: migrations 0001 to 0004 and the models in core/model.ts.
 * Must handle: nothing at runtime. Only test files import this module.
 * Test first: not applicable, it holds data only.
 */
import type { SessionEvent } from "@conducted/protocol";
import type {
	AttachmentId,
	CommentId,
	EventId,
	MessageId,
	RepoId,
	SectionId,
	SessionId,
	TerminalId,
	TurnId,
	WorkspaceId,
} from "@conducted/shared";
import type {
	Attachment,
	DiffComment,
	QueuedMessage,
	Repo,
	Section,
	Session,
	Terminal,
	Workspace,
} from "../model.ts";

export const repoId = "repo-1" as RepoId;
export const workspaceId = "ws-1" as WorkspaceId;
export const sessionId = "chat-1" as SessionId;

export const sessionConfig: Session["config"] = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: ["/tmp/extra"],
	appTools: { diffComments: true, progressUpdates: false, setTargetBranch: true },
};

export const sampleRepo: Repo = {
	id: repoId,
	name: "conducted",
	rootPath: "/code/conducted",
	remoteUrl: "git@github.com:jahala/conducted.git",
	defaultBranch: "main",
	icon: null,
	displayOrder: 2,
	hidden: true,
	createdAt: 1000,
	updatedAt: 2000,
};

export const sampleWorkspace: Workspace & { setupLogPath: string | null } = {
	id: workspaceId,
	repoId,
	directoryName: "oslo",
	path: "/code/workspaces/oslo",
	branch: "jahala/oslo",
	branchIsPlaceholder: true,
	host: { kind: "local" },
	displayName: null,
	targetBranch: "origin/main",
	state: "ready",
	kanbanStatus: "in_progress",
	port: 55100,
	pinnedAt: 1500,
	linkedPaths: ["/code/other", "/code/shared"],
	prNumber: 12,
	prTitle: "Add repositories",
	prDescription: null,
	archiveCommit: null,
	archivedAt: null,
	activeSessionId: null,
	filesCopied: 3,
	lastActivityAt: 3000,
	createdAt: 1000,
	updatedAt: 3000,
	setupLogPath: "/data/setup-logs/ws-1.log",
};

export const sampleSession: Session = {
	id: sessionId,
	workspaceId,
	title: "First chat",
	config: sessionConfig,
	agentSessionId: "agent-abc",
	forkResumeNativeMessageId: null,
	unreadCount: 3,
	contextUsedTokens: 1200,
	contextWindowTokens: 200000,
	queuePausedAt: null,
	closedAt: null,
	lastUserMessageAt: 4000,
	createdAt: 1000,
	updatedAt: 4000,
};

export const turnId = "turn-1" as TurnId;

export const userMessageEvent = (id: string, turn: string, at: number): SessionEvent => ({
	type: "user_message",
	eventId: id as EventId,
	at,
	messageId: `msg-${id}` as MessageId,
	turnId: turn as TurnId,
	text: "Fix the login bug",
	attachmentPaths: [],
	delivery: "new_turn",
	config: sessionConfig,
});

export const turnEndedEvent = (id: string, turn: string, at: number): SessionEvent => ({
	type: "turn_ended",
	eventId: id as EventId,
	at,
	turnId: turn as TurnId,
	outcome: "success",
});

/** An agent event with the given items, written the way the sidecar sends them. */
export const agentEvent = (
	id: string,
	turn: string,
	at: number,
	items: Extract<SessionEvent, { type: "agent" }>["message"]["items"],
): SessionEvent => ({
	type: "agent",
	eventId: id as EventId,
	at,
	turnId: turn as TurnId,
	message: { agent: "claude", items, raw: { big: "payload" } },
});

export const sampleQueued: QueuedMessage = {
	id: "msg-q1" as MessageId,
	sessionId,
	text: "Also add a test",
	attachmentPaths: ["/data/draft-attachments/chat-1/a.png"],
	delivery: "steer",
	position: 2,
	state: "failed",
	lastError: "sidecar offline",
};

export const sampleComment: DiffComment = {
	id: "c-1" as CommentId,
	workspaceId,
	filePath: "src/app.ts",
	line: 10,
	endLine: 12,
	body: "Rename this",
	author: {
		kind: "github",
		name: "octocat",
		avatarUrl: "https://avatars.githubusercontent.com/u/583231",
	},
	state: "hidden",
	side: "deletions",
	threadId: "thread-1",
	replyToId: null,
	suggestion: "const name = 1;",
	suggestionBaseCode: "let name = 0;",
	remoteUrl: "https://github.com/x/y/pull/1#c1",
	resolved: true,
	outdated: false,
	createdAt: 1000,
	updatedAt: 1100,
};

export const sampleAttachment: Attachment & { messageId: string | null; createdAt: number } = {
	id: "att-1" as AttachmentId,
	sessionId,
	kind: "image",
	originalName: "shot.png",
	path: "/data/draft-attachments/chat-1/shot.png",
	isDraft: true,
	commentId: null,
	messageId: null,
	createdAt: 1000,
};

export const sampleTerminal: Terminal & { screenState: string | null } = {
	id: "term-1" as TerminalId,
	workspaceId,
	repoId: null,
	kind: "run",
	title: "dev server",
	cwd: "/code/workspaces/oslo",
	startCommand: "bun dev",
	screenState: null,
	startedAt: 1000,
	endedAt: null,
	exitCode: null,
};

export const sampleSection: Section = {
	id: "sec-1" as SectionId,
	name: "Review",
	emoji: "eyes",
	position: 1,
	collapsed: true,
	workspaceIds: [],
};
