// @vitest-environment node
/**
 * @feature CLOUD-10 Port forwarding from a cloud workspace to the Mac
 * Owns: the composition-root proof that a cloud workspace's forwarding actions reach the Platform's
 * local listener, through the service the real container builds.
 * Behaviour: D054 (a feature is done when it runs from the real composition root) and
 * docs/research/conductor/services-map.md 5A.3.3 (start, add and pause a forward).
 * Test first: the real container's Add action starts a listener for a cloud workspace.
 */
import type { Host } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../test/container.ts";

const CLOUD: Host = { kind: "cloud", url: "https://conducted.example.workers.dev", vmId: "vm-1" };

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

describe("CLOUD-10 forwarding in the real container", () => {
	it("starts a local listener for a cloud workspace and pauses it", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container, { host: CLOUD });
			must(await test.container.actions.portForwards.setForwarding(workspace.id, true));
			const added = must(await test.container.actions.portForwards.add(workspace.id, 3000));

			const running = must(await test.container.platform.portForward.list());
			expect(running.map((entry) => entry.forwardId)).toContain(added.id);

			must(await test.container.actions.portForwards.pauseWorkspace(workspace.id));
			const after = must(await test.container.platform.portForward.list());
			expect(after.map((entry) => entry.forwardId)).not.toContain(added.id);
		} finally {
			test.close();
		}
	});
});
