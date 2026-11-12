/**
 * @feature catalogue States of the settings pages
 * Owns: every settings page, the personal ones and atlas's repository pages, with the cast's two
 * projects in the navigation; the settings search results that show Conductor's search copy; the
 * selects whose options are wording (themes, sounds, effort levels,
 * output styles, the send key, the follow-up behaviour, where pull requests open), each open; the
 * Git page with a custom branch prefix; the Advanced page asking before it changes the root
 * folder; the Agents page's MCP servers for the chat last open; the Environment page's documented
 * variables; atlas's Add action dialog and icon picker; the Agents page's provider forms (Anthropic,
 * subscription, Vertex, both Bedrock modes, ChatGPT, Cursor, custom), its card badges and both
 * sign-in dialogs; a changed setting's actions menu; the Connect GitHub and disconnect dialogs; the
 * environment file picker, variable editor, import banner and local-override table; the MCP
 * list loading, empty, filtered and failed; a subscription token saved and an Anthropic key taken
 * from this Mac; Appearance with a custom code font; and a project's
 * Actions page with no actions, and with
 * a hidden shared action, a personal action and a shared one changed on this Mac.
 * Behaviour: ui-map.md 6 (settings pages).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { chatRoute, seedCast } from "../cast.ts";
import { seedConductorDatabase } from "../conductor-database.ts";
import { click, fillIn, find, findFirst, has, shows, typeInto } from "../dom.ts";
import { scriptGitHub } from "../github.ts";
import { setSetting } from "../seeds.ts";
import type { CatalogueState } from "../state.ts";
import type { World } from "../world.ts";

const page = (id: string, title: string, page: string, text: string): CatalogueState => ({
	id,
	group: "Settings",
	title,
	seed: async (world) => {
		await seedCast(world);
		return { route: `/settings/user/${page}`, ready: (document) => shows(document, text) };
	},
});

/** One of atlas's repository settings pages. */
const repoPage = (id: string, title: string, page: string, text: string): CatalogueState => ({
	id,
	group: "Settings",
	title,
	seed: async (world) => {
		const cast = await seedCast(world);
		return {
			route: `/settings/repos/${cast.atlas.id}/${page}`,
			ready: (document) => shows(document, text),
		};
	},
});

/** The settings search box with a query typed, showing Conductor's search copy for a setting. */
const searchState = (id: string, title: string, query: string, shown: string): CatalogueState => ({
	id,
	group: "Settings",
	title,
	seed: async (world) => {
		await seedCast(world);
		return {
			route: "/settings/user/general",
			after: ({ document }) => typeInto(document, "input", "Search settings", query),
			ready: (document) => shows(document, shown),
		};
	},
});

/** One of atlas's repository settings pages while settings search holds a query. */
const repoSearchState = (
	id: string,
	title: string,
	page: string,
	query: string,
	shown: string,
): CatalogueState => ({
	id,
	group: "Settings",
	title,
	seed: async (world) => {
		const cast = await seedCast(world);
		return {
			route: `/settings/repos/${cast.atlas.id}/${page}`,
			after: ({ document }) => typeInto(document, "input", "Search settings", query),
			ready: (document) => shows(document, shown),
		};
	},
});

/** The Agents page while the sidecar has not said which agents are installed, or when it fails to. */
const agentsWhile = (mode: "hold" | "fail"): CatalogueState => ({
	id: mode === "hold" ? "settings-agents-loading" : "settings-agents-error",
	group: "Settings",
	title:
		mode === "hold" ? "Agents, still loading" : "Agents, when the sidecar fails to answer (error)",
	seed: async (world) => {
		await seedCast(world);
		if (mode === "hold") world.holdSidecar("getAgentInstalls");
		else world.failSidecar("getAgentInstalls");
		return { route: "/settings/user/agents" };
	},
});

/**
 * Opens a select by keyboard and waits for its popup. A select keeps its options in a hidden native
 * list, so only the open popup draws them, and a pointer release where the press began is ignored.
 */
async function openSelect(document: Document, name: string): Promise<void> {
	const trigger = await find(document, "button", name);
	trigger.focus();
	trigger.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
	);
}

