import { describe, expect, test } from "bun:test";
import {
	appToSidecarNotifications,
	appToSidecarRequests,
	type ModelInfo,
} from "@conducted/protocol";
import { appError, type EventId, err, ok, type SessionId } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import { buildHandlers, type HandlerDeps } from "./handlers.ts";

const testLogger = createLogger({
	sink: () => {},
	clock: { now: () => 0 },
	level: "error",
	scope: "test",
});

const model: ModelInfo = {
	id: "claude-sonnet",
	label: "Sonnet",
	status: "picker",
	isNew: false,
	isDefault: true,
	efforts: [],
	defaultEffort: "medium",
	effortAxis: "effort",
	liveEffortChange: false,
	supportsFastMode: false,
};

function deps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
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
			list: async () => ok([model]),
			validate: async () => ok(model),
			invalidate: () => {},
		},
		agents: {
			detectAll: async () => [{ agent: "claude", installed: true }],
			startLogin: async () => ok({ loginId: "login-1", instructions: "Sign in" }),
			finishLogin: async () => ok({ outcome: "signed_in" as const }),
			cancelLogin: async () => ok(undefined),
		},
		slashCommands: { list: async () => ok([]) },
		completions: { read: async () => ok(null), write: async () => ok(undefined) },
		mcpServers: { list: async () => ok([]) },
		usage: {
			contextUsage: async () => ok({ usedTokens: 1, windowTokens: 2, rateLimits: [] }),
		},
		shellEnv: {
			get: async () => ok({ shell: "/bin/zsh", path: "/usr/bin", env: {}, providerSecrets: {} }),
			refresh: async () =>
				ok({ shell: "/bin/zsh", path: "/usr/bin", env: {}, providerSecrets: {} }),
		},
		utilityPrompt: { run: async () => ok({ text: "" }) },
		setLogLevel: () => {},
		logger: testLogger,
		...overrides,
	};
}

describe("SIDE-02 handler tables", () => {
	test("SIDE-02 the request and notification keys equal the protocol tables", () => {
		const handlers = buildHandlers(deps());
		expect(Object.keys(handlers.requests).sort()).toEqual(Object.keys(appToSidecarRequests).sort());
		expect(Object.keys(handlers.notifications).sort()).toEqual(
			Object.keys(appToSidecarNotifications).sort(),
		);
	});
});

