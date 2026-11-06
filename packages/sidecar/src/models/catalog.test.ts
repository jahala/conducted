/**
 * @feature SIDE-14 Model catalog per agent
 * Owns: the tests for the model cache, single-flight discovery, validation and default-model pick
 * in catalog.ts.
 * Behaviour: research/conductor/other-runners.md section 5 "Model catalog" and "Dynamic discovery"
 * (each runner reports its own list; the cache lives for one hour; the default model is the entry
 * the runner marks isDefault) and sessions.md section 2 step 4 (only the model is validated).
 * Test first: validate() on a model that is not in the runner's list returns an error whose code is
 * "model_unknown".
 */
import { describe, expect, test } from "bun:test";
import type { AgentLaunch, ModelInfo, SessionConfig } from "@conducted/protocol";
import type { AgentKind, Clock } from "@conducted/shared";
import { appError } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import { MapRunnerRegistry, type RunnerSelector } from "../runners/registry.ts";
import type { AgentSession, ListingContext, Runner, StartOptions } from "../runners/runner.ts";
import { loginShellOver } from "../test-support/login-shell.ts";
import {
	AGENT_NOT_INSTALLED,
	defaultModel,
	MODEL_CATALOG_TTL_MS,
	MODEL_LIST_FAILED,
	RunnerModelCatalog,
} from "./catalog.ts";

const baseModel: ModelInfo = {
	id: "claude-sonnet",
	label: "Sonnet",
	shortLabel: "Sonnet",
	status: "picker",
	isNew: false,
	isDefault: true,
	efforts: ["low", "medium", "high"],
	defaultEffort: "medium",
	effortAxis: "effort",
	liveEffortChange: true,
	supportsFastMode: true,
};

const otherModel: ModelInfo = {
	...baseModel,
	id: "claude-opus",
	label: "Opus",
	isDefault: false,
	efforts: [],
	supportsFastMode: false,
};

function fakeClock(start = 0): { clock: Clock; advance(ms: number): void } {
	let now = start;
	return {
		clock: { now: () => now },
		advance(ms) {
			now += ms;
		},
	};
}

function fakeLogger() {
	return createLogger({
		sink: () => {},
		clock: { now: () => 0 },
		level: "error",
		scope: "test",
	});
}

function fakeRunner(
	agent: AgentKind,
	listModels: (context: ListingContext) => Promise<ModelInfo[]>,
): Runner {
	return {
		agent,
		capabilities: {
			steer: false,
			interrupt: false,
			resumeAt: false,
			liveConfig: false,
			slashCommands: false,
			mcpServers: false,
			contextUsage: false,
		},
		detect: async () => null,
		start: async (_options: StartOptions): Promise<AgentSession> => {
			throw new Error("start is not used by the catalog");
		},
		listModels,
		listSlashCommands: async () => [],
	};
}

