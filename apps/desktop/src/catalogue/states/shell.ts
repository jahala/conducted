/**
 * @feature catalogue States of the app shell: first run and the sidebar
 * Owns: the seeds for the app with no projects and for a sidebar with two projects whose workspaces are
 * working, idle, waiting on the user and archived.
 * Behaviour: ui-map.md 3.1 (sidebar), 3.8 (workspace status); onboarding for the first run.
 * Test first: not applicable; the screenshot run opens every state.
 */
import type { CatalogueState } from "../state.ts";

export const SHELL_STATES: CatalogueState[] = [
	{
		id: "first-run",
		group: "App shell",
		title: "No projects yet (first run)",
		seed: async () => "/",
	},
];
