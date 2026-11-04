import { expect, test } from "bun:test";
import { RunGuard } from "./run-guard.ts";

test("start, invalidate and start again: only the newest run is current", () => {
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
