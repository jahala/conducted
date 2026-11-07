/**
 * @feature catalogue States of the app shell: first run, the sidebar, Home
 * Owns: the seeds for the app with no projects (the sidebar, Home and the first-run onboarding), and for
 * the shared cast of two projects whose workspaces are working, idle, waiting on the user and archived.
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
		seed: async () => ({
			route: "/",
			ready: (document) => shows(document, "Add a project to get started."),
		}),
	},
	{
		id: "first-run-home",
		group: "App shell",
		title: "No projects yet: Home and the sidebar empty",
		seed: async () => ({
			route: "/all-workspaces",
			ready: (document) => shows(document, "Add a project to get started."),
		}),
	},
	{
		id: "onboarding",
		group: "App shell",
		title: "First-run onboarding, first slide",
		seed: async () => ({
			route: "/first-run-onboarding",
			ready: (document) => shows(document, "Each agent you spin up gets an isolated workspace."),
		}),
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
