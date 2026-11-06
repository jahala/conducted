/**
 * @feature catalogue States of the full pages in the main layout: Home, new workspace, backlog
 * Owns: the seeds for Home with the cast, the new workspace page with a project chosen, and the backlog
 * with saved workspaces and empty.
 * Behaviour: ui-map.md 2 (routes /all-workspaces, /create, /backlog), WS-11 (backlog).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { animateCast, seedCast } from "../cast.ts";
import { click, shows } from "../dom.ts";
import { CLAUDE_CONFIG, must } from "../seeds.ts";
import type { CatalogueState } from "../state.ts";

export const PAGE_STATES: CatalogueState[] = [
	{
		id: "home",
		group: "Pages",
		title: "Home: every workspace, archived ones included",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: "/all-workspaces",
				after: ({ app }) => animateCast(world, cast, app),
				ready: (document) => shows(document, "sam/rate-limit-api"),
			};
		},
	},
	{
		id: "home-archived",
		group: "Pages",
		title: "Home, archived workspaces",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/all-workspaces",
				after: ({ document }) => click(document, "button", "Archived"),
				ready: (document) => shows(document, "sam/old-search-experiment"),
			};
		},
	},
	{
		id: "new-workspace",
		group: "Pages",
		title: "New workspace page, project chosen",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/create?repo=${cast.atlas.id}`,
				ready: (document) => shows(document, "atlas"),
			};
		},
	},
	{
		id: "backlog",
		group: "Pages",
		title: "Backlog with saved workspaces",
		seed: async (world) => {
			const cast = await seedCast(world);
			const saved = [
				{
					name: "Audit log export",
					prompt: "Let admins export the audit log as CSV, filtered by date.",
				},
				{ name: null, prompt: "The invoice PDF cuts off long company names. Wrap them instead." },
				{
					name: "Faster search",
					prompt: "Search takes two seconds on large accounts. Find out why and fix it.",
				},
			];
			for (const entry of saved) {
				must(
					await world.repositories.backlogWorkspaces.create({
						repoId: cast.atlas.id,
						displayName: entry.name,
						prompt: entry.prompt,
						attachmentPaths: [],
						config: CLAUDE_CONFIG,
						sectionId: null,
					}),
				);
			}
			return { route: "/backlog", ready: (document) => shows(document, "Audit log export") };
		},
	},
	{
		id: "backlog-empty",
		group: "Pages",
		title: "Backlog, empty",
		seed: async (world) => {
			await seedCast(world);
			return { route: "/backlog" };
		},
	},
];
