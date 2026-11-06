/**
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: the tests for a repository's saved slash commands, loaded without a workspace path.
 * Behaviour: research/conductor/native-and-sidecar-map.md B3 and D1.
 * Test first: the request carries the repository root and no workspacePath, and the answer is
 * stored under that repository and agent.
 */
import type { SlashCommand } from "@conducted/protocol";
import { ok } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { AgentCatalogService, preWorkspaceSlashKey } from "./agent-catalog.ts";

const review: SlashCommand = {
	name: "review",
	description: "Review the changes",
	source: "project",
	kind: "command",
};
const skill: SlashCommand = {
	name: "skill-creator",
	description: "Create a skill",
	source: "user",
	kind: "skill",
};

function serviceWith(request: SidecarClient["request"]): AgentCatalogService {
	return new AgentCatalogService({
		sidecar: { request },
		workspacePathOf: async () => ok("/workspace"),
		repoRootPathOf: async () => ok("/repo"),
	});
}

describe("SIDE-22 repository slash commands before a workspace", () => {
	it("SIDE-22 asks for the repository's cached list without a workspace path", async () => {
		const request = vi.fn().mockResolvedValue(ok({ commands: [review, skill], fromCache: true }));
		const service = serviceWith(request as unknown as SidecarClient["request"]);

		const result = await service.loadPreWorkspaceSlashCommands("/code/app", "claude");

		expect(result).toEqual(ok([review, skill]));
		expect(request).toHaveBeenCalledWith("listSlashCommands", {
			agent: "claude",
			acpAgent: undefined,
			repoRootPath: "/code/app",
		});
		const key = preWorkspaceSlashKey("/code/app", "claude");
		expect(service.store.getState().preWorkspaceSlashCommands?.[key]).toEqual({
			state: "ready",
			data: [review, skill],
		});
	});

	it("SIDE-22 keeps the newer answer when two requests for one repository answer out of order", async () => {
		const pending: ((value: unknown) => void)[] = [];
		const request = ((_method: string, _params: unknown) =>
			new Promise<unknown>((resolve) => {
				pending.push(resolve);
			})) as SidecarClient["request"];
		const service = serviceWith(request);

		const first = service.loadPreWorkspaceSlashCommands("/code/app", "claude");
		const second = service.loadPreWorkspaceSlashCommands("/code/app", "claude");
		await vi.waitFor(() => expect(pending).toHaveLength(2));

		pending[1]?.(ok({ commands: [skill], fromCache: true }));
		expect(await second).toEqual(ok([skill]));
		pending[0]?.(ok({ commands: [review], fromCache: true }));
		await first;

		const key = preWorkspaceSlashKey("/code/app", "claude");
		expect(service.store.getState().preWorkspaceSlashCommands?.[key]).toEqual({
			state: "ready",
			data: [skill],
		});
	});

	it("SIDE-22 stores the sidecar's failure for that repository", async () => {
		const request = vi.fn().mockResolvedValue({
			ok: false,
			error: { code: "cache_read_failed", message: "Could not read the cache." },
		});
		const service = serviceWith(request as unknown as SidecarClient["request"]);

		const result = await service.loadPreWorkspaceSlashCommands("/code/app", "claude");

		expect(result.ok).toBe(false);
		const key = preWorkspaceSlashKey("/code/app", "claude");
		const stored = service.store.getState().preWorkspaceSlashCommands?.[key];
		expect(stored?.state).toBe("error");
	});
});
