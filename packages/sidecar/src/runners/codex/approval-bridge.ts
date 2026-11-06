/**
 * @feature AGENT-08 Codex: approvals, permission grants, MCP forms
 * Owns: registering the handlers for the five server requests on the app-server client, and
 * connecting each to TurnCallbacks.requestInteraction using the mappings in approvals.ts.
 * Behaviour: research/conductor/other-runners.md section 4 (Codex row) and sections 2.1 (policy per
 * thread: approvalPolicy and sandbox are set at thread/start and can be overridden per turn).
 * Must handle:
 *  - each handler uses the callbacks of the turn that is running; a request between turns
 *    declines a command or file approval, cancels a form, and fails a question or permission
 *    approval
 *  - the abort of a turn (interrupt) resolves waiting requests as cancel, which the broker does
 *    by answering "withdrawn"
 *  - one interaction at a time is enforced by the broker; handlers just await it
 *  - a permission grant and an MCP form expire after 300 seconds: Codex gets the timeout reply and
 *    the interaction is withdrawn at the broker through the abort signal, so the card closes and the
 *    chat's next interaction can open; command and file approvals and questions wait for the user
 *  - dispose (the session ends or its app server is replaced): every request still waiting stops,
 *    its timer is cleared and its interaction is withdrawn
 *  - the question tool (`item/tool/requestUserInput`): each question's options become labels,
 *    answers are returned keyed by question id; more than four questions are asked in groups of
 *    four, and a question with more options than a card can show is refused, not trimmed
 *  - a question answered with a withdrawal or another kind fails the request, so Codex never
 *    reads it as the user answering nothing
 *  - each consent's final outcome (declined, cancelled, unavailable, timeout) is logged with the
 *    CodexMcpConsent tag and emitted as a codex.mcpConsentOutcome AgentMessage
 * Test first: a command approval request opens a tool_approval interaction named Bash with the
 * command text, and an "allow" answer returns { decision: "accept" }.
 */
import type { Interaction, InteractionAnswer } from "@conducted/protocol";
import { CODEX_INTERACTION_TIMEOUT_MS } from "@conducted/protocol";
import type { Logger } from "../../logging/logger.ts";
import type { TurnCallbacks } from "../runner.ts";
import type { CodexAppServerClient } from "./app-server-client.ts";
import {
	type CodexConsentOutcome,
	consentOutcomeFor,
	consentOutcomeMessage,
	planCommandApproval,
	planFileChangeApproval,
	planMcpElicitation,
	planPermissionApproval,
	planToolUserInput,
} from "./approvals.ts";
import { CODEX_SERVER_REQUESTS } from "./protocol.ts";

type ScheduleTimeout = (run: () => void, ms: number) => () => void;

interface Asked {
	answer: InteractionAnswer;
	timedOut: boolean;
	unavailable: boolean;
}

export interface CodexApprovalBridgeDeps {
	client: CodexAppServerClient;
	callbacks(): TurnCallbacks | undefined;
	logger: Logger;
	/** Schedules the consent timeout. Tests replace it; production uses setTimeout. */
	scheduleTimeout?: ScheduleTimeout;
}

export class CodexApprovalBridge {
	/** Stops each request still waiting for the user: clears its timer and withdraws it. */
	private readonly waiting = new Set<() => void>();

	constructor(protected readonly deps: CodexApprovalBridgeDeps) {}

	/** Stops every request still waiting. Codex's own requests end with its process. */
	dispose(): void {
		for (const stop of [...this.waiting]) stop();
		this.waiting.clear();
	}

	/** Registers the five server-request handlers on the client. Call once after connect(). */
	register(): void {
		this.deps.client.onServerRequest(CODEX_SERVER_REQUESTS.commandApproval, (params) =>
			this.commandApproval(params),
		);
		this.deps.client.onServerRequest(CODEX_SERVER_REQUESTS.fileChangeApproval, (params) =>
			this.fileChangeApproval(params),
		);
		this.deps.client.onServerRequest(CODEX_SERVER_REQUESTS.toolUserInput, (params) =>
			this.toolUserInput(params),
		);
		this.deps.client.onServerRequest(CODEX_SERVER_REQUESTS.mcpElicitation, (params) =>
			this.mcpElicitation(params),
		);
		this.deps.client.onServerRequest(CODEX_SERVER_REQUESTS.permissionsApproval, (params) =>
			this.permissionApproval(params),
		);
	}

	private async commandApproval(params: unknown): Promise<unknown> {
		const plan = planCommandApproval(params);
		if (plan === null) {
			this.deps.logger.warn("CodexApprovalBridge: a command approval named no item; declining");
			return { decision: "decline" };
		}
		const callbacks = this.deps.callbacks();
		if (callbacks === undefined) return { decision: "decline" };
		const asked = await this.ask(callbacks, plan.interaction, false);
		return plan.reply(asked.answer);
	}

	private async fileChangeApproval(params: unknown): Promise<unknown> {
		const plan = planFileChangeApproval(params);
		if (plan === null) {
			this.deps.logger.warn("CodexApprovalBridge: a file-change approval named no item; declining");
			return { decision: "decline" };
		}
		const callbacks = this.deps.callbacks();
		if (callbacks === undefined) return { decision: "decline" };
		const asked = await this.ask(callbacks, plan.interaction, false);
		return plan.reply(asked.answer);
	}

