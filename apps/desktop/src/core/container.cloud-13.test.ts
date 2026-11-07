// @vitest-environment node
/**
 * @feature CLOUD-13 Local copy of cloud data, kept apart by host
 * Owns: the composition-root proof that a cloud workspace's rows are a marked local copy: the
 * cloud workspace still appears in the merged list, but local startup work never touches its
 * folder, and a chat made on it is stored under its host.
 * Behaviour: services-map.md 1.2 (the host picks the record's database) and 2.6.2 (the local copy
 * of everything that belongs to a remote host). Our design choice: one database (D103).
 * Must handle: a cloud workspace's folder is not registered with the local file commands, while
 * both hosts still fill the workspace store; the chat a cloud workspace holds is written through
 * the real container and marked cloud.
 * Test first: local startup registers only the local workspace folders.
 */
import type { Host, SessionConfig } from "@conducted/protocol";
import { describe, expect, it } from "vitest";
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

const CLOUD: Host = {
	kind: "cloud",
	url: "https://conducted.example.workers.dev",
	vmId: "vm-1",
};

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

describe("CLOUD-13 the cloud copy in the real container", () => {
	it("local startup registers only the local workspace folders", async () => {
		const test = createTestContainer();
		try {
			const local = await seedWorkspace(test.container, { host: { kind: "local" } });
			const cloud = await seedWorkspace(test.container, { host: CLOUD });

			const roots = test.memory.controls.registeredRoots;
			expect(roots).toContain(local.path);
			expect(roots).not.toContain(cloud.path);
			// The merged list still holds both hosts, with their own values.
			const held = test.container.services.workspace.store.getState().workspacesById;
			expect(held[local.id]?.host).toEqual({ kind: "local" });
			expect(held[cloud.id]?.host).toEqual(CLOUD);
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});

	it("a chat made on a cloud workspace is stored under its host", async () => {
		const test = createTestContainer();
		try {
			const cloud = await seedWorkspace(test.container, { host: CLOUD });
			const session = must(await test.container.services.sessions.create(cloud.id, CONFIG));

			const rows = await test.database.select<{
				host_kind: string;
				host_url: string | null;
				host_vm_id: string | null;
			}>("SELECT host_kind, host_url, host_vm_id FROM sessions WHERE id = $1", [session.id]);

			expect(rows).toEqual([{ host_kind: "cloud", host_url: CLOUD.url, host_vm_id: CLOUD.vmId }]);
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});
});
