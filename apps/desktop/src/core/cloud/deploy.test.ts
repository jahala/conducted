/**
 * @feature CLOUD-08 Deploy flow for the user's Cloudflare account
 * Tests the rules this service owns: a second deploy while the first runs joins it instead of
 * uploading the Worker twice, and its state (running with the shell's step, done with the URL,
 * failed with the message) outlives the page that started it (issue #490). The shell's own deploy
 * path and its steps are covered by cloud.rs's tests.
 * Test first: two deploys in a row reach the shell once, and the store keeps each step and the result.
 */
import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { CloudDeployEvent, CloudDeployResult } from "../../platform/platform.ts";
import { createCloudDeploy } from "./deploy.ts";

/** A deploy door whose progress the test drives, as the shell's event would. */
function deployDoor(deploy: () => Promise<Result<CloudDeployResult>>) {
	const listeners = new Set<(event: CloudDeployEvent) => void>();
	return {
		door: {
			deploy,
			uninstall: async () => ok(undefined),
			onDeployEvent: (listener: (event: CloudDeployEvent) => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		report: (step: string) => {
			for (const listener of listeners) listener({ step });
		},
	};
}

describe("CLOUD-08 the deploy service", () => {
	it("joins a second deploy to the one that is running", async () => {
		let calls = 0;
		let finish: (value: { url: string }) => void = () => {};
		const { door } = deployDoor(() => {
			calls += 1;
			return new Promise<Result<CloudDeployResult>>((resolve) => {
				finish = (value) => resolve(ok(value));
			});
		});
		const service = createCloudDeploy(door, async () => ok(undefined));
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
		const { door } = deployDoor(async () => {
			calls += 1;
			return ok({ url: "https://conducted-cloud.example.workers.dev" });
		});
		const service = createCloudDeploy(door, async () => ok(undefined));
		await service.deploy();
		await service.deploy();
		expect(calls).toBe(2);
	});

	it("refreshes the pairing after a deploy and after an uninstall that succeed", async () => {
		let refreshes = 0;
		const { door } = deployDoor(async () =>
			ok({ url: "https://conducted-cloud.example.workers.dev" }),
		);
		const service = createCloudDeploy(door, async () => {
			refreshes += 1;
			return ok(undefined);
		});
		await service.deploy();
		await service.uninstall();
		expect(refreshes).toBe(2);
	});

	it("keeps the running step and then the URL, after the page that started it is gone", async () => {
		let finish: (value: { url: string }) => void = () => {};
		const { door, report } = deployDoor(
			() =>
				new Promise<Result<CloudDeployResult>>((resolve) => {
					finish = (value) => resolve(ok(value));
				}),
		);
		const service = createCloudDeploy(door, async () => ok(undefined));
		expect(service.store.getState()).toEqual({ state: "idle" });
		const running = service.deploy();
		expect(service.store.getState()).toEqual({ state: "running", step: null });
		report("Building the image and uploading the Worker");
		expect(service.store.getState()).toEqual({
			state: "running",
			step: "Building the image and uploading the Worker",
		});
		finish({ url: "https://conducted-cloud.example.workers.dev" });
		await running;
		expect(service.store.getState()).toEqual({
			state: "done",
			url: "https://conducted-cloud.example.workers.dev",
		});
	});

	it("keeps the shell's failure message", async () => {
		const { door } = deployDoor(async () =>
			err(appError("cloud_docker_missing", "Docker is not running.")),
		);
		const service = createCloudDeploy(door, async () => ok(undefined));
		await service.deploy();
		const state = service.store.getState();
		expect(state.state).toBe("failed");
		expect(state.state === "failed" && state.error.message).toBe("Docker is not running.");
	});
});
