/**
 * The in-order comparison of the sidecar differential run.
 */
import { describe, expect, test } from "bun:test";
import { alignTraces } from "./compare.ts";

describe("alignTraces", () => {
	test("two equal traces have no differences", () => {
		const trace = ["status working", "agent text", "status idle"];
		expect(alignTraces(trace, trace)).toEqual({
			rows: trace.map((item) => ({ in: "both", item })),
			differences: 0,
		});
	});

	test("an item only one side sends is one difference, and the rest stays matched", () => {
		const aligned = alignTraces(
			["status working", "agent text", "status idle"],
			["status working", "agent text", "turn_end success", "status idle"],
		);
		expect(aligned.rows).toEqual([
			{ in: "both", item: "status working" },
			{ in: "both", item: "agent text" },
			{ in: "ours", item: "turn_end success" },
			{ in: "both", item: "status idle" },
		]);
		expect(aligned.differences).toBe(1);
	});

	test("items in a different order show on both sides", () => {
		const aligned = alignTraces(["a", "b"], ["b", "a"]);
		expect(aligned.differences).toBe(2);
		expect(aligned.rows.filter((row) => row.in === "both")).toHaveLength(1);
	});

	test("an empty side lists every item of the other", () => {
		expect(alignTraces(["a", "b"], [])).toEqual({
			rows: [
				{ in: "conductor", item: "a" },
				{ in: "conductor", item: "b" },
			],
			differences: 2,
		});
	});
});
