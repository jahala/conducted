/**
 * @feature AGENT-15 Turns the Claude program starts by itself
 * Owns: noticing that the Claude program runs a turn nobody asked for (a background task finished
 * and woke it up), and telling the host when that work starts and stops.
 * Behaviour: sessions.md 2 "Turn boundary detail" (turns the CLI starts itself flip the chat to
 * working and back to idle), claude-runner.md 2.2 and 2.9 (host callbacks: ours lacks the
 * in-progress one), other-runners.md 1 (`onInProgressChanged`). The session side is
 * `session/self-started-turns.ts`.
 * Must handle: an SDK `system` state change to running with no turn of ours open (in progress);
 * the matching change back to idle (not in progress); a state change while our own turn runs (not
 * ours to report: `ClaudeTurnTracker` decides); a result for a message we did not push (the
 * messages of the turn are forwarded and the end is reported); the stream ending while in progress
 * (report not in progress); no repeated reports of the same state; `dispose` (no report after it).
 * Our design choice: `onInProgressChanged` is a separate callback object, not a new field of
 * `TurnCallbacks`, because it is called outside `runTurn`, when no turn callbacks exist.
 * Test first: a scripted stream that reports running, then idle, with no turn open gives
 * `onInProgressChanged(true)` then `onInProgressChanged(false)`.
 */
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentMessage } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";

/** What the host gives the runner for work the agent starts by itself. */
export interface SelfStartedTurnCallbacks {
	/** The agent started (true) or stopped (false) working without a message from the user. */
	onInProgressChanged(inProgress: boolean): void;
	/** One translated message of such a turn. */
	onMessage(message: AgentMessage): void;
}

export class SelfStartedTurnTracker {
	constructor(
		protected readonly deps: {
			callbacks: SelfStartedTurnCallbacks;
			/** True while a turn of ours is open. */
			ownTurnOpen(): boolean;
		},
	) {}

	/** Looks at one SDK message. */
	onSdkMessage(_message: SDKMessage): void {
		notImplemented("AGENT-15");
	}

	/** The stream ended or threw. Reports not in progress if it was. */
	onStreamEnded(): void {
		notImplemented("AGENT-15");
	}

	dispose(): void {
		notImplemented("AGENT-15");
	}
}
