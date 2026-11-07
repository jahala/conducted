/**
 * The method-name map of the sidecar differential run: each neutral step of a scenario
 * (scenarios.ts) as the call each sidecar takes, and how each sidecar's own requests are answered
 * the way its app answers them.
 *
 * | Step              | Conductor                       | Ours                      |
 * | ----------------- | ------------------------------- | ------------------------- |
 * | warm              | warmAgent                       | warmAgent                 |
 * | send              | query                           | sendMessage               |
 * | cancel            | cancel                          | cancel                    |
 * | status            | getSessionStatus                | getSessionStatus          |
 * | listModels codex  | listCodexModels                 | listModels                |
 * | listModels claude | (none: the app's hosted catalog) | listModels               |
 * | listSlashCommands | fetchSlashCommands              | listSlashCommands         |
 * | event stored      | persistedSessionEvent           | eventPersisted            |
 * | tool approval     | toolApproval (from the sidecar) | requestInteraction        |
 * | plan approval     | exitPlanMode (from the sidecar) | requestInteraction        |
 * | event replay      | deliverSessionEvent             | deliverEvent              |
 *
 * Conductor's names come from the call inventory (`.context/day/conductor-ref/call-inventory.json`)
 * and the sidecar method table (`.context/conductor-re/inventory/sidecar_rpc_method.tsv`); its field
 * names from the wire schemas described in frontend.md 3c and sessions.md. Conductor's app builds the
 * agent prompt itself and sends it as `prompt`; the harness sends the user's text there, and sends our
 * sidecar `firstMessage: false`, so both agents get the same text.
 */
import type { Answer, Json } from "./client.ts";
import type { Side } from "./launch.ts";
import type { Scenario, Step } from "./scenarios.ts";
import type { Seal } from "./seal.ts";

export const SESSION_ID = "5d1ff000-0000-4000-8000-000000000001";

export interface RunContext {
	seal: Seal;
	scenario: Scenario;
	turn: number;
	lastTurnId: string | undefined;
}

export interface Adapter {
	side: Side;
	/** The call a step becomes, or undefined when this sidecar has no call for it. */
	call(step: Step, ctx: RunContext): { method: string; params: unknown } | undefined;
	/** The answer the app gives to a request from the sidecar. */
	answer(method: string, params: unknown, scenario: Scenario): Answer;
	/** The acknowledgement the app sends for a stored event, if this line is one to store. */
	ack(message: Json): { method: string; params: unknown } | undefined;
	/** True when this line says a turn ended. */
	turnEnded(message: Json): boolean;
}

const program = (ctx: RunContext) => `${ctx.seal.fakeBin}/${ctx.scenario.agent}`;
const model = (ctx: RunContext) => (ctx.scenario.agent === "claude" ? "sonnet" : "gpt-5.5");

function nextTurn(ctx: RunContext): { turnId: string; messageId: string } {
	ctx.turn += 1;
	const turnId = `turn-${ctx.turn}`;
	ctx.lastTurnId = turnId;
	return { turnId, messageId: `message-${ctx.turn}` };
}

const params = (value: unknown): Json =>
	typeof value === "object" && value !== null ? (value as Json) : {};

// ---------------------------------------------------------------- Conductor

function conductorOptions(ctx: RunContext): Json {
	const { scenario, seal } = ctx;
	const options: Json = {
		cwd: seal.repo,
		model: model(ctx),
		requiresToolApprovals: scenario.requireToolApproval === true,
	};
	// The effort our harness gives our sidecar ("high"), in Conductor's words.
	if (scenario.agent === "claude") {
		options.claudeExecutablePath = program(ctx);
		options.agentParams = { agentType: "claude", effortLevel: "high" };
	} else {
		options.codexExecutablePath = program(ctx);
		options.agentParams = { agentType: "codex", modelReasoningEffort: "high" };
	}
	return options;
}

