/**
 * @feature catalogue States of a workspace's Setup tab
 * Owns: the Setup tab before setup ever ran, for a project with no setup script (Add setup
 * script, Ask agent, Add manually), while the script runs, after it failed and was run again
 * (with the failure toast), and after the user stopped it; and the dashboard while a workspace
 * sets up beside one whose creation failed.
 * Behaviour: ui-map.md 3.7 (Setup states); services-map.md 5A.1.2 (idle, running, completed,
 * failed, cancelled); features/scripts-panel/setup/setup-state.ts picks what the tab shows;
 * ui-map.md 3.8 and features/workspace/status-text.ts (the dashboard card's status words).
 * Our design choice: the setup script runs through the app's own workspace service on the memory
 * Platform's terminal, which exits with a queued code or, held, keeps running.
 * Test first: not applicable; the screenshot run opens every state.
 */

import type { Workspace } from "../../core/model.ts";
import { animateCast, refreshGit, seedCast, workspaceRoute } from "../cast.ts";
import { click, shows } from "../dom.ts";
import { addWorkspace, setSetting } from "../seeds.ts";
import type { AfterContext, CatalogueState } from "../state.ts";
import { CATALOGUE_NOW, MINUTE } from "../time.ts";
import type { World } from "../world.ts";

/** relay's settings with run actions only, so its workspaces have no setup script. */
const RUN_ONLY_SETTINGS = `[scripts.run.dev]
command = "pnpm dev"
default = true
`;

/** A workspace of the cast open on its chat, its Setup tab chosen, after `drive` has run. */
const setupState = (
	id: string,
	title: string,
	text: string,
	options: {
		pick?: "arbor" | "grove";
		seed?: (world: World) => void;
		drive?: (context: AfterContext, workspace: Workspace) => Promise<void>;
	} = {},
): CatalogueState => ({
	id,
	group: "Setup",
	title,
	seed: async (world) => {
		const cast = await seedCast(world);
		options.seed?.(world);
		if (options.pick === "grove") {
			world.memory.controls.files.set(
				`${cast.relay.rootPath}/.conducted/settings.toml`,
				RUN_ONLY_SETTINGS,
			);
		}
		const workspace = options.pick === "grove" ? cast.grove : cast.arbor;
		return {
			route: workspaceRoute(workspace),
			after: async (context) => {
				await animateCast(world, cast, context.app);
				await refreshGit(context.app, workspace);
				await click(context.document, "[role=tab]", "Setup", { prefix: true });
				await options.drive?.(context, workspace);
			},
			ready: (document) => shows(document, text),
		};
	},
});

/** Starts setup on a terminal that keeps running; the run's promise ends only when it stops. */
function startHeldSetup({ app, world }: AfterContext, workspace: Workspace): void {
	world.memory.controls.holdNextPty();
	void app.container.services.workspace.runSetup(workspace.id);
}

export const SETUP_STATES: CatalogueState[] = [
	setupState(
		"setup-not-run",
		"Setup tab: the project has a setup script that has not run here yet",
		"Setup script output will appear here after running setup.",
	),
	setupState("setup-no-script", "Setup tab: the project has no setup script", "Add manually", {
		pick: "grove",
	}),
	setupState("setup-running", "Setup tab: the setup script is running", "Running setup script...", {
		drive: async (context, workspace) => startHeldSetup(context, workspace),
	}),
	setupState(
		"setup-failed",
		"Setup tab: the setup script failed, and failed again on Run again",
		"Check the setup tab for logs.",
		{
			drive: async ({ app, world, document }, workspace) => {
				world.memory.controls.queuePtyExit(1);
				await app.container.services.workspace.runSetup(workspace.id);
				world.memory.controls.queuePtyExit(1);
				await click(document, "button", "Run again");
			},
		},
	),
	setupState(
		"setup-cancelled",
		"Setup tab: the user stopped the setup script",
		"Cancelled setup script",
		{
			drive: async (context, workspace) => {
				startHeldSetup(context, workspace);
				await click(context.document, "button", "Stop");
			},
		},
	),
	{
		id: "dashboard",
		group: "Pages",
		title:
			"Dashboard: the cast's workspaces by status, one setting up and one whose creation failed",
		seed: async (world) => {
			const cast = await seedCast(world);
			// The dashboard sits behind its Experimental setting.
			await setSetting(world, "dashboard_enabled", true);
			await addWorkspace(world, cast.relay, {
				name: "harbor",
				branch: "sam/stripe-webhooks",
				state: "failed",
				lastActivityAt: CATALOGUE_NOW - 5 * MINUTE,
			});
			return {
				route: "/dashboard",
				after: async (context) => {
					await animateCast(world, cast, context.app);
					startHeldSetup(context, cast.arbor);
				},
				ready: (document) => shows(document, "Initialization failed"),
			};
		},
	},
];
