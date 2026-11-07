// @vitest-environment node
/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Tests the header's Restart action from the real composition root: `actions.workspaces.restart`
 * reaches the workspace service, which makes the one restart call and then re-reads the status so
 * the header does not wait for its poll. A local workspace is refused without any call.
 * Test first: a cloud workspace's restart reaches `/w/<name>/restart`.
 */
import { ok } from "@conducted/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTestContainer,
	seedRepo,
	seedWorkspace,
	type TestContainer,
} from "../../test/container.ts";

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(async () => {
	await test.container.stop();
	test.close();
});

describe("CLOUD-15 Restart from the composition root", () => {
	it("restarts a cloud workspace with one Worker call", async () => {
		const repo = await seedRepo(test.container);
		const workspace = await seedWorkspace(test.container, {
			repoId: repo.id,
			host: { kind: "cloud", url: "https://cloud.example.dev", vmId: "oslo" },
		});
		test.memory.controls.scriptCloud((request) =>
			request.path.endsWith("/restart")
				? ok({ status: 200, body: '{"started":true,"readyMs":1400,"instance":"basic"}' })
				: null,
		);

		const result = await test.container.actions.workspaces.restart(workspace.id);

		expect(result).toEqual(ok(undefined));
		expect(test.memory.controls.cloudRequests.map((request) => request.path)).toEqual([
			"/w/oslo/restart",
			// The status is re-read at once, rather than waiting for the header's next poll.
			"/w/oslo/state",
		]);
	});

	it("refuses a local workspace without calling the Worker", async () => {
		const repo = await seedRepo(test.container);
		const workspace = await seedWorkspace(test.container, { repoId: repo.id });

		const result = await test.container.actions.workspaces.restart(workspace.id);

		expect(result.ok ? null : result.error.code).toBe("workspace_not_cloud");
		expect(test.memory.controls.cloudRequests).toEqual([]);
	});
});
