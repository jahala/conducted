/**
 * @feature REV-03 Diff comment sidecar requests
 * Tests that the agent tools' two requests reach their ports and report failures as RPC errors.
 */
import { appError, err, ok, type SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createSidecarRequestHandlers, type SidecarHandlerPorts } from "./handlers.ts";

const sessionId = "s1" as SessionId;

describe("REV-03 diff comment sidecar requests", () => {
	it("returns the comments the port found", async () => {
		const forSession = vi.fn(async () => ok([]));
		const handlers = createSidecarRequestHandlers({
			diffComments: { forSession, addForSession: vi.fn() },
		} as unknown as SidecarHandlerPorts);

		const result = await handlers.getDiffComments({ sessionId, file: "src/a.ts" });

		expect(result).toEqual({ comments: [] });
		expect(forSession).toHaveBeenCalledWith(sessionId, "src/a.ts");
	});

	it("adds the comments through the port and answers how many", async () => {
		const addForSession = vi.fn(async () => ok(2));
		const handlers = createSidecarRequestHandlers({
			diffComments: { forSession: vi.fn(), addForSession },
		} as unknown as SidecarHandlerPorts);
		const comments = [{ file: "src/a.ts", line: 3, body: "A note" }];

		const result = await handlers.addDiffComments({ sessionId, comments });

		expect(result).toEqual({ added: 2 });
		expect(addForSession).toHaveBeenCalledWith(sessionId, comments);
	});

	it("reports a failed read as an RPC error with the app's code", async () => {
		const handlers = createSidecarRequestHandlers({
			diffComments: {
				forSession: async () => err(appError("comment_read_failed", "Could not read comments.")),
				addForSession: vi.fn(),
			},
		} as unknown as SidecarHandlerPorts);

		const failure = await handlers.getDiffComments({ sessionId }).catch((cause: unknown) => cause);

		expect(failure).toMatchObject({
			message: "Could not read comments.",
			data: { appErrorCode: "comment_read_failed" },
		});
	});
});
