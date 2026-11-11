/**
 * @feature SET-01 Settings registry
 * Owns: The typed table of every local setting (key, page, scope, type, default, file key) plus lookup, search and value checking.
 * Behaviour: docs/research/conductor/ui-map.md section 6 (pages) and services-map.md section 4.2 (layers, keys, defaults, settings.toml keys).
 * Must handle: values stored as strings ("true", "12"); enum membership; number ranges; empty values for unset;
 *   list values written as one string per line; hidden state keys that must not show up in search;
 *   settings that only the user file may set versus settings a repo file may also set.
 * Test first: coercing "true" for a bool returns true, and "maybe" returns a setting_invalid error.
 *
 * DATA-05 owns the settings layers, their order and their reading: see `SETTING_LAYERS` in
 * `core/services/settings.ts`. This file only says which settings.toml files may set a key:
 * `fileLayers` is "user" (the user file only) or "user-and-repo" (the user file and the repo files).
 *
 * Our design choice: `default_message_send_mode` defaults to "steer" and its values are "steer" and "queue".
 * The research default is `steering` with the other value `queued`.
 * Our design choice: settings that the research marks as hosted account, billing, organization, remote control,
 * analytics or internal are left out, as are secrets such as tokens and API keys, which belong in the Keychain.
 * The file-sync switch for new cloud workspaces is kept because CLOUD-11 builds the sync it starts.
 * The internal switches kept are `unstarted_workspaces_enabled` (WS-11) and
 * `internal_remote_local_execution_mcp` (CLOUD-14), because both are built user controls.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import type { PreviewUrlEntry } from "../model.ts";

export type SettingPage =
	| "general"
	| "account"
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
	| "remote-control"
	| "connections"
	| "state";

/** "state" is a hidden page for saved screen state that has no settings screen. */
export const SETTING_PAGES: readonly SettingPage[] = [
	"general",
	"account",
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
	"remote-control",
	"connections",
	"state",
];

export type SettingScope = "user" | "repo";
export type SettingValue = string | number | boolean | string[] | null;

/** Which settings.toml files may set a key. `tomlKey` and `fileLayers` come as a pair.
 *  "user" is the user file only; "user-and-repo" adds the repo files. DATA-05 reads their order. */
type FileBacking =
	| { tomlKey: string; fileLayers: "user" | "user-and-repo" }
	| { tomlKey?: undefined; fileLayers?: undefined };

export type SettingDef = {
	key: string;
	page: SettingPage;
	scopes: readonly SettingScope[];
	title: string;
	/** The line under the title on the page and in search results. */
	description: string;
	/** The title settings search shows, where Conductor keeps it apart from the page's (ui-map 6). */
	searchTitle?: string;
	/** The description settings search shows, where Conductor keeps it apart from the page's. */
	searchDescription?: string;
	/** False for a row that shares one search result with another (Conductor's Terminal font). */
	searchable?: false;
	/**
	 * False where Conductor's row on the page shows no line under its title (D098): the page leaves
	 * the description out, and search still shows it.
	 */
	pageDescription?: false;
	/** A small hint under the description, such as the key that adds a new line. */
	detail?: string;
	/** A detail that warns, drawn in the warning colour (Graphite's performance note). */
	detailTone?: "warning";
	/** A page that explains the setting, linked as "Learn more" after the description. */
	learnMoreUrl?: string;
	/** Extra words that find this setting in search. */
	searchTerms: readonly string[];
	/** Backlog id of the feature that owns the behaviour. */
	feature: string;
} & FileBacking &
	(
		| {
				type: "bool";
				default: boolean;
				/** The stored key says the opposite of the title, so the switch shows the value inverted. */
				shownInverted?: true;
		  }
		| { type: "string"; default: string }
		| { type: "number"; default: number; min?: number; max?: number }
		| { type: "enum"; default: string; options: readonly { value: string; label: string }[] }
		| { type: "string-list"; default: readonly string[] }
		| { type: "preview-urls"; default: string }
	);

