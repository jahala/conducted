/**
 * @feature SIDE-03 Session manager: per-session queue, duplicate guard, idle after flush
 * Owns: every chat the sidecar knows about, and the app's requests about them: sendMessage,
 * cancel, warmAgent, resetAgent, updateConfig, getSessionStatus and answerInteraction.
 * Behaviour: research/conductor/sessions.md sections 2, 3 and 6, sessions-and-chats.md "What
 * happens when you send a message" and "While the agent is working", other-runners.md section 2.4
 * (steering policy). Conductor splits this over a server (`CJi`), a host (`PFe`) and a send
 * function (`kFe`); we keep one manager and move each concern to its own file under session/.
 * Must handle:
 *  - sendMessage, warmAgent, resetAgent and updateConfig for one chat run on that chat's serial
 *    queue; cancel and answerInteraction do not
 *  - cancel aborts a sendMessage that is still setting up, so it never reaches the runner
 *  - duplicate message ids are ignored and answered with the earlier delivery
 *  - delivery: new turn, steer or queued, chosen by steering.ts; the answer says which
 *  - a new non-steering message and a steer both withdraw the open interaction
 *  - a model or agent change between turns restarts the agent with resume (applyConfig returns
 *    "restart"); a change during a turn waits for the next turn (answer "on_next_turn")
 *  - a changed agent kind for an existing chat disposes the old agent first
 *  - getSessionStatus for a chat the sidecar does not know: known false (it restarted)
 *  - the first message adds the workspace instruction block (prompt/); later ones do not
 *  - cancel drops queued messages, withdraws interactions, takes the end checkpoint, and reports
 *    wasWorking
 *  - shutdown(): stop every agent, take no checkpoint, wait up to 10 s for in-flight turns
 *  - the same agent session id is stored from the first callback and sent to the app once
 * Test first: two sendMessage calls with the same messageId start one turn; the second answer
 * repeats the first deliveredAs.
 * Our design choice: queued messages live in memory only. The app owns the persistent follow-up
 * queue (CHAT-04) and re-sends after a restart; this queue is the second line Conductor also has.
 */
import type { LiveState } from "@conducted/protocol";
import type { Clock, IdSource, SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { CheckpointService } from "../checkpoints/checkpoint-service.ts";
import type { Logger } from "../logging/logger.ts";
import type { ProcessManager } from "../process/process-manager.ts";
import type { PromptAssembler } from "../prompt/assemble.ts";
import type {
	AppToSidecarRequestParams,
	AppToSidecarRequestResult,
	SidecarToApp,
} from "../rpc/types.ts";
import type { RunnerRegistry } from "../runners/registry.ts";
import type { ShellEnvProvider } from "../shell-env/capture.ts";
import type { EventPublisher } from "./event-batcher.ts";
import type { InteractionBroker } from "./interactions.ts";
import type { LiveStateStore } from "./live-state.ts";
import type { KeyedSerialQueue } from "./serial-queue.ts";

/** How long shutdown waits for running turns, from the research (10 s). */
export const SHUTDOWN_TURN_WAIT_MS = 10_000;

export type ShutdownReason = "app_quit" | "parent_gone" | "signal";

export interface SessionManager {
	sendMessage(
		params: AppToSidecarRequestParams<"sendMessage">,
	): Promise<AppToSidecarRequestResult<"sendMessage">>;
	cancel(params: AppToSidecarRequestParams<"cancel">): Promise<AppToSidecarRequestResult<"cancel">>;
	warmAgent(
		params: AppToSidecarRequestParams<"warmAgent">,
	): Promise<AppToSidecarRequestResult<"warmAgent">>;
	resetAgent(
		params: AppToSidecarRequestParams<"resetAgent">,
	): Promise<AppToSidecarRequestResult<"resetAgent">>;
	updateConfig(
		params: AppToSidecarRequestParams<"updateConfig">,
	): Promise<AppToSidecarRequestResult<"updateConfig">>;
	getSessionStatus(
		params: AppToSidecarRequestParams<"getSessionStatus">,
	): Promise<AppToSidecarRequestResult<"getSessionStatus">>;
	answerInteraction(
		params: AppToSidecarRequestParams<"answerInteraction">,
	): Promise<AppToSidecarRequestResult<"answerInteraction">>;
	/** Live state of a chat, for the process manager's busy and idle marks. */
	liveStateOf(sessionId: SessionId): LiveState | undefined;
	/** Called when the app connection attaches: resend open interactions. */
	onAppAttached(): void;
	shutdown(reason: ShutdownReason): Promise<void>;
}

export interface SessionManagerDeps {
	app: SidecarToApp;
	runners: RunnerRegistry;
	processes: ProcessManager;
	checkpoints: CheckpointService;
	prompt: PromptAssembler;
	shellEnv: ShellEnvProvider;
	publisher: EventPublisher;
	liveState: LiveStateStore;
	interactions: InteractionBroker;
	queue: KeyedSerialQueue;
	clock: Clock;
	ids: IdSource;
	logger: Logger;
}

export class DefaultSessionManager implements SessionManager {
	constructor(protected readonly deps: SessionManagerDeps) {}

	sendMessage(
		_params: AppToSidecarRequestParams<"sendMessage">,
	): Promise<AppToSidecarRequestResult<"sendMessage">> {
		return notImplemented("SIDE-03");
	}

	cancel(
		_params: AppToSidecarRequestParams<"cancel">,
	): Promise<AppToSidecarRequestResult<"cancel">> {
		return notImplemented("SIDE-03");
	}

	warmAgent(
		_params: AppToSidecarRequestParams<"warmAgent">,
	): Promise<AppToSidecarRequestResult<"warmAgent">> {
		return notImplemented("SIDE-03");
	}

	resetAgent(
		_params: AppToSidecarRequestParams<"resetAgent">,
	): Promise<AppToSidecarRequestResult<"resetAgent">> {
		return notImplemented("SIDE-03");
	}

	updateConfig(
		_params: AppToSidecarRequestParams<"updateConfig">,
	): Promise<AppToSidecarRequestResult<"updateConfig">> {
		return notImplemented("SIDE-03");
	}

	getSessionStatus(
		_params: AppToSidecarRequestParams<"getSessionStatus">,
	): Promise<AppToSidecarRequestResult<"getSessionStatus">> {
		return notImplemented("SIDE-03");
	}

	answerInteraction(
		_params: AppToSidecarRequestParams<"answerInteraction">,
	): Promise<AppToSidecarRequestResult<"answerInteraction">> {
		return notImplemented("SIDE-03");
	}

	liveStateOf(_sessionId: SessionId): LiveState | undefined {
		return notImplemented("SIDE-03");
	}

	onAppAttached(): void {
		notImplemented("SIDE-03");
	}

	shutdown(_reason: ShutdownReason): Promise<void> {
		return notImplemented("SIDE-03");
	}
}
