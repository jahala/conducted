import { describe, expect, it } from "vitest";
import { createSidecarRequestHandlers, type SidecarHandlerPorts } from "./handlers.ts";

const ports = (diffForSession: SidecarHandlerPorts["workspaceDiff"]["diffForSession"]) =>
	({
		workspaceDiff: { diffForSession },
	}) as unknown as SidecarHandlerPorts;

describe("SIDE-12 getWorkspaceDiff over the app connection", () => {
	it("returns the diff the user sees", async () => {
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

	it("throws the busy failure with its code instead of answering a fake diff", async () => {
		const handlers = createSidecarRequestHandlers(
			ports(async () => ({
				ok: false,
				error: { code: "git_busy", message: "Cannot fetch diff: merge or rebase in progress." },
			})),
		);
		const failure = await handlers
			.getWorkspaceDiff({ sessionId: "s1" as never, statOnly: false })
			.catch((cause: unknown) => cause);
		expect(failure).toMatchObject({
			message: "Cannot fetch diff: merge or rebase in progress.",
			data: { appErrorCode: "git_busy" },
		});
	});
});
