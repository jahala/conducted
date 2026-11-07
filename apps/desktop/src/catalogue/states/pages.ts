/**
 * @feature catalogue States of the full pages in the main layout: Home, new workspace, backlog
 * Owns: the seeds for Home with the cast, the new workspace page with a project chosen, and the backlog
 * with saved workspaces and empty.
 * Behaviour: ui-map.md 2 (routes /all-workspaces, /create, /backlog), WS-11 (backlog).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { animateCast, seedCast } from "../cast.ts";
import { click, find, shows, typeInto } from "../dom.ts";
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
				ready: (document) => shows(document, "Rate limit api"),
			};
		},
	},
	{
		id: "home-no-match",
		group: "Pages",
		title: "Home with a search that matches no workspace",
		seed: async (world) => {
			await seedCast(world);
			return {
				route: "/all-workspaces",
				after: ({ document }) => typeInto(document, "input", "Search", "no such workspace"),
				ready: (document) => shows(document, "No matching workspaces"),
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
				after: async ({ document }) => {
					await click(document, "button", "Archived workspaces");
					// A select ignores a pointer release where the press began, so choose by keyboard.
					const option = await find(document, "[role=option]", "Only archived");
					option.focus();
					option.dispatchEvent(
						new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
					);
				},
				ready: (document) => shows(document, "Old search experiment"),
			};
		},
	},
	...(
		[
			["home-projects-menu", "Home with the project filter open", "In all projects", "menu"],
			["home-archive-menu", "Home with the archive filter open", "Archived workspaces", "select"],
			["home-sort-menu", "Home with the sort menu open", "Sort workspaces", "select"],
			["home-display-menu", "Home with the Display menu open", "Display", "menu"],
		] as const
	).map(
		([id, title, control, kind]): CatalogueState => ({
			id,
			group: "Pages",
			title,
			seed: async (world) => {
				await seedCast(world);
				return {
					route: "/all-workspaces",
					after: async ({ document }) => {
						// Only Home's own controls, inside main.
						if (kind === "menu") {
							await click(document, "main button", control);
							return;
						}
						const trigger = await find(document, "main button", control);
						trigger.focus();
						trigger.dispatchEvent(
							new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
						);
					},
					// A select keeps its options in a hidden native list, so wait for the open popup itself.
					ready: (document) =>
						document.querySelector(kind === "menu" ? "[role=menu]" : "[role=listbox]") !== null,
				};
			},
		}),
	),
	{
		id: "new-workspace",
		group: "Pages",
		title: "New workspace dialog, project chosen",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/create?repo=${cast.atlas.id}`,
				ready: (document) => document.querySelector('[role="dialog"] textarea') !== null,
			};
		},
	},
	{
		id: "new-workspace-project-menu",
		group: "Pages",
		title: "New workspace dialog with its project menu open",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/create?repo=${cast.atlas.id}`,
				after: ({ document }) => click(document, "button", "Project: atlas"),
				ready: (document) => shows(document, "Recents"),
			};
		},
	},
	{
		id: "create-project",
		group: "Pages",
		title: "Quick start's Create project dialog, from the new-workspace project menu",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/create?repo=${cast.atlas.id}`,
				after: async ({ document }) => {
					await click(document, "button", "Project: atlas");
					await click(document, '[role="menuitem"]', "Quick start");
					await typeInto(
						document,
						'input[placeholder="my-awesome-project"]',
						"",
						"atlas-playground",
					);
				},
				ready: (document) => shows(document, "Creates folder"),
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
