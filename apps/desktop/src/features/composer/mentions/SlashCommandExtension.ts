/**
 * @feature COMP-06 / slash commands
 * Owns: The '/' trigger: the built-in commands of each agent, the project commands and skills the
 * sidecar lists, and the rule for what choosing one does (`slashCommandAction`).
 * Behaviour: ui-map.md 3.5 (built-in commands per agent, project commands, a 'Skills' group,
 * argument hints, terminal-effect commands and the messages for a command a chat does not offer),
 * claude-runner.md 7 (the sidecar lists slash commands).
 * Our design choice: the sidecar's list supplies the project commands and skills; Conductor's
 * built-in commands are added per agent, and the sidecar's entry wins when it names the same
 * command. Only a '/' at the start of the message opens the menu. Choosing a command with an
 * argument hint writes '/name ' into the composer, so the user types the arguments and sends the
 * message; any other command runs at once through `onRun`. What it runs is `slashCommandAction`:
 * /clear, /restart, /compact (Codex), /plan, /fast and the terminal-effect commands act on the
 * app; /goal (Codex) puts the composer in goal mode (COMP-10); /add-dir opens the Link workspaces and directories dialog (WS-07); a command the agent
 * lists is sent to it as text; a built-in whose app action is not built yet and that the agent
 * does not list says "This command isn't available in this workspace."
 * Must handle: a command the agent does not offer (hidden from the list, and a typed one shows
 * "This command isn't available in this workspace."); /plan on an agent without plan mode ("Plan
 * mode is not available in this chat."); /goal on an agent without goals ("Codex goals are not
 * available in this chat."; Our design choice: Conductor sends a typed '/goal' to such an agent as
 * text); an argument hint (shown after the name, and the command
 * waits for its arguments); the agent's list still loading or failed to load (the menu says so and
 * still offers the built-ins); choosing by click, Enter or Tab (the composer's send key leaves them
 * to the open menu, trigger-menu.ts, and with no row they send nothing), and moving with the arrow keys;
 * removing the typed command from the composer; removing the menu when the editor unmounts.
 * Test first: Typing '/co' lists '/compact' for Claude and not for an agent that lacks it.
 */
import type { SlashCommand } from "@conducted/protocol";
import type { AcpAgent, AgentKind } from "@conducted/shared";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { type Editor, Extension, ReactRenderer } from "@tiptap/react";
import { createElement } from "react";
import { GOAL_UNAVAILABLE } from "../../../core/services/sessions.ts";
import { toast } from "../../../ui/Toast.tsx";
import { SuggestionPopup, type SuggestionRow } from "./SuggestionPopup.tsx";
import type { TriggerMenuSpec } from "./trigger-menu.ts";

/** Where the agent's own list stands. The built-ins are offered whatever it says. */
export type SlashListState =
	| { state: "loading" }
	| { state: "ready" }
	| { state: "error"; message: string };

export interface SlashCommandDeps {
	/** The agent's own list from `useSlashCommands`. */
	commands: SlashCommand[];
	/** Runs a chosen command that takes no arguments. */
	onRun: (command: SlashCommand) => void;
	/** Which agent's built-in commands to add. Without it, only the sidecar's list is shown. */
	agent?: AgentKind;
	acpAgent?: AcpAgent;
	/** Whether the agent's list is loading, ready or failed. Missing means ready. */
	listState?: SlashListState;
}

export type SlashCommandGroup = "Built-in" | "Project" | "Skills";

/** The commands Conductor offers itself, in its table's order. */
const BUILTIN_COMMANDS: readonly SlashCommand[] = [
	{
		name: "clear",
		description: "Close this tab and start a fresh chat",
		source: "builtin",
		kind: "command",
	},
	{
		name: "restart",
		description: "Restart the agent process to pick up config changes",
		source: "builtin",
		kind: "command",
	},
	{
		name: "add-dir",
		description: "Link a directory or workspace",
		source: "builtin",
		kind: "command",
	},
	{
		name: "personality",
		description: "Choose Codex's personality for this session",
		source: "builtin",
		kind: "command",
	},
	{
		name: "goal",
		description: "Set the objective Codex should keep working toward",
		source: "builtin",
		kind: "command",
	},
	{
		name: "mcp-status",
		description: "View MCP server connection status",
		source: "builtin",
		kind: "command",
	},
	{
		name: "mcp",
		description: "Manage MCP servers (opens terminal)",
		source: "builtin",
		kind: "command",
	},
	{
		name: "agents",
		description: "Manage agents (opens terminal)",
		source: "builtin",
		kind: "command",
	},
	{
		name: "hooks",
		description: "Manage hooks (opens terminal)",
		source: "builtin",
		kind: "command",
	},
	{
		name: "memory",
		description: "Manage memory (opens terminal)",
		source: "builtin",
		kind: "command",
	},
	{
		name: "permissions",
		description: "Manage permissions (opens terminal)",
		source: "builtin",
		kind: "command",
	},
	{
		name: "plugins",
		description: "Manage plugins (opens terminal)",
		source: "builtin",
		kind: "command",
	},
	{
		name: "compact",
		description: "Compact the context window",
		source: "builtin",
		kind: "command",
	},
	{ name: "ultracode", description: "Enable Ultracode", source: "builtin", kind: "command" },
	{
		name: "plan",
		description: "Enter plan mode or exit plan mode",
		source: "builtin",
		kind: "command",
	},
	{ name: "fast", description: "Turn fast mode on or off", source: "builtin", kind: "command" },
];