async function choose(document: Document, select: string, option: string): Promise<void> {
	await openSelect(document, select);
	const item = await find(document, "[role=option]", option);
	item.focus();
	item.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
	);
}

/** A settings page with one registry setting's select open. */
const selectOpen = (id: string, title: string, page: string, control: string): CatalogueState => ({
	id,
	group: "Settings",
	title,
	seed: async (world) => {
		await seedCast(world);
		return {
			route: `/settings/user/${page}`,
			after: ({ document }) => openSelect(document, control),
			ready: (document) => document.querySelector("[role=listbox]") !== null,
		};
	},
});

/**
 * A Conductor database with one project this Mac already has (atlas), one it does not (tern), their
 * workspaces and chats, a section, a favourite model and two settings, for the import's dialog.
 */
async function seedConductorImport(world: World): Promise<void> {
	const cast = await seedCast(world);
	const tern = "/Users/sam/conductor/repos/tern";
	world.memory.controls.addFolder(tern);
	world.memory.controls.addFolder("/Users/sam/conductor/workspaces/tern/lisbon");
	await seedConductorDatabase(world, {
		repos: [
			{ id: "c-atlas", name: "atlas", root_path: cast.atlas.rootPath, default_branch: "main" },
			{ id: "c-tern", name: "tern", root_path: tern, default_branch: "main", display_order: 1 },
		],
		workspaces: [
			{
				local_id: "c-lisbon",
				repository_id: "c-tern",
				directory_name: "lisbon",
				branch: "sam/lisbon",
				state: "ready",
				workspace_name: "Task runner flags",
			},
			{
				local_id: "c-porto",
				repository_id: "c-tern",
				directory_name: "porto",
				branch: "sam/porto",
				state: "archived",
				archive_commit: "4f1c2ab",
			},
		],
		sessions: [
			{
				id: "c-s1",
				workspace_id: "c-lisbon",
				agent_type: "claude",
				model: "opus",
				title: "Add --dry-run",
			},
			{
				id: "c-s2",
				workspace_id: "c-lisbon",
				agent_type: "codex",
				model: "gpt-5",
				title: "Review flags",
			},
		],
		settings: [
			{ key: "default_model", value: "opus" },
			{ key: "onboarding_step", value: "done" },
		],
	});
}

/** Opens an agent's API-key provider form on the Agents page, optionally on another tab. */
async function openProviders(
	document: Document,
	tab: string | null,
	choice?: string,
): Promise<void> {
	if (tab !== null) await click(document, "[role=tab]", tab);
	await click(document, "button", "API key");
	if (choice !== undefined) await choose(document, "Provider", choice);
}

/** Stores one environment variable and its Keychain value, as the Environment page would. */
async function seedEnvVar(world: World, name: string, value: string | null): Promise<void> {
	const keychainRef = `env:global:${name}`;
	if (value !== null) world.memory.controls.secrets.set(keychainRef, value);
	const stored = await world.repositories.envVars.set({
		name,
		scope: "global",
		repoId: null,
		keychainRef,
	});
	if (!stored.ok) throw new Error(stored.error.message);
}

