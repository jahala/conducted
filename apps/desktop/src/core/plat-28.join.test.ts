/**
 * @feature PLAT-28 Agent program manager
 * Owns: the send gate through the real container: a message to an agent whose managed copy is
 * still being prepared waits in the follow-up queue, and goes out once the copy is ready.
 * Behaviour: services-map.md 5A.8.1 (send gate: held while the agent's program is not ready and
 * no program path of the user's own is set; released when it becomes ready).
 * Test first: a message sent to an idle Claude chat while Claude downloads is queued, not sent,
 * and is sent when Claude turns ready.
 */
import type { SessionConfig } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { ProgramStatus } from "../platform/platform.ts";
import { createTestContainer, seedWorkspace } from "../test/container.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const downloading: ProgramStatus = {
	program: "claude",
	state: "downloading",
	version: "2.1.308",
	bytesDownloaded: 10,
	bytesTotal: 100,
	attempt: 0,
	nextAttemptAt: null,
	error: null,
	path: null,
};

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

/** The sendMessage requests the app sent to the sidecar. */
const sendRequests = (lines: readonly string[]) =>
	lines
		.map((line) => JSON.parse(line) as { id?: number; method?: string; params?: { text?: string } })
		.filter((message) => message.method === "sendMessage");

describe("PLAT-28 send gate through the container", () => {
	it("queues a message to Claude while Claude downloads, and sends it once Claude is ready", async () => {
		const test = createTestContainer();
		try {
			must(await test.container.sidecar.start());
			vi.spyOn(test.container.platform.programs, "statuses").mockResolvedValue(ok([downloading]));
			must(await test.container.services.system.start());
			const workspace = await seedWorkspace(test.container);
			const session = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.start());

			const sent = await test.container.actions.sessions.send(session.id, "hello", [], "auto");

			expect(sent).toEqual(ok(undefined));
			const rows =
				test.container.services.followUpQueue.store.getState().bySession[session.id] ?? [];
			expect(rows.map((row) => [row.text, row.state])).toEqual([["hello", "waiting"]]);
			expect(sendRequests(test.memory.controls.sidecarSent)).toEqual([]);

			must(await test.container.platform.programs.install("claude"));

			const request = await vi.waitFor(() => {
				const [first] = sendRequests(test.memory.controls.sidecarSent);
				if (first === undefined) throw new Error("waiting for sendMessage");
				return first;
			});
			expect(request.params?.text).toBe("hello");
			test.memory.controls.emitSidecarLine(
				JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { deliveredAs: "new_turn" } }),
			);
			await vi.waitFor(() =>
				expect(
					test.container.services.followUpQueue.store.getState().bySession[session.id],
				).toEqual([]),
			);
		} finally {
			test.close();
		}
	});
});
