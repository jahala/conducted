/**
 * @feature GIT-08 Change the target branch
 * Owns: tests for the sidecar's setTargetBranch request reaching the target-branch port.
 * Behaviour: claude-runner.md 4.2 (SetTargetBranch) and rpc.ts (the request's answer shape).
 * Test first: a successful target branch change answers ok true with the new branch in the message.
 */
import { appError, err, ok, type SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createSidecarRequestHandlers, type SidecarHandlerPorts } from "./handlers.ts";

const sessionId = "s1" as SessionId;

describe("GIT-08 setTargetBranch sidecar request", () => {
	it("passes the branch to the port and answers ok", async () => {
		const setForSession = vi.fn(async () => ok(undefined));
		const handlers = createSidecarRequestHandlers({
			targetBranch: { setForSession },
		} as unknown as SidecarHandlerPorts);

		const result = await handlers.setTargetBranch({ sessionId, branch: "develop" });

		expect(setForSession).toHaveBeenCalledWith(sessionId, "develop");
		expect(result).toEqual({ ok: true, message: "The target branch is now develop." });
	});

	it("answers ok false with the error message the port returned", async () => {
		const setForSession = vi.fn(async () =>
			err(appError("target_branch_missing", "The branch is not on origin.")),
		);
		const handlers = createSidecarRequestHandlers({
			targetBranch: { setForSession },
		} as unknown as SidecarHandlerPorts);

		const result = await handlers.setTargetBranch({ sessionId, branch: "develop" });

		expect(result).toEqual({ ok: false, message: "The branch is not on origin." });
	});
});
