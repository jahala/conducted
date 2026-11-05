/**
 * @feature SIDE-03 Session manager: steering policy
 * Owns: the one place that decides how a message that arrives during a turn is delivered, and how
 * a failed steer falls back.
 * Behaviour: research/conductor/other-runners.md section 2.4 "Steering fallback is a shared
 * policy" and sessions.md section 6 "User input during a turn". A steer is a message pushed into
 * the running turn. When the runner cannot steer, it is queued as a follow-up.
 * Must handle:
 *  - session idle: any message starts a new turn, even when the app asked for a steer
 *  - session working, steer requested, runner can steer: steer
 *  - session working, steer requested, runner cannot steer (OpenCode, Pi): queue
 *  - session working, new turn requested: queue (the app's own queue normally holds these)
 *  - the steer races the turn end (NoActiveTurnError): start a new turn if the session is idle by
 *    now, else report the error
 *  - the runner reverts a steer (SteerRevertedError): queue it
 *  - the user cancelled meanwhile (cancelled outcome): drop it quietly
 * Test first: working + steer + capabilities.steer false returns "queue"; idle + steer returns
 * "new_turn".
 */
import type { SessionStatus } from "@conducted/protocol";
import type { RunnerCapabilities } from "../runners/runner.ts";

export type DeliveryChoice = "new_turn" | "steer" | "queue";

export function chooseDelivery(input: {
	requested: "new_turn" | "steer";
	status: SessionStatus;
	capabilities: Pick<RunnerCapabilities, "steer">;
}): DeliveryChoice {
	if (input.status === "idle") return "new_turn";
	if (input.requested === "steer" && input.capabilities.steer) return "steer";
	return "queue";
}

/** What to do after a steer attempt failed. */
export type SteerFallback =
	| { action: "new_turn" }
	| { action: "queue" }
	| { action: "drop" }
	| { action: "fail"; reason: string };

export type SteerFailure =
	| { kind: "no_active_turn"; sessionIdle: boolean }
	| { kind: "reverted" }
	| { kind: "unsupported" }
	| { kind: "cancelled" }
	| { kind: "other"; message: string };

export function resolveSteerFailure(failure: SteerFailure): SteerFallback {
	switch (failure.kind) {
		case "no_active_turn":
			return failure.sessionIdle
				? { action: "new_turn" }
				: { action: "fail", reason: "The chat has no running turn to steer." };
		case "reverted":
		case "unsupported":
			return { action: "queue" };
		case "cancelled":
			return { action: "drop" };
		case "other":
			return { action: "fail", reason: failure.message };
	}
}
