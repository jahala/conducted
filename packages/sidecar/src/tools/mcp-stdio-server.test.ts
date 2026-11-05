import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { SessionConfig } from "@conducted/protocol";
import { type SessionId, systemClock } from "@conducted/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLogger } from "../logging/logger.ts";
import { FakeApp } from "../test-support/fake-app.ts";
import { FakeInteractions } from "../test-support/fake-interactions.ts";
import { RpcAppToolBackend } from "./backend.ts";
import {
	callBridgeOverSocket,
	createAppToolsMcpServer,
	runAppToolsMcp,
} from "./mcp-stdio-server.ts";
import { AppToolsBridge } from "./socket-bridge.ts";

const ALL_TOOLS: SessionConfig["appTools"] = {
	diffComments: true,
	progressUpdates: true,
	setTargetBranch: true,
};

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function makeBridge(): Promise<{
	bridge: AppToolsBridge;
	app: FakeApp;
	socketPath: string;
}> {
	const logger = createLogger({
		sink: () => {},
		clock: systemClock,
		level: "debug",
		scope: "test",
	});
	const app = new FakeApp();
	let tokenNumber = 0;
	const bridge = new AppToolsBridge({
		backend: new RpcAppToolBackend({
			app,
			interactions: new FakeInteractions(),
			logger,
		}),
		tokens: { newToken: () => `bridge-token-${++tokenNumber}` },
		logger,
		makeTempDir: (prefix) => mkdtemp(path.join(tmpdir(), prefix)),
	});
	const started = await bridge.start();
	if (!started.ok) throw new Error(started.error.message);
	cleanups.push(() => bridge.stop());
	return { bridge, app, socketPath: started.value.socketPath };
}

describe("SIDE-13 app tools MCP helper", () => {
	test("SIDE-13 lists the bridge tools without AskUserQuestion", async () => {
		const { bridge, socketPath } = await makeBridge();
		const args = {
			sessionId: "session-a" as SessionId,
			socketPath,
			workspaceDir: "/Users/me/Workspace",
			appTools: ALL_TOOLS,
		};
		const token = bridge.registerSession(args.sessionId, ALL_TOOLS);
		const server = createAppToolsMcpServer({
			args,
			token,
			callBridge: callBridgeOverSocket,
			log: () => {},
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		const client = new Client({ name: "test", version: "1.0.0" });
		await client.connect(clientTransport);
		try {
			const listed = await client.listTools();
			expect(listed.tools.map((tool) => tool.name)).toEqual([
				"GetWorkspaceDiff",
				"GetDiffComments",
				"DiffComment",
				"GetTerminalOutput",
				"UpdateProgress",
				"SetTargetBranch",
			]);
		} finally {
			await client.close();
			await server.close();
		}
	});

	test("SIDE-13 a tool call reaches the bridge with the token and session id", async () => {
		const { bridge, app, socketPath } = await makeBridge();
		const args = {
			sessionId: "session-a" as SessionId,
			socketPath,
			workspaceDir: "/Users/me/Workspace",
			appTools: ALL_TOOLS,
		};
		const token = bridge.registerSession(args.sessionId, ALL_TOOLS);
		const server = createAppToolsMcpServer({
			args,
			token,
			callBridge: callBridgeOverSocket,
			log: () => {},
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		const client = new Client({ name: "test", version: "1.0.0" });
		await client.connect(clientTransport);
		try {
			const result = await client.callTool({
				name: "GetWorkspaceDiff",
				arguments: { stat: true },
			});
			expect(result.isError).toBe(false);
			expect(result.content).toEqual([{ type: "text", text: "No changes found." }]);
			expect(app.requested("getWorkspaceDiff")).toEqual([
				{ sessionId: args.sessionId, file: undefined, statOnly: true },
			]);
		} finally {
			await client.close();
			await server.close();
		}
	});

	test("SIDE-13 a missing bridge answers the tool with an error", async () => {
		const args = {
			sessionId: "session-a" as SessionId,
			socketPath: path.join(tmpdir(), `conducted-side.13-missing-${randomUUID()}`),
			workspaceDir: "/Users/me/Workspace",
			appTools: ALL_TOOLS,
		};
		const server = createAppToolsMcpServer({
			args,
			token: "token",
			callBridge: callBridgeOverSocket,
			log: () => {},
		});
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await server.connect(serverTransport);
		const client = new Client({ name: "test", version: "1.0.0" });
		await client.connect(clientTransport);
		try {
			const result = await client.callTool({
				name: "GetWorkspaceDiff",
				arguments: {},
			});
			expect(result.isError).toBe(true);
			const content = result.content as { type: string; text?: string }[];
			expect(content[0]?.type).toBe("text");
			expect(typeof content[0]?.text).toBe("string");
		} finally {
			await client.close();
			await server.close();
		}
	});

	test("SIDE-13 the helper says hello with its pid, then exits when stdin closes", async () => {
		const { bridge, socketPath } = await makeBridge();
		const args = {
			sessionId: "session-a" as SessionId,
			socketPath,
			workspaceDir: "/Users/me/Workspace",
			appTools: ALL_TOOLS,
		};
		const token = bridge.registerSession(args.sessionId, ALL_TOOLS);
		const stdin = new PassThrough();
		const stdout = new PassThrough();
		const lines: string[] = [];
		let helloSeen: () => void = () => {};
		const seen = new Promise<void>((resolve) => {
			helloSeen = resolve;
		});
		const running = runAppToolsMcp({
			args,
			token,
			stdin,
			stdout,
			pid: 4321,
			log: () => {},
			callBridge: async (target, line) => {
				lines.push(line);
				if ((JSON.parse(line) as { hello?: unknown }).hello !== undefined) helloSeen();
				return callBridgeOverSocket(target, line);
			},
		});
		await seen;
		stdin.end();
		expect(await running).toBe(0);
		expect(JSON.parse(lines[0] ?? "")).toEqual({
			authToken: token,
			sessionId: args.sessionId,
			hello: { pid: 4321 },
		});
	});
});
