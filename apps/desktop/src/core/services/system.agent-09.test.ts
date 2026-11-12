/**
 * @feature AGENT-09 Cursor: SDK in process (installing the SDK from Settings)
 * Owns: tests for Cursor's SDK as a managed program in the app: it is listed on the Advanced page
 * after Claude Code and Codex, a send to Cursor waits while it installs, and the agent list is
 * read again once it is ready, so Cursor can be picked without a manual Refresh.
 * Test first: once Cursor's SDK is installed, the container asks the sidecar for the agent list
 * again.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { ProgramStatus } from "../../platform/platform.ts";
import { createTestContainer } from "../../test/container.ts";
import { SystemService } from "./system.ts";

describe("AGENT-09 Cursor's SDK in the system service", () => {
	it("lists Cursor's SDK with the agent programs, after Claude Code and Codex", async () => {
		const test = createTestContainer();
		try {
			expect((await test.container.services.system.start()).ok).toBe(true);
			for (const program of ["cursor", "codex", "claude"] as const) {
				expect((await test.container.platform.programs.install(program)).ok).toBe(true);
			}

			const programs = test.container.services.system.store.getState().programs;
			expect(programs.state).toBe("ready");
			if (programs.state !== "ready") return;
			expect(programs.data.map((view) => view.status.program)).toEqual([
				"claude",
				"codex",
				"cursor",
			]);
		} finally {
			test.close();
		}
	});

	it("reads the agent list again once Cursor's SDK is installed", async () => {
		const test = createTestContainer();
		try {
			const refresh = vi.spyOn(test.container.services.agentCatalog, "refresh");
			expect((await test.container.services.system.start()).ok).toBe(true);
			expect((await test.container.platform.programs.install("codex")).ok).toBe(true);
			const before = refresh.mock.calls.length;

			expect((await test.container.platform.programs.install("cursor")).ok).toBe(true);

			await vi.waitFor(() => expect(refresh.mock.calls.length).toBe(before + 1));
		} finally {
			test.close();
		}
	});

	it("holds a message to Cursor while its SDK is being installed, and only then", async () => {
		const status = (state: ProgramStatus["state"]): ProgramStatus => ({
			program: "cursor",
			state,
			version: "1.3.1",
			bytesDownloaded: 0,
			bytesTotal: null,
			attempt: 0,
			nextAttemptAt: null,
			error: null,
			path: null,
			follow: null,
		});
		for (const [state, held] of [
			["downloading", true],
			["verifying", true],
			["ready", false],
			["missing", false],
		] as const) {
			const test = createTestContainer();
			vi.spyOn(test.container.platform.programs, "statuses").mockResolvedValue(ok([status(state)]));
			const service = new SystemService({
				platform: test.container.platform,
				setting: <T>(_key: string) => "" as T,
				now: () => 0,
			});
			try {
				expect((await service.start()).ok).toBe(true);
				expect(service.holdsSend("cursor"), state).toBe(held);
			} finally {
				service.dispose();
				test.close();
			}
		}
	});
});
