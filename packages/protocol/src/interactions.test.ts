import { expect, test } from "bun:test";
import {
	CODEX_INTERACTION_TIMEOUT_MS,
	zInteractionAnswer,
	zInteractionRequest,
} from "./interactions.ts";

test("a Codex permission grant carries its paths, network flag and expiry", () => {
	const request = {
		sessionId: "s1",
		interactionId: "i1",
		interaction: {
			kind: "permission_grant",
			description: "Codex wants to write outside its sandbox",
			paths: [{ path: "/tmp/build", pathKind: "path", access: "write" }],
			network: true,
		},
		expiresAt: 1_000 + CODEX_INTERACTION_TIMEOUT_MS,
	};
	const parsed: unknown = zInteractionRequest.parse(request);
	expect(parsed).toEqual(request);
});

test("a tool approval may be allowed with the agent's suggested rules", () => {
	const answer = { kind: "tool_approval", decision: "allow_with_suggested_rules" };
	const parsed: unknown = zInteractionAnswer.parse(answer);
	expect(parsed).toEqual(answer);
	expect(zInteractionAnswer.safeParse({ ...answer, decision: "maybe" }).success).toBe(false);
});

test("a permission grant answer may last for the session", () => {
	const answer = { kind: "permission_grant", granted: true, grantFor: "session" };
	const parsed: unknown = zInteractionAnswer.parse(answer);
	expect(parsed).toEqual(answer);
	expect(zInteractionAnswer.safeParse({ ...answer, grantFor: "forever" }).success).toBe(false);
});
