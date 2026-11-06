/**
 * @feature AGENT-15 Turns the Claude program starts by itself
 * Owns: noticing that the Claude program runs a turn nobody asked for (a background task finished
 * and woke it up), translating its messages, and telling the host when that work starts and stops.
 * Behaviour: sessions.md 2 "Turn boundary detail" (turns the CLI starts itself flip the chat to
 * working and back to idle), claude-runner.md 2.2 and 2.9 (host callbacks: ours lacks the
 * in-progress one), other-runners.md 1 (`onInProgressChanged`). The session side is
 * `session/self-started-turns.ts`.
 * Must handle: an SDK `system` state change to running with no turn of ours open (in progress);
 * the matching change back to idle (success); a state change while our own turn runs (not ours to
 * report: `ClaudeTurnTracker` decides); a result for a message we did not push (the work ended
 * successfully); a mini result (`num_turns` 0, a background-task notification) is not an end; the
 * stream ending cleanly while in progress (interrupted); the stream throwing (error with its
 * message); no repeated reports of the same state; `dispose` (no report after it).
 * Messages of such work are translated and handed to `onMessage`, so the host stores them. Work
 * that starts before its first state report starts on its first translated message instead. An
 * approval such work asks for goes to `requestInteraction` (RC-03: a turn started on claude.ai can
 * ask the app); `ClaudeSession` routes it there when no turn of ours is open.
 * Our design choice: `onInProgressChanged` is a separate callback object, not a new field of
 * `TurnCallbacks`, because it is called outside `runTurn`, when no turn callbacks exist. The host
 * passes it as `StartOptions.selfStartedTurns`, and `ClaudeSession` feeds this tracker every SDK
 * message its turn tracker does not hold back.
 * Test first: a scripted stream that reports running, then idle, with no turn open gives
 * `onInProgressChanged(true)` then `onInProgressChanged(false, {outcome:"success"})`.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage, Interaction, InteractionAnswer } from "@conducted/protocol";
import type { SelfStartedTurnEnd } from "../../session/self-started-turns.ts";

/** What the host gives the runner for work the agent starts by itself. */
export interface SelfStartedTurnCallbacks {
	/** The agent started (true) or stopped (false) working without a message from the user. */
	onInProgressChanged(inProgress: boolean, end?: SelfStartedTurnEnd): void;
	/** One translated message of such a turn. */
	onMessage(message: AgentMessage): void;
	/**
	 * The agent asks the user during such work, for example a tool approval in a turn started on
	 * claude.ai (RC-03). Resolves like `TurnCallbacks.requestInteraction`; an abort of `signal`
	 * withdraws it.
	 */
	requestInteraction(interaction: Interaction, signal?: AbortSignal): Promise<InteractionAnswer>;
}

export class SelfStartedTurnTracker {
	private inProgress = false;
	private disposed = false;

	constructor(
		protected readonly deps: {
			callbacks: SelfStartedTurnCallbacks;
			/** True while a turn of ours is open. */
			ownTurnOpen(): boolean;
			/** Turns one SDK message into the neutral messages the host stores. */
			translate(message: SDKMessage): AgentMessage[];
		},
	) {}

	/** Looks at one SDK message. */
	onSdkMessage(message: SDKMessage): void {
		if (this.disposed) return;
		// A turn of ours owns the chat state; its tracker decides when that turn ends.
		if (this.deps.ownTurnOpen()) return;

		if (message.type === "system" && message.subtype === "session_state_changed") {
			if (message.state === "idle") this.ended({ outcome: "success" });
			else this.started();
			return;
		}
		if (message.type === "result") {
			// A background-task notification reports no turns; it does not end the work.
			if (message.num_turns === 0) {
				if (this.inProgress) this.emit(message);
				return;
			}
			// The CLI answered a message we did not push, so the work it started is over.
			this.started();
			this.emit(message);
			this.ended({ outcome: "success" });
			return;
		}

		// A message can arrive before the runner's first state report. Its output still belongs to
		// the work the CLI started, so open the turn from the message itself.
		if (this.emit(message) > 0) this.started();
	}

	/** The stream ended or threw. A clean end is interrupted; a throw carries its message. */
	onStreamEnded(error?: Error): void {
		if (this.disposed) return;
		this.ended(
			error === undefined ? { outcome: "interrupted" } : { outcome: "error", error: error.message },
		);
	}

	dispose(): void {
		this.disposed = true;
	}

	/** Translates one message and gives it to the host. Returns how many it produced. */
	private emit(message: SDKMessage): number {
		let count = 0;
		for (const translated of this.deps.translate(message)) {
			this.deps.callbacks.onMessage(translated);
			count += 1;
		}
		return count;
	}

	private started(): void {
		if (this.disposed || this.inProgress) return;
		this.inProgress = true;
		this.deps.callbacks.onInProgressChanged(true);
	}

	private ended(end: SelfStartedTurnEnd): void {
		if (this.disposed || !this.inProgress) return;
		this.inProgress = false;
		this.deps.callbacks.onInProgressChanged(false, end);
	}
}
