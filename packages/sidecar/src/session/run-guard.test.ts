import { describe, expect, test } from "bun:test";
import { RunGuard } from "./run-guard.ts";

describe("SIDE-04 run guard", () => {
	test("SIDE-04 start returns 1; a cancel makes run 1 stale; the next start returns 3", () => {
		const guard = new RunGuard();
		const first = guard.start();
		expect(first).toBe(1 as typeof first);
		expect(guard.isCurrent(first)).toBe(true);

		guard.invalidate();
		expect(guard.isCurrent(first)).toBe(false);

		const second = guard.start();
		expect(second).toBe(3 as typeof second);
		expect(guard.isCurrent(first)).toBe(false);
		expect(guard.isCurrent(second)).toBe(true);
	});

	test("SIDE-04 a newer start supersedes the older run", () => {
		const guard = new RunGuard();
		const first = guard.start();
		const second = guard.start();

		expect(guard.isCurrent(first)).toBe(false);
		expect(guard.isCurrent(second)).toBe(true);
	});
});
