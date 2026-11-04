import { expect, test } from "bun:test";
import { LogRing } from "./log-ring.ts";
import type { LogRecord } from "./logger.ts";

const record = (message: string, over: Partial<LogRecord> = {}): LogRecord => ({
	at: 1,
	level: "info",
	scope: "s",
	message,
	...over,
});

test("the oldest records go first when the byte limit is passed", () => {
	const one = record("a".repeat(10));
	const size = JSON.stringify(one).length;
	const ring = new LogRing(size * 2 + 1);
	ring.add(record("1".repeat(10)));
	ring.add(record("2".repeat(10)));
	ring.add(record("3".repeat(10)));
	expect(ring.query().map((r) => r.message[0])).toEqual(["2", "3"]);
	expect(ring.dropped).toBe(1);
});

test("a record larger than the whole limit is dropped and counted", () => {
	const ring = new LogRing(20);
	ring.add(record("x".repeat(100)));
	expect(ring.query()).toEqual([]);
	expect(ring.dropped).toBe(1);
});

test("filters combine with AND and the search ignores case", () => {
	const ring = new LogRing();
	ring.add(record("Disk Full", { level: "error", scope: "outbox" }));
	ring.add(record("disk ok", { level: "info", scope: "outbox" }));
	ring.add(record("disk full", { level: "error", scope: "session:a" }));
	const found = ring.query({ levels: ["error"], scopes: ["outbox"], search: "DISK" });
	expect(found.map((r) => r.message)).toEqual(["Disk Full"]);
});
