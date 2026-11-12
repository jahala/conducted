/**
 * @feature catalogue States that show an in-app drag before the user starts it
 * Owns: a sidebar where a workspace can be pinned, moved into a section, or reordered by project and
 * by row; a sidebar where a workspace is being dragged, so empty Pinned shows its "Drag a workspace
 * here" hint; a workspace with two chat tabs and split panes on, and the same with one tab being
 * dragged, so its ghost follows the pointer; a workspace with a terminal in the
 * bottom panel and one in the centre, split panes on; and a working chat with three queued
 * follow-ups.
 * Behaviour: issue #529 (every in-app drag is pointer driven), issue #527 (a terminal drags between
 * the bottom panel and the centre), ui-map.md 3.2, 3.4 and 4.
 * Test first: not applicable; the pointer-drag browser run opens every state.
 */

import { animateCast, type Cast, chatRoute, refreshGit, seedCast } from "../cast.ts";
import { findFirst } from "../dom.ts";
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

/**
 * Starts a drag of `source` with real pointer events: a press, then a move past the 4px threshold,
 * so the drag controller publishes it. The pointer is never released, so the drag stays on screen.
 */
function startDrag(document: Document, source: Element): void {
	const rect = source.getBoundingClientRect();
	const x = rect.left + rect.width / 2;
	const y = rect.top + rect.height / 2;
	const init = { bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse" };
	source.dispatchEvent(new PointerEvent("pointerdown", { ...init, clientX: x, clientY: y }));
	document.dispatchEvent(
		new PointerEvent("pointermove", { ...init, clientX: x + 40, clientY: y + 40 }),
	);
}

/** A sidebar row being dragged, so empty Pinned draws its drop hint. */
async function startWorkspaceDrag(document: Document): Promise<void> {
	startDrag(document, await findFirst(document, "[data-workspace-id]"));
}

/** arbor with a second chat tab and split panes on, as `workspace-tabs-drag` shows it. */
async function seedTwoTabs(world: World): Promise<Cast> {
	const cast = await seedCast(world);
	await setSetting(world, "experimental_configurable_center_panel", true);
	await addChat(world, cast.arbor, { title: "Second chat", active: false });
	return cast;
}

const SECOND_TAB = '[role="tab"][aria-label="Second chat"]';

export const DRAG_STATES: CatalogueState[] = [
	{
		id: "sidebar-pinned-drop-hint",
		group: "App shell",
		title: "A workspace is being dragged, so empty Pinned shows 'Drag a workspace here'",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async (context) => {
					await refreshGit(context.app, cast.arbor);
					await startWorkspaceDrag(context.document);
				},
				ready: (document) => document.body.textContent?.includes("Drag a workspace here") === true,
			};
		},
	},
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
			const cast = await seedTwoTabs(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async (context) => {
					await refreshGit(context.app, cast.arbor);
				},
				ready: (document) => document.querySelector(SECOND_TAB) !== null,
			};
		},
	},
	{
		id: "workspace-tab-drag-ghost",
		group: "Workspace chat",
		title: "A chat tab being dragged, its ghost following the pointer",
		seed: async (world) => {
			const cast = await seedTwoTabs(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async (context) => {
					await refreshGit(context.app, cast.arbor);
					startDrag(context.document, await findFirst(context.document, SECOND_TAB));
				},
				ready: (document) =>
					document.querySelector('[data-testid="center-panel-drag-ghost"]') !== null,
			};
		},
	},
	{
		id: "workspace-terminal-drag",
		group: "Workspace chat",
		title: "A terminal in the bottom panel and one in the centre, split panes on",
		seed: async (world) => {
			const cast = await seedCast(world);
			await setSetting(world, "experimental_configurable_center_panel", true);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async (context) => {
					await refreshGit(context.app, cast.arbor);
					const terminals = context.app.container.actions.terminals;
					must(await terminals.create(cast.arbor.id, { placement: "panel" }));
					must(await terminals.create(cast.arbor.id, { placement: "centre" }));
				},
				ready: (document) =>
					document.querySelector('[role="tab"][aria-label="Terminal 2"]') !== null &&
					[...document.querySelectorAll('[role="tab"]')].some(
						(tab) => tab.getAttribute("aria-label") === null && tab.textContent === "Terminal 1",
					),
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
