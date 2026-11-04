/**
 * @feature CHAT-18 Resume after restart and reconnect
 * Owns: bringing chats back in line with the sidecar after the app starts, after the sidecar
 * restarts, or after the connection drops and returns.
 * Behaviour: sessions.md 8 (resume after restart or crash: the sidecar keeps chat state in memory
 * only; a new connection can attach to a living sidecar; `getSessionStatus` answers
 * "unknown" for a chat it lost; a turn cut off by a crash has no end event, so the app repairs
 * it), sessions-and-chats.md "How chats are stored".
 * Must handle: the sidecar restarted (every chat the UI thinks is working is "unknown" there:
 * close its turn as interrupted, show idle, keep the agent session id so the next message
 * resumes); the sidecar is alive and still working (adopt its live state and wait for events);
 * the sidecar replays unacknowledged events with `deliverEvent` after the handlers are
 * registered (ingest handles them; dedupe makes replay safe); chats with queued follow-ups stay
 * paused until the user resumes them (the queue never sends by itself after a crash); a chat
 * that was open gets `warmAgent` again with its resume id only when the user opens it; two
 * resume runs at once collapse into one.
 * Our design choice: the app never guesses. A chat is either confirmed `working` by the sidecar
 * or it is closed as interrupted. Startup repair (core/db/repair.ts) already did the same for the
 * stored side before this runs.
 * Test first: a chat the UI shows as working, which the sidecar reports as unknown, ends with a
 * turn_ended event with outcome "interrupted" and an idle live state.
 */
import type { LiveState } from "@conducted/protocol";
import { notImplemented, type Result, type SessionId } from "@conducted/shared";
import type { Repositories } from "../db/repositories.ts";
import type { SidecarClient } from "./tunnel.ts";

export interface ResumeReport {
	adopted: SessionId[];
	interrupted: SessionId[];
	failed: { sessionId: SessionId; message: string }[];
}

export interface SessionResumeDeps {
	repositories: () => Repositories;
	sidecar: Pick<SidecarClient, "request">;
	/** Chats the UI believes are working, from memory and from stored live states. */
	workingSessionIds: () => Promise<SessionId[]>;
	/** Lets the sessions service show the adopted live state and the interrupted turn. */
	apply: {
		adoptLiveState(sessionId: SessionId, liveState: LiveState): void;
		markInterrupted(sessionId: SessionId): Promise<Result<void>>;
	};
}

export class SessionResume {
	readonly #deps: SessionResumeDeps;

	constructor(deps: SessionResumeDeps) {
		this.#deps = deps;
	}

	/** Runs once after the tunnel is up and again after every reconnect. */
	resume(): Promise<Result<ResumeReport>> {
		void this.#deps;
		return notImplemented("CHAT-18");
	}
}
