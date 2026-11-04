import type { SessionId, TurnId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { type ComparisonContext, isTooLargeToRender, resolveComparison } from "./diff.ts";

const context: ComparisonContext = {
	mergeBaseWithTarget: "mb1",
	mergeBaseWithScopeTarget: "mb2",
	turnCheckpoints: { startExists: true, endExists: false },
};
const turn = { kind: "turn", sessionId: "s1" as SessionId, turnId: "t1" as TurnId } as const;

describe("resolveComparison", () => {
	it("compares the merge base to the working tree for the branch scope", () => {
		expect(resolveComparison({ kind: "branch" }, context)).toEqual({
			ok: true,
			value: { from: "mb1", to: null },
		});
	});
	it("returns an error value when there is no merge base", () => {
		const result = resolveComparison({ kind: "branch" }, { ...context, mergeBaseWithTarget: null });
		expect(result.ok).toBe(false);
	});
	it("uses the scope's own target branch merge base", () => {
		expect(resolveComparison({ kind: "target", branch: "origin/dev" }, context)).toEqual({
			ok: true,
			value: { from: "mb2", to: null },
		});
	});
	it("compares a commit to its parent", () => {
		expect(resolveComparison({ kind: "commit", sha: "abc" }, context)).toEqual({
			ok: true,
			value: { from: "abc^", to: "abc" },
		});
	});
	it("compares a running turn's start checkpoint to the working tree", () => {
		expect(resolveComparison(turn, context)).toEqual({
			ok: true,
			value: { from: "refs/conducted/checkpoints/session-s1-turn-t1-start", to: null },
		});
	});
	it("compares a finished turn's start and end checkpoints", () => {
		const done = { ...context, turnCheckpoints: { startExists: true, endExists: true } };
		expect(resolveComparison(turn, done)).toEqual({
			ok: true,
			value: {
				from: "refs/conducted/checkpoints/session-s1-turn-t1-start",
				to: "refs/conducted/checkpoints/session-s1-turn-t1-end",
			},
		});
	});
	it("refuses a turn without a start checkpoint", () => {
		const none = { ...context, turnCheckpoints: { startExists: false, endExists: false } };
		expect(resolveComparison(turn, none).ok).toBe(false);
	});
});

describe("isTooLargeToRender", () => {
	it("limits by size and by changed lines", () => {
		expect(isTooLargeToRender(10, 10)).toBe(false);
		expect(isTooLargeToRender(3 * 1024 * 1024, 1)).toBe(true);
		expect(isTooLargeToRender(1, 50_000)).toBe(true);
	});
});
