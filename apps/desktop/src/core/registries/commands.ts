/**
 * @feature NAV-07 Command registry and default shortcuts
 * Owns: The typed table of every command with its default macOS shortcut, plus pure lookup, parse, format and conflict helpers.
 * Behaviour: docs/research/conductor/ui-map.md section 5.4 (keyboard shortcuts) and 5.1 (command palette actions).
 * Must handle: one id per command; several shortcuts per command; the same keys in different scopes;
 *   the send-key swap; plus and other symbol keys; bad shortcut text returns an error instead of
 *   throwing; the user's overrides replace the defaults, never bind a fixed command, and feed the
 *   key-cap hints.
 * Test first: every default shortcut parses, and no two commands share a shortcut inside one scope.
 *
 * This file is data and pure functions only. A separate service maps command ids to handlers.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { CommandEntry } from "../api.ts";

export type CommandCategory =
	| "General"
	| "View"
	| "Navigation"
	| "Workspace"
	| "Chat"
	| "Code review"
	| "Terminal";

/**
 * Where a shortcut is active.
 * - global: anywhere in the app window.
 * - chat-input: the chat pane has focus (message box or message list).
 * - terminal: a terminal has focus.
 * - diff: the diff or file viewer has focus.
 * - palette: the command palette is open.
 * - dialog: a dialog or a full-page flow such as the create page or settings is open.
 * Our design choice: the scopes below split the research "when" values further, so that
 * keys such as Enter can mean different things on different cards without a false conflict.
 * - menu: a context menu is open and single letters pick an item.
 * - chat-card: a tool approval or plan review card has focus.
 * - chat-question: a question card has focus.
 * - chat-queue: a queued follow-up message is selected.
 * - chat-queue-edit: a queued follow-up message is being edited.
 * - chat-goal: the Codex goal bar has focus.
 */
export type CommandScope =
	| "global"
	| "chat-input"
	| "terminal"
	| "diff"
	| "palette"
	| "dialog"
	| "menu"
	| "chat-card"
	| "chat-question"
	| "chat-queue"
	| "chat-queue-edit"
	| "chat-goal";

export interface CommandDef {
	/** Dotted and unique, for example "workspace.create". */
	id: string;
	/** Sentence case, shown in the palette and the shortcuts dialog. */
	title: string;
	category: CommandCategory;
	/**
	 * macOS only, written like "Cmd+Shift+P". Modifier names: Cmd, Ctrl, Alt, Shift.
	 * Our design choice: the plus key is written "Plus" so that "+" can stay the separator.
	 * The first entry is the one shown in menus and in the palette.
	 */
	defaultShortcuts: readonly string[];
	/** False for commands the research marks as not rebindable. */
	configurable: boolean;
	scope: CommandScope;
	/** Backlog id of the feature that owns the behaviour. */
	feature: string;
}

/**
 * Send-key swap rule. The table stores the default mode only (Enter sends, Shift+Enter adds a line).
 * When the setting "Send messages with" is Cmd+Enter, the view that reads this table swaps four bindings:
 * chat.newLine becomes Enter, chat.submit becomes Cmd+Enter, chat.submitOpposite becomes Alt+Enter,
 * and chat.question.submit becomes Cmd+Enter.
 * Our design choice: the swap is applied by the caller, so this table stays plain data.
 */