	private async toolUserInput(params: unknown): Promise<unknown> {
		const plan = planToolUserInput(params);
		if (plan === null) {
			this.deps.logger.warn("CodexApprovalBridge: a user-input request carried no questions");
			throw new Error("Codex asked for user input without a question.");
		}
		if (plan.kind === "refused") {
			this.deps.logger.warn("CodexApprovalBridge: cannot show a Codex question faithfully", {
				reason: plan.reason,
			});
			throw new Error(plan.reason);
		}
		const callbacks = this.deps.callbacks();
		if (callbacks === undefined) {
			throw new Error("Codex asked a question, but no turn is active.");
		}
		const answers: InteractionAnswer[] = [];
		for (const group of plan.groups) {
			const asked = await this.ask(callbacks, group.interaction, false);
			answers.push(asked.answer);
		}
		return plan.reply(answers);
	}

	private async mcpElicitation(params: unknown): Promise<unknown> {
		const method = CODEX_SERVER_REQUESTS.mcpElicitation;
		const plan = planMcpElicitation(params);
		if (plan === null) {
			this.deps.logger.warn("CodexApprovalBridge: an elicitation request had no mode; declining");
			return { action: "decline", content: null, _meta: null };
		}
		const callbacks = this.deps.callbacks();
		if (plan.kind === "unsupported") {
			this.deps.logger.info("CodexMcpConsent: declined an MCP form this app cannot show", {
				mode: plan.mode,
			});
			this.report(callbacks, "user_declined", method);
			return plan.reply();
		}
		if (callbacks === undefined) {
			this.report(undefined, "interaction_unavailable", method);
			return { action: "cancel", content: null, _meta: null };
		}
		const asked = await this.ask(callbacks, plan.interaction, true);
		if (asked.unavailable) this.report(callbacks, "interaction_unavailable", method);
		else if (asked.timedOut) this.report(callbacks, "timeout", method);
		else this.reportOutcome(callbacks, plan.interaction, asked.answer, method);
		return plan.reply(asked.answer);
	}

	private async permissionApproval(params: unknown): Promise<unknown> {
		const method = CODEX_SERVER_REQUESTS.permissionsApproval;
		const plan = planPermissionApproval(params);
		if (plan === null) {
			this.deps.logger.warn(
				"CodexApprovalBridge: a permission request asked for nothing; declining",
			);
			return { permissions: {}, scope: "turn" };
		}
		const callbacks = this.deps.callbacks();
		if (callbacks === undefined) {
			this.report(undefined, "interaction_unavailable", method);
			throw new Error("Codex asked for a permission, but no turn is active.");
		}
		const asked = await this.ask(callbacks, plan.interaction, true);
		if (asked.unavailable) this.report(callbacks, "interaction_unavailable", method);
		else if (asked.timedOut) this.report(callbacks, "timeout", method);
		else this.reportOutcome(callbacks, plan.interaction, asked.answer, method);
		return plan.reply(asked.answer);
	}

	private async ask(
		callbacks: TurnCallbacks,
		interaction: Interaction,
		withTimeout: boolean,
	): Promise<Asked> {
		this.deps.logger.debug("CodexApprovalBridge: asking the user", { kind: interaction.kind });
		const asking = new AbortController();
		let cancelTimer = (): void => {};
		const stop = (): void => {
			cancelTimer();
			asking.abort();
		};
		this.waiting.add(stop);
		try {
			const answer = settled(callbacks.requestInteraction(interaction, asking.signal));
			if (!withTimeout) return handled(await answer, this.deps.logger);
			const timeout = new Promise<"timeout">((resolve) => {
				const schedule = this.deps.scheduleTimeout ?? scheduleWithSetTimeout;
				cancelTimer = schedule(() => resolve("timeout"), CODEX_INTERACTION_TIMEOUT_MS);
			});
			const first = await Promise.race([
				answer.then((outcome) => ({ kind: "settled" as const, outcome })),
				timeout.then(() => ({ kind: "timeout" as const })),
			]);
			cancelTimer();
			if (first.kind === "timeout") {
				// Codex stops waiting, so the card must close too, or it blocks the chat's next one.
				asking.abort();
				return { answer: { kind: "withdrawn" }, timedOut: true, unavailable: false };
			}
			return handled(first.outcome, this.deps.logger);
		} finally {
			this.waiting.delete(stop);
		}
	}

	private reportOutcome(
		callbacks: TurnCallbacks,
		interaction: Interaction,
		answer: InteractionAnswer,
		method: string,
	): void {
		const outcome = consentOutcomeFor(interaction, answer);
		if (outcome === undefined) {
			this.deps.logger.info("CodexMcpConsent: the user accepted", { method });
			return;
		}
		this.report(callbacks, outcome, method);
	}

	private report(
		callbacks: TurnCallbacks | undefined,
		outcome: CodexConsentOutcome,
		method: string,
	): void {
		this.deps.logger.info("CodexMcpConsent: consent request ended", { outcome, method });
		callbacks?.onMessage(consentOutcomeMessage(outcome));
	}
}

async function settled(
	pending: Promise<InteractionAnswer>,
): Promise<{ kind: "answer"; answer: InteractionAnswer } | { kind: "failed" }> {
	return pending.then(
		(answer) => ({ kind: "answer" as const, answer }),
		() => ({ kind: "failed" as const }),
	);
}

function handled(
	outcome: { kind: "answer"; answer: InteractionAnswer } | { kind: "failed" },
	logger: Logger,
): Asked {
	if (outcome.kind === "answer") {
		return { answer: outcome.answer, timedOut: false, unavailable: false };
	}
	logger.warn("CodexApprovalBridge: the app could not answer; treating it as unavailable");
	return { answer: { kind: "withdrawn" }, timedOut: false, unavailable: true };
}

function scheduleWithSetTimeout(run: () => void, ms: number): () => void {
	const handle = setTimeout(run, ms);
	return () => clearTimeout(handle);
}
