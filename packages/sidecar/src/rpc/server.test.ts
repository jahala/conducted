import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { appToSidecarNotifications, appToSidecarRequests } from "@conducted/protocol";
import { ok, systemClock } from "@conducted/shared";
import { createLogger } from "../logging/logger.ts";
import { encodeLine, LineDecoder } from "./ndjson.ts";
import { RpcPeer } from "./peer.ts";
import { handshakeLine, SocketServer, socketPathFor } from "./server.ts";
import type { AppToSidecarHandlers, AppToSidecarNotificationHandlers } from "./types.ts";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function tempDir(): Promise<string> {
	const created = await mkdtemp(path.join(tmpdir(), "conducted-side02-"));
	cleanups.push(() => rm(created, { recursive: true, force: true }));
	return created;
}

function logger() {
	return createLogger({
		sink: () => {},
		clock: systemClock,
		level: "error",
		scope: "rpc-server-test",
	});
}

function requestHandlers(overrides: Partial<AppToSidecarHandlers> = {}): AppToSidecarHandlers {
	const table = {} as Record<string, (params: unknown) => Promise<unknown>>;
	for (const method of Object.keys(appToSidecarRequests)) {
		table[method] = async () => {
			throw new Error(`Unexpected request in this test: ${method}`);
		};
	}
	Object.assign(table, overrides);
	return table as AppToSidecarHandlers;
}

function notificationHandlers(): AppToSidecarNotificationHandlers {
	const table = {} as Record<string, (params: unknown) => void>;
	for (const method of Object.keys(appToSidecarNotifications)) table[method] = () => {};
	return table as AppToSidecarNotificationHandlers;
}

function makeServer(socketPath: string): SocketServer {
	const peer = new RpcPeer({
		handlers: requestHandlers({ listModels: async () => ok({ models: [] }) }),
		notificationHandlers: notificationHandlers(),
		logger: logger(),
	});
	const server = new SocketServer({ peer, logger: logger(), socketPath });
	cleanups.push(() => server.close());
	return server;
}

interface ConnectedClient {
	socket: Socket;
	next(): Promise<unknown>;
	close(): void;
}

function connect(socketPath: string): Promise<ConnectedClient> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		socket.setEncoding("utf8");
		const decoder = new LineDecoder();
		const lines: unknown[] = [];
		const waiters: {
			resolve: (value: unknown) => void;
			reject: (error: Error) => void;
		}[] = [];
		let closed: Error | null = null;
		const fail = (error: Error): void => {
			closed = error;
			for (const waiter of waiters.splice(0)) waiter.reject(error);
		};
		socket.on("data", (chunk: string) => {
			for (const decoded of decoder.push(chunk)) {
				if (!decoded.ok) continue;
				const waiter = waiters.shift();
				if (waiter) waiter.resolve(decoded.value);
				else lines.push(decoded.value);
			}
		});
		socket.on("error", fail);
		socket.on("close", () => fail(new Error("The connection closed")));
		socket.once("connect", () => {
			resolve({
				socket,
				next: () => {
					if (lines.length > 0) return Promise.resolve(lines.shift());
					if (closed !== null) return Promise.reject(closed);
					return new Promise((resolveNext, rejectNext) => {
						waiters.push({ resolve: resolveNext, reject: rejectNext });
					});
				},
				close: () => socket.destroy(),
			});
		});
		socket.once("error", reject);
	});
}

describe("SIDE-02 Unix socket server", () => {
	test("SIDE-02 listens on a temporary socket and answers a request", async () => {
		const dir = await tempDir();
		const socketPath = path.join(dir, "sidecar.sock");
		const server = makeServer(socketPath);
		await expect(server.listen()).resolves.toEqual({ ok: true, value: undefined });
		const client = await connect(socketPath);
		client.socket.write(
			encodeLine({
				jsonrpc: "2.0",
				id: 1,
				method: "listModels",
				params: { agent: "claude" },
			}),
		);
		await expect(client.next()).resolves.toEqual({
			jsonrpc: "2.0",
			id: 1,
			result: { models: [] },
		});
		client.close();
	});

	test("SIDE-02 a second connection closes the first and answers itself", async () => {
		const dir = await tempDir();
		const socketPath = path.join(dir, "sidecar.sock");
		const server = makeServer(socketPath);
		await server.listen();
		const first = await connect(socketPath);
		const firstClosed = new Promise<void>((resolve) => {
			first.socket.once("close", () => resolve());
		});
		const second = await connect(socketPath);
		await firstClosed;
		second.socket.write(
			encodeLine({
				jsonrpc: "2.0",
				id: 2,
				method: "listModels",
				params: { agent: "claude" },
			}),
		);
		await expect(second.next()).resolves.toEqual({
			jsonrpc: "2.0",
			id: 2,
			result: { models: [] },
		});
		second.close();
	});

	test("SIDE-02 a stale socket file is removed before listening", async () => {
		const dir = await tempDir();
		const socketPath = path.join(dir, "sidecar.sock");
		await writeFile(socketPath, "left over from a crashed run", "utf8");
		const server = makeServer(socketPath);
		await expect(server.listen()).resolves.toEqual({ ok: true, value: undefined });
		const client = await connect(socketPath);
		client.close();
	});

	test("SIDE-02 the socket file is owner-only", async () => {
		const dir = await tempDir();
		const socketPath = path.join(dir, "sidecar.sock");
		const server = makeServer(socketPath);
		await server.listen();
		const info = await stat(socketPath);
		expect(info.mode & 0o777).toBe(0o600);
	});

	test("SIDE-02 close stops accepting and removes the socket file", async () => {
		const dir = await tempDir();
		const socketPath = path.join(dir, "sidecar.sock");
		const server = makeServer(socketPath);
		await server.listen();
		await server.close();
		await expect(stat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	test("SIDE-02 a path that cannot be bound returns an error value", async () => {
		const dir = await tempDir();
		const notAFolder = path.join(dir, "file");
		await writeFile(notAFolder, "not a folder", "utf8");
		const server = makeServer(path.join(notAFolder, "sidecar.sock"));
		const result = await server.listen();
		expect(result.ok).toBe(false);
	});
});

describe("SIDE-02 socket path and handshake", () => {
	test("SIDE-02 the socket path names the process id inside the temp folder", () => {
		expect(socketPathFor("/tmp/", 42)).toBe("/tmp/conducted-sidecar-42.sock");
	});

	test("SIDE-02 the handshake line tells the launcher where to connect", () => {
		expect(handshakeLine("/tmp/conducted-sidecar-42.sock")).toBe(
			"SOCKET_PATH=/tmp/conducted-sidecar-42.sock",
		);
	});
});
