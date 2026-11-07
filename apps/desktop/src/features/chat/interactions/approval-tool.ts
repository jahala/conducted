/**
 * @feature CHAT-11 Tool approval card
 * Owns: the approval title for a tool request and whether its decision changes files, worked out
 * from the agent's own tool name.
 * Behaviour: ui-map.md 3.3 (title by tool such as 'Do you want to run this command?' and 'make
 * these changes?'), claude-runner.md 3.2 (edit tools).
 * Our design choice: the interaction carries the agent's own tool name, so this file turns it into
 * the canonical tool from packages/protocol/src/tools.ts before classifying it. Unknown names stay
 * unknown instead of being guessed from substrings.
 * Must handle: our app tools (app_tool), another MCP server's tools (mcp), the old names 'Task'
 * and 'LS', and the snake and camel spellings the runners use.
 * Approval choices: Conductor's second choice (renderApp @104412): an edit offers 'Allow all edits
 * during this session'; a request with a suggested rule offers "Yes, and don't ask again for:
 * <rule>", the rule cut at 40 characters with '...'; an MCP tool, WebSearch or WebFetch offers
 * 'Always allow <tool name>'. A command on the Mac (CLOUD-14) offers 'Yes for this session' and
 * 'Yes always', as Conductor's local-command card does. Our design choice: where Conductor offers
 * no second choice (a command with no suggested rule) ours keeps 'Yes always', and a choice the
 * second one did not take stays as an extra button, so no choice we had goes away; both are listed
 * for the owner in the gap report.
 * Test first: approvalTitle("mcp__git__git_fetch_x") is 'Do you want to run this tool?' and
 * approvalTitle("MultiEdit") is 'Do you want to make these changes?'.
 */
import {
	APP_TOOL_SERVER,
	CANONICAL_TOOLS,
	type CanonicalTool,
	type InteractionAnswer,
} from "@conducted/protocol";

/** Native names whose canonical tool cannot be reached by changing the spelling alone. */
const NATIVE_ALIASES: Readonly<Record<string, CanonicalTool>> = {
	todo_write: "todo",
	ls: "list",
	list_dir: "list",
	list_files: "list",
	task: "sub_agent",
	agent: "sub_agent",
	subagent: "sub_agent",
	shell: "bash",
	exec: "bash",
	command: "bash",
	read_file: "read",
	write_file: "write",
	apply_patch: "edit",
	patch: "edit",
	file_change: "edit",
	webfetch: "web_fetch",
	websearch: "web_search",
};

const CANONICAL: ReadonlySet<string> = new Set(CANONICAL_TOOLS);

/** The agent's own tool name in the spelling used by the canonical table. */
function snakeCase(name: string): string {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/[\s-]+/g, "_")
		.toLowerCase();
}

/** The canonical tool for an approval request, or unknown when the name is not one we know. */
export function canonicalToolForApproval(toolName: string): CanonicalTool {
	if (toolName.startsWith(`mcp__${APP_TOOL_SERVER}__`)) return "app_tool";
	if (toolName.startsWith("mcp__")) return "mcp";
	const name = snakeCase(toolName);
	const alias = NATIVE_ALIASES[name];
	if (alias !== undefined) return alias;
	return CANONICAL.has(name) ? (name as CanonicalTool) : "unknown";
}

/** True for the tools whose approval is about changing files. */
export function editsFilesInApproval(toolName: string): boolean {
	const tool = canonicalToolForApproval(toolName);
	return tool === "write" || tool === "edit" || tool === "multi_edit" || tool === "notebook_edit";
}

/** True for the app tool that runs a command on the Mac (CLOUD-14), namespaced or bare. */
export function isRunLocalCommand(toolName: string): boolean {
	return (
		toolName === `mcp__${APP_TOOL_SERVER}__RunLocalCommand` ||
		snakeCase(toolName) === "run_local_command"
	);
}

/** The approval title Conductor shows for each kind of tool (ui-map.md 3.3). */
export function approvalTitle(toolName: string): string {
	if (isRunLocalCommand(toolName)) {
		return "Do you want to run this command on your Mac?";
	}
	switch (canonicalToolForApproval(toolName)) {
		case "bash":
			return "Do you want to run this command?";
		case "write":
		case "edit":
		case "multi_edit":
		case "notebook_edit":
			return "Do you want to make these changes?";
		case "sub_agent":
			return "Do you want to run this agent?";
		case "web_search":
			return "Do you want to do this search?";
		case "web_fetch":
			return "Do you want to fetch this page?";
		default:
			return "Do you want to run this tool?";
	}
}

type Decision = Extract<InteractionAnswer, { kind: "tool_approval" }>["decision"];

/** One button of the approval card besides Yes and No. */
export interface ApprovalChoice {
	decision: Exclude<Decision, "allow" | "deny">;
	label: string;
}

/** Conductor's limit on the rule named in the button label. */
const RULE_LABEL_LIMIT = 40;

function ruleLabel(rule: string): string {
	const shown = rule.length > RULE_LABEL_LIMIT ? `${rule.slice(0, RULE_LABEL_LIMIT)}...` : rule;
	return `Yes, and don't ask again for: ${shown}`;
}

function alwaysLabel(toolName: string): string {
	const tool = canonicalToolForApproval(toolName);
	const named =
		tool === "mcp" || tool === "app_tool" || tool === "web_search" || tool === "web_fetch";
	return named ? `Always allow ${toolName}` : "Yes always";
}

/**
 * The approval card's choices between Yes and No. The first is the Cmd+Enter choice; the rest are
 * ours, kept where Conductor's second choice took another one.
 */
export function approvalChoices(
	toolName: string,
	suggestedRules: readonly string[],
): ApprovalChoice[] {
	if (isRunLocalCommand(toolName)) {
		return [
			{ decision: "allow_for_session", label: "Yes for this session" },
			{ decision: "always_allow", label: "Yes always" },
		];
	}
	const rule = suggestedRules.find((entry) => entry.trim().length > 0);
	const withRule: ApprovalChoice | null =
		rule === undefined ? null : { decision: "allow_with_suggested_rules", label: ruleLabel(rule) };
	if (editsFilesInApproval(toolName)) {
		const edits: ApprovalChoice = {
			decision: "allow_edits_for_session",
			label: "Allow all edits during this session",
		};
		return withRule === null ? [edits] : [edits, withRule];
	}
	const always: ApprovalChoice = { decision: "always_allow", label: alwaysLabel(toolName) };
	return withRule === null ? [always] : [withRule, always];
}
