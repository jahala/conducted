/**
 * @feature AGENT-09 Cursor: SDK in process
 * Owns: tests for one chat's Cursor agent: loading the SDK lazily, resume and create, one run at a
 * time, streaming, waiting, steer, cancel, config changes, usage and dispose.
 * Test first: with a fake SDK whose run streams one text message and finishes, runTurn emits one
 * text message and resolves success.
 */
import { describe, expect, test } from "bun:test";
import type { AgentMessage, SessionConfig } from "@conducted/protocol";
import type { SessionId, WorkspaceId } from "@conducted/shared";
import { ok } from "@conducted/shared";
import { createLogger, type LogRecord } from "../../logging/logger.ts";
import { KeyedSerialQueue } from "../../session/serial-queue.ts";
import {
	FakeCursorRun,
	FakeCursorSdk,
	FakeCursorTranslator,
} from "../../test-support/cursor-fakes.ts";
import { NoActiveTurnError, SteerNotSupportedError, SteerRevertedError } from "../errors.ts";
import type { StartOptions, TurnCallbacks, TurnInput } from "../runner.ts";
import type { CursorSdk } from "./cursor-sdk.ts";
import { CursorSession } from "./cursor-session.ts";
import { EnvLock } from "./env-lock.ts";
import type { CursorTranslator } from "./translate.ts";

