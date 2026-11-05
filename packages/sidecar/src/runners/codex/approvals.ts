/**
 * @feature AGENT-08 Codex: approvals, permission grants, MCP forms
 * Owns: translating the requests Codex sends us into interactions, the user's answers back into
 * Codex's reply shapes, and the mcpConsentOutcome event for a consent that ended without an
 * acceptance.
 * Behaviour: research/conductor/other-runners.md section 4 (Codex row): command and file-change
 * approvals become tool approvals named Bash and Edit; `item/tool/requestUserInput` becomes a
 * question; `mcpServer/elicitation/request` becomes a form; `item/permissions/requestApproval`
 * becomes a permission grant. The reply values below were checked against the generated bindings
 * of codex-cli 0.154.0: command decisions accept, acceptForSession, decline, cancel; file-change
 * decisions the same four without the amendments; elicitation actions accept, decline, cancel;
 * permission scopes turn and session; an empty permission profile declines.
 * Must handle:
 *  - "withdrawn" from the user (cancel or new message) maps to Codex's "cancel" for a command,
 *    file-change or form request, not "decline", so Codex stops the turn instead of letting the
 *    agent retry; a permission grant has no cancel value in the binding, so it returns an empty
 *    profile
 *  - always_allow has no persistent form in this protocol subset; it maps to acceptForSession
 *  - a permission grant grants exactly what was requested, for the turn unless the user chose the
 *    session; "not granted" returns an empty profile (our design choice: the binding has no
 *    separate decline value)
 *  - an MCP form in a mode we cannot show (url mode) is declined without opening a card
 *  - the question tool: option labels become the answers, keyed by the question's id
 * Test first: decisionForApproval({ kind: "tool_approval", decision: "allow_edits_for_session" })
 * is "acceptForSession" and a withdrawn answer is "cancel".
 */
import type { AgentMessage, Interaction, InteractionAnswer } from "@conducted/protocol";
import type { ToolUseId } from "@conducted/shared";

type PermissionPath = Extract<Interaction, { kind: "permission_grant" }>["paths"][number];

export type CodexCommandDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export function decisionForApproval(answer: InteractionAnswer): CodexCommandDecision {
	if (answer.kind === "withdrawn") return "cancel";
	if (answer.kind !== "tool_approval") return "decline";
	switch (answer.decision) {
		case "allow":
		// Codex requests carry no suggested rules, so the card never offers this; it allows once.
		case "allow_with_suggested_rules":
			return "accept";
		case "allow_edits_for_session":
		case "always_allow":
			return "acceptForSession";
		case "deny":
			return "decline";
	}
}

export type CodexElicitationAction = "accept" | "decline" | "cancel";

export interface CodexElicitationReply {
	action: CodexElicitationAction;
	content: unknown;
	_meta: null;
}

export function elicitationReply(answer: InteractionAnswer): CodexElicitationReply {
	if (answer.kind === "withdrawn") return { action: "cancel", content: null, _meta: null };
	if (answer.kind !== "mcp_form") return { action: "decline", content: null, _meta: null };
	return {
		action: answer.action,
		content: answer.action === "accept" ? (answer.content ?? null) : null,
		_meta: null,
	};
}

/** True when the answer grants the permission. Withdrawn and mismatched answers do not. */
export function permissionGranted(answer: InteractionAnswer): boolean {
	return answer.kind === "permission_grant" && answer.granted;
}

/** A request the bridge can show and answer, with its reply shape. */
export interface CodexApprovalPlan<TReply> {
	interaction: Interaction;
	reply(answer: InteractionAnswer): TReply;
}

export interface CodexCommandReply {
	decision: CodexCommandDecision;
}

/** A Codex command approval as a Bash tool approval. Null when the request names no item. */
export function planCommandApproval(params: unknown): CodexApprovalPlan<CodexCommandReply> | null {
	const request = asRecord(params);
	const itemId = readString(request, "itemId");
	if (itemId === null) return null;
	const command = readString(request, "command");
	const cwd = readString(request, "cwd");
	const reason = readString(request, "reason");
	return {
		interaction: {
			kind: "tool_approval",
			toolUseId: itemId as ToolUseId,
			toolName: "Bash",
			input: {
				...(command === null ? {} : { command }),
				...(cwd === null ? {} : { cwd }),
			},
			...(reason === null ? {} : { reason }),
		},
		reply: (answer) => ({ decision: decisionForApproval(answer) }),
	};
}

