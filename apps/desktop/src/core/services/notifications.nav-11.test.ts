/**
 * @feature NAV-11 Unread state
 * Owns: the test for the dock badge count driven by the loaded unread chats.
 * Behaviour: services-map.md 5B.2.6 (distinct workspaces, not chats).
 * Test first: two unread chats in one workspace light one badge, and marking them read clears it.
 */
import type { SessionConfig } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: true,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

describe("NAV-11 dock badge", () => {
	it("counts a workspace once and clears when its chats are read", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const first = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			const second = must(await test.container.services.sessions.create(workspace.id, CONFIG));
			must(await test.container.services.sessions.markUnread(first.id));
			must(await test.container.services.sessions.markUnread(second.id));

			must(await test.container.services.notifications.refreshDockBadge());
			expect(test.memory.controls.dockBadge).toBe(1);

			must(await test.container.services.sessions.markAllRead(workspace.id));
			must(await test.container.services.notifications.refreshDockBadge());
			expect(test.memory.controls.dockBadge).toBeNull();
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
