/**
 * @feature AGENT-11 ACP client and runner (runner)
 * Owns: tests for capabilities, finding the adapter program and passing the app tools MCP server
 * to session/new, and AGENT-12's model and command listing and adapter hooks.
 * Test first: capabilities.steer is false for both adapters.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AGENT_METHODS,
	CLIENT_METHODS,
	agent as createAgentApp,
	type NewSessionRequest,
	ndJsonStream,
	type SessionConfigOption,
	type SessionNotification,
} from "@agentclientprotocol/sdk";
import type { AgentMessage, SessionConfig } from "@conducted/protocol";
import {
	type AppError,
	appError,
	type Clock,
	err,
	type IdSource,
	ok,
	type Result,
	type SessionId,
	type WorkspaceId,
} from "@conducted/shared";
import { createLogger, type Logger } from "../../logging/logger.ts";
import type { AgentSession, StartOptions, TurnCallbacks } from "../runner.ts";
import type { AcpChild, AcpClient, AcpClientHandlers } from "./acp-client.ts";
import { AcpRunner, type AcpRunnerDeps, isVersionBelow } from "./acp-runner.ts";
import type { AcpAdapter } from "./adapters/adapter.ts";
import { ACP_ADAPTERS } from "./adapters/registry.ts";
import type { AcpTranslator } from "./translate.ts";

const fakeAdapter: AcpAdapter = {
	id: "opencode",
	displayName: "OpenCode",
	command: { executable: "opencode", args: ["acp"] },
	versionArgs: ["--version"],
	minimumVersion: "1.16.2",
	toolNameHints: {},
	waitForModelCatalogMs: 0,
	permissionEnv: (requireApproval) => ok({ FAKE_APPROVAL: requireApproval ? "ask" : "allow" }),
};

const config: SessionConfig = {
	agent: "acp",
	acpAgent: "opencode",
	model: "",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const startOptions: StartOptions = {
	sessionId: "session-1" as SessionId,
	config,
	workspace: {
		workspaceId: "workspace-1" as WorkspaceId,
		workspaceName: "one",
		workspacePath: "/workspace",
		repoRootPath: "/repo",
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 4310,
	},
	env: { PATH: "/usr/bin" },
};

function nextIds() {
	let next = 0;
	return {
		uuid: () => {
			next += 1;
			return `id-${next}`;
		},
	};
}

function logger() {
	return createLogger({
		sink: () => {},
		clock: { now: () => 0 },
		level: "error",
		scope: "test:acp-runner",
	});
}

function makeRunner(
	options: {
		adapter?: AcpAdapter;
		spawn?: ConstructorParameters<typeof AcpRunner>[0]["spawn"];
		appToolsServers?: AcpRunnerDeps["appToolsServers"];
		probe?: AcpRunnerDeps["probe"];
	} = {},
): AcpRunner {
	return new AcpRunner({
		logger: logger(),
		clock: { now: () => 0 },
		ids: nextIds(),
		probe: options.probe ?? (async () => ok({ stdout: "1.18.18", stderr: "", exitCode: 0 })),
		findExecutable: async (name: string) => `/fake/${name}`,
		adapter: options.adapter ?? fakeAdapter,
		spawn:
			options.spawn ?? (async () => err({ code: "spawn_failed", message: "not used" } as AppError)),
		...(options.appToolsServers === undefined ? {} : { appToolsServers: options.appToolsServers }),
		translator: () =>
			({
				push: () => [],
				flush: () => [
					{
						agent: "acp",
						items: [{ kind: "text", text: "ok" }],
					},
				],
			}) as unknown as AcpTranslator,
	});
}

function callbacks(overrides: Partial<TurnCallbacks> = {}): TurnCallbacks {
	return {
		onMessage: (_message: AgentMessage) => {},
		requestInteraction: async () => ({ kind: "withdrawn" }),
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
		...overrides,
	};
}

function bridge(newParams: { value: NewSessionRequest | null }): {
	spawn: ConstructorParameters<typeof AcpRunner>[0]["spawn"];
} {
	return {
		spawn: async () => {
			const toAgent = new TransformStream<Uint8Array, Uint8Array>();
			const toChild = new TransformStream<Uint8Array, Uint8Array>();
			const app = createAgentApp({ name: "fake" })
				.onRequest(AGENT_METHODS.initialize, () => ({
					protocolVersion: 1,
					agentCapabilities: { sessionCapabilities: { close: {} } },
					agentInfo: { name: "fake", version: "1.2.3" },
				}))
				.onRequest(AGENT_METHODS.session_new, ({ params }) => {
					newParams.value = params;
					return { sessionId: "new-session", configOptions: [] };
				})
				.onRequest(AGENT_METHODS.session_prompt, () => ({ stopReason: "end_turn" }))
				.onRequest(AGENT_METHODS.session_close, () => ({}));
			app.connect(ndJsonStream(toChild.writable, toAgent.readable));
			const child: AcpChild = {
				stdin: toAgent.writable,
				stdout: toChild.readable,
				onStderr: () => {},
				onExit: () => {},
				stop: async () => {},
			};
			return ok(child);
		},
	};
}

describe("AGENT-11 ACP runner", () => {
	test("steering is off and app tools are on for OpenCode and Pi", () => {
		const runner = makeRunner();
		expect(runner.capabilities.steer).toBe(false);
		expect(runner.capabilities.mcpServers).toBe(true);
		expect(ACP_ADAPTERS.opencode.id).toBe("opencode");
		expect(ACP_ADAPTERS.pi.id).toBe("pi");
	});

	test("detect finds the adapter program and reads its version", async () => {
		const runner = makeRunner();

		expect(await runner.detect({ PATH: "/usr/bin" })).toEqual({
			path: "/fake/opencode",
			version: "1.18.18",
		});
	});

	test("a version below the adapter's minimum is recognised", () => {
		expect(isVersionBelow("1.16.1", "1.16.2")).toBe(true);
		expect(isVersionBelow("1.16.2", "1.16.2")).toBe(false);
		expect(isVersionBelow("1.18.18", "1.16.2")).toBe(false);
		expect(isVersionBelow("1.18.18", undefined)).toBe(false);
	});

	test("detect returns null when the program is missing", async () => {
		const runner = new AcpRunner({
			logger: logger(),
			clock: { now: () => 0 },
			ids: nextIds(),
			probe: async () => ok({ stdout: "", stderr: "", exitCode: 0 }),
			findExecutable: async () => null,
			adapter: fakeAdapter,
			spawn: async () => err({ code: "spawn_failed", message: "not used" } as AppError),
		});

		expect(await runner.detect({})).toBeNull();
	});

	test("session/new receives the app tools MCP server", async () => {
		const seen: { value: NewSessionRequest | null } = { value: null };
		const appTools = {
			name: "conducted",
			command: "/sidecar",
			args: [],
			env: [],
		};
		let released = 0;
		const runner = makeRunner({
			spawn: bridge(seen).spawn,
			appToolsServers: async () => ({
				servers: [appTools],
				release: () => {
					released += 1;
				},
			}),
		});

		const session: AgentSession = await runner.start(startOptions);
		await session.runTurn({ text: "hello", attachmentPaths: [], config }, callbacks());

		expect(seen.value?.mcpServers).toEqual([appTools]);
		expect(released).toBe(0);
		await session.dispose();
		await session.dispose();
		expect(released).toBe(1);
	});

	test("a file write asks for the start checkpoint through the runner", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "conducted-acp-runner-"));
		let checkpoints = 0;
		const spawn: ConstructorParameters<typeof AcpRunner>[0]["spawn"] = async () => {
			const toAgent = new TransformStream<Uint8Array, Uint8Array>();
			const toChild = new TransformStream<Uint8Array, Uint8Array>();
			const app = createAgentApp({ name: "fake" })
				.onRequest(AGENT_METHODS.initialize, () => ({
					protocolVersion: 1,
					agentCapabilities: { sessionCapabilities: { close: {} } },
					agentInfo: { name: "fake", version: "1.2.3" },
				}))
				.onRequest(AGENT_METHODS.session_new, () => ({
					sessionId: "new-session",
					configOptions: [],
				}))
				.onRequest(AGENT_METHODS.session_prompt, async (context) => {
					await context.client.request(CLIENT_METHODS.fs_write_text_file, {
						sessionId: "new-session",
						path: join(workspace, "wired.txt"),
						content: "hello",
					});
					return { stopReason: "end_turn" };
				})
				.onRequest(AGENT_METHODS.session_close, () => ({}));
			app.connect(ndJsonStream(toChild.writable, toAgent.readable));
			return ok({
				stdin: toAgent.writable,
				stdout: toChild.readable,
				onStderr: () => {},
				onExit: () => {},
				stop: async () => {},
			} satisfies AcpChild);
		};
		try {
			const runner = makeRunner({ spawn });
			const session = await runner.start({
				...startOptions,
				workspace: { ...startOptions.workspace, workspacePath: workspace },
			});

			await session.runTurn(
				{ text: "hello", attachmentPaths: [], config },
				{
					...callbacks(),
					beforeFirstWrite: async () => {
						checkpoints += 1;
					},
				},
			);

			expect(checkpoints).toBe(1);
			expect(await readFile(join(workspace, "wired.txt"), "utf8")).toBe("hello");
			await session.dispose();
		} finally {
			// The test owns this folder, so it removes it.
			await rm(workspace, { recursive: true, force: true });
		}
	});
});

describe("AGENT-12 ACP runner version gate", () => {
	test("start refuses an agent older than the adapter minimum", async () => {
		const runner = makeRunner({
			probe: async () => ok({ stdout: "1.16.1", stderr: "", exitCode: 0 }),
		});

		await expect(runner.start(startOptions)).rejects.toThrow("needs 1.16.2 or newer");
	});
});

function fakeLogger(): Logger {
	const fake: Logger = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => fake,
		setLevel: () => {},
	};
	return fake;
}

const clock: Clock = { now: () => 0 };
let nextId = 1;
const ids: IdSource = {
	uuid: () => {
		const id = `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
		nextId += 1;
		return id;
	},
};

const modelOptions: SessionConfigOption[] = [
	{
		type: "select",
		id: "model",
		name: "Model",
		category: "model",
		currentValue: "m2",
		options: [
			{ value: "m1", name: "Model One" },
			{ value: "m2", name: "Model Two" },
		],
	},
];

const reviewedCommands: SessionNotification["update"] = {
	sessionUpdate: "available_commands_update",
	availableCommands: [
		{ name: "review", description: "Review the diff", input: { hint: "<path>" } },
	],
};

interface FakeClientOptions {
	configOptions?: SessionConfigOption[];
	connect?: Result<{ agentVersion: string | undefined }, AppError>;
	open?: Result<
		{ acpSessionId: string; how: "new"; configOptions: SessionConfigOption[] },
		AppError
	>;
	afterOpen?: (handlers: AcpClientHandlers) => void;
	onClose?: () => void;
}

function fakeClient(
	options: FakeClientOptions,
	handlersRef: { handlers?: AcpClientHandlers },
): AcpClient {
	const connected = options.connect ?? ok({ agentVersion: "1.18.18" });
	const opened =
		options.open ??
		ok({
			acpSessionId: "acp-1",
			how: "new" as const,
			configOptions: options.configOptions ?? modelOptions,
		});
	return {
		connect: async () => connected,
		openSession: async () => {
			if (opened.ok && options.afterOpen !== undefined && handlersRef.handlers !== undefined) {
				options.afterOpen(handlersRef.handlers);
			}
			return opened;
		},
		prompt: async () => ok("end_turn"),
		cancel: () => {},
		setConfigOption: async () => ok(undefined),
		setMode: async () => ok(undefined),
		onClose: () => {},
		close: async () => {
			options.onClose?.();
		},
	};
}

function makeListingRunner(
	options: FakeClientOptions = {},
	overrides: { adapter?: AcpAdapter; clock?: Clock } = {},
): {
	runner: AcpRunner;
	closed: () => number;
	handlers: () => AcpClientHandlers | undefined;
} {
	let closeCount = 0;
	const handlersRef: { handlers?: AcpClientHandlers } = {};
	const deps: AcpRunnerDeps = {
		adapter: overrides.adapter ?? ACP_ADAPTERS.opencode,
		spawn: async () => err(appError("spawn_failed", "The test never starts an agent process.")),
		createClient: ({ handlers }) => {
			handlersRef.handlers = handlers;
			return fakeClient(
				{
					...options,
					onClose: () => {
						closeCount += 1;
						options.onClose?.();
					},
				},
				handlersRef,
			);
		},
		logger: fakeLogger(),
		clock: overrides.clock ?? clock,
		ids,
		probe: async () => ok({ stdout: "1.18.18", stderr: "", exitCode: 0 }),
		findExecutable: async () => "/fake/opencode",
	};
	return {
		runner: new AcpRunner(deps),
		closed: () => closeCount,
		handlers: () => handlersRef.handlers,
	};
}

describe("AGENT-12 ACP model and command listing", () => {
	test("models are mapped from the model config option and the session is closed", async () => {
		const { runner, closed } = makeListingRunner();
		const models = await runner.listModels();
		expect(models.map((model) => model.id)).toEqual(["m1", "m2"]);
		expect(models.map((model) => model.isDefault)).toEqual([false, true]);
		expect(closed()).toBe(1);
	});

	test("a model option that arrives after session/new is still used", async () => {
		const { runner } = makeListingRunner({
			configOptions: [],
			afterOpen: (handlers) => {
				queueMicrotask(() => {
					handlers.onSessionUpdate({
						sessionId: "acp-1",
						update: { sessionUpdate: "config_option_update", configOptions: modelOptions },
					} as SessionNotification);
				});
			},
		});
		const models = await runner.listModels();
		expect(models.map((model) => model.id)).toEqual(["m1", "m2"]);
	});

	test("a model list that never arrives is a named error, not an empty list", async () => {
		const { runner } = makeListingRunner(
			{ configOptions: [] },
			{ adapter: { ...ACP_ADAPTERS.opencode, waitForModelCatalogMs: 5 } },
		);

		await expect(runner.listModels()).rejects.toMatchObject({
			code: "acp_model_list_timeout",
		});
	});

	test("the 90 s cap uses the clock's elapsed time, so a late listing does not wait", async () => {
		let reads = 0;
		const lateClock: Clock = {
			now: () => {
				reads += 1;
				return reads === 1 ? 0 : 91_000;
			},
		};
		const { runner } = makeListingRunner(
			{ configOptions: [] },
			{ adapter: ACP_ADAPTERS.opencode, clock: lateClock },
		);
		const started = Date.now();

		await expect(runner.listModels()).rejects.toMatchObject({
			code: "acp_model_list_timeout",
		});
		expect(Date.now() - started).toBeLessThan(1000);
	});

	test("Pi does not wait for a model list and reports none", async () => {
		const { runner } = makeListingRunner({ configOptions: [] }, { adapter: ACP_ADAPTERS.pi });
		const started = Date.now();

		expect(await runner.listModels()).toEqual([]);
		expect(Date.now() - started).toBeLessThan(1000);
	});

	test("a session that cannot open is an error, and the client is still closed", async () => {
		const { runner, closed } = makeListingRunner({
			open: err(appError("acp_open_failed", "OpenCode refused the session.")),
		});
		await expect(runner.listModels()).rejects.toMatchObject({ code: "acp_open_failed" });
		expect(closed()).toBe(1);
	});

	test("slash commands come from the available commands update", async () => {
		const { runner } = makeListingRunner({
			afterOpen: (handlers) => {
				handlers.onSessionUpdate({
					sessionId: "acp-1",
					update: reviewedCommands,
				} as SessionNotification);
			},
		});
		expect(await runner.listSlashCommands("/tmp/work")).toEqual([
			{ name: "review", description: "Review the diff", argumentHint: "<path>" },
		]);
	});
});

describe("AGENT-12 ACP runner adapter hooks", () => {
	test("start applies session storage and prefixes the agent session id", async () => {
		const captured: { env?: Readonly<Record<string, string>> } = {};
		const handlersRef: { handlers?: AcpClientHandlers } = {};
		const runner = new AcpRunner({
			adapter: ACP_ADAPTERS.opencode,
			spawn: async () => err(appError("spawn_failed", "The test never starts an agent process.")),
			createClient: ({ env, handlers }) => {
				captured.env = env;
				handlersRef.handlers = handlers;
				return fakeClient({}, handlersRef);
			},
			logger: fakeLogger(),
			clock,
			ids,
			probe: async () => ok({ stdout: "1.18.18", stderr: "", exitCode: 0 }),
			findExecutable: async () => "/fake/opencode",
		});
		const seen: string[] = [];
		const session = await runner.start(startOptions);
		await session.runTurn(
			{ text: "hello", attachmentPaths: [], config },
			callbacks({ onAgentSessionId: (agentSessionId) => seen.push(agentSessionId) }),
		);

		expect(captured.env?.OPENCODE_DB).toBe(
			join("/workspace", ".context", "opencode", "opencode.db"),
		);
		expect(seen).toEqual(["opencode-acp-1"]);
		await session.dispose();
	});

	test("start refuses an unknown slash command before it reaches the agent", async () => {
		const handlersRef: { handlers?: AcpClientHandlers } = {};
		const runner = new AcpRunner({
			adapter: ACP_ADAPTERS.opencode,
			spawn: async () => err(appError("spawn_failed", "The test never starts an agent process.")),
			createClient: ({ handlers }) => {
				handlersRef.handlers = handlers;
				return fakeClient(
					{
						afterOpen: (openHandlers) => {
							openHandlers.onSessionUpdate({
								sessionId: "acp-1",
								update: reviewedCommands,
							} as SessionNotification);
						},
					},
					handlersRef,
				);
			},
			logger: fakeLogger(),
			clock,
			ids,
			probe: async () => ok({ stdout: "1.18.18", stderr: "", exitCode: 0 }),
			findExecutable: async () => "/fake/opencode",
		});
		const session = await runner.start(startOptions);
		const outcome = await session.runTurn(
			{ text: "/deploy now", attachmentPaths: [], config },
			callbacks(),
		);

		expect(outcome.kind).toBe("error");
		if (outcome.kind === "error") expect(outcome.message).toContain("does not know the command");
		await session.dispose();
	});
});

describe("SIDE-21 an ACP chat starts the program its launch names", () => {
	test("SIDE-21 the user's program path is the one the child starts, never the PATH copy", async () => {
		const commands: string[] = [];
		const runner = makeRunner({
			spawn: async (options) => {
				commands.push(options.command);
				return err({ code: "spawn_failed", message: "scripted" } as AppError);
			},
		});

		const session = await runner.start({
			...startOptions,
			executablePath: "/opt/opencode/bin/opencode",
		});
		const outcome = await session.runTurn(
			{ text: "hello", attachmentPaths: [], config },
			callbacks(),
		);
		await session.dispose();

		expect(outcome.kind).toBe("error");
		expect(commands).toEqual(["/opt/opencode/bin/opencode"]);
	});
});