/** A Codex file-change approval as an Edit tool approval. Null when the request names no item. */
export function planFileChangeApproval(
	params: unknown,
): CodexApprovalPlan<CodexCommandReply> | null {
	const request = asRecord(params);
	const itemId = readString(request, "itemId");
	if (itemId === null) return null;
	const reason = readString(request, "reason");
	const grantRoot = readString(request, "grantRoot");
	return {
		interaction: {
			kind: "tool_approval",
			toolUseId: itemId as ToolUseId,
			toolName: "Edit",
			input: { ...(grantRoot === null ? {} : { grantRoot }) },
			...(reason === null ? {} : { reason }),
		},
		reply: (answer) => ({ decision: decisionForApproval(answer) }),
	};
}

export interface CodexUserInputReply {
	answers: Record<string, { answers: string[] }>;
}

/**
 * The user-input tool as a question. Each question keeps its id so the answer can be sent back
 * under that id. Null when the request carries no questions.
 */
export function planToolUserInput(params: unknown): CodexApprovalPlan<CodexUserInputReply> | null {
	const request = asRecord(params);
	const list = Array.isArray(request?.questions) ? request.questions : [];
	const questions: {
		id: string;
		header?: string;
		question: string;
		options: { label: string; description?: string }[];
		secret: boolean;
	}[] = [];
	for (const entry of list) {
		const question = asRecord(entry);
		const id = readString(question, "id");
		const text = readString(question, "question");
		if (id === null || text === null) continue;
		const header = readString(question, "header");
		const options: { label: string; description?: string }[] = [];
		if (Array.isArray(question?.options)) {
			for (const optionEntry of question.options) {
				const option = asRecord(optionEntry);
				const label = readString(option, "label");
				if (label === null) continue;
				const description = readString(option, "description");
				options.push({
					label,
					...(description === null || description === "" ? {} : { description }),
				});
			}
		}
		questions.push({
			id,
			...(header === null || header === "" ? {} : { header }),
			question: text,
			options: options.slice(0, 4),
			secret: question?.isSecret === true,
		});
	}
	if (questions.length === 0) return null;
	const shown = questions.slice(0, 4);
	return {
		interaction: {
			kind: "question",
			questions: shown.map((question) => ({
				...(question.header === undefined ? {} : { header: question.header }),
				question: question.question,
				options: question.options,
				multiSelect: false,
				secret: question.secret,
			})),
		},
		reply: (answer) => {
			const chosen = answer.kind === "question" ? answer.answers : [];
			const answers: Record<string, { answers: string[] }> = {};
			for (const [index, question] of shown.entries()) {
				answers[question.id] = { answers: chosen[index] ?? [] };
			}
			return { answers };
		},
	};
}

export type CodexMcpPlan =
	| (CodexApprovalPlan<CodexElicitationReply> & { kind: "interaction" })
	| { kind: "unsupported"; mode: string; reply(): CodexElicitationReply };

/**
 * An MCP elicitation as a form. A url-mode request cannot be shown, so it is declined without a
 * card. Null when the request is not an elicitation at all.
 */
export function planMcpElicitation(params: unknown): CodexMcpPlan | null {
	const request = asRecord(params);
	if (request === null) return null;
	const mode = readString(request, "mode");
	if (mode === null) return null;
	if (mode !== "form" && mode !== "openai/form" && mode !== "openaiForm") {
		return {
			kind: "unsupported",
			mode,
			reply: () => ({ action: "decline", content: null, _meta: null }),
		};
	}
	const server = readString(request, "serverName");
	const message = readString(request, "message");
	const schema = request.requestedSchema;
	if (server === null || message === null || schema === undefined) return null;
	return {
		kind: "interaction",
		interaction: {
			kind: "mcp_form",
			server,
			message,
			schema,
		},
		reply: elicitationReply,
	};
}

export interface CodexPermissionReply {
	permissions: {
		network?: { enabled: boolean | null } | null;
		fileSystem?: unknown;
	};
	scope: "turn" | "session";
}

/**
 * A permission request as a permission grant. The card shows the reason, each requested path and
 * whether Codex asks to read, write or deny it, and the network switch.
 */
