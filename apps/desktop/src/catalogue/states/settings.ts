/**
 * @feature catalogue States of the settings pages
 * Owns: the General, Agents, Account, Environment and Advanced pages, with the cast's two projects in the
 * navigation.
 * Behaviour: ui-map.md 6 (settings pages).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { seedCast } from "../cast.ts";
import { shows } from "../dom.ts";
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
	page("settings-environment", "Environment", "environment", "Environment"),
	page("settings-advanced", "Advanced", "advanced", "Advanced"),
];
