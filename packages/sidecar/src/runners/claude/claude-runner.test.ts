import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
	CanUseTool,
	Options,
	Query,
	McpServerStatus as SdkMcpServerStatus,
	ModelInfo as SdkModelInfo,
	SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import { countingIds } from "../../test-support/ids.ts";
import { managedProgramFinder } from "../../test-support/managed-programs.ts";
import type { AppToolBackend } from "../../tools/backend.ts";
import type { RunnerCommonDeps } from "../deps.ts";
import { createManagedProgramFinder, nodeManagedProgramFiles } from "../managed-programs.ts";
import type { StartOptions } from "../runner.ts";
import { ClaudeRunner, type ClaudeRunnerDeps } from "./claude-runner.ts";
import type { ClaudeSession, QueryFunction } from "./claude-session.ts";
import type { ClaudeTranslator } from "./translate.ts";
import type { Scheduler } from "./turn-tracker.ts";

const noScheduler: Scheduler = { after: () => () => {} };

function fakeLogger(): { logger: Logger; warnings: string[] } {
	const warnings: string[] = [];
	const logger: Logger = {
		error: () => {},
		warn: (message) => warnings.push(message),
		info: () => {},
		debug: () => {},
		child: () => logger,
		setLevel: () => {},
	};
	return { logger, warnings };
}

function metadataQuery(handler: {
	models?: SdkModelInfo[];
	commands?: SlashCommand[];
	mcpServers?: SdkMcpServerStatus[];
	failOn?: "models" | "commands" | "mcp";
	onOptions?: (options: Options | undefined) => void;
}): QueryFunction {
	const query = {
		supportedModels: async () => {
			if (handler.failOn === "models") throw new Error("models failed");
			return handler.models ?? [];
		},
		supportedCommands: async () => {
			if (handler.failOn === "commands") throw new Error("commands failed");
			return handler.commands ?? [];
		},
		mcpServerStatus: async () => {
			if (handler.failOn === "mcp") throw new Error("mcp failed");
			return handler.mcpServers ?? [];
		},
	} as unknown as Query;
	return ({ options }) => {
		handler.onOptions?.(options);
		return query;
	};
}

function makeDeps(overrides: Partial<ClaudeRunnerDeps> = {}): ClaudeRunnerDeps {
	const common: RunnerCommonDeps = {
		logger: fakeLogger().logger,
		clock: { now: () => 0 },
		ids: countingIds(),
		probe: async () => ok({ stdout: "", stderr: "", exitCode: 0 }),
		findExecutable: async () => "/bin/claude",
		findManagedProgram: managedProgramFinder({ claude: "/bin/claude" }),
	};
	return {
		...common,
		query: metadataQuery({}),
		translator: {} as ClaudeTranslator,
		appTools: {} as AppToolBackend,
		hasTranscript: async () => false,
		readUserMessageText: async () => null,
		realPath: async (path) => path,
		newUuid: countingIds("turn").uuid,
		scheduler: noScheduler,
		createCanUseTool: () =>
			(async () => ({ behavior: "allow", updatedInput: {} })) as unknown as CanUseTool,
		createMcpServers: () => ({}),
		...overrides,
	};
}

function config(): SessionConfig {
	return {
		agent: "claude",
		model: "claude-sonnet-5",
		effort: "high",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
	};
}

function workspace(): WorkspaceContext {
	return {
		workspaceId: "w1" as WorkspaceId,
		workspaceName: "app",
		workspacePath: "/work/app",
		repoRootPath: "/work/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		host: { kind: "local" },
		port: 4100,
	};
}

function startOptions(): StartOptions {
	return {
		sessionId: "s1" as SessionId,
		config: config(),
		workspace: workspace(),
		env: { PATH: "/usr/bin" },
	};
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => undefined,
		(cause: unknown) => cause,
	);
}