/** Which agent offers each built-in command, from Conductor's table. */
const BUILTIN_AGENTS: Readonly<Record<string, readonly AgentKind[]>> = {
	clear: ["claude", "codex"],
	restart: ["claude", "codex"],
	"add-dir": ["claude", "codex"],
	personality: ["codex"],
	goal: ["codex"],
	"mcp-status": ["claude", "codex"],
	mcp: ["claude", "codex"],
	agents: ["claude"],
	hooks: ["claude"],
	memory: ["claude"],
	permissions: ["claude"],
	plugins: ["claude"],
	compact: ["claude", "codex"],
	ultracode: ["claude"],
	plan: ["claude", "codex"],
	fast: ["claude", "codex", "cursor"],
};

/** Commands that run in the embedded terminal instead of the chat. */
const TERMINAL_EFFECT = new Set(["mcp", "agents", "hooks", "memory", "permissions", "plugins"]);

/** Agents whose chats have plan mode. */
const PLAN_AGENTS = new Set<AgentKind>(["claude", "codex"]);

export const COMMAND_UNAVAILABLE = "This command isn't available in this workspace.";
export const PLAN_MODE_UNAVAILABLE = "Plan mode is not available in this chat.";

export interface SlashCommandEntry {
	command: SlashCommand;
	group: SlashCommandGroup;
}

export const isTerminalEffectCommand = (command: SlashCommand): boolean =>
	TERMINAL_EFFECT.has(command.name);

function groupOf(command: SlashCommand): SlashCommandGroup {
	if (command.kind === "skill") return "Skills";
	return command.source === "builtin" ? "Built-in" : "Project";
}

/** The built-in commands one agent offers, in the table's order. */
export function builtinSlashCommands(agent: AgentKind | undefined): SlashCommand[] {
	if (agent === undefined) return [];
	return BUILTIN_COMMANDS.filter((command) => BUILTIN_AGENTS[command.name]?.includes(agent));
}

/**
 * The agent's list plus the built-ins it does not already list. The sidecar's entry wins for a
 * name it reports, so an agent's own description and argument hint are kept.
 */
export function mergeSlashCommands(
	commands: readonly SlashCommand[],
	agent: AgentKind | undefined,
): SlashCommand[] {
	const seen = new Set<string>();
	const merged: SlashCommand[] = [];
	for (const command of commands) {
		if (seen.has(command.name)) continue;
		seen.add(command.name);
		merged.push(command);
	}
	for (const command of builtinSlashCommands(agent)) {
		if (seen.has(command.name)) continue;
		seen.add(command.name);
		merged.push(command);
	}
	return merged;
}

const GROUP_ORDER: readonly SlashCommandGroup[] = ["Built-in", "Project", "Skills"];

/** The commands matching a typed prefix, ordered built-in, project, then skills. */
export function slashCommandEntries(
	commands: readonly SlashCommand[],
	agent: AgentKind | undefined,
	query: string,
): SlashCommandEntry[] {
	const needle = query.toLowerCase();
	const entries = mergeSlashCommands(commands, agent)
		.filter((command) => command.name.toLowerCase().startsWith(needle))
		.map((command) => ({ command, group: groupOf(command) }));
	entries.sort((left, right) => {
		const byGroup = GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group);
		return byGroup !== 0 ? byGroup : left.command.name.localeCompare(right.command.name);
	});
	return entries;
}

const rowOf = (entry: SlashCommandEntry): SuggestionRow => {
	const hint = entry.command.argumentHint?.trim();
	const detail =
		hint === undefined || hint.length === 0
			? entry.command.description
			: `${entry.command.description} ${hint}`;
	return { id: entry.command.name, label: `/${entry.command.name}`, detail };
};

/** The popup's rows for a typed prefix. */
export function slashCommandRows(
	commands: readonly SlashCommand[],
	agent: AgentKind | undefined,
	query: string,
): SuggestionRow[] {
	return slashCommandEntries(commands, agent, query).map(rowOf);
}

