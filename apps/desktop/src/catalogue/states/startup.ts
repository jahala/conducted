/**
 * @feature catalogue States of the app's start
 * Owns: the start-up screen while the database is checked (the app's loading state), the blocker for a
 * database written by a newer version, and the failure screen when the sidecar does not start.
 * Behaviour: APP-01 and APP-08 (app/startup.ts, app/StartupScreen.tsx, app/StartupFailure.tsx).
 * Our design choice: each state changes one answer of the in-memory Platform before the app starts, as
 * the start-up tests do: the database check that never answers, one that reports a newer schema, and a
 * sidecar that cannot be started.
 * Test first: not applicable; the screenshot run opens every state.
 */
import { appError, err, ok } from "@conducted/shared";
import { seedCast } from "../cast.ts";
import { shows } from "../dom.ts";
import type { CatalogueState } from "../state.ts";

export const STARTUP_STATES: CatalogueState[] = [
	{
		id: "startup-loading",
		group: "Start-up",
		title: "Starting: the database is being checked (loading)",
		seed: async (world) => {
			await seedCast(world);
			world.memory.platform.app.dbVersionWarning = () => new Promise(() => {});
			return { route: "/", start: "pending" };
		},
	},
	{
		id: "startup-blocked",
		group: "Start-up",
		title: "Blocked: the database is from a newer version",
		seed: async (world) => {
			await seedCast(world);
			world.memory.platform.app.dbVersionWarning = async () =>
				ok({ databaseVersion: 9, appVersion: 8 });
			return { route: "/", start: "fails", ready: (document) => shows(document, "9") };
		},
	},
	{
		id: "startup-failed",
		group: "Start-up",
		title: "Failed: the sidecar did not start (error)",
		seed: async (world) => {
			await seedCast(world);
			world.memory.platform.sidecar.ensureStarted = async () =>
				err(appError("sidecar_spawn_failed", "The sidecar exited at once with code 1."));
			return {
				route: "/",
				start: "fails",
				ready: (document) => shows(document, "The sidecar exited at once"),
			};
		},
	},
];