const SETTINGS_TABLE = [
	{
		key: "message_send_key",
		page: "general",
		scopes: ["user"],
		title: "Send messages with",
		description: "Choose which key combination sends messages",
		detail: "Use ⇧↵ for new lines",
		searchTerms: ["enter", "return", "submit", "cmd", "keyboard"],
		feature: "COMP-01",
		type: "enum",
		default: "enter",
		options: [
			{ value: "enter", label: "Enter" },
			{ value: "cmd-enter", label: "⌘ Enter" },
		],
	},
	// Our design choice: values are steer and queue (the research uses steering and queued), and the default is steer.
	{
		key: "default_message_send_mode",
		page: "general",
		scopes: ["user"],
		title: "Follow-up behavior",
		description: "Queue messages to send after the agent finishes, or steer the agent mid-turn.",
		detail: "Use ⌘↵ to queue",
		searchTerms: ["steer", "queue", "follow-up", "interrupt", "mid-turn"],
		feature: "CHAT-03",
		type: "enum",
		default: "steer",
		options: [
			{ value: "steer", label: "Steer" },
			{ value: "queue", label: "Queue" },
		],
	},
	{
		key: "notifications_enabled",
		page: "general",
		scopes: ["user"],
		title: "Agent notifications",
		description: "Get notified when an agent finishes working.",
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
		description: "Choose what plays when AI finishes working in a chat.",
		searchTerms: ["audio", "chime", "ding", "mute", "silent"],
		feature: "CHAT-19",
		type: "enum",
		default: "default",
		options: [
			{ value: "default", label: "Chime" },
			{ value: "none", label: "No sound" },
		],
	},
	// Our design choice: off, as the research gives no default.
	{
		key: "manual_workspace_order",
		page: "general",
		scopes: ["user"],
		title: "Arrange workspaces manually",
		description: "Let you drag workspaces into your own order in the sidebar.",
		pageDescription: false,
		searchTerms: ["sort", "drag", "order", "reorder"],
		feature: "NAV-04",
		type: "bool",
		default: false,
	},
	{
		key: "auto_convert_long_text",
		page: "general",
		scopes: ["user"],
		title: "Auto-convert long text",
		description: "Convert pasted text over 5000 characters into text attachments",
		searchTerms: ["paste", "clipboard", "long text", "attachment"],
		feature: "COMP-07",
		type: "bool",
		default: true,
	},
	// Research names this control on the General page with this key and an off default
	// (ui-map.md 6; services-map.md 4.2.3). The effect on assistant replies belongs to CHAT-06.
	{
		key: "not_absolutely_right",
		page: "general",
		scopes: ["user"],
		title: "I'm not absolutely right, thank you very much",
		description: 'Strip "You\'re absolutely right!" from AI messages',
		pageDescription: false,
		searchTerms: ["absolutely right", "sycophancy", "strip", "preamble", "phrase"],
		feature: "CHAT-06",
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
			"Always show context usage. By default, it is only shown when more than 70% is used.",
		searchTerms: ["context", "tokens", "wheel", "usage", "ring"],
		feature: "CHAT-14",
		type: "bool",
		default: false,
	},
	{
		key: "caffeinate_while_agents_running",
		page: "general",
		scopes: ["user"],
		title: "Caffeinate while agents are running",
		description:
			"Prevent your Mac from sleeping while an agent is actively working. Shuts off below 10% battery.",
		searchTerms: ["sleep", "caffeinate", "awake", "battery", "power"],
		feature: "SET-02",
		type: "bool",
		default: false,
	},
	{
		key: "auto_restart_on_update_when_idle",
		page: "general",
		scopes: ["user"],
		title: "Restart automatically on update",
		description: "Install a downloaded update and restart once no agent is working.",
		pageDescription: false,
		searchTerms: ["update", "restart", "upgrade", "idle"],
		feature: "APP-06",
		type: "bool",
		default: false,
	},
	{
		key: "garry_mode",
		page: "general",
		scopes: ["user"],
		title: "Don't collapse tool calls (Garry Mode)",
		description: "Show all tool calls expanded by default instead of collapsed.",
		searchTerms: ["tool call", "collapse", "expanded", "verbose", "details"],
		feature: "CHAT-08",
		type: "bool",
		default: false,
	},
	{
		key: "artifacts_tab_enabled",
		page: "general",
		scopes: ["user"],
		title: "Show Artifacts tab",
		description:
			"Show a tab that lists the files the agent keeps in the workspace's .context folder.",
		searchTerms: ["artifacts", "context", "files", "tab", "notes", "plans"],
		feature: "REV-10",
		type: "bool",
		default: true,
	},
	{
		key: "enterprise_data_privacy",
		page: "general",
		scopes: ["user", "repo"],
		title: "Enterprise data privacy",
		description:
			"Disable features requiring external AI providers, such as AI generated chat titles, as well as custom MCP servers.",
		searchTerms: ["privacy", "enterprise", "titles", "mcp", "external", "data"],
		tomlKey: "enterprise_data_privacy",
		fileLayers: "user-and-repo",
		feature: "SET-02",
		type: "bool",
		default: false,
	},
	// Research keeps the values cli and pat; conductor-app needs Conductor's hosted service (D029).
	// An empty value means no explicit choice: a saved token resolves to pat, otherwise cli
	// (services-map.md 3.9).
	{
		key: "gh_auth_method",
		page: "account",
		scopes: ["user"],
		title: "GitHub sign-in method",
		description:
			"Choose how the app signs in to GitHub. Automatic uses a saved personal access token when there is one, and the gh command's own login otherwise.",
		searchTerms: ["github", "auth", "sign in", "cli", "token", "pat", "personal access token"],
		feature: "PR-01",
		type: "enum",
		default: "",
		options: [
			{ value: "", label: "Automatic" },
			{ value: "cli", label: "GitHub CLI" },
			{ value: "pat", label: "Personal access token" },
		],
	},
	// Our design choice: follow the system, as the research gives no default.
	{
		key: "theme",
		page: "appearance",
		scopes: ["user"],
		title: "Theme",
		description: "Switch between light, dark, and system appearance.",
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
		title: "Low-contrast dark mode",
		description: "Soften the app's colors when using the dark theme.",
		pageDescription: false,
		searchTerms: ["contrast", "dim", "soft", "dark"],
		feature: "SET-06",
		type: "bool",
		default: false,
	},
	{
		key: "color_vision",
		page: "appearance",
		scopes: ["user"],
		title: "Accessible colors",
		description: "Theme optimized for color vision differences.",
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
			{ value: "protanopia-deuteranopia", label: "Deuteranopia / Protanopia" },
			{ value: "tritanopia", label: "Tritanopia" },
		],
	},
	{
		key: "code_theme",
		page: "appearance",
		scopes: ["user"],
		title: "Code theme",
		description: "Syntax highlighting colors for code blocks and editors.",
		searchDescription: "Syntax highlighting theme for code and diffs.",
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
		title: "Colored sidebar diffs",
		description: "Always show line change colors in the sidebar, even for unselected workspaces.",
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
		description: "Use font ligatures in file editors and diffs.",
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
		title: "Mono Font",
		description: "Font used for code and diffs",
		searchDescription: "Font used for code and diffs.",
		searchTerms: ["monospace", "typeface", "font family", "geist"],
		feature: "SET-06",
		type: "string",
		default: "Geist Mono",
	},
	{
		key: "markdown_style",
		page: "appearance",
		scopes: ["user"],
		title: "Markdown Style",
		description: "Rendering style for markdown files",
		searchDescription: "Rendering style for markdown files.",
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
		title: "Terminal Font",
		description: "Enter font name exactly as installed, e.g. Arial, Papyrus, FiraCode Nerd Font",
		searchTitle: "Terminal font",
		searchDescription: "Font family and size for the terminal.",
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
		title: "Terminal Font Size",
		description: "Text size in points for terminals.",
		pageDescription: false,
		searchable: false,
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
		description: "Adjust the size of the Conducted interface.",
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
		description: "Model for new chats",
		searchTerms: ["model", "llm", "default", "claude", "gpt"],
		tomlKey: "models.default",
		fileLayers: "user",
		feature: "COMP-02",
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
	// Our design choice: an empty value means the model's own default.
	{
		key: "default_claude_effort_level",
		page: "models",
		scopes: ["user"],
		title: "Claude effort level",
		description: "How much effort Claude spends in new chats.",
		pageDescription: false,
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
		key: "default_codex_personality",
		page: "models",
		scopes: ["user"],
		title: "Codex personality",
		description: "The tone Codex uses in new chats.",
		pageDescription: false,
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
	// Our design choice: an empty value means the model's own default.
	{
		key: "default_codex_thinking_level",
		page: "models",
		scopes: ["user"],
		title: "Codex thinking level",
		description: "How hard Codex thinks in new chats.",
		pageDescription: false,
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
	{
		key: "default_claude_personality",
		page: "models",
		scopes: ["user"],
		title: "Claude output style",
		description: "Choose which output style to apply to new chats. Existing chats do not change.",
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
	// Our design choice: empty means fall back to the default model.
	{
		key: "review_model",
		page: "models",
		scopes: ["user"],
		title: "Review model",
		description: "Model used by chats that start an AI code review. Empty uses the default model.",
		pageDescription: false,
		searchTerms: ["model", "review", "code review"],
		tomlKey: "models.review",
		fileLayers: "user",
		feature: "REV-05",
		type: "string",
		default: "",
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
	// Our design choice: our model ids do not carry their agent (Conductor infers it from the
	// model), so the review picker stores the agent beside the model. Empty keeps the default
	// chat's agent.
	{
		key: "review_agent",
		page: "models",
		scopes: ["user"],
		title: "Review agent",
		description: "Agent that runs AI code review chats. Empty uses the default chat's agent.",
		pageDescription: false,
		searchTerms: ["agent", "review", "model"],
		feature: "REV-05",
		type: "string",
		default: "",
	},
	// Our design choice: Conductor keeps a model's effort per model. Without that store, a review
	// effort for an agent with no review setting of its own (Cursor, ACP) goes here.
	{
		key: "review_effort",
		page: "models",
		scopes: ["user"],
		title: "Effort level for reviews",
		description:
			"How hard agents without their own review effort setting think during AI code reviews.",
		pageDescription: false,
		searchTerms: ["effort", "thinking", "review"],
		feature: "REV-05",
		type: "enum",
		default: "",
		options: [
			{ value: "", label: "Default chat's effort" },
			{ value: "none", label: "None" },
			{ value: "low", label: "Low" },
			{ value: "medium", label: "Medium" },
			{ value: "high", label: "High" },
			{ value: "xhigh", label: "Extra high" },
			{ value: "max", label: "Max" },
			{ value: "ultra", label: "Ultra" },
			{ value: "ultracode", label: "Ultracode" },
		],
	},
	// Our design choice: off, as the research gives no default.
	{
		key: "default_plan_mode",
		page: "models",
		scopes: ["user"],
		title: "Default to plan mode in new chats",
		description: "Start new chats in plan mode so the agent proposes a plan first.",
		pageDescription: false,
		searchTerms: ["plan", "planning", "approve"],
		tomlKey: "models.default_plan_mode",
		fileLayers: "user",
		feature: "COMP-03",
		type: "bool",
		default: false,
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
		description: "Prefix for new workspace branch names.",
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
		title: "Automatically rename new branches",
		description:
			"After the first message, replace the placeholder branch name with one that describes the task.",
		pageDescription: false,
		searchTerms: ["branch", "rename", "placeholder", "auto"],
		feature: "WS-04",
		type: "bool",
		default: true,
	},
	{
		key: "auto_rename_workspace_on_branch_name_set",
		page: "git",
		scopes: ["user"],
		title: "Rename workspace when branch is named",
		description: "When the branch gets a real name, rename the workspace to match.",
		pageDescription: false,
		searchTerms: ["workspace", "rename", "branch", "title"],
		feature: "WS-04",
		type: "bool",
		default: true,
	},
	{
		key: "delete_branch_on_archive",
		page: "git",
		scopes: ["user", "repo"],
		title: "Delete branch on archive",
		description:
			"Delete the local branch when archiving a workspace. To delete the remote branch, configure it on GitHub.",
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
		title: "Archive on merge",
		description: "Automatically archive a workspace after merging its PR in Conducted",
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
		pageDescription: false,
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
	// Our design choice: off, as the research gives no default. The link opens Conducted on the
	// author's own Mac, so it does not work for anyone else reading the pull request.
	{
		key: "include_workspace_link_in_pr",
		page: "git",
		scopes: ["user"],
		title: "Include link to workspace in PR description",
		description:
			"Ask the agent to put a link to this workspace in the pull request description. The link only works on your own Mac.",
		pageDescription: false,
		searchTerms: ["workspace", "link", "pull request", "description", "deep link"],
		feature: "PR-02",
		type: "bool",
		default: false,
	},
	// Our design choice: off, as the research gives no default.
	{
		key: "automerge_enabled",
		page: "git",
		scopes: ["user"],
		title: "Automerge",
		description:
			"Show an automerge button in the git panel when checks are pending. Requires automerge to be enabled in your GitHub repository settings. Automerge is not supported for stacked pull requests.",
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
		title: "Treat optional checks as blocking",
		description:
			"Hide the merge button when any check has failed, including checks GitHub considers optional.",
		searchTerms: ["checks", "optional", "merge", "blocking", "required"],
		feature: "PR-06",
		type: "bool",
		default: false,
	},
	// Default on (services-map.md 4.2). Besides what its description says, the switch gates the stack
	// read, sync and merge here. Conductor gates the stack sync and the stack readiness with it
	// (services-map.md 5B.1.7, 5B.1.8).
	{
		key: "github_stacked_prs_enabled",
		page: "git",
		scopes: ["user"],
		title: "Use GitHub stacked PRs",
		description: "Instruct agents that they can use `gh stack` for PR stacking.",
		searchTerms: ["stack", "stacked", "gh stack", "pull request"],
		feature: "PR-08",
		type: "bool",
		default: true,
	},
	{
		key: "experimental_auto_permission_mode",
		page: "experimental",
		scopes: ["user"],
		title: "Auto permission mode",
		description: "Turns on Claude auto mode.",
		// Claude's glossary entry on auto mode, which Conductor's "Learn more" opens.
		learnMoreUrl: "https://code.claude.com/docs/en/glossary#auto-mode",
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
		description: "Create big terminals in the center pane with ⌘⇧T",
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
		title: "New tab preset",
		description: "Command to auto-run when creating a new terminal tab.",
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
		title: "New workspace page",
		description: "Full-screen workspace creation",
		searchTerms: ["create", "new workspace", "page", "dialog"],
		feature: "WS-01",
		type: "bool",
		default: false,
	},
	// Our design choice: Conductor keeps this as an internal switch, off and hidden in release
	// builds (services-map.md 4.2.3 and the defaults table). Here it is an Experimental switch and
	// on by default, so the built backlog (WS-11) stays reachable. The owner decides the default.
	{
		key: "unstarted_workspaces_enabled",
		page: "experimental",
		scopes: ["user"],
		title: "Unstarted workspaces",
		description: "Save a new workspace to the backlog and start it later.",
		searchTerms: ["backlog", "unstarted", "start later", "draft"],
		feature: "WS-11",
		type: "bool",
		default: true,
	},
	{
		key: "experimental_tab_freak_mode",
		page: "experimental",
		scopes: ["user"],
		title: "Tab Freak Mode",
		description: "Allow up to 10 chat and terminal tabs per workspace.",
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
		description: "Split the center panel and move tabs between panes.",
		searchTerms: ["split", "panes", "tabs", "center"],
		feature: "NAV-10",
		type: "bool",
		default: false,
	},
	{
		key: "experimental_fork_to_new_tab",
		page: "experimental",
		scopes: ["user"],
		title: "Fork chat to new tab",
		description: "Fork a chat, even mid-turn, from its tab's context menu or with ⌘⌥↵.",
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
			"Open the preview button in an in-app browser tab (with the annotation overlay) instead of your external browser.",
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
		description: "Show estimated agent costs for cloud workspaces.",
		searchTerms: ["cost", "money", "price", "spend"],
		feature: "CHAT-14",
		type: "bool",
		default: false,
	},
	{
		key: "internal_workspace_status_matrix",
		page: "experimental",
		scopes: ["user"],
		title: "Workspace status matrix for local workspaces",
		description:
			"Use the matrix-style workspace status indicator for local workspaces in Home and the sidebar.",
		searchTerms: ["status", "matrix", "icon", "indicator"],
		feature: "WS-09",
		type: "bool",
		default: false,
	},
	{
		key: "local_git_forge_enabled",
		page: "experimental",
		scopes: ["user"],
		title: "Add projects without GitHub",
		description:
			"Let Conducted add existing local repositories even when they are not connected to GitHub.",
		searchTerms: ["github", "local", "git", "remote", "pull request"],
		feature: "GIT-14",
		type: "bool",
		default: false,
	},
	{
		key: "auto_run_after_setup",
		page: "experimental",
		scopes: ["user", "repo"],
		title: "Auto-run after setup",
		description:
			"Start a repository's default action automatically after a new local workspace finishes setup.",
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
		title: "Dashboard",
		description: "Show the dashboard and workspace sidebar.",
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
		title: "Voice mode",
		description:
			"Enables speech-to-text in the chat composer. Press Ctrl+Shift+D to start dictating.",
		searchTerms: ["voice", "speech", "dictation", "microphone"],
		feature: "COMP-08",
		type: "bool",
		default: false,
	},
	{
		key: "sidebar_resource_usage",
		page: "experimental",
		scopes: ["user"],
		title: "Show sidebar resource usage",
		description: "Shows CPU and memory usage in the workspace sidebar footer.",
		searchTerms: ["cpu", "memory", "resources", "usage"],
		feature: "APP-07",
		type: "bool",
		default: false,
	},
	{
		key: "experimental_sidebar_transparency",
		page: "experimental",
		scopes: ["user"],
		title: "Sidebar transparency",
		description:
			"Use native macOS vibrancy behind the workspace sidebar. Takes effect after you restart Conducted.",
		searchTerms: ["transparency", "vibrancy", "blur", "glass"],
		feature: "NAV-01",
		type: "bool",
		default: false,
	},
	// The stored key says disabled and the switch says support, as in Conductor (services-map.md
	// 4.1.5), so the switch shows the opposite of the stored value. Graphite support starts off, so
	// the app runs no `gt` until the user turns it on: Conductor's defaults hold `graphite_disabled`
	// true (services-map.md 4.1) and a migration turns Graphite stacks off by default
	// (native-and-sidecar-map.md). Conductor's description goes on about cloud workspaces, which
	// this app does not have, so that sentence is left out.
	{
		key: "graphite_disabled",
		page: "experimental",
		scopes: ["user"],
		title: "Graphite stack support",
		description:
			"Detect Graphite stacks for the active local workspace and show stack-aware UI in the git panel. Cloud workspaces are unaffected. When off, Conducted never runs the gt CLI.",
		// Conductor shows this line under the description, in its warning colour (renderApp @11110873).
		detail: "Warning: appears to sometimes cause performance issues",
		detailTone: "warning",
		searchTerms: ["graphite", "stack", "detect", "gt"],
		feature: "PR-08",
		type: "bool",
		default: true,
		shownInverted: true,
	},
	{
		key: "tool_approvals_enabled",
		page: "agents",
		scopes: ["user"],
		title: "Claude Code tool approvals",
		description: "Require manual approval before agents can run tools.",
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
		pageDescription: false,
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
	// Our design choice: Conductor has no Remote Control for claude.ai (D019), so the key, words and
	// default are ours. Off by default, so no chat is shared until the user asks.
	{
		key: "remote_control_new_chats",
		page: "remote-control",
		scopes: ["user"],
		title: "Remote Control for new chats",
		description:
			"Start every new Claude chat with Remote Control on, so you can open it in claude.ai/code or the Claude app.",
		searchTerms: ["remote", "claude.ai", "phone", "mobile", "app"],
		feature: "RC-04",
		type: "bool",
		default: false,
	},
	// Conductor's key, title and default (services-map.md 5B.2.1, ui-map.md 6); the description names
	// our Remote Control session where Conductor's names a paired device.
	{
		key: "remote_control_keep_awake",
		page: "remote-control",
		scopes: ["user"],
		title: "Keep this Mac awake",
		description:
			"Prevent sleep while a Remote Control session is connected and this Mac is plugged in.",
		searchTerms: ["remote", "sleep", "caffeinate", "awake", "power"],
		feature: "RC-04",
		type: "bool",
		default: true,
	},
	// Our design choice: off by default, as the research gives none. No settings file key, as in the research.
	{
		key: "chrome_mode_enabled",
		page: "agents",
		scopes: ["user"],
		title: "Use Claude Code with Chrome",
		description:
			"Start Claude with its Chrome browser tools in new chats. A change restarts a running Claude chat at its next message.",
		searchTerms: ["claude", "chrome", "browser"],
		feature: "AGENT-16",
		type: "bool",
		default: false,
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
		title: "Env files",
		description:
			"Dotenv files to read into the environment of scripts and agents. Paths may be relative to the settings folder or repository.",
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
		title: "Use spotlight testing",
		description:
			"Replace Run with Spotlight for this repository so workspace changes are tested in the repository root.",
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
		title: "General preferences",
		description: "Add custom instructions sent to the agent at the start of every new chat.",
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
	// Our design choice: the file holds one JSON string of `{name, url}` entries, as Conductor's
	// does. A plain string or a list of strings from an older file still reads as URLs with no name.
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
		type: "preview-urls",
		default: "",
	},
	{
		key: "file_include_globs",
		page: "misc",
		scopes: ["repo"],
		title: "Files to copy",
		description: "Conducted will automatically copy these file paths in each new workspace.",
		searchTerms: ["copy", "include", "glob", "worktreeinclude", "env", "files"],
		tomlKey: "file_include_globs",
		fileLayers: "user-and-repo",
		feature: "SET-07",
		type: "string-list",
		default: [],
	},
	// Our design choice: the wording is ours (D002); the research gives only the truncated row text.
	{
		key: "auto_sync_files_in_new_cloud_workspaces",
		page: "advanced",
		scopes: ["user"],
		title: "Enable file sync in new cloud workspaces",
		description:
			"Start syncing a new cloud workspace to this Mac when its files are first needed. You can still turn sync on or off for one workspace later.",
		searchTerms: ["cloud", "sync", "mirror", "files", "workspace"],
		feature: "CLOUD-11",
		type: "bool",
		default: true,
	},
	// The key keeps Conductor's name (D020); the default folder is named after the app, as the
	// research gives no default (D012). A stored row under our earlier name moves in migration 0017.
	{
		key: "conductor_root_path",
		page: "advanced",
		scopes: ["user"],
		title: "Conducted root directory",
		description:
			"Where Conducted stores repositories and workspaces. This should be an empty directory that you don't modify directly.",
		searchTerms: ["root", "folder", "directory", "path", "storage", "workspaces"],
		feature: "PRJ-01",
		type: "string",
		default: "~/conducted",
	},
	{
		key: "claude_executable_path",
		page: "advanced",
		scopes: ["user", "repo"],
		title: "Claude Code executable path",
		description:
			"Override the bundled Claude Code executable with a custom one. Leave empty to use the bundled version (recommended).",
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
		title: "Codex executable path",
		description:
			"Override the bundled Codex executable with a custom one. Leave empty to use the bundled version (recommended).",
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
		title: "OpenCode executable path",
		description:
			"Override the bundled OpenCode executable with a custom one. Leave empty to use the bundled version (recommended).",
		searchTerms: ["opencode", "executable", "binary", "path", "cli"],
		tomlKey: "opencode_executable_path",
		fileLayers: "user-and-repo",
		feature: "SET-03",
		type: "string",
		default: "",
	},
	{
		key: "ssh_key_path",
		page: "advanced",
		scopes: ["user"],
		title: "SSH private key path",
		description:
			"Use your own SSH key for cloud workspace access. Leave empty to auto-generate a key.",
		searchTerms: ["ssh", "key", "cloud", "workspace", "path", "private"],
		feature: "CLOUD-12",
		type: "string",
		default: "",
	},
	// CLOUD-14. The research's key has the "internal" prefix but the row is a user control on
	// Advanced ("Remote execution MCP"), so it is kept. On unless stored as "false".
	{
		key: "internal_remote_local_execution_mcp",
		page: "advanced",
		scopes: ["user"],
		title: "Remote execution MCP",
		description:
			"Let remote agents request approved one-shot commands on this Mac. Each command still requires your approval.",
		searchTerms: ["remote", "local", "command", "cloud", "mcp", "agent", "execution"],
		feature: "CLOUD-14",
		type: "bool",
		default: true,
	},
	{
		key: "always_allow_local_execution",
		page: "advanced",
		scopes: ["user"],
		title: "Always allow local commands",
		description:
			"Run local commands from remote agents without asking. Turned on when you choose Yes always on a local command approval.",
		searchTerms: ["remote", "local", "command", "cloud", "allow", "always", "approval"],
		feature: "CLOUD-14",
		type: "bool",
		default: false,
	},
	// Our design choice: on, as the setting's description says that turning it off is the exception; the research gives no default.
	{
		key: "worktree_push_auto_setup_remote",
		page: "advanced",
		scopes: ["user", "repo"],
		title: "Set upstream on plain git push",
		description:
			"Configure new Conducted workspaces so plain git push sets a branch upstream. Turning this off avoids writing Git worktree config, but PR info may be less reliable until branches have an upstream.",
		searchTerms: ["upstream", "push", "remote", "git config", "tracking"],
		tomlKey: "git.worktree_push_auto_setup_remote",
		fileLayers: "user-and-repo",
		feature: "GIT-06",
		type: "bool",
		default: true,
	},
	// The research clamps this between 1 MB and 1 GB (services-map 5A.4.8).
	{
		key: "terminal_scrollback_limit_bytes",
		page: "advanced",
		scopes: ["user"],
		title: "Scrollback limit",
		description: "Approximate terminal output to keep.",
		searchTerms: ["scrollback", "buffer", "history", "terminal", "memory"],
		feature: "PLAT-08",
		type: "number",
		default: 10000000,
		min: 1000000,
		max: 1000000000,
	},
	// CLOUD-19: the organisation switcher's choice, this Mac or the paired Worker. A stored "cloud"
	// on a Mac that is not paired reads as this Mac (core/organization.ts).
	{
		key: "active_organization",
		page: "state",
		scopes: ["user"],
		title: "Organization",
		description: "Where new workspaces are created: this Mac or your cloud Worker.",
		searchTerms: ["organization", "cloud", "worker", "local", "mac"],
		feature: "CLOUD-19",
		type: "enum",
		default: "local",
		options: [
			{ value: "local", label: "This Mac" },
			{ value: "cloud", label: "Cloud" },
		],
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
	// Our design choice: a JSON object from a group key ("pinned", "status:in_progress",
	// "project:<id>") to the workspace ids in the user's order.
	{
		key: "sidebar_manual_order",
		page: "state",
		scopes: ["user"],
		title: "Sidebar manual order",
		description: "The order you dragged workspaces into, per sidebar group.",
		searchTerms: ["order", "sidebar", "manual", "drag", "reorder"],
		feature: "NAV-04",
		type: "string",
		default: "",
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
	// Our design choice: one list for every callout, so "Reset callout dismissals" clears one value.
	{
		key: "dismissed_callouts",
		page: "state",
		scopes: ["user"],
		title: "Dismissed callouts",
		description: "Ids of the hints you dismissed, so they stay hidden.",
		searchTerms: ["callout", "hint", "coach mark", "dismiss"],
		feature: "APP-10",
		type: "string-list",
		default: [],
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
	// CLOUD-10: Conductor keeps these four as org-personal server settings (services-map 5A.3.3).
	// This app has no server settings, so they live with the other local settings (D110).
	{
		key: "port_forwarding_strategy",
		page: "connections",
		scopes: ["user"],
		title: "Forwarding strategy",
		description:
			"How a new forward chooses its local port. Match uses the remote port when it is free; Range picks from the local range.",
		searchTerms: ["forward", "port", "match", "range", "cloud"],
		feature: "CLOUD-10",
		type: "enum",
		default: "match",
		options: [
			{ value: "match", label: "Match the remote port" },
			{ value: "range", label: "Use the local range" },
		],
	},
	{
		key: "local_port_range_start",
		page: "connections",
		scopes: ["user"],
		title: "Local port range",
		description:
			"The first local port a cloud forward may use when it does not match the remote port.",
		searchTerms: ["forward", "port", "range", "cloud", "first"],
		feature: "CLOUD-10",
		type: "number",
		default: 20_000,
		min: 1_024,
		max: 65_535,
	},
	{
		key: "local_port_range_end",
		page: "connections",
		scopes: ["user"],
		title: "Local port range end",
		description: "The last local port a cloud forward may use.",
		searchTerms: ["forward", "port", "range", "cloud", "last"],
		feature: "CLOUD-10",
		type: "number",
		default: 29_999,
		min: 1_024,
		max: 65_535,
	},
	{
		key: "port_mappings",
		page: "connections",
		scopes: ["user"],
		title: "Manual overrides",
		description: "Map a remote port to a local port, one per line as remote:local.",
		searchTerms: ["forward", "port", "mapping", "override", "cloud"],
		feature: "CLOUD-10",
		type: "string-list",
		default: [],
	},
	{
		key: "exclusive_port_forwarding_enabled",
		page: "connections",
		scopes: ["user"],
		title: "Exclusive port forwarding",
		description: "Turning on port forwarding in one workspace turns it off everywhere else.",
		searchTerms: ["forward", "port", "exclusive", "cloud", "one"],
		feature: "CLOUD-10",
		type: "bool",
		default: false,
	},
	// Our design choice: unchecked by default, so resetting the chat alone cannot lose files by accident.
	{
		key: "reset_chat_also_reset_files",
		page: "state",
		scopes: ["user"],
		title: "Reset chat also resets files",
		description:
			"Whether Reset chat also restores the working tree to the turn's start checkpoint.",
		searchTerms: ["reset", "revert", "checkpoint", "files"],
		feature: "CHAT-15",
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

/** The line a settings page shows under a row's title, or null where Conductor's row has none. */
export function pageDescriptionOf(def: SettingDef): string | null {
	return def.pageDescription === false ? null : def.description;
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

/** One entry of a raw preview URL list: an object with a URL, or a plain URL string. */
function previewUrlsFromArray(raw: readonly unknown[]): PreviewUrlEntry[] | null {
	const entries: PreviewUrlEntry[] = [];
	for (const item of raw) {
		if (typeof item === "string") {
			const url = item.trim();
			if (url !== "") entries.push({ name: "", url });
			continue;
		}
		if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
		const record = item as Record<string, unknown>;
		if (typeof record.url !== "string") return null;
		const url = record.url.trim();
		if (url === "") continue;
		entries.push({ name: typeof record.name === "string" ? record.name.trim() : "", url });
	}
	return entries;
}

/**
 * Reads a preview URL setting. Conductor stores a JSON string of `{name, url}` entries; a plain
 * string (one URL) and a list of strings (an older file) still read as URLs with no name.
 */
export function previewUrlsFrom(raw: unknown): PreviewUrlEntry[] | null {
	if (typeof raw === "string") {
		const text = raw.trim();
		if (text === "") return [];
		if (text.startsWith("[")) {
			try {
				const parsed: unknown = JSON.parse(text);
				if (Array.isArray(parsed)) return previewUrlsFromArray(parsed);
			} catch {
				// A plain URL that starts with "[" is kept as one entry, as Conductor does.
			}
		}
		return [{ name: "", url: text }];
	}
	if (Array.isArray(raw)) return previewUrlsFromArray(raw);
	return null;
}

/** Writes the setting as Conductor does: one JSON string, or an empty string for no entries. */
export function previewUrlsToText(entries: readonly PreviewUrlEntry[]): string {
	const cleaned = entries
		.map((entry) => ({ name: entry.name.trim(), url: entry.url.trim() }))
		.filter((entry) => entry.url !== "");
	return cleaned.length === 0 ? "" : JSON.stringify(cleaned);
}

/**
 * Checks a raw value against a setting and returns it in the right type.
 * The settings table stores text, so bool accepts "true" and "false", number accepts numeric text,
 * and string-list accepts one entry per line. Preview URLs accept Conductor's JSON string, a plain
 * string or a list of strings, and are returned as the JSON string. Null means "no value set" and
 * is always accepted.
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
		case "preview-urls": {
			const entries = previewUrlsFrom(raw);
			if (entries === null) return invalid(def, "must be a list of preview URLs");
			return ok(previewUrlsToText(entries));
		}
	}
}
