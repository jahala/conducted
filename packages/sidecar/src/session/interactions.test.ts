import { expect, test } from "bun:test";
import { answerMatches } from "./interactions.ts";

test("an answer must have the kind of its interaction, and withdrawn fits all", () => {
	const plan = { kind: "plan_approval", plan: "p" } as const;
	expect(answerMatches(plan, { kind: "plan_approval", approved: true })).toBe(true);
	expect(answerMatches(plan, { kind: "question", answers: [] })).toBe(false);
	expect(answerMatches(plan, { kind: "withdrawn" })).toBe(true);
});
