import { appError, err, ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import {
	BUDGET_STOP_BELOW,
	createRateLimitGate,
	decidePolling,
	effectiveBatchSize,
	initialBatchSizes,
	MAX_BATCH_SIZE,
	NO_PR_MEMORY_MS,
	nextBatchSizes,
	pollSkipReason,
	requestedInterval,
	shouldQueryPr,
	updatePolling,
	VISIBLE_POLL_MS,
} from "./pr-polling.ts";

describe("PR-03 poll subscriptions", () => {
	it("takes the smallest interval of the active subscribers", () => {
		expect(
			updatePolling(
				[
					{ role: "sidebar", intervalMs: 300_000 },
					{ role: "selected", intervalMs: VISIBLE_POLL_MS },
				],
				5_000,
			),
		).toEqual({ poll: true, intervalMs: 5_000, requestedOnly: false });
	});

	it("prefers the selected role when two subscribers ask for the same interval", () => {
		expect(
			updatePolling(
				[
					{ role: "sidebar", intervalMs: 5_000 },
					{ role: "selected", intervalMs: 5_000 },
				],
				800,
			),
		).toEqual({ poll: true, intervalMs: 60_000, requestedOnly: true });
	});

	it("clamps to one second and pauses an empty schedule", () => {
		expect(updatePolling([{ role: "selected", intervalMs: 10 }], 5_000).intervalMs).toBe(1_000);
		expect(updatePolling([], 5_000)).toEqual({
			poll: false,
			intervalMs: 300_000,
			requestedOnly: true,
		});
	});

	it("pauses the sidebar below 1000 calls and everything below 500", () => {
		expect(updatePolling([{ role: "sidebar", intervalMs: 300_000 }], 800).poll).toBe(false);
		expect(updatePolling([{ role: "selected", intervalMs: 5_000 }], BUDGET_STOP_BELOW).poll).toBe(
			true,
		);
		expect(updatePolling([{ role: "selected", intervalMs: 5_000 }], 499).poll).toBe(false);
	});
});

describe("PR-03 skip rules", () => {
	it("skips inactive, unlinked, offline and remote-less workspaces in that order", () => {
		const base = { active: true, repoLinked: true, hasRemote: true, offline: false };
		expect(pollSkipReason(base)).toBeNull();
		expect(pollSkipReason({ ...base, active: false })).toBe("inactive");
		expect(pollSkipReason({ ...base, repoLinked: false })).toBe("unlinked");
		expect(pollSkipReason({ ...base, offline: true })).toBe("offline");
		expect(pollSkipReason({ ...base, hasRemote: false })).toBe("no_remote");
	});

	it("asks about a branch only when it was pushed or a PR number is bound", () => {
		expect(shouldQueryPr(true, null)).toBe(true);
		expect(shouldQueryPr(false, 7)).toBe(true);
		expect(shouldQueryPr(false, null)).toBe(false);
	});

	it("remembers a branch with no PR for five minutes", () => {
		expect(NO_PR_MEMORY_MS).toBe(300_000);
	});
});

describe("PR-03 rate-limit gate", () => {
	const selected = [{ role: "selected" as const, intervalMs: 5_000 }];

	it("caches a high budget for a minute", async () => {
		let reads = 0;
		let now = 1_000;
		const gate = createRateLimitGate({
			readRemaining: async () => {
				reads += 1;
				return ok(5_000);
			},
			now: () => now,
		});

		expect((await gate.decide(selected)).ok).toBe(true);
		now += 59_999;
		expect((await gate.decide(selected)).ok).toBe(true);
		expect(reads).toBe(1);
		now += 2;
		expect((await gate.decide(selected)).ok).toBe(true);
		expect(reads).toBe(2);
	});

	it("rechecks a low budget after 500 ms", async () => {
		let reads = 0;
		let now = 1_000;
		const gate = createRateLimitGate({
			readRemaining: async () => {
				reads += 1;
				return ok(800);
			},
			now: () => now,
		});

		await gate.decide(selected);
		now += 499;
		await gate.decide(selected);
		expect(reads).toBe(1);
		now += 2;
		await gate.decide(selected);
		expect(reads).toBe(2);
	});

	it("shares one probe between two calls at the same time", async () => {
		let reads = 0;
		let release: ((remaining: number) => void) | undefined;
		const gate = createRateLimitGate({
			readRemaining: () => {
				reads += 1;
				return new Promise((resolve) => {
					release = (remaining) => resolve(ok(remaining));
				});
			},
			now: () => 1_000,
		});

		const first = gate.decide(selected);
		const second = gate.decide(selected);
		expect(reads).toBe(1);
		release?.(900);
		expect(await first).toEqual(ok({ poll: true, intervalMs: 60_000, requestedOnly: true }));
		expect(await second).toEqual(ok({ poll: true, intervalMs: 60_000, requestedOnly: true }));
	});

	it("hands a failed probe to the caller as an error value", async () => {
		const failure = appError("github_failed", "probe failed");
		const gate = createRateLimitGate({
			readRemaining: async () => err(failure),
			now: () => 1_000,
		});
		expect(await gate.decide(selected)).toEqual(err(failure));
	});

	it("asks the gate's decision with the cached budget", async () => {
		const gate = createRateLimitGate({
			readRemaining: async () => ok(800),
			now: () => 1_000,
		});
		expect(await gate.decide([{ role: "sidebar", intervalMs: 300_000 }])).toEqual(
			ok({ poll: false, intervalMs: 300_000, requestedOnly: true }),
		);
	});
});

describe("PR-03 cadence and batches", () => {
	it("polls the selected workspace every five seconds and the sidebar every five minutes", () => {
		expect(requestedInterval("selected", null)).toBe(5_000);
		expect(requestedInterval("sidebar", null)).toBe(300_000);
	});

	it("polls every second while GitHub is still computing mergeability", () => {
		expect(requestedInterval("sidebar", { mergeStateStatus: "UNKNOWN", merged: false })).toBe(
			1_000,
		);
		expect(requestedInterval("sidebar", { mergeStateStatus: "UNKNOWN", merged: true })).toBe(
			300_000,
		);
	});

	it("starts batches at five, halves on a timeout and grows by a fifth", () => {
		expect(effectiveBatchSize(initialBatchSizes())).toBe(MAX_BATCH_SIZE);
		let sizes = nextBatchSizes(initialBatchSizes(), { kind: "timeout" });
		expect(effectiveBatchSize(sizes)).toBe(2);
		sizes = nextBatchSizes(sizes, { kind: "success", cost: 1 });
		expect(effectiveBatchSize(sizes)).toBe(3);
	});

	it("halves on a high query cost and never reaches zero", () => {
		let sizes = initialBatchSizes();
		for (let index = 0; index < 6; index += 1) {
			sizes = nextBatchSizes(sizes, { kind: "success", cost: 3 });
		}
		expect(effectiveBatchSize(sizes)).toBe(1);
	});

	it("keeps the researched thresholds", () => {
		expect(decidePolling(null, "sidebar", 300_000).poll).toBe(true);
		expect(decidePolling(1_000, "sidebar", 300_000).poll).toBe(true);
		expect(decidePolling(999, "sidebar", 300_000).poll).toBe(false);
		expect(decidePolling(499, "selected", 5_000).poll).toBe(false);
	});
});
