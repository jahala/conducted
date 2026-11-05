/**
 * @feature AGENT-06 Codex: `codex app-server` JSON-RPC
 * Owns: tests for the initialize handshake, typed requests, server request handlers and the
 * connection lifecycle of app-server-client.ts.
 * Test first: connect() sends initialize and then the initialized notification, in that order.
 */
import { describe, expect, test } from "bun:test";
import { type AppError, ok, type Result } from "@conducted/shared";
import { createLogger } from "../../logging/logger.ts";
import { FakeChild } from "../../test-support/fake-child.ts";
import {
	CODEX_CHEAP_CALL_TIMEOUT_MS,
	type JsonRpcChild,
	JsonRpcCodexClient,
	type SpawnJsonRpcChild,
} from "./app-server-client.ts";
import { CODEX_CLIENT_METHODS, CODEX_INITIALIZED_NOTIFICATION } from "./protocol.ts";

function logger() {
	return createLogger({
		sink: () => {},
		clock: { now: () => 0 },
		level: "error",
		scope: "test:codex",
	});
}

function makeClient(child: FakeChild, spawnOverride?: SpawnJsonRpcChild) {
	const spawn: SpawnJsonRpcChild =
		spawnOverride ?? (async () => ok(child) as Result<JsonRpcChild, AppError>);
	return new JsonRpcCodexClient({
		spawn,
		codexPath: "/fake/codex",
		cwd: "/workspace",
		env: {},
		extraArgs: [],
		clientName: "conducted",
		clientVersion: "0.1.0",
		logger: logger(),
	});
}

function answerInitialize(child: FakeChild): void {
	child.onWrite = (message) => {
		if (message.method === CODEX_CLIENT_METHODS.initialize && message.id !== undefined) {
			queueMicrotask(() => {
				child.emit({ jsonrpc: "2.0", id: message.id, result: { serverVersion: "0.154.0" } });
			});
		}
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	while (!predicate()) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("AGENT-06 Codex app-server client", () => {
	test("connect sends initialize and then the initialized notification", async () => {
		const child = new FakeChild();
		answerInitialize(child);
		const client = makeClient(child);

		const result = await client.connect();

		expect(result.ok).toBe(true);
		expect(result.ok && result.value.serverVersion).toBe("0.154.0");
		expect(child.lines).toHaveLength(2);
		expect(child.lines[0]?.method).toBe(CODEX_CLIENT_METHODS.initialize);
		expect(child.lines[1]?.method).toBe(CODEX_INITIALIZED_NOTIFICATION);
		const params = child.lines[0]?.params as {
			clientInfo: { name: string; version: string };
			capabilities: { experimentalApi: boolean };
		};
		expect(params.clientInfo).toEqual({ name: "conducted", version: "0.1.0" });
		expect(params.capabilities.experimentalApi).toBe(true);
	});

	test("a typed request resolves with the server's result", async () => {
		const child = new FakeChild();
		answerInitialize(child);
		child.onWrite = (message) => {
			if (message.method === CODEX_CLIENT_METHODS.initialize && message.id !== undefined) {
				queueMicrotask(() => {
					child.emit({ jsonrpc: "2.0", id: message.id, result: { serverVersion: "0.154.0" } });
				});
			}
			if (message.method === CODEX_CLIENT_METHODS.modelList && message.id !== undefined) {
				queueMicrotask(() => {
					child.emit({
						jsonrpc: "2.0",
						id: message.id,
						result: { data: [], nextCursor: null },
					});
				});
			}
		};
		const client = makeClient(child);
		expect((await client.connect()).ok).toBe(true);

		const listed = await client.request<{ data: unknown[]; nextCursor: string | null }>(
			CODEX_CLIENT_METHODS.modelList,
			{},
			{ timeoutMs: CODEX_CHEAP_CALL_TIMEOUT_MS },
		);

		expect(listed.ok && listed.value.nextCursor).toBeNull();
	});

	test("a registered server request handler answers, and an unknown request is refused", async () => {
		const child = new FakeChild();
		answerInitialize(child);
		const client = makeClient(child);
		expect((await client.connect()).ok).toBe(true);

		client.onServerRequest("item/commandExecution/requestApproval", async () => ({
			decision: "accept",
		}));
		let answered = false;
		child.onWrite = (message) => {
			if (message.id === 77) answered = true;
		};
		child.emit({
			jsonrpc: "2.0",
			id: 77,
			method: "item/commandExecution/requestApproval",
			params: {},
		});
		await waitFor(() => answered);
		const answer = child.lines.find((message) => message.id === 77);
		expect(answer?.result).toEqual({ decision: "accept" });

		let refused = false;
		child.onWrite = (message) => {
			if (message.id === 78) refused = true;
		};
		child.emit({ jsonrpc: "2.0", id: 78, method: "item/unknown/request", params: {} });
		await waitFor(() => refused);
		const refusal = child.lines.find((message) => message.id === 78);
		expect(refusal?.error?.code).toBe(-32601);
	});

	test("noise on stdout is skipped and an early exit fails pending work", async () => {
		const child = new FakeChild();
		answerInitialize(child);
		const client = makeClient(child);
		expect((await client.connect()).ok).toBe(true);

		child.emitRaw("not json at all");
		let closed: string | null = null;
		client.onClose((reason) => {
			closed = reason;
		});

		const pending = client.request("turn/start", {});
		child.emitStderr("the server fell over");
		child.exit(1, null);

		const result = await pending;
		expect(result.ok).toBe(false);
		expect(String(closed)).toContain("the server fell over");
	});

	test("a failed spawn fails connect and reports the close", async () => {
		const spawn: SpawnJsonRpcChild = async () => ({
			ok: false,
			error: { code: "spawn_failed", message: "no codex here" },
		});
		const client = makeClient(new FakeChild(), spawn);
		const reasons: string[] = [];
		client.onClose((value) => {
			reasons.push(value);
		});

		const result = await client.connect();

		expect(result.ok).toBe(false);
		expect(reasons).toEqual(["no codex here"]);
	});
});
