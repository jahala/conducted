/**
 * @feature catalogue States of the settings pages
 * Owns: every settings page, the personal ones and atlas's repository pages, with the cast's two
 * projects in the navigation; the selects whose options are wording (themes, sounds, effort levels,
 * output styles, the send key, the follow-up behaviour, where pull requests open), each open; the
 * Git page with a custom branch prefix; the Advanced page asking before it changes the root
 * folder; the Agents page's MCP servers for the chat last open; the Environment page's documented
 * variables; atlas's Add action dialog and icon picker; and the Agents page's provider dialog with the Bedrock
 * access-key form.
 * Behaviour: ui-map.md 6 (settings pages).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { chatRoute, seedCast } from "../cast.ts";
import { seedConductorDatabase } from "../conductor-database.ts";
import { click, find, shows } from "../dom.ts";
import type { CatalogueState } from "../state.ts";
import type { World } from "../world.ts";

const page = (id: string, title: string, page: string, text: string): CatalogueState => ({
	id,
	group: "Settings",
	title,
	seed: async (world) => {
		await seedCast(world);
		return { route: `/settings/${page}`, ready: (document) => shows(document, text) };
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
		return { route: "/settings/agents" };
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
			route: `/settings/${page}`,
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

export const SETTINGS_STATES: CatalogueState[] = [
	page("settings-general", "General", "general", "General"),
	page(
		"settings-agents",
		"Agents: Claude Code and Codex installed and signed in",
		"agents",
		"Codex",
	),
	agentsWhile("hold"),
	agentsWhile("fail"),
	page("settings-account", "Account", "account", "Account"),
	page("settings-appearance", "Appearance", "appearance", "Appearance"),
	page("settings-key-bindings", "Keyboard shortcuts", "key-bindings", "Keyboard shortcuts"),
	page("settings-default-models", "Default models", "default-models", "Default models"),
	page("settings-git", "Git", "git", "Branch name prefix"),
	page("settings-connections", "Connections", "connections", "Connections"),
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
		"default-models",
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
				route: "/settings/default-models",
				after: ({ document }) => click(document, "button", "Claude Code", { prefix: true }),
				ready: (document) => document.querySelector("[role=menu]") !== null,
			};
		},
	},
	selectOpen(
		"settings-models-codex-thinking-menu",
		"Default models, the Codex thinking level menu open",
		"default-models",
		"Codex thinking level",
	),
	selectOpen(
		"settings-models-personality-menu",
		"Default models, the Codex personality menu open",
		"default-models",
		"Codex personality",
	),
	{
		id: "settings-agents-bedrock",
		group: "Settings",
		title: "Agents: Claude Code's providers dialog, Amazon Bedrock with AWS access keys",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/agents",
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
		id: "settings-git-custom-prefix",
		group: "Settings",
		title: "Git, with a custom branch prefix not typed yet",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/git",
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
				route: "/settings/advanced",
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
		id: "settings-environment-documented",
		group: "Settings",
		title: "Environment, the documented variables shown",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/settings/environment",
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
					await app.router.navigate({ to: "/settings/$page", params: { page: "agents" } });
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
				route: "/settings/general",
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
				route: "/settings/general",
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
