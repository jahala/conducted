/**
 * @feature SIDE-16 Slash commands and MCP server listing
 * Owns: the tests for answering listSlashCommands and listMcpServers in slash-and-mcp.ts.
 * Behaviour: research/conductor/claude-runner.md section 7 and other-runners.md sections 1 and 6:
 * a runner that cannot list returns an empty list, and a runner failure stays an error value.
 * Test first: for an agent whose capabilities.slashCommands is false the lister returns an empty
 * list without calling the runner.
 */
import { describe, expect, test } from "bun:test";
import type { AgentKind } from "@conducted/shared";
import { appError } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import { MapRunnerRegistry, type RunnerSelector } from "../runners/registry.ts";
import type {
	AgentSession,
	McpServerView,
	Runner,
	RunnerSlashCommand,
	StartOptions,
} from "../runners/runner.ts";
import { loginShellOver } from "../test-support/login-shell.ts";
import {
	MCP_LIST_FAILED,
	MCP_LIST_UNSUPPORTED,
	RunnerMcpServerLister,
	RunnerSlashCommandLister,
	SLASH_COMMANDS_FAILED,
} from "./slash-and-mcp.ts";

type ListedCommand = RunnerSlashCommand;
type ListedServer = McpServerView;

function fakeLogger() {
	return createLogger({
		sink: () => {},
		clock: { now: () => 0 },
		level: "error",
		scope: "test",
	});
}

interface FakeRunnerOptions {
	slashCommands?: boolean;
	mcpServers?: boolean;
	listSlashCommands?: () => Promise<ListedCommand[]>;
	listMcpServers?: (workspacePath: string) => Promise<ListedServer[]>;
}

function fakeRunner(agent: AgentKind, options: FakeRunnerOptions = {}): Runner {
	const runner: Runner = {
		agent,
		capabilities: {
			steer: false,
			interrupt: false,
			resumeAt: false,
			liveConfig: false,
			slashCommands: options.slashCommands ?? false,
			mcpServers: options.mcpServers ?? false,
			contextUsage: false,
		},
		detect: async () => null,
		start: async (_options: StartOptions): Promise<AgentSession> => {
			throw new Error("start is not used by the listers");
		},
		listModels: async () => [],
		listSlashCommands: options.listSlashCommands ?? (async () => []),
	};
	if (options.listMcpServers !== undefined) runner.listMcpServers = options.listMcpServers;
	return runner;
}

function listers(
	runner: Runner,
	selector: RunnerSelector = { agent: runner.agent },
): { slash: RunnerSlashCommandLister; mcp: RunnerMcpServerLister } {
	const runners = new MapRunnerRegistry([{ selector, runner }]);
	const logger = fakeLogger();
	return {
		slash: new RunnerSlashCommandLister({
			runners,
			shellEnv: loginShellOver({ PATH: "/usr/bin" }, logger),
			logger,
		}),
		mcp: new RunnerMcpServerLister({
			runners,
			shellEnv: loginShellOver({ PATH: "/usr/bin" }, logger),
			logger,
		}),
	};
}

