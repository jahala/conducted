import { expect, test } from "bun:test";
import { consumedUuidFromMirrorEntry, SteerReceipts } from "./steer-receipts.ts";

test("a receipt resolves when its uuid is consumed, and not before", async () => {
	const receipts = new SteerReceipts();
	let done = false;
	const waiting = receipts.register("u1").then(() => {
		done = true;
	});
	await Promise.resolve();
	expect(done).toBe(false);
	expect(receipts.hasPending()).toBe(true);
	expect(receipts.consume("u1")).toBe(true);
	await waiting;
	expect(done).toBe(true);
	expect(receipts.hasPending()).toBe(false);
	expect(receipts.consume("u1")).toBe(false);
});

test("clear resolves waiting receipts so nothing leaks", async () => {
	const receipts = new SteerReceipts();
	const waiting = receipts.register("u2");
	receipts.clear();
	await waiting;
	expect(receipts.hasPending()).toBe(false);
});

test("mirror entries: user uuid and queued_command source uuid count, others do not", () => {
	expect(consumedUuidFromMirrorEntry({ type: "user", uuid: "a" })).toBe("a");
	expect(
		consumedUuidFromMirrorEntry({
			type: "attachment",
			attachment: { type: "queued_command" },
			source_uuid: "b",
		}),
	).toBe("b");
	expect(consumedUuidFromMirrorEntry({ type: "assistant", uuid: "c" })).toBeNull();
	expect(consumedUuidFromMirrorEntry(null)).toBeNull();
	expect(consumedUuidFromMirrorEntry({ type: "user" })).toBeNull();
});