describe("SIDE-02 handler wiring", () => {
	test("SIDE-02 listModels is answered by the model catalog", async () => {
		const handlers = buildHandlers(deps());
		await expect(handlers.requests.listModels({ agent: "claude" })).resolves.toEqual(
			ok({ models: [model] }),
		);
	});

	test("SIDE-02 listModels forwards the agent and its ACP provider to the catalog", async () => {
		const asked: { agent: string; acpAgent?: string }[] = [];
		const handlers = buildHandlers(
			deps({
				models: {
					list: async (agent, acpAgent) => {
						asked.push({ agent, acpAgent });
						return ok([]);
					},
					validate: async () => err(appError("model_unknown", "missing")),
					invalidate: () => {},
				},
			}),
		);
		await handlers.requests.listModels({ agent: "acp", acpAgent: "opencode" });
		expect(asked).toEqual([{ agent: "acp", acpAgent: "opencode" }]);
	});

	test("SIDE-02 listModels keeps agent_not_installed as an error value", async () => {
		const handlers = buildHandlers(
			deps({
				models: {
					list: async () => err(appError("agent_not_installed", "codex is missing")),
					validate: async () => err(appError("agent_not_installed", "codex is missing")),
					invalidate: () => {},
				},
			}),
		);
		const listed = await handlers.requests.listModels({ agent: "codex" });
		expect("ok" in listed && listed.ok === false).toBe(true);
		if ("ok" in listed && listed.ok === false) {
			expect(listed.error.code).toBe("agent_not_installed");
		}
	});

	test("SIDE-02 a session request is passed to the session manager", async () => {
		const calls: string[] = [];
		const handlers = buildHandlers(
			deps({
				sessions: {
					...deps().sessions,
					cancel: async (params) => {
						calls.push(params.sessionId);
						return { wasWorking: true, droppedMessageIds: [] };
					},
				},
			}),
		);
		await expect(
			handlers.requests.cancel({ sessionId: "session-1" as SessionId }),
		).resolves.toEqual({
			wasWorking: true,
			droppedMessageIds: [],
		});
		expect(calls).toEqual(["session-1"]);
	});

	test("SIDE-02 setAutoApproveEdits is passed to the session manager", async () => {
		const calls: { sessionId: string; enabled: boolean }[] = [];
		const handlers = buildHandlers(
			deps({
				sessions: {
					...deps().sessions,
					setAutoApproveEdits: async (params) => {
						calls.push(params);
						return {};
					},
				},
			}),
		);
		await expect(
			handlers.requests.setAutoApproveEdits({
				sessionId: "session-1" as SessionId,
				enabled: true,
			}),
		).resolves.toEqual({});
		expect(calls).toEqual([{ sessionId: "session-1", enabled: true }]);
	});

	test("AGENT-17 listAcpConfigOptions is passed to the session manager", async () => {
		const calls: string[] = [];
		const handlers = buildHandlers(
			deps({
				sessions: {
					...deps().sessions,
					listAcpConfigOptions: async (params) => {
						calls.push(params.sessionId);
						return { options: [] };
					},
				},
			}),
		);

		await expect(
			handlers.requests.listAcpConfigOptions({ sessionId: "session-1" as SessionId }),
		).resolves.toEqual({ options: [] });
		expect(calls).toEqual(["session-1"]);
	});

	test("AGENT-17 setAcpConfigOption is passed to the session manager", async () => {
		const calls: { sessionId: string; optionId: string; value: string | boolean }[] = [];
		const handlers = buildHandlers(
			deps({
				sessions: {
					...deps().sessions,
					setAcpConfigOption: async (params) => {
						calls.push(params);
						return { options: [] };
					},
				},
			}),
		);

		await expect(
			handlers.requests.setAcpConfigOption({
				sessionId: "session-1" as SessionId,
				optionId: "thought_level",
				value: "high",
			}),
		).resolves.toEqual({ options: [] });
		expect(calls).toEqual([{ sessionId: "session-1", optionId: "thought_level", value: "high" }]);
	});

	test("SIDE-02 eventPersisted acknowledges the event in the outbox", async () => {
		const acknowledged: string[] = [];
		const handlers = buildHandlers(
			deps({
				outbox: {
					...deps().outbox,
					acknowledge: async (sessionId, eventId) => {
						acknowledged.push(`${sessionId}:${eventId}`);
						return ok(undefined);
					},
				},
			}),
		);
		await handlers.notifications.eventPersisted({
			sessionId: "session-1" as SessionId,
			eventId: "event-1" as EventId,
		});
		expect(acknowledged).toEqual(["session-1:event-1"]);
	});

	test("SIDE-02 setLogLevel changes the root logger", async () => {
		const levels: string[] = [];
		const handlers = buildHandlers(deps({ setLogLevel: (level) => levels.push(level) }));
		await handlers.notifications.setLogLevel({ level: "debug" });
		expect(levels).toEqual(["debug"]);
	});

	test("SIDE-02 getShellEnv returns the captured shell and path", async () => {
		const handlers = buildHandlers(deps());
		await expect(handlers.requests.getShellEnv({ workspacePath: "/work/app" })).resolves.toEqual(
			ok({ shell: "/bin/zsh", path: "/usr/bin" }),
		);
	});

	test("SIDE-02 a method owned by another feature answers not implemented", async () => {
		const handlers = buildHandlers(deps());
		await expect(
			handlers.requests.getGoal({ sessionId: "session-1" as SessionId }),
		).rejects.toMatchObject({
			name: "NotImplemented",
			featureId: "AGENT-13",
		});
	});

	test("AGENT-14 compact is answered by the session manager", async () => {
		const asked: SessionId[] = [];
		const handlers = buildHandlers(
			deps({
				sessions: {
					...deps().sessions,
					compact: async (params) => {
						asked.push(params.sessionId);
						return { started: true };
					},
				},
			}),
		);

		await expect(
			handlers.requests.compact({ sessionId: "session-1" as SessionId }),
		).resolves.toEqual({ started: true });
		expect(asked).toEqual(["session-1" as SessionId]);
	});
});

describe("SIDE-24 utility prompt handler", () => {
	test("SIDE-24 runUtilityPrompt is answered by the utility runner", async () => {
		const asked: unknown[] = [];
		const handlers = buildHandlers(
			deps({
				utilityPrompt: {
					run: async (params) => {
						asked.push(params);
						return ok({ text: "A short title" });
					},
				},
			}),
		);

		const params = {
			agent: "claude" as const,
			model: "cheap-model",
			prompt: "Name this chat",
			cwd: "/work/alpha",
			launch: { env: {}, providerKeys: {} },
		};
		await expect(handlers.requests.runUtilityPrompt(params)).resolves.toEqual(
			ok({ text: "A short title" }),
		);
		expect(asked).toEqual([params]);
	});
});
