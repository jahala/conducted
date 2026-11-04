import { expect, test } from "bun:test";
import { decisionForApproval, elicitationReply, permissionGranted } from "./approvals.ts";

test("approval decisions map to Codex's four replies", () => {
	const answer = (decision: "allow" | "allow_edits_for_session" | "always_allow" | "deny") =>
		({ kind: "tool_approval", decision }) as const;
	expect(decisionForApproval(answer("allow"))).toBe("accept");
	expect(decisionForApproval(answer("allow_edits_for_session"))).toBe("acceptForSession");
	expect(decisionForApproval(answer("always_allow"))).toBe("acceptForSession");
	expect(decisionForApproval(answer("deny"))).toBe("decline");
	expect(decisionForApproval({ kind: "withdrawn" })).toBe("cancel");
	expect(decisionForApproval({ kind: "question", answers: [] })).toBe("decline");
});

test("a form is only sent back with content when accepted", () => {
	expect(elicitationReply({ kind: "mcp_form", action: "accept", content: { a: 1 } })).toEqual({
		action: "accept",
		content: { a: 1 },
	});
	expect(elicitationReply({ kind: "mcp_form", action: "decline", content: { a: 1 } })).toEqual({
		action: "decline",
		content: null,
	});
	expect(elicitationReply({ kind: "withdrawn" })).toEqual({ action: "cancel", content: null });
});

test("only an explicit grant grants", () => {
	expect(permissionGranted({ kind: "permission_grant", granted: true })).toBe(true);
	expect(permissionGranted({ kind: "permission_grant", granted: false })).toBe(false);
	expect(permissionGranted({ kind: "withdrawn" })).toBe(false);
});
