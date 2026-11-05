/**
 * @feature AGENT-11 ACP client and runner (runner)
 * Owns: tests for capabilities, finding the adapter program and passing the app tools MCP server
 * to session/new.
 * Test first: capabilities.steer is false for both adapters.
 */
import { describe, expect, test } from "bun:test";
import {
	AGENT_METHODS,
	agent as createAgentApp,
	type NewSessionRequest,
	ndJsonStream,
} from "@agentclientprotocol/sdk";
import type { AgentMessage, SessionConfig } from "@conducted/protocol";
import { type AppError, err, ok, type SessionId, type WorkspaceId } from "@conducted/shared";
import { createLogger } from "../../logging/logger.ts";
import type { AgentSession, StartOptions, TurnCallbacks } from "../runner.ts";
import type { AcpChild } from "./acp-client.ts";
import { AcpRunner, isVersionBelow } from "./acp-runner.ts";
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
	permissionEnv: (requireApproval) => ({ FAKE_APPROVAL: requireApproval ? "ask" : "allow" }),
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
		appToolsServers?: (options: StartOptions) => readonly unknown[];
	} = {},
): AcpRunner {
	return new AcpRunner({
		logger: logger(),
		clock: { now: () => 0 },
		ids: nextIds(),
		probe: async () => ok({ stdout: "1.18.18", stderr: "", exitCode: 0 }),
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

function callbacks(): TurnCallbacks {
	return {
		onMessage: (_message: AgentMessage) => {},
		requestInteraction: async () => ({ kind: "withdrawn" }),
		onAgentSessionId: () => {},
		onBackgroundTasks: () => {},
		beforeFirstWrite: async () => {},
		onFastModeUnavailable: () => {},
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
	test("steering is off for OpenCode and Pi", () => {
		const runner = makeRunner();
		expect(runner.capabilities.steer).toBe(false);
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
		const runner = makeRunner({
			spawn: bridge(seen).spawn,
			appToolsServers: () => [appTools],
		});

		const session: AgentSession = await runner.start(startOptions);
		await session.runTurn({ text: "hello", attachmentPaths: [], config }, callbacks());

		expect(seen.value?.mcpServers).toEqual([appTools]);
		await session.dispose();
	});
});
