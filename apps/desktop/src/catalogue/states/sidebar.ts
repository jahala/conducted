/**
 * @feature catalogue States of the sidebar's sections and view options
 * Owns: the sidebar with a pinned workspace and two of the user's sections (one collapsed, with its
 * count), a section's actions menu, the section dialog opened by Rename, by New section, and after
 * its section was removed ("Section not found"), a
 * pinned workspace's actions menu ('Unpin'), the list's View options menu (group, filter by project,
 * sort), the new-workspace dialog's "Create in section" menu, and the organisation switcher open
 * with this Mac and the paired Worker (CLOUD-19).
 * Behaviour: ui-map.md 4 items 4 to 7 (Pinned, sections with name, emoji, collapse and count,
 * "Create in section", rename and delete; View options: group by Status or Project, filter by
 * project, sort by Updated or Created).
 * Test first: not applicable; the screenshot run opens every state.
 */

import { type Cast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { click, shows } from "../dom.ts";
import { must } from "../seeds.ts";
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

export const SIDEBAR_STATES: CatalogueState[] = [
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
			const row = document.querySelector<HTMLElement>("[data-workspace-id]");
			if (row === null) throw new Error("No sidebar workspace row to open.");
			const box = row.getBoundingClientRect();
			const init = {
				bubbles: true,
				cancelable: true,
				button: 2,
				clientX: box.left + box.width / 2,
				clientY: box.top + box.height / 2,
			};
			row.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerType: "mouse" }));
			row.dispatchEvent(new MouseEvent("contextmenu", init));
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
