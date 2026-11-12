/**
 * Tests the harness's own name lists, read from the code that defines them.
 * Behaviour: docs/plans/parity-harness.md section 3, check e; the table list must include the
 * applied-migration ledger sqlx's migrator creates, which no migration file writes.
 */
import { describe, expect, test } from "bun:test";
import { ROOT } from "./lib.ts";
import { ourNames } from "./ours.ts";

describe("ourNames", () => {
	test("the table list names the plugin's migration ledger and the app's own tables", () => {
		const tables = ourNames(ROOT).table;
		expect(tables).toContain("_sqlx_migrations");
		expect(tables).toContain("repos");
	});
});
