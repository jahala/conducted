/**
 * @feature CLOUD-17 Cloud settings page
 * Tests the cloud settings service the Git and Cloud pages read: a plain read, a save of the
 * commit identity and of a variable, the page's own message when the Worker cannot be reached,
 * and the Worker's own reason when it refuses a variable.
 * Test first: a save keeps the saved settings when the Worker refuses it.
 */
import { err, ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Cloud, CloudPairing } from "../../platform/platform.ts";
import { platformError } from "../../platform/platform.ts";
import { createCloudSettings } from "./settings.ts";

const PAIRED: CloudPairing = { paired: true, url: "https://w.example.dev" };

/** A cloud door that records requests and answers from a script. */
function fakeCloud(answer: (request: { method: string; path: string; body?: unknown }) => unknown) {
	const requests: { method: string; path: string; body?: unknown }[] = [];
	const cloud = {
		request: async (request: { url: string; method: string; path: string; body?: unknown }) => {
			requests.push(request);
			return answer(request);
		},
	} as unknown as Pick<Cloud, "request">;
	return { cloud, requests };
}

const answered = (status: number, body: unknown) =>
	ok({ status, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("CLOUD-17 the cloud settings service", () => {
	it("reads nothing from an unpaired Mac and makes no request", async () => {
		const { cloud, requests } = fakeCloud(() => answered(200, { gitIdentity: null, envVars: {} }));
		const service = createCloudSettings({
			cloud,
			pairing: () => ({ paired: false, url: null }),
		});
		const loaded = await service.load();
		expect(loaded.ok && loaded.value).toEqual({ gitIdentity: null, envVars: {} });
		expect(requests).toHaveLength(0);
		expect(service.store.getState()).toMatchObject({ state: "ready", paired: false });
	});

	it("reads the settings the Worker holds", async () => {
		const saved = {
			gitIdentity: { name: "Sam Rivera", email: "sam@example.com" },
			envVars: { NODE_ENV: "development" },
		};
		const { cloud, requests } = fakeCloud(() => answered(200, saved));
		const service = createCloudSettings({ cloud, pairing: () => PAIRED });
		expect((await service.load()).ok).toBe(true);
		expect(requests).toEqual([
			expect.objectContaining({ method: "GET", path: "/settings", url: PAIRED.url }),
		]);
		expect(service.store.getState()).toEqual({
			state: "ready",
			settings: saved,
			paired: true,
		});
	});

	it("shows the page's own message when the Worker cannot be reached", async () => {
		const { cloud } = fakeCloud(() => err(platformError("cloud_request_failed", "Timed out")));
		const service = createCloudSettings({ cloud, pairing: () => PAIRED });
		const loaded = await service.load();
		expect(loaded.ok).toBe(false);
		if (loaded.ok) return;
		expect(loaded.error.code).toBe("cloud_settings_unreachable");
		expect(loaded.error.message).toBe("Conductor could not connect to cloud settings. Try again.");
		expect(service.store.getState()).toMatchObject({ state: "error" });
	});

	it("saves the commit identity and a variable over the same object", async () => {
		let stored = { gitIdentity: null, envVars: {} };
		const { cloud, requests } = fakeCloud((request) => {
			if (request.method === "GET") return answered(200, stored);
			stored = request.body as typeof stored;
			return answered(200, stored);
		});
		const service = createCloudSettings({ cloud, pairing: () => PAIRED });
		await service.load();
		expect(
			(await service.saveGitIdentity({ name: "Sam Rivera", email: "sam@example.com" })).ok,
		).toBe(true);
		expect((await service.setEnvVar("NODE_ENV", "test")).ok).toBe(true);
		expect(stored).toEqual({
			gitIdentity: { name: "Sam Rivera", email: "sam@example.com" },
			envVars: { NODE_ENV: "test" },
		});
		expect(requests.map((request) => request.method)).toEqual(["GET", "POST", "POST"]);
	});

	it("keeps the saved settings when the Worker refuses a variable, and shows the Worker's reason", async () => {
		const saved = { gitIdentity: null, envVars: { NODE_ENV: "development" } };
		const { cloud } = fakeCloud((request) =>
			request.method === "GET"
				? answered(200, saved)
				: answered(400, { error: "PATH is set by the sandbox and cannot be changed here." }),
		);
		const service = createCloudSettings({ cloud, pairing: () => PAIRED });
		await service.load();
		const refused = await service.setEnvVar("PATH", "/tmp");
		expect(refused.ok).toBe(false);
		if (refused.ok) return;
		expect(refused.error.message).toBe("PATH is set by the sandbox and cannot be changed here.");
		expect(service.store.getState()).toMatchObject({
			state: "ready",
			settings: saved,
			paired: true,
		});
	});

	it("removes a variable and leaves the rest", async () => {
		let stored = { gitIdentity: null, envVars: { A: "1", B: "2" } };
		const { cloud } = fakeCloud((request) => {
			if (request.method === "GET") return answered(200, stored);
			stored = request.body as typeof stored;
			return answered(200, stored);
		});
		const service = createCloudSettings({ cloud, pairing: () => PAIRED });
		await service.load();
		expect((await service.removeEnvVar("A")).ok).toBe(true);
		expect(stored.envVars).toEqual({ B: "2" });
	});
});
