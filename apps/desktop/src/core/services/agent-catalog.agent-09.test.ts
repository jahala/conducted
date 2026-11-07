/**
 * @feature AGENT-09 Cursor's signed-in state from the app's own provider key (D084)
 * Owns: tests that the Agents page's Cursor install reads as signed in while a Cursor API key is
 * saved in Settings, through the real provider key table and the in-memory Keychain.
 * Test first: shows Cursor as signed in once its API key is saved.
 */
import { randomUUID } from "node:crypto";
import type { AgentInstall } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { afterEach, describe, expect, it } from "vitest";
import { createTestContainer, type TestContainer } from "../../test/container.ts";
import type { ProviderKeyRef } from "../api.ts";
import { createRepositories } from "../db/repositories.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { AgentCatalogService } from "./agent-catalog.ts";

let test: TestContainer | undefined;

afterEach(() => {
	test?.close();
	test = undefined;
});

const cursorKey: ProviderKeyRef = {
	agent: "cursor",
	acpAgent: null,
	provider: "cursor",
	envVar: "CURSOR_API_KEY",
};

const cursor: AgentInstall = { agent: "cursor", installed: true, authenticated: false };
const claude: AgentInstall = { agent: "claude", installed: true, authenticated: false };

function serviceOver(current: TestContainer, agents: AgentInstall[]): AgentCatalogService {
	const repositories = createRepositories(current.database, {
		clock: { now: () => 1_700_000_000_000 },
		ids: { uuid: () => randomUUID() },
	});
	const request = (async () => ok({ agents })) as unknown as SidecarClient["request"];
	return new AgentCatalogService({
		sidecar: { request },
		launchFor: async () => ok({ env: {}, providerKeys: {} }),
		workspacePathOf: async () => ok("/workspace"),
		repoRootPathOf: async () => ok("/repo"),
		providerKeys: repositories.providerKeys,
		keychain: current.memory.platform.keychain,
	});
}

const installOf = (service: AgentCatalogService, agent: AgentInstall["agent"]) => {
	const installs = service.store.getState().installs;
	return installs.state === "ready"
		? installs.data.find((install) => install.agent === agent)
		: undefined;
};

describe("AGENT-09 Cursor signed in from its provider key", () => {
	it("shows Cursor as signed in once its API key is saved", async () => {
		test = createTestContainer();
		const service = serviceOver(test, [cursor, claude]);
		expect(await service.refresh()).toEqual(ok(undefined));
		expect(installOf(service, "cursor")?.authenticated).toBe(false);

		expect(
			await service.setProviderKey(cursorKey, { kind: "entered", value: "cursor-secret" }),
		).toEqual(ok(undefined));

		expect(installOf(service, "cursor")).toMatchObject({
			authenticated: true,
			authMethod: "api_key",
		});
		expect(installOf(service, "claude")?.authenticated).toBe(false);
	});

	it("keeps Cursor signed in across a refresh, and signs it out when the key is removed", async () => {
		test = createTestContainer();
		const service = serviceOver(test, [cursor]);
		expect(
			await service.setProviderKey(cursorKey, { kind: "entered", value: "cursor-secret" }),
		).toEqual(ok(undefined));

		expect(await service.refresh()).toEqual(ok(undefined));
		expect(installOf(service, "cursor")?.authenticated).toBe(true);

		expect(await service.removeProviderKey(cursorKey)).toEqual(ok(undefined));
		expect(installOf(service, "cursor")?.authenticated).toBe(false);
	});

	it("applies the saved key to an install list the sidecar sends on its own", async () => {
		test = createTestContainer();
		const service = serviceOver(test, [cursor]);
		expect(
			await service.setProviderKey(cursorKey, { kind: "entered", value: "cursor-secret" }),
		).toEqual(ok(undefined));

		service.setInstalls([cursor]);

		expect(installOf(service, "cursor")?.authenticated).toBe(true);
	});
});
