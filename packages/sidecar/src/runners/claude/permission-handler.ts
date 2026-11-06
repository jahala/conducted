/**
 * @feature AGENT-04 Claude: the canUseTool handler
 * Owns: the SDK's canUseTool callback for one chat. It gathers the facts, asks classifyToolUse
 * (permissions.ts) for a verdict, asks the user when needed through requestInteraction, and
 * switches the permission mode after a plan is approved.
 * Behaviour: research/conductor/claude-runner.md sections 3.2 and 3.3: the callback has no
 * timeout on the SDK side; a tool approval waits for the user; ExitPlanMode asks for a plan
 * approval; "withdrawn" (cancel or a new message) denies. When the chat already left plan mode
 * while approvals are on, an ExitPlanMode call is approved without asking.
 * Must handle:
 *  - the real path of an edit target is resolved before classification; a new file is resolved
 *    through its nearest existing ancestor, a relative path against the workspace folder, and a
 *    path that cannot be resolved at all is denied as outside the allowed folders
 *  - ExitPlanMode input without a plan string: denied with a message, not a crash
 *  - the no-click plan exit applies in the normal modes reached with approvals on: "default" and
 *    "auto"; the plan still asks when the chat is in plan mode
 *  - the abort signal fires while waiting: the call denies as withdrawn, and the signal also
 *    withdraws the card at the broker, so it does not stay open in the app
 *  - the answer kind does not match the question: treated as withdrawn
 *  - approval granted with "allow_edits_for_session": later edit calls skip the question
 *  - after an approved plan, setPermissionMode is called on the query with the next mode
 *  - callbacks are those of the current turn, or of work the CLI started by itself (a turn started
 *    on claude.ai, RC-03); with neither, a call is denied as "no active turn"
 * Test first: a Bash call with approvals on opens a tool_approval interaction with the tool name
 * and input, and an "allow" answer yields behavior allow.
 */
