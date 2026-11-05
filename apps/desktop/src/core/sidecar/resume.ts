/**
 * @feature CHAT-18 Resume after restart and reconnect
 * Owns: bringing chats back in line with the sidecar after the app starts, after the sidecar
 * restarts, or after the connection drops and returns.
 * Behaviour: sessions.md 8 (resume after restart or crash: the sidecar keeps chat state in memory
 * only; a new connection can attach to a living sidecar; `getSessionStatus` answers
 * "unknown" for a chat it lost; a turn cut off by a crash has no end event, so the app repairs
 * it), sessions-and-chats.md "How chats are stored".
 * Must handle: the sidecar restarted (every chat the UI thinks is working is "unknown" there:
 * close its turn as interrupted, show idle, keep the agent session id, and warm its agent with the
 * chat's launch and that id so it resumes before the next message; SIDE-21 builds the launch, and a
 * warm that fails is reported in the result); the sidecar is alive and still working (adopt its live state and wait for events);
 * two resume runs at once collapse into one, except that a run asked for after a reconnect
 * waits for the run in flight and then runs afresh (the run in flight asked a connection that is
 * gone, so its answers say nothing about the new one); a status request that fails is reported in the
 * result and never guessed at; a live-state notification that arrives while the status request
 * is in flight wins over the older status answer; a failed live-state write is reported in the
 * result.
 * Our design choice: the app never guesses. A chat is either confirmed `working` by the sidecar
 * or it is closed as interrupted. Startup repair (core/db/repair.ts) already did the same for the
 * stored side before this runs, so at startup the working list is empty and the reconnect run is
 * the one that finds lost chats. An adopted chat is not warmed: the sidecar still runs its agent.
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
	/** Chats the UI believes are working, from the in-memory live-state store. */
	workingSessionIds: () => Promise<SessionId[]>;
	/** The live state the UI currently shows, so an older status answer can be dropped. */
	liveStateOf: (sessionId: SessionId) => LiveState | undefined;
	/** Lets the sessions service show the adopted live state and the interrupted turn. */
	apply: {
		adoptLiveState(sessionId: SessionId, liveState: LiveState): Promise<Result<void>>;
		markInterrupted(sessionId: SessionId): Promise<Result<void>>;
		/** Starts the chat's agent with its launch and stored resume token (SIDE-21). */
		warm(sessionId: SessionId): Promise<Result<void>>;
	};
}

export class SessionResume {
	readonly #deps: SessionResumeDeps;
	readonly #flight = createSingleFlight<"resume">();
	/** The fresh run waiting behind the run in flight, shared by every reconnect that asks for one. */
	#afterReconnect: Promise<Result<ResumeReport>> | null = null;

	constructor(deps: SessionResumeDeps) {
		this.#deps = deps;
	}

	/** Runs once after the tunnel is up and again after every reconnect. */
	resume(): Promise<Result<ResumeReport>> {
		return this.#flight.run("resume", () => this.#run());
	}

	/**
	 * Runs once the tunnel is back after a restart. A run already in flight used the old connection,
	 * so this does not join it: it waits for it and then runs again. Callers that arrive while it
	 * waits share the one follow-up run.
	 */
	resumeAfterReconnect(): Promise<Result<ResumeReport>> {
		if (this.#afterReconnect !== null) return this.#afterReconnect;
		if (!this.#flight.isRunning("resume")) return this.resume();
		const inFlight = this.resume();
		const follow = (): Promise<Result<ResumeReport>> => {
			this.#afterReconnect = null;
			return this.resume();
		};
		this.#afterReconnect = inFlight.then(follow, follow);
		return this.#afterReconnect;
	}

	async #run(): Promise<Result<ResumeReport>> {
		const report: ResumeReport = { adopted: [], interrupted: [], failed: [] };
		const working = await this.#deps.workingSessionIds();

		for (const sessionId of working) {
			const before = this.#deps.liveStateOf(sessionId);
			const status = await this.#deps.sidecar.request("getSessionStatus", { sessionId });
			// A notification that landed during the request is newer than this answer, so drop it.
			if (this.#deps.liveStateOf(sessionId) !== before) continue;
			if (!status.ok) {
				report.failed.push({ sessionId, message: status.error.message });
				continue;
			}
			if (!status.value.known) {
				const marked = await this.#deps.apply.markInterrupted(sessionId);
				if (!marked.ok) {
					report.failed.push({ sessionId, message: marked.error.message });
					continue;
				}
				report.interrupted.push(sessionId);
				const warmed = await this.#deps.apply.warm(sessionId);
				if (!warmed.ok) report.failed.push({ sessionId, message: warmed.error.message });
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
			const adopted = await this.#deps.apply.adoptLiveState(sessionId, liveState);
			if (adopted.ok) report.adopted.push(sessionId);
			else report.failed.push({ sessionId, message: adopted.error.message });
		}

		return ok(report);
	}
}
