// @vitest-environment node
/**
 * @feature CLOUD-15 Cloud workspace header: status, resources, cost, restart
 * Tests the two Worker calls the header makes over the real cloud transport shape: reading the
 * workspace's state, and restarting it. The Worker route names are CLOUD-03's, so this also guards
 * the path the app asks for.
 * Test first: a restart reaches `/w/<name>/restart` and a state read reaches `/w/<name>/state`.
 */
import type { Host } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Cloud, CloudRequest, CloudResponse } from "../../platform/platform.ts";
import { readCloudWorkspaceState, restartCloudWorkspace } from "./lifecycle.ts";

const host: Extract<Host, { kind: "cloud" }> = {
	kind: "cloud",
	url: "https://cloud.example.dev",
	vmId: "ws1",
};

function scripted(answer: (request: CloudRequest) => CloudResponse) {
	const requests: CloudRequest[] = [];
	const cloud = {
		request: async (request: CloudRequest) => {
			requests.push(request);
			return ok(answer(request));
		},
	} as unknown as Cloud;
	return { cloud, requests };
}

describe("CLOUD-15 the header's Worker calls", () => {
	it("reads a workspace's status and resources from /state", async () => {
		const { cloud, requests } = scripted(() => ({
			status: 200,
			body: JSON.stringify({
				running: true,
				resources: {
					cpu: { capacityCores: 0.25, usedPercent: 40 },
					memory: { totalBytes: 1024 ** 3, usedPercent: 25 },
					disk: { totalBytes: 4 * 1024 ** 3, availableBytes: 1024 ** 3, usedPercent: 75 },
				},
			}),
		}));
		const result = await readCloudWorkspaceState(cloud, host);
		expect(result.ok).toBe(true);
		expect(requests[0]).toMatchObject({
			url: "https://cloud.example.dev",
			method: "GET",
			path: "/w/ws1/state",
		});
		if (result.ok) expect(result.value.running).toBe(true);
	});

	it("refuses a state answer that is not its promised shape", async () => {
		const { cloud } = scripted(() => ({ status: 200, body: '{"running":"yes"}' }));
		const result = await readCloudWorkspaceState(cloud, host);
		expect(result.ok ? null : result.error.code).toBe("cloud_bad_response");
	});

	it("restarts a workspace and needs the Worker to say it did", async () => {
		const { cloud, requests } = scripted(() => ({
			status: 200,
			body: '{"started":true,"readyMs":1400,"instance":"basic"}',
		}));
		expect((await restartCloudWorkspace(cloud, host)).ok).toBe(true);
		expect(requests[0]).toMatchObject({
			method: "POST",
			path: "/w/ws1/restart",
		});
	});

	it("does not claim a restart the Worker did not make", async () => {
		const { cloud } = scripted(() => ({ status: 200, body: '{"started":false}' }));
		const result = await restartCloudWorkspace(cloud, host);
		expect(result.ok ? null : result.error.code).toBe("cloud_bad_response");
	});
});