/** The message shown for a typed command that cannot run here, or null when it can. */
export function slashCommandProblem(query: string, agent: AgentKind | undefined): string | null {
	if (query.length === 0) return null;
	if (query === "plan" && agent !== undefined && !PLAN_AGENTS.has(agent)) {
		return PLAN_MODE_UNAVAILABLE;
	}
	if (query === "goal" && agent !== "codex") return GOAL_UNAVAILABLE;
	if (builtinSlashCommands(agent).some((command) => command.name === query)) return null;
	return COMMAND_UNAVAILABLE;
}

/** What choosing a command does. `screen` runs the command handler the composer's own control has. */
export type SlashAction =
	| { kind: "clear" }
	| { kind: "restart" }
	| { kind: "compact" }
	| { kind: "linkDirectories" }
	| { kind: "goal" }
	| { kind: "screen"; commandId: "chat.togglePlanMode" | "chat.toggleFastMode" }
	| { kind: "terminal" }
	| { kind: "send"; text: string }
	| { kind: "unavailable"; message: string };

/**
 * The one rule for what a chosen command does. `listed` is the agent's own list: a command it
 * names is sent to it as text. A built-in that acts on the app runs that action instead, because
 * the agent cannot close a tab or restart itself.
 */
export function slashCommandAction(
	command: SlashCommand,
	listed: readonly SlashCommand[],
	agent: AgentKind | undefined,
): SlashAction {
	if (isTerminalEffectCommand(command)) return { kind: "terminal" };
	switch (command.name) {
		case "clear":
			return { kind: "clear" };
		case "restart":
			return { kind: "restart" };
		case "add-dir":
			return { kind: "linkDirectories" };
		case "compact":
			// Codex has its own compact call (AGENT-14); Claude takes /compact as message text.
			if (agent === "codex") return { kind: "compact" };
			break;
		case "plan":
			return agent !== undefined && !PLAN_AGENTS.has(agent)
				? { kind: "unavailable", message: PLAN_MODE_UNAVAILABLE }
				: { kind: "screen", commandId: "chat.togglePlanMode" };
		case "fast":
			return { kind: "screen", commandId: "chat.toggleFastMode" };
		case "goal":
			return agent === "codex"
				? { kind: "goal" }
				: { kind: "unavailable", message: GOAL_UNAVAILABLE };
	}
	if (listed.some((entry) => entry.name === command.name)) {
		return { kind: "send", text: `/${command.name}` };
	}
	return { kind: "unavailable", message: COMMAND_UNAVAILABLE };
}

/**
 * The line a terminal-effect command types into a new terminal: the agent's own program with the
 * command, then `exit`, so the terminal ends when the agent does and the bar can say the command
 * finished. Null for an agent that has no such program (only Claude and Codex offer these).
 * Our design choice: Conductor's text says the command runs "in the embedded terminal"; which
 * program line it types is not recorded in the research.
 */
export function terminalCommandLine(
	agent: AgentKind | undefined,
	command: SlashCommand,
): string | null {
	if (agent !== "claude" && agent !== "codex") return null;
	return `${agent} /${command.name}; exit`;
}

/** True when the command waits for arguments the user types before sending. */
export const takesArguments = (command: SlashCommand): boolean =>
	(command.argumentHint?.trim() ?? "").length > 0;

interface Trigger {
	from: number;
	to: number;
	query: string;
}

interface SlashState {
	open: boolean;
	from: number;
	to: number;
	query: string;
	entries: SlashCommandEntry[];
	selected: number;
}

const CLOSED: SlashState = {
	open: false,
	from: 0,
	to: 0,
	query: "",
	entries: [],
	selected: 0,
};

const slashKey = new PluginKey<SlashState>("conductedSlashCommands");

function readTrigger(state: EditorState): Trigger | null {
	const { selection } = state;
	if (!selection.empty) return null;
	const $from = selection.$from;
	if ($from.parent.type.name !== "paragraph") return null;
	const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "\u0000");
	if (!before.startsWith("/")) return null;
	if (/\s/.test(before)) return null;
	return { from: $from.start(), to: $from.pos, query: before.slice(1) };
}

type SlashMeta = { kind: "move"; delta: number } | { kind: "close" };

interface OverlayProps {
	rows: SuggestionRow[];
	selectedIndex: number;
	onPick: (row: SuggestionRow) => void;
	listState: SlashListState;
}

function Overlay(props: OverlayProps) {
	const { listState } = props;
	return createElement(SuggestionPopup, {
		rows: props.rows,
		selectedIndex: props.selectedIndex,
		state: listState.state === "loading" && props.rows.length === 0 ? "loading" : "ready",
		emptyText: "No results found",
		notice:
			listState.state === "error"
				? `Couldn't load this agent's commands: ${listState.message}`
				: listState.state === "loading"
					? "Loading this agent's commands ..."
					: undefined,
		onPick: props.onPick,
	});
}

