/**
 * @feature SET-01 Settings registry
 * Owns: The typed table of every local setting (key, page, scope, type, default, file key) plus lookup, search and value checking.
 * Behaviour: docs/research/conductor/ui-map.md section 6 (pages) and services-map.md section 4.2 (layers, keys, defaults, settings.toml keys).
 * Must handle: values stored as strings ("true", "12"); enum membership; number ranges; empty values for unset;
 *   list values written as one string per line; hidden state keys that must not show up in search;
 *   settings that only the user file may set versus settings a repo file may also set.
 * Test first: coercing "true" for a bool returns true, and "maybe" returns a setting_invalid error.
 *
 * Layers, lowest to highest: the default in this table, the user file `~/.conducted/settings.toml`,
 * the remote default-branch copy of the repo file, the repo shared file `.conducted/settings.toml`,
 * the workspace shared file in a workspace, then the repo local file `.conducted/settings.local.toml`.
 * The `settings` table sits between the default and the user file for keys that live there.
 * This file only describes which keys a file layer may set. The order and the reading are DATA-05's.
 *
 * Our design choice: `default_message_send_mode` defaults to "steer" and its values are "steer" and "queue".
 * The research default is `steering` with the other value `queued`.
 * Our design choice: settings that the research marks as cloud, account, billing, organization, remote control,
 * analytics or internal are left out, as are secrets such as tokens and API keys, which belong in the Keychain.
 */
import { appError, err, ok, type Result } from "@conducted/shared";

export type SettingPage =
	| "general"
	| "appearance"
	| "models"
	| "git"
	| "agents"
	| "environment"
	| "scripts"
	| "actions"
	| "misc"
	| "experimental"
	| "advanced"
	| "state";

/** "state" is a hidden page for saved screen state that has no settings screen. */
export const SETTING_PAGES: readonly SettingPage[] = [
	"general",
	"appearance",
	"models",
	"git",
	"agents",
	"environment",
	"scripts",
	"actions",
	"misc",
	"experimental",
	"advanced",
	"state",
];

export type SettingScope = "user" | "repo";
export type SettingValue = string | number | boolean | string[] | null;

/** Which settings.toml files may set a key. `tomlKey` and `fileLayers` come as a pair. */
type FileBacking =
	| { tomlKey: string; fileLayers: "user" | "user-and-repo" }
	| { tomlKey?: undefined; fileLayers?: undefined };

export type SettingDef = {
	key: string;
	page: SettingPage;
	scopes: readonly SettingScope[];
	title: string;
	description: string;
	/** Extra words that find this setting in search. */
	searchTerms: readonly string[];
	/** Backlog id of the feature that owns the behaviour. */
	feature: string;
} & FileBacking &
	(
		| { type: "bool"; default: boolean }
		| { type: "string"; default: string }
		| { type: "number"; default: number; min?: number; max?: number }
		| { type: "enum"; default: string; options: readonly { value: string; label: string }[] }
		| { type: "string-list"; default: readonly string[] }
	);