function catalogWith(
	entries: {
		selector: RunnerSelector;
		listModels: (context: ListingContext) => Promise<ModelInfo[]>;
	}[],
	clock: Clock,
	shell: Readonly<Record<string, string>> = { PATH: "/usr/bin" },
): RunnerModelCatalog {
	const runners = entries.map((entry) => ({
		selector: entry.selector,
		runner: fakeRunner(entry.selector.agent, entry.listModels),
	}));
	return new RunnerModelCatalog({
		runners: new MapRunnerRegistry(runners),
		shellEnv: loginShellOver(shell, fakeLogger()),
		logger: fakeLogger(),
		clock,
	});
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
} {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function config(overrides: Partial<SessionConfig> = {}): SessionConfig {
	return {
		agent: "claude",
		model: baseModel.id,
		effort: "medium",
		fastMode: false,
		planMode: false,
		requireToolApproval: false,
		additionalDirectories: [],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
		...overrides,
	};
}

describe("SIDE-14 model catalog", () => {
	test("lists the models an agent reports", async () => {
		let calls = 0;
		const catalog = catalogWith(
			[
				{
					selector: { agent: "claude" },
					listModels: async () => {
						calls += 1;
						return [baseModel, otherModel];
					},
				},
			],
			fakeClock().clock,
		);

		const result = await catalog.list("claude");

		expect(result).toEqual({ ok: true, value: [baseModel, otherModel] });
		expect(calls).toBe(1);
	});

	test("passes the picker fields and the default model through unchanged", async () => {
		const rich: ModelInfo = {
			...baseModel,
			id: "claude-sonnet-new",
			shortLabel: "Sonnet 5",
			isNew: true,
			effortLabels: { high: "Deep" },
			liveEffortChange: false,
			contextWindowTokens: 200_000,
		};
		const catalog = catalogWith(
			[{ selector: { agent: "claude" }, listModels: async () => [rich] }],
			fakeClock().clock,
		);

		const result = await catalog.list("claude");

		expect(result).toEqual({ ok: true, value: [rich] });
	});

	test("serves the cached list until its one-hour lifetime ends", async () => {
		const time = fakeClock();
		let calls = 0;
		const catalog = catalogWith(
			[
				{
					selector: { agent: "claude" },
					listModels: async () => {
						calls += 1;
						return [baseModel];
					},
				},
			],
			time.clock,
		);

		await catalog.list("claude");
		time.advance(MODEL_CATALOG_TTL_MS - 1);
		await catalog.list("claude");
		expect(calls).toBe(1);

		time.advance(1);
		await catalog.list("claude");
		expect(calls).toBe(2);
	});

	test("two callers at once share one discovery run", async () => {
		const gate = deferred<ModelInfo[]>();
		let calls = 0;
		const catalog = catalogWith(
			[
				{
					selector: { agent: "codex" },
					listModels: () => {
						calls += 1;
						return gate.promise;
					},
				},
			],
			fakeClock().clock,
		);

		const first = catalog.list("codex");
		const second = catalog.list("codex");
		gate.resolve([baseModel]);
		const [a, b] = await Promise.all([first, second]);

		expect(calls).toBe(1);
		expect(a).toEqual({ ok: true, value: [baseModel] });
		expect(b).toEqual({ ok: true, value: [baseModel] });
	});

	test("invalidate drops the cached list", async () => {
		let version = 1;
		let calls = 0;
		const catalog = catalogWith(
			[
				{
					selector: { agent: "claude" },
					listModels: async () => {
						calls += 1;
						return version === 1 ? [baseModel] : [otherModel];
					},
				},
			],
			fakeClock().clock,
		);

		await catalog.list("claude");
		version = 2;
		catalog.invalidate();
		const result = await catalog.list("claude");

		expect(calls).toBe(2);
		expect(result).toEqual({ ok: true, value: [otherModel] });
	});

	test("an older discovery never overwrites the cache after invalidate", async () => {
		const firstGate = deferred<ModelInfo[]>();
		const secondGate = deferred<ModelInfo[]>();
		let calls = 0;
		const catalog = catalogWith(
			[
				{
					selector: { agent: "claude" },
					listModels: () => {
						calls += 1;
						return calls === 1 ? firstGate.promise : secondGate.promise;
					},
				},
			],
			fakeClock().clock,
		);

		const oldCall = catalog.list("claude");
		catalog.invalidate();
		const newCall = catalog.list("claude");

		firstGate.resolve([baseModel]);
		expect(await oldCall).toEqual({ ok: true, value: [baseModel] });
		secondGate.resolve([otherModel]);
		expect(await newCall).toEqual({ ok: true, value: [otherModel] });
		// Each list first captures the login shell, so the runner is asked only after that.
		expect(calls).toBe(2);

		const cached = await catalog.list("claude");
		expect(cached).toEqual({ ok: true, value: [otherModel] });
		expect(calls).toBe(2);
	});

	test("an older discovery that finishes last does not overwrite the newer list in the cache", async () => {
		const firstGate = deferred<ModelInfo[]>();
		const secondGate = deferred<ModelInfo[]>();
		let calls = 0;
		const catalog = catalogWith(
			[
				{
					selector: { agent: "claude" },
					listModels: () => {
						calls += 1;
						return calls === 1 ? firstGate.promise : secondGate.promise;
					},
				},
			],
			fakeClock().clock,
		);

		const oldCall = catalog.list("claude");
		catalog.invalidate();
		const newCall = catalog.list("claude");
		secondGate.resolve([otherModel]);
		expect(await newCall).toEqual({ ok: true, value: [otherModel] });
		firstGate.resolve([baseModel]);
		expect(await oldCall).toEqual({ ok: true, value: [baseModel] });

		expect(await catalog.list("claude")).toEqual({ ok: true, value: [otherModel] });
		expect(calls).toBe(2);
	});

	test("an older discovery that finishes does not remove the newer discovery from the single flight", async () => {
		const firstGate = deferred<ModelInfo[]>();
		const secondGate = deferred<ModelInfo[]>();
		let calls = 0;
		const catalog = catalogWith(
			[
				{
					selector: { agent: "claude" },
					listModels: () => {
						calls += 1;
						return calls === 1 ? firstGate.promise : secondGate.promise;
					},
				},
			],
			fakeClock().clock,
		);

		const oldCall = catalog.list("claude");
		catalog.invalidate();
		const newCall = catalog.list("claude");
		firstGate.resolve([baseModel]);
		await oldCall;
		const sharing = catalog.list("claude");
		secondGate.resolve([otherModel]);

		expect(await sharing).toEqual({ ok: true, value: [otherModel] });
		expect(await newCall).toEqual({ ok: true, value: [otherModel] });
		expect(calls).toBe(2);
	});

	test("caches each ACP adapter separately", async () => {
		const calls = new Map<string, number>();
		const count = (agent: string) => {
			const next = (calls.get(agent) ?? 0) + 1;
			calls.set(agent, next);
			return next;
		};
		const catalog = catalogWith(
			[
				{
					selector: { agent: "acp", acpAgent: "opencode" },
					listModels: async () => {
						count("opencode");
						return [baseModel];
					},
				},
				{
					selector: { agent: "acp", acpAgent: "pi" },
					listModels: async () => {
						count("pi");
						return [otherModel];
					},
				},
			],
			fakeClock().clock,
		);

		await catalog.list("acp", "opencode");
		await catalog.list("acp", "pi");
		await catalog.list("acp", "opencode");
		await catalog.list("acp", "pi");

		expect(calls.get("opencode")).toBe(1);
		expect(calls.get("pi")).toBe(1);
	});

	test("returns the registry error for an ACP agent without an adapter", async () => {
		const catalog = catalogWith([], fakeClock().clock);

		const result = await catalog.list("acp");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("acp_agent_missing");
	});

	test("an AppError from the runner keeps its code, including agent_not_installed", async () => {
		const catalog = catalogWith(
			[
				{
					selector: { agent: "codex" },
					listModels: async () => {
						throw appError(AGENT_NOT_INSTALLED, "codex is missing");
					},
				},
			],
			fakeClock().clock,
		);

		const result = await catalog.list("codex");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe(AGENT_NOT_INSTALLED);
	});

	test("a plain Error saying not installed becomes model_list_failed", async () => {
		const catalog = catalogWith(
			[
				{
					selector: { agent: "codex" },
					listModels: async () => {
						throw new Error("codex is not installed");
					},
				},
			],
			fakeClock().clock,
		);

		const result = await catalog.list("codex");

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe(MODEL_LIST_FAILED);
	});

	test("a failed list is not cached, so the next call tries again", async () => {
		let calls = 0;
		const catalog = catalogWith(
			[
				{
					selector: { agent: "codex" },
					listModels: async () => {
						calls += 1;
						if (calls === 1) throw appError("agent_not_installed", "codex is missing");
						return [baseModel];
					},
				},
			],
			fakeClock().clock,
		);

		const failed = await catalog.list("codex");
		const succeeded = await catalog.list("codex");

		expect(failed.ok).toBe(false);
		expect(succeeded).toEqual({ ok: true, value: [baseModel] });
		expect(calls).toBe(2);
	});

	test("validate accepts a model, effort and fast mode the agent offers", async () => {
		const catalog = catalogWith(
			[{ selector: { agent: "claude" }, listModels: async () => [baseModel] }],
			fakeClock().clock,
		);

		const result = await catalog.validate(
			config({ model: baseModel.id, effort: "high", fastMode: true }),
		);

		expect(result).toEqual({ ok: true, value: baseModel });
	});

	test("validate on a model that is not in the runner's list returns model_unknown", async () => {
		const catalog = catalogWith(
			[{ selector: { agent: "claude" }, listModels: async () => [baseModel] }],
			fakeClock().clock,
		);

		const result = await catalog.validate(config({ model: "claude-retired" }));

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("model_unknown");
	});

	test("validate accepts an effort or fast mode the model does not advertise", async () => {
		const catalog = catalogWith(
			[{ selector: { agent: "claude" }, listModels: async () => [otherModel] }],
			fakeClock().clock,
		);

		const result = await catalog.validate(
			config({ model: otherModel.id, effort: "ultracode", fastMode: true }),
		);

		expect(result).toEqual({ ok: true, value: otherModel });
	});

	test("validate surfaces a catalog error instead of hiding it", async () => {
		const catalog = catalogWith([], fakeClock().clock);

		const result = await catalog.validate(config({ agent: "codex", model: "gpt-5" }));

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.code).toBe("runner_unknown");
	});

	test("hidden and deprecated models still validate for an existing chat", async () => {
		const hidden: ModelInfo = { ...baseModel, id: "claude-hidden", status: "hidden" };
		const deprecated: ModelInfo = { ...baseModel, id: "claude-old", status: "deprecated" };
		const catalog = catalogWith(
			[{ selector: { agent: "claude" }, listModels: async () => [hidden, deprecated] }],
			fakeClock().clock,
		);

		const hiddenResult = await catalog.validate(config({ model: hidden.id }));
		const deprecatedResult = await catalog.validate(config({ model: deprecated.id }));

		expect(hiddenResult).toEqual({ ok: true, value: hidden });
		expect(deprecatedResult).toEqual({ ok: true, value: deprecated });
	});

	test("SIDE-21 a list with the app's launch runs the chosen program with the agent's own keys", async () => {
		const seen: ListingContext[] = [];
		const catalog = catalogWith(
			[
				{
					selector: { agent: "claude" },
					listModels: async (context) => {
						seen.push(context);
						return [baseModel];
					},
				},
			],
			fakeClock().clock,
			{ PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-from-shell" },
		);
		const launch: AgentLaunch = {
			executablePath: "/opt/claude/bin/claude",
			env: { HTTPS_PROXY: "http://proxy" },
			providerKeys: {
				ANTHROPIC_API_KEY: { value: "", source: "this_mac" },
				OPENAI_API_KEY: { value: "sk-codex", source: "entered" },
			},
			provider: "anthropic",
		};

		const listed = await catalog.list("claude", undefined, launch);

		expect(listed.ok).toBe(true);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.executablePath).toBe("/opt/claude/bin/claude");
		expect(seen[0]?.env.PATH).toBe("/usr/bin");
		expect(seen[0]?.env.HTTPS_PROXY).toBe("http://proxy");
		expect(seen[0]?.env.ANTHROPIC_API_KEY).toBe("sk-from-shell");
		expect(seen[0]?.env.OPENAI_API_KEY).toBeUndefined();
	});

	test("SIDE-21 lists of two launches are cached apart, and a list without one has no keys", async () => {
		const seen: ListingContext[] = [];
		const catalog = catalogWith(
			[
				{
					selector: { agent: "codex" },
					listModels: async (context) => {
						seen.push(context);
						return [baseModel];
					},
				},
			],
			fakeClock().clock,
		);
		const launch = (path: string): AgentLaunch => ({
			executablePath: path,
			env: {},
			providerKeys: {},
		});

		await catalog.list("codex", undefined, launch("/a/codex"));
		await catalog.list("codex", undefined, launch("/a/codex"));
		await catalog.list("codex", undefined, launch("/b/codex"));
		await catalog.list("codex");

		expect(seen.map((context) => context.executablePath)).toEqual([
			"/a/codex",
			"/b/codex",
			undefined,
		]);
		expect(seen[2]?.env).toEqual({ PATH: "/usr/bin" });
	});

	test("SIDE-21 a key from this Mac that the shell does not set fails the list with its name", async () => {
		let listed = false;
		const catalog = catalogWith(
			[
				{
					selector: { agent: "claude" },
					listModels: async () => {
						listed = true;
						return [baseModel];
					},
				},
			],
			fakeClock().clock,
		);

		const result = await catalog.list("claude", undefined, {
			env: {},
			providerKeys: { ANTHROPIC_API_KEY: { value: "", source: "this_mac" } },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.message).toContain("ANTHROPIC_API_KEY");
		expect(listed).toBe(false);
	});

	test("defaultModel returns the entry the runner marks as the default", () => {
		expect(defaultModel([otherModel, baseModel])).toBe(baseModel);
	});

	test("defaultModel returns undefined when no entry is marked, so the caller uses the user's setting", () => {
		expect(defaultModel([otherModel])).toBeUndefined();
		expect(defaultModel([])).toBeUndefined();
	});
});