describe("SIDE-16 slash commands", () => {
	test("an agent without the slash-command capability returns an empty list without calling the runner", async () => {
		let called = false;
		const runner = fakeRunner("cursor", {
			slashCommands: false,
			listSlashCommands: async () => {
				called = true;
				return [];
			},
		});

		const listed = await listers(runner).slash.list("cursor", undefined, "/work/app");

		expect(listed.ok).toBe(true);
		expect(listed.ok && listed.value).toEqual([]);
		expect(called).toBe(false);
	});

	test("maps the runner's entries to protocol commands and keeps the reported source", async () => {
		const claude = fakeRunner("claude", {
			slashCommands: true,
			listSlashCommands: async () => [
				{ name: "compact", description: "Compact the conversation", source: "builtin" },
				{
					name: "review",
					description: "Review changes",
					argumentHint: "[path]",
					source: "project",
				},
				{ name: "mcp__github__search", description: "Search GitHub", source: "mcp" },
			],
		});

		const listed = await listers(claude).slash.list("claude", undefined, "/work/app");

		expect(listed.ok && listed.value).toEqual([
			{
				name: "compact",
				description: "Compact the conversation",
				source: "builtin",
				kind: "command",
			},
			{
				name: "review",
				description: "Review changes",
				argumentHint: "[path]",
				source: "project",
				kind: "command",
			},
			{
				name: "mcp__github__search",
				description: "Search GitHub",
				source: "mcp",
				kind: "command",
			},
		]);

		const codex = fakeRunner("codex", {
			slashCommands: true,
			listSlashCommands: async () => [
				{ name: "skill-creator", description: "Create a skill", source: "user", kind: "skill" },
			],
		});

		const skills = await listers(codex).slash.list("codex", undefined, "/work/app");

		expect(skills.ok && skills.value).toEqual([
			{ name: "skill-creator", description: "Create a skill", source: "user", kind: "skill" },
		]);
	});

	test("falls back to builtin for an unlabelled command and to skill for unlabelled Codex entries", async () => {
		const claude = fakeRunner("claude", {
			slashCommands: true,
			listSlashCommands: async () => [{ name: "clear", description: "Start a fresh chat" }],
		});

		const listed = await listers(claude).slash.list("claude", undefined, "/work/app");

		expect(listed.ok && listed.value).toEqual([
			{ name: "clear", description: "Start a fresh chat", source: "builtin", kind: "command" },
		]);

		const codex = fakeRunner("codex", {
			slashCommands: true,
			listSlashCommands: async () => [{ name: "skill-creator", description: "Create a skill" }],
		});

		const skills = await listers(codex).slash.list("codex", undefined, "/work/app");

		expect(skills.ok && skills.value).toEqual([
			{ name: "skill-creator", description: "Create a skill", source: "builtin", kind: "skill" },
		]);
	});

	test("keeps the runner's AppError code when listing fails", async () => {
		const runner = fakeRunner("claude", {
			slashCommands: true,
			listSlashCommands: async () => {
				throw appError("agent_not_signed_in", "Sign in to Claude first");
			},
		});

		const listed = await listers(runner).slash.list("claude", undefined, "/work/app");

		expect(!listed.ok && listed.error.code).toBe("agent_not_signed_in");
	});

	test("wraps any other failure under the slash-command failure code", async () => {
		const runner = fakeRunner("claude", {
			slashCommands: true,
			listSlashCommands: async () => {
				throw new Error("process exited");
			},
		});

		const listed = await listers(runner).slash.list("claude", undefined, "/work/app");

		expect(!listed.ok && listed.error.code).toBe(SLASH_COMMANDS_FAILED);
		expect(!listed.ok && listed.error.message).toContain("process exited");
	});

	test("passes an unknown agent's error through instead of inventing an empty list", async () => {
		const runners = new MapRunnerRegistry([]);
		const slash = new RunnerSlashCommandLister({
			runners,
			shellEnv: loginShellOver({ PATH: "/usr/bin" }, fakeLogger()),
			logger: fakeLogger(),
		});

		const listed = await slash.list("claude", undefined, "/work/app");

		expect(!listed.ok && listed.error.code).toBe("runner_unknown");
	});
});

describe("SIDE-16 MCP servers", () => {
	test("an agent without the MCP capability returns an empty list without calling the runner", async () => {
		let called = false;
		const runner = fakeRunner("cursor", {
			mcpServers: false,
			listMcpServers: async () => {
				called = true;
				return [];
			},
		});

		const listed = await listers(runner).mcp.list("cursor", undefined, "/work/app");

		expect(listed.ok).toBe(true);
		expect(listed.ok && listed.value).toEqual([]);
		expect(called).toBe(false);
	});

	test("lists a capable agent's MCP servers with status, error text and tool names", async () => {
		const runner = fakeRunner("claude", {
			mcpServers: true,
			listMcpServers: async () => [
				{
					name: "github",
					status: "connected",
					toolCount: 2,
					tools: ["search", "create_issue"],
					scope: "user",
					transport: "http",
				},
				{
					name: "linear",
					status: "failed",
					error: "connection refused",
					scope: "project",
					transport: "stdio",
				},
			],
		});

		const listed = await listers(runner).mcp.list("claude", undefined, "/work/app");

		expect(listed.ok && listed.value).toEqual([
			{
				name: "github",
				status: "connected",
				toolCount: 2,
				tools: ["search", "create_issue"],
				scope: "user",
				transport: "http",
			},
			{
				name: "linear",
				status: "failed",
				error: "connection refused",
				scope: "project",
				transport: "stdio",
			},
		]);
	});

	test("a capable runner with no listing operation gives a typed error, not an empty list", async () => {
		const runner = fakeRunner("claude", { mcpServers: true });

		const listed = await listers(runner).mcp.list("claude", undefined, "/work/app");

		expect(!listed.ok && listed.error.code).toBe(MCP_LIST_UNSUPPORTED);
	});

	test("keeps the runner's AppError code when listing fails", async () => {
		const runner = fakeRunner("claude", {
			mcpServers: true,
			listMcpServers: async () => {
				throw appError("mcp_unavailable", "The MCP bridge is down");
			},
		});

		const listed = await listers(runner).mcp.list("claude", undefined, "/work/app");

		expect(!listed.ok && listed.error.code).toBe("mcp_unavailable");
	});

	test("wraps any other failure under the MCP failure code", async () => {
		const runner = fakeRunner("claude", {
			mcpServers: true,
			listMcpServers: async () => {
				throw new Error("socket closed");
			},
		});

		const listed = await listers(runner).mcp.list("claude", undefined, "/work/app");

		expect(!listed.ok && listed.error.code).toBe(MCP_LIST_FAILED);
		expect(!listed.ok && listed.error.message).toContain("socket closed");
	});

	test("an ACP agent without its adapter passes the registry's error through", async () => {
		const runner = fakeRunner("acp", { mcpServers: true });

		const listed = await listers(runner, { agent: "acp", acpAgent: "opencode" }).mcp.list(
			"acp",
			undefined,
			"/work/app",
		);

		expect(!listed.ok && listed.error.code).toBe("acp_agent_missing");
	});
});