const baseConfig: SessionConfig = {
	agent: "cursor",
	model: "cursor-composer-2-5",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

function startOptions(overrides: Partial<StartOptions> = {}): StartOptions {
	return {
		sessionId: "session-1" as SessionId,
		config: baseConfig,
		workspace: {
			workspaceId: "workspace-1" as WorkspaceId,
			workspaceName: "one",
			workspacePath: "/workspace/one",
			repoRootPath: "/repo",
			targetBranch: "origin/main",
			placeholderBranch: false,
			port: 4310,
		},
		env: { CURSOR_API_KEY: "cursor-key", HOME: "/home/tester" },
		...overrides,
	};
}

const turnInput = (overrides: Partial<TurnInput> = {}): TurnInput => ({
	text: "hello",
	attachmentPaths: [],
	config: baseConfig,
	...overrides,
});

interface Recorder extends TurnCallbacks {
	messages: AgentMessage[];
	interactions: number;
}

function callbacks(): Recorder {
	const state: Recorder = {
		messages: [],
		interactions: 0,
		onMessage: (message) => state.messages.push(message),
		requestInteraction: async () => {
			state.interactions += 1;
			return { kind: "withdrawn" };
		},
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
	};
	return state;
}

function makeLogger(records: LogRecord[] = []) {
	return createLogger({
		sink: (record) => records.push(record),
		clock: { now: () => 0 },
		level: "debug",
		scope: "test:cursor-session",
	});
}

function makeSession(
	sdk: FakeCursorSdk | null,
	options: {
		apiKey?: string | undefined;
		storeDir?: string;
		start?: StartOptions;
		loadError?: boolean;
		records?: LogRecord[];
	} = {},
) {
	const translator = new FakeCursorTranslator();
	const target: Record<string, string | undefined> = {};
	const envLock = new EnvLock({ queue: new KeyedSerialQueue(), target });
	let loads = 0;
	const session = new CursorSession(
		{
			loadSdk: async () => {
				loads += 1;
				if (options.loadError === true) {
					return {
						ok: false,
						error: { code: "cursor_sdk_missing", message: "Cursor's SDK is not installed." },
					} as const;
				}
				return ok(sdk as CursorSdk);
			},
			envLock,
			translator: translator as unknown as CursorTranslator,
			apiKey: "apiKey" in options ? options.apiKey : "cursor-key",
			mcpServers: {},
			...(options.storeDir === undefined ? {} : { storeDir: options.storeDir }),
			logger: makeLogger(options.records),
		},
		options.start ?? startOptions(),
	);
	return {
		session,
		translator,
		target,
		loads: () => loads,
	};
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
	const deadline = Date.now() + 2000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}

describe("AGENT-09 Cursor session", () => {
	test("a run that streams one text message emits it and resolves success", async () => {
		const run = new FakeCursorRun();
		run.messages.push({ type: "text", text: "hello" });
		const sdk = new FakeCursorSdk(run);
		const { session, translator } = makeSession(sdk);
		const recorded = callbacks();

		const outcome = session.runTurn(turnInput(), recorded);
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		run.finish();

		expect(await outcome).toEqual({ kind: "success" });
		expect(recorded.messages).toEqual([
			{ agent: "cursor", items: [{ kind: "text", text: "hello" }] },
		]);
		expect(translator.pushed).toEqual([{ type: "text", text: "hello" }]);
		expect(run.waitCalls).toBe(1);
	});

	test("the SDK is loaded on the first turn, not when the session is made", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const subject = makeSession(sdk);
		expect(subject.loads()).toBe(0);

		const outcome = subject.session.runTurn(turnInput(), callbacks());
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		expect(subject.loads()).toBe(1);
		run.finish();
		await outcome;
	});

	test("resume uses our session id and passes the model parameters fast and effort", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const { session } = makeSession(sdk, {
			start: startOptions({ config: { ...baseConfig, fastMode: true, effort: "high" } }),
		});

		const outcome = session.runTurn(
			turnInput({ config: { ...baseConfig, fastMode: true, effort: "high" } }),
			callbacks(),
		);
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		run.finish();
		await outcome;

		expect(sdk.resumeCalls).toHaveLength(1);
		expect(sdk.resumeCalls[0]?.agentId).toBe("session-1");
		expect(sdk.resumeCalls[0]?.options.apiKey).toBe("cursor-key");
		expect(sdk.resumeCalls[0]?.options.model).toEqual({
			id: "cursor-composer-2-5",
			params: [
				{ id: "fast", value: "true" },
				{ id: "effort", value: "high" },
			],
		});
		expect(sdk.resumeCalls[0]?.options.local.cwd).toBe("/workspace/one");
	});

	test("a resume that fails for a reason other than sign-in creates the agent and logs that history is gone", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		sdk.resumeError = new Error("No agent with that id");
		const records: LogRecord[] = [];
		const { session } = makeSession(sdk, { records });

		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		run.finish();
		expect(await outcome).toEqual({ kind: "success" });

		expect(sdk.createCalls).toHaveLength(1);
		expect(sdk.createCalls[0]?.agentId).toBe("session-1");
		expect(records.some((record) => record.message.includes("history is gone"))).toBe(true);
	});

	test("a rejected key gives a message that points to Settings and never the key", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		sdk.resumeError = new Error("401 unauthorized: bad api key");
		const { session } = makeSession(sdk);

		const outcome = await session.runTurn(turnInput(), callbacks());
		expect(outcome.kind).toBe("error");
		if (outcome.kind === "error") {
			expect(outcome.message).toContain("Settings");
			expect(outcome.message).not.toContain("cursor-key");
		}
		expect(sdk.agent.sent).toHaveLength(0);
	});

	test("a missing key fails before the SDK is loaded", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const subject = makeSession(sdk, { apiKey: undefined });

		const outcome = await subject.session.runTurn(turnInput(), callbacks());
		expect(outcome.kind).toBe("error");
		expect(subject.loads()).toBe(0);
	});

	test("a second turn while one runs is refused", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const { session } = makeSession(sdk);

		const first = session.runTurn(turnInput(), callbacks());
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		const second = await session.runTurn(turnInput(), callbacks());
		expect(second.kind).toBe("error");
		if (second.kind === "error") expect(second.message).toContain("already in progress");

		run.finish();
		expect(await first).toEqual({ kind: "success" });
	});

	test("cancel sets a flag, calls run.cancel, resolves cancelled and drops late messages", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const { session, translator } = makeSession(sdk);
		const recorded = callbacks();

		const outcome = session.runTurn(turnInput(), recorded);
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		run.lateMessages.push({ type: "text", text: "too late" });
		await session.cancel();

		expect(await outcome).toEqual({ kind: "cancelled" });
		expect(run.cancelCalls).toBe(1);
		expect(translator.pushed).toEqual([]);
		expect(recorded.messages).toEqual([]);
	});

	test("cancel before the run starts stops the turn without sending", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const { session } = makeSession(sdk);

		const outcome = session.runTurn(turnInput(), callbacks());
		await session.cancel();
		expect(await outcome).toEqual({ kind: "cancelled" });
		expect(sdk.agent.sent).toHaveLength(0);
	});

	test("a delivered steer goes through run.steer", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const { session } = makeSession(sdk);

		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		const steered = await session.steer(turnInput({ text: "also this" }));
		await steered.consumed;
		expect(run.steerCalls).toEqual(["also this"]);

		run.finish();
		expect(await outcome).toEqual({ kind: "success" });
	});

	test("a steer the run hands back becomes a follow-up", async () => {
		const run = new FakeCursorRun();
		run.steerOutcome = "complete_not_sent";
		const sdk = new FakeCursorSdk(run);
		const { session } = makeSession(sdk);

		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		await expect(session.steer(turnInput({ text: "later" }))).rejects.toBeInstanceOf(
			SteerRevertedError,
		);

		run.finish();
		await outcome;
	});

	test("steer without a run and on a run that cannot steer are typed errors", async () => {
		const idle = makeSession(new FakeCursorSdk(new FakeCursorRun()));
		await expect(idle.session.steer(turnInput())).rejects.toBeInstanceOf(NoActiveTurnError);

		const run = new FakeCursorRun({ steer: false });
		const sdk = new FakeCursorSdk(run);
		const { session } = makeSession(sdk);
		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		await expect(session.steer(turnInput())).rejects.toBeInstanceOf(SteerNotSupportedError);

		run.finish();
		await outcome;
	});

	test("Cursor asks the user for nothing, so there are no approvals", async () => {
		const run = new FakeCursorRun();
		run.messages.push({ type: "tool_call", name: "shell" });
		const sdk = new FakeCursorSdk(run);
		const { session } = makeSession(sdk);
		const recorded = callbacks();

		const outcome = session.runTurn(
			turnInput({ config: { ...baseConfig, requireToolApproval: true } }),
			recorded,
		);
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		run.finish();
		await outcome;

		expect(recorded.interactions).toBe(0);
	});

	test("applyConfig keeps the agent for the same options and asks for a restart when they change", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const { session } = makeSession(sdk);

		expect(await session.applyConfig({ ...baseConfig })).toBe("applied");
		expect(await session.applyConfig({ ...baseConfig, model: "gpt-5-6-sol" })).toBe("restart");
		expect(await session.applyConfig({ ...baseConfig, model: "gpt-5-6-sol" })).toBe("applied");
		expect(await session.applyConfig({ ...baseConfig, model: "gpt-5-6-sol", effort: "high" })).toBe(
			"restart",
		);
		expect(
			await session.applyConfig({
				...baseConfig,
				model: "gpt-5-6-sol",
				effort: "high",
				fastMode: true,
			}),
		).toBe("restart");
	});

	test("a restart actually recreates the agent with the new options", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const { session } = makeSession(sdk);

		const first = session.runTurn(turnInput(), callbacks());
		await waitFor(() => sdk.agent.sent.length === 1, "the first send");
		run.finish();
		await first;

		await session.applyConfig({ ...baseConfig, model: "gpt-5-6-sol" });
		const second = session.runTurn(
			turnInput({ config: { ...baseConfig, model: "gpt-5-6-sol" } }),
			callbacks(),
		);
		await waitFor(() => sdk.agent.sent.length === 2, "the second send");
		run.finish();
		await second;

		expect(sdk.resumeCalls).toHaveLength(2);
		expect(sdk.resumeCalls[1]?.options.model.id).toBe("gpt-5-6-sol");
	});

	test("context usage is null and dispose ends a live run", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const { session } = makeSession(sdk);
		expect(await session.contextUsage()).toBeNull();

		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		await session.dispose();
		expect(await outcome).toEqual({ kind: "cancelled" });

		const later = await session.runTurn(turnInput(), callbacks());
		expect(later.kind).toBe("error");
	});

	test("the run store folder and its variable reach the SDK calls", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const target: Record<string, string | undefined> = {};
		const session = new CursorSession(
			{
				loadSdk: async () => ok(sdk),
				envLock: new EnvLock({ queue: new KeyedSerialQueue(), target }),
				translator: new FakeCursorTranslator() as unknown as CursorTranslator,
				apiKey: "cursor-key",
				mcpServers: {},
				storeDir: "/app-data/cursor-sdk-store/abc",
				logger: makeLogger(),
			},
			startOptions(),
		);

		sdk.onResume = () => {
			expect(target.CONDUCTED_CURSOR_STORE_DIR).toBe("/app-data/cursor-sdk-store/abc");
		};
		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		run.finish();
		await outcome;

		expect(sdk.resumeCalls[0]?.options.local.storeDir).toBe("/app-data/cursor-sdk-store/abc");
		expect(target.CONDUCTED_CURSOR_STORE_DIR).toBeUndefined();
	});

	test("run start, steer and cancel log under the CursorAgentRunner tag", async () => {
		const run = new FakeCursorRun();
		const sdk = new FakeCursorSdk(run);
		const records: LogRecord[] = [];
		const { session } = makeSession(sdk, { records });

		const outcome = session.runTurn(turnInput(), callbacks());
		await waitFor(() => sdk.agent.sent.length === 1, "the send");
		await session.steer(turnInput({ text: "again" }));
		await session.cancel();
		await outcome;

		const scopes = records.map((record) => record.scope);
		expect(scopes.every((scope) => scope.includes("CursorAgentRunner"))).toBe(true);
		const messages = records.map((record) => record.message).join("\n");
		expect(messages).toContain("run started");
		expect(messages).toContain("steer delivered");
		expect(messages).toContain("cancel");
	});
});
