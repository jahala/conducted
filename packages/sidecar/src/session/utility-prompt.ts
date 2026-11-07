/**
 * @feature SIDE-24 Chat titles and branch names from a short run of the user's agent
 * Owns: the `runUtilityPrompt` request: one short prompt through a throwaway session of the user's
 * own agent, returning plain text.
 * Behaviour: other-runners.md 2.2 and 10 (`acpOneShotPrompt`, `cursorOneShotPrompt`: a throwaway
 * session for utility prompts), the decision is D030 in docs/decisions.md. One call covers every
 * agent.
 * Must handle: an agent that is not signed in (the runner's error value, nothing written); no model
 * given (an error value, no default is invented); every tool request is refused through the
 * interaction callback; the session is closed at once, also on error and on timeout; the call is
 * never resent (D016); the launch values never reach a log line; a completed log line records the
 * phase and duration at info level, as Conductor's `AcpOneShotPrompt` tag does.
 * This module holds no event publisher, checkpoint service or live-state store, so a call writes
 * no events, takes no checkpoints and sends no live-state change by construction.
 * Our design choice: the runner contract (`runners/runner.ts`) has no one-shot method, so this
 * module starts a normal `AgentSession` with every app tool off and an auto-deny interaction
 * callback. If that proves too heavy for an agent, add an optional `runOnce` to `Runner` then.
 * Our design choice: the session gets a minimal workspace context built from the prompt's folder;
 * runners only read its path. The launch's environment and provider keys are folded in through
 * the one builder in `runners/launch-env.ts`, and its program path reaches the runner, so a utility
 * prompt sees the same settings as the chat it names.
 * Test first: a call returns the agent's text items, refuses every interaction and disposes the
 * session.
 */
