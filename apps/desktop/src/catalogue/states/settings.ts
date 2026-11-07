/**
 * @feature catalogue States of the settings pages
 * Owns: every settings page, the personal ones and atlas's repository pages, with the cast's two
 * projects in the navigation; the selects whose options are wording (themes, sounds, effort levels,
 * output styles), each open; and the Agents page's provider dialog with the Bedrock access-key form.
 * Behaviour: ui-map.md 6 (settings pages).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { seedCast } from "../cast.ts";
import { click, find, shows } from "../dom.ts";
import type { CatalogueState } from "../state.ts";

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
	repoPage("settings-repo-scripts", "atlas: Scripts", "scripts", "Setup script"),
	repoPage("settings-repo-actions", "atlas: Actions", "actions", "Actions"),
	repoPage("settings-repo-prompts", "atlas: Prompts", "prompts", "Prompts"),
	repoPage("settings-repo-misc", "atlas: Misc", "misc", "Misc"),
];