const SETTINGS_TABLE = [
	{
		key: "message_send_key",
		page: "general",
		scopes: ["user"],
		title: "Send key",
		description: "Pick the key that sends a message. The other combination then adds a new line.",
		searchTerms: ["enter", "return", "submit", "cmd", "keyboard"],
		feature: "COMP-01",
		type: "enum",
		default: "enter",
		options: [
			{ value: "enter", label: "Enter" },
			{ value: "cmd-enter", label: "Cmd+Enter" },
		],
	},
	// Our design choice: values are steer and queue (the research uses steering and queued), and the default is steer.
	{
		key: "default_message_send_mode",
		page: "general",
		scopes: ["user"],
		title: "Follow-up behavior",
		description:
			"Choose what a message sent during a running turn does: steer the agent now, or queue it for after the turn.",
		searchTerms: ["steer", "queue", "follow-up", "interrupt", "mid-turn"],
		feature: "CHAT-03",
		type: "enum",
		default: "steer",
		options: [
			{ value: "steer", label: "Steer the agent" },
			{ value: "queue", label: "Queue for later" },
		],
	},
	{
		key: "notifications_enabled",
		page: "general",
		scopes: ["user"],
		title: "Agent notifications",
		description: "Show a notification when an agent finishes or needs your input.",
		searchTerms: ["alerts", "notify", "done", "finished"],
		feature: "CHAT-19",
		type: "bool",
		default: true,
	},
	// Our design choice: two choices for now; more sounds can be added as options later.
	{
		key: "sound_type",
		page: "general",
		scopes: ["user"],
		title: "Completion sound",
		description: "Choose the sound that plays when an agent finishes a turn.",
		searchTerms: ["audio", "chime", "ding", "mute", "silent"],
		feature: "CHAT-19",
		type: "enum",
		default: "default",
		options: [
			{ value: "default", label: "Default chime" },
			{ value: "none", label: "No sound" },
		],
	},
	// Our design choice: off, as the research gives no default.
	{
		key: "manual_workspace_order",
		page: "general",
		scopes: ["user"],
		title: "Arrange workspaces by hand",
		description: "Let you drag workspaces into your own order in the sidebar.",
		searchTerms: ["sort", "drag", "order", "reorder"],
		feature: "NAV-04",
		type: "bool",
		default: false,
	},
	{
		key: "auto_convert_long_text",
		page: "general",
		scopes: ["user"],
		title: "Turn long pastes into attachments",
		description: "Convert pasted text longer than 5000 characters into a text attachment.",
		searchTerms: ["paste", "clipboard", "long text", "attachment"],
		feature: "COMP-07",
		type: "bool",
		default: true,
	},
	// Our design choice: the effect is read from the bundle. It strips a leading "You're absolutely right!"
	// from AI messages, with any of the punctuation and spacing variants the bundle accepts.
	{
		key: "not_absolutely_right",
		page: "general",
		scopes: ["user"],
		title: "I'm not absolutely right, thank you very much",
		description:
			"Remove a leading claim that the answer is absolutely right from assistant replies.",
		searchTerms: ["absolutely right", "sycophancy", "strip", "preamble", "phrase"],
		feature: "SET-01",
		type: "bool",
		default: false,
	},
	// Our design choice: off, which matches the description of the default behaviour.
	{
		key: "always_show_context_wheel",
		page: "general",
		scopes: ["user"],
		title: "Always show context usage",
		description:
			"Show the context usage ring all the time. By default it appears only above 70 percent.",
		searchTerms: ["context", "tokens", "wheel", "usage", "ring"],
		feature: "CHAT-14",
		type: "bool",
		default: false,
	},
	{
		key: "caffeinate_while_agents_running",
		page: "general",
		scopes: ["user"],
		title: "Keep the Mac awake while agents work",
		description:
			"Stop the Mac from sleeping while an agent is working. This stops when the battery falls below 10 percent.",
		searchTerms: ["sleep", "caffeinate", "awake", "battery", "power"],
		feature: "SET-02",
		type: "bool",
		default: false,
	},
	{
		key: "auto_restart_on_update_when_idle",
		page: "general",
		scopes: ["user"],
		title: "Restart for updates when idle",
		description: "Install a downloaded update and restart once no agent is working.",
		searchTerms: ["update", "restart", "upgrade", "idle"],
		feature: "APP-06",
		type: "bool",
		default: false,
	},
	// Our design choice: the key is renamed from the research name, to describe the behaviour.
	{
		key: "expand_tool_calls",
		page: "general",
		scopes: ["user"],
		title: "Expand all tool calls",
		description: "Show tool calls open by default instead of collapsed.",
		searchTerms: ["tool call", "collapse", "expanded", "verbose", "details"],
		feature: "CHAT-08",
		type: "bool",
		default: false,
	},
	{
		key: "enterprise_data_privacy",
		page: "general",
		scopes: ["user", "repo"],
		title: "Data privacy mode",
		description:
			"Turn off features that send data to outside AI providers, such as generated chat titles and custom MCP servers.",
		searchTerms: ["privacy", "enterprise", "titles", "mcp", "external", "data"],
		tomlKey: "enterprise_data_privacy",
		fileLayers: "user-and-repo",
		feature: "SET-02",
		type: "bool",
		default: false,
	},
	// Our design choice: follow the system, as the research gives no default.
	{
		key: "theme",
		page: "appearance",
		scopes: ["user"],
		title: "Theme",
		description: "Use the light theme, the dark theme, or follow the macOS setting.",
		searchTerms: ["light", "dark", "system", "mode", "color scheme"],
		feature: "SET-06",
		type: "enum",
		default: "system",
		options: [
			{ value: "light", label: "Light" },
			{ value: "dark", label: "Dark" },
			{ value: "system", label: "System" },
		],
	},
	{
		key: "low_contrast_dark_mode",
		page: "appearance",
		scopes: ["user"],
		title: "Softer dark theme",
		description: "Use gentler colors in the dark theme.",
		searchTerms: ["contrast", "dim", "soft", "dark"],
		feature: "SET-06",
		type: "bool",
		default: false,
	},
	{
		key: "color_vision",
		page: "appearance",
		scopes: ["user"],
		title: "Color vision palette",
		description: "Use a palette tuned for a type of color vision difference.",
		searchTerms: [
			"accessible",
			"colorblind",
			"deuteranopia",
			"protanopia",
			"tritanopia",
			"accessibility",
		],
		feature: "SET-06",
		type: "enum",
		default: "default",
		options: [
			{ value: "default", label: "Default" },
			{ value: "protanopia-deuteranopia", label: "Protanopia and deuteranopia" },
			{ value: "tritanopia", label: "Tritanopia" },
		],
	},
	{
		key: "code_theme",
		page: "appearance",
		scopes: ["user"],
		title: "Code theme",
		description: "Syntax highlighting colors for code and diffs.",
		searchTerms: [
			"syntax",
			"highlight",
			"shiki",
			"catppuccin",
			"dracula",
			"nord",
			"gruvbox",
			"solarized",
			"tokyo",
		],
		feature: "SET-06",
		type: "enum",
		default: "default",
		options: [
			{ value: "default", label: "Default" },
			{ value: "catppuccin-latte", label: "Catppuccin Latte" },
			{ value: "catppuccin-macchiato", label: "Catppuccin Macchiato" },
			{ value: "catppuccin-mocha", label: "Catppuccin Mocha" },
			{ value: "dracula", label: "Dracula" },
			{ value: "nord", label: "Nord" },
			{ value: "tokyo-night", label: "Tokyo Night" },
			{ value: "gruvbox-dark", label: "Gruvbox Dark" },
			{ value: "solarized-dark", label: "Solarized Dark" },
		],
	},
	{
		key: "colored_sidebar_diffs",
		page: "appearance",
		scopes: ["user"],
		title: "Colored line counts in the sidebar",
		description:
			"Always color the added and removed line counts, even for workspaces you have not selected.",
		searchTerms: ["diff", "plus", "minus", "green", "red", "sidebar"],
		feature: "SET-06",
		type: "bool",
		default: false,
	},
	{
		key: "file_ligatures_enabled",
		page: "appearance",
		scopes: ["user"],
		title: "Code ligatures",
		description: "Draw ligatures in the file editor and in diffs.",
		searchTerms: ["font", "ligature", "fira", "arrows"],
		feature: "SET-06",
		type: "bool",
		default: true,
	},
	// Our design choice: the research default font name is kept; the app falls back to the system monospace font when it is missing.
	{
		key: "mono_font",
		page: "appearance",
		scopes: ["user"],
		title: "Code font",
		description: "Font family for code, diffs and the file editor.",
		searchTerms: ["monospace", "typeface", "font family", "geist"],
		feature: "SET-06",
		type: "string",
		default: "Geist Mono",
	},
	{
		key: "markdown_style",
		page: "appearance",
		scopes: ["user"],
		title: "Markdown style",
		description: "How Markdown files and chat text are drawn.",
		searchTerms: ["tufte", "prose", "typography", "markdown"],
		feature: "SET-06",
		type: "enum",
		default: "default",
		options: [
			{ value: "default", label: "Default" },
			{ value: "tufte", label: "Tufte" },
		],
	},
	// Our design choice: empty means the terminal uses the code font.
	{
		key: "terminal_font_family",
		page: "appearance",
		scopes: ["user"],
		title: "Terminal font",
		description: "Font family for terminals. Leave empty to use the code font.",
		searchTerms: ["monospace", "typeface", "terminal", "font"],
		feature: "SET-06",
		type: "string",
		default: "",
	},
	// Our design choice: the range 8 to 32 keeps text readable and the grid usable.
	{
		key: "terminal_font_size",
		page: "appearance",
		scopes: ["user"],
		title: "Terminal font size",
		description: "Text size in points for terminals.",
		searchTerms: ["size", "points", "terminal", "text"],
		feature: "SET-06",
		type: "number",
		default: 12,
		min: 8,
		max: 32,
	},
	// Our design choice: the range 0.5 to 3 keeps the window layout usable.
	{
		key: "zoom_level_v2",
		page: "appearance",
		scopes: ["user"],
		title: "App zoom",
		description: "Scale of the whole interface. 1 is normal size.",
		searchTerms: ["zoom", "scale", "size", "magnify", "ui size"],
		feature: "SET-06",
		type: "number",
		default: 1,
		min: 0.5,
		max: 3,
	},
	// Our design choice: empty means the first model the chosen agent reports.
	{
		key: "default_model",
		page: "models",
		scopes: ["user"],
		title: "Default model",
		description: "Model used by new chats. Empty picks the first available model.",
		searchTerms: ["model", "llm", "default", "claude", "gpt"],
		tomlKey: "models.default",
		fileLayers: "user",
		feature: "COMP-02",
		type: "string",
		default: "",
	},
	// Our design choice: empty means fall back to the default model.
	{
		key: "review_model",
		page: "models",
		scopes: ["user"],
		title: "Review model",
		description: "Model used by chats that start an AI code review. Empty uses the default model.",
		searchTerms: ["model", "review", "code review"],
		tomlKey: "models.review",
		fileLayers: "user",
		feature: "REV-05",
		type: "string",
		default: "",
	},
	{
		key: "default_fast_mode",
		page: "models",
		scopes: ["user"],
		title: "Fast mode in new chats",
		description: "Start new chats with fast mode on.",
		searchTerms: ["fast", "speed", "quick"],
		tomlKey: "models.default_fast_mode",
		fileLayers: "user",
		feature: "COMP-02",
		type: "bool",
		default: false,
	},
	// Our design choice: off, as the research gives no default.
	{
		key: "review_fast_mode",
		page: "models",
		scopes: ["user"],
		title: "Fast mode for reviews",
		description: "Run AI code reviews with fast mode on.",
		searchTerms: ["fast", "speed", "review"],
		tomlKey: "models.review_fast_mode",
		fileLayers: "user",
		feature: "REV-05",
		type: "bool",
		default: false,
	},
	// Our design choice: off, as the research gives no default.
	{
		key: "default_plan_mode",
		page: "models",
		scopes: ["user"],
		title: "Plan mode in new chats",
		description: "Start new chats in plan mode so the agent proposes a plan first.",
		searchTerms: ["plan", "planning", "approve"],
		tomlKey: "models.default_plan_mode",
		fileLayers: "user",
		feature: "COMP-03",
		type: "bool",
		default: false,
	},
	// Our design choice: an empty value means the model's own default.
	{
		key: "default_codex_thinking_level",
		page: "models",
		scopes: ["user"],
		title: "Codex thinking level",
		description: "How hard Codex thinks in new chats.",
		searchTerms: ["codex", "reasoning", "effort", "thinking"],
		tomlKey: "models.codex.default_thinking_level",
		fileLayers: "user",
		feature: "COMP-02",
		type: "enum",
		default: "",
		options: [
			{ value: "", label: "Model default" },
			{ value: "none", label: "None" },
			{ value: "low", label: "Low" },
			{ value: "medium", label: "Medium" },
			{ value: "high", label: "High" },
			{ value: "xhigh", label: "Extra high" },
			{ value: "max", label: "Max" },
			{ value: "ultra", label: "Ultra" },
		],
	},
	// Our design choice: an empty value means the model's own default.
	{
		key: "review_codex_thinking_level",
		page: "models",
		scopes: ["user"],
		title: "Codex thinking level for reviews",
		description: "How hard Codex thinks during AI code reviews.",
		searchTerms: ["codex", "reasoning", "effort", "review"],
		tomlKey: "models.codex.review_thinking_level",
		fileLayers: "user",
		feature: "REV-05",
		type: "enum",
		default: "",
		options: [
			{ value: "", label: "Model default" },
			{ value: "none", label: "None" },
			{ value: "low", label: "Low" },
			{ value: "medium", label: "Medium" },
			{ value: "high", label: "High" },
			{ value: "xhigh", label: "Extra high" },
			{ value: "max", label: "Max" },
			{ value: "ultra", label: "Ultra" },
		],
	},
	// Our design choice: an empty value means the model's own default.
	{
		key: "default_codex_personality",
		page: "models",
		scopes: ["user"],
		title: "Codex personality",
		description: "The tone Codex uses in new chats.",
		searchTerms: ["codex", "tone", "style", "friendly", "pragmatic"],
		tomlKey: "models.codex.personality",
		fileLayers: "user",
		feature: "COMP-02",
		type: "enum",
		default: "",
		options: [
			{ value: "", label: "Model default" },
			{ value: "pragmatic", label: "Pragmatic" },
			{ value: "friendly", label: "Friendly" },
			{ value: "none", label: "None" },
		],
	},
	{
		key: "default_claude_personality",
		page: "models",
		scopes: ["user"],
		title: "Claude output style",
		description: "The output style Claude uses in new chats. Existing chats keep theirs.",
		searchTerms: ["claude", "tone", "style", "concise", "explanatory", "learning", "proactive"],
		tomlKey: "models.claude_code.personality",
		fileLayers: "user",
		feature: "COMP-02",
		type: "enum",
		default: "default",
		options: [
			{ value: "default", label: "Default" },
			{ value: "proactive", label: "Proactive" },
			{ value: "concise", label: "Concise" },
			{ value: "explanatory", label: "Explanatory" },
			{ value: "learning", label: "Learning" },
		],
	},
	// Our design choice: an empty value means the model's own default.
	{
		key: "default_claude_effort_level",
		page: "models",
		scopes: ["user"],
		title: "Claude effort level",
		description: "How much effort Claude spends in new chats.",
		searchTerms: ["claude", "effort", "reasoning", "thinking"],
		tomlKey: "models.claude_code.default_effort_level",
		fileLayers: "user",
		feature: "COMP-02",
		type: "enum",
		default: "",
		options: [
			{ value: "", label: "Model default" },
			{ value: "low", label: "Low" },
			{ value: "medium", label: "Medium" },
			{ value: "high", label: "High" },
			{ value: "xhigh", label: "Extra high" },
			{ value: "max", label: "Max" },
			{ value: "ultracode", label: "Ultracode" },
		],
	},
	// Our design choice: an empty value means the model's own default.
	{
		key: "review_claude_effort_level",
		page: "models",
		scopes: ["user"],
		title: "Claude effort level for reviews",
		description: "How much effort Claude spends during AI code reviews.",
		searchTerms: ["claude", "effort", "review"],
		tomlKey: "models.claude_code.review_effort_level",
		fileLayers: "user",
		feature: "REV-05",
		type: "enum",
		default: "",
		options: [
			{ value: "", label: "Model default" },
			{ value: "low", label: "Low" },
			{ value: "medium", label: "Medium" },
			{ value: "high", label: "High" },
			{ value: "xhigh", label: "Extra high" },
			{ value: "max", label: "Max" },
			{ value: "ultracode", label: "Ultracode" },
		],
	},
	// Our design choice: empty means show every model.
	{
		key: "visible_provider_models",
		page: "models",
		scopes: ["user", "repo"],
		title: "Models shown in the picker",
		description: "Limit which provider models appear in the model picker.",
		searchTerms: ["models", "provider", "hide", "filter", "picker"],
		tomlKey: "models.visible_provider_models",
		fileLayers: "user-and-repo",
		feature: "COMP-02",
		type: "string",
		default: "",
	},
	{
		key: "branch_prefix_type",
		page: "git",
		scopes: ["user", "repo"],
		title: "Branch name prefix",
		description:
			"What new workspace branches start with: your GitHub username, a custom text, or nothing.",
		searchTerms: ["branch", "prefix", "username", "naming"],
		tomlKey: "git.branch_prefix_type",
		fileLayers: "user-and-repo",
		feature: "WS-01",
		type: "enum",
		default: "github_username",
		options: [
			{ value: "github_username", label: "GitHub username" },
			{ value: "custom", label: "Custom text" },
			{ value: "none", label: "No prefix" },
		],
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "branch_prefix_custom",
		page: "git",
		scopes: ["user", "repo"],
		title: "Custom branch prefix",
		description: "The text used when the prefix type is custom, for example feature/ or alex-.",
		searchTerms: ["branch", "prefix", "custom", "naming"],
		tomlKey: "git.branch_prefix",
		fileLayers: "user-and-repo",
		feature: "WS-01",
		type: "string",
		default: "",
	},
	{
		key: "auto_rename_new_branches",
		page: "git",
		scopes: ["user"],
		title: "Rename new branches automatically",
		description:
			"After the first message, replace the placeholder branch name with one that describes the task.",
		searchTerms: ["branch", "rename", "placeholder", "auto"],
		feature: "WS-04",
		type: "bool",
		default: true,
	},
	{
		key: "auto_rename_workspace_on_branch_name_set",
		page: "git",
		scopes: ["user"],
		title: "Rename the workspace with its branch",
		description: "When the branch gets a real name, rename the workspace to match.",
		searchTerms: ["workspace", "rename", "branch", "title"],
		feature: "WS-04",
		type: "bool",
		default: true,
	},
	{
		key: "delete_branch_on_archive",
		page: "git",
		scopes: ["user", "repo"],
		title: "Delete the branch on archive",
		description:
			"Delete the local branch when a workspace is archived. The remote branch is left alone.",
		searchTerms: ["archive", "branch", "delete", "cleanup"],
		tomlKey: "git.delete_branch_on_archive",
		fileLayers: "user-and-repo",
		feature: "WS-05",
		type: "bool",
		default: false,
	},
	// Our design choice: empty means the remote named origin; the research gives no default. This is the one home of a repo's remote name (DATA-09).
	{
		key: "remote_name",
		page: "git",
		scopes: ["repo"],
		title: "Remote origin",
		description: "Where should we push, pull, and create PRs?",
		searchTerms: ["remote", "origin", "upstream", "push", "pull", "fork"],
		tomlKey: "git.remote_name",
		fileLayers: "user-and-repo",
		feature: "DATA-09",
		type: "string",
		default: "",
	},
	// Our design choice: off, as the research gives no default.
	{
		key: "archive_on_merge",
		page: "git",
		scopes: ["user", "repo"],
		title: "Archive after merge",
		description: "Archive a workspace once its pull request is merged from the app.",
		searchTerms: ["archive", "merge", "pull request", "cleanup"],
		tomlKey: "git.archive_on_merge",
		fileLayers: "user-and-repo",
		feature: "WS-05",
		type: "bool",
		default: false,
	},
	{
		key: "pull_request_open_target",
		page: "git",
		scopes: ["user"],
		title: "Open pull requests in",
		description: "Where the open pull request button sends you.",
		searchTerms: ["pull request", "github", "linear", "graphite", "browser"],
		feature: "PR-07",
		type: "enum",
		default: "github",
		options: [
			{ value: "github", label: "GitHub" },
			{ value: "linear", label: "Linear" },
			{ value: "graphite", label: "Graphite" },
		],
	},
	// Our design choice: off, as the research gives no default.
	{
		key: "automerge_enabled",
		page: "git",
		scopes: ["user"],
		title: "Show the automerge button",
		description:
			"Show an automerge button while checks are pending. GitHub must allow automerge on the repository.",
		searchTerms: ["automerge", "merge", "checks", "pending"],
		feature: "PR-06",
		type: "bool",
		default: false,
	},
	// Our design choice: off, as the research gives no default.
	{
		key: "treat_optional_checks_as_blocking",
		page: "git",
		scopes: ["user"],
		title: "Optional checks block merging",
		description:
			"Hide the merge button when any check failed, including checks GitHub treats as optional.",
		searchTerms: ["checks", "optional", "merge", "blocking", "required"],
		feature: "PR-06",
		type: "bool",
		default: false,
	},
	{
		key: "github_stacked_prs_enabled",
		page: "git",
		scopes: ["user"],
		title: "Allow stacked pull requests",
		description: "Tell agents they may use the gh stack command to build stacked pull requests.",
		searchTerms: ["stack", "stacked", "gh stack", "pull request"],
		feature: "PR-08",
		type: "bool",
		default: true,
	},
	// Our design choice: off, so detection stays on, as the research gives no default.
	{
		key: "graphite_disabled",
		page: "git",
		scopes: ["user"],
		title: "Turn off Graphite stack detection",
		description: "Skip detecting Graphite stacks and hide the stack-aware parts of the git panel.",
		searchTerms: ["graphite", "stack", "detect"],
		feature: "PR-08",
		type: "bool",
		default: false,
	},
	{
		key: "tool_approvals_enabled",
		page: "agents",
		scopes: ["user"],
		title: "Ask before tools run",
		description: "Require your approval before agents run tools that change files or run commands.",
		searchTerms: ["approval", "permission", "tools", "safe", "ask", "claude"],
		tomlKey: "tool_approvals_enabled",
		fileLayers: "user",
		feature: "AGENT-04",
		type: "bool",
		default: false,
	},
	{
		key: "codex_tool_approval_policy",
		page: "agents",
		scopes: ["user"],
		title: "Codex tool approvals",
		description: "How Codex asks for approval before running tools.",
		searchTerms: ["codex", "approval", "permission", "always approve"],
		tomlKey: "models.codex.tool_approval_policy",
		fileLayers: "user",
		feature: "AGENT-08",
		type: "enum",
		default: "default",
		options: [
			{ value: "default", label: "Default" },
			{ value: "always_approve", label: "Always approve" },
		],
	},
	// Our design choice: empty means the standard Claude sign-in.
	{
		key: "claude_provider",
		page: "agents",
		scopes: ["user", "repo"],
		title: "Claude provider",
		description:
			"Which provider Claude Code signs in with, for example a custom provider. Empty uses the standard sign-in.",
		searchTerms: ["claude", "provider", "bedrock", "vertex", "anthropic", "api"],
		tomlKey: "claude_provider",
		fileLayers: "user-and-repo",
		feature: "SET-03",
		type: "string",
		default: "",
	},
	// Our design choice: empty means the standard Codex sign-in.
	{
		key: "codex_provider",
		page: "agents",
		scopes: ["user", "repo"],
		title: "Codex provider",
		description:
			"Which provider Codex uses, for example a custom provider. Empty uses the standard sign-in.",
		searchTerms: ["codex", "provider", "openai", "api"],
		tomlKey: "codex_provider",
		fileLayers: "user-and-repo",
		feature: "SET-03",
		type: "string",
		default: "",
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "bedrock_region",
		page: "agents",
		scopes: ["user", "repo"],
		title: "Amazon Bedrock region",
		description: "AWS region used when Claude Code runs through Amazon Bedrock.",
		searchTerms: ["aws", "bedrock", "region"],
		tomlKey: "bedrock_region",
		fileLayers: "user-and-repo",
		feature: "SET-03",
		type: "string",
		default: "",
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "vertex_project_id",
		page: "agents",
		scopes: ["user", "repo"],
		title: "Vertex AI project",
		description: "Google Cloud project used when Claude Code runs through Vertex AI.",
		searchTerms: ["google", "vertex", "gcp", "project"],
		tomlKey: "vertex_project_id",
		fileLayers: "user-and-repo",
		feature: "SET-03",
		type: "string",
		default: "",
	},
	{
		key: "environment_variable_files",
		page: "environment",
		scopes: ["user", "repo"],
		title: "Environment files",
		description:
			"Dotenv files to read into the environment of scripts and terminals. Paths may be relative to the settings folder or repository.",
		searchTerms: ["env", "dotenv", ".env", "variables", "files"],
		tomlKey: "environment_variable_files",
		fileLayers: "user-and-repo",
		feature: "SET-04",
		type: "string-list",
		default: [],
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "setup_script",
		page: "scripts",
		scopes: ["repo"],
		title: "Setup script",
		description: "Shell commands that run when a new workspace is created.",
		searchTerms: ["setup", "install", "bootstrap", "init"],
		tomlKey: "scripts.setup",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string",
		default: "",
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "run_script",
		page: "scripts",
		scopes: ["repo"],
		title: "Run script",
		description:
			"The command the Run button starts. Named actions are kept in the same section of the file.",
		searchTerms: ["run", "dev server", "start", "test"],
		tomlKey: "scripts.run",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string",
		default: "",
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "archive_script",
		page: "scripts",
		scopes: ["repo"],
		title: "Archive script",
		description: "Shell commands that run before a workspace is archived.",
		searchTerms: ["archive", "cleanup", "teardown"],
		tomlKey: "scripts.archive",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string",
		default: "",
	},
	// Our design choice: the research value nonconcurrent is called exclusive here, to match RepoConfig.runMode.
	{
		key: "run_script_mode",
		page: "scripts",
		scopes: ["repo"],
		title: "Run mode",
		description:
			"Whether several run actions can work at the same time or each one stops the others.",
		searchTerms: ["concurrent", "exclusive", "parallel", "run"],
		tomlKey: "scripts.run_mode",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "enum",
		default: "concurrent",
		options: [
			{ value: "concurrent", label: "Run together" },
			{ value: "exclusive", label: "One at a time" },
		],
	},
	// Our design choice: off, as the research gives no default.
	{
		key: "spotlight_testing",
		page: "actions",
		scopes: ["repo"],
		title: "Use Spotlight testing",
		description:
			"Replace Run with Spotlight, which tests workspace changes in the repository root.",
		searchTerms: ["spotlight", "test", "root", "sync"],
		tomlKey: "spotlight_testing",
		fileLayers: "user-and-repo",
		feature: "RUN-02",
		type: "bool",
		default: false,
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "custom_prompt_general",
		page: "actions",
		scopes: ["repo"],
		title: "General instructions",
		description:
			"Extra instructions sent to the agent at the start of every new chat in this repository.",
		searchTerms: ["prompt", "instructions", "preferences", "system"],
		tomlKey: "prompts.general",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string",
		default: "",
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "custom_prompt_code_review",
		page: "actions",
		scopes: ["repo"],
		title: "Review instructions",
		description: "Extra instructions sent when you start an AI code review.",
		searchTerms: ["prompt", "review", "instructions"],
		tomlKey: "prompts.code_review",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string",
		default: "",
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "custom_prompt_create_pr",
		page: "actions",
		scopes: ["repo"],
		title: "Create pull request instructions",
		description: "Extra instructions sent when you ask the agent to create a pull request.",
		searchTerms: ["prompt", "pull request", "pr", "instructions"],
		tomlKey: "prompts.create_pr",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string",
		default: "",
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "custom_prompt_fix_errors",
		page: "actions",
		scopes: ["repo"],
		title: "Fix errors instructions",
		description: "Extra instructions sent when you send failing checks to the agent.",
		searchTerms: ["prompt", "checks", "fix", "errors", "instructions"],
		tomlKey: "prompts.fix_errors",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string",
		default: "",
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "custom_prompt_resolve_merge_conflicts",
		page: "actions",
		scopes: ["repo"],
		title: "Resolve conflicts instructions",
		description: "Extra instructions sent when you ask the agent to resolve merge conflicts.",
		searchTerms: ["prompt", "merge", "conflict", "instructions"],
		tomlKey: "prompts.resolve_merge_conflicts",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string",
		default: "",
	},
	// Our design choice: empty, as the research gives no default.
	{
		key: "custom_prompt_rename_branch",
		page: "actions",
		scopes: ["repo"],
		title: "Rename branch instructions",
		description: "Extra instructions sent when the agent names the branch.",
		searchTerms: ["prompt", "branch", "rename", "instructions"],
		tomlKey: "prompts.rename_branch",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string",
		default: "",
	},
	// Our design choice: the list holds URLs only; the file reader keeps the optional name of each entry.
	{
		key: "open_url_template",
		page: "misc",
		scopes: ["repo"],
		title: "Preview URLs",
		description:
			"Addresses offered by the terminal panel's open button. The first one is the default.",
		searchTerms: ["preview", "url", "localhost", "port", "open"],
		tomlKey: "preview_urls",
		fileLayers: "user-and-repo",
		feature: "RUN-03",
		type: "string-list",
		default: [],
	},
	{
		key: "file_include_globs",
		page: "misc",
		scopes: ["repo"],
		title: "Files to copy",
		description:
			"File paths or patterns copied from the main clone into each new workspace, such as .env.",
		searchTerms: ["copy", "include", "glob", "worktreeinclude", "env", "files"],
		tomlKey: "file_include_globs",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string-list",
		default: [],
	},
	{
		key: "experimental_auto_permission_mode",
		page: "experimental",
		scopes: ["user"],
		title: "Auto permission mode",
		description: "Turn on Claude's automatic permission mode.",
		searchTerms: ["auto", "permission", "claude", "mode"],
		feature: "AGENT-04",
		type: "bool",
		default: false,
	},
	{
		key: "experimental_big_terminal_mode",
		page: "experimental",
		scopes: ["user"],
		title: "Big terminal mode",
		description: "Open big terminals in the center pane with the new terminal shortcut.",
		searchTerms: ["terminal", "big", "center", "pane"],
		feature: "RUN-06",
		type: "bool",
		default: false,
	},
	// Our design choice: empty means no command runs.
	{
		key: "big_terminal_preset",
		page: "experimental",
		scopes: ["user"],
		title: "Big terminal startup command",
		description: "Command that runs automatically in a new big terminal tab.",
		searchTerms: ["terminal", "preset", "command", "startup"],
		feature: "RUN-06",
		type: "string",
		default: "",
	},
	// Our design choice: empty means no extra commands.
	{
		key: "big_terminal_custom_commands",
		page: "experimental",
		scopes: ["user"],
		title: "Big terminal command list",
		description: "Extra commands offered when you open a big terminal, one per line.",
		searchTerms: ["terminal", "commands", "presets", "list"],
		feature: "RUN-06",
		type: "string",
		default: "",
	},
	{
		key: "experimental_new_workspace_page",
		page: "experimental",
		scopes: ["user"],
		title: "Full-page workspace creation",
		description: "Create workspaces on a full page instead of a dialog.",
		searchTerms: ["create", "new workspace", "page", "dialog"],
		feature: "WS-01",
		type: "bool",
		default: false,
	},
	{
		key: "local_git_forge_enabled",
		page: "experimental",
		scopes: ["user"],
		title: "Add projects without GitHub",
		description:
			"Let projects with no GitHub remote show their own commits and merge state in place of a pull request.",
		searchTerms: ["github", "local", "git", "remote", "pull request"],
		feature: "GIT-14",
		type: "bool",
		default: false,
	},
	{
		key: "experimental_tab_freak_mode",
		page: "experimental",
		scopes: ["user"],
		title: "More tabs per workspace",
		description: "Allow up to 10 chat and terminal tabs in each workspace.",
		searchTerms: ["tabs", "limit", "more tabs"],
		feature: "NAV-10",
		type: "bool",
		default: false,
	},
	// Our design choice: this key is matched to the split-tabs item by its name; the research does not state the pairing.
	{
		key: "experimental_configurable_center_panel",
		page: "experimental",
		scopes: ["user"],
		title: "Split tabs",
		description: "Split the center panel and move tabs between the panes.",
		searchTerms: ["split", "panes", "tabs", "center"],
		feature: "NAV-10",
		type: "bool",
		default: false,
	},
	{
		key: "experimental_fork_to_new_tab",
		page: "experimental",
		scopes: ["user"],
		title: "Fork chat to a new tab",
		description: "Fork a chat, even in the middle of a turn, from its tab menu.",
		searchTerms: ["fork", "branch chat", "tab"],
		feature: "CHAT-16",
		type: "bool",
		default: false,
	},
	{
		key: "experimental_in_app_browser_preview",
		page: "experimental",
		scopes: ["user"],
		title: "In-app browser preview",
		description:
			"Open the preview button in a tab inside the app, with the element picker, instead of your browser.",
		searchTerms: ["browser", "preview", "annotate", "tab"],
		feature: "RUN-04",
		type: "bool",
		default: false,
	},
	{
		key: "experimental_show_agent_cost",
		page: "experimental",
		scopes: ["user"],
		title: "Show agent cost",
		description: "Show the estimated cost of agent work.",
		searchTerms: ["cost", "money", "price", "spend"],
		feature: "CHAT-14",
		type: "bool",
		default: false,
	},
	{
		key: "internal_workspace_status_matrix",
		page: "experimental",
		scopes: ["user"],
		title: "Workspace status matrix",
		description:
			"Use the matrix style status mark for workspaces in the home grid and the sidebar.",
		searchTerms: ["status", "matrix", "icon", "indicator"],
		feature: "WS-09",
		type: "bool",
		default: false,
	},
	{
		key: "auto_run_after_setup",
		page: "experimental",
		scopes: ["user", "repo"],
		title: "Run after setup",
		description:
			"Start the repository's default run action when a new workspace finishes its setup script.",
		searchTerms: ["run", "auto", "setup", "start"],
		tomlKey: "scripts.auto_run_after_setup",
		fileLayers: "user-and-repo",
		feature: "RUN-01",
		type: "bool",
		default: false,
	},
	// Our design choice: off, as the research gives no default and the page is experimental.
	{
		key: "dashboard_enabled",
		page: "experimental",
		scopes: ["user"],
		title: "Kanban dashboard",
		description: "Show the dashboard of workspaces by status in the sidebar.",
		searchTerms: ["dashboard", "kanban", "board", "status"],
		feature: "NAV-06",
		type: "bool",
		default: false,
	},
	// Our design choice: off, as the research gives no default and the feature is experimental.
	{
		key: "voice_mode",
		page: "experimental",
		scopes: ["user"],
		title: "Voice dictation",
		description: "Show the dictation button in the message box. Ctrl+Shift+D starts and stops it.",
		searchTerms: ["voice", "speech", "dictation", "microphone"],
		feature: "COMP-08",
		type: "bool",
		default: false,
	},
	{
		key: "sidebar_resource_usage",
		page: "experimental",
		scopes: ["user"],
		title: "Resource usage in the sidebar",
		description: "Show CPU and memory use in the footer of the sidebar.",
		searchTerms: ["cpu", "memory", "resources", "usage"],
		feature: "APP-07",
		type: "bool",
		default: false,
	},
	{
		key: "experimental_sidebar_transparency",
		page: "experimental",
		scopes: ["user"],
		title: "Transparent sidebar",
		description: "Use the macOS vibrancy effect behind the sidebar. Restart the app to apply it.",
		searchTerms: ["transparency", "vibrancy", "blur", "glass"],
		feature: "NAV-01",
		type: "bool",
		default: false,
	},
	// Our design choice: the key and the default folder are named after the app, as the research gives no default.
	{
		key: "conducted_root_path",
		page: "advanced",
		scopes: ["user"],
		title: "Root folder",
		description:
			"Where the app keeps cloned repositories and workspaces. Use an empty folder you do not edit by hand.",
		searchTerms: ["root", "folder", "directory", "path", "storage", "workspaces"],
		feature: "PRJ-01",
		type: "string",
		default: "~/conducted",
	},
	{
		key: "claude_executable_path",
		page: "advanced",
		scopes: ["user", "repo"],
		title: "Claude Code program path",
		description:
			"Use this Claude Code program instead of the bundled one. Leave empty to use the bundled program.",
		searchTerms: ["claude", "executable", "binary", "path", "cli"],
		tomlKey: "claude_code_executable_path",
		fileLayers: "user-and-repo",
		feature: "SET-03",
		type: "string",
		default: "",
	},
	{
		key: "codex_executable_path",
		page: "advanced",
		scopes: ["user", "repo"],
		title: "Codex program path",
		description:
			"Use this Codex program instead of the bundled one. Leave empty to use the bundled program.",
		searchTerms: ["codex", "executable", "binary", "path", "cli"],
		tomlKey: "codex_executable_path",
		fileLayers: "user-and-repo",
		feature: "SET-03",
		type: "string",
		default: "",
	},
	{
		key: "opencode_executable_path",
		page: "advanced",
		scopes: ["user", "repo"],
		title: "OpenCode program path",
		description:
			"Use this OpenCode program instead of the bundled one. Leave empty to use the bundled program.",
		searchTerms: ["opencode", "executable", "binary", "path", "cli"],
		tomlKey: "opencode_executable_path",
		fileLayers: "user-and-repo",
		feature: "SET-03",
		type: "string",
		default: "",
	},
	// Our design choice: on, as the setting's description says that turning it off is the exception; the research gives no default.
	{
		key: "worktree_push_auto_setup_remote",
		page: "advanced",
		scopes: ["user", "repo"],
		title: "Set the upstream on a plain push",
		description:
			"Set up new workspaces so a plain git push creates the upstream branch. Turn off to avoid writing Git config.",
		searchTerms: ["upstream", "push", "remote", "git config", "tracking"],
		tomlKey: "git.worktree_push_auto_setup_remote",
		fileLayers: "user-and-repo",
		feature: "GIT-06",
		type: "bool",
		default: true,
	},
	// Our design choice: the range 100 KB to 1 GB bounds memory and disk use.
	{
		key: "terminal_scrollback_limit_bytes",
		page: "advanced",
		scopes: ["user"],
		title: "Terminal scrollback limit",
		description: "Roughly how much terminal output to keep, in bytes.",
		searchTerms: ["scrollback", "buffer", "history", "terminal", "memory"],
		feature: "PLAT-08",
		type: "number",
		default: 10000000,
		min: 100000,
		max: 1000000000,
	},
	{
		key: "left_panel_visible",
		page: "state",
		scopes: ["user"],
		title: "Left sidebar is open",
		description: "Whether the left sidebar is shown.",
		searchTerms: ["sidebar", "panel"],
		feature: "NAV-12",
		type: "bool",
		default: true,
	},
	{
		key: "right_panel_visible",
		page: "state",
		scopes: ["user"],
		title: "Right panel is open",
		description: "Whether the right panel is shown.",
		searchTerms: ["panel", "git", "terminal"],
		feature: "NAV-12",
		type: "bool",
		default: true,
	},
	{
		key: "left_panel_width",
		page: "state",
		scopes: ["user"],
		title: "Left sidebar width",
		description: "Width of the left sidebar in pixels.",
		searchTerms: ["sidebar", "width", "resize"],
		feature: "NAV-01",
		type: "number",
		default: 256,
		min: 0,
	},
	{
		key: "sidebar_group_by",
		page: "state",
		scopes: ["user"],
		title: "Sidebar grouping",
		description: "How the sidebar groups workspaces.",
		searchTerms: ["group", "sidebar", "status", "repo", "section"],
		feature: "NAV-03",
		type: "enum",
		default: "repo",
		options: [
			{ value: "repo", label: "Project" },
			{ value: "status", label: "Status" },
			{ value: "section", label: "Section" },
		],
	},
	// Our design choice: most recently updated first, as the research lists Updated before Created.
	{
		key: "sidebar_sort_by",
		page: "state",
		scopes: ["user"],
		title: "Sidebar sort",
		description: "Which date orders workspaces in the sidebar.",
		searchTerms: ["sort", "order", "updated", "created"],
		feature: "NAV-03",
		type: "enum",
		default: "updated",
		options: [
			{ value: "updated", label: "Last updated" },
			{ value: "created", label: "Created" },
		],
	},
	// Our design choice: empty means no filter.
	{
		key: "sidebar_repo_filter",
		page: "state",
		scopes: ["user"],
		title: "Sidebar project filter",
		description: "The project the sidebar is filtered to. Empty shows all.",
		searchTerms: ["filter", "project", "repo"],
		feature: "NAV-03",
		type: "string",
		default: "",
	},
	{
		key: "using_split_view",
		page: "state",
		scopes: ["user"],
		title: "Split diff view",
		description: "Whether diffs show old and new side by side.",
		searchTerms: ["diff", "split", "unified"],
		feature: "REV-02",
		type: "bool",
		default: false,
	},
	{
		key: "wrap_lines",
		page: "state",
		scopes: ["user"],
		title: "Wrap long lines",
		description: "Whether long lines wrap in diffs and files.",
		searchTerms: ["wrap", "lines", "diff"],
		feature: "REV-02",
		type: "bool",
		default: true,
	},
	{
		key: "hide_whitespace_changes",
		page: "state",
		scopes: ["user"],
		title: "Hide whitespace changes",
		description: "Whether diffs hide changes that only touch whitespace.",
		searchTerms: ["whitespace", "diff"],
		feature: "REV-02",
		type: "bool",
		default: false,
	},
	{
		key: "pr_activity_sort_order",
		page: "state",
		scopes: ["user"],
		title: "Pull request activity order",
		description: "Whether the newest or the oldest activity comes first.",
		searchTerms: ["activity", "sort", "pull request"],
		feature: "PR-07",
		type: "enum",
		default: "newest-first",
		options: [
			{ value: "newest-first", label: "Newest first" },
			{ value: "oldest-first", label: "Oldest first" },
		],
	},
	// Our design choice: empty means no changes; the format is a JSON object from command id to shortcut list.
	{
		key: "keybinding_overrides_v1",
		page: "state",
		scopes: ["user"],
		title: "Custom key bindings",
		description: "JSON text with the shortcuts you changed.",
		searchTerms: ["shortcuts", "keys", "rebind"],
		feature: "NAV-09",
		type: "string",
		default: "",
	},
	// Our design choice: empty means ask.
	{
		key: "last_clone_directory",
		page: "state",
		scopes: ["user"],
		title: "Last clone folder",
		description: "The folder you last cloned a repository into.",
		searchTerms: ["clone", "folder"],
		feature: "PRJ-02",
		type: "string",
		default: "",
	},
	// Our design choice: empty means the first installed app.
	{
		key: "default_open_in",
		page: "state",
		scopes: ["user"],
		title: "Default app for Open in",
		description: "The app the open shortcut uses. Empty picks the first installed app.",
		searchTerms: ["open in", "editor", "default"],
		feature: "WS-08",
		type: "string",
		default: "",
	},
	// Our design choice: comma separated app ids; empty means none yet.
	{
		key: "open_in_mru_order",
		page: "state",
		scopes: ["user"],
		title: "Recently used apps for Open in",
		description: "Apps you opened workspaces with, newest first.",
		searchTerms: ["open in", "recent"],
		feature: "WS-08",
		type: "string",
		default: "",
	},
	{
		key: "onboarding_step",
		page: "state",
		scopes: ["user"],
		title: "Onboarding step",
		description: "The step of the first-run guide you reached.",
		searchTerms: ["onboarding", "first run"],
		feature: "APP-02",
		type: "number",
		default: 0,
		min: 0,
	},
	{
		key: "first_time_onboarding_step",
		page: "state",
		scopes: ["user"],
		title: "First-time onboarding step",
		description: "The step of the first-time guide you reached.",
		searchTerms: ["onboarding", "first run"],
		feature: "APP-02",
		type: "number",
		default: 1,
		min: 0,
	},
	// Our design choice: empty means none seen.
	{
		key: "last_seen_announcement",
		page: "state",
		scopes: ["user"],
		title: "Last seen announcement",
		description: "Id of the newest changelog notice you have seen.",
		searchTerms: ["changelog", "announcement", "news"],
		feature: "APP-06",
		type: "string",
		default: "",
	},
	{
		key: "local_env_vars_import_banner_dismissed",
		page: "state",
		scopes: ["user"],
		title: "Environment import banner dismissed",
		description: "Whether you closed the banner that offers to import local environment variables.",
		searchTerms: ["env", "banner", "import"],
		feature: "SET-04",
		type: "bool",
		default: false,
	},
] as const satisfies readonly SettingDef[];

