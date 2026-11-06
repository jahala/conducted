// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createTestIds } from "./ids.ts";

describe("test id source", () => {
	it("hands out a new id on every call, and each source counts on its own", () => {
		const ids = createTestIds("turn");
		expect([ids.uuid(), ids.uuid(), ids.uuid()]).toEqual(["turn-1", "turn-2", "turn-3"]);
		expect(createTestIds("turn").uuid()).toBe("turn-1");
	});
});
