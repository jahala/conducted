import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionConfig } from "@conducted/protocol";
import { type SessionId, systemClock } from "@conducted/shared";
import { createLogger, type LogRecord } from "../logging/logger.ts";
import { FakeApp } from "../test-support/fake-app.ts";
import { FakeInteractions } from "../test-support/fake-interactions.ts";
import { RpcAppToolBackend } from "./backend.ts";
import { BRIDGE_MAX_LINE_CHARS, zBridgeResponse } from "./bridge-protocol.ts";
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

interface BridgeHarness {
	bridge: AppToolsBridge;
	app: FakeApp;
	socketPath: string;
	folder: string;
	records: LogRecord[];
}

async function makeBridge(options: { idleTimeoutMs?: number } = {}): Promise<BridgeHarness> {
	const records: LogRecord[] = [];
	const logger = createLogger({
		sink: (record) => records.push(record),
		clock: systemClock,
		level: "debug",
		scope: "test",
	});
	const app = new FakeApp();
	const backend = new RpcAppToolBackend({
		app,
		interactions: new FakeInteractions(),
		logger,
	});
	const folders: string[] = [];
	let tokenNumber = 0;
	const bridge = new AppToolsBridge({
		backend,
		tokens: { newToken: () => `token-${++tokenNumber}` },
		logger,
		makeTempDir: async (prefix) => {
			const created = await mkdtemp(path.join(tmpdir(), prefix));
			folders.push(created);
			return created;
		},
		idleTimeoutMs: options.idleTimeoutMs,
	});
	const started = await bridge.start();
	if (!started.ok) throw new Error(started.error.message);
	cleanups.push(async () => {
		await bridge.stop();
		for (const folder of folders) await rm(folder, { recursive: true, force: true });
	});
	return {
		bridge,
		app,
		socketPath: started.value.socketPath,
		folder: path.dirname(started.value.socketPath),
		records,
	};
}

function sendLine(socketPath: string, line: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		socket.setEncoding("utf8");
		let received = "";
		let settled = false;
		const settle = (finish: () => void): void => {
			if (settled) return;
			settled = true;
			socket.destroy();
			finish();
		};
		socket.once("connect", () => socket.write(`${line}\n`));
		socket.on("data", (chunk: string) => {
			received += chunk;
			const newline = received.indexOf("\n");
			if (newline === -1) return;
			settle(() => resolve(received.slice(0, newline)));
		});
		socket.once("error", (cause) => settle(() => reject(cause)));
		socket.once("close", () =>
			settle(() => reject(new Error("The bridge closed without an answer."))),
		);
	});
}

async function call(
	socketPath: string,
	request: { authToken: string; sessionId: SessionId; toolName: string; args: unknown },
): Promise<unknown> {
	const line = await sendLine(socketPath, JSON.stringify(request));
	return JSON.parse(line);
}