describe("AGENT-02 Claude runner", () => {
	test("detect returns null without probing when the program is missing", async () => {
		let probed = false;
		const runner = new ClaudeRunner(
			makeDeps({
				findExecutable: async () => null,
				probe: async () => {
					probed = true;
					return ok({ stdout: "", stderr: "", exitCode: 0 });
				},
			}),
		);

		expect(await runner.detect({ PATH: "/usr/bin" })).toBeNull();
		expect(probed).toBe(false);
	});

	test("detect parses the version from the program's output", async () => {
		const runner = new ClaudeRunner(
			makeDeps({
				probe: async () => ok({ stdout: "2.0.14 (Claude Code)\n", stderr: "", exitCode: 0 }),
			}),
		);

		expect(await runner.detect({ PATH: "/usr/bin" })).toEqual({
			path: "/bin/claude",
			version: "2.0.14",
		});
	});

	test("detect reports an installed program without a version when the probe fails", async () => {
		const runner = new ClaudeRunner(
			makeDeps({
				probe: async () => err(appError("probe_timeout", "the probe timed out")),
			}),
		);

		expect(await runner.detect({ PATH: "/usr/bin" })).toEqual({
			path: "/bin/claude",
			version: "",
		});
	});

	test("detect reports an installed program with no version when the output has none", async () => {
		const runner = new ClaudeRunner(
			makeDeps({
				probe: async () => ok({ stdout: "no version here", stderr: "", exitCode: 0 }),
			}),
		);

		expect(await runner.detect({ PATH: "/usr/bin" })).toEqual({
			path: "/bin/claude",
			version: "",
		});
	});

	test("start names the missing workspace folder with a code", async () => {
		const runner = new ClaudeRunner(makeDeps({ realPath: async () => null }));

		expect(await rejectionOf(runner.start(startOptions()))).toMatchObject({
			code: "workspace_missing",
			message: "Workspace directory missing: /work/app",
		});
	});

	test("start reports a missing Claude program as an AppError", async () => {
		const runner = new ClaudeRunner(makeDeps({ findExecutable: async () => null }));

		expect(await rejectionOf(runner.start(startOptions()))).toMatchObject({
			code: "agent_not_installed",
		});
	});

	test("listModels reports a missing Claude program without starting a query", async () => {
		let queried = false;
		const runner = new ClaudeRunner(
			makeDeps({
				findExecutable: async () => null,
				query: () => {
					queried = true;
					throw new Error("should not query");
				},
			}),
		);

		expect(await rejectionOf(runner.listModels({ env: {} }))).toMatchObject({
			code: "agent_not_installed",
		});
		expect(queried).toBe(false);
	});

	test("start resolves a symlinked workspace and logs a warning", async () => {
		const { logger, warnings } = fakeLogger();
		const runner = new ClaudeRunner(makeDeps({ logger, realPath: async () => "/real/work/app" }));

		const session = await runner.start(startOptions());

		expect(String(session.sessionId)).toBe("s1");
		expect(warnings).toContain("Workspace path resolves through a symlink");
	});

	test("listModels maps the SDK list and ends the throwaway query", async () => {
		let signal: AbortSignal | undefined;
		const models: SdkModelInfo[] = [
			{
				value: "claude-a",
				displayName: "Claude A",
				description: "",
				supportsEffort: true,
				supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
				supportsFastMode: true,
				supportsAdaptiveThinking: true,
			},
			{
				value: "claude-b",
				displayName: "Claude B",
				description: "",
				supportsEffort: false,
				supportedEffortLevels: [],
				supportsFastMode: false,
				supportsAdaptiveThinking: false,
			},
			{ value: "claude-c", displayName: "Claude C", description: "" },
		];
		const runner = new ClaudeRunner(
			makeDeps({
				query: metadataQuery({
					models,
					onOptions: (options) => {
						signal = options?.abortController?.signal;
					},
				}),
			}),
		);

		const listed = await runner.listModels({ env: {} });

		expect(listed[0]).toMatchObject({
			id: "claude-a",
			label: "Claude A",
			status: "picker",
			efforts: ["low", "medium", "high", "xhigh", "max"],
			defaultEffort: "high",
			supportsFastMode: true,
			liveEffortChange: true,
			adaptiveThinking: true,
		});
		expect(listed[1]).toMatchObject({
			id: "claude-b",
			efforts: [],
			supportsFastMode: false,
			liveEffortChange: false,
			adaptiveThinking: false,
		});
		// A model the SDK says nothing about has no adaptive flag, never a guessed one.
		expect(listed[2]).not.toHaveProperty("adaptiveThinking");
		expect(signal?.aborted).toBe(true);
	});

	test("SIDE-21 a listing runs the program and environment of the app's launch", async () => {
		let seen: Options | undefined;
		const checked: string[] = [];
		const runner = new ClaudeRunner(
			makeDeps({
				findExecutable: async (name) => {
					checked.push(name);
					return name.startsWith("/") ? name : null;
				},
				query: metadataQuery({
					onOptions: (options) => {
						seen = options;
					},
				}),
			}),
		);

		await runner.listModels({
			env: { PATH: "/bin", ANTHROPIC_API_KEY: "sk-chosen" },
			executablePath: "/opt/my/claude",
		});

		expect(seen?.pathToClaudeCodeExecutable).toBe("/opt/my/claude");
		expect(seen?.env?.ANTHROPIC_API_KEY).toBe("sk-chosen");
		expect(checked).toContain("/opt/my/claude");
	});

	test("listSlashCommands maps the list and ends the throwaway query on error", async () => {
		let signal: AbortSignal | undefined;
		const commands: SlashCommand[] = [
			{ name: "review", description: "Review the diff", argumentHint: "<file>" },
			{ name: "plain", description: "No arguments", argumentHint: "" },
			{ name: "clear", description: "Start a fresh chat", argumentHint: "", builtin: true },
			{
				name: "compact",
				description: "Compact the context window",
				argumentHint: "",
				builtin: true,
			},
			{ name: "my-plugin:lint", description: "Lint with a plugin", argumentHint: "" },
			{ name: "mcp__github__search", description: "Search GitHub", argumentHint: "" },
		];
		const runner = new ClaudeRunner(
			makeDeps({
				query: metadataQuery({
					commands,
					onOptions: (options) => {
						signal = options?.abortController?.signal;
					},
				}),
			}),
		);

		expect(await runner.listSlashCommands("/work/app", { env: {} })).toEqual([
			{
				name: "review",
				description: "Review the diff",
				argumentHint: "<file>",
				source: "project",
				kind: "command",
			},
			{ name: "plain", description: "No arguments", source: "project", kind: "command" },
			{ name: "clear", description: "Start a fresh chat", source: "builtin", kind: "command" },
			{
				name: "compact",
				description: "Compact the context window",
				source: "builtin",
				kind: "command",
			},
			{
				name: "my-plugin:lint",
				description: "Lint with a plugin",
				source: "plugin",
				kind: "command",
			},
			{
				name: "mcp__github__search",
				description: "Search GitHub",
				source: "mcp",
				kind: "command",
			},
		]);
		expect(signal?.aborted).toBe(true);

		let failedSignal: AbortSignal | undefined;
		const failing = new ClaudeRunner(
			makeDeps({
				query: metadataQuery({
					failOn: "commands",
					onOptions: (options) => {
						failedSignal = options?.abortController?.signal;
					},
				}),
			}),
		);
		await expect(failing.listSlashCommands("/work/app", { env: {} })).rejects.toThrow(
			"commands failed",
		);
		expect(failedSignal?.aborted).toBe(true);
	});
});

