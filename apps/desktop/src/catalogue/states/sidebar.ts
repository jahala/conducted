/**
 * @feature catalogue States of the sidebar's sections and view options
 * Owns: the sidebar with a pinned workspace and two of the user's sections (one collapsed, with its
 * count), a section's actions menu, the section dialog opened by Rename, the list's View options
 * menu (group, filter by project, sort), and the new-workspace dialog's "Create in section" menu.
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
		"sidebar-view-options",
		"Sidebar: the list's View options menu",
		"Filter by project",
		({ document }) => click(document, "button", "My workspaces actions"),
	),
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
