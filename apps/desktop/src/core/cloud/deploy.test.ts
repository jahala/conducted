/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Tests the one rule this service owns: a second deploy while the first runs joins it instead of
 * uploading the Worker twice. The shell's own deploy path is covered by cloud.rs's tests.
 * Test first: two deploys in a row reach the shell once.
 */
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createCloudDeploy } from "./deploy.ts";

describe("CLOUD-08 the deploy service", () => {
	it("joins a second deploy to the one that is running", async () => {
		let calls = 0;
		let finish: (value: { url: string }) => void = () => {};
		const service = createCloudDeploy(
			{
				deploy: () => {
					calls += 1;
					return new Promise((resolve) => {
						finish = (value) => resolve(ok(value));
					});
				},
				uninstall: async () => ok(undefined),
			},
			async () => ok(undefined),
		);
		const first = service.deploy();
		const second = service.deploy();
		expect(service.deploying).toBe(true);
		finish({ url: "https://conducted-cloud.example.workers.dev" });
		expect(await first).toEqual(ok({ url: "https://conducted-cloud.example.workers.dev" }));
		expect(await second).toEqual(ok({ url: "https://conducted-cloud.example.workers.dev" }));
		expect(calls).toBe(1);
		expect(service.deploying).toBe(false);
	});

	it("deploys again once the first finished", async () => {
		let calls = 0;
		const service = createCloudDeploy(
			{
				deploy: async () => {
					calls += 1;
					return ok({ url: "https://conducted-cloud.example.workers.dev" });
				},
				uninstall: async () => ok(undefined),
			},
			async () => ok(undefined),
		);
		await service.deploy();
		await service.deploy();
		expect(calls).toBe(2);
	});

	it("refreshes the pairing after a deploy and after an uninstall that succeed", async () => {
		let refreshes = 0;
		const service = createCloudDeploy(
			{
				deploy: async () => ok({ url: "https://conducted-cloud.example.workers.dev" }),
				uninstall: async () => ok(undefined),
			},
			async () => {
				refreshes += 1;
				return ok(undefined);
			},
		);
		await service.deploy();
		await service.uninstall();
		expect(refreshes).toBe(2);
	});
});
