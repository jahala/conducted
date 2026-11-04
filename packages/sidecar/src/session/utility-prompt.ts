/**
 * @feature SIDE-24 Chat titles and branch names from a short run of the user's agent
 * Owns: the `runUtilityPrompt` request: one short prompt through a throwaway session of the user's
 * own agent, returning plain text.
 * Behaviour: other-runners.md 2.2 and 10 (`acpOneShotPrompt`, `cursorOneShotPrompt`: a throwaway
 * session that rejects tools), the decision is D030 in docs/decisions.md. One call covers every
 * agent.
 * Must handle: an agent that is not signed in (an error value, nothing written); no model given
 * (an error value, no default is invented); the call never appears in the chat list, writes no
 * events, takes no checkpoints and sends no live-state change; every tool request is refused; the
 * session is closed at once, also on error and on timeout; the call is never resent (D016); the
 * provider keys of the launch are never logged; a log line records the phase and duration, as
 * Conductor's `AcpOneShotPrompt` tag does.
 * Our design choice: the runner contract (`runners/runner.ts`) has no one-shot method, so this
 * module starts a normal `AgentSession` with all app tools off and an auto-deny interaction
 * callback. If that proves too heavy for an agent, add an optional `runOnce` to `Runner` then.
 * Test first: after a call, the event publisher, the checkpoint service and the live-state store
 * have received nothing, and the agent session was disposed.
 */
import type { AppError, Clock, IdSource, Result } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { AppToSidecarRequestParams, AppToSidecarRequestResult } from "../rpc/types.ts";
import type { RunnerRegistry } from "../runners/registry.ts";
import type { ShellEnvProvider } from "../shell-env/capture.ts";

/** The longest a utility prompt may run before it is stopped. */
export const UTILITY_PROMPT_TIMEOUT_MS = 60_000;

export interface UtilityPromptRunner {
	run(
		params: AppToSidecarRequestParams<"runUtilityPrompt">,
	): Promise<Result<AppToSidecarRequestResult<"runUtilityPrompt">, AppError>>;
}

export class AgentUtilityPromptRunner implements UtilityPromptRunner {
	constructor(
		protected readonly deps: {
			runners: RunnerRegistry;
			shellEnv: ShellEnvProvider;
			clock: Clock;
			ids: IdSource;
			logger: Logger;
		},
	) {}

	run(
		_params: AppToSidecarRequestParams<"runUtilityPrompt">,
	): Promise<Result<AppToSidecarRequestResult<"runUtilityPrompt">, AppError>> {
		return notImplemented("SIDE-24");
	}
}