describe("SIDE-16 Claude MCP server listing", () => {
	test("listMcpServers maps status, scope, transport, error text and tools and ends the query", async () => {
		let signal: AbortSignal | undefined;
		const servers: SdkMcpServerStatus[] = [
			{
				name: "github",
				status: "connected",
				scope: "user",
				config: { type: "http", url: "https://example.test/mcp" },
				tools: [{ name: "search" }, { name: "create_issue" }],
			},
			{
				name: "linear",
				status: "failed",
				scope: "project",
				source: "plugin",
				config: { type: "stdio", command: "linear-mcp" },
				error: "connection refused",
			},
			{
				name: "sentry",
				status: "needs-auth",
				scope: "local",
				tools: [],
			},
			{
				name: "in-process",
				status: "connected",
				config: { type: "sdk", name: "in-process" },
			},
		];
		const runner = new ClaudeRunner(
			makeDeps({
				query: metadataQuery({
					mcpServers: servers,
					onOptions: (options) => {
						signal = options?.abortController?.signal;
					},
				}),
			}),
		);

		expect(await runner.listMcpServers("/work/app", { env: {} })).toEqual([
			{
				name: "github",
				status: "connected",
				scope: "user",
				transport: "http",
				tools: ["search", "create_issue"],
				toolCount: 2,
			},
			{
				name: "linear",
				status: "failed",
				scope: "plugin",
				transport: "stdio",
				error: "connection refused",
			},
			{
				name: "sentry",
				status: "needs_auth",
				scope: "local",
				tools: [],
				toolCount: 0,
			},
			{
				name: "in-process",
				status: "connected",
			},
		]);
		expect(signal?.aborted).toBe(true);
	});

	test("listMcpServers reports a missing Claude program without starting a query", async () => {
		const runner = new ClaudeRunner(
			makeDeps({
				findExecutable: async () => null,
				query: (() => {
					throw new Error("the metadata query must not start");
				}) as unknown as QueryFunction,
			}),
		);

		await expect(runner.listMcpServers("/work/app", { env: {} })).rejects.toMatchObject({
			code: "agent_not_installed",
		});
	});

	test("listMcpServers ends the throwaway query when the status call fails", async () => {
		let signal: AbortSignal | undefined;
		const failing = new ClaudeRunner(
			makeDeps({
				query: metadataQuery({
					failOn: "mcp",
					onOptions: (options) => {
						signal = options?.abortController?.signal;
					},
				}),
			}),
		);

		await expect(failing.listMcpServers("/work/app", { env: {} })).rejects.toThrow("mcp failed");
		expect(signal?.aborted).toBe(true);
	});
});

