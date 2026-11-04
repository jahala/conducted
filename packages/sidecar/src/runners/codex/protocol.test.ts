import { expect, test } from "bun:test";
import {
	CODEX_CLIENT_METHODS,
	CODEX_SERVER_NOTIFICATIONS,
	CODEX_SERVER_REQUESTS,
} from "./protocol.ts";

test("method names are unique within a table and have no spaces", () => {
	for (const table of [CODEX_CLIENT_METHODS, CODEX_SERVER_REQUESTS, CODEX_SERVER_NOTIFICATIONS]) {
		const values = Object.values(table);
		expect(new Set(values).size).toBe(values.length);
		for (const value of values) expect(value).not.toContain(" ");
	}
});
