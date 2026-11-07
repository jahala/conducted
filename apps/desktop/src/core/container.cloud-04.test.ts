// @vitest-environment node
/**
 * @feature CLOUD-04 Sandbox image with git, gh, the agent programs and our sidecar
 * Owns: proof through the real container that a cloud workspace's model list goes over the
 * Worker's relay, never the Mac sidecar, and is stored under that host's key.
 * Behaviour: services-map.md 5B.5.1 (a cloud workspace has its own model list) and CLOUD-03's
 * relay (a chat call for a cloud host opens the Worker's WebSocket).
 * Test first: the cloud relay carries `listModels`, and the local sidecar never sees it.
 */
import type { Host, ModelInfo } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createTestContainer } from "../test/container.ts";
import { modelsKey } from "./services/agent-catalog.ts";

const CLOUD: Host = { kind: "cloud", url: "https://w.example.dev", vmId: "vm-1" };

const CLOUD_MODEL: ModelInfo = {
	id: "cloud-model",
	label: "Cloud model",
	status: "picker",
	isNew: false,
	isDefault: false,
	efforts: ["high"],
	defaultEffort: "high",
	effortAxis: "effort",
	liveEffortChange: false,
	supportsFastMode: false,
};

describe("CLOUD-04 the cloud model list over the Worker's relay", () => {
	it("asks the cloud tunnel and stores the list under the cloud host's key", async () => {
		const test = createTestContainer();
		try {
			const models = test.container.services.agentCatalog.loadModels("claude", undefined, CLOUD);
			const sent = await waitForSent(test.memory.controls, "listModels");
			const request = JSON.parse(sent.line) as { id: number };
			test.memory.controls.emitCloudLine(
				sent.relayId,
				`${JSON.stringify({
					jsonrpc: "2.0",
					id: request.id,
					result: { models: [CLOUD_MODEL] },
				})}\n`,
			);

			expect(await models).toEqual(ok([CLOUD_MODEL]));
			expect(test.memory.controls.sidecarSent.some((line) => line.includes('"listModels"'))).toBe(
				false,
			);
			expect(
				test.container.services.agentCatalog.store.getState().models[modelsKey(CLOUD, "claude")],
			).toEqual({ state: "ready", data: [CLOUD_MODEL] });
		} finally {
			test.container.services.repo.dispose();
			test.close();
		}
	});
});

/** Waits for the app to send `method` on a cloud relay; the bound is a hang guard, not a delay. */
async function waitForSent(
	controls: { readonly cloudSent: readonly { relayId: string; line: string }[] },
	method: string,
): Promise<{ relayId: string; line: string }> {
	for (let attempt = 0; attempt < 500; attempt++) {
		const found = controls.cloudSent.find((sent) => sent.line.includes(`"${method}"`));
		if (found !== undefined) return found;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`the app never sent ${method} on a cloud relay`);
}
