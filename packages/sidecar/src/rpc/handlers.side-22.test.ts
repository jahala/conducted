/**
 * @feature SIDE-22 Slash command cache that works before a chat starts
 * Owns: the tests for the `listSlashCommands` handler: cache reads without a workspace, refresh
 * with one, and the last good list when a refresh fails.
 * Behaviour: research/conductor/native-and-sidecar-map.md B3 and D1, frontend.md 3c.
 * Test first: a request without a workspacePath answers from the saved list with fromCache true.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SlashCommand } from "@conducted/protocol";
import { appError, err, ok } from "@conducted/shared";
import { ConductorHistoryImports } from "../import/history-imports.ts";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import { AgentProgramChoices } from "../models/agent-programs.ts";
import { createNodeCompletionsFiles, FileCompletionsCache } from "../models/completions-cache.ts";
import type { SlashCommandLister } from "../models/slash-and-mcp.ts";
import { buildHandlers, type HandlerDeps } from "./handlers.ts";

const folders: string[] = [];

afterEach(async () => {
	for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

function command(name = "review"): SlashCommand {
	return { name, description: `Run ${name}`, source: "project", kind: "command" };
}

function cacheIn(folder: string, now = 1_700_000_000_000): FileCompletionsCache {
	return new FileCompletionsCache({
		dir: folder,
		files: createNodeCompletionsFiles(),
		clock: { now: () => now },
		logger: createLogger({
			sink: () => {},
			clock: { now: () => 0 },
			level: "error",
			scope: "test",
		}),
	});
}

function deps(
	slashCommands: SlashCommandLister,
	completions: HandlerDeps["completions"],
	records: LogRecord[] = [],
): HandlerDeps {
	return {
		sessions: {
			sendMessage: async () => ({ deliveredAs: "new_turn" }),
			cancel: async () => ({ wasWorking: false, droppedMessageIds: [] }),
			warmAgent: async () => ({}),
			resetAgent: async () => ({}),
			updateConfig: async () => ({ applied: "live" }),
			setAutoApproveEdits: async () => ({}),
			getSessionStatus: async () => ({ known: true }),
			answerInteraction: async () => ({ accepted: true, superseded: false }),
			compact: async () => ({ started: true }),
			listAcpConfigOptions: async () => ({ options: [] }),
			setAcpConfigOption: async () => ({ options: [] }),
			getGoal: async () => ({ goal: null }),
			setGoal: async (params) => ({
				goal: { objective: params.objective, status: "active" as const },
			}),
			changeGoal: async () => ({ goal: null }),
			onAppAttached: () => {},
			shutdown: async () => {},
		},
		outbox: {
			open: async () => ok([]),
			append: async () => ok([]),
			acknowledge: async () => ok(undefined),
			pending: () => [],
			sessionsWithPending: () => [],
			sweepIdle: async () => ok(0),
		},
		models: {
			list: async () => ok([]),
			validate: async () => err(appError("unknown_model", "No such model")),
			invalidate: () => {},
		},
		agents: {
			detectAll: async () => [],
			startLogin: async () => err(appError("agent_not_installed", "Not installed")),
			finishLogin: async () => err(appError("agent_not_installed", "Not installed")),
			cancelLogin: async () => ok(undefined),
		},
		agentPrograms: new AgentProgramChoices(),
		slashCommands,
		completions,
		mcpServers: { list: async () => ok([]) },
		usage: { contextUsage: async () => ok({ usedTokens: 0, windowTokens: 1, rateLimits: [] }) },
		shellEnv: {
			get: async () => ok({ shell: "/bin/zsh", path: "/usr/bin", env: {}, providerSecrets: {} }),
			refresh: async () =>
				ok({ shell: "/bin/zsh", path: "/usr/bin", env: {}, providerSecrets: {} }),
		},
		utilityPrompt: { run: async () => ok({ text: "" }) },
		conductorHistory: new ConductorHistoryImports(),
		setLogLevel: () => {},
		logger: createLogger({
			sink: (record) => records.push(record),
			clock: { now: () => 0 },
			level: "debug",
			scope: "test",
		}),
	};
}

describe("SIDE-22 listSlashCommands without a workspace", () => {
	test("SIDE-22 answers from the saved list and marks it fromCache", async () => {
		const folder = await mkdtemp(path.join(tmpdir(), "conducted-side-22-rpc-"));
		folders.push(folder);
		const cache = cacheIn(folder);
		await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command()]);
		const handlers = buildHandlers(deps({ list: async () => ok([]) }, cache));

		const answered = await handlers.requests.listSlashCommands({
			agent: "claude",
			repoRootPath: "/code/app",
		});

		expect(answered).toEqual(ok({ commands: [command()], fromCache: true }));
	});

	test("SIDE-22 an empty cache answers with no commands, not an error", async () => {
		const folder = await mkdtemp(path.join(tmpdir(), "conducted-side-22-rpc-"));
		folders.push(folder);
		const handlers = buildHandlers(deps({ list: async () => ok([]) }, cacheIn(folder)));

		const answered = await handlers.requests.listSlashCommands({
			agent: "claude",
			repoRootPath: "/code/app",
		});

		expect(answered).toEqual(ok({ commands: [], fromCache: true }));
	});
});

describe("SIDE-22 listSlashCommands with a workspace", () => {
	test("SIDE-22 refreshes the saved list for the repository and agent", async () => {
		const folder = await mkdtemp(path.join(tmpdir(), "conducted-side-22-rpc-"));
		folders.push(folder);
		const cache = cacheIn(folder);
		let askedPath = "";
		const slashCommands: SlashCommandLister = {
			list: async (_agent, _acpAgent, workspacePath) => {
				askedPath = workspacePath;
				return ok([command("workspace-command")]);
			},
		};
		const handlers = buildHandlers(deps(slashCommands, cache));

		const answered = await handlers.requests.listSlashCommands({
			agent: "claude",
			workspacePath: "/code/app/worktrees/one",
			repoRootPath: "/code/app",
		});

		expect(askedPath).toBe("/code/app/worktrees/one");
		expect(answered).toEqual(ok({ commands: [command("workspace-command")], fromCache: false }));
		const saved = await cache.read({ repoRootPath: "/code/app", agent: "claude" });
		expect(saved.ok && saved.value?.commands).toEqual([command("workspace-command")]);
	});

	test("SIDE-22 a failed refresh logs and keeps the last good list", async () => {
		const folder = await mkdtemp(path.join(tmpdir(), "conducted-side-22-rpc-"));
		folders.push(folder);
		const cache = cacheIn(folder);
		await cache.write({ repoRootPath: "/code/app", agent: "claude" }, [command("last-good")]);
		const records: LogRecord[] = [];
		const handlers = buildHandlers(
			deps(
				{ list: async () => err(appError("slash_commands_failed", "Agent exited")) },
				cache,
				records,
			),
		);

		const answered = await handlers.requests.listSlashCommands({
			agent: "claude",
			workspacePath: "/code/app/worktrees/one",
			repoRootPath: "/code/app",
		});

		expect(answered).toEqual(ok({ commands: [command("last-good")], fromCache: true }));
		expect(records.some((record) => record.level === "warn")).toBe(true);
	});

	test("SIDE-22 a failed refresh with no saved list returns the failure", async () => {
		const folder = await mkdtemp(path.join(tmpdir(), "conducted-side-22-rpc-"));
		folders.push(folder);
		const handlers = buildHandlers(
			deps(
				{ list: async () => err(appError("slash_commands_failed", "Agent exited")) },
				cacheIn(folder),
			),
		);

		const answered = await handlers.requests.listSlashCommands({
			agent: "claude",
			workspacePath: "/code/app/worktrees/one",
			repoRootPath: "/code/app",
		});

		expect(answered).toEqual(err(appError("slash_commands_failed", "Agent exited")));
	});
});
