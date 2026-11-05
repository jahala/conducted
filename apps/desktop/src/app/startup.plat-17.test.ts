import { describe, expect, it } from "vitest";
import { createTauriAppInfo, type TauriBindings } from "../platform/tauri.ts";
import { createTestContainer } from "../test/container.ts";
import { runStartup, type StartupState } from "./startup.ts";

const newerDatabase: TauriBindings = {
	invoke: async <T>(): Promise<T> =>
		({
			state: "database_newer",
			appVersion: 4,
			dbVersion: 7,
			message: "This database was written by a newer version of Conducted.",
		}) as T,
	listen: async () => () => {},
};

describe("PLAT-17 startup gate through the real Tauri adapter", () => {
	it("PLAT-17 blocks the container before any service starts when the database is newer", async () => {
		const test = createTestContainer();
		const adapter = createTauriAppInfo(newerDatabase, {
			version: "0.0.0-test",
			channel: "dev",
		});
		const platform = test.container.platform;
		platform.app.dbVersionWarning = adapter.dbVersionWarning;
		const states: StartupState[] = [];

		try {
			const result = await runStartup(test.container, (state) => states.push(state), {
				installHandlers: false,
			});

			expect(result.ok).toBe(true);
			expect(states.at(-1)).toEqual({
				kind: "blocked",
				reason: "database_newer_than_app",
				databaseVersion: "7",
				appVersion: "4",
			});
		} finally {
			test.close();
		}
	});
});