describe("SIDE-13 socket bridge", () => {
	test("SIDE-13 a call with another chat's token is unauthorized and the tool does not run", async () => {
		const { bridge, app, socketPath } = await makeBridge();
		const sessionA = "session-a" as SessionId;
		const sessionB = "session-b" as SessionId;
		bridge.registerSession(sessionA, ALL_TOOLS);
		const tokenB = bridge.registerSession(sessionB, ALL_TOOLS);

		const answer = await call(socketPath, {
			authToken: tokenB,
			sessionId: sessionA,
			toolName: "GetWorkspaceDiff",
			args: {},
		});

		expect(zBridgeResponse.parse(answer)).toEqual({ ok: false, error: "Unauthorized" });
		expect(app.requests).toEqual([]);
	});

	test("SIDE-13 a registered chat's token runs the same tool definitions", async () => {
		const { bridge, app, socketPath } = await makeBridge();
		const sessionId = "session-a" as SessionId;
		const token = bridge.registerSession(sessionId, ALL_TOOLS);

		const answer = await call(socketPath, {
			authToken: token,
			sessionId,
			toolName: "GetWorkspaceDiff",
			args: { stat: true },
		});

		expect(zBridgeResponse.parse(answer)).toEqual({
			ok: true,
			text: "No changes found.",
			isError: false,
		});
		expect(app.requested("getWorkspaceDiff")).toEqual([
			{ sessionId, file: undefined, statOnly: true },
		]);
	});

	test("SIDE-13 a tool switched off for the chat is refused", async () => {
		const { bridge, app, socketPath } = await makeBridge();
		const sessionId = "session-a" as SessionId;
		const token = bridge.registerSession(sessionId, {
			diffComments: false,
			progressUpdates: true,
			setTargetBranch: true,
		});

		const answer = await call(socketPath, {
			authToken: token,
			sessionId,
			toolName: "GetDiffComments",
			args: {},
		});

		expect(zBridgeResponse.parse(answer)).toEqual({
			ok: false,
			error: "The GetDiffComments tool is not available in this chat.",
		});
		expect(app.requests).toEqual([]);
	});

	test("SIDE-13 AskUserQuestion is never offered over the bridge", async () => {
		const { bridge, socketPath } = await makeBridge();
		const sessionId = "session-a" as SessionId;
		const token = bridge.registerSession(sessionId, ALL_TOOLS);

		const answer = await call(socketPath, {
			authToken: token,
			sessionId,
			toolName: "AskUserQuestion",
			args: { questions: [] },
		});

		expect(zBridgeResponse.parse(answer)).toEqual({
			ok: false,
			error: "The AskUserQuestion tool is not available in this chat.",
		});
	});

	test("SIDE-13 a hello with a matching token is logged with its pid", async () => {
		const { bridge, socketPath, records } = await makeBridge();
		const sessionId = "session-a" as SessionId;
		const token = bridge.registerSession(sessionId, ALL_TOOLS);

		const hello = await sendLine(
			socketPath,
			JSON.stringify({ authToken: token, sessionId, hello: { pid: 321 } }),
		);
		expect(zBridgeResponse.parse(JSON.parse(hello))).toEqual({
			ok: true,
			text: "",
			isError: false,
		});
		expect(
			records.some(
				(record) =>
					record.message === "An app tools MCP helper said hello" && record.data?.pid === 321,
			),
		).toBe(true);
	});

	test("SIDE-13 unregistering a chat invalidates its token", async () => {
		const { bridge, socketPath } = await makeBridge();
		const sessionId = "session-a" as SessionId;
		const token = bridge.registerSession(sessionId, ALL_TOOLS);
		bridge.unregisterSession(sessionId, token);

		const answer = await call(socketPath, {
			authToken: token,
			sessionId,
			toolName: "GetWorkspaceDiff",
			args: {},
		});

		expect(zBridgeResponse.parse(answer)).toEqual({ ok: false, error: "Unauthorized" });
	});

	test("SIDE-13 a late release of an older token leaves the chat's newer token valid", async () => {
		const { bridge, socketPath } = await makeBridge();
		const sessionId = "session-a" as SessionId;
		const older = bridge.registerSession(sessionId, ALL_TOOLS);
		const newer = bridge.registerSession(sessionId, ALL_TOOLS);
		bridge.unregisterSession(sessionId, older);

		const answer = await call(socketPath, {
			authToken: newer,
			sessionId,
			toolName: "GetWorkspaceDiff",
			args: {},
		});

		expect(zBridgeResponse.parse(answer)).toMatchObject({ ok: true });
	});

	test("SIDE-13 the endpoint is null before start and after stop", async () => {
		const { bridge, socketPath } = await makeBridge();

		expect(bridge.currentEndpoint).toEqual({ socketPath });
		await bridge.stop();
		expect(bridge.currentEndpoint).toBeNull();
	});

	test("SIDE-13 each chat gets its own token, and registering again replaces it", async () => {
		const { bridge, socketPath } = await makeBridge();
		const sessionA = "session-a" as SessionId;
		const sessionB = "session-b" as SessionId;
		const first = bridge.registerSession(sessionA, ALL_TOOLS);
		const other = bridge.registerSession(sessionB, ALL_TOOLS);
		const second = bridge.registerSession(sessionA, ALL_TOOLS);

		expect(first).not.toBe(other);
		expect(second).not.toBe(first);
		const answer = await call(socketPath, {
			authToken: first,
			sessionId: sessionA,
			toolName: "GetWorkspaceDiff",
			args: {},
		});
		expect(zBridgeResponse.parse(answer)).toEqual({ ok: false, error: "Unauthorized" });
	});

	test("SIDE-13 the socket lives in a private cmcp folder and stop removes it", async () => {
		const { bridge, socketPath, folder } = await makeBridge();

		expect(path.basename(folder).startsWith("cmcp-")).toBe(true);
		expect(path.basename(socketPath)).toBe("s");
		expect((await stat(folder)).mode & 0o777).toBe(0o700);
		expect((await stat(socketPath)).mode & 0o777).toBe(0o600);

		await bridge.stop();
		await expect(stat(folder)).rejects.toThrow();
	});

	test("SIDE-13 an idle connection is closed after the timeout without a request", async () => {
		const { socketPath } = await makeBridge({ idleTimeoutMs: 20 });
		const socket = createConnection(socketPath);
		await new Promise<void>((resolve) => {
			let settled = false;
			const done = (): void => {
				if (settled) return;
				settled = true;
				resolve();
			};
			socket.once("close", done);
			socket.once("error", done);
		});
		expect(socket.destroyed).toBe(true);
	});

	test("SIDE-13 a request line over the limit is refused and the connection closes", async () => {
		const { socketPath } = await makeBridge();
		const socket = createConnection(socketPath);
		socket.setEncoding("utf8");
		const answer = new Promise<string>((resolve, reject) => {
			let received = "";
			socket.on("data", (chunk: string) => {
				received += chunk;
				const newline = received.indexOf("\n");
				if (newline !== -1) resolve(received.slice(0, newline));
			});
			socket.once("error", reject);
		});
		socket.write("x".repeat(BRIDGE_MAX_LINE_CHARS + 1));
		expect(JSON.parse(await answer)).toEqual({
			ok: false,
			error: "The bridge request was too long.",
		});
		socket.destroy();
	});

	test("SIDE-13 a call while the app is away gets the backend's error text", async () => {
		const { bridge, app, socketPath } = await makeBridge();
		app.connected = false;
		const sessionId = "session-a" as SessionId;
		const token = bridge.registerSession(sessionId, ALL_TOOLS);

		const answer = await call(socketPath, {
			authToken: token,
			sessionId,
			toolName: "GetWorkspaceDiff",
			args: {},
		});

		expect(zBridgeResponse.parse(answer)).toEqual({
			ok: true,
			text: "The app is not connected; try again in a moment.",
			isError: true,
		});
	});
});