export function createSlashCommands(deps: SlashCommandDeps): Extension {
	return Extension.create({
		name: "slashCommands",
		addProseMirrorPlugins() {
			const editor: Editor = this.editor;
			const stateFor = (state: EditorState, selected = 0): SlashState => {
				const trigger = readTrigger(state);
				if (trigger === null) return CLOSED;
				const entries = slashCommandEntries(deps.commands, deps.agent, trigger.query);
				const index =
					entries.length === 0 ? 0 : Math.min(Math.max(selected, 0), entries.length - 1);
				return {
					...CLOSED,
					open: true,
					from: trigger.from,
					to: trigger.to,
					query: trigger.query,
					entries,
					selected: index,
				};
			};

			const choose = (command: SlashCommand): void => {
				const view = editor.view;
				const current = slashKey.getState(view.state);
				if (current === undefined) return;
				const tr = view.state.tr;
				if (current.from !== current.to) tr.delete(current.from, current.to);
				tr.setMeta(slashKey, { kind: "close" } satisfies SlashMeta);
				if (takesArguments(command)) {
					// The arguments are typed after the name and travel with the message on send.
					tr.insertText(`/${command.name} `, current.from);
					view.dispatch(tr);
					editor.commands.focus();
					return;
				}
				view.dispatch(tr);
				editor.commands.focus();
				deps.onRun(command);
			};

			const rowsOf = (state: SlashState): SuggestionRow[] =>
				slashCommandRows(deps.commands, deps.agent, state.query);

			const spec: TriggerMenuSpec = {
				triggerMenuOpen: (state) => slashKey.getState(state)?.open === true,
			};
			const plugin = new Plugin<SlashState>({
				...spec,
				key: slashKey,
				state: {
					init: (_config, state) => stateFor(state),
					apply: (tr, previous, _oldState, newState) => {
						const meta = tr.getMeta(slashKey) as SlashMeta | undefined;
						if (meta?.kind === "close") return CLOSED;
						if (meta?.kind === "move") {
							if (!previous.open || previous.entries.length === 0) return previous;
							const count = previous.entries.length;
							return { ...previous, selected: (previous.selected + meta.delta + count) % count };
						}
						if (tr.docChanged || tr.selectionSet) return stateFor(newState, previous.selected);
						return previous;
					},
				},
				props: {
					handleKeyDown: (view, event) => {
						const current = slashKey.getState(view.state);
						if (current === undefined || !current.open) return false;
						if (event.key === "ArrowDown" || event.key === "ArrowUp") {
							view.dispatch(
								view.state.tr.setMeta(slashKey, {
									kind: "move",
									delta: event.key === "ArrowDown" ? 1 : -1,
								} satisfies SlashMeta),
							);
							return true;
						}
						if (event.key === "Escape") {
							view.dispatch(view.state.tr.setMeta(slashKey, { kind: "close" } satisfies SlashMeta));
							return true;
						}
						if (event.key !== "Enter" && event.key !== "Tab") return false;
						const entry = current.entries[current.selected];
						if (entry !== undefined) {
							choose(entry.command);
							return true;
						}
						// With no row the key never sends the half-typed command; a known problem is said.
						const problem = slashCommandProblem(current.query, deps.agent);
						if (problem !== null) toast.error(problem);
						return true;
					},
				},
				view: () => {
					let host: HTMLDivElement | null = null;
					let renderer: ReactRenderer | null = null;
					const destroy = () => {
						renderer?.destroy();
						renderer = null;
						host?.remove();
						host = null;
					};
					const update = (view: EditorView) => {
						const state = slashKey.getState(view.state);
						if (state === undefined || !state.open) {
							destroy();
							return;
						}
						const props: OverlayProps = {
							rows: rowsOf(state),
							selectedIndex: state.selected,
							onPick: (row) => {
								const entry = state.entries.find((item) => item.command.name === row.id);
								if (entry !== undefined) choose(entry.command);
							},
							listState: deps.listState ?? { state: "ready" },
						};
						if (host === null || renderer === null) {
							host = document.createElement("div");
							host.dataset.slashCommands = "true";
							host.className = "fixed z-50";
							document.body.append(host);
							renderer = new ReactRenderer(Overlay, { editor, props });
							host.append(renderer.element);
						} else {
							renderer.updateProps(props);
						}
						try {
							const coords = view.coordsAtPos(state.to);
							host.style.left = `${coords.left}px`;
							host.style.top = `${coords.bottom}px`;
						} catch {
							// A position outside the rendered document has no screen coordinates; keep the
							// last one the browser gave us.
						}
					};
					return { update, destroy };
				},
			});
			return [plugin];
		},
	});
}
