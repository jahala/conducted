/**
 * @feature catalogue States of the settings pages
 * Owns: every settings page, the personal ones and atlas's repository pages, with the cast's two
 * projects in the navigation; the settings search results that show Conductor's search copy; the
 * selects whose options are wording (themes, sounds, effort levels,
 * output styles, the send key, the follow-up behaviour, where pull requests open), each open; the
 * Git page with a custom branch prefix, and with Conductor's toasts for a switch that cannot be
 * saved, for a settings file that does not parse, and for one that does not parse after an earlier
 * save, which offers "Overwrite file"; the Advanced page asking before it changes the root
 * folder, and Home after it changed; the MCP page with OAuth servers in each state (CLOUD-17); the Agents page's MCP servers for the chat last open; the Environment page's documented
 * variables; atlas's Add action dialog and icon picker (an emoji search with no match, the Favicon source); the Agents page's provider forms (Anthropic,
 * subscription, Vertex, both Bedrock modes, ChatGPT, Cursor, custom), OpenCode's Providers dialog
 * searched (its matches in the open Provider select, and no match), its card badges and both
 * sign-in dialogs; a changed setting's actions menu; the Connect GitHub and disconnect dialogs; the
 * environment file picker, variable editor, import banner and local-override table; the MCP
 * list loading, empty, filtered and failed; a subscription token saved and an Anthropic key taken
 * from this Mac; a shortcut being recorded; Appearance with a custom code font; and a project's
 * Actions page with no actions, and with
 * a hidden shared action, a personal action and a shared one changed on this Mac; the import
 * from Conductor's dry run, its end, and a disk without the space chat history takes (D132); and
 * atlas's Misc page when its settings file cannot be read.
 * Behaviour: ui-map.md 6 (settings pages).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { agentProviders } from "@conducted/protocol";
import { type EventId, ok, type TurnId } from "@conducted/shared";
import { chatRoute, seedCast } from "../cast.ts";
import { type ConductorRows, seedConductorDatabase } from "../conductor-database.ts";
import { click, fillIn, find, findField, findFirst, has, shows, typeInto } from "../dom.ts";
import { scriptGitHub } from "../github.ts";
import { addRepo, setSetting } from "../seeds.ts";
import { waitFor } from "../settle.ts";
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
 * `more` adds rows to its tables.
 */