export const SETTINGS_STATES: CatalogueState[] = [
	page("settings-general", "General", "general", "General"),
	// Settings search results, which draw Conductor's search copy for a setting or page.
	searchState(
		"settings-search-mono-font",
		"Settings search: Mono Font",
		"mono font geist monospace",
		"Font used for code and diffs.",
	),
	searchState(
		"settings-search-terminal-font",
		"Settings search: Terminal font",
		"terminal font family size",
		"Font family and size for the terminal.",
	),
	searchState(
		"settings-search-code-theme",
		"Settings search: Code theme",
		"syntax highlighting theme",
		"Syntax highlighting theme for code and diffs.",
	),
	searchState(
		"settings-search-markdown",
		"Settings search: Markdown Style",
		"rendering style for markdown files",
		"Rendering style for markdown files.",
	),
	searchState(
		"settings-search-appearance",
		"Settings search: Appearance settings",
		"appearance typography",
		"Theme, typography, color, and editor appearance.",
	),
	searchState(
		"settings-search-agent-settings",
		"Settings search: Agent settings",
		"agent settings",
		"Configure Claude Code, Codex, Cursor, and ACP agents.",
	),
	searchState(
		"settings-search-claude-harness",
		"Settings search: Claude Code harness",
		"claude harness provider",
		"Configure Claude Code authentication and behavior.",
	),
	searchState(
		"settings-search-codex-harness",
		"Settings search: Codex harness",
		"codex harness provider",
		"Configure Codex authentication and behavior.",
	),
	searchState(
		"settings-search-cursor-harness",
		"Settings search: Cursor harness",
		"cursor harness provider",
		"Configure Cursor authentication and behavior.",
	),
	searchState(
		"settings-search-environment",
		"Settings search: Environment settings",
		"environment variables preview urls",
		"Environment variables, files, and preview URLs.",
	),
	repoSearchState(
		"settings-search-repository-scripts",
		"atlas: Settings search: Repository scripts",
		"scripts",
		"scripts setup archive repository",
		"Setup and archive scripts for the selected repository.",
	),
	page(
		"settings-agents",
		"Agents: Claude Code and Codex installed and signed in",
		"agents",
		"Codex",
	),
	agentsWhile("hold"),
	agentsWhile("fail"),
	{
		id: "settings-agents-loaded-from-env",
		group: "Settings",
		title: "Agents: Claude Code found on the login shell's PATH",
		seed: async (world) => {
			await seedCast(world);
			world.answerSidecar({
				getAgentInstalls: () => ({
					agents: [
						{
							agent: "claude",
							installed: true,
							path: "/opt/homebrew/bin/claude",
							source: "login_path",
							version: "2.1.30",
							authenticated: true,
						},
					],
				}),
			});
			return {
				route: "/settings/user/agents",
				ready: (document) => shows(document, "Loaded from env"),
			};
		},
	},
	{
		id: "settings-agents-api-key",
		group: "Settings",
		title: "Agents: Codex signed in with an API key",
		seed: async (world) => {
			await seedCast(world);
			world.answerSidecar({
				getAgentInstalls: () => ({
					agents: [
						{
							agent: "codex",
							installed: true,
							path: "/Users/sam/Library/Application Support/Conducted/bin/codex",
							source: "managed",
							version: "0.98.0",
							authenticated: true,
							authMethod: "api_key",
						},
					],
				}),
			});
			return {
				route: "/settings/user/agents",
				after: ({ document }) => click(document, "[role=tab]", "Codex"),
				ready: (document) => shows(document, "API key configured"),
			};
		},
	},
	{
		id: "settings-agents-validation",
		group: "Settings",
		title: "Agents: Cursor's program failed its version check",
		seed: async (world) => {
			await seedCast(world);
			world.answerSidecar({
				getAgentInstalls: () => ({
					agents: [
						{
							agent: "cursor",
							installed: true,
							path: "/Applications/Cursor.app",
							version: "0.44.0",
							authenticated: false,
							warning: "This version of Cursor cannot start a chat.",
						},
					],
				}),
			});
			return {
				route: "/settings/user/agents",
				after: ({ document }) => click(document, "[role=tab]", "Cursor"),
				ready: (document) => shows(document, "Validation failed"),
			};
		},
	},
	{
		id: "settings-agents-claude-login",
		group: "Settings",
		title: "Agents: Claude Code's sign-in dialog, with its setup token command",
		seed: async (world) => {
			await seedCast(world);
			world.answerSidecar({
				getAgentInstalls: () => ({
					agents: [
						{
							agent: "claude",
							installed: true,
							path: "/Users/sam/Library/Application Support/Conducted/bin/claude",
							source: "managed",
							version: "2.1.30",
							authenticated: false,
						},
					],
				}),
				startAgentLogin: () => ({
					loginId: "catalogue-claude",
					command: "claude setup-token",
					instructions: "Run claude setup-token, then paste the token.",
				}),
			});
			world.holdSidecar("finishAgentLogin");
			return {
				route: "/settings/user/agents",
				after: ({ document }) => click(document, "button", "Run claude /login", { prefix: true }),
				ready: (document) => shows(document, "Paste code from Claude"),
			};
		},
	},
	{
		id: "settings-agents-codex-login",
		group: "Settings",
		title: "Agents: Codex's ChatGPT device-code sign-in steps",
		seed: async (world) => {
			await seedCast(world);
			world.answerSidecar({
				getAgentInstalls: () => ({
					agents: [
						{
							agent: "codex",
							installed: true,
							path: "/Users/sam/Library/Application Support/Conducted/bin/codex",
							source: "managed",
							version: "0.98.0",
							authenticated: false,
						},
					],
				}),
				startAgentLogin: () => ({
					loginId: "catalogue-codex",
					url: "https://auth.openai.com/codex/device",
					userCode: "ABCD-1234",
					verificationUrl: "https://auth.openai.com/codex/device",
					instructions: "Enter the code on OpenAI's page.",
				}),
			});
			world.holdSidecar("finishAgentLogin");
			return {
				route: "/settings/user/agents",
				after: ({ document }) => click(document, "button", "Run codex login", { prefix: true }),
				ready: (document) => shows(document, "Enter this code when OpenAI asks for it:"),
			};
		},
	},
	{
		id: "settings-agents-anthropic",
		group: "Settings",
		title: "Agents: Claude Code's Anthropic API key form",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/agents",
				after: ({ document }) => openProviders(document, null, "Anthropic API key"),
				ready: (document) => shows(document, "Use the key from this Mac"),
			};
		},
	},
	{
		id: "settings-agents-key-imported",
		group: "Settings",
		title: "Agents: Claude Code's Anthropic API key taken from this Mac",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/agents",
				after: async ({ document }) => {
					await openProviders(document, null, "Anthropic API key");
					await click(document, "label", "Use the key from this Mac");
					await click(document, "button", "Save", { prefix: true });
				},
				ready: (document) => shows(document, "API key imported from env"),
			};
		},
	},
	{
		id: "settings-agents-subscription-saved",
		group: "Settings",
		title: "Agents: Claude Code's subscription token entered and saved",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/agents",
				after: async ({ document }) => {
					await openProviders(document, null);
					const field = await findFirst(document, '[role=dialog] input[type="password"]');
					if (!(field instanceof HTMLInputElement)) throw new Error("No token field.");
					fillIn(field, "sk-ant-oat01-sample-token");
					await click(document, "button", "Save", { prefix: true });
				},
				ready: (document) =>
					shows(document, "Connected with a setup token.") && shows(document, "API key saved"),
			};
		},
	},
	{
		id: "settings-agents-subscription",
		group: "Settings",
		title: "Agents: Claude Code's subscription token form",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/agents",
				after: ({ document }) => openProviders(document, null),
				ready: (document) => shows(document, "Run claude setup-token"),
			};
		},
	},
	{
		id: "settings-agents-vertex",
		group: "Settings",
		title: "Agents: Claude Code's Google Vertex AI form",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/agents",
				after: ({ document }) => openProviders(document, null, "Google Vertex AI"),
				ready: (document) => shows(document, "Vertex project"),
			};
		},
	},
	{
		id: "settings-agents-bedrock-api-key",
		group: "Settings",
		title: "Agents: Claude Code's Amazon Bedrock form with a Bedrock API key",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/agents",
				after: ({ document }) => openProviders(document, null, "Amazon Bedrock"),
				ready: (document) => shows(document, "Bedrock API key"),
			};
		},
	},
	{
		id: "settings-agents-codex-chatgpt",
		group: "Settings",
		title: "Agents: Codex's ChatGPT account choice",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/agents",
				after: ({ document }) => openProviders(document, "Codex", "ChatGPT account"),
				ready: (document) => shows(document, "Sign in with ChatGPT"),
			};
		},
	},
	{
		id: "settings-agents-cursor",
		group: "Settings",
		title: "Agents: Cursor's API key form",
		seed: async (world) => {
			await seedCast(world);
			world.answerSidecar({
				getAgentInstalls: () => ({
					agents: [
						{
							agent: "cursor",
							installed: true,
							path: "/Applications/Cursor.app",
							version: "0.44.0",
							authenticated: false,
						},
					],
				}),
			});
			return {
				route: "/settings/user/agents",
				after: ({ document }) => openProviders(document, "Cursor"),
				ready: (document) => shows(document, "Cursor API key"),
			};
		},
	},
	{
		id: "settings-agents-custom",
		group: "Settings",
		title: "Agents: Claude Code's custom provider form",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/agents",
				after: ({ document }) => openProviders(document, null, "Custom provider"),
				ready: (document) => shows(document, "Workspace ID (optional)"),
			};
		},
	},
	{
		id: "settings-setting-actions-menu",
		group: "Settings",
		title: "General, a changed setting's actions menu open",
		seed: async (world) => {
			await seedCast(world);
			// Queue is the one value besides the default, steer; a value outside the options is dropped on load.
			await setSetting(world, "default_message_send_mode", "queue");
			return {
				route: "/settings/user/general",
				after: ({ document }) => click(document, "button", "Setting actions"),
				ready: (document) => shows(document, "Reset"),
			};
		},
	},
	{
		id: "settings-account-connect-github",
		group: "Settings",
		title: "Account: the Connect GitHub dialog when gh is not signed in",
		seed: async (world) => {
			await seedCast(world);
			world.scriptShell(scriptGitHub({ signedOut: true }));
			return {
				route: "/settings/user/account",
				after: ({ document }) => click(document, "button", "Connect"),
				ready: (document) => shows(document, "This action needs GitHub access."),
			};
		},
	},
	{
		id: "settings-environment-add-file",
		group: "Settings",
		title: "atlas: Environment, adding an env file with the system picker",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/settings/repos/${cast.atlas.id}/environment`,
				after: ({ document }) => click(document, "button", "Add env file"),
				ready: (document) => shows(document, "Cancel adding env file"),
			};
		},
	},
	{
		id: "settings-environment-edit-variable",
		group: "Settings",
		title: "Environment, editing a variable's value",
		seed: async (world) => {
			await seedCast(world);
			await seedEnvVar(world, "ANTHROPIC_API_KEY", "sk-ant-example");
			return {
				route: "/settings/user/environment",
				after: ({ document }) => click(document, "button", "Edit ANTHROPIC_API_KEY"),
				ready: (document) =>
					document.querySelector(
						'textarea[placeholder="Use an empty value to set this variable to an empty string."]',
					) !== null,
			};
		},
	},
	{
		id: "settings-environment-values",
		group: "Settings",
		title: "atlas: Environment, a value, an unset variable and a local override",
		seed: async (world) => {
			const cast = await seedCast(world);
			await seedEnvVar(world, "ANTHROPIC_API_KEY", "sk-ant-example");
			const stored = await world.repositories.envVars.set({
				name: "ANTHROPIC_API_KEY",
				scope: "repo",
				repoId: cast.atlas.id,
				keychainRef: `env:repo:${cast.atlas.id}:ANTHROPIC_API_KEY`,
			});
			if (!stored.ok) throw new Error(stored.error.message);
			world.memory.controls.secrets.set(
				`env:repo:${cast.atlas.id}:ANTHROPIC_API_KEY`,
				"sk-ant-local",
			);
			return {
				route: `/settings/repos/${cast.atlas.id}/environment`,
				after: ({ document }) =>
					click(document, "button", "Show documented variables", { prefix: true }),
				ready: (document) => shows(document, "Locally overwritten"),
			};
		},
	},
	{
		id: "settings-agents-no-match",
		group: "Settings",
		title: "Agents: a provider search with no match",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/agents",
				after: ({ document }) => typeInto(document, "input", "Search providers", "kilo"),
				ready: (document) => shows(document, "No providers match your search."),
			};
		},
	},
	{
		id: "settings-account-disconnect-github",
		group: "Settings",
		title: "Account: asking before GitHub's token is removed",
		seed: async (world) => {
			await seedCast(world);
			world.memory.controls.secrets.set("gh_pat_token", "ghp_catalogue_token");
			return {
				route: "/settings/user/account",
				after: async ({ document }) => {
					await click(document, "button", "Manage");
					await click(document, "button", "Disconnect GitHub");
				},
				ready: (document) => shows(document, "Disconnect GitHub?"),
			};
		},
	},
	{
		id: "settings-environment-import",
		group: "Settings",
		title: "atlas: Environment, the banner that imports a dotenv file",
		seed: async (world) => {
			const cast = await seedCast(world);
			world.memory.controls.files.set(`${cast.atlas.rootPath}/.env`, "TOKEN=secret\n");
			return {
				route: `/settings/repos/${cast.atlas.id}/environment`,
				ready: (document) => shows(document, "Import local variables"),
			};
		},
	},
	{
		id: "settings-mcp-loading",
		group: "Settings",
		title: "Agents, the MCP servers still loading",
		seed: async (world) => {
			const cast = await seedCast(world);
			world.holdSidecar("listMcpServers");
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await find(document, "button", "MCP status");
					await app.router.navigate({ to: "/settings/user/$page", params: { page: "agents" } });
				},
				ready: (document) => shows(document, "Loading MCP servers"),
			};
		},
	},
	{
		id: "settings-mcp-empty",
		group: "Settings",
		title: "Agents, the MCP list with no servers",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await find(document, "button", "MCP status");
					await app.router.navigate({ to: "/settings/user/$page", params: { page: "agents" } });
				},
				ready: (document) => shows(document, "No MCP servers configured."),
			};
		},
	},
	{
		id: "settings-mcp-no-match",
		group: "Settings",
		title: "Agents, an MCP filter with no match",
		seed: async (world) => {
			const cast = await seedCast(world);
			world.answerSidecar({
				listMcpServers: () => ({
					servers: [{ name: "github", status: "connected", scope: "user", transport: "http" }],
				}),
			});
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await find(document, "button", "MCP status");
					await app.router.navigate({ to: "/settings/user/$page", params: { page: "agents" } });
					await typeInto(document, "input", "Search MCP servers", "nothing");
				},
				ready: (document) => shows(document, "No matching MCP servers."),
			};
		},
	},
	{
		id: "settings-mcp-error",
		group: "Settings",
		title: "Agents, the MCP servers when the sidecar fails",
		seed: async (world) => {
			const cast = await seedCast(world);
			world.failSidecar("listMcpServers");
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await find(document, "button", "MCP status");
					await app.router.navigate({ to: "/settings/user/$page", params: { page: "agents" } });
				},
				ready: (document) => shows(document, "Couldn't load MCP servers"),
			};
		},
	},
	page("settings-account", "Account", "account", "Account"),
	page("settings-appearance", "Appearance", "appearance", "Appearance"),
	{
		id: "settings-appearance-custom-font",
		group: "Settings",
		title: "Appearance, with a custom code font",
		seed: async (world) => {
			await seedCast(world);
			await setSetting(world, "mono_font", "Berkeley Mono");
			return {
				route: "/settings/user/appearance",
				ready: (document) => shows(document, "Enter font name exactly as installed on your system"),
			};
		},
	},
	page("settings-key-bindings", "Keyboard shortcuts", "key-bindings", "Keyboard shortcuts"),
	page("settings-default-models", "Default models", "models", "Default models"),
	page("settings-git", "Git", "git", "Branch name prefix"),
	page("settings-connections", "Connections", "connections", "Connections"),
	page(
		"settings-cloud",
		"Cloud: the Worker, its deploy and pairing, and cloud variables",
		"cloud",
		"Deploy to Cloudflare",
	),
	page("settings-environment", "Environment", "environment", "Environment"),
	page("settings-remote-control", "Remote control", "remote-control", "Remote control"),
	page("settings-experimental", "Experimental", "experimental", "Experimental"),
	page("settings-advanced", "Advanced", "advanced", "Advanced"),
	selectOpen(
		"settings-general-sound-menu",
		"General, the completion sound menu open",
		"general",
		"Completion sound",
	),
	selectOpen(
		"settings-appearance-code-theme-menu",
		"Appearance, the code theme menu open",
		"appearance",
		"Code theme",
	),
	selectOpen(
		"settings-appearance-colors-menu",
		"Appearance, the accessible colours menu open",
		"appearance",
		"Accessible colors",
	),
	selectOpen(
		"settings-appearance-markdown-menu",
		"Appearance, the Markdown style menu open",
		"appearance",
		"Markdown Style",
	),
	selectOpen(
		"settings-models-style-menu",
		"Default models, the Claude output style menu open",
		"models",
		"Claude output style",
	),
	{
		// The default's effort is the Loadout's first slot's, as in Conductor: its menu holds it.
		id: "settings-models-effort-menu",
		group: "Settings",
		title: "Default models, the default slot's menu open with its effort",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/models",
				after: ({ document }) => click(document, "button", "Claude Code", { prefix: true }),
				ready: (document) => document.querySelector("[role=menu]") !== null,
			};
		},
	},
	selectOpen(
		"settings-models-codex-thinking-menu",
		"Default models, the Codex thinking level menu open",
		"models",
		"Codex thinking level",
	),
	selectOpen(
		"settings-models-personality-menu",
		"Default models, the Codex personality menu open",
		"models",
		"Codex personality",
	),
	{
		id: "settings-agents-bedrock",
		group: "Settings",
		title: "Agents: Claude Code's providers dialog, Amazon Bedrock with AWS access keys",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/agents",
				after: async ({ document }) => {
					await click(document, "button", "API key");
					await choose(document, "Provider", "Amazon Bedrock");
					await choose(document, "Bedrock credentials", "AWS access keys");
				},
				ready: (document) => shows(document, "Secret access key"),
			};
		},
	},
	selectOpen(
		"settings-general-send-key-menu",
		"General, the send key menu open",
		"general",
		"Send messages with",
	),
	selectOpen(
		"settings-general-follow-up-menu",
		"General, the follow-up behaviour menu open",
		"general",
		"Follow-up behavior",
	),
	selectOpen(
		"settings-git-pr-target-menu",
		"Git, the menu of where pull requests open",
		"git",
		"Open pull requests in",
	),
	{
		id: "settings-git-delete-branch-warning",
		group: "Settings",
		title: "Git, delete branch on archive turned on, with Conductor's warning",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/git",
				after: ({ document }) => click(document, "[role=switch]", "Delete branch on archive"),
				ready: (document) => shows(document, "Warning: archived workspaces will be unrecoverable"),
			};
		},
	},
	{
		id: "settings-git-custom-prefix",
		group: "Settings",
		title: "Git, with a custom branch prefix not typed yet",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/git",
				after: ({ document }) => click(document, "label", "Custom"),
				ready: (document) =>
					document.querySelector('input[placeholder="e.g. feature/ or myname-"]') !== null,
			};
		},
	},
	{
		id: "settings-advanced-root-path",
		group: "Settings",
		title: "Advanced, asking before the root folder changes",
		seed: async (world) => {
			await seedCast(world);
			world.memory.controls.queueDialogAnswers({ folder: "/Users/sam/Projects/conducted" });
			return {
				route: "/settings/user/advanced",
				after: ({ document }) => click(document, "button", "Browse"),
				ready: (document) => shows(document, "Change root path?"),
			};
		},
	},
	{
		id: "settings-repo-add-action",
		group: "Settings",
		title: "atlas: Actions, the Add action dialog",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/settings/repos/${cast.atlas.id}/actions`,
				after: ({ document }) => click(document, "button", "Add"),
				ready: (document) => document.querySelector('input[placeholder="My action"]') !== null,
			};
		},
	},
	{
		id: "settings-repo-actions-empty",
		group: "Settings",
		title: "relay: Actions, with no actions yet",
		seed: async (world) => {
			const cast = await seedCast(world);
			// relay shares no settings file, so it has no run actions.
			world.memory.controls.files.delete(`${cast.relay.rootPath}/.conducted/settings.toml`);
			return {
				route: `/settings/repos/${cast.relay.id}/actions`,
				ready: (document) => shows(document, "No custom actions yet. Add one to get started."),
			};
		},
	},
	{
		id: "settings-repo-actions-own",
		group: "Settings",
		title: "atlas: Actions, one hidden, one personal and one changed on this Mac",
		seed: async (world) => {
			const cast = await seedCast(world);
			const repoId = cast.atlas.id;
			return {
				route: `/settings/repos/${repoId}/actions`,
				after: async ({ app, document }) => {
					const { actions, services } = app.container;
					const loaded = await services.repo.loadConfig(repoId);
					if (!loaded.ok)
						throw new Error(`Loading atlas's settings failed: ${loaded.error.message}`);
					const shared = loaded.value.runScripts;
					const dev = shared.find((action) => action.id === "dev");
					if (dev === undefined) throw new Error("atlas has no dev action.");
					const saved = await actions.projects.updateConfig(repoId, {
						...loaded.value,
						runScripts: [
							...shared.map((action) =>
								action.id === "dev" ? { ...action, command: "pnpm dev --port 4000" } : action,
							),
							{ ...dev, id: "lint", label: "Lint", command: "pnpm lint", isDefault: false },
						],
					});
					if (!saved.ok) throw new Error(`Saving atlas's actions failed: ${saved.error.message}`);
					// The user hides the first action from the list.
					await click(document, "button", "Hide action");
				},
				ready: (document) =>
					has(document, "button", "Show action") &&
					has(document, "button", "Delete action") &&
					document.querySelector(`[title="Reset to your repo's settings.toml"]`) !== null,
			};
		},
	},
	{
		id: "settings-environment-documented",
		group: "Settings",
		title: "Environment, the documented variables shown",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/environment",
				after: ({ document }) =>
					click(document, "button", "Show documented variables", { prefix: true }),
				ready: (document) => shows(document, "Routes HTTP requests through a proxy."),
			};
		},
	},
	{
		id: "settings-repo-icon-picker",
		group: "Settings",
		title: "atlas: Misc, the repository icon picker",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/settings/repos/${cast.atlas.id}/misc`,
				after: ({ document }) => click(document, "button", "Change repository icon"),
				ready: (document) => document.querySelector('input[placeholder="Search emoji"]') !== null,
			};
		},
	},
	{
		// MCP status is per chat: the Agents page lists the servers of the chat last on screen.
		id: "settings-agents-mcp",
		group: "Settings",
		title:
			"Agents, the MCP servers of arbor's chat: connected, needing sign-in, failed, turned off",
		seed: async (world) => {
			const cast = await seedCast(world);
			world.answerSidecar({
				listMcpServers: () => ({
					servers: [
						{
							name: "github",
							status: "connected",
							toolCount: 41,
							scope: "user",
							transport: "http",
						},
						{ name: "linear", status: "needs_auth", scope: "user", transport: "http" },
						{
							name: "postgres",
							status: "failed",
							scope: "project",
							transport: "stdio",
							error: "connect ECONNREFUSED 127.0.0.1:5432",
						},
						{ name: "sentry", status: "disabled", scope: "plugin", transport: "sse" },
					],
				}),
			});
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await find(document, "button", "MCP status");
					await app.router.navigate({ to: "/settings/user/$page", params: { page: "agents" } });
					// The servers sit below the agent's own settings; scroll them into view.
					await find(document, "td,span,p", "Needs auth");
					const servers = await find(document, "section", "MCP servers");
					servers.scrollIntoView({ block: "start" });
				},
				ready: (document) => shows(document, "Needs auth"),
			};
		},
	},
	repoPage("settings-repo-git", "atlas: Git", "git", "Remote origin"),
	repoPage("settings-repo-environment", "atlas: Environment", "environment", "Env files"),
	repoPage("settings-repo-scripts", "atlas: Scripts", "scripts", "Setup script"),
	repoPage("settings-repo-actions", "atlas: Actions", "actions", "Code review preferences"),
	repoPage("settings-repo-misc", "atlas: Misc", "misc", "Misc"),
	{
		id: "settings-conductor-import-dry-run",
		group: "Settings",
		title: "General: Import from Conductor, the dry run",
		seed: async (world) => {
			await seedConductorImport(world);
			return {
				route: "/settings/user/general",
				after: ({ document }) => click(document, "button", "Review import"),
				ready: (document) => shows(document, "Comes over"),
			};
		},
	},
	{
		id: "settings-conductor-import-done",
		group: "Settings",
		title: "General: Import from Conductor, finished",
		seed: async (world) => {
			await seedConductorImport(world);
			return {
				route: "/settings/user/general",
				after: async ({ document }) => {
					await click(document, "button", "Review import");
					// Import stays disabled until the dry run is on screen.
					await find(document, "th", "Comes over");
					await click(document, "button", "Import");
				},
				ready: (document) => shows(document, "Done"),
			};
		},
	},
];