export type SettingKey = (typeof SETTINGS_TABLE)[number]["key"];

/** The table typed as plain definitions, so optional fields can be read without narrowing. */
export const SETTINGS: readonly SettingDef[] = SETTINGS_TABLE;

export const SETTING_KEYS: readonly SettingKey[] = SETTINGS_TABLE.map((s) => s.key);

const BY_KEY: ReadonlyMap<string, SettingDef> = new Map(SETTINGS.map((s) => [s.key, s]));

export function getSettingDef(key: string): SettingDef | undefined {
	return BY_KEY.get(key);
}

/** Settings of one page, in table order. */
export function settingsForPage(page: SettingPage): SettingDef[] {
	return SETTINGS.filter((s) => s.page === page);
}

/** The default as a fresh value, so callers cannot change the table by editing a list. */
export function defaultValueOf(key: string): SettingValue | undefined {
	const def = BY_KEY.get(key);
	if (def === undefined) {
		return undefined;
	}
	return def.type === "string-list" ? [...def.default] : def.default;
}

export function isFileBacked(def: SettingDef): boolean {
	return def.tomlKey !== undefined;
}

/** settings.toml key to setting key, for the settings that live in the file. */
export function tomlKeys(): Record<string, string> {
	const map: Record<string, string> = {};
	for (const def of SETTINGS) {
		if (def.tomlKey !== undefined) {
			map[def.tomlKey] = def.key;
		}
	}
	return map;
}

