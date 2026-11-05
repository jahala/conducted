/**
 * @feature AGENT-04 Claude: tool approvals, plan mode, edit-path sandbox, live mode switch
 * Owns: the decisions behind the SDK's canUseTool callback: which permission mode a chat needs,
 * whether an edit stays inside the allowed folders, what to do with a tool call, and how the
 * user's answer becomes the SDK's permission result.
 * Behaviour: research/conductor/claude-runner.md section 3.1 (permission mode), 3.2 (the order of
 * checks in canUseTool) and 3.5 (plan mode). The CLI always starts in bypassPermissions and the
 * runner switches the mode live with setPermissionMode.
 * Must handle:
 *  - mode: plan mode wins, then approvals required means "default", else "bypassPermissions"
 *  - the order of checks: ExitPlanMode first; then edit tools must target a path inside the
 *    workspace or an additional directory (checked on the real path, so a symlink cannot escape);
 *    then our own app tools are allowed; then a chat that is no longer live is denied; then
 *    "approvals off" allows; then auto-approved edits allow; else ask the user
 *  - an edit tool without a path in its input: denied with a message that names the missing field
 *  - a path that equals an allowed root, or sits below it; "/work/app-other" is not inside
 *    "/work/app"
 *  - always_allow adds a rule for the tool to the project's local settings; allow_edits_for_session
 *    turns on auto-approval of edits for the rest of the chat
 *  - plan approved: switch to the mode the chat would have had without plan mode; rejected: deny and
 *    interrupt, with the user's feedback as the message
 * Test first: classifyToolUse for Edit on "/work/app-other/x.ts" with root "/work/app" is a deny
 * whose message names the allowed folders.
 *  - allow_with_suggested_rules: allow, and apply the permission rules the SDK suggested with the
 *    request (D020: Conductor offers this third button)
 */
import type {
	PermissionMode,
	PermissionResult,
	PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";
import type { InteractionAnswer, SessionConfig } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import { APP_TOOL_NAME_PREFIX } from "./constants.ts";

export function permissionModeFor(
	config: Pick<SessionConfig, "planMode" | "requireToolApproval">,
): PermissionMode {
	if (config.planMode) return "plan";
	return config.requireToolApproval ? "default" : "bypassPermissions";
}

/** The mode to return to when a plan is approved: what the chat would use without plan mode. */
export function modeAfterPlan(config: Pick<SessionConfig, "requireToolApproval">): PermissionMode {
	return config.requireToolApproval ? "default" : "bypassPermissions";
}

export const EDIT_TOOLS: ReadonlySet<string> = new Set([
	"Edit",
	"MultiEdit",
	"Write",
	"NotebookEdit",
]);

/** The path an edit tool writes to, from its input. */
export function editTargetPath(toolName: string, input: Record<string, unknown>): string | null {
	const key = toolName === "NotebookEdit" ? "notebook_path" : "file_path";
	const value = input[key];
	return typeof value === "string" && value !== "" ? value : null;
}

/** True when `path` equals a root or sits below it. Both must already be real, absolute paths. */
export function isInsideAny(path: string, roots: readonly string[]): boolean {
	return roots.some((root) => {
		const base = root.endsWith("/") ? root.slice(0, -1) : root;
		return path === base || path.startsWith(`${base}/`);
	});
}

export type ToolVerdict =
	| { kind: "exit_plan_mode" }
	| { kind: "allow" }
	| { kind: "deny"; message: string }
	| { kind: "ask" };

export interface ToolUseFacts {
	toolName: string;
	input: Record<string, unknown>;
	/** The edit target after resolving symlinks, or null when it could not be resolved. */
	resolvedEditPath: string | null;
	/** Workspace folder and additional directories, after resolving symlinks. */
	allowedRoots: readonly string[];
	requireToolApproval: boolean;
	autoApproveEdits: boolean;
	sessionLive: boolean;
}

export function classifyToolUse(facts: ToolUseFacts): ToolVerdict {
	if (facts.toolName === "ExitPlanMode") return { kind: "exit_plan_mode" };
	if (EDIT_TOOLS.has(facts.toolName)) {
		if (editTargetPath(facts.toolName, facts.input) === null) {
			const field = facts.toolName === "NotebookEdit" ? "notebook_path" : "file_path";
			return { kind: "deny", message: `${facts.toolName} needs a ${field}.` };
		}
		if (
			facts.resolvedEditPath === null ||
			!isInsideAny(facts.resolvedEditPath, facts.allowedRoots)
		) {
			return {
				kind: "deny",
				message: `Cannot edit files outside the allowed folders (${facts.allowedRoots.join(", ")}).`,
			};
		}
	}
	if (facts.toolName.startsWith(APP_TOOL_NAME_PREFIX)) return { kind: "allow" };
	if (!facts.sessionLive) {
		return { kind: "deny", message: "The Claude session is no longer active." };
	}
	if (!facts.requireToolApproval) return { kind: "allow" };
	if (EDIT_TOOLS.has(facts.toolName) && facts.autoApproveEdits) return { kind: "allow" };
	return { kind: "ask" };
}

export interface ApprovalOutcome {
	result: PermissionResult;
	/** True when the chat should auto-approve edits from now on. */
	enableAutoApproveEdits: boolean;
}

/** Turns the user's answer to a tool_approval interaction into the SDK's permission result. */
export function toPermissionResult(
	toolName: string,
	input: Record<string, unknown>,
	answer: InteractionAnswer,
): ApprovalOutcome {
	if (answer.kind !== "tool_approval") {
		return {
			result: { behavior: "deny", message: `${toolName} was not approved.` },
			enableAutoApproveEdits: false,
		};
	}
	switch (answer.decision) {
		case "deny":
			return {
				result: {
					behavior: "deny",
					message: answer.message ?? `${toolName} was denied by the user.`,
				},
				enableAutoApproveEdits: false,
			};
		case "allow_edits_for_session":
			return { result: { behavior: "allow", updatedInput: input }, enableAutoApproveEdits: true };
		case "always_allow": {
			const update: PermissionUpdate = {
				type: "addRules",
				rules: [{ toolName }],
				behavior: "allow",
				destination: "localSettings",
			};
			return {
				result: { behavior: "allow", updatedInput: input, updatedPermissions: [update] },
				enableAutoApproveEdits: false,
			};
		}
		case "allow":
			return { result: { behavior: "allow", updatedInput: input }, enableAutoApproveEdits: false };
		case "allow_with_suggested_rules":
			return notImplemented("AGENT-04");
	}
}

/** Turns the user's answer to a plan_approval interaction into the result for ExitPlanMode. */
export function toPlanResult(
	input: Record<string, unknown>,
	answer: InteractionAnswer,
	config: Pick<SessionConfig, "requireToolApproval">,
	planFilePath?: string,
): { result: PermissionResult; nextMode: PermissionMode | null } {
	if (answer.kind === "plan_approval" && answer.approved) {
		const nextMode = modeAfterPlan(config);
		return {
			result: {
				behavior: "allow",
				updatedInput: { ...input, ...(planFilePath ? { planFilePath } : {}) },
				updatedPermissions: [{ type: "setMode", mode: nextMode, destination: "session" }],
			},
			nextMode,
		};
	}
	const feedback = answer.kind === "plan_approval" ? answer.feedback : undefined;
	return {
		result: {
			behavior: "deny",
			message: feedback ?? "The plan was not approved.",
			interrupt: true,
		},
		nextMode: null,
	};
}
