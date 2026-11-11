// @vitest-environment node
/**
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Tests reading the Worker's readiness answer through the in-memory Platform's cloud door.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer } from "../../test/container.ts";
import { readCloudReadiness } from "./readiness.ts";

const URL = "https://conducted.example.workers.dev";

describe("CLOUD-19 the Worker's readiness answer", () => {
	it("the readiness answer is read, and an answer of another shape is refused", async () => {
		const test = createTestContainer();
		const { platform, controls } = test.memory;
		let body = JSON.stringify({
			github: true,
			agents: { anthropic: false, openai: true, cursor: false },
		});
		controls.scriptCloud((request) =>
			request.path === "/readiness" && request.method === "GET" ? ok({ status: 200, body }) : null,
		);

		expect(await readCloudReadiness(platform.cloud, URL)).toEqual(
			ok({ github: true, agents: { anthropic: false, openai: true, cursor: false } }),
		);
		expect(controls.cloudRequests.map((request) => [request.url, request.path])).toEqual([
			[URL, "/readiness"],
		]);

		body = JSON.stringify({ github: "yes" });
		const refused = await readCloudReadiness(platform.cloud, URL);
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.error.code).toBe("cloud_bad_response");
		test.close();
	});

	it("a refused token and an unreachable Worker are errors", async () => {
		const silent = createTestContainer();
		const unscripted = await readCloudReadiness(silent.memory.platform.cloud, URL);
		expect(unscripted.ok).toBe(false);
		silent.close();

		const test = createTestContainer();
		test.memory.controls.scriptCloud(() => ok({ status: 401, body: "Unauthorized" }));
		const refused = await readCloudReadiness(test.memory.platform.cloud, URL);
		expect(refused.ok).toBe(false);
		if (!refused.ok) expect(refused.error.code).toBe("cloud_not_paired");
		test.close();
	});
});