// ---------------------------------------------------------------- search

/**
 * Case-insensitive substring search. Title matches come first, then key and search term matches,
 * then description matches. Inside a group the table order is kept. The hidden "state" page is skipped.
 */
export function searchSettings(query: string, limit = 30): SettingDef[] {
	const needle = query.trim().toLowerCase();
	if (needle === "" || limit <= 0) {
		return [];
	}
	const has = (text: string) => text.toLowerCase().includes(needle);
	const groups: SettingDef[][] = [[], [], []];
	for (const def of SETTINGS) {
		if (def.page === "state") {
			continue;
		}
		if (has(def.title)) {
			groups[0]?.push(def);
		} else if (has(def.key) || def.searchTerms.some(has)) {
			groups[1]?.push(def);
		} else if (has(def.description)) {
			groups[2]?.push(def);
		}
	}
	return groups.flat().slice(0, limit);
}

// ---------------------------------------------------------------- values

const invalid = (def: SettingDef, why: string) =>
	err(appError("setting_invalid", `"${def.key}" ${why}.`));

/**
 * Checks a raw value against a setting and returns it in the right type.
 * The settings table stores text, so bool accepts "true" and "false", number accepts numeric text,
 * and string-list accepts one entry per line. Null means "no value set" and is always accepted.
 */
