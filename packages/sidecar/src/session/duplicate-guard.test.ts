import { expect, test } from "bun:test";
import type { MessageId } from "@conducted/shared";
import { DuplicateGuard, RECENT_MESSAGE_CAP } from "./duplicate-guard.ts";

const id = (value: string) => value as MessageId;

test("a handled id is a duplicate until 100 newer ids push it out", () => {
	const guard = new DuplicateGuard();
	guard.markHandled(id("m1"));
	expect(guard.check(id("m1"))).toBe("duplicate");
	for (let i = 0; i < RECENT_MESSAGE_CAP; i++) guard.markHandled(id(`n${i}`));
	expect(guard.check(id("m1"))).toBe("new");
	expect(guard.check(id("n99"))).toBe("duplicate");
});

test("running, queued and in-flight ids are duplicates", () => {
	const guard = new DuplicateGuard();
	guard.markInFlight(id("a"));
	guard.markQueued(id("b"));
	guard.markRunning(id("c"));
	expect(["a", "b", "c"].map((m) => guard.check(id(m)))).toEqual([
		"duplicate",
		"duplicate",
		"duplicate",
	]);
});

test("forget lets a cancelled message be sent again", () => {
	const guard = new DuplicateGuard();
	guard.markQueued(id("q"));
	guard.forget(id("q"));
	expect(guard.check(id("q"))).toBe("new");
});

test("the delivery of a handled message is remembered for a repeated send", () => {
	const guard = new DuplicateGuard();
	guard.markQueued(id("q"));
	guard.rememberDelivery(id("q"), "queued");
	guard.markHandled(id("q"));
	expect(guard.deliveryOf(id("q"))).toBe("queued");
	guard.forget(id("q"));
	expect(guard.deliveryOf(id("q"))).toBeUndefined();
});

test("cancelInFlight forgets every steer that is still being sent", () => {
	const guard = new DuplicateGuard();
	guard.markInFlight(id("a"));
	guard.markInFlight(id("b"));
	expect(guard.cancelInFlight()).toEqual([id("a"), id("b")]);
	expect(guard.check(id("a"))).toBe("new");
	expect(guard.check(id("b"))).toBe("new");
});
