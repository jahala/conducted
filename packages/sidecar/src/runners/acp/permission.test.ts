import { expect, test } from "bun:test";
import type { PermissionOption } from "@agentclientprotocol/sdk";
import {
	autoApproveOption,
	isQuestionLike,
	outcomeFromStopReason,
	permissionResponseFor,
} from "./permission.ts";

const opt = (optionId: string, kind: PermissionOption["kind"]): PermissionOption => ({
	optionId,
	name: optionId,
	kind,
});

const approval = (decision: "allow" | "allow_edits_for_session" | "always_allow" | "deny") =>
	({ kind: "tool_approval", decision }) as const;

test("deny picks reject_once, falls back to reject_always, else cancels", () => {
	expect(
		permissionResponseFor([opt("a", "allow_once"), opt("r", "reject_once")], approval("deny")),
	).toEqual({
		outcome: { outcome: "selected", optionId: "r" },
	});
	expect(
		permissionResponseFor([opt("a", "allow_once"), opt("R", "reject_always")], approval("deny")),
	).toEqual({
		outcome: { outcome: "selected", optionId: "R" },
	});
	expect(permissionResponseFor([opt("a", "allow_once")], approval("deny"))).toEqual({
		outcome: { outcome: "cancelled" },
	});
});

test("always allow uses allow_always only when offered", () => {
	const both = [opt("once", "allow_once"), opt("always", "allow_always")];
	expect(permissionResponseFor(both, approval("always_allow"))).toEqual({
		outcome: { outcome: "selected", optionId: "always" },
	});
	expect(permissionResponseFor([opt("once", "allow_once")], approval("always_allow"))).toEqual({
		outcome: { outcome: "selected", optionId: "once" },
	});
});

test("a withdrawn answer cancels the request", () => {
	expect(permissionResponseFor([opt("a", "allow_once")], { kind: "withdrawn" })).toEqual({
		outcome: { outcome: "cancelled" },
	});
});

test("two allow options and no reject option is a question", () => {
	expect(isQuestionLike([opt("a", "allow_once"), opt("b", "allow_always")])).toBe(true);
	expect(
		isQuestionLike([opt("a", "allow_once"), opt("b", "allow_always"), opt("c", "reject_once")]),
	).toBe(false);
	expect(autoApproveOption([opt("b", "allow_always"), opt("a", "allow_once")])?.optionId).toBe("a");
});

test("stop reasons map to outcomes", () => {
	expect(outcomeFromStopReason("end_turn")).toEqual({ kind: "success" });
	expect(outcomeFromStopReason("cancelled")).toEqual({ kind: "cancelled" });
	expect(outcomeFromStopReason("refusal").kind).toBe("error");
});

test("an unknown stop reason from a newer agent is a turn error, not a crash", () => {
	const outcome = outcomeFromStopReason(
		"future_reason" as Parameters<typeof outcomeFromStopReason>[0],
	);
	expect(outcome.kind).toBe("error");
});
