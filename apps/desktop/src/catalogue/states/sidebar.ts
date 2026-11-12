/**
 * @feature catalogue States of the sidebar's sections and view options
 * Owns: the sidebar with a pinned workspace and two of the user's sections (one collapsed, with its
 * count), a section's actions menu, the section dialog opened by Rename, by New section, and after
 * its section was removed ("Section not found"), a
 * pinned workspace's actions menu ('Unpin'), the list's View options menu (group, filter by project,
 * sort), the new-workspace dialog's "Create in section" menu, and the organisation switcher open
 * with this Mac and the paired Worker (CLOUD-19); and the footer's update notice for an update
 * that is available, and for one downloaded with the auto-restart on and off (APP-06).
 * Behaviour: ui-map.md 4 items 4 to 7 (Pinned, sections with name, emoji, collapse and count,
 * "Create in section", rename and delete; View options: group by Status or Project, filter by
 * project, sort by Updated or Created).
 * Test first: not applicable; the screenshot run opens every state.
 */

import { ok } from "@conducted/shared";
import { type Cast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { click, findFirst, rightClickOn, shows } from "../dom.ts";
import { must, setSetting } from "../seeds.ts";
import type { AfterContext, CatalogueState, Scene } from "../state.ts";
import type { World } from "../world.ts";

/**
 * The cast with grove pinned, fjord in an open "In review" section and ember in a collapsed
 * "Waiting on others" one.
 */
async function seedSections(world: World): Promise<Cast> {
	const cast = await seedCast(world);
	const { sections, workspaces } = world.repositories;
	must(await workspaces.setPinned(cast.grove.id, world.clock.now()));
	const review = must(await sections.create({ name: "In review", emoji: "👀" }));
	must(await sections.moveWorkspace(cast.fjord.id, review.id));
	const waiting = must(await sections.create({ name: "Waiting on others", emoji: null }));
	must(await sections.moveWorkspace(cast.ember.id, waiting.id));
	must(await sections.setCollapsed(waiting.id, true));
	return cast;
}

/** arbor open on its chat beside the sectioned sidebar, then `then`. */
const sectionsState = (
	id: string,
	title: string,
	text: string,
	then?: (context: AfterContext) => Promise<void>,
): CatalogueState => ({
	id,
	group: "App shell",
	title,
	seed: async (world): Promise<Scene> => {
		const cast = await seedSections(world);
		return {
			route: chatRoute(cast.arbor, cast.chats.arbor),
			after: async (context) => {
				await refreshGit(context.app, cast.arbor);
				await then?.(context);
			},
			ready: (document) => shows(document, text),
		};
	},
});

/**
 * The footer's update notice. The in-memory updater finds no update, so the seed makes it offer one,
 * then the app checks and, unless `stage` is "available", downloads it as the user's Download does.
 */
const updateNotice = (
	id: string,
	title: string,
	stage: "available" | "ready",
	autoRestart: boolean,
	text: string,
): CatalogueState => ({
	id,
	group: "Sidebar",
	title,
	seed: async (world) => {
		const cast = await seedCast(world);
		await setSetting(world, "auto_restart_on_update_when_idle", autoRestart);
		world.memory.platform.updater.check = async () => ok({ version: "0.2.0", notes: "" });
		return {
			route: chatRoute(cast.arbor, cast.chats.arbor),
			after: async ({ app }) => {
				must(await app.container.actions.app.checkForUpdates());
				if (stage === "ready") must(await app.container.actions.app.installUpdate());
			},
			ready: (document) => shows(document, text),
		};
	},
});

export const SIDEBAR_STATES: CatalogueState[] = [
	updateNotice(
		"update-available",
		"Footer: an update is available",
		"available",
		false,
		"Download",
	),
	updateNotice(
		"update-ready",
		"Footer: an update downloaded, to restart when idle",
		"ready",
		false,
		"Restart when idle",
	),
	updateNotice(
		"update-ready-auto",
		"Footer: an update downloaded, restarting by itself when agents are idle",
		"ready",
		true,
		"Will automatically restart when all agents are idle",
	),
	sectionsState(
		"sidebar-sections",
		"Sidebar: a pinned workspace and two sections, one collapsed with its count",
		"Waiting on others",
	),
	sectionsState(
		"sidebar-section-menu",
		"Sidebar: a section's actions menu",
		"Delete section",
		({ document }) => click(document, "button", "Actions for In review"),
	),
	sectionsState(
		"sidebar-section-edit",
		"Sidebar: renaming a section",
		"Edit section",
		async ({ document }) => {
			await click(document, "button", "Actions for In review");
			await click(document, "[role=menuitem]", "Rename");
		},
	),
	sectionsState(
		"sidebar-section-missing",
		"Sidebar: the edit dialog after its section was removed",
		"Section not found",
		async ({ app, document }) => {
			await click(document, "button", "Actions for In review");
			await click(document, "[role=menuitem]", "Rename");
			const store = app.container.services.sections.store;
			const target = store.getState().sections.find((entry) => entry.name === "In review");
			if (target === undefined) throw new Error("The In review section is missing.");
			const removed = await app.container.actions.sections.remove(target.id);
			if (!removed.ok) throw new Error(`Removing the section failed: ${removed.error.message}`);
		},
	),
	sectionsState(
		"sidebar-new-section",
		"Sidebar: the New section dialog",
		"Emoji (optional)",
		async ({ document }) => {
			await click(document, "button", "My workspaces actions");
			await click(document, "[role=menuitem]", "New section…");
		},
	),
	sectionsState(
		"sidebar-workspace-actions",
		"Sidebar: a pinned workspace's actions menu",
		"Unpin",
		async ({ document }) => {
			// The row's link is the context menu's trigger; its wrapper only carries the drag.
			rightClickOn(await findFirst(document, "[data-workspace-pinned-drop] [data-workspace-id] a"));
		},
	),
	sectionsState(
		"sidebar-view-options",
		"Sidebar: the list's View options menu",
		"Filter by project",
		({ document }) => click(document, "button", "My workspaces actions"),
	),
	{
		id: "sidebar-organization-switcher",
		group: "App shell",
		title: "Sidebar: the organisation switcher open, with this Mac and the paired Worker",
		seed: async (world): Promise<Scene> => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async (context) => {
					await refreshGit(context.app, cast.arbor);
					await click(context.document, "button", "Account menu");
				},
				ready: (document) =>
					document.querySelector("[role=menu]") !== null && shows(document, "Cloud organization"),
			};
		},
	},
	{
		id: "new-workspace-in-section",
		group: "Pages",
		title: "New workspace dialog with its Create in section menu open",
		seed: async (world) => {
			const cast = await seedSections(world);
			return {
				route: `/create?repo=${cast.atlas.id}`,
				after: ({ document }) => click(document, "button", "Create in section"),
				ready: (document) => document.querySelector("[role=menu]") !== null,
			};
		},
	},
];
