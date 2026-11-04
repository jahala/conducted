/**
 * @feature AGENT-01 The runner contract: typed errors
 * Owns: the few errors a runner throws from steer() and runTurn() so the session manager can pick
 * the right fallback in one place (session/steering.ts).
 * Behaviour: research/conductor/other-runners.md section 1 and 7 item 4 ("Make unsupported
 * explicit and typed"): no active turn, the runner cannot steer, the steer was handed back as a
 * follow-up.
 * Must handle: nothing at runtime beyond being distinguishable with instanceof.
 * Test first: each error is an instance of its own class and of Error.
 * Our design choice: user cancellation is a TurnOutcome ({ kind: "cancelled" }), not an error.
 * Only steer() throws these.
 */
export class NoActiveTurnError extends Error {
	override readonly name = "NoActiveTurnError";
	constructor() {
		super("There is no running turn to steer");
	}
}

/** The runner cannot push a message into a running turn. Queue it instead. */
export class SteerNotSupportedError extends Error {
	override readonly name = "SteerNotSupportedError";
	constructor(readonly agent: string) {
		super(`${agent} cannot be steered while it works`);
	}
}

/** The agent accepted the steer and then handed it back. Queue it instead. */
export class SteerRevertedError extends Error {
	override readonly name = "SteerRevertedError";
	constructor() {
		super("The agent returned the steer message as a follow-up");
	}
}
