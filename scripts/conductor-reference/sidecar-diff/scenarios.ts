/**
 * The scenarios of the sidecar differential run (diff.ts). Each is one sequence of app calls, written
 * once in neutral steps; the adapters (adapters.ts) turn each step into each sidecar's own call.
 *
 * The marker `[[sdiff:<turn>]]` in a message picks the turn the fake agent plays (fake-agent.ts):
 * plain, tools, approval, plan, error, slow or legacy. A slow turn waits up to four seconds for an
 * interrupt or another message. A legacy turn is a plain one whose result does not name the user
 * message it answers, as Claude programs before the `user_message_uuid` field send it.
 */

export type Agent = "claude" | "codex";

export type Step =
	/** Start the agent before the first message. */
	| { do: "warm" }
	| { do: "send"; turn: string; text: string }
	/** Wait until the sidecar says the turn ended (bounded), then until the stream is quiet. */
	| { do: "waitTurnEnd" }
	/** Wait until an agent event carrying this text arrives (bounded). */
	| { do: "waitText"; text: string }
	| { do: "cancel" }
	| { do: "status" }
	| { do: "listModels" }
	| { do: "listSlashCommands" };

export interface Scenario {
	id: string;
	title: string;
	agent: Agent;
	planMode?: boolean;
	requireToolApproval?: boolean;
	/** How the app answers a tool or plan approval. */
	approve?: boolean;
	/** The Codex approval policy and sandbox the chat asks for. Missing: each sidecar's default. */
	codexPolicy?: { approval: string; sandbox: string };
	/** Managed requirements the fake Codex reports (`configRequirements/read`). Missing: none. */
	codexRequirements?: Record<string, unknown>;
	steps: Step[];
}

/**
 * A `ConfigRequirements` value of codex-cli 0.154.0 (`codex app-server generate-ts`): every field
 * null except the allowed approval policies and sandbox modes.
 */
const requirements = (
	allowedApprovalPolicies: string[],
	allowedSandboxModes: string[],
): Record<string, unknown> => ({
	cliAuthCredentialsStore: null,
	chatgptBaseUrl: null,
	additionalDeveloperInstructions: null,
	allowedApprovalPolicies,
	allowedSandboxModes,
	allowedWindowsSandboxImplementations: null,
	allowedPermissionProfiles: null,
	defaultPermissions: null,
	allowedWebSearchModes: null,
	allowManagedHooksOnly: null,
	allowBrowserAndComputerUse: null,
	allowAppshots: null,
	allowRemoteControl: null,
	computerUse: null,
	browserUse: null,
	inAppBrowser: null,
	featureRequirements: null,
	enforceResidency: null,
	autoReview: null,
	models: null,
	sqliteHome: null,
	logDir: null,
	modelCatalogJson: null,
	checkForUpdateOnStartup: null,
	allowLoginShell: null,
	feedback: null,
	windowsSandboxPrivateDesktop: null,
});

const say = (turn: string, words: string): Step => ({
	do: "send",
	turn,
	text: `[[sdiff:${turn}]] ${words}`,
});

