/**
 * @feature AGENT-04 Claude: the canUseTool handler
 * Owns: the SDK's canUseTool callback for one chat. It gathers the facts, asks classifyToolUse
 * (permissions.ts) for a verdict, asks the user when needed through requestInteraction, and
 * switches the permission mode after a plan is approved.
 * Behaviour: research/conductor/claude-runner.md sections 3.2 and 3.3: the callback has no
 * timeout on the SDK side; a tool approval waits for the user; ExitPlanMode asks for a plan
 * approval; "withdrawn" (cancel or a new message) denies.
 * Must handle:
 *  - the real path of an edit target is resolved before classification; an unresolvable path is
 *    checked as given, which classifyToolUse treats as outside
 *  - ExitPlanMode input without a plan string: denied with a message, not a crash
 *  - the abort signal fires while waiting: the interaction is withdrawn and the call denies
 *  - the answer kind does not match the question: treated as withdrawn
 *  - approval granted with "allow_edits_for_session": later edit calls skip the question
 *  - after an approved plan, setPermissionMode is called on the query with the next mode
 *  - callbacks are those of the current turn; between turns a call is denied as "no active turn"
 * Test first: a Bash call with approvals on opens a tool_approval interaction with the tool name
 * and input, and an "allow" answer yields behavior allow.
 */
import type { CanUseTool, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig } from "@conducted/protocol";
import { notImplemented } from "@conducted/shared";
import type { TurnCallbacks } from "../runner.ts";

export interface PermissionHandlerDeps {
	/** The config of the chat, read at call time because it can change live. */
	config(): Pick<SessionConfig, "requireToolApproval" | "planMode">;
	/** Workspace folder plus additional directories, as given (resolved inside the handler). */
	allowedDirectories(): readonly string[];
	callbacks(): TurnCallbacks | undefined;
	realPath(path: string): Promise<string | null>;
	isSessionLive(): boolean;
	setPermissionMode(mode: PermissionMode): Promise<void>;
}

export class ClaudePermissionHandler {
	private autoApproveEdits = false;

	constructor(protected readonly deps: PermissionHandlerDeps) {}

	/** The function to pass as Options.canUseTool. */
	get canUseTool(): CanUseTool {
		return notImplemented("AGENT-04");
	}

	/** True after the user chose "allow edits for this chat". */
	get editsAutoApproved(): boolean {
		return this.autoApproveEdits;
	}

	/** Clears the "allow edits for this chat" flag, for example after resetAgent. */
	resetSessionGrants(): void {
		this.autoApproveEdits = false;
	}
}
