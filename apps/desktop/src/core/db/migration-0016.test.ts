// @vitest-environment node
/**
 * @feature CLOUD-11 Local mirror and file sync for a cloud workspace
 * Tests migration 0016: a terminal records which host it runs on, so a cloud workspace can have a
 * terminal on the Mac in its mirror beside one in the sandbox. Rows written before this migration
 * are Mac terminals.
 * Test first: the terminals table has host_kind, defaulting to 'local'.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openTestDatabase } from "../../test/sqlite.ts";

let store: ReturnType<typeof openTestDatabase>;

beforeEach(() => {
	store = openTestDatabase();
});

afterEach(() => {
	store.close();
});

describe("CLOUD-11 migration 0016", () => {
	it("adds host_kind to a terminal, defaulting to the Mac", () => {
		const columns = store.raw.prepare("PRAGMA table_info(terminals)").all() as {
			name: string;
			dflt_value: string | null;
			notnull: number;
		}[];
		const hostKind = columns.find((column) => column.name === "host_kind");

		expect(hostKind).toBeDefined();
		expect(hostKind?.dflt_value).toBe("'local'");
		expect(hostKind?.notnull).toBe(1);
	});
});
