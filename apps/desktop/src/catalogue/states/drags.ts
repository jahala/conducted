/**
 * @feature catalogue States that show an in-app drag before the user starts it
 * Owns: a sidebar where a workspace can be pinned, moved into a section, or reordered by project and
 * by row; a workspace with two chat tabs and split panes on; and a working chat with three queued
 * follow-ups.
 * Behaviour: issue #529 (every in-app drag is pointer driven), ui-map.md 3.2, 3.4 and 4.
 * Test first: not applicable; the pointer-drag browser run opens every state.
 */

import { animateCast, type Cast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { addChat, must, setSetting } from "../seeds.ts";
import type { CatalogueState } from "../state.ts";
import type { World } from "../world.ts";

/** Two empty sections and manual order, so each sidebar drop has somewhere to go. */
async function seedSidebarDrags(world: World): Promise<Cast> {
	const cast = await seedCast(world);
	await setSetting(world, "sidebar_group_by", "repo");
	await setSetting(world, "manual_workspace_order", true);
	const { sections } = world.repositories;
	must(await sections.create({ name: "Later", emoji: null }));
	must(await sections.create({ name: "Waiting", emoji: null }));
	return cast;
}

export const DRAG_STATES: CatalogueState[] = [
	{
		id: "sidebar-drags",
		group: "App shell",
		title: "Sidebar with two empty sections and manual order, ready to drag",
		seed: async (world) => {
			const cast = await seedSidebarDrags(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async (context) => {
					await refreshGit(context.app, cast.arbor);
				},
				ready: (document) => document.querySelector("[data-sidebar-list]") !== null,
			};
		},
	},
	{
		id: "workspace-tabs-drag",
		group: "Workspace chat",
		title: "A workspace with two chat tabs and split panes on",
		seed: async (world) => {
			const cast = await seedCast(world);
			await setSetting(world, "experimental_configurable_center_panel", true);
			await addChat(world, cast.arbor, { title: "Second chat", active: false });
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async (context) => {
					await refreshGit(context.app, cast.arbor);
				},
				ready: (document) =>
					document.querySelector('[role="tab"][aria-label="Second chat"]') !== null,
			};
		},
	},
	{
		id: "chat-queue-drag",
		group: "Workspace chat",
		title: "Working, with three queued follow-ups ready to reorder",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.beacon, cast.chats.beacon),
				after: async (context) => {
					await animateCast(world, cast, context.app);
					for (const text of ["Second queued message.", "Third queued message."]) {
						must(
							await context.app.container.actions.sessions.send(
								cast.chats.beacon.id,
								text,
								[],
								"queue",
							),
						);
					}
					await refreshGit(context.app, cast.beacon);
				},
				ready: (document) => document.body.textContent?.includes("3 queued") === true,
			};
		},
	},
];