export function coerceSettingValue(def: SettingDef, raw: unknown): Result<SettingValue> {
	if (raw === null) {
		return ok(null);
	}
	switch (def.type) {
		case "bool": {
			if (typeof raw === "boolean") {
				return ok(raw);
			}
			if (raw === "true") {
				return ok(true);
			}
			if (raw === "false") {
				return ok(false);
			}
			return invalid(def, "must be true or false");
		}
		case "string":
			return typeof raw === "string" ? ok(raw) : invalid(def, "must be text");
		case "number": {
			const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
			if (typeof value !== "number" || !Number.isFinite(value)) {
				return invalid(def, "must be a number");
			}
			if (def.min !== undefined && value < def.min) {
				return invalid(def, `must be at least ${def.min}`);
			}
			if (def.max !== undefined && value > def.max) {
				return invalid(def, `must be at most ${def.max}`);
			}
			return ok(value);
		}
		case "enum": {
			if (typeof raw === "string" && def.options.some((o) => o.value === raw)) {
				return ok(raw);
			}
			const allowed = def.options.map((o) => `"${o.value}"`).join(", ");
			return invalid(def, `must be one of ${allowed}`);
		}
		case "string-list": {
			if (Array.isArray(raw) && raw.every((item) => typeof item === "string")) {
				return ok([...raw]);
			}
			if (typeof raw === "string") {
				return ok(
					raw
						.split("\n")
						.map((line) => line.trim())
						.filter((line) => line !== ""),
				);
			}
			return invalid(def, "must be a list of text lines");
		}
	}
}
