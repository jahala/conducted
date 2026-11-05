import { describe, expect, test } from "bun:test";
import type { SessionConfigOption, SessionNotification } from "@agentclientprotocol/sdk";
import type { AppError, Clock, IdSource } from "@conducted/shared";
import { appError, err, ok, type Result } from "@conducted/shared";
import type { Logger } from "../../logging/logger.ts";
import type { AcpClient, AcpClientHandlers } from "./acp-client.ts";
import { AcpRunner, type AcpRunnerDeps } from "./acp-runner.ts";
import { ACP_ADAPTERS } from "./adapters/registry.ts";

function fakeLogger(): Logger {
	const logger: Logger = {
		error: () => {},
		warn: () => {},
		info: () => {},
		debug: () => {},
		child: () => logger,
		setLevel: () => {},
	};
	return logger;
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

function makeRunner(options: FakeClientOptions = {}): {
	runner: AcpRunner;
	closed: () => number;
	handlers: () => AcpClientHandlers | undefined;
} {
	let closeCount = 0;
	const handlersRef: { handlers?: AcpClientHandlers } = {};
	const deps: AcpRunnerDeps = {
		adapter: ACP_ADAPTERS.opencode,
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
		clock,
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
		const { runner, closed } = makeRunner();
		const models = await runner.listModels();
		expect(models.map((model) => model.id)).toEqual(["m1", "m2"]);
		expect(models.map((model) => model.isDefault)).toEqual([false, true]);
		expect(closed()).toBe(1);
	});

	test("a model option that arrives after session/new is still used", async () => {
		const { runner } = makeRunner({
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

	test("a session that cannot open is an error, and the client is still closed", async () => {
		const { runner, closed } = makeRunner({
			open: err(appError("acp_open_failed", "OpenCode refused the session.")),
		});
		await expect(runner.listModels()).rejects.toMatchObject({ code: "acp_open_failed" });
		expect(closed()).toBe(1);
	});

	test("slash commands come from the available commands update", async () => {
		const { runner } = makeRunner({
			afterOpen: (handlers) => {
				handlers.onSessionUpdate({
					sessionId: "acp-1",
					update: {
						sessionUpdate: "available_commands_update",
						availableCommands: [
							{ name: "review", description: "Review the diff", input: { hint: "<path>" } },
						],
					},
				} as SessionNotification);
			},
		});
		expect(await runner.listSlashCommands("/tmp/work")).toEqual([
			{ name: "review", description: "Review the diff", argumentHint: "<path>" },
		]);
	});
});
