// @vitest-environment node
/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Tests the relay transport the sidecar tunnel uses for a cloud workspace: opening, receiving,
 * sending, and turning a closed relay into the tunnel's restart signal.
 */
import { describe, expect, it } from "vitest";
import { createMemoryPlatform } from "../../platform/memory.ts";
import { unusedDatabase } from "../../test/memory-platform.ts";
import { createCloudTransport } from "./transport.ts";

const CLOUD = { kind: "cloud" as const, url: "https://w.example.dev", vmId: "oslo" };

function transportWithCloud() {
	const memory = createMemoryPlatform({
		clock: { now: () => 1_700_000_000_000 },
		ids: { uuid: () => crypto.randomUUID() },
		database: unusedDatabase,
	});
	return {
		memory,
		transport: createCloudTransport(memory.platform.cloud, CLOUD),
	};
}

describe("CLOUD-03 the cloud relay transport", () => {
	it("open, send and receive one line, then a closed relay reports one restart", async () => {
		const { memory, transport } = transportWithCloud();
		expect((await transport.ensureStarted()).ok).toBe(true);
		const relayId = memory.controls.cloudRelayIds[0];
		expect(relayId).toBeDefined();
		if (relayId === undefined) return;

		const heard: string[] = [];
		transport.onLine((line) => heard.push(line));
		memory.controls.emitCloudLine(relayId, "hel");
		memory.controls.emitCloudLine(relayId, "lo\n");
		expect(heard).toEqual(["hello"]);

		expect((await transport.send('{"jsonrpc":"2.0"}')).ok).toBe(true);
		expect(memory.controls.cloudSent.at(-1)?.line).toBe('{"jsonrpc":"2.0"}');
		expect((await transport.send('{"jsonrpc":"2.0"}\n')).ok).toBe(false);

		let restarts = 0;
		transport.onRestart(() => {
			restarts += 1;
		});
		memory.controls.emitCloudClosed(relayId, "the Worker closed it");
		expect(restarts).toBe(1);
		expect((await transport.send("after")).ok).toBe(false);

		// A restart opens a new relay, as the tunnel's reconnect expects.
		expect((await transport.ensureStarted()).ok).toBe(true);
		expect(memory.controls.cloudRelayIds).toHaveLength(1);
		await transport.close();
		expect(memory.controls.cloudRelayIds).toHaveLength(0);
	});
});
