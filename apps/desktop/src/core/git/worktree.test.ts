import { describe, expect, it } from "vitest";
import { nextFreeName } from "./worktree.ts";

describe("nextFreeName", () => {
	it("returns the base when it is free", async () => {
		expect(await nextFreeName("oslo", async () => false)).toEqual({ ok: true, value: "oslo" });
	});
	it("adds -v1, -v2 until a name is free", async () => {
		const taken = new Set(["oslo", "oslo-v1"]);
		expect(await nextFreeName("oslo", async (n) => taken.has(n))).toEqual({
			ok: true,
			value: "oslo-v2",
		});
	});
	it("gives up after 1000 tries", async () => {
		const result = await nextFreeName("oslo", async () => true);
		expect(result.ok).toBe(false);
	});
});