export const COMMANDS = [
	{
		id: "app.commandPalette",
		title: "Open the command palette",
		category: "General",
		defaultShortcuts: ["Cmd+K"],
		configurable: true,
		scope: "global",
		feature: "NAV-08",
	},
	{
		id: "app.toggleTheme",
		title: "Switch between light and dark theme",
		category: "General",
		defaultShortcuts: ["Cmd+Alt+T"],
		configurable: true,
		scope: "global",
		feature: "SET-06",
	},
	{
		id: "app.showShortcuts",
		title: "Show keyboard shortcuts",
		category: "General",
		defaultShortcuts: ["Cmd+Alt+/"],
		configurable: true,
		scope: "global",
		feature: "NAV-09",
	},
	{
		id: "app.openSettings",
		title: "Open settings",
		category: "General",
		defaultShortcuts: ["Cmd+,"],
		configurable: false,
		scope: "global",
		feature: "SET-02",
	},
	{
		id: "app.quit",
		title: "Quit the app",
		category: "General",
		defaultShortcuts: ["Cmd+Q"],
		configurable: false,
		scope: "global",
		feature: "PLAT-15",
	},
	{
		id: "app.sendFeedback",
		title: "Send feedback",
		category: "General",
		defaultShortcuts: ["Cmd+Alt+F"],
		configurable: false,
		scope: "global",
		feature: "APP-03",
	},
	{
		id: "app.openDebugTools",
		title: "Open the developer tools",
		category: "General",
		defaultShortcuts: ["Cmd+Alt+I"],
		configurable: false,
		scope: "global",
		feature: "APP-03",
	},
	{
		id: "app.openLogViewer",
		title: "Open the app log viewer",
		category: "General",
		defaultShortcuts: ["Cmd+Shift+I"],
		configurable: true,
		scope: "global",
		feature: "APP-03",
	},
	{
		id: "app.openSidecarLogs",
		// Unbound because Cmd+Shift+L is Pull latest, as ui-map.md 5.4 notes.
		title: "Open sidecar logs",
		category: "General",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "APP-03",
	},
	{
		id: "app.closeDiagnostics",
		title: "Close the diagnostics page",
		category: "General",
		defaultShortcuts: ["Cmd+Escape"],
		configurable: true,
		scope: "global",
		feature: "APP-03",
	},
	{
		id: "app.checkForUpdates",
		title: "Check for updates",
		category: "General",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "APP-06",
	},
	{
		id: "app.openChangelog",
		title: "Open the changelog",
		category: "General",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "APP-06",
	},
	{
		id: "app.openDocumentation",
		title: "Open the documentation",
		category: "General",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "NAV-08",
	},
	{
		id: "app.openPassport",
		title: "Open the place name map",
		category: "General",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "NAV-13",
	},
	{
		id: "dialog.confirm",
		title: "Confirm the open dialog",
		category: "General",
		defaultShortcuts: ["Cmd+Enter"],
		configurable: true,
		scope: "dialog",
		feature: "APP-05",
	},
	{
		id: "settings.search",
		title: "Search settings",
		category: "General",
		defaultShortcuts: ["Cmd+F"],
		configurable: true,
		scope: "dialog",
		feature: "SET-02",
	},
	{
		id: "settings.close",
		title: "Close settings",
		category: "General",
		defaultShortcuts: ["Escape"],
		configurable: true,
		scope: "dialog",
		feature: "SET-02",
	},
	{
		id: "palette.nextTab",
		title: "Palette: next tab",
		category: "General",
		defaultShortcuts: ["Tab"],
		configurable: true,
		scope: "palette",
		feature: "NAV-08",
	},
	{
		id: "palette.previousTab",
		title: "Palette: previous tab",
		category: "General",
		defaultShortcuts: ["Shift+Tab"],
		configurable: true,
		scope: "palette",
		feature: "NAV-08",
	},
	{
		id: "palette.editItem",
		title: "Palette: edit the highlighted item",
		category: "General",
		defaultShortcuts: ["Cmd+E"],
		configurable: true,
		scope: "palette",
		feature: "NAV-08",
	},
	{
		id: "palette.deleteItem",
		title: "Palette: delete the highlighted item",
		category: "General",
		defaultShortcuts: ["Cmd+Backspace"],
		configurable: true,
		scope: "palette",
		feature: "NAV-08",
	},
	{
		id: "chat.expandAllToolCalls",
		title: "Expand all tool calls",
		category: "General",
		defaultShortcuts: ["Ctrl+O"],
		configurable: true,
		scope: "global",
		feature: "CHAT-08",
	},
	{
		id: "view.toggleLeftSidebar",
		title: "Show or hide the left sidebar",
		category: "View",
		defaultShortcuts: ["Cmd+B"],
		configurable: true,
		scope: "global",
		feature: "NAV-12",
	},
	{
		id: "view.toggleRightSidebar",
		title: "Show or hide the right panel",
		category: "View",
		defaultShortcuts: ["Cmd+Alt+B"],
		configurable: true,
		scope: "global",
		feature: "NAV-12",
	},
	{
		id: "view.toggleTerminalPanel",
		title: "Show or hide the terminal panel",
		category: "View",
		defaultShortcuts: ["Cmd+J"],
		configurable: true,
		scope: "global",
		feature: "RUN-06",
	},
	{
		id: "view.toggleZenMode",
		title: "Turn zen mode on or off",
		category: "View",
		defaultShortcuts: ["Cmd+."],
		configurable: true,
		scope: "global",
		feature: "NAV-12",
	},
	{
		id: "view.zoomIn",
		title: "Zoom in",
		category: "View",
		defaultShortcuts: ["Cmd+=", "Cmd+Plus"],
		configurable: true,
		scope: "global",
		feature: "SET-06",
	},
	{
		id: "view.zoomOut",
		title: "Zoom out",
		category: "View",
		defaultShortcuts: ["Cmd+-"],
		configurable: true,
		scope: "global",
		feature: "SET-06",
	},
	{
		id: "view.zoomReset",
		title: "Reset zoom",
		category: "View",
		defaultShortcuts: ["Cmd+0"],
		configurable: true,
		scope: "global",
		feature: "SET-06",
	},
	{
		id: "nav.back",
		title: "Go back",
		category: "Navigation",
		defaultShortcuts: ["Cmd+["],
		configurable: true,
		scope: "global",
		feature: "NAV-02",
	},
	{
		id: "nav.forward",
		title: "Go forward",
		category: "Navigation",
		defaultShortcuts: ["Cmd+]"],
		configurable: true,
		scope: "global",
		feature: "NAV-02",
	},
	{
		id: "nav.home",
		title: "Go to the home grid",
		category: "Navigation",
		defaultShortcuts: ["Cmd+Shift+H"],
		configurable: true,
		scope: "global",
		feature: "NAV-05",
	},
	{
		id: "nav.nextUnread",
		title: "Go to the next unread workspace",
		category: "Navigation",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "NAV-11",
	},
	{
		id: "nav.viewArchived",
		title: "View archived workspaces",
		category: "Navigation",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "WS-06",
	},
	{
		id: "tab.previous",
		title: "Go to the previous tab",
		category: "Navigation",
		defaultShortcuts: ["Ctrl+Shift+Tab", "Cmd+Shift+[", "Cmd+Alt+ArrowLeft"],
		configurable: true,
		scope: "global",
		feature: "NAV-10",
	},
	{
		id: "tab.next",
		title: "Go to the next tab",
		category: "Navigation",
		defaultShortcuts: ["Ctrl+Tab", "Cmd+Shift+]", "Cmd+Alt+ArrowRight"],
		configurable: true,
		scope: "global",
		feature: "NAV-10",
	},
	{
		id: "tab.close",
		title: "Close the current tab",
		category: "Navigation",
		defaultShortcuts: ["Cmd+W"],
		configurable: true,
		scope: "global",
		feature: "NAV-10",
	},
	{
		id: "tab.reopenClosed",
		title: "Reopen the last closed tab",
		category: "Navigation",
		defaultShortcuts: ["Cmd+Shift+T"],
		configurable: true,
		scope: "global",
		feature: "NAV-10",
	},
	{
		id: "tab.split",
		title: "Split the current tab",
		category: "Navigation",
		defaultShortcuts: ["Cmd+D"],
		configurable: true,
		scope: "global",
		feature: "NAV-10",
	},
	{
		id: "nav.quickOpenFile",
		title: "Open a file by name",
		category: "Navigation",
		defaultShortcuts: ["Cmd+P"],
		configurable: true,
		scope: "global",
		feature: "REV-07",
	},
	{
		id: "nav.searchInFiles",
		title: "Search text in files",
		category: "Navigation",
		defaultShortcuts: ["Cmd+Shift+F"],
		configurable: true,
		scope: "global",
		feature: "REV-07",
	},
	{
		id: "project.add",
		title: "Add a project",
		category: "Navigation",
		defaultShortcuts: ["Cmd+Alt+A"],
		configurable: true,
		scope: "global",
		feature: "PRJ-01",
	},
	{
		id: "workspace.create",
		title: "Create a workspace",
		category: "Workspace",
		defaultShortcuts: ["Cmd+N"],
		configurable: true,
		scope: "global",
		feature: "WS-01",
	},
	{
		id: "workspace.createFromSource",
		title: "Create a workspace from a pull request, branch or issue",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+N"],
		configurable: true,
		scope: "global",
		feature: "WS-02",
	},
	{
		id: "workspace.toggleCreateFromPicker",
		title: "Show or hide the create-from picker",
		category: "Workspace",
		defaultShortcuts: ["Cmd+I"],
		configurable: true,
		scope: "dialog",
		feature: "WS-02",
	},
	{
		id: "workspace.addToBacklog",
		title: "Add the draft to the backlog",
		category: "Workspace",
		defaultShortcuts: ["Alt+Enter"],
		configurable: true,
		scope: "dialog",
		feature: "WS-01",
	},
	{
		id: "workspace.startFromBacklog",
		title: "Start the backlog workspace",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Enter"],
		configurable: false,
		scope: "global",
		feature: "WS-01",
	},
	{
		id: "workspace.nextFormTab",
		title: "Move to the next field of the create page",
		category: "Workspace",
		defaultShortcuts: ["Tab"],
		configurable: true,
		scope: "dialog",
		feature: "WS-01",
	},
	{
		id: "workspace.previousFormTab",
		title: "Move to the previous field of the create page",
		category: "Workspace",
		defaultShortcuts: ["Shift+Tab"],
		configurable: true,
		scope: "dialog",
		feature: "WS-01",
	},
	{
		id: "workspace.archive",
		title: "Archive the workspace",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+A"],
		configurable: true,
		scope: "global",
		feature: "WS-05",
	},
	{
		id: "workspace.openIn",
		title: "Open the workspace in the default app",
		category: "Workspace",
		defaultShortcuts: ["Cmd+O"],
		configurable: true,
		scope: "global",
		feature: "WS-08",
	},
	{
		id: "workspace.openInMenu",
		title: "Choose an app to open the workspace in",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+O"],
		configurable: true,
		scope: "global",
		feature: "WS-08",
	},
	{
		id: "workspace.copyLink",
		title: "Copy the workspace link",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+C"],
		configurable: true,
		scope: "global",
		feature: "PLAT-16",
	},
	{
		id: "workspace.toggleRun",
		title: "Start or stop the run action",
		category: "Workspace",
		defaultShortcuts: ["Cmd+R"],
		configurable: true,
		scope: "global",
		feature: "RUN-01",
	},
	{
		id: "workspace.togglePortForwarding",
		title: "Toggle port forwarding",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Y"],
		configurable: true,
		scope: "global",
		feature: "CLOUD-10",
	},
	{
		id: "workspace.createSection",
		title: "Create a section",
		category: "Workspace",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "NAV-04",
	},
	{
		id: "workspace.moveToSection",
		title: "Move the workspace to a section",
		category: "Workspace",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "NAV-04",
	},
	{
		id: "workspace.toggleFileEdit",
		title: "Switch the open file between view and edit",
		category: "Workspace",
		defaultShortcuts: ["Cmd+E"],
		configurable: true,
		scope: "diff",
		feature: "REV-08",
	},
	{
		id: "workspace.switch1",
		title: "Switch to workspace 1",
		category: "Workspace",
		defaultShortcuts: ["Cmd+1"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "workspace.switch2",
		title: "Switch to workspace 2",
		category: "Workspace",
		defaultShortcuts: ["Cmd+2"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "workspace.switch3",
		title: "Switch to workspace 3",
		category: "Workspace",
		defaultShortcuts: ["Cmd+3"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "workspace.switch4",
		title: "Switch to workspace 4",
		category: "Workspace",
		defaultShortcuts: ["Cmd+4"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "workspace.switch5",
		title: "Switch to workspace 5",
		category: "Workspace",
		defaultShortcuts: ["Cmd+5"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "workspace.switch6",
		title: "Switch to workspace 6",
		category: "Workspace",
		defaultShortcuts: ["Cmd+6"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "workspace.switch7",
		title: "Switch to workspace 7",
		category: "Workspace",
		defaultShortcuts: ["Cmd+7"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "workspace.switch8",
		title: "Switch to workspace 8",
		category: "Workspace",
		defaultShortcuts: ["Cmd+8"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "workspace.switch9",
		title: "Switch to workspace 9",
		category: "Workspace",
		defaultShortcuts: ["Cmd+9"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "workspace.previous",
		title: "Switch to the previous workspace",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Alt+ArrowUp"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "workspace.next",
		title: "Switch to the next workspace",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Alt+ArrowDown"],
		configurable: true,
		scope: "global",
		feature: "NAV-03",
	},
	{
		id: "git.createPr",
		title: "Create a pull request",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+P"],
		configurable: true,
		scope: "global",
		feature: "PR-02",
	},
	{
		id: "git.commitAndPush",
		title: "Commit and push",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+Y"],
		configurable: true,
		scope: "global",
		feature: "GIT-05",
	},
	{
		id: "git.pullLatest",
		title: "Pull the latest changes from the target branch",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+L"],
		configurable: true,
		scope: "global",
		feature: "GIT-06",
	},
	{
		id: "pr.merge",
		title: "Merge the pull request",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+M"],
		configurable: true,
		scope: "global",
		feature: "PR-06",
	},
	{
		id: "pr.markReady",
		title: "Mark the pull request ready for review",
		category: "Workspace",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "PR-06",
	},
	{
		id: "pr.fixErrors",
		title: "Send failing checks to the agent",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+X"],
		configurable: true,
		scope: "global",
		feature: "PR-05",
	},
	{
		id: "pr.open",
		title: "Open the pull request",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+G"],
		configurable: true,
		scope: "global",
		feature: "PR-07",
	},
	{
		id: "pr.showChecks",
		title: "Show checks",
		category: "Workspace",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "PR-04",
	},
	{
		id: "review.start",
		title: "Start an AI code review",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Shift+R"],
		configurable: true,
		scope: "global",
		feature: "REV-05",
	},
	{
		id: "review.findInFile",
		title: "Find in the open file",
		category: "Workspace",
		defaultShortcuts: ["Cmd+F"],
		configurable: true,
		scope: "diff",
		feature: "REV-08",
	},
	{
		id: "review.showUncommitted",
		title: "Show uncommitted changes",
		category: "Workspace",
		defaultShortcuts: ["Cmd+Alt+U"],
		configurable: true,
		scope: "global",
		feature: "REV-01",
	},
	{
		id: "review.showChanges",
		title: "Show changes",
		category: "Workspace",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "REV-01",
	},
	{
		id: "review.showAllFiles",
		title: "Show all files",
		category: "Workspace",
		defaultShortcuts: [],
		configurable: true,
		scope: "global",
		feature: "REV-06",
	},
	{
		id: "sidebar.toggleRead",
		title: "Mark as read or unread",
		category: "Workspace",
		defaultShortcuts: ["R"],
		configurable: true,
		scope: "menu",
		feature: "NAV-11",
	},
	{
		id: "sidebar.togglePin",
		title: "Pin or unpin",
		category: "Workspace",
		defaultShortcuts: ["P"],
		configurable: true,
		scope: "menu",
		feature: "NAV-04",
	},
	{
		id: "chat.newTab",
		title: "Start a new chat",
		category: "Chat",
		defaultShortcuts: ["Cmd+T"],
		configurable: true,
		scope: "global",
		feature: "CHAT-01",
	},
	{
		id: "chat.newLine",
		title: "Insert a new line",
		category: "Chat",
		defaultShortcuts: ["Shift+Enter"],
		configurable: true,
		scope: "chat-input",
		feature: "COMP-01",
	},
	{
		id: "chat.submit",
		title: "Send the message",
		category: "Chat",
		defaultShortcuts: ["Enter"],
		configurable: true,
		scope: "chat-input",
		feature: "COMP-01",
	},
	{
		id: "chat.submitOpposite",
		title: "Send with the other follow-up behaviour",
		category: "Chat",
		defaultShortcuts: ["Cmd+Enter"],
		configurable: true,
		scope: "chat-input",
		feature: "CHAT-03",
	},
	{
		id: "chat.pasteFilePaths",
		title: "Paste copied files as paths",
		category: "Chat",
		defaultShortcuts: ["Cmd+Shift+V"],
		configurable: true,
		scope: "chat-input",
		feature: "COMP-07",
	},
	{
		id: "chat.focusInput",
		title: "Focus the message box",
		category: "Chat",
		defaultShortcuts: ["Cmd+L"],
		configurable: true,
		scope: "global",
		feature: "COMP-01",
	},
	{
		id: "chat.togglePlanMode",
		title: "Turn plan mode on or off",
		category: "Chat",
		defaultShortcuts: ["Shift+Tab"],
		configurable: true,
		scope: "chat-input",
		feature: "COMP-03",
	},
	{
		id: "chat.approvePlan",
		title: "Approve the plan",
		category: "Chat",
		defaultShortcuts: ["Cmd+Shift+Enter"],
		configurable: true,
		scope: "chat-card",
		feature: "CHAT-12",
	},
	{
		id: "chat.approveTool",
		title: "Allow the tool request",
		category: "Chat",
		defaultShortcuts: ["Enter"],
		configurable: true,
		scope: "chat-card",
		feature: "CHAT-11",
	},
	{
		id: "chat.approveToolAlternate",
		title: "Use the alternate approval choice",
		category: "Chat",
		defaultShortcuts: ["Cmd+Enter"],
		configurable: true,
		scope: "chat-card",
		feature: "CHAT-11",
	},
	{
		id: "chat.denyTool",
		title: "Deny the tool request",
		category: "Chat",
		defaultShortcuts: ["Backspace"],
		configurable: true,
		scope: "chat-card",
		feature: "CHAT-11",
	},
	{
		id: "chat.cancelAgent",
		title: "Cancel the running agent",
		category: "Chat",
		defaultShortcuts: ["Cmd+Shift+Backspace"],
		configurable: true,
		scope: "global",
		feature: "CHAT-05",
	},
	{
		id: "chat.linkIssue",
		title: "Link an issue",
		category: "Chat",
		defaultShortcuts: ["Cmd+I"],
		configurable: true,
		scope: "global",
		feature: "PR-09",
	},
	{
		id: "chat.insertSnippet",
		title: "Insert snippet",
		category: "Chat",
		defaultShortcuts: ["Cmd+;"],
		configurable: true,
		scope: "chat-input",
		feature: "COMP-09",
	},
	{
		id: "chat.saveGoal",
		title: "Save goal",
		category: "Chat",
		defaultShortcuts: ["Cmd+Enter"],
		configurable: true,
		scope: "chat-goal",
		feature: "COMP-10",
	},
	{
		id: "chat.addAttachment",
		title: "Add an attachment",
		category: "Chat",
		defaultShortcuts: ["Cmd+U"],
		configurable: true,
		scope: "global",
		feature: "COMP-07",
	},
	{
		id: "chat.openModelPicker",
		title: "Open the model picker",
		category: "Chat",
		defaultShortcuts: ["Cmd+/"],
		configurable: true,
		scope: "global",
		feature: "COMP-02",
	},
	{
		id: "chat.toggleFastMode",
		title: "Turn fast mode on or off",
		category: "Chat",
		defaultShortcuts: ["Cmd+Shift+E"],
		configurable: true,
		scope: "global",
		feature: "COMP-02",
	},
	{
		id: "chat.cycleEffort",
		title: "Cycle the effort level",
		category: "Chat",
		defaultShortcuts: ["Cmd+Shift+/"],
		configurable: true,
		scope: "global",
		feature: "COMP-02",
	},
	{
		id: "chat.selectLoadout1",
		title: "Select loadout 1",
		category: "Chat",
		defaultShortcuts: ["Cmd+Ctrl+1"],
		configurable: true,
		scope: "global",
		feature: "COMP-02",
	},
	{
		id: "chat.selectLoadout2",
		title: "Select loadout 2",
		category: "Chat",
		defaultShortcuts: ["Cmd+Ctrl+2"],
		configurable: true,
		scope: "global",
		feature: "COMP-02",
	},
	{
		id: "chat.selectLoadout3",
		title: "Select loadout 3",
		category: "Chat",
		defaultShortcuts: ["Cmd+Ctrl+3"],
		configurable: true,
		scope: "global",
		feature: "COMP-02",
	},
	{
		id: "chat.selectLoadout4",
		title: "Select loadout 4",
		category: "Chat",
		defaultShortcuts: ["Cmd+Ctrl+4"],
		configurable: true,
		scope: "global",
		feature: "COMP-02",
	},
	{
		id: "chat.selectLoadout5",
		title: "Select loadout 5",
		category: "Chat",
		defaultShortcuts: ["Cmd+Ctrl+5"],
		configurable: true,
		scope: "global",
		feature: "COMP-02",
	},
	{
		id: "chat.nextNeedingAttention",
		title: "Go to the next chat that needs attention",
		category: "Chat",
		defaultShortcuts: ["Cmd+Alt+L"],
		configurable: true,
		scope: "global",
		feature: "NAV-11",
	},
	{
		id: "chat.search",
		title: "Search in the chat",
		category: "Chat",
		defaultShortcuts: ["Cmd+F"],
		configurable: true,
		scope: "chat-input",
		feature: "CHAT-17",
	},
	{
		id: "chat.findNext",
		title: "Find the next match",
		category: "Chat",
		defaultShortcuts: ["Cmd+G"],
		configurable: true,
		scope: "chat-input",
		feature: "CHAT-17",
	},
	{
		id: "chat.findPrevious",
		title: "Find the previous match",
		category: "Chat",
		defaultShortcuts: ["Cmd+Shift+G"],
		configurable: true,
		scope: "chat-input",
		feature: "CHAT-17",
	},
	{
		id: "chat.scrollToMatch",
		title: "Scroll to the current match",
		category: "Chat",
		defaultShortcuts: ["Cmd+Alt+J"],
		configurable: true,
		scope: "chat-input",
		feature: "CHAT-17",
	},
	{
		id: "chat.copyTranscript",
		title: "Copy a short transcript",
		category: "Chat",
		defaultShortcuts: ["Cmd+Alt+C"],
		configurable: true,
		scope: "global",
		feature: "CHAT-17",
	},
	{
		id: "chat.fork",
		title: "Fork the chat into a new tab",
		category: "Chat",
		defaultShortcuts: ["Cmd+Alt+Enter"],
		configurable: true,
		scope: "global",
		feature: "CHAT-16",
	},
	{
		id: "chat.toggleDictation",
		title: "Start or stop dictation",
		category: "Chat",
		defaultShortcuts: ["Ctrl+Shift+D"],
		configurable: true,
		scope: "chat-input",
		feature: "COMP-08",
	},
	{
		id: "chat.question.previous",
		title: "Go to the previous question",
		category: "Chat",
		defaultShortcuts: ["ArrowLeft"],
		configurable: true,
		scope: "chat-question",
		feature: "CHAT-10",
	},
	{
		id: "chat.question.next",
		title: "Go to the next question",
		category: "Chat",
		defaultShortcuts: ["ArrowRight"],
		configurable: true,
		scope: "chat-question",
		feature: "CHAT-10",
	},
	{
		id: "chat.question.focusOther",
		title: "Type a custom answer",
		category: "Chat",
		defaultShortcuts: ["0"],
		configurable: true,
		scope: "chat-question",
		feature: "CHAT-10",
	},
	{
		id: "chat.question.selectOption",
		title: "Pick an answer option by number",
		category: "Chat",
		defaultShortcuts: ["1", "2", "3", "4", "5", "6", "7", "8", "9"],
		configurable: true,
		scope: "chat-question",
		feature: "CHAT-10",
	},
	{
		id: "chat.question.submit",
		title: "Submit the answer",
		category: "Chat",
		defaultShortcuts: ["Enter"],
		configurable: true,
		scope: "chat-question",
		feature: "CHAT-10",
	},
	{
		id: "chat.queue.steer",
		title: "Send the queued message now as a steer",
		category: "Chat",
		defaultShortcuts: ["Enter"],
		configurable: true,
		scope: "chat-queue",
		feature: "CHAT-04",
	},
	{
		id: "chat.queue.edit",
		title: "Edit the queued message",
		category: "Chat",
		defaultShortcuts: ["E"],
		configurable: true,
		scope: "chat-queue",
		feature: "CHAT-04",
	},
	{
		id: "chat.queue.delete",
		title: "Delete the queued message",
		category: "Chat",
		defaultShortcuts: ["Backspace"],
		configurable: true,
		scope: "chat-queue",
		feature: "CHAT-04",
	},
	{
		id: "chat.queue.saveEdit",
		title: "Save the edited queued message",
		category: "Chat",
		defaultShortcuts: ["Enter"],
		configurable: true,
		scope: "chat-queue-edit",
		feature: "CHAT-04",
	},
	{
		id: "chat.queue.saveAndSteer",
		title: "Save the edited queued message and steer",
		category: "Chat",
		defaultShortcuts: ["Cmd+Enter"],
		configurable: true,
		scope: "chat-queue-edit",
		feature: "CHAT-04",
	},
	{
		id: "chat.queue.cancelEdit",
		title: "Discard the queued message edit",
		category: "Chat",
		defaultShortcuts: ["Escape"],
		configurable: true,
		scope: "chat-queue-edit",
		feature: "CHAT-04",
	},
	{
		id: "review.openDiff",
		title: "Open the diff view",
		category: "Code review",
		defaultShortcuts: ["Cmd+Shift+D"],
		configurable: true,
		scope: "global",
		feature: "REV-01",
	},
	{
		id: "review.previousFile",
		title: "Go to the previous file in the diff",
		category: "Code review",
		defaultShortcuts: ["ArrowUp"],
		configurable: true,
		scope: "diff",
		feature: "REV-02",
	},
	{
		id: "review.nextFile",
		title: "Go to the next file in the diff",
		category: "Code review",
		defaultShortcuts: ["ArrowDown"],
		configurable: true,
		scope: "diff",
		feature: "REV-02",
	},
	{
		id: "review.previousComment",
		title: "Go to the previous comment in the diff",
		category: "Code review",
		defaultShortcuts: ["Cmd+Alt+K"],
		configurable: true,
		scope: "diff",
		feature: "REV-03",
	},
	{
		id: "review.nextComment",
		title: "Go to the next comment in the diff",
		category: "Code review",
		defaultShortcuts: ["Cmd+Alt+J"],
		configurable: true,
		scope: "diff",
		feature: "REV-03",
	},
	{
		id: "review.toggleViewed",
		title: "Mark the file as viewed or not viewed",
		category: "Code review",
		defaultShortcuts: ["Ctrl+V"],
		configurable: true,
		scope: "diff",
		feature: "REV-02",
	},
	{
		id: "review.saveFile",
		title: "Save the edited file",
		category: "Code review",
		defaultShortcuts: ["Cmd+S"],
		configurable: true,
		scope: "diff",
		feature: "REV-08",
	},
	{
		id: "terminal.new",
		title: "Open a new terminal tab",
		category: "Terminal",
		defaultShortcuts: ["Cmd+T", "Cmd+Shift+T"],
		configurable: true,
		scope: "terminal",
		feature: "RUN-06",
	},
	{
		id: "terminal.close",
		title: "Close the terminal tab",
		category: "Terminal",
		defaultShortcuts: ["Cmd+W"],
		configurable: true,
		scope: "terminal",
		feature: "RUN-06",
	},
	{
		id: "terminal.openLocalhost",
		title: "Open the localhost address in the browser",
		category: "Terminal",
		defaultShortcuts: ["Cmd+Shift+B"],
		configurable: true,
		scope: "global",
		feature: "RUN-03",
	},
	{
		id: "terminal.find",
		title: "Find in the terminal",
		category: "Terminal",
		defaultShortcuts: ["Cmd+F"],
		configurable: true,
		scope: "terminal",
		feature: "RUN-06",
	},
	{
		id: "terminal.newline",
		title: "Insert a new line in the terminal",
		category: "Terminal",
		defaultShortcuts: ["Shift+Enter"],
		configurable: false,
		scope: "terminal",
		feature: "RUN-06",
	},
	{
		id: "terminal.clear",
		title: "Clear the terminal scrollback",
		category: "Terminal",
		defaultShortcuts: ["Cmd+K"],
		configurable: true,
		scope: "terminal",
		feature: "RUN-06",
	},
	{
		id: "terminal.deleteLine",
		title: "Delete the terminal line",
		category: "Terminal",
		defaultShortcuts: ["Cmd+Backspace"],
		configurable: false,
		scope: "terminal",
		feature: "RUN-06",
	},
	{
		id: "terminal.lineStart",
		title: "Move to the start of the terminal line",
		category: "Terminal",
		defaultShortcuts: ["Cmd+ArrowLeft"],
		configurable: false,
		scope: "terminal",
		feature: "RUN-06",
	},
	{
		id: "terminal.lineEnd",
		title: "Move to the end of the terminal line",
		category: "Terminal",
		defaultShortcuts: ["Cmd+ArrowRight"],
		configurable: false,
		scope: "terminal",
		feature: "RUN-06",
	},
	{
		id: "terminal.wordBack",
		title: "Move back one word in the terminal",
		category: "Terminal",
		defaultShortcuts: ["Alt+ArrowLeft"],
		configurable: false,
		scope: "terminal",
		feature: "RUN-06",
	},
	{
		id: "terminal.wordForward",
		title: "Move forward one word in the terminal",
		category: "Terminal",
		defaultShortcuts: ["Alt+ArrowRight"],
		configurable: false,
		scope: "terminal",
		feature: "RUN-06",
	},
] as const satisfies readonly CommandDef[];

export type CommandId = (typeof COMMANDS)[number]["id"];

export const COMMAND_CATEGORIES: readonly CommandCategory[] = [
	"General",
	"View",
	"Navigation",
	"Workspace",
	"Chat",
	"Code review",
	"Terminal",
];

const BY_ID: ReadonlyMap<string, CommandDef> = new Map(COMMANDS.map((c) => [c.id, c]));

export function getCommand(id: string): CommandDef | undefined {
	return BY_ID.get(id);
}

/** Every category, in display order, each with its commands in table order. */
export function commandsByCategory(): Record<CommandCategory, readonly CommandDef[]> {
	const groups: Record<CommandCategory, CommandDef[]> = {
		General: [],
		View: [],
		Navigation: [],
		Workspace: [],
		Chat: [],
		"Code review": [],
		Terminal: [],
	};
	for (const command of COMMANDS) {
		groups[command.category].push(command);
	}
	return groups;
}

// ---------------------------------------------------------------- shortcuts

export interface ParsedShortcut {
	ctrl: boolean;
	alt: boolean;
	shift: boolean;
	cmd: boolean;
	/** Single letters are upper case. Other keys use the names in NAMED_KEYS or one symbol. */
	key: string;
}

const MODIFIERS = ["Cmd", "Ctrl", "Alt", "Shift"] as const;

/** Key names with their macOS display form. */
const NAMED_KEYS: Readonly<Record<string, string>> = {
	Enter: "↵",
	Escape: "⎋",
	Backspace: "⌫",
	Delete: "⌦",
	Tab: "⇥",
	Space: "␣",
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	Home: "↖",
	End: "↘",
	PageUp: "⇞",
	PageDown: "⇟",
	Plus: "+",
};

const SYMBOL_KEYS = "`-=[];',./";
const FUNCTION_KEY = /^F([1-9]|1[0-2])$/;

function isKeyName(token: string): boolean {
	if (token in NAMED_KEYS || FUNCTION_KEY.test(token)) {
		return true;
	}
	return /^[A-Za-z0-9]$/.test(token) || (token.length === 1 && SYMBOL_KEYS.includes(token));
}

/** Parses text such as "Cmd+Shift+P". Exactly one key, last, with no repeated modifier. */
export function parseShortcut(spec: string): Result<ParsedShortcut> {
	const tokens = spec.split("+");
	const keyToken = tokens[tokens.length - 1] ?? "";
	const modifierTokens = tokens.slice(0, -1);
	const parsed: ParsedShortcut = { ctrl: false, alt: false, shift: false, cmd: false, key: "" };
	for (const token of modifierTokens) {
		if (!(MODIFIERS as readonly string[]).includes(token)) {
			return err(appError("shortcut_invalid", `Unknown modifier "${token}" in "${spec}".`));
		}
		const field =
			token === "Cmd" ? "cmd" : token === "Ctrl" ? "ctrl" : token === "Alt" ? "alt" : "shift";
		if (parsed[field]) {
			return err(appError("shortcut_invalid", `Modifier "${token}" appears twice in "${spec}".`));
		}
		parsed[field] = true;
	}
	if (!isKeyName(keyToken)) {
		return err(appError("shortcut_invalid", `Unknown key "${keyToken}" in "${spec}".`));
	}
	parsed.key = keyToken.length === 1 ? keyToken.toUpperCase() : keyToken;
	return ok(parsed);
}

/**
 * Display order: Control, Option, Command, Shift.
 * Our design choice: Command comes before Shift so that Cmd+Shift+P reads "⌘⇧P", as in api.ts.
 */
function modifierSymbols(p: ParsedShortcut): string {
	return `${p.ctrl ? "⌃" : ""}${p.alt ? "⌥" : ""}${p.cmd ? "⌘" : ""}${p.shift ? "⇧" : ""}`;
}

/** Same shortcut, same text, whatever order the modifiers were written in. */
function canonicalForm(p: ParsedShortcut): string {
	return `${modifierSymbols(p)}${p.key}`;
}

/**
 * The macOS display form, for example "⌘⇧P". Text that does not parse is returned unchanged,
 * so a bad user override shows up as typed instead of throwing.
 */
export function formatShortcut(spec: string): string {
	const parsed = parseShortcut(spec);
	if (!parsed.ok) {
		return spec;
	}
	const { key } = parsed.value;
	return `${modifierSymbols(parsed.value)}${NAMED_KEYS[key] ?? key}`;
}

// ---------------------------------------------------------------- user overrides

/** Command id to the shortcuts the user chose. An empty list unbinds the command. */
export type ShortcutOverrides = Readonly<Record<string, readonly string[]>>;

/**
 * Reads the saved overrides from `keybinding_overrides_v1`. Empty text means no changes.
 * Other text must be one JSON object whose values are lists of shortcut text.
 * Our design choice: an unknown command id stays in the object; it is ignored when applied, so
 * removing a command from the registry does not make the whole setting unusable.
 */
export function parseShortcutOverrides(text: string): Result<ShortcutOverrides> {
	if (text.trim() === "") {
		return ok({});
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return err(appError("shortcut_overrides_invalid", "The custom key bindings are not JSON."));
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return err(
			appError("shortcut_overrides_invalid", "The custom key bindings must be a JSON object."),
		);
	}
	const overrides: Record<string, readonly string[]> = {};
	for (const [id, value] of Object.entries(parsed)) {
		if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
			return err(
				appError(
					"shortcut_overrides_invalid",
					`The shortcuts for ${id} must be a list of strings.`,
				),
			);
		}
		overrides[id] = value;
	}
	return ok(overrides);
}

/**
 * The shortcuts a command uses now. An override replaces the whole default list; a fixed command
 * always keeps its shipped shortcut.
 */
export function effectiveShortcuts(
	command: CommandDef,
	overrides: ShortcutOverrides,
): readonly string[] {
	if (!command.configurable) return command.defaultShortcuts;
	return overrides[command.id] ?? command.defaultShortcuts;
}

/** The table with the user's overrides applied, for the conflict check in a rebinding screen. */
export function withShortcutOverrides(
	commands: readonly CommandDef[],
	overrides: ShortcutOverrides,
): CommandDef[] {
	return commands.map((command) => {
		const effective = effectiveShortcuts(command, overrides);
		return effective === command.defaultShortcuts
			? command
			: { ...command, defaultShortcuts: effective };
	});
}

/** Display form of the live first binding, for a key-cap hint. Null when the command is unbound. */
export function liveShortcut(id: string, overrides: ShortcutOverrides = {}): string | null {
	const command = getCommand(id);
	if (command === undefined) return null;
	const first = effectiveShortcuts(command, overrides)[0];
	return first === undefined ? null : formatShortcut(first);
}

// ---------------------------------------------------------------- palette entries

/**
 * Maps the table to the entries the palette reads. `enabled` says whether a command can run now.
 * `shortcut` is the live binding; `defaultShortcut` is what the command ships with, so a screen can
 * offer "reset" after a rebind.
 */
export function toCommandEntries(
	enabled: (id: CommandId) => boolean,
	overrides: ShortcutOverrides = {},
): CommandEntry[] {
	return COMMANDS.map((command) => {
		const live = effectiveShortcuts(command, overrides)[0];
		const shipped = command.defaultShortcuts[0];
		return {
			id: command.id,
			title: command.title,
			category: command.category,
			shortcut: live === undefined ? null : formatShortcut(live),
			defaultShortcut: shipped === undefined ? null : formatShortcut(shipped),
			enabled: enabled(command.id),
		};
	});
}

// ---------------------------------------------------------------- conflicts

export interface ShortcutConflict {
	ids: readonly [string, string];
	scope: CommandScope;
	/** Display form of the shared shortcut. */
	shortcut: string;
}

/**
 * Pairs of commands that use the same shortcut in the same scope. The same keys in different
 * scopes are fine. Shortcuts that do not parse are compared as written. Modifier order does not
 * matter ("Shift+Cmd+K" clashes with "Cmd+Shift+K"). A command never clashes with itself, so the
 * command being edited ignores its own old binding, and an unbound command has no clash.
 * Takes the table as a parameter so a rebinding screen can check its own edits: it passes the
 * table with the edit applied and reads the pairs that name the edited command.
 */
export function findShortcutConflicts(
	commands: readonly CommandDef[] = COMMANDS,
): ShortcutConflict[] {
	const seen = new Map<string, string>();
	const conflicts: ShortcutConflict[] = [];
	for (const command of commands) {
		const own = new Set<string>();
		for (const spec of command.defaultShortcuts) {
			const parsed = parseShortcut(spec);
			const form = parsed.ok ? canonicalForm(parsed.value) : spec;
			if (own.has(form)) {
				continue;
			}
			own.add(form);
			const slot = `${command.scope}\u0000${form}`;
			const other = seen.get(slot);
			if (other !== undefined) {
				conflicts.push({
					ids: [other, command.id],
					scope: command.scope,
					shortcut: formatShortcut(spec),
				});
			} else {
				seen.set(slot, command.id);
			}
		}
	}
	return conflicts;
}
