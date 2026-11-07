// @vitest-environment node
/**
 * @feature CLOUD-03 The user's Worker and one Durable Object per workspace: routes, state, keep-alive, relay
 * Tests the host-routed sidecar: a cloud chat's call goes to the cloud tunnel with the placeholder
 * key, and a Mac chat's call goes to the local tunnel with its own key unchanged.
 */
import type { Host } from "@conducted/protocol";
import { ok, type Result } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { createHostRoutedSidecar, withoutProviderKeys } from "./router.ts";

const CLOUD: Host = { kind: "cloud", url: "https://w.example.dev", vmId: "oslo" };
const LOCAL: Host = { kind: "local" };

const launch = (value: string) => ({
	executablePath: undefined,
	env: {},
	providerKeys: { ANTHROPIC_API_KEY: { value, source: "entered" as const } },
});

/** Records the params each tunnel receives; the answer does not matter to the routing. */
function recorder(): { client: SidecarClient; calls: { side: string; params: unknown }[] } {
	const calls: { side: string; params: unknown }[] = [];
	const record =
		(side: string) =>
		async (_method: never, params: unknown): Promise<Result<never>> => {
			calls.push({ side, params });
			return ok(undefined as never);
		};
	const client = { request: record("local"), notify: record("local") } as unknown as SidecarClient;
	return { client, calls };
}

describe("CLOUD-03 the host-routed sidecar", () => {
	it("a cloud chat's sendMessage goes to the cloud tunnel with the placeholder, and a local chat's goes to the local tunnel with its key", async () => {
		const local = recorder();
		const cloud = recorder();
		const routed = createHostRoutedSidecar({
			local: local.client,
			tunnelFor: () => cloud.client,
			hostOf: (_method, params) => {
				const host = (params as { workspace?: { host?: Host } }).workspace?.host;
				return host?.kind === "cloud" ? host : null;
			},
		});

		await routed.request("sendMessage", {
			workspace: { host: CLOUD },
			config: { agent: "claude" },
			launch: launch("sk-real-cloud"),
		} as never);
		expect(local.calls).toHaveLength(0);
		expect(cloud.calls).toHaveLength(1);
		const sent = cloud.calls[0]?.params as {
			launch: { executablePath?: string; providerKeys: Record<string, { value: string }> };
		};
		expect(sent.launch.providerKeys.ANTHROPIC_API_KEY?.value).toBe("provided-by-worker");
		expect(sent.launch.executablePath).toBe("/usr/local/bin/claude");

		await routed.request("sendMessage", {
			workspace: { host: LOCAL },
			launch: launch("sk-real-mac"),
		} as never);
		expect(cloud.calls).toHaveLength(1);
		const kept = local.calls[0]?.params as {
			launch: { providerKeys: Record<string, { value: string }> };
		};
		expect(kept.launch.providerKeys.ANTHROPIC_API_KEY?.value).toBe("sk-real-mac");
	});

	it("leaves a method without a launch alone", () => {
		const params = { sessionId: "s1" };
		expect(withoutProviderKeys("getSessionStatus", params)).toBe(params);
	});
});
