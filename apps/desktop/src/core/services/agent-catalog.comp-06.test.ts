// @vitest-environment node
import type { SlashCommand } from "@conducted/protocol";
import { appError, err, ok, type Result } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace } from "../../test/container.ts";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { AgentCatalogService } from "./agent-catalog.ts";

const compact: SlashCommand = {
	name: "compact",
	description: "Compact the context window",
	source: "builtin",
	kind: "command",
};
const review: SlashCommand = {
	name: "review",
	description: "Review the changes",
	source: "project",
	kind: "command",
};

function serviceWith(
	request: SidecarClient["request"],
	workspacePathOf = async (): Promise<Result<string>> => ok("/workspace"),
): AgentCatalogService {
	return new AgentCatalogService({
		sidecar: { request },
		workspacePathOf,
	});
}

describe("COMP-06 slash commands are loaded", () => {
	it("asks the sidecar for the agent's commands in the chat's workspace", async () => {
		const request = vi
			.fn()
			.mockResolvedValue(ok({ commands: [compact, review], fromCache: false }));
		const service = serviceWith(request as unknown as SidecarClient["request"]);

		const result = await service.loadSlashCommands("chat-1" as never, "claude");

		expect(result).toEqual(ok([compact, review]));
		expect(request).toHaveBeenCalledWith("listSlashCommands", {
			agent: "claude",
			acpAgent: undefined,
			workspacePath: "/workspace",
			repoRootPath: "/workspace",
		});
		expect(service.store.getState().slashCommands["chat-1"]).toEqual({
			state: "ready",
			data: [compact, review],
		});
	});

	it("keeps the newer list when two requests for one chat answer out of order", async () => {
		const pending: ((value: unknown) => void)[] = [];
		const request = ((_method: string, _params: unknown) =>
			new Promise<unknown>((resolve) => {
				pending.push(resolve);
			})) as SidecarClient["request"];
		const service = serviceWith(request);

		const first = service.loadSlashCommands("chat-1" as never, "claude");
		const second = service.loadSlashCommands("chat-1" as never, "claude");
		await vi.waitFor(() => expect(pending).toHaveLength(2));

		pending[1]?.(ok({ commands: [review], fromCache: false }));
		expect(await second).toEqual(ok([review]));
		pending[0]?.(ok({ commands: [compact], fromCache: false }));
		await first;

		expect(service.store.getState().slashCommands["chat-1"]).toEqual({
			state: "ready",
			data: [review],
		});
	});

	it("shows the failure when the chat's workspace cannot be found", async () => {
		const failure = appError("session_unknown", "That chat no longer exists.");
		const request = vi.fn();
		const service = serviceWith(request as unknown as SidecarClient["request"], async () =>
			err(failure),
		);

		const result = await service.loadSlashCommands("chat-1" as never, "claude");

		expect(result).toEqual(err(failure));
		expect(request).not.toHaveBeenCalled();
		expect(service.store.getState().slashCommands["chat-1"]).toEqual({
			state: "error",
			error: failure,
		});
	});

	it("keeps the sidecar's failure in the store", async () => {
		const failure = appError("slash_commands_failed", "Could not list slash commands");
		const request = vi.fn().mockResolvedValue(err(failure));
		const service = serviceWith(request as unknown as SidecarClient["request"]);

		const result = await service.loadSlashCommands("chat-1" as never, "codex");

		expect(result).toEqual(err(failure));
		expect(service.store.getState().slashCommands["chat-1"]).toEqual({
			state: "error",
			error: failure,
		});
	});
});

describe("COMP-06 slash commands through the app container", () => {
	it("loads the chat agent's commands from the real service", async () => {
		const test = createTestContainer();
		try {
			const workspace = await seedWorkspace(test.container);
			const created = await test.container.services.sessions.create(workspace.id, {
				agent: "claude",
				model: "default",
				effort: "high",
				fastMode: false,
				planMode: false,
				requireToolApproval: false,
				additionalDirectories: [],
				appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
			});
			if (!created.ok) throw new Error("could not create a chat");
			const request = vi
				.spyOn(test.container.sidecar, "request")
				.mockResolvedValue(ok({ commands: [compact], fromCache: false }));

			const result = await test.container.services.agentCatalog.loadSlashCommands(
				created.value.id,
				"claude",
			);

			expect(result).toEqual(ok([compact]));
			expect(request).toHaveBeenCalledWith("listSlashCommands", {
				agent: "claude",
				acpAgent: undefined,
				workspacePath: workspace.path,
				repoRootPath: workspace.path,
			});
			expect(
				test.container.services.agentCatalog.store.getState().slashCommands[created.value.id],
			).toEqual({
				state: "ready",
				data: [compact],
			});
		} finally {
			test.close();
		}
	});
});
