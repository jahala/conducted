// @vitest-environment node
/**
 * @feature CLOUD-17 Cloud settings page
 * Owns: proof through the real composition root that the Cloud page's saves reach the Worker's
 * `/settings` route, and that data privacy mode stops a cloud workspace running while the
 * settings and a workspace's own state remain reachable.
 * Behaviour: docs/research/conductor/services-map.md 4.2.7 and 4.2.8 (the personal cloud settings
 * live on the server) and 4.1.2 (data privacy mode with the flag off restricts cloud work).
 * Test first: a cloud workspace's relay is refused in data privacy mode, and a settings save
 * still reaches the Worker.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer, seedWorkspace } from "../test/container.ts";

const URL = "https://conducted.example.workers.dev";
const PAIRING = { paired: true, url: URL };

/** A Worker that answers the settings route and a state read. */
function scriptWorker(
	test: ReturnType<typeof createTestContainer>,
	settings: { current: unknown },
) {
	test.memory.controls.scriptCloud((request) => {
		if (request.path === "/settings") {
			if (request.method === "GET")
				return ok({ status: 200, body: JSON.stringify(settings.current) });
			settings.current = request.body;
			return ok({ status: 200, body: JSON.stringify(settings.current) });
		}
		if (request.path === "/w/vm-1/state") {
			return ok({ status: 200, body: JSON.stringify({ running: false }) });
		}
		return null;
	});
}

async function paired() {
	const test = createTestContainer();
	test.memory.controls.setCloudPairing(PAIRING);
	await test.container.services.cloudPairing.start();
	await test.container.services.settings.start();
	return test;
}

describe("CLOUD-17 cloud settings in the real container", () => {
	it("saves the cloud commit identity through the Worker and keeps it in the service", async () => {
		const test = await paired();
		try {
			const settings = { current: { gitIdentity: null, envVars: {} } };
			scriptWorker(test, settings);
			const saved = await test.container.actions.cloud.saveGitIdentity({
				name: "Sam Rivera",
				email: "sam@example.com",
			});
			expect(saved.ok).toBe(true);
			expect(settings.current).toEqual({
				gitIdentity: { name: "Sam Rivera", email: "sam@example.com" },
				envVars: {},
			});
			const posts = test.memory.controls.cloudRequests.filter(
				(request) => request.method === "POST" && request.path === "/settings",
			);
			expect(posts).toHaveLength(1);
			expect(test.container.services.cloudSettings.store.getState()).toMatchObject({
				state: "ready",
				settings: { gitIdentity: { name: "Sam Rivera", email: "sam@example.com" } },
				paired: true,
			});
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});

	it("stops a cloud workspace running while data privacy mode is on, but still saves settings", async () => {
		const test = await paired();
		try {
			const settings = { current: { gitIdentity: null, envVars: { NODE_ENV: "test" } } };
			scriptWorker(test, settings);
			expect((await test.container.actions.settings.set("enterprise_data_privacy", true)).ok).toBe(
				true,
			);

			expect(test.container.services.settings.get<boolean>("enterprise_data_privacy")).toBe(true);
			// A cloud workspace's git call runs in its sandbox, so it is refused while data
			// privacy mode is on.
			const workspace = await seedWorkspace(test.container, {
				host: { kind: "cloud", url: URL, vmId: "vm-1" },
			});
			await test.database.execute("UPDATE workspaces SET state = 'ready' WHERE id = $1", [
				workspace.id,
			]);
			const read = await test.container.services.workspaceFiles.readContent(
				workspace.id,
				"README.md",
			);
			expect(read.ok).toBe(false);
			if (!read.ok) expect(read.error.code).toBe("cloud_data_privacy");

			// Reading state and saving settings do not start work, so both still reach the Worker.
			const state = await test.container.platform.cloud.request({
				url: URL,
				method: "GET",
				path: "/w/vm-1/state",
			});
			expect(state.ok).toBe(true);
			expect((await test.container.actions.cloud.setCloudEnvVar("API_URL", "https://x")).ok).toBe(
				true,
			);
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});
});
