import { describe, expect, it } from "vitest";
import {
	decidePolling,
	effectiveBatchSize,
	initialBatchSizes,
	nextBatchSizes,
	requestedInterval,
} from "./pr-polling.ts";

describe("decidePolling", () => {
	it("polls at the requested rate when the budget is unknown", () => {
		expect(decidePolling(null, "sidebar", 300_000)).toEqual({
			poll: true,
			intervalMs: 300_000,
			requestedOnly: false,
		});
	});
	it("stops below 500 calls", () => {
		expect(decidePolling(499, "selected", 5_000).poll).toBe(false);
	});
	it("pauses the sidebar and slows the selected workspace below 1000", () => {
		expect(decidePolling(800, "sidebar", 300_000).poll).toBe(false);
		expect(decidePolling(800, "selected", 5_000)).toEqual({
			poll: true,
			intervalMs: 60_000,
			requestedOnly: true,
		});
	});
	it("never goes below one second", () => {
		expect(decidePolling(5_000, "selected", 10).intervalMs).toBe(1_000);
	});
});

describe("requestedInterval", () => {
	it("polls every second while mergeability is unknown", () => {
		expect(requestedInterval("sidebar", { mergeStateStatus: "UNKNOWN", merged: false })).toBe(
			1_000,
		);
		expect(requestedInterval("sidebar", { mergeStateStatus: "UNKNOWN", merged: true })).toBe(
			300_000,
		);
		expect(requestedInterval("selected", null)).toBe(5_000);
	});
});

describe("batch sizes", () => {
	it("halves on a timeout and grows back by a fifth", () => {
		let sizes = initialBatchSizes();
		sizes = nextBatchSizes(sizes, { kind: "timeout" });
		expect(effectiveBatchSize(sizes)).toBe(2);
		sizes = nextBatchSizes(sizes, { kind: "success", cost: 1 });
		expect(effectiveBatchSize(sizes)).toBe(3);
	});
	it("halves on a high cost and never drops below one", () => {
		let sizes = initialBatchSizes();
		for (let i = 0; i < 6; i++) sizes = nextBatchSizes(sizes, { kind: "success", cost: 3 });
		expect(effectiveBatchSize(sizes)).toBe(1);
	});
});
