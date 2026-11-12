/**
 * @feature catalogue States of the full pages in the main layout: Home, new workspace, backlog, diagnostics
 * Owns: the seeds for Home with the cast, the new workspace page with a project chosen (and its
 * Create from picker open, and its slash command menu) and in
 * cloud mode (ready, and waiting for the Worker's GitHub token, CLOUD-19), the backlog with saved
 * workspaces and empty, the Diagnostics page, the sidebar with a workspace still being created and
 * one being archived, an archived workspace's file tab, and an address that matches no page.
 * Behaviour: ui-map.md 2 (routes /all-workspaces, /create, /backlog, /diagnostics), WS-11 (backlog),
 * APP-03 (diagnostics).
 * Test first: not applicable; the screenshot run opens every state.
 */

import { ok } from "@conducted/shared";
import type { CloudReadiness } from "../../core/organization.ts";
import { animateCast, chatRoute, seedCast, workspaceRoute } from "../cast.ts";
import { click, find, has, shows, typeInto } from "../dom.ts";
import { addWorkspace, CLAUDE_CONFIG, must, setSetting } from "../seeds.ts";
import type { CatalogueState } from "../state.ts";
import type { World } from "../world.ts";

/** The cast with the paired Worker chosen in the switcher, answering `readiness` (CLOUD-19). */
async function seedCloudOrganization(world: World, readiness: CloudReadiness) {
	const cast = await seedCast(world);
	await setSetting(world, "active_organization", "cloud");
	world.memory.controls.scriptCloud((request) =>
		request.path === "/readiness" ? ok({ status: 200, body: JSON.stringify(readiness) }) : null,
	);
	return cast;
}

export const PAGE_STATES: CatalogueState[] = [
	{
		id: "route-not-found",
		group: "Pages",
		title: "An address that matches no page",
		seed: async (world) => {
			await seedCast(world);
			return { route: "/no-such-page", ready: (document) => shows(document, "Not Found") };
		},
	},
	{
		id: "sidebar-workspace-transitions",
		group: "Pages",
		title: "The sidebar with a workspace being created and one being archived",
		seed: async (world) => {
			const cast = await seedCast(world);
			await addWorkspace(world, cast.atlas, {
				name: "harbor",
				branch: "sam/billing-export",
				state: "initializing",
			});
			await addWorkspace(world, cast.atlas, {
				name: "isle",
				branch: "sam/legacy-cleanup",
				state: "archiving",
			});
			// The sidebar row names each workspace's status; Home's cards do not.
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				ready: (document) => has(document, "[aria-label]", "Initializing…"),
			};
		},
	},
	{
		id: "workspace-archived-file",
		group: "Pages",
		title: "An archived workspace's file tab",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: workspaceRoute(cast.delta, { tab: "file", path: "README.md", fileMode: "diff" }),
				ready: (document) => shows(document, "Workspace archived"),
			};
		},
	},
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
		id: "new-workspace-create-from",
		group: "Pages",
		title: "New workspace dialog, the Create from picker open",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/create?repo=${cast.atlas.id}`,
				after: ({ document }) => click(document, "button", "Show or hide the create-from picker"),
				ready: (document) => shows(document, "Starts from"),
			};
		},
	},
	{
		id: "new-workspace-slash-menu",
		group: "Pages",
		title: "New workspace dialog, the first message's slash command menu",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: `/create?repo=${cast.atlas.id}`,
				after: ({ document }) => typeInto(document, "textarea", "First message", "/"),
				ready: (document) => shows(document, "/compact"),
			};
		},
	},
	{
		id: "new-workspace-cloud",
		group: "Pages",
		title: "New workspace dialog in the cloud: the Worker's repository picker",
		seed: async (world) => {
			await seedCloudOrganization(world, {
				github: true,
				agents: { anthropic: true, openai: false, cursor: false },
			});
			return {
				route: "/create",
				ready: (document) =>
					document.querySelector('[role="dialog"] button[aria-label="Repository"]') !== null,
			};
		},
	},
	{
		id: "new-workspace-cloud-not-ready",
		group: "Pages",
		title: "New workspace dialog in the cloud while the Worker has no GitHub token",
		seed: async (world) => {
			await seedCloudOrganization(world, {
				github: false,
				agents: { anthropic: true, openai: false, cursor: false },
			});
			return {
				route: "/create",
				ready: (document) => shows(document, "GitHub isn't connected."),
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
	{
		id: "diagnostics",
		group: "Pages",
		title: "Diagnostics",
		seed: async (world) => {
			await seedCast(world);
			// The page reads the login shell's environment.
			world.scriptShell((command) =>
				command.program === "/bin/zsh" && command.args.join(" ") === "-lc env"
					? {
							ok: true,
							value: {
								stdout: [
									"HOME=/Users/sam",
									"SHELL=/bin/zsh",
									"PATH=/opt/homebrew/bin:/usr/bin:/bin",
									"LANG=en_US.UTF-8",
								].join("\n"),
								stderr: "",
								exitCode: 0,
							},
						}
					: null,
			);
			return {
				route: "/diagnostics",
				ready: (document) => shows(document, "Copy redacted report"),
			};
		},
	},
];
