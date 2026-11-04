/**
 * @feature CHAT-18 Handlers for what the sidecar tells and asks the UI
 * Owns: one handler per method of `sidecarToAppRequests` and one per notification of
 * `sidecarToAppNotifications`. Each handler only translates between the wire shape and a service
 * call; the work lives in the services named in the ports below.
 * Behaviour: sessions.md 5 and 6 (event flow, interactions), sessions.md 10 (wire contract),
 * services-map.md 5A.7.2 (diff comment tools), 5A.1.3 (GetTerminalOutput), 3.4.6 (agent-facing
 * diff), claude-runner.md 3 and 4 (what each app tool needs from the UI).
 * Must handle: `requestInteraction` stays open until the user answers, the sidecar withdraws it, or
 * its `expiresAt` passes (a later request for the same chat replaces the open one); when the
 * sidecar reconnects, open interactions are asked again, so a handler must accept the same
 * interaction id twice; `deliverEvent` answers `persisted: true` only after ingest committed the
 * event; `getWorkspaceDiff` reports "merge or rebase in progress" as text, not as an RPC error;
 * `addDiffComments` creates comments with author kind "agent"; `getTerminalOutput` source
 * "auto" prefers the Spotlight terminal, then the run terminal, then the newest terminal; a
 * session id the UI does not know gets a clear error text, never a crash; `interactionClosed`
 * marks a Codex request that expired as timed out, and brings a card back when its answer could
 * not be delivered; `agentConfigChanged` stores the config the agent switched to (plan mode).
 * Our design choice: handlers receive ports (small interfaces), not services, so each can be
 * tested with a plain object. Errors the agent should read go into the normal result as text.
 * Test first: a deliverEvent request for a stored event answers persisted true and sends the ack.
 */
import type {
	InteractionAnswer,
	InteractionRequest,
	SessionEventEnvelope,
} from "@conducted/protocol";
import { notImplemented, type Result, type SessionId } from "@conducted/shared";
import type { IngestOutcome } from "./ingest.ts";
import type {
	SidecarNotificationHandlers,
	SidecarRequestHandlers,
	SidecarToAppNotificationParams,
	SidecarToAppParams,
	SidecarToAppResult,
} from "./tunnel.ts";

// ---------------------------------------------------------------- ports

export interface InteractionPort {
	/** Shows the card and resolves with the user's answer, or `withdrawn` when it was cancelled. */
	request(request: InteractionRequest): Promise<InteractionAnswer>;
}

export interface IngestPort {
	ingest(envelope: SessionEventEnvelope): Promise<Result<IngestOutcome>>;
}

export interface LiveStatePort {
	setLiveState(params: SidecarToAppNotificationParams<"liveState">): void;
	setAgentSessionId(
		params: SidecarToAppNotificationParams<"agentSessionId">,
	): Promise<Result<void>>;
	setProgress(params: SidecarToAppNotificationParams<"progress">): void;
}

export interface AgentCatalogPort {
	setAgentInstalls(params: SidecarToAppNotificationParams<"agentInstallsChanged">): void;
}

export interface WorkspaceDiffPort {
	/** The diff the user sees, against the merge base, for the workspace of this chat. */
	diffForSession(
		sessionId: SessionId,
		file: string | undefined,
		statOnly: boolean,
	): Promise<Result<string>>;
}

export interface DiffCommentsPort {
	forSession(
		sessionId: SessionId,
		file: string | undefined,
	): Promise<Result<SidecarToAppResult<"getDiffComments">["comments"]>>;
	addForSession(
		sessionId: SessionId,
		comments: SidecarToAppParams<"addDiffComments">["comments"],
	): Promise<Result<number>>;
}

export interface TerminalOutputPort {
	outputForSession(
		sessionId: SessionId,
		source: SidecarToAppParams<"getTerminalOutput">["source"],
		maxLines: number,
	): Promise<Result<SidecarToAppResult<"getTerminalOutput">>>;
}

export interface TargetBranchPort {
	setForSession(sessionId: SessionId, branch: string): Promise<Result<void>>;
}

export interface SidecarHandlerPorts {
	interactions: InteractionPort;
	ingest: IngestPort;
	liveState: LiveStatePort;
	agentCatalog: AgentCatalogPort;
	workspaceDiff: WorkspaceDiffPort;
	diffComments: DiffCommentsPort;
	terminalOutput: TerminalOutputPort;
	targetBranch: TargetBranchPort;
}

// ---------------------------------------------------------------- requests (sidecar asks the UI)

export function createSidecarRequestHandlers(_ports: SidecarHandlerPorts): SidecarRequestHandlers {
	return {
		requestInteraction: () => notImplemented("CHAT-10"),
		deliverEvent: () => notImplemented("DATA-04"),
		getWorkspaceDiff: () => notImplemented("REV-01"),
		getDiffComments: () => notImplemented("REV-03"),
		addDiffComments: () => notImplemented("REV-03"),
		getTerminalOutput: () => notImplemented("RUN-07"),
		setTargetBranch: () => notImplemented("GIT-08"),
	};
}

// ---------------------------------------------------------------- notifications (sidecar tells the UI)

export function createSidecarNotificationHandlers(
	_ports: SidecarHandlerPorts,
): SidecarNotificationHandlers {
	return {
		sessionEvent: () => notImplemented("DATA-04"),
		liveState: () => notImplemented("CHAT-18"),
		agentSessionId: () => notImplemented("CHAT-02"),
		progress: () => notImplemented("CHAT-13"),
		agentInstallsChanged: () => notImplemented("SET-03"),
		agentConfigChanged: () => notImplemented("SIDE-20"),
		interactionClosed: () => notImplemented("CHAT-11"),
		goalChanged: () => notImplemented("COMP-10"),
		shellEnvFailed: () => notImplemented("SIDE-10"),
	};
}
