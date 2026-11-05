import type { SessionId } from "@conducted/shared";
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { SessionsService, type SessionsServiceDeps } from "./sessions.ts";

describe("AGENT-04 session edit auto-approval", () => {
	it("sends setAutoApproveEdits to the sidecar for the chat", async () => {
		const calls: { method: string; params: unknown }[] = [];
		const deps = {
			sidecar: {
				request: async (method: string, params: unknown) => {
					calls.push({ method, params });
					return ok({});
				},
				notify: async () => ok(undefined),
			},
		} as unknown as SessionsServiceDeps;
		const service = new SessionsService(deps);

		const result = await service.setAutoApproveEdits("s1" as SessionId, true);

		expect(result).toEqual(ok(undefined));
		expect(calls).toEqual([
			{
				method: "setAutoApproveEdits",
				params: { sessionId: "s1", enabled: true },
			},
		]);
	});
});
