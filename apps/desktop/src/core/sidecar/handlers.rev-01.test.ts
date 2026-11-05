import { describe, expect, it } from "vitest";
import { createSidecarRequestHandlers, type SidecarHandlerPorts } from "./handlers.ts";

const ports = (diffForSession: SidecarHandlerPorts["workspaceDiff"]["diffForSession"]) =>
	({
		workspaceDiff: { diffForSession },
	}) as unknown as SidecarHandlerPorts;

describe("REV-01 getWorkspaceDiff handler", () => {
	it("returns the diff the service found", async () => {
		const handlers = createSidecarRequestHandlers(
			ports(async () => ({ ok: true, value: "diff --git a/a.ts b/a.ts" })),
		);
		const result = await handlers.getWorkspaceDiff({
			sessionId: "s1" as never,
			file: "a.ts",
			statOnly: false,
		});
		expect(result).toEqual({ diff: "diff --git a/a.ts b/a.ts" });
	});

	it("reports a failed diff as text, not as an RPC error", async () => {
		const handlers = createSidecarRequestHandlers(
			ports(async () => ({
				ok: false,
				error: { code: "no_checkpoint", message: "Cannot fetch diff: merge or rebase in progress" },
			})),
		);
		const result = await handlers.getWorkspaceDiff({
			sessionId: "s1" as never,
			statOnly: true,
		});
		expect(result).toEqual({ diff: "Cannot fetch diff: merge or rebase in progress" });
	});
});
