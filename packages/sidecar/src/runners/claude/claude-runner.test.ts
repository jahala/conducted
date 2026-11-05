import { describe, expect, test } from "bun:test";
import type {
	CanUseTool,
	Options,
	Query,
	ModelInfo as SdkModelInfo,
	SlashCommand,
} from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { appError, err, ok } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import type { AppToolBackend } from "../../tools/backend.ts";
import type { RunnerCommonDeps } from "../deps.ts";
import type { StartOptions } from "../runner.ts";
import { ClaudeRunner, type ClaudeRunnerDeps } from "./claude-runner.ts";
import type { QueryFunction } from "./claude-session.ts";
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
	failOn?: "models" | "commands";
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
		ids: { uuid: () => "uuid" },
		probe: async () => ok({ stdout: "", stderr: "", exitCode: 0 }),
		findExecutable: async () => "/bin/claude",
	};
	return {
		...common,
		query: metadataQuery({}),
		translator: {} as ClaudeTranslator,
		appTools: {} as AppToolBackend,
		hasTranscript: async () => false,
		realPath: async (path) => path,
		newUuid: () => "uuid",
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

		expect(await rejectionOf(runner.listModels())).toMatchObject({
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
			},
			{
				value: "claude-b",
				displayName: "Claude B",
				description: "",
				supportsEffort: false,
				supportedEffortLevels: [],
				supportsFastMode: false,
			},
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

		const listed = await runner.listModels();

		expect(listed[0]).toMatchObject({
			id: "claude-a",
			label: "Claude A",
			status: "picker",
			efforts: ["low", "medium", "high", "xhigh", "max"],
			defaultEffort: "high",
			supportsFastMode: true,
			liveEffortChange: true,
		});
		expect(listed[1]).toMatchObject({
			id: "claude-b",
			efforts: [],
			supportsFastMode: false,
			liveEffortChange: false,
		});
		expect(signal?.aborted).toBe(true);
	});

	test("listSlashCommands maps the list and ends the throwaway query on error", async () => {
		let signal: AbortSignal | undefined;
		const commands: SlashCommand[] = [
			{ name: "review", description: "Review the diff", argumentHint: "<file>" },
			{ name: "plain", description: "No arguments", argumentHint: "" },
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

		expect(await runner.listSlashCommands("/work/app")).toEqual([
			{ name: "review", description: "Review the diff", argumentHint: "<file>" },
			{ name: "plain", description: "No arguments" },
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
		await expect(failing.listSlashCommands("/work/app")).rejects.toThrow("commands failed");
		expect(failedSignal?.aborted).toBe(true);
	});
});
