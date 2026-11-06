/**
 * @feature catalogue States of the command palette, the file viewer and the scripts panel
 * Owns: the command palette open over a workspace, a code file open in the file viewer, the file viewer
 * for a file that is gone (its error state), and the scripts panel's Run tab before and after its dev
 * script ran. The in-memory Platform ends a command's terminal at once (platform/memory.ts), so a script
 * that is still running cannot be shown.
 * Behaviour: ui-map.md 5.1 (command palette), 3.4 (file tab), 3.7 (scripts panel).
 * Test first: not applicable; the screenshot run opens every state.
 */
import { chatRoute, refreshGit, seedCast, workspaceRoute } from "../cast.ts";
import { click, pressUntilTaken, shows } from "../dom.ts";
import type { CatalogueState } from "../state.ts";

export const OVERLAY_STATES: CatalogueState[] = [
	{
		id: "command-palette",
		group: "Overlays and panels",
		title: "Command palette open",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await pressUntilTaken(document, "k", { meta: true });
				},
				ready: (document) => document.querySelector('[aria-label="Command palette tabs"]') !== null,
			};
		},
	},
	{
		id: "file-viewer",
		group: "Overlays and panels",
		title: "File viewer with a code file",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: workspaceRoute(cast.arbor, {
					tab: "file",
					path: "src/auth/safe-next.ts",
					fileMode: "edit",
				}),
				after: ({ app }) => refreshGit(app, cast.arbor),
				ready: (document) => shows(document, "safeNext"),
			};
		},
	},
	{
		id: "file-viewer-missing",
		group: "Overlays and panels",
		title: "File viewer for a file that is gone (error)",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: workspaceRoute(cast.arbor, {
					tab: "file",
					path: "src/auth/old-login.ts",
					fileMode: "edit",
				}),
				after: ({ app }) => refreshGit(app, cast.arbor),
			};
		},
	},
	{
		id: "scripts-run",
		group: "Overlays and panels",
		title: "Scripts panel, Run tab with the project's run actions",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await click(document, "button,[role=tab]", "Run");
				},
				ready: (document) => shows(document, "Run Dev"),
			};
		},
	},
	{
		id: "scripts-run-ended",
		group: "Overlays and panels",
		title: "Scripts panel, Run tab after the dev script ended",
		seed: async (world) => {
			const cast = await seedCast(world);
			return {
				route: chatRoute(cast.arbor, cast.chats.arbor),
				after: async ({ app, document }) => {
					await refreshGit(app, cast.arbor);
					await click(document, "button,[role=tab]", "Run");
					await click(document, "button", "Run Dev");
				},
				ready: (document) => shows(document, "Shell exited"),
			};
		},
	},
];
