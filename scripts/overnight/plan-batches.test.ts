/**
 * The batch planner must never put a feature before what it needs, keep one program per batch,
 * and split a group larger than MAX_BATCH.
 */
import { expect, test } from "bun:test";
import type { BacklogRow } from "../issues/model.ts";
import { MAX_BATCH, planBatches, renderBatches } from "./plan-batches.ts";

const row = (id: string, owner: string, needs: string[] = []): BacklogRow => ({
	id,
	title: id,
	owner,
	research: "",
	priority: 1,
	status: "stub",
	needs,
	epic: "x",
});

test("a feature comes in a later step than everything it needs", () => {
	const batches = planBatches([
		row("SIDE-01", "S/main.ts"),
		row("SIDE-02", "S/rpc", ["SIDE-01"]),
		row("CHAT-02", "D/core/services", ["SIDE-02"]),
	]);
	const stepOf = (id: string) => batches.find((b) => b.features.some((f) => f.id === id))?.step;
	expect(stepOf("SIDE-01")).toBe(1);
	expect(stepOf("SIDE-02")).toBe(2);
	expect(stepOf("CHAT-02")).toBe(3);
});

test("one program per batch, and large groups are split", () => {
	const many = Array.from({ length: MAX_BATCH + 2 }, (_, i) =>
		row(`PLAT-${String(i + 10)}`, "R/x.rs"),
	);
	const batches = planBatches([...many, row("NAV-01", "D/app")]);
	expect(batches.map((b) => b.id)).toEqual(["s1-rust-1", "s1-rust-2", "s1-ui"]);
	expect(batches[0]?.features).toHaveLength(MAX_BATCH);
	expect(new Set(batches.flatMap((b) => b.features.map((f) => f.id))).size).toBe(MAX_BATCH + 3);
});

test("a dependency loop is refused", () => {
	expect(() => planBatches([row("A-01", "D/x", ["B-01"]), row("B-01", "D/x", ["A-01"])])).toThrow(
		"Dependency loop",
	);
});

test("the rendered file has no double blank lines, so the formatter leaves it alone", () => {
	const batches = planBatches([
		row("A-01", "S/a"),
		row("B-01", "D/b"),
		row("C-01", "S/a", ["A-01"]),
	]);
	const text = renderBatches(batches, "test");
	expect(text).not.toContain("\n\n\n");
	expect(text.endsWith("\n")).toBe(true);
});
