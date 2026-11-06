/**
 * @feature SET-05 MCP servers: list, status and logs
 * Owns: the tests for asking the sidecar for a chat's MCP servers and storing their status.
 * Behaviour: services-map.md 5B.6 (statuses, scope, tools).
 * Test first: a refresh that answers after a newer refresh does not replace the newer list.
 */
import type { AgentLaunch } from "@conducted/protocol";
import { appError, err, ok, type SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { SidecarClient } from "../sidecar/tunnel.ts";
import { McpService, type McpServiceDeps, mcpKey } from "./mcp.ts";

const launch: AgentLaunch = { env: {}, providerKeys: {} };
const sessionId = "session-1" as SessionId;

function serviceWith(
	request: SidecarClient["request"],
	overrides: Partial<McpServiceDeps> = {},
): McpService {
	return new McpService({
		sidecar: { request },
		workspacePathOf: async () => ok("/code/app"),
		agentOf: () => ok({ agent: "claude" }),
		launchFor: async () => ok(launch),
		...overrides,
	});
}

describe("SET-05 MCP server status", () => {
	it("SET-05 asks the sidecar with the chat's launch and maps status, scope and tools", async () => {
		const request = vi.fn().mockResolvedValue(
			ok({
				servers: [
					{
						name: "github",
						status: "connected",
						scope: "project",
						transport: "http",
						tools: ["search", "create_issue"],
					},
					{
						name: "linear",
						status: "needs_auth",
						scope: "user",
						error: "Sign in to Linear.",
					},
					{
						name: "broken",
						status: "failed",
						scope: "local",
						error: "permission denied",
					},
				],
			}),
		);
		const service = serviceWith(request as unknown as SidecarClient["request"]);

		const result = await service.refresh({
			agent: "claude",
			workspacePath: "/code/app",
			sessionId,
		});

		expect(request).toHaveBeenCalledWith("listMcpServers", {
			agent: "claude",
			acpAgent: undefined,
			workspacePath: "/code/app",
			launch,
		});
		expect(result).toEqual(
			ok([
				{
					name: "github",
					source: "project",
					transport: "http",
					status: "connected",
					toolCount: 2,
					error: null,
					logTail: [],
				},
				{
					name: "linear",
					source: "user",
					transport: "stdio",
					status: "needs_auth",
					toolCount: null,
					error: "Sign in to Linear.",
					logTail: ["Sign in to Linear."],
				},
				{
					name: "broken",
					source: "project",
					transport: "stdio",
					status: "failed",
					toolCount: null,
					error: "permission denied",
					logTail: ["permission denied"],
				},
			]),
		);
		const key = mcpKey("/code/app", "claude");
		expect(service.store.getState().servers[key]).toEqual({
			state: "ready",
			data: [
				{
					name: "github",
					source: "project",
					transport: "http",
					status: "connected",
					toolCount: 2,
					error: null,
					logTail: [],
				},
				{
					name: "linear",
					source: "user",
					transport: "stdio",
					status: "needs_auth",
					toolCount: null,
					error: "Sign in to Linear.",
					logTail: ["Sign in to Linear."],
				},
				{
					name: "broken",
					source: "project",
					transport: "stdio",
					status: "failed",
					toolCount: null,
					error: "permission denied",
					logTail: ["permission denied"],
				},
			],
		});
	});

	it("SET-05 keeps the newer list when an older refresh answers last", async () => {
		const pending: ((value: unknown) => void)[] = [];
		const request = ((_method: string, _params: unknown) =>
			new Promise<unknown>((resolve) => {
				pending.push(resolve);
			})) as SidecarClient["request"];
		const service = serviceWith(request);

		const first = service.refresh({ agent: "claude", workspacePath: "/code/app" });
		const second = service.refresh({ agent: "claude", workspacePath: "/code/app" });
		await vi.waitFor(() => expect(pending).toHaveLength(2));

		pending[1]?.(ok({ servers: [{ name: "newer", status: "connected" }] }));
		await second;
		pending[0]?.(ok({ servers: [{ name: "older", status: "failed", error: "old" }] }));
		await first;

		const key = mcpKey("/code/app", "claude");
		expect(service.store.getState().servers[key]).toEqual({
			state: "ready",
			data: [
				{
					name: "newer",
					source: "user",
					transport: "stdio",
					status: "connected",
					toolCount: null,
					error: null,
					logTail: [],
				},
			],
		});
	});

	it("SET-05 stores a failed listing as an error, never an empty list", async () => {
		const request = vi
			.fn()
			.mockResolvedValue(err(appError("mcp_list_failed", "Could not list MCP servers.")));
		const service = serviceWith(request as unknown as SidecarClient["request"]);

		const result = await service.refresh({ agent: "claude", workspacePath: "/code/app" });

		expect(result.ok).toBe(false);
		const key = mcpKey("/code/app", "claude");
		expect(service.store.getState().servers[key]).toEqual({
			state: "error",
			error: appError("mcp_list_failed", "Could not list MCP servers."),
		});
	});

	it("SET-05 refreshes a chat's servers with the chat's agent and workspace", async () => {
		const request = vi.fn().mockResolvedValue(ok({ servers: [] }));
		const service = serviceWith(request as unknown as SidecarClient["request"]);

		const result = await service.refreshSession(sessionId);

		expect(result).toEqual(ok(undefined));
		expect(request).toHaveBeenCalledWith("listMcpServers", {
			agent: "claude",
			acpAgent: undefined,
			workspacePath: "/code/app",
			launch,
		});
	});

	it("SET-05 returns the unknown-chat error without asking the sidecar", async () => {
		const request = vi.fn();
		const service = serviceWith(request as unknown as SidecarClient["request"], {
			agentOf: () => err(appError("session_unknown", "That chat no longer exists.")),
		});

		const result = await service.refreshSession(sessionId);

		expect(result.ok).toBe(false);
		expect(request).not.toHaveBeenCalled();
	});
});
