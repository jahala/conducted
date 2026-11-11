// @vitest-environment node
/**
 * @feature RUN-01 Run actions with start and stop, concurrent or exclusive
 * Tests migration 0018: a terminal records which strip its tab belongs to, the centre or the right
 * panel. Rows written before this migration were centre tabs.
 * Test first: the terminals table has placement, defaulting to 'centre'.
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

describe("RUN-01 migration 0018", () => {
	it("adds placement to a terminal, defaulting to the centre", () => {
		const columns = store.raw.prepare("PRAGMA table_info(terminals)").all() as {
			name: string;
			dflt_value: string | null;
			notnull: number;
		}[];
		const placement = columns.find((column) => column.name === "placement");

		expect(placement).toBeDefined();
		expect(placement?.dflt_value).toBe("'centre'");
		expect(placement?.notnull).toBe(1);
	});
});