export const SCENARIOS: Scenario[] = [
	{
		id: "start-chat",
		title: "Start a chat: warm the agent, then ask for the chat's status",
		agent: "claude",
		steps: [{ do: "warm" }, { do: "status" }],
	},
	{
		id: "send-message",
		title: "Send a message and get a plain answer",
		agent: "claude",
		steps: [say("plain", "Say hello."), { do: "waitTurnEnd" }, { do: "status" }],
	},
	{
		id: "tool-turn",
		title: "A turn with a tool call and its result",
		agent: "claude",
		steps: [say("tools", "List the files."), { do: "waitTurnEnd" }],
	},
	{
		id: "cancel",
		title: "Cancel a running turn",
		agent: "claude",
		steps: [
			say("slow", "Do a long task."),
			{ do: "waitText", text: "Working on it." },
			{ do: "cancel" },
			{ do: "waitTurnEnd" },
			{ do: "status" },
		],
	},
	{
		id: "error",
		title: "The agent's turn ends in an API error",
		agent: "claude",
		steps: [say("error", "Fail please."), { do: "waitTurnEnd" }],
	},
	{
		id: "queued-message",
		title: "A second message sent while the first turn runs",
		agent: "claude",
		steps: [
			say("slow", "Do a long task."),
			{ do: "waitText", text: "Working on it." },
			say("plain", "And then say hello."),
			{ do: "waitTurnEnd" },
			{ do: "waitTurnEnd" },
		],
	},
	{
		id: "plan-mode",
		title: "A plan-mode turn: the agent proposes a plan and the user approves it",
		agent: "claude",
		planMode: true,
		approve: true,
		steps: [say("plan", "Plan the change."), { do: "waitTurnEnd" }],
	},
	{
		id: "approval",
		title: "A tool call that needs the user's approval, approved",
		agent: "claude",
		requireToolApproval: true,
		approve: true,
		steps: [say("approval", "Create a file."), { do: "waitTurnEnd" }],
	},
	{
		id: "approval-denied",
		title: "A tool call that needs the user's approval, denied",
		agent: "claude",
		requireToolApproval: true,
		approve: false,
		steps: [say("approval", "Create a file."), { do: "waitTurnEnd" }],
	},
	{
		id: "legacy-result",
		title: "A Claude result that does not name the message it answers (older Claude programs)",
		agent: "claude",
		steps: [say("legacy", "Say hello."), { do: "waitTurnEnd" }],
	},
	{
		id: "list-models-codex",
		title: "List Codex's models",
		agent: "codex",
		steps: [{ do: "listModels" }],
	},
	{
		id: "list-models-claude",
		title: "List Claude's models",
		agent: "claude",
		steps: [{ do: "listModels" }],
	},
	{
		id: "slash-commands",
		title: "List Claude's slash commands in a workspace",
		agent: "claude",
		steps: [{ do: "listSlashCommands" }],
	},
	{
		id: "codex-message",
		title: "Send a message to Codex and get a plain answer",
		agent: "codex",
		steps: [say("plain", "Say hello."), { do: "waitTurnEnd" }],
	},
	{
		id: "codex-approval",
		title: "A Codex command that needs the user's approval, approved",
		agent: "codex",
		requireToolApproval: true,
		approve: true,
		steps: [say("approval", "Create a file."), { do: "waitTurnEnd" }],
	},
	{
		id: "codex-requirements",
		title:
			"A Codex message under managed requirements that refuse the requested policy and sandbox",
		agent: "codex",
		codexRequirements: requirements(["untrusted", "on-request"], ["read-only", "workspace-write"]),
		steps: [say("plain", "Say hello."), { do: "waitTurnEnd" }],
	},
	{
		id: "codex-requirements-reversed",
		title: "The same requirements, each list in the other order",
		agent: "codex",
		codexRequirements: requirements(["on-request", "untrusted"], ["workspace-write", "read-only"]),
		steps: [say("plain", "Say hello."), { do: "waitTurnEnd" }],
	},
	{
		id: "codex-requirements-allowed",
		title: "A Codex approval chat under managed requirements that allow what it asks for",
		agent: "codex",
		requireToolApproval: true,
		codexRequirements: requirements(["on-request", "never"], ["danger-full-access"]),
		steps: [say("plain", "Say hello."), { do: "waitTurnEnd" }],
	},
	{
		id: "codex-requirements-middle",
		title:
			"Managed requirements that refuse a middle policy and sandbox, with one choice on each side",
		agent: "codex",
		codexPolicy: { approval: "on-request", sandbox: "workspace-write" },
		codexRequirements: requirements(["untrusted", "never"], ["read-only", "danger-full-access"]),
		steps: [say("plain", "Say hello."), { do: "waitTurnEnd" }],
	},
	{
		id: "codex-requirements-middle-reversed",
		title: "The same middle case, each list in the other order",
		agent: "codex",
		codexPolicy: { approval: "on-request", sandbox: "workspace-write" },
		codexRequirements: requirements(["never", "untrusted"], ["danger-full-access", "read-only"]),
		steps: [say("plain", "Say hello."), { do: "waitTurnEnd" }],
	},
	{
		id: "codex-requirements-stricter",
		title: "Managed requirements that allow only more permissive choices than the chat asks for",
		agent: "codex",
		codexPolicy: { approval: "untrusted", sandbox: "read-only" },
		codexRequirements: requirements(
			["on-request", "never"],
			["workspace-write", "danger-full-access"],
		),
		steps: [say("plain", "Say hello."), { do: "waitTurnEnd" }],
	},
	{
		id: "codex-requirements-stricter-reversed",
		title: "The stricter case, each list in the other order",
		agent: "codex",
		codexPolicy: { approval: "untrusted", sandbox: "read-only" },
		codexRequirements: requirements(
			["never", "on-request"],
			["danger-full-access", "workspace-write"],
		),
		steps: [say("plain", "Say hello."), { do: "waitTurnEnd" }],
	},
	{
		id: "codex-requirements-only-wider",
		title: "Managed requirements that allow one choice each, wider than the chat's middle request",
		agent: "codex",
		codexPolicy: { approval: "on-request", sandbox: "workspace-write" },
		codexRequirements: requirements(["never"], ["danger-full-access"]),
		steps: [say("plain", "Say hello."), { do: "waitTurnEnd" }],
	},
	{
		id: "codex-cancel",
		title: "Cancel a running Codex turn",
		agent: "codex",
		steps: [
			say("slow", "Do a long task."),
			{ do: "waitText", text: "Working on it." },
			{ do: "cancel" },
			{ do: "waitTurnEnd" },
		],
	},
];
