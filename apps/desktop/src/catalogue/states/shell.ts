/**
 * @feature catalogue States of the app shell: first run, the sidebar, Home
 * Owns: the seeds for the app with no projects, and for the shared cast of two projects whose workspaces
 * are working, idle, waiting on the user and archived.
 * Behaviour: ui-map.md 3.1 and 4 (sidebar), 3.8 (workspace status).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { animateCast, seedCast } from "../cast.ts";
import { shows } from "../dom.ts";
import type { CatalogueState } from "../state.ts";

export const SHELL_STATES: CatalogueState[] = [
	{
		id: "first-run",
		group: "App shell",
		title: "No projects yet (first run)",
		seed: async () => ({ route: "/", ready: (document) => shows(document, "No projects yet") }),
	},
	{
		id: "sidebar",
		group: "App shell",
		title: "Sidebar: two projects, workspaces working, idle, waiting and archived",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: "/",
				after: ({ app }) => animateCast(world, cast, app),
				ready: (document) => shows(document, "sam/rate-limit-api"),
			};
		},
	},
];
