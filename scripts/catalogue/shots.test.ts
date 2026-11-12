import { describe, expect, test } from "bun:test";
import { parseShotsArgs, shardOf } from "./shots.ts";

describe("catalogue shots split into parts", () => {
	test("reads state ids and a part", () => {
		expect(parseShotsArgs(["a", "b"])).toEqual({ ok: true, only: ["a", "b"], shard: null });
		expect(parseShotsArgs(["--shard=2/3"])).toEqual({
			ok: true,
			only: [],
			shard: { index: 2, count: 3 },
		});
		expect(parseShotsArgs(["--shard=4/3"]).ok).toBe(false);
		expect(parseShotsArgs(["--shard=0/3"]).ok).toBe(false);
		expect(parseShotsArgs(["--shard=x"]).ok).toBe(false);
	});

	test("the parts together hold every state once, in order", () => {
		const states = Array.from({ length: 10 }, (_, index) => `s${index}`);
		const parts = [1, 2, 3].map((index) => shardOf(states, { index, count: 3 }));
		expect(parts.flat().sort()).toEqual([...states].sort());
		expect(new Set(parts.flat()).size).toBe(states.length);
		expect(parts.map((part) => part.length)).toEqual([4, 3, 3]);
		expect(parts[0]).toEqual(["s0", "s3", "s6", "s9"]);
	});
});
