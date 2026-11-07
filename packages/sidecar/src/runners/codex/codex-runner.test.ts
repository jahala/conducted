/**
 * @feature AGENT-06 Codex: threads, steer, interrupt (runner)
 * Owns: tests for finding Codex, reading its version, the model list pages and the skills list of
 * codex-runner.ts.
 * Test first: detect() parses "codex-cli 0.154.0" to version "0.154.0".
 */
import { describe, expect, test } from "bun:test";
import type { Interaction, SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { AppError, Result, SessionId, ToolUseId, WorkspaceId } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import { createLogger } from "../../logging/logger.ts";
import { FakeChild, type JsonRpcMessage } from "../../test-support/fake-child.ts";
import { managedProgramFinder } from "../../test-support/managed-programs.ts";
import type { ProbeCommand } from "../deps.ts";
import type { TurnCallbacks } from "../runner.ts";
import type { JsonRpcChild, SpawnJsonRpcChild } from "./app-server-client.ts";
import { CodexRunner } from "./codex-runner.ts";

function logger() {
	return createLogger({
		sink: () => {},
		clock: { now: () => 0 },
		level: "error",
		scope: "test:codex",
	});
}

function makeRunner(options: {
	spawn?: SpawnJsonRpcChild;
	probe?: ProbeCommand;
	findExecutable?: (name: string) => Promise<string | null>;
	released?: string[];
}): CodexRunner {
	return new CodexRunner({
		logger: logger(),
		clock: { now: () => 0 },
		ids: (() => {
			let next = 0;
			return {
				uuid: () => {
					next += 1;
					return `id-${next}`;
				},
			};
		})(),
		probe:
			options.probe ?? (async () => ok({ stdout: "codex-cli 0.154.0", stderr: "", exitCode: 0 })),
		findExecutable: async (name) => {
			if (options.findExecutable === undefined) return `/fake/${name}`;
			return options.findExecutable(name);
		},
		findManagedProgram: managedProgramFinder({ codex: "/fake/codex" }),
		spawn: options.spawn ?? (async () => err(appError("spawn_failed", "not used"))),
		random: () => 0,
		sleep: async () => {},
		appToolsConfig: async (start) => ({
			args: [],
			env: {},
			release: () => {
				options.released?.push(start.sessionId);
			},
		}),
	});
}

function answerInitialize(child: FakeChild): void {
	child.onWrite = (message) => {
		if (message.method === "initialize" && message.id !== undefined) {
			queueMicrotask(() => {
				child.emit({ jsonrpc: "2.0", id: message.id, result: { serverVersion: "0.154.0" } });
			});
		}
	};
}

describe("AGENT-06 Codex runner", () => {
	test("detect parses codex-cli 0.154.0 to version 0.154.0", async () => {
		const runner = makeRunner({});

		const found = await runner.detect({ PATH: "/usr/bin" });

		expect(found).toEqual({ path: "/fake/codex", version: "0.154.0" });
	});

	test("detect returns null when codex is not on PATH and does not probe", async () => {
		let probed = false;
		const runner = makeRunner({
			findExecutable: async () => null,
			probe: async () => {
				probed = true;
				return ok({ stdout: "", stderr: "", exitCode: 0 });
			},
		});

		expect(await runner.detect({ PATH: "" })).toBeNull();
		expect(probed).toBe(false);
	});

	test("detect reports an installed program with no version when the probe fails", async () => {
		const runner = makeRunner({
			probe: async () => err(appError("probe_failed", "timed out")),
		});

		expect(await runner.detect({ PATH: "/usr/bin" })).toEqual({
			path: "/fake/codex",
			version: "",
		});
	});

	test("listModels pages through model/list, drops hidden models and maps efforts", async () => {
		const child = new FakeChild();
		answerInitialize(child);
		const modelRequests: { cursor: unknown; includeHidden: unknown }[] = [];
		child.onWrite = (message: JsonRpcMessage) => {
			if (message.method === "initialize" && message.id !== undefined) {
				queueMicrotask(() => {
					child.emit({ jsonrpc: "2.0", id: message.id, result: { serverVersion: "0.154.0" } });
				});
				return;
			}
			if (message.method === "model/list" && message.id !== undefined) {
				const params = message.params as { cursor: unknown; includeHidden: unknown };
				modelRequests.push(params);
				const nextCursor = params.cursor === null ? "page-2" : null;
				const data =
					params.cursor === null
						? [
								{
									id: "gpt-visible",
									model: "gpt-visible",
									displayName: "GPT Visible",
									hidden: false,
									supportedReasoningEfforts: [
										{ reasoningEffort: "low" },
										{ reasoningEffort: "max" },
									],
									defaultReasoningEffort: "low",
									isDefault: true,
								},
								{
									id: "gpt-hidden",
									model: "gpt-hidden",
									displayName: "GPT Hidden",
									hidden: true,
									supportedReasoningEfforts: [],
									defaultReasoningEffort: "medium",
									isDefault: false,
								},
							]
						: [
								{
									id: "gpt-second",
									model: "gpt-second",
									displayName: "GPT Second",
									hidden: false,
									supportedReasoningEfforts: [
										{ reasoningEffort: "minimal" },
										{ reasoningEffort: "high" },
									],
									defaultReasoningEffort: "minimal",
									isDefault: false,
								},
							];
				queueMicrotask(() => {
					child.emit({ jsonrpc: "2.0", id: message.id, result: { data, nextCursor } });
				});
			}
		};
		const spawn: SpawnJsonRpcChild = async () => ok(child) as Result<JsonRpcChild, AppError>;
		const runner = makeRunner({ spawn });
		await runner.detect({ PATH: "/usr/bin" });

		const models = await runner.listModels({ env: {} });

		expect(models.map((model) => model.id)).toEqual(["gpt-visible", "gpt-second"]);
		expect(models[0]?.efforts).toEqual(["low", "max"]);
		expect(models[0]?.defaultEffort).toBe("low");
		expect(models[0]?.isDefault).toBe(true);
		expect(models[1]?.efforts).toEqual(["high"]);
		expect(models[1]?.defaultEffort).toBe("high");
		expect(modelRequests).toEqual([
			{ cursor: null, includeHidden: true },
			{ cursor: "page-2", includeHidden: true },
		]);
		expect(child.stopped).toBe(true);
	});

	test("account reads the Codex sign-in through account/read", async () => {
		const child = new FakeChild();
		child.onWrite = (message: JsonRpcMessage) => {
			if (message.method === "initialize" && message.id !== undefined) {
				queueMicrotask(() => {
					child.emit({ jsonrpc: "2.0", id: message.id, result: { serverVersion: "0.154.0" } });
				});
				return;
			}
			if (message.method === "account/read" && message.id !== undefined) {
				queueMicrotask(() => {
					child.emit({
						jsonrpc: "2.0",
						id: message.id,
						result: { account: { type: "chatgpt" } },
					});
				});
			}
		};
		const spawn: SpawnJsonRpcChild = async () => ok(child) as Result<JsonRpcChild, AppError>;
		const runner = makeRunner({ spawn });

		const account = await runner.account({ PATH: "/usr/bin" });

		expect(account.ok && account.value).toEqual({
			authenticated: true,
			authMethod: "chatgpt",
		});
		expect(child.stopped).toBe(true);
	});

	test("listSlashCommands reads codex skills with their scope and kind", async () => {
		const child = new FakeChild();
		answerInitialize(child);
		child.onWrite = (message: JsonRpcMessage) => {
			if (message.method === "initialize" && message.id !== undefined) {
				queueMicrotask(() => {
					child.emit({ jsonrpc: "2.0", id: message.id, result: { serverVersion: "0.154.0" } });
				});
				return;
			}
			if (message.method === "skills/list" && message.id !== undefined) {
				queueMicrotask(() => {
					child.emit({
						jsonrpc: "2.0",
						id: message.id,
						result: {
							data: [
								{
									cwd: "/workspace",
									skills: [
										{
											name: "review",
											description: "Review a diff",
											argumentHint: "<path>",
											scope: "repo",
										},
										{ name: "mine", description: "My skill", scope: "user" },
										{ name: "packaged", description: "From a plugin", pluginId: "p1" },
									],
									errors: [],
								},
							],
						},
					});
				});
			}
		};
		const spawn: SpawnJsonRpcChild = async () => ok(child) as Result<JsonRpcChild, AppError>;
		const runner = makeRunner({ spawn });
		await runner.detect({ PATH: "/usr/bin" });

		const commands = await runner.listSlashCommands("/workspace", { env: {} });

		expect(commands).toEqual([
			{
				name: "review",
				description: "Review a diff",
				argumentHint: "<path>",
				source: "project",
				kind: "skill",
			},
			{ name: "mine", description: "My skill", source: "user", kind: "skill" },
			{ name: "packaged", description: "From a plugin", source: "plugin", kind: "skill" },
		]);
	});
});

describe("SIDE-16 Codex MCP server listing", () => {
	test("listMcpServers maps state, tools, error text and plugin scope and closes the client", async () => {
		const child = new FakeChild();
		answerInitialize(child);
		child.onWrite = (message: JsonRpcMessage) => {
			if (message.method === "initialize" && message.id !== undefined) {
				queueMicrotask(() => {
					child.emit({ jsonrpc: "2.0", id: message.id, result: { serverVersion: "0.154.0" } });
				});
				return;
			}
			if (message.method === "mcpServerStatus/list" && message.id !== undefined) {
				queueMicrotask(() => {
					child.emit({
						jsonrpc: "2.0",
						id: message.id,
						result: {
							data: [
								{
									name: "github",
									runtimeStatus: "connected",
									pluginId: null,
									tools: { search: { name: "search" } },
									toolsError: null,
									authStatus: "oAuth",
								},
								{
									name: "linear",
									runtimeStatus: "failed",
									pluginId: null,
									tools: {},
									toolsError: "connection refused",
									authStatus: "unsupported",
								},
								{
									name: "packaged",
									runtimeStatus: "authenticationRequired",
									pluginId: "p1",
									tools: {},
									toolsError: null,
									authStatus: "notLoggedIn",
								},
							],
							nextCursor: null,
						},
					});
				});
			}
		};
		const spawn: SpawnJsonRpcChild = async () => ok(child) as Result<JsonRpcChild, AppError>;
		const runner = makeRunner({ spawn });
		await runner.detect({ PATH: "/usr/bin" });

		const servers = await runner.listMcpServers("/workspace", { env: {} });

		expect(servers).toEqual([
			{
				name: "github",
				status: "connected",
				tools: ["search"],
				toolCount: 1,
			},
			{
				name: "linear",
				status: "failed",
				tools: [],
				toolCount: 0,
				error: "connection refused",
			},
			{
				name: "packaged",
				status: "needs_auth",
				scope: "plugin",
				tools: [],
				toolCount: 0,
			},
		]);
		expect(child.stopped).toBe(true);
	});

	test("listMcpServers pages until nextCursor is null", async () => {
		const child = new FakeChild();
		answerInitialize(child);
		const cursors: unknown[] = [];
		child.onWrite = (message: JsonRpcMessage) => {
			if (message.method === "initialize" && message.id !== undefined) {
				queueMicrotask(() => {
					child.emit({ jsonrpc: "2.0", id: message.id, result: { serverVersion: "0.154.0" } });
				});
				return;
			}
			if (message.method === "mcpServerStatus/list" && message.id !== undefined) {
				const params = message.params as { cursor: unknown };
				cursors.push(params.cursor);
				const nextCursor = params.cursor === null ? "page-2" : null;
				const name = params.cursor === null ? "first" : "second";
				queueMicrotask(() => {
					child.emit({
						jsonrpc: "2.0",
						id: message.id,
						result: {
							data: [
								{
									name,
									runtimeStatus: "connected",
									pluginId: null,
									tools: {},
									toolsError: null,
									authStatus: "unsupported",
								},
							],
							nextCursor,
						},
					});
				});
			}
		};
		const spawn: SpawnJsonRpcChild = async () => ok(child) as Result<JsonRpcChild, AppError>;
		const runner = makeRunner({ spawn });
		await runner.detect({ PATH: "/usr/bin" });

		const servers = await runner.listMcpServers("/workspace", { env: {} });

		expect(cursors).toEqual([null, "page-2"]);
		expect(servers.map((server) => server.name)).toEqual(["first", "second"]);
	});
});

describe("SIDE-21 and SIDE-13 a Codex chat's program and app tools token", () => {
	const config: SessionConfig = {
		agent: "codex",
		model: "gpt-5",
		effort: "medium",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
	};
	const workspace: WorkspaceContext = {
		workspaceId: "w1" as WorkspaceId,
		workspaceName: "lisbon",
		workspacePath: "/work/lisbon",
		repoRootPath: "/work/lisbon",
		targetBranch: "origin/main",
		placeholderBranch: false,
		host: { kind: "local" },
		port: 5100,
	};
	const callbacks: TurnCallbacks = {
		onMessage: () => {},
		requestInteraction: () => Promise.reject(new Error("No interaction is expected.")),
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
	};

	test("SIDE-21 the program path from the chat's launch is the one Codex starts", async () => {
		const commands: string[] = [];
		const runner = makeRunner({
			findExecutable: async (name) => (name === "codex" ? "/usr/local/bin/codex" : name),
			spawn: async (options) => {
				commands.push(options.command);
				return err(appError("spawn_failed", "scripted"));
			},
		});

		const session = await runner.start({
			sessionId: "s1" as SessionId,
			config,
			workspace,
			env: { PATH: "/usr/local/bin" },
			executablePath: "/opt/codex/bin/codex",
		});
		const outcome = await session.runTurn(
			{ text: "hello", attachmentPaths: [], config },
			callbacks,
		);
		await session.dispose();

		expect(outcome.kind).toBe("error");
		expect(commands).toEqual(["/opt/codex/bin/codex"]);
	});

	test("SIDE-21 a chosen program that cannot run is an error that names it", async () => {
		const runner = makeRunner({
			findExecutable: async (name) => (name === "codex" ? "/usr/local/bin/codex" : null),
		});

		const started = runner.start({
			sessionId: "s1" as SessionId,
			config,
			workspace,
			env: { PATH: "/usr/local/bin" },
			executablePath: "/opt/missing/codex",
		});

		await expect(started).rejects.toMatchObject({ code: "agent_program_invalid" });
	});

	test("SIDE-13 disposing the session gives the chat's app tools token back once", async () => {
		const released: string[] = [];
		const runner = makeRunner({ released });

		const session = await runner.start({
			sessionId: "s1" as SessionId,
			config,
			workspace,
			env: { PATH: "/usr/local/bin" },
		});
		expect(released).toEqual([]);
		await session.dispose();
		await session.dispose();

		expect(released).toEqual(["s1"]);
	});

	test("AGENT-08 a command approval from the app server reaches the turn and Codex gets the answer", async () => {
		const child = new FakeChild();
		const results: Record<string, unknown> = {
			initialize: { serverVersion: "0.154.0" },
			// codex-cli 0.154.0 answers null when no requirements are configured.
			"configRequirements/read": { requirements: null },
			"thread/start": { thread: { id: "thread-1" } },
			"turn/start": { turn: { id: "turn-1", status: "inProgress" } },
		};
		child.onWrite = (message) => {
			const id = message.id;
			const method = message.method;
			if (id === undefined || id === null || method === undefined) return;
			if (!(method in results)) return;
			queueMicrotask(() => child.emit({ jsonrpc: "2.0", id, result: results[method] }));
		};
		const runner = makeRunner({ spawn: async () => ok(child) });
		const approvalsOn = { ...config, requireToolApproval: true };
		const asked: Interaction[] = [];
		const session = await runner.start({
			sessionId: "s1" as SessionId,
			config: approvalsOn,
			workspace,
			env: { PATH: "/usr/local/bin" },
		});

		const turn = session.runTurn(
			{ text: "run the tests", attachmentPaths: [], config: approvalsOn },
			{
				...callbacks,
				requestInteraction: async (interaction) => {
					asked.push(interaction);
					return { kind: "tool_approval", decision: "allow" };
				},
			},
		);
		await waitFor(() => child.lines.some((line) => line.method === "turn/start"));
		child.emit({
			jsonrpc: "2.0",
			id: "approval-1",
			method: "item/commandExecution/requestApproval",
			params: {
				threadId: "thread-1",
				turnId: "turn-1",
				itemId: "item-1",
				command: "pnpm test",
				cwd: "/work/lisbon",
			},
		});
		await waitFor(() => child.lines.some((line) => line.id === "approval-1"));

		expect(asked).toEqual([
			{
				kind: "tool_approval",
				toolUseId: "item-1" as ToolUseId,
				toolName: "Bash",
				input: { command: "pnpm test", cwd: "/work/lisbon" },
			},
		]);
		const reply = child.lines.find((line) => line.id === "approval-1");
		expect(reply?.error).toBeUndefined();
		expect(reply?.result).toEqual({ decision: "accept" });

		child.emit({
			jsonrpc: "2.0",
			method: "turn/completed",
			params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } },
		});
		expect(await turn).toEqual({ kind: "success" });
		await session.dispose();
	});
});

/** Waits for something the scripted child or the client does a few promise steps later. */
async function waitFor(check: () => boolean): Promise<void> {
	for (let step = 0; step < 1000; step += 1) {
		if (check()) return;
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("The expected Codex message never arrived.");
}