async function seedConductorImport(world: World, more: ConductorRows = {}): Promise<void> {
	const cast = await seedCast(world);
	const tern = "/Users/sam/conductor/repos/tern";
	world.memory.controls.addFolder(tern);
	world.memory.controls.addFolder("/Users/sam/conductor/workspaces/tern/lisbon");
	const rows: ConductorRows = {
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
	};
	for (const [table, extra] of Object.entries(more)) {
		rows[table] = [...(rows[table] ?? []), ...(extra ?? [])];
	}
	await seedConductorDatabase(world, rows);
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

/**
 * The Agents page with OpenCode installed, its Providers dialog open on the catalogue the sidecar
 * sends (the protocol's own list) and `query` typed into "Search providers".
 */
const opencodeProvidersSearch = (
	id: string,
	title: string,
	query: string,
	ready: (document: Document) => boolean,
	afterSearch?: (document: Document) => Promise<void>,
): CatalogueState => ({
	id,
	group: "Settings",
	title,
	seed: async (world) => {
		await seedCast(world);
		world.answerSidecar({
			getAgentInstalls: () => ({
				agents: [
					{
						agent: "acp",
						acpAgent: "opencode",
						installed: true,
						path: "/opt/homebrew/bin/opencode",
						version: "1.0.0",
						authenticated: false,
					},
				],
			}),
			listAgentProviders: ({ agent, acpAgent }) => ({
				providers: agentProviders(agent, acpAgent),
			}),
		});
		return {
			route: "/settings/user/agents",
			after: async ({ document }) => {
				await openProviders(document, "OpenCode");
				await typeInto(document, "input", "Search providers", query);
				await afterSearch?.(document);
			},
			ready,
		};
	},
});

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
		"settings-search-theme",
		"Settings search: the theme",
		"color scheme",
		"Switch between light, dark, and system appearance.",
	),
	searchState(
		"settings-search-low-contrast",
		"Settings search: low-contrast dark mode",
		"contrast",
		"Soften the app's colors when using the dark theme.",
	),
	searchState(
		"settings-search-zoom",
		"Settings search: the app zoom",
		"zoom",
		"Adjust the size of the Conducted interface.",
	),
	searchState(
		"settings-search-default-model",
		"Settings search: the default model",
		"default model",
		"Model for new chats",
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
		id: "settings-agents-codex-signed-in",
		group: "Settings",
		title: "Agents: Codex just signed in with ChatGPT, the toast naming the plan",
		seed: async (world) => {
			await seedCast(world);
			let signedIn = false;
			world.answerSidecar({
				getAgentInstalls: () => ({
					agents: [
						{
							agent: "codex",
							installed: true,
							path: "/Users/sam/Library/Application Support/Conducted/bin/codex",
							source: "managed",
							version: "0.98.0",
							authenticated: signedIn,
							...(signedIn ? { authMethod: "chatgpt" as const } : {}),
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
				// The user entered the code on OpenAI's page, so the login ends signed in.
				finishAgentLogin: () => {
					signedIn = true;
					return { outcome: "signed_in" as const };
				},
			});
			return {
				route: "/settings/user/agents",
				after: ({ document }) => click(document, "button", "Run codex login", { prefix: true }),
				ready: (document) => shows(document, "Codex now uses your ChatGPT plan"),
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
					fillIn(
						await findField(document, '[role=dialog] input[type="password"]'),
						"sk-ant-oat01-sample-token",
					);
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
	opencodeProvidersSearch(
		"settings-agents-opencode-providers-search",
		"Agents: OpenCode's Providers dialog, searched for coding plan",
		"coding plan",
		(document) => has(document, "[role=option]", "KUAE Cloud Coding Plan"),
		(document) => openSelect(document, "Provider"),
	),
	opencodeProvidersSearch(
		"settings-agents-opencode-providers-no-match",
		"Agents: OpenCode's Providers dialog, a provider search with no match",
		"acme",
		(document) => shows(document, "No providers match your search."),
	),
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
	{
		id: "settings-key-bindings-recording",
		group: "Settings",
		title: "Keyboard shortcuts, recording a new key for the command palette",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/key-bindings",
				after: ({ document }) => click(document, "button", "Change shortcut for Command palette"),
				ready: (document) => shows(document, "Type shortcut"),
			};
		},
	},
	page("settings-default-models", "Default models", "models", "Default models"),
	page("settings-git", "Git", "git", "Branch name prefix"),
	page("settings-connections", "Connections", "connections", "Connections"),
	page(
		"settings-cloud",
		"Cloud: the Worker, its deploy and pairing, and cloud variables",
		"cloud",
		"Deploy to Cloudflare",
	),
	{
		id: "settings-mcp",
		group: "Settings",
		title: "MCP: the paired Worker's servers, connected, needing re-auth, disconnected and keyless",
		seed: async (world) => {
			await seedCast(world);
			await setSetting(world, "active_organization", "cloud");
			const settings = {
				gitIdentity: null,
				envVars: {},
				mcpServers: {
					context7: { url: "https://mcp.context7.com/mcp", authType: "none" },
					notion: { url: "https://mcp.notion.com/mcp", authType: "oauth" },
					sentry: { url: "https://mcp.sentry.dev/mcp", authType: "oauth" },
					linear: { url: "https://mcp.linear.app/mcp", authType: "oauth" },
				},
			};
			world.memory.controls.scriptCloud((request) => {
				if (request.path === "/settings" && request.method === "GET") {
					return ok({ status: 200, body: JSON.stringify(settings) });
				}
				if (request.path === "/mcp-oauth") {
					return ok({
						status: 200,
						body: JSON.stringify({
							callbackUrl: "https://conducted-cloud.example.workers.dev/mcp-oauth/callback",
							servers: {
								linear: { status: "active" },
								sentry: {
									status: "needs_reauth",
									statusDetail: "The refresh token is not valid.",
								},
							},
						}),
					});
				}
				return null;
			});
			return {
				route: "/settings/user/mcp",
				ready: (document) => shows(document, "Needs re-auth"),
			};
		},
	},
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
		"settings-appearance-theme-menu",
		"Appearance, the theme menu open",
		"appearance",
		"Theme",
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
		id: "settings-save-failed",
		group: "Settings",
		title: "Git, a switch whose setting cannot be saved: Conductor's toast",
		seed: async (world) => {
			await seedCast(world);
			// A file stands where the settings folder must go, so the save cannot write.
			world.memory.controls.addFile(`${world.memory.platform.fs.paths.home}/.conducted`, "");
			return {
				route: "/settings/user/git",
				after: ({ document }) => click(document, "[role=switch]", "Delete branch on archive"),
				ready: (document) =>
					document.querySelector("[data-sonner-toast]")?.textContent === "Failed to save setting",
			};
		},
	},
	{
		id: "settings-save-file-invalid",
		group: "Settings",
		title: "Git, a save stopped by a settings file that does not parse: the toast quotes the error",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/git",
				// The file breaks after the page has loaded, as an edit in another program would break it:
				// an unclosed table header, so the TOML reader refuses the whole file.
				after: async ({ world: shown, document }) => {
					shown.memory.controls.addFile(
						`${shown.memory.platform.fs.paths.home}/.conducted/settings.toml`,
						"[git\ndelete_branch_on_archive = true\n",
					);
					await click(document, "[role=switch]", "Delete branch on archive");
				},
				ready: (document) =>
					document
						.querySelector("[data-sonner-toast]")
						?.textContent?.startsWith(
							"Can't save setting because your settings file is invalid",
						) === true,
			};
		},
	},
	{
		id: "settings-save-file-overwrite",
		group: "Settings",
		title:
			"Git, a save stopped by a settings file that does not parse after an earlier save: Overwrite file",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/git",
				// A first save reads the file whole, so the app can overwrite it later, as Conductor's
				// writer can (mutateSettingsFile, main @416065). Then an edit elsewhere breaks the file.
				after: async ({ world: shown, document }) => {
					const file = `${shown.memory.platform.fs.paths.home}/.conducted/settings.toml`;
					await click(document, "[role=switch]", "Delete branch on archive");
					// The switch turns on before the save ends, so the file is broken only once the save
					// has written it; breaking it sooner would refuse the first save too.
					await waitFor("the first save reached the settings file", () =>
						(shown.memory.controls.files.get(file) ?? "").includes(
							"delete_branch_on_archive = true",
						),
					);
					shown.memory.controls.addFile(file, "[git\ndelete_branch_on_archive = true\n");
					await click(document, "[role=switch]", "Delete branch on archive");
				},
				ready: (document) => has(document, "[data-sonner-toast] button", "Overwrite file"),
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
		id: "settings-advanced-root-path-changed",
		group: "Settings",
		title: "Advanced, the root folder changed: Home with the toast",
		seed: async (world) => {
			await seedCast(world);
			world.memory.controls.queueDialogAnswers({ folder: "/Users/sam/Projects/conducted" });
			return {
				route: "/settings/user/advanced",
				after: async ({ document }) => {
					await click(document, "button", "Browse");
					await click(document, "button", "Change root path");
				},
				ready: (document) => shows(document, "Conducted root path changed successfully"),
			};
		},
	},
	{
		id: "settings-repo-general-prompt",
		group: "Settings",
		title: "atlas: Actions, the general instructions for every agent opened",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/settings/repos/${cast.atlas.id}/actions`,
				after: ({ document }) => click(document, "button", "General preferences", { prefix: true }),
				ready: (document) =>
					document.querySelector(
						'[placeholder="Add custom instructions for all agents working in this repo."]',
					) !== null,
			};
		},
	},
	{
		id: "settings-repo-preview-urls",
		group: "Settings",
		title: "atlas: Misc, two preview addresses that can be reordered",
		seed: async (world) => {
			const cast = await seedCast(world);
			const repoId = cast.atlas.id;
			return {
				route: "/settings/user/general",
				after: async ({ app }) => {
					const saved = await app.container.actions.projects.updateConfig(repoId, {
						previewUrls: [
							{ name: "App", url: "http://localhost:$CONDUCTED_PORT" },
							{ name: "Storybook", url: "http://localhost:6006" },
						],
					});
					if (!saved.ok) throw new Error(`Saving atlas's settings failed: ${saved.error.message}`);
					await app.router.navigate({ to: `/settings/repos/${repoId}/misc` });
				},
				ready: (document) => has(document, "button", "Move preview URL down"),
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
						runActions: [
							// The origins the Edit and Add dialogs give: a shared action edited on this Mac,
							// and an action of this Mac only.
							{
								kind: "set",
								action: { ...dev, command: "pnpm dev --port 4000", origin: "changed_locally" },
							},
							{
								kind: "set",
								action: {
									...dev,
									id: "lint",
									label: "Lint",
									command: "pnpm lint",
									isDefault: false,
									origin: "local",
								},
							},
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
		id: "settings-repo-config-failed",
		group: "Settings",
		title: "atlas: Misc, when the repository's settings file cannot be read",
		seed: async (world) => {
			const cast = await seedCast(world);
			// An unclosed table header: the TOML reader refuses the whole file.
			world.memory.controls.files.set(
				`${cast.atlas.rootPath}/.conducted/settings.toml`,
				'[scripts\nsetup = "pnpm install"\n',
			);
			return {
				route: `/settings/repos/${cast.atlas.id}/misc`,
				ready: (document) => shows(document, "Couldn't load repository settings. Try again."),
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
		id: "settings-repo-icon-no-emoji",
		group: "Settings",
		title: "atlas: Misc, the icon picker searched for an emoji it lacks",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/settings/repos/${cast.atlas.id}/misc`,
				after: async ({ document }) => {
					await click(document, "button", "Change repository icon");
					await typeInto(document, "input", "Search emoji", "spaceship");
				},
				ready: (document) => shows(document, "No emoji found"),
			};
		},
	},
	{
		id: "settings-repo-icon-favicon",
		group: "Settings",
		title: "atlas: Misc, the icon picker's Favicon source",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/settings/repos/${cast.atlas.id}/misc`,
				after: async ({ document }) => {
					await click(document, "button", "Change repository icon");
					await click(document, "[role=tab]", "Favicon");
				},
				ready: (document) => shows(document, "Use favicon"),
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
	{
		id: "settings-conductor-import-no-space",
		group: "Settings",
		title: "General: Import from Conductor, not enough disk space",
		seed: async (world) => {
			// A Claude chat in the archived workspace, which comes over, brings one turn of history,
			// and the disk has 1 GB free (D132).
			await seedConductorImport(world, {
				sessions: [
					{
						id: "c-s3",
						workspace_id: "c-porto",
						agent_type: "claude",
						model: "opus",
						title: "Parse flags",
					},
				],
				session_messages: ["Add a --dry-run flag.", "Done."].map((content, index) => ({
					id: `c-m${index}`,
					session_id: "c-s3",
					role: index === 0 ? "user" : "assistant",
					content,
					sent_at: `2026-11-10 09:00:0${index}`,
					created_at: `2026-11-10 09:00:0${index}`,
					turn_id: "c-t1",
				})),
			});
			world.memory.controls.setDatabaseFreeBytes(1e9);
			world.answerSidecar({
				indexConductorHistory: () => ({}),
				mapConductorHistory: () => ({
					events: [
						{
							eventId: "c-t1:end" as EventId,
							at: 0,
							type: "turn_ended",
							turnId: "c-t1" as TurnId,
							outcome: "success",
						},
					],
					next: null,
				}),
				closeConductorHistory: () => ({}),
			});
			return {
				route: "/settings/user/general",
				after: ({ document }) => click(document, "button", "Review import"),
				ready: (document) => shows(document, "There is not enough free disk space"),
			};
		},
	},
	{
		id: "settings-reset-failed",
		group: "Settings",
		title: "General, a changed setting's Reset that the database refuses",
		seed: async (world) => {
			await seedCast(world);
			await setSetting(world, "default_message_send_mode", "queue");
			return {
				route: "/settings/user/general",
				after: async ({ document, world: shown }) => {
					await shown.failWrites("settings", "DELETE");
					await click(document, "button", "Setting actions");
					await click(document, "[role=menuitem]", "Reset");
				},
				ready: (document) => shows(document, "Failed to reset setting"),
			};
		},
	},
	{
		id: "settings-send-key-update-failed",
		group: "Settings",
		title: "General, a change of the send key that the database refuses",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/general",
				after: async ({ document, world: shown }) => {
					await shown.failWrites("settings", "INSERT");
					await choose(document, "Send messages with", "⌘ Enter");
				},
				ready: (document) => shows(document, "Failed to update message send key"),
			};
		},
	},
	{
		id: "settings-send-key-reset-failed",
		group: "Settings",
		title: "General, a Reset of the send key that the database refuses",
		seed: async (world) => {
			await seedCast(world);
			await setSetting(world, "message_send_key", "cmd-enter");
			return {
				route: "/settings/user/general",
				after: async ({ document, world: shown }) => {
					await shown.failWrites("settings", "UPDATE");
					await click(document, "button", "Setting actions");
					await click(document, "[role=menuitem]", "Reset");
				},
				ready: (document) => shows(document, "Failed to reset message send key"),
			};
		},
	},
	{
		id: "settings-environment-paste-save-failed",
		group: "Settings",
		title: "Environment, two pasted variables whose save the database refuses",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/user/environment",
				after: async ({ document, world: shown }) => {
					await click(document, "button", "Add environment variable");
					const name = await findFirst(document, "input#env-add-name");
					const pasted = new DataTransfer();
					pasted.setData("text/plain", "API_BASE_URL=http://localhost:4000\nLOG_LEVEL=debug");
					name.dispatchEvent(
						new ClipboardEvent("paste", { clipboardData: pasted, bubbles: true, cancelable: true }),
					);
					await find(document, "ul", "Variables");
					await shown.failWrites("env_vars", "INSERT");
					await click(document, "button", "Save", { prefix: true });
				},
				ready: (document) =>
					has(document, "ul", "Variables") &&
					shows(document, "Couldn't update your environment variables"),
			};
		},
	},
	{
		id: "settings-repo-add-action-name-taken",
		group: "Settings",
		title: "atlas: Actions, the Add action dialog with a name another action has",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/settings/repos/${cast.atlas.id}/actions`,
				after: async ({ document }) => {
					await click(document, "button", "Add");
					fillIn(await findField(document, 'input[placeholder="My action"]'), "Dev");
				},
				ready: (document) => shows(document, "Action names must be unique"),
			};
		},
	},
	{
		id: "settings-repo-add-action-name-empty",
		group: "Settings",
		title: "atlas: Actions, the Add action dialog with a command and no name",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/settings/repos/${cast.atlas.id}/actions`,
				after: async ({ document }) => {
					await click(document, "button", "Add");
					fillIn(await findField(document, 'textarea[placeholder="pnpm dev"]'), "pnpm lint");
				},
				ready: (document) => shows(document, "Action names can't be empty"),
			};
		},
	},
	{
		id: "settings-repo-removed",
		group: "Settings",
		title:
			"A project with no workspaces removed from its Misc page: the toast, on the Git settings",
		seed: async (world) => {
			await seedCast(world);
			// No workspaces, so the removal has no worktree for the scripted git to take away.
			const notes = await addRepo(world, { name: "notes", remoteUrl: null });
			return {
				route: `/settings/repos/${notes.id}/misc`,
				after: async ({ document }) => {
					await click(document, "button", "Remove repository");
					await click(document, "[role=dialog] button", "Remove repository");
				},
				ready: (document) => shows(document, "Repository removed successfully"),
			};
		},
	},
];