describe("PLAT-28 Claude Code moves to a newer release for new chats (D133)", () => {
	const cleanups: (() => Promise<void>)[] = [];
	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
	});

	/** The app data folder as the program manager lays it out, with `bin/claude` linked. */
	async function appData() {
		const root = await mkdtemp(path.join(tmpdir(), "conducted-plat-28-follow-"));
		cleanups.push(() => rm(root, { recursive: true, force: true }));
		const binDir = path.join(root, "bin");
		const agentBinariesDir = path.join(root, "agent-binaries");
		await mkdir(binDir, { recursive: true });
		const write = async (version: string): Promise<string> => {
			const folder = path.join(agentBinariesDir, "claude", version);
			await mkdir(folder, { recursive: true });
			const binary = path.join(folder, "claude");
			await writeFile(binary, "#!/bin/sh\nexit 0\n");
			await chmod(binary, 0o755);
			return nodeManagedProgramFiles.realPath(binary).then((real) => real ?? binary);
		};
		/** Points `bin/claude` at `binary`, as the program manager does after a checked install. */
		const link = async (binary: string): Promise<void> => {
			await unlink(path.join(binDir, "claude")).catch(() => {});
			await symlink(binary, path.join(binDir, "claude"));
		};
		const find = createManagedProgramFinder({
			binDir,
			agentBinariesDir,
			files: nodeManagedProgramFiles,
		});
		return { root, write, link, find };
	}

	/** A chat as the Claude runner starts it, which can start its process before a turn. */
	const startChat = async (runner: ClaudeRunner, options: StartOptions) =>
		(await runner.start(options)) as ClaudeSession;

	/** A query whose process ends at once, recording the program each process starts. */
	function endingProcesses(): { query: QueryFunction; started: string[] } {
		const started: string[] = [];
		const query: QueryFunction = ({ options }) => {
			started.push(options?.pathToClaudeCodeExecutable ?? "");
			return {
				next: async () => ({ value: undefined, done: true }),
				return: async () => ({ value: undefined, done: true }),
				throw: async (error: unknown) => {
					throw error;
				},
				[Symbol.asyncIterator]() {
					return this;
				},
				supportedModels: async () => [],
			} as unknown as Query;
		};
		return { query, started };
	}

	test("PLAT-28 a running chat keeps its program, a new chat gets the new one, and a chosen path wins", async () => {
		const data = await appData();
		const old = await data.write("2.1.311");
		const newer = await data.write("2.1.322");
		await data.link(old);
		const processes = endingProcesses();
		const runner = new ClaudeRunner(
			makeDeps({ findManagedProgram: data.find, query: processes.query }),
		);

		const running = await startChat(runner, startOptions());
		await running.warm();
		// The program manager installs 2.1.322 and moves the link (binaries/follow.rs).
		await data.link(newer);
		const fresh = await startChat(runner, { ...startOptions(), sessionId: "s2" as SessionId });
		await fresh.warm();
		// The first chat's process ended at once (its stream is empty), so this starts it again: it
		// keeps the program it started with. A process that had not ended would start nothing, and
		// the list below would be one short.
		await running.warm();
		const chosen = await startChat(runner, {
			...startOptions(),
			sessionId: "s3" as SessionId,
			executablePath: "/opt/my/claude",
		});
		await chosen.warm();

		expect(processes.started).toEqual([old, newer, old, "/opt/my/claude"]);
		await Promise.all([running.dispose(), fresh.dispose(), chosen.dispose()]);
	});
});