export const conductorAdapter: Adapter = {
	side: "conductor",
	call(step, ctx) {
		const agentType = ctx.scenario.agent;
		switch (step.do) {
			case "warm":
				return {
					method: "warmAgent",
					params: { type: "warm_agent", id: SESSION_ID, agentType, options: conductorOptions(ctx) },
				};
			case "send": {
				const { turnId, messageId } = nextTurn(ctx);
				const options: Json = { ...conductorOptions(ctx), turnId, userMessageId: messageId };
				if (agentType === "claude")
					options.permissionMode = ctx.scenario.planMode ? "plan" : "default";
				else if (ctx.scenario.requireToolApproval) {
					// Conductor reads the policy only when the sandbox mode comes with it; this is the
					// sandbox our sidecar picks when none is set (session-config.ts).
					options.initialCodexApprovalPolicy = "on-request";
					options.initialCodexSandboxMode = "danger-full-access";
				}
				return {
					method: "query",
					params: {
						type: "query",
						id: SESSION_ID,
						agentType,
						message: step.text,
						prompt: step.text,
						options,
					},
				};
			}
			case "cancel":
				return {
					method: "cancel",
					params: { type: "cancel", id: SESSION_ID, agentType, turnId: ctx.lastTurnId },
				};
			case "status":
				return {
					method: "getSessionStatus",
					params: { type: "get_session_status", id: SESSION_ID },
				};
			case "listModels":
				if (agentType === "claude") return undefined;
				return {
					method: "listCodexModels",
					params: {
						type: "list_codex_models",
						agentType: "codex",
						cwd: ctx.seal.repo,
						codexExecutablePath: program(ctx),
					},
				};
			case "listSlashCommands":
				return {
					method: "fetchSlashCommands",
					params: {
						type: "fetch_slash_commands",
						id: SESSION_ID,
						agentType,
						options: { cwd: ctx.seal.repo, claudeExecutablePath: program(ctx) },
					},
				};
			default:
				return undefined;
		}
	},
	answer(method, _params, scenario) {
		const approve = scenario.approve !== false;
		switch (method) {
			case "deliverSessionEvent":
				return { result: {} };
			case "toolApproval":
				return { result: { decision: approve ? "allow" : "deny" } };
			case "exitPlanMode":
				return { result: { approved: approve } };
			case "askUserQuestion":
				return { result: { answers: [] } };
			case "codexPermissionApproval":
				return approve
					? { result: { action: "grant", grantedPermissions: {}, scope: "turn" } }
					: { result: { action: "decline" } };
			default:
				return { error: { code: -32601, message: `the harness does not answer ${method}` } };
		}
	},
	ack(message) {
		if (message.method !== "sessionEventNotification" && message.method !== "deliverSessionEvent")
			return undefined;
		const event = params(params(message.params).event);
		if (typeof event.eventId !== "string") return undefined;
		return {
			method: "persistedSessionEvent",
			params: { sessionId: params(message.params).id, eventId: event.eventId },
		};
	},
	turnEnded(message) {
		return (
			message.method === "sessionStatusNotification" && params(message.params).status === "idle"
		);
	},
};

// ---------------------------------------------------------------- ours

function ourConfig(ctx: RunContext): Json {
	const { scenario } = ctx;
	return {
		agent: scenario.agent,
		model: model(ctx),
		effort: "high",
		fastMode: false,
		planMode: scenario.planMode === true,
		requireToolApproval: scenario.requireToolApproval === true,
		additionalDirectories: [],
		appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
	};
}

function ourWorkspace(ctx: RunContext): Json {
	return {
		workspaceId: "workspace-1",
		workspaceName: "repo",
		workspacePath: ctx.seal.repo,
		repoRootPath: ctx.seal.repo,
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 55100,
	};
}

const ourLaunch = (ctx: RunContext): Json => ({
	executablePath: program(ctx),
	env: {},
	providerKeys: {},
});

export const ourAdapter: Adapter = {
	side: "ours",
	call(step, ctx) {
		const base = { config: ourConfig(ctx), workspace: ourWorkspace(ctx), launch: ourLaunch(ctx) };
		switch (step.do) {
			case "warm":
				return { method: "warmAgent", params: { sessionId: SESSION_ID, ...base } };
			case "send": {
				const { turnId, messageId } = nextTurn(ctx);
				return {
					method: "sendMessage",
					params: {
						sessionId: SESSION_ID,
						messageId,
						turnId,
						text: step.text,
						attachmentPaths: [],
						delivery: "new_turn",
						firstMessage: false,
						...base,
					},
				};
			}
			case "cancel":
				return { method: "cancel", params: { sessionId: SESSION_ID } };
			case "status":
				return { method: "getSessionStatus", params: { sessionId: SESSION_ID } };
			case "listModels":
				return {
					method: "listModels",
					params: { agent: ctx.scenario.agent, launch: ourLaunch(ctx) },
				};
			case "listSlashCommands":
				return {
					method: "listSlashCommands",
					params: {
						agent: ctx.scenario.agent,
						workspacePath: ctx.seal.repo,
						repoRootPath: ctx.seal.repo,
						launch: ourLaunch(ctx),
					},
				};
			default:
				return undefined;
		}
	},
	answer(method, value, scenario) {
		const approve = scenario.approve !== false;
		if (method === "deliverEvent") return { result: { persisted: true } };
		if (method !== "requestInteraction")
			return { error: { code: -32601, message: `the harness does not answer ${method}` } };
		const kind = params(params(value).interaction).kind;
		switch (kind) {
			case "tool_approval":
				return { result: { kind, decision: approve ? "allow" : "deny" } };
			case "plan_approval":
				return { result: { kind, approved: approve } };
			case "permission_grant":
				return { result: { kind, granted: approve } };
			case "question":
				return { result: { kind, answers: [] } };
			default:
				return { result: { kind: "withdrawn" } };
		}
	},
	ack(message) {
		if (message.method !== "sessionEvent") return undefined;
		const envelope = params(message.params);
		const event = params(envelope.event);
		if (typeof event.eventId !== "string") return undefined;
		return {
			method: "eventPersisted",
			params: { sessionId: envelope.sessionId, eventId: event.eventId },
		};
	},
	turnEnded(message) {
		return (
			message.method === "sessionEvent" &&
			params(params(message.params).event).type === "turn_ended"
		);
	},
};

export const ADAPTERS: Record<Side, Adapter> = { conductor: conductorAdapter, ours: ourAdapter };
