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
	steps: Step[];
}

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
