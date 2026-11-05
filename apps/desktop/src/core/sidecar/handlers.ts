/**
 * @feature CHAT-18 Handlers for what the sidecar tells and asks the UI
 * Owns: one handler per method of `sidecarToAppRequests` and one per notification of
 * `sidecarToAppNotifications`. Each handler only translates between the wire shape and a service
 * call; the work lives in the services named in the ports below.
 * Behaviour: sessions.md 5 and 6 (event flow, interactions), sessions.md 10 (wire contract),
 * services-map.md 5A.7.2 (diff comment tools), 5A.1.3 (GetTerminalOutput), 3.4.6 (agent-facing
 * diff), claude-runner.md 3 and 4 (what each app tool needs from the UI).
 * Must handle: `deliverEvent` answers `persisted: true` only after ingest committed the event
 * (ingest logs its own write failures and returns them in the result); `liveState` shows the
 * adopted status and any open interaction, and a failed live-state write is thrown so the tunnel
 * logs it; `agentSessionId` stores the agent's own session id so the next message resumes, and a
 * failed write is thrown so the tunnel logs it; `agentInstallsChanged` updates the agent catalog;
 * `shellEnvFailed` logs the folder, kind and message; a failed workspace diff becomes error text
 * the agent can read instead of a crash.
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
	setLiveState(params: SidecarToAppNotificationParams<"liveState">): Promise<Result<void>>;
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

export interface ShellEnvPort {
	/** Logs that a folder's login-shell environment could not be captured. */
	captureFailed(params: SidecarToAppNotificationParams<"shellEnvFailed">): void;
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
	shellEnv: ShellEnvPort;
}

// ---------------------------------------------------------------- requests (sidecar asks the UI)

export function createSidecarRequestHandlers(ports: SidecarHandlerPorts): SidecarRequestHandlers {
	return {
		requestInteraction: (params) => ports.interactions.request(params),
		deliverEvent: async (envelope) => {
			const stored = await ports.ingest.ingest(envelope);
			return { persisted: stored.ok };
		},
		getWorkspaceDiff: async (params) => {
			const result = await ports.workspaceDiff.diffForSession(
				params.sessionId,
				params.file,
				params.statOnly,
			);
			return { diff: result.ok ? result.value : result.error.message };
		},
		getDiffComments: () => notImplemented("REV-03"),
		addDiffComments: () => notImplemented("REV-03"),
		getTerminalOutput: async (params) => {
			const result = await ports.terminalOutput.outputForSession(
				params.sessionId,
				params.source,
				params.maxLines,
			);
			if (result.ok) return result.value;
			return { output: result.error.message, source: "", running: false };
		},
		setTargetBranch: () => notImplemented("GIT-08"),
	};
}

// ---------------------------------------------------------------- notifications (sidecar tells the UI)

export function createSidecarNotificationHandlers(
	ports: SidecarHandlerPorts,
): SidecarNotificationHandlers {
	return {
		// Ingest owns its log: it reports a failed write there and in the result it returns.
		sessionEvent: async (envelope) => {
			await ports.ingest.ingest(envelope);
		},
		liveState: async (params) => {
			const written = await ports.liveState.setLiveState(params);
			if (!written.ok) throw new Error(`Could not show a live state: ${written.error.message}`);
		},
		agentSessionId: async (params) => {
			const written = await ports.liveState.setAgentSessionId(params);
			if (!written.ok) {
				throw new Error(`Could not store the agent session id: ${written.error.message}`);
			}
		},
		progress: () => notImplemented("CHAT-13"),
		agentInstallsChanged: async (params) => {
			ports.agentCatalog.setAgentInstalls(params);
		},
		agentConfigChanged: () => notImplemented("SIDE-20"),
		interactionClosed: () => notImplemented("CHAT-11"),
		goalChanged: () => notImplemented("COMP-10"),
		shellEnvFailed: async (params) => {
			ports.shellEnv.captureFailed(params);
		},
	};
}
