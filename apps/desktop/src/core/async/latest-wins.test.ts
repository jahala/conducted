import { describe, expect, it } from "vitest";
import { createLatestWins } from "./latest-wins.ts";

describe("APP-11 latest wins", () => {
	it("drops an older ticket when a newer request begins", () => {
		const latest = createLatestWins<"w1">();
		const first = latest.begin("w1");
		const second = latest.begin("w1");
		expect(latest.isLatest(first)).toBe(false);
		expect(latest.isLatest(second)).toBe(true);
	});

	it("drops a ticket when the key is invalidated", () => {
		const latest = createLatestWins();
		const ticket = latest.begin("w1");
		latest.invalidate("w1");
		expect(latest.isLatest(ticket)).toBe(false);
		const next = latest.begin("w1");
		expect(latest.isLatest(next)).toBe(true);
	});

	it("keeps different keys independent", () => {
		const latest = createLatestWins();
		const a = latest.begin("a");
		const b = latest.begin("b");
		latest.begin("a");
		expect(latest.isLatest(a)).toBe(false);
		expect(latest.isLatest(b)).toBe(true);
	});

	it("removes a settled key and never brings an old ticket back", () => {
		const latest = createLatestWins();
		const first = latest.begin("w1");
		const second = latest.begin("w1");
		latest.settle(first);
		expect(latest.isLatest(second)).toBe(true);
		latest.settle(second);
		expect(latest.isLatest(second)).toBe(false);

		const third = latest.begin("w1");
		expect(latest.isLatest(second)).toBe(false);
		expect(latest.isLatest(third)).toBe(true);
	});
});