import type {
	CanUseTool,
	PermissionMode,
	PermissionResult,
	PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import type { Interaction, InteractionAnswer, SessionConfig } from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";
import type { TurnCallbacks } from "../runner.ts";
import {
	classifyToolUse,
	EDIT_TOOLS,
	editTargetPath,
	modeAfterPlan,
	resolveEditPath,
	type ToolVerdict,
	toPermissionResult,
	toPlanResult,
} from "./permissions.ts";

export interface PermissionHandlerDeps {
	/** The config of the chat, read at call time because it can change live. */
	config(): Pick<SessionConfig, "requireToolApproval" | "planMode" | "autoPermissionMode">;
	/**
	 * Workspace folder plus additional directories, as given (resolved inside the handler). The
	 * first entry is the workspace, which a relative edit target is resolved against.
	 */
	allowedDirectories(): readonly string[];
	callbacks(): Pick<TurnCallbacks, "requestInteraction"> | undefined;
	realPath(path: string): Promise<string | null>;
	isSessionLive(): boolean;
	setPermissionMode(mode: PermissionMode): Promise<void>;
	/**
	 * The app's auto-accept edits control for this chat (AGENT-04). undefined leaves the answer
	 * based grant alone; true or false is an explicit choice that wins. An explicit false keeps
	 * asking even after an earlier "allow edits for the session" answer, until the app turns it on.
	 */
	autoApproveEditsOverride?(): boolean | undefined;
}

export class ClaudePermissionHandler {
	private autoApproveEdits = false;

	constructor(protected readonly deps: PermissionHandlerDeps) {}

	/** The function to pass as Options.canUseTool. */
	get canUseTool(): CanUseTool {
		return async (toolName, input, options) => {
			const config = this.deps.config();
			const verdict = await this.verdictFor(toolName, input, config);
			switch (verdict.kind) {
				case "allow":
					return { behavior: "allow", updatedInput: input };
				case "deny":
					return { behavior: "deny", message: verdict.message };
				case "exit_plan_mode":
					return this.exitPlanMode(input, config, options);
				case "ask":
					return this.ask(toolName, input, options);
			}
		};
	}

	/** True after the user chose "allow edits for this chat". */
	get editsAutoApproved(): boolean {
		return this.autoApproveEdits;
	}

	/** Clears the "allow edits for this chat" flag, for example after resetAgent. */
	resetSessionGrants(): void {
		this.autoApproveEdits = false;
	}

	private async verdictFor(
		toolName: string,
		input: Record<string, unknown>,
		config: Pick<SessionConfig, "requireToolApproval" | "planMode" | "autoPermissionMode">,
	): Promise<ToolVerdict> {
		const allowedDirectories = this.deps.allowedDirectories();
		let resolvedEditPath: string | null = null;
		if (EDIT_TOOLS.has(toolName)) {
			const target = editTargetPath(toolName, input);
			resolvedEditPath =
				target === null
					? null
					: await resolveEditPath(target, allowedDirectories[0] ?? "", this.deps.realPath);
		}
		const allowedRoots = await Promise.all(
			allowedDirectories.map(async (directory) => {
				return (await this.deps.realPath(directory)) ?? directory;
			}),
		);
		const autoApproveEdits = this.deps.autoApproveEditsOverride?.() ?? this.autoApproveEdits;
		return classifyToolUse({
			toolName,
			input,
			resolvedEditPath,
			allowedRoots,
			requireToolApproval: config.requireToolApproval,
			autoApproveEdits,
			sessionLive: this.deps.isSessionLive(),
		});
	}

	private async exitPlanMode(
		input: Record<string, unknown>,
		config: Pick<SessionConfig, "requireToolApproval" | "planMode" | "autoPermissionMode">,
		options: Parameters<CanUseTool>[2],
	): Promise<PermissionResult> {
		const nextMode = modeAfterPlan(config);
		// The agent left plan mode while the chat already did, in default or auto mode: no click.
		if (!config.planMode && config.requireToolApproval) {
			await this.deps.setPermissionMode(nextMode);
			return {
				behavior: "allow",
				updatedInput: input,
				updatedPermissions: [{ type: "setMode", mode: nextMode, destination: "session" }],
			};
		}
		const plan = typeof input.plan === "string" ? input.plan.trim() : "";
		if (plan === "") {
			return { behavior: "deny", message: "ExitPlanMode needs the plan text." };
		}
		const callbacks = this.deps.callbacks();
		if (callbacks === undefined) {
			return { behavior: "deny", message: "The Claude session has no active turn." };
		}
		const planFilePath =
			typeof input.planFilePath === "string" && input.planFilePath !== ""
				? input.planFilePath
				: undefined;
		const interaction: Interaction = {
			kind: "plan_approval",
			plan,
			...(planFilePath === undefined ? {} : { planFilePath }),
		};
		const answer = await this.awaitAnswer(
			callbacks.requestInteraction(interaction, options.signal),
			options.signal,
		);
		const outcome = toPlanResult(input, answer, config, planFilePath);
		if (outcome.nextMode !== null) await this.deps.setPermissionMode(outcome.nextMode);
		return outcome.result;
	}

	private async ask(
		toolName: string,
		input: Record<string, unknown>,
		options: Parameters<CanUseTool>[2],
	): Promise<PermissionResult> {
		const callbacks = this.deps.callbacks();
		if (callbacks === undefined) {
			return { behavior: "deny", message: "The Claude session has no active turn." };
		}
		const interaction: Interaction = {
			kind: "tool_approval",
			toolUseId: options.toolUseID as ToolUseId,
			toolName,
			input,
			...(options.decisionReason === undefined ? {} : { reason: options.decisionReason }),
			...(options.blockedPath === undefined ? {} : { blockedPath: options.blockedPath }),
			...(suggestedRuleTexts(options.suggestions) === undefined
				? {}
				: { suggestedRules: suggestedRuleTexts(options.suggestions) }),
			...(options.agentID === undefined ? {} : { subAgentId: options.agentID }),
		};
		const answer = await this.awaitAnswer(
			callbacks.requestInteraction(interaction, options.signal),
			options.signal,
		);
		const outcome = toPermissionResult(toolName, input, answer, options.suggestions);
		if (outcome.enableAutoApproveEdits) this.autoApproveEdits = true;
		return outcome.result;
	}

	/** Waits for an answer, but treats an aborted tool call as withdrawn. */
	private async awaitAnswer(
		pending: Promise<InteractionAnswer>,
		signal: AbortSignal,
	): Promise<InteractionAnswer> {
		if (signal.aborted) return { kind: "withdrawn" };
		return new Promise<InteractionAnswer>((resolve) => {
			let settled = false;
			const finish = (answer: InteractionAnswer) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener("abort", onAbort);
				resolve(answer);
			};
			const onAbort = () => finish({ kind: "withdrawn" });
			signal.addEventListener("abort", onAbort, { once: true });
			void pending.then(finish, () => finish({ kind: "withdrawn" }));
		});
	}
}

/** The plain-words suggestions the approval card shows, when the agent proposes any. */
function suggestedRuleTexts(
	suggestions: readonly PermissionUpdate[] | undefined,
): string[] | undefined {
	if (suggestions === undefined || suggestions.length === 0) return undefined;
	return suggestions.map((suggestion) => {
		switch (suggestion.type) {
			case "addRules":
			case "replaceRules":
			case "removeRules": {
				const verb =
					suggestion.type === "addRules"
						? "Allow"
						: suggestion.type === "replaceRules"
							? "Replace the rules with"
							: "Remove the rule for";
				const rules = suggestion.rules.map((rule) =>
					rule.ruleContent === undefined ? rule.toolName : `${rule.toolName}: ${rule.ruleContent}`,
				);
				return `${verb} ${rules.join(", ")}`;
			}
			case "addDirectories":
				return `Allow edits in ${suggestion.directories.join(", ")}`;
			case "removeDirectories":
				return `Stop allowing edits in ${suggestion.directories.join(", ")}`;
			case "setMode":
				return `Switch to ${suggestion.mode} mode`;
			default:
				return "Update the permission rules";
		}
	});
}