import path from "node:path";
import type {
	AgentMessage,
	Interaction,
	InteractionAnswer,
	SessionConfig,
	WorkspaceContext,
} from "@conducted/protocol";
import type { AppError, Clock, IdSource, Result, SessionId, WorkspaceId } from "@conducted/shared";
import { appError, asAppError, err, messageOf, ok } from "@conducted/shared";
import type { Logger } from "../logging/logger.ts";
import type { AppToSidecarRequestParams, AppToSidecarRequestResult } from "../rpc/types.ts";
import { agentEnvironmentFromCapture } from "../runners/launch-env.ts";
import type { RunnerRegistry } from "../runners/registry.ts";
import type { AgentSession, TurnCallbacks, TurnOutcome } from "../runners/runner.ts";
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
			/** How long one call may run. A parameter so a test needs no real minute. */
			timeoutMs?: number;
		},
	) {}

	async run(
		params: AppToSidecarRequestParams<"runUtilityPrompt">,
	): Promise<Result<AppToSidecarRequestResult<"runUtilityPrompt">, AppError>> {
		const startedAt = this.deps.clock.now();
		const model = params.model.trim();
		if (model === "") {
			return err(
				appError("utility_prompt_model_missing", "A chat title or branch name needs a model."),
			);
		}

		const runnerResult = this.deps.runners.get({
			agent: params.agent,
			acpAgent: params.acpAgent,
		});
		if (!runnerResult.ok) {
			this.logFailure(params, startedAt, runnerResult.error.message);
			return err(runnerResult.error);
		}

		const sessionId = this.deps.ids.uuid() as SessionId;
		const workspaceId = this.deps.ids.uuid() as WorkspaceId;
		const config = utilityConfig(params, model);
		const workspace: WorkspaceContext = {
			workspaceId,
			workspaceName: path.basename(params.cwd),
			workspacePath: params.cwd,
			repoRootPath: params.cwd,
			targetBranch: "",
			placeholderBranch: false,
			// The prompt runs in `cwd` on the machine this sidecar runs on, which is the app's Mac
			// today; a cloud sandbox's sidecar is CLOUD-04's.
			host: { kind: "local" },
			port: 1,
		};

		const captured = await this.deps.shellEnv.get(params.cwd);
		if (!captured.ok) {
			this.logFailure(params, startedAt, captured.error.message);
			return err(captured.error);
		}
		const env = agentEnvironmentFromCapture({
			agent: params.agent,
			...(params.acpAgent === undefined ? {} : { acpAgent: params.acpAgent }),
			sessionId,
			workspace,
			captured: captured.value,
			launch: params.launch,
		});
		if (!env.ok) {
			this.logFailure(params, startedAt, env.error.message);
			return err(env.error);
		}

		let collected = "";
		const callbacks: TurnCallbacks = {
			onMessage: (message: AgentMessage) => {
				for (const item of message.items) {
					if (item.kind === "text") collected += item.text;
				}
			},
			requestInteraction: (interaction: Interaction) =>
				Promise.resolve(denyInteraction(interaction)),
			onAgentSessionId: () => {},
			onBackgroundTasks: () => {},
			beforeFirstWrite: () => Promise.resolve(),
			onFastModeUnavailable: () => {},
		};

		this.deps.logger.debug("Utility prompt started", {
			agent: agentLabel(params),
			phase: "started",
		});

		let agent: AgentSession | null = null;
		try {
			agent = await runnerResult.value.start({
				sessionId,
				config,
				workspace,
				env: env.value,
				...(params.launch.executablePath === undefined
					? {}
					: { executablePath: params.launch.executablePath }),
			});
			const outcome = await this.runWithTimeout(agent, params.prompt, config, callbacks);
			if (!outcome.ok) {
				this.logFailure(params, startedAt, outcome.error.message);
				return outcome;
			}
			if (outcome.value.kind !== "success") {
				const message =
					outcome.value.kind === "error"
						? outcome.value.message
						: "The utility prompt was cancelled.";
				const error = appError(
					outcome.value.kind === "error" ? "utility_prompt_failed" : "utility_prompt_cancelled",
					message,
				);
				this.logFailure(params, startedAt, error.message);
				return err(error);
			}
			const text = collected.trim();
			if (text === "") {
				const error = appError("utility_prompt_empty", "The agent returned no text.");
				this.logFailure(params, startedAt, error.message);
				return err(error);
			}
			this.deps.logger.info("Utility prompt finished", {
				agent: agentLabel(params),
				phase: "completed",
				durationMs: this.deps.clock.now() - startedAt,
			});
			return ok({ text });
		} catch (cause) {
			const error = asAppError("utility_prompt_failed", "The utility prompt failed", cause);
			this.logFailure(params, startedAt, error.message);
			return err(error);
		} finally {
			if (agent !== null) {
				try {
					await agent.dispose();
				} catch (cause) {
					this.deps.logger.warn("A utility prompt session could not be closed", {
						agent: agentLabel(params),
						reason: messageOf(cause),
					});
				}
			}
		}
	}

	private async runWithTimeout(
		agent: AgentSession,
		prompt: string,
		config: SessionConfig,
		callbacks: TurnCallbacks,
	): Promise<Result<TurnOutcome>> {
		const timeoutMs = this.deps.timeoutMs ?? UTILITY_PROMPT_TIMEOUT_MS;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), timeoutMs);
		});
		try {
			const first = await Promise.race([
				agent
					.runTurn({ text: prompt, attachmentPaths: [], config }, callbacks)
					.then((outcome) => ({ kind: "outcome" as const, outcome })),
				timeout.then(() => ({ kind: "timeout" as const })),
			]);
			if (first.kind === "timeout") {
				try {
					await agent.cancel();
				} catch (cause) {
					this.deps.logger.warn("A utility prompt could not be stopped", {
						reason: messageOf(cause),
					});
				}
				return err(
					appError(
						"utility_prompt_timeout",
						`The utility prompt did not finish within ${timeoutMs} ms.`,
					),
				);
			}
			return ok(first.outcome);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}

	private logFailure(
		params: AppToSidecarRequestParams<"runUtilityPrompt">,
		startedAt: number,
		reason: string,
	): void {
		this.deps.logger.warn("Utility prompt failed", {
			agent: agentLabel(params),
			phase: "failed",
			durationMs: this.deps.clock.now() - startedAt,
			reason,
		});
	}
}

function utilityConfig(
	params: AppToSidecarRequestParams<"runUtilityPrompt">,
	model: string,
): SessionConfig {
	return {
		agent: params.agent,
		...(params.acpAgent === undefined ? {} : { acpAgent: params.acpAgent }),
		model,
		effort: "low",
		fastMode: params.fastMode ?? false,
		planMode: false,
		requireToolApproval: true,
		additionalDirectories: [],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
	};
}

function agentLabel(params: AppToSidecarRequestParams<"runUtilityPrompt">): string {
	return params.agent === "acp" ? `acp:${params.acpAgent ?? ""}` : params.agent;
}

function denyInteraction(interaction: Interaction): InteractionAnswer {
	switch (interaction.kind) {
		case "tool_approval":
			return { kind: "tool_approval", decision: "deny" };
		case "plan_approval":
			return { kind: "plan_approval", approved: false };
		case "question":
			return { kind: "question", answers: interaction.questions.map(() => []) };
		case "permission_grant":
			return { kind: "permission_grant", granted: false };
		case "mcp_form":
			return { kind: "mcp_form", action: "decline" };
	}
}
