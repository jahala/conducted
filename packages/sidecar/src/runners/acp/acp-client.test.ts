/**
 * @feature AGENT-11 ACP client and runner: the wire client
 * Owns: tests for the stdio client: initialize capabilities, resume order, the session calls,
 * agent-to-client requests, file access limits and read cutting, and the error messages.
 * Test first: an in-memory agent that advertises session/resume receives session/resume, not
 * session/load, for a resume id.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AGENT_METHODS,
	type AgentConnection,
	CLIENT_METHODS,
	type CreateElicitationRequest,
	agent as createAgentApp,
	type InitializeRequest,
	type NewSessionRequest,
	ndJsonStream,
	type ReadTextFileRequest,
	type RequestPermissionRequest,
	type ResumeSessionRequest,
	type WriteTextFileRequest,
} from "@agentclientprotocol/sdk";
import { appError, err, ok } from "@conducted/shared";
import { createLogger } from "../../logging/logger.ts";
import {
	ACP_FILE_READ_LIMIT_BYTES,
	type AcpChild,
	type AcpClient,
	describeAcpFailure,
	StdioAcpClient,
} from "./acp-client.ts";
import type { AcpAdapter } from "./adapters/adapter.ts";

const adapter: AcpAdapter = {
	id: "opencode",
	displayName: "OpenCode",
	command: { executable: "opencode", args: ["acp"] },
	versionArgs: ["--version"],
	minimumVersion: "1.16.2",
	toolNameHints: {},
	waitForModelCatalogMs: 0,
	permissionEnv: () => ({}),
};

interface Bridge {
	child: AcpChild;
	connection: AgentConnection;
	stopped: () => boolean;
}

interface AgentOptions {
	loadSession?: boolean;
	resume?: boolean;
	close?: boolean;
	onInitialize?(params: InitializeRequest): void;
	onNew?(params: NewSessionRequest): void;
	onResume?(params: ResumeSessionRequest): void;
	onLoad?(): void;
	onPrompt?(): { stopReason: "end_turn" | "cancelled" };
	onSetConfig?(): void;
	onSetMode?(): void;
	onClose?(): void;
	onCancel?(): void;
}

function makeBridge(options: AgentOptions = {}): Bridge {
	const toAgent = new TransformStream<Uint8Array, Uint8Array>();
	const toChild = new TransformStream<Uint8Array, Uint8Array>();
	let stopped = false;
	const app = createAgentApp({ name: "fake-agent" })
		.onRequest(AGENT_METHODS.initialize, ({ params }) => {
			options.onInitialize?.(params);
			return {
				protocolVersion: 1,
				agentCapabilities: {
					loadSession: options.loadSession ?? true,
					sessionCapabilities: {
						resume: (options.resume ?? true) ? {} : null,
						close: (options.close ?? true) ? {} : null,
					},
				},
				agentInfo: { name: "fake", version: "1.2.3" },
				authMethods: [{ id: "login", name: "Log in" }],
			};
		})
		.onRequest(AGENT_METHODS.session_new, ({ params }) => {
			options.onNew?.(params);
			return {
				sessionId: "new-session",
				configOptions: [
					{
						type: "select",
						id: "model",
						name: "Model",
						category: "model",
						currentValue: "one",
						options: [
							{ value: "one", name: "One" },
							{ value: "two", name: "Two" },
						],
					},
				],
			};
		})
		.onRequest(AGENT_METHODS.session_resume, ({ params }) => {
			options.onResume?.(params);
			return { configOptions: [] };
		})
		.onRequest(AGENT_METHODS.session_load, () => {
			options.onLoad?.();
			return { configOptions: [] };
		})
		.onRequest(
			AGENT_METHODS.session_prompt,
			() => options.onPrompt?.() ?? { stopReason: "end_turn" },
		)
		.onRequest(AGENT_METHODS.session_set_config_option, () => {
			options.onSetConfig?.();
			return { configOptions: [] };
		})
		.onRequest(AGENT_METHODS.session_set_mode, () => {
			options.onSetMode?.();
			return {};
		})
		.onRequest(AGENT_METHODS.session_close, () => {
			options.onClose?.();
			return {};
		})
		.onNotification(AGENT_METHODS.session_cancel, () => options.onCancel?.());
	const connection = app.connect(ndJsonStream(toChild.writable, toAgent.readable));
	const child: AcpChild = {
		stdin: toAgent.writable,
		stdout: toChild.readable,
		onStderr: () => {},
		onExit: () => {},
		stop: async () => {
			stopped = true;
		},
	};
	return { child, connection, stopped: () => stopped };
}

function makeClient(
	bridge: Bridge,
	options: {
		cwd: string;
		beforeWrite?: () => Promise<void>;
		requestPermission?: (request: RequestPermissionRequest) => Promise<{
			outcome: { outcome: "cancelled" };
		}>;
	} = { cwd: tmpdir() },
): AcpClient {
	return new StdioAcpClient({
		spawn: async () => ok(bridge.child),
		adapter,
		executablePath: "/fake/opencode",
		cwd: options.cwd,
		env: {},
		logger: createLogger({
			sink: () => {},
			clock: { now: () => 0 },
			level: "error",
			scope: "test:acp-client",
		}),
		handlers: {
			onSessionUpdate: () => {},
			requestPermission:
				options.requestPermission ?? (async () => ({ outcome: { outcome: "cancelled" as const } })),
			requestElicitation: async (_request: CreateElicitationRequest) => ({ action: "decline" }),
			...(options.beforeWrite === undefined ? {} : { beforeWrite: options.beforeWrite }),
		},
	});
}

const workspace = await mkdtemp(join(tmpdir(), "conducted-acp-client-"));

async function requestFromAgent<T>(
	connection: AgentConnection,
	method: string,
	params: unknown,
): Promise<T> {
	// The agent-side context calls the client with the same method names the protocol uses.
	return connection.client.request(method, params) as Promise<T>;
}

describe("AGENT-11 ACP client", () => {
	test("a resume id prefers session/resume and never calls session/load", async () => {
		let resumed = false;
		let loaded = false;
		const bridge = makeBridge({
			onResume: () => {
				resumed = true;
			},
			onLoad: () => {
				loaded = true;
			},
		});
		const client = makeClient(bridge, { cwd: workspace });

		const opened = await client.openSession({
			cwd: workspace,
			additionalDirectories: [],
			resumeSessionId: "old-session",
			mcpServers: [],
		});

		expect(opened.ok).toBe(true);
		if (!opened.ok) return;
		expect(opened.value.how).toBe("resumed");
		expect(opened.value.acpSessionId).toBe("old-session");
		expect(resumed).toBe(true);
		expect(loaded).toBe(false);
		await client.close();
	});

	test("initialize declares file access, form elicitation, boolean options and our name", async () => {
		let seen: InitializeRequest | undefined;
		const bridge = makeBridge({ onInitialize: (params) => (seen = params) });
		const client = makeClient(bridge, { cwd: workspace });

		const connected = await client.connect();

		expect(connected.ok).toBe(true);
		expect(seen?.protocolVersion).toBe(1);
		expect(seen?.clientInfo?.name).toBe("conducted");
		expect(seen?.clientCapabilities?.fs?.readTextFile).toBe(true);
		expect(seen?.clientCapabilities?.fs?.writeTextFile).toBe(true);
		expect(seen?.clientCapabilities?.elicitation?.form).toBeDefined();
		expect(seen?.clientCapabilities?.session?.configOptions?.boolean).toBeDefined();
		await client.close();
	});

	test("new, prompt, config, mode, cancel and close reach the agent", async () => {
		const calls: string[] = [];
		const bridge = makeBridge({
			onNew: () => calls.push("new"),
			onPrompt: () => {
				calls.push("prompt");
				return { stopReason: "end_turn" };
			},
			onSetConfig: () => calls.push("config"),
			onSetMode: () => calls.push("mode"),
			onCancel: () => calls.push("cancel"),
			onClose: () => calls.push("close"),
		});
		const client = makeClient(bridge, { cwd: workspace });

		const opened = await client.openSession({
			cwd: workspace,
			additionalDirectories: [],
			mcpServers: [],
		});
		expect(opened.ok).toBe(true);
		if (!opened.ok) return;
		const id = opened.value.acpSessionId;
		expect((await client.prompt(id, [{ type: "text", text: "hello" }])).ok).toBe(true);
		expect((await client.setConfigOption(id, "model", "two")).ok).toBe(true);
		expect((await client.setMode(id, "plan")).ok).toBe(true);
		client.cancel(id);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await client.close();

		expect(calls).toContain("new");
		expect(calls).toContain("prompt");
		expect(calls).toContain("config");
		expect(calls).toContain("mode");
		expect(calls).toContain("cancel");
		expect(calls).toContain("close");
		expect(bridge.stopped()).toBe(true);
	});

	test("a long file read is cut at 256 KiB with the file's size in the note", async () => {
		const bridge = makeBridge();
		const client = makeClient(bridge, { cwd: workspace });
		const connected = await client.connect();
		expect(connected.ok).toBe(true);
		const opened = await client.openSession({
			cwd: workspace,
			additionalDirectories: [],
			mcpServers: [],
		});
		expect(opened.ok).toBe(true);
		const path = join(workspace, "large.txt");
		const text = "x".repeat(ACP_FILE_READ_LIMIT_BYTES + 1000);
		await writeFile(path, text);

		const read = await requestFromAgent<{ content: string }>(
			bridge.connection,
			CLIENT_METHODS.fs_read_text_file,
			{ sessionId: "new-session", path } satisfies ReadTextFileRequest,
		);

		expect(read.content.length).toBeGreaterThan(ACP_FILE_READ_LIMIT_BYTES);
		expect(read.content).toContain("the file is 263144 bytes");
		expect(read.content).toContain("showing the first 262144 bytes");
		await client.close();
	});

	test("a line and a limit pick a slice", async () => {
		const bridge = makeBridge();
		const client = makeClient(bridge, { cwd: workspace });
		await client.connect();
		await client.openSession({ cwd: workspace, additionalDirectories: [], mcpServers: [] });
		const path = join(workspace, "lines.txt");
		await writeFile(path, "one\ntwo\nthree\nfour");

		const read = await requestFromAgent<{ content: string }>(
			bridge.connection,
			CLIENT_METHODS.fs_read_text_file,
			{ sessionId: "new-session", path, line: 2, limit: 2 } satisfies ReadTextFileRequest,
		);

		expect(read.content).toBe("two\nthree");
		await client.close();
	});

	test("a read or write outside the workspace and its extra folders is refused", async () => {
		const bridge = makeBridge();
		const client = makeClient(bridge, { cwd: workspace });
		await client.connect();
		await client.openSession({ cwd: workspace, additionalDirectories: [], mcpServers: [] });

		await expect(
			requestFromAgent(bridge.connection, CLIENT_METHODS.fs_read_text_file, {
				sessionId: "new-session",
				path: "/etc/hosts",
			} satisfies ReadTextFileRequest),
		).rejects.toThrow();
		await client.close();
	});

	test("a write waits for beforeWrite and lands in an extra folder", async () => {
		const extra = join(workspace, "extra");
		let wroteAfterCheckpoint = false;
		const bridge = makeBridge();
		const client = makeClient(bridge, {
			cwd: workspace,
			beforeWrite: async () => {
				await writeFile(join(workspace, "checkpoint.txt"), "made");
				wroteAfterCheckpoint = true;
			},
		});
		await client.connect();
		await client.openSession({
			cwd: workspace,
			additionalDirectories: [extra],
			mcpServers: [],
		});
		const path = join(extra, "nested", "file.txt");

		await requestFromAgent(bridge.connection, CLIENT_METHODS.fs_write_text_file, {
			sessionId: "new-session",
			path,
			content: "hello",
		} satisfies WriteTextFileRequest);

		expect(wroteAfterCheckpoint).toBe(true);
		expect(await readFile(path, "utf8")).toBe("hello");
		await client.close();
	});

	test("a missing program says the agent could not start and how to repair it", async () => {
		const client = new StdioAcpClient({
			spawn: async () => err(appError("spawn_failed", "ENOENT")),
			adapter,
			executablePath: "/missing/opencode",
			cwd: workspace,
			env: {},
			logger: createLogger({
				sink: () => {},
				clock: { now: () => 0 },
				level: "error",
				scope: "test:acp-client",
			}),
			handlers: {
				onSessionUpdate: () => {},
				requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
				requestElicitation: async () => ({ action: "decline" }),
			},
		});

		const connected = await client.connect();

		expect(connected.ok).toBe(false);
		if (connected.ok) return;
		expect(connected.error.message).toContain("OpenCode agent could not start");
		expect(connected.error.message).toContain("Install it");
	});

	test("failures become plain messages for sign-in, credits, rate limits and internal errors", () => {
		const context = { adapter, authMethods: ["Sign in with a key"] };
		expect(describeAcpFailure({ code: -32000, message: "auth" }, context)).toMatchObject({
			code: "acp_auth_required",
			retryable: false,
		});
		expect(describeAcpFailure({ code: -32000, message: "auth" }, context).message).toContain(
			"Sign in with a key",
		);
		expect(describeAcpFailure(new Error("You are out of credits"), context)).toMatchObject({
			code: "acp_credits",
			retryable: false,
		});
		expect(describeAcpFailure(new Error("429 Too Many Requests"), context)).toMatchObject({
			code: "acp_rate_limit",
			retryable: true,
		});
		expect(
			describeAcpFailure(new Error("Internal error"), {
				...context,
				lastOutput: "the provider said no",
			}).message,
		).toBe("the provider said no");
	});
});
