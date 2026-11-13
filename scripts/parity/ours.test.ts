/**
 * Tests the harness's own name lists, read from the code that defines them.
 * Behaviour: docs/plans/parity-harness.md section 3, check e; the table list must include the
 * applied-migration ledger sqlx's migrator creates, which no migration file writes.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ROOT } from "./lib.ts";
import { ourNames } from "./ours.ts";

describe("ourNames", () => {
	test("the table list names the plugin's migration ledger and the app's own tables", () => {
		const tables = ourNames(ROOT).table;
		expect(tables).toContain("_sqlx_migrations");
		expect(tables).toContain("repos");
	});
	test("the event list holds the events Tauri itself sends every window, as the API package names them", async () => {
		const api = (await import(
			Bun.resolveSync("@tauri-apps/api/event", join(ROOT, "apps/desktop"))
		)) as { TauriEvent: Record<string, string> };
		const events = ourNames(ROOT).tauri_event;
		for (const name of [...Object.values(api.TauriEvent), "tauri://created", "tauri://error"]) {
			expect(events).toContain(name);
		}
		expect(events).toContain("sidecar://line");
	});
});