export function planPermissionApproval(
	params: unknown,
): CodexApprovalPlan<CodexPermissionReply> | null {
	const request = asRecord(params);
	if (request === null) return null;
	const permissions = asRecord(request.permissions);
	const requested = permissionProfile(permissions);
	const reason = readString(request, "reason");
	const description = reason ?? "Codex asks for file-system or network access beyond its sandbox.";
	return {
		interaction: {
			kind: "permission_grant",
			description,
			...(reason === null ? {} : { reason }),
			paths: permissionPaths(permissions),
			network: networkRequested(permissions),
		},
		reply: (answer) =>
			permissionGranted(answer)
				? {
						permissions: requested,
						scope:
							answer.kind === "permission_grant" && answer.grantFor === "session"
								? "session"
								: "turn",
					}
				: { permissions: {}, scope: "turn" },
	};
}

export type CodexConsentOutcome =
	| "user_declined"
	| "user_canceled"
	| "interaction_unavailable"
	| "timeout"
	| "agent_cancelled";

/** The non-terminal event Conductor shows for a consent outcome: `[codex-mcp-consent] <outcome>`. */
export function consentOutcomeMessage(outcome: CodexConsentOutcome): AgentMessage {
	return {
		agent: "codex",
		items: [
			{
				kind: "error",
				code: "codex_mcp_consent",
				message: `[codex-mcp-consent] ${outcome}`,
				retryable: false,
			},
		],
		raw: { event: "codex.mcpConsentOutcome", outcome },
	};
}

/** The outcome to log for a consent answer, or undefined when the user accepted it. */
export function consentOutcomeFor(
	interaction: Interaction,
	answer: InteractionAnswer,
): CodexConsentOutcome | undefined {
	if (answer.kind === "withdrawn") return "user_canceled";
	if (interaction.kind === "permission_grant") {
		return permissionGranted(answer) ? undefined : "user_declined";
	}
	if (interaction.kind === "mcp_form" && answer.kind === "mcp_form") {
		if (answer.action === "accept") return undefined;
		return answer.action === "decline" ? "user_declined" : "user_canceled";
	}
	return undefined;
}

function networkRequested(permissions: Record<string, unknown> | null): boolean {
	const network = asRecord(permissions?.network);
	return network !== null && network.enabled !== false;
}

function permissionPaths(permissions: Record<string, unknown> | null): PermissionPath[] {
	const fileSystem = asRecord(permissions?.fileSystem);
	if (fileSystem === null) return [];
	const paths: PermissionPath[] = [];
	if (Array.isArray(fileSystem.entries)) {
		for (const entry of fileSystem.entries) {
			const item = asRecord(entry);
			if (item === null) continue;
			const path = fileSystemPath(item.path);
			const access = readAccess(item.access);
			if (path === null || access === null) continue;
			paths.push({ ...path, access });
		}
	}
	if (paths.length > 0) return paths;
	for (const access of ["read", "write"] as const) {
		const list = fileSystem[access];
		if (!Array.isArray(list)) continue;
		for (const entry of list) {
			if (typeof entry !== "string" || entry === "") continue;
			paths.push({ path: entry, pathKind: "path", access });
		}
	}
	return paths;
}

function fileSystemPath(value: unknown): Pick<PermissionPath, "path" | "pathKind"> | null {
	const path = asRecord(value);
	const type = readString(path, "type");
	if (type === "path") {
		const target = readString(path, "path");
		return target === null ? null : { path: target, pathKind: "path" };
	}
	if (type === "glob_pattern") {
		const pattern = readString(path, "pattern");
		return pattern === null ? null : { path: pattern, pathKind: "glob" };
	}
	if (type === "special") {
		return { path: specialPathLabel(path?.value), pathKind: "special" };
	}
	return null;
}

function specialPathLabel(value: unknown): string {
	const special = asRecord(value);
	const kind = readString(special, "kind") ?? "special";
	const subpath = readString(special, "subpath");
	if (subpath !== null) return `${kind}/${subpath}`;
	if (kind === "unknown") return readString(special, "path") ?? kind;
	return kind;
}

function readAccess(value: unknown): PermissionPath["access"] | null {
	return value === "read" || value === "write" || value === "deny" ? value : null;
}

function permissionProfile(
	permissions: Record<string, unknown> | null,
): CodexPermissionReply["permissions"] {
	if (permissions === null) return {};
	const profile: CodexPermissionReply["permissions"] = {};
	if (permissions.network !== undefined && permissions.network !== null) {
		profile.network = permissions.network as { enabled: boolean | null };
	}
	if (permissions.fileSystem !== undefined && permissions.fileSystem !== null) {
		profile.fileSystem = permissions.fileSystem;
	}
	return profile;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readString(value: Record<string, unknown> | null | undefined, key: string): string | null {
	const field = value?.[key];
	return typeof field === "string" ? field : null;
}
