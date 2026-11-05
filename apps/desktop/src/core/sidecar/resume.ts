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
 * two resume runs at once collapse into one; a status request that fails is reported in the
 * result and never guessed at.
 * Our design choice: the app never guesses. A chat is either confirmed `working` by the sidecar
 * or it is closed as interrupted. Startup repair (core/db/repair.ts) already did the same for the
 * stored side before this runs.
 * Test first: a chat the UI shows as working, which the sidecar reports as unknown, ends with a
 * turn_ended event with outcome "interrupted" and an idle live state.
 */
import type { LiveState } from "@conducted/protocol";
import { ok, type Result, type SessionId } from "@conducted/shared";
import { createSingleFlight } from "../async/single-flight.ts";
import type { SidecarClient } from "./tunnel.ts";

export interface ResumeReport {
	adopted: SessionId[];
	interrupted: SessionId[];
	failed: { sessionId: SessionId; message: string }[];
}

export interface SessionResumeDeps {
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
	readonly #flight = createSingleFlight<"resume">();

	constructor(deps: SessionResumeDeps) {
		this.#deps = deps;
	}

	/** Runs once after the tunnel is up and again after every reconnect. */
	resume(): Promise<Result<ResumeReport>> {
		return this.#flight.run("resume", () => this.#run());
	}

	async #run(): Promise<Result<ResumeReport>> {
		const report: ResumeReport = { adopted: [], interrupted: [], failed: [] };
		const working = await this.#deps.workingSessionIds();

		for (const sessionId of working) {
			const status = await this.#deps.sidecar.request("getSessionStatus", { sessionId });
			if (!status.ok) {
				report.failed.push({ sessionId, message: status.error.message });
				continue;
			}
			if (!status.value.known) {
				const marked = await this.#deps.apply.markInterrupted(sessionId);
				if (marked.ok) report.interrupted.push(sessionId);
				else report.failed.push({ sessionId, message: marked.error.message });
				continue;
			}
			const liveState = status.value.liveState;
			if (liveState === undefined) {
				report.failed.push({
					sessionId,
					message: "The sidecar did not report the chat's live state.",
				});
				continue;
			}
			this.#deps.apply.adoptLiveState(sessionId, liveState);
			report.adopted.push(sessionId);
		}

		return ok(report);
	}
}
