/**
 * @feature AGENT-13 Codex goals: set, pause, resume, clear
 * Owns: the integration test of the goal calls and goal notifications through `composeSidecar`,
 * the function the sidecar's composition root builds the host with.
 * Behaviour: modes/sidecar-mode.ts, rpc/handlers.ts, session/manager.ts,
 * runners/codex/codex-session.ts and runners/codex/goals.ts.
 * Test first: this file.
 * Our design choice: everything the composition root builds is real; only the outside world is
 * scripted through `SidecarPorts`: the Codex child process, the program lookup, the login-shell
 * capture and the file reads. The app is FakeApp and the outbox storage MemoryStorage, both from
 * test-support, so a wiring line removed from the root fails here.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionConfig, WorkspaceContext } from "@conducted/protocol";
import {
	appError,
	cryptoIds,
	err,
	type MessageId,
	ok,
	type SessionId,
	systemClock,
	type TurnId,
	type WorkspaceId,
} from "@conducted/shared";
import { createLogger } from "../../logging/logger.ts";
import { composeSidecar, type SidecarComposition } from "../../modes/sidecar-mode.ts";
import { FakeApp } from "../../test-support/fake-app.ts";
import { FakeChild, type JsonRpcMessage } from "../../test-support/fake-child.ts";
import { MemoryStorage } from "../../test-support/memory-storage.ts";
import type { JsonRpcChild } from "./app-server-client.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function workspaceFor(folder: string): WorkspaceContext {
	return {
		workspaceId: "workspace-1" as WorkspaceId,
		workspaceName: "goals",
		workspacePath: folder,
		repoRootPath: folder,
		targetBranch: "origin/main",
		placeholderBranch: false,
		port: 5124,
	};
}

const codexConfig: SessionConfig = {
	agent: "codex",
	model: "gpt-5",
	effort: "medium",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: false, progressUpdates: false, setTargetBranch: false },
};

async function waitFor(check: () => boolean, what: string): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}.`);
		await new Promise((resolve) => setTimeout(resolve, 1));
	}
}

const unwrap = <T>(value: unknown): T => {
	if (typeof value === "object" && value !== null && "ok" in value) {
		const result = value as { ok: boolean; value?: unknown; error?: { message?: string } };
		if (!result.ok) throw new Error(result.error?.message ?? "The handler failed.");
		return result.value as T;
	}
	return value as T;
};

/** A Codex app server that keeps one goal and answers the handshake, thread and goal calls. */
function scriptedCodex(): FakeChild {
	const child = new FakeChild();
	let goal: Record<string, unknown> | null = null;
	const answer = (message: JsonRpcMessage, result: unknown): void => {
		queueMicrotask(() => child.emit({ jsonrpc: "2.0", id: message.id, result }));
	};
	child.onWrite = (message) => {
		if (message.id === undefined) return;
		const params = (message.params ?? {}) as Record<string, unknown>;
		if (message.method === "initialize") answer(message, { serverVersion: "0.154.0" });
		else if (message.method === "model/list") answer(message, { data: [], nextCursor: null });
		else if (message.method === "thread/start") {
			answer(message, { thread: { id: "thread-1" }, model: "gpt-5" });
		} else if (message.method === "thread/goal/get") {
			answer(message, { goal });
		} else if (message.method === "thread/goal/set") {
			goal = {
				threadId: "thread-1",
				objective:
					typeof params.objective === "string" ? params.objective : (goal?.objective ?? "ship"),
				status: typeof params.status === "string" ? params.status : "active",
				tokenBudget: typeof params.tokenBudget === "number" ? params.tokenBudget : null,
				tokensUsed: 0,
				timeUsedSeconds: 0,
				createdAt: 1,
				updatedAt: 2,
			};
			answer(message, { goal });
			child.emit({
				jsonrpc: "2.0",
				method: "thread/goal/updated",
				params: { threadId: "thread-1", turnId: null, goal },
			});
		} else if (message.method === "thread/goal/clear") {
			goal = null;
			answer(message, { cleared: true });
			child.emit({
				jsonrpc: "2.0",
				method: "thread/goal/cleared",
				params: { threadId: "thread-1" },
			});
		} else answer(message, {});
	};
	return child;
}

async function harness(): Promise<{
	host: SidecarComposition;
	app: FakeApp;
	children: FakeChild[];
	sessionId: SessionId;
	workspace: WorkspaceContext;
}> {
	const folder = await mkdtemp(path.join(tmpdir(), "conducted-goals-"));
	cleanups.push(() => rm(folder, { recursive: true, force: true }));
	const app = new FakeApp();
	const children: FakeChild[] = [];
	const captured = {
		shell: "/bin/zsh",
		path: "/usr/bin",
		env: { PATH: "/usr/bin", HOME: path.join(folder, "home") },
		providerSecrets: {},
	};
	const host = composeSidecar(
		{
			binDir: folder,
			outboxRoot: path.join(folder, "outbox"),
			completionsDir: path.join(folder, "completions"),
			cursorStoreDir: path.join(folder, "cursor-sdk-store"),
			logDir: path.join(folder, "log"),
			appVersion: "0.0.0",
			logLevel: "info",
		},
		{
			app,
			query: () => {
				throw new Error("No Claude chat runs in this test.");
			},
			spawnCodex: async () => {
				const child = scriptedCodex();
				children.push(child);
				return ok(child satisfies JsonRpcChild);
			},
			spawnAcp: async () => err(appError("acp_unused", "No ACP chat runs in this test.")),
			loadCursorSdk: async () =>
				err(appError("cursor_sdk_missing", "Cursor's SDK is not installed.")),
			probe: async () => ok({ stdout: "1.0.0", stderr: "", exitCode: 0 }),
			findExecutable: async (name) => `/usr/bin/${name}`,
			shellEnv: { get: async () => ok(captured), refresh: async () => ok(captured) },
			runCheckpointer: async () => ({ exitCode: 1, stdout: "", stderr: "not a repository" }),
			outboxStorage: new MemoryStorage(),
			makeTempDir: (prefix) => mkdtemp(path.join(tmpdir(), prefix)),
			readText: async () => ok(null),
			sidecarExecutable: "/Applications/Conducted.app/Contents/MacOS/sidecar",
			hasTranscript: async () => false,
			newToken: () => randomBytes(32).toString("base64url"),
			clock: systemClock,
			ids: cryptoIds,
			logger: createLogger({
				sink: () => {},
				clock: systemClock,
				level: "error",
				scope: "test:goals-wiring",
			}),
		},
	);
	const started = await host.bridge.start();
	if (!started.ok) throw new Error(started.error.message);
	cleanups.push(async () => {
		await host.sessions.shutdown("app_quit");
		for (const sessionId of host.outbox.sessionsWithPending()) {
			await host.publisher.flush(sessionId);
		}
		await host.bridge.stop();
	});
	const sessionId = "session-1" as SessionId;
	const workspace = workspaceFor(folder);
	await host.handlers.requests.warmAgent({
		sessionId,
		config: codexConfig,
		workspace,
		launch: { env: {}, providerKeys: {} },
	});
	return { host, app, children, sessionId, workspace };
}

describe("AGENT-13 Codex goals through the sidecar composition root", () => {
	test("AGENT-13 set, read, pause, resume and clear reach the Codex thread", async () => {
		const { host, app, sessionId } = await harness();

		const set = unwrap<{ goal: { objective: string; tokenBudget?: number } }>(
			await host.handlers.requests.setGoal({
				sessionId,
				objective: "ship the importer",
				tokenBudget: 5_000,
			}),
		);
		expect(set.goal).toMatchObject({ objective: "ship the importer", tokenBudget: 5_000 });

		const got = unwrap<{ goal: { objective: string } | null }>(
			await host.handlers.requests.getGoal({ sessionId }),
		);
		expect(got.goal).toMatchObject({ objective: "ship the importer" });

		const paused = unwrap<{ goal: { status: string } | null }>(
			await host.handlers.requests.changeGoal({ sessionId, action: "pause" }),
		);
		expect(paused.goal?.status).toBe("paused");

		const resumed = unwrap<{ goal: { status: string } | null }>(
			await host.handlers.requests.changeGoal({ sessionId, action: "resume" }),
		);
		expect(resumed.goal?.status).toBe("active");

		const cleared = unwrap<{ goal: unknown }>(
			await host.handlers.requests.changeGoal({ sessionId, action: "clear" }),
		);
		expect(cleared.goal).toBeNull();

		const changes = app.notifications.filter((entry) => entry.method === "goalChanged");
		expect(changes.length).toBeGreaterThan(0);
		expect(changes.at(-1)?.params).toEqual({ sessionId, goal: null });
	});

	test("AGENT-13 a /goal message while Codex works changes the goal, not the steer", async () => {
		const { host, children, sessionId, workspace } = await harness();
		const launch = { env: {}, providerKeys: {} };
		const base = {
			sessionId,
			text: "hello",
			attachmentPaths: [],
			config: codexConfig,
			workspace,
			launch,
			firstMessage: false,
		};

		const first = unwrap<{ deliveredAs: string }>(
			await host.handlers.requests.sendMessage({
				...base,
				messageId: "message-1" as MessageId,
				turnId: "turn-1" as TurnId,
				delivery: "new_turn",
			}),
		);
		expect(first.deliveredAs).toBe("new_turn");

		const steered = unwrap<{ deliveredAs: string }>(
			await host.handlers.requests.sendMessage({
				...base,
				messageId: "message-2" as MessageId,
				turnId: "turn-2" as TurnId,
				text: "/goal ship the importer",
				delivery: "steer",
			}),
		);
		expect(steered.deliveredAs).toBe("steer");

		const child = children.at(-1);
		if (child === undefined) throw new Error("No Codex child process was started.");
		expect(child.lines.find((line) => line.method === "thread/goal/set")?.params).toEqual({
			threadId: "thread-1",
			objective: "ship the importer",
		});
		await host.handlers.requests.cancel({ sessionId });
	});

	test("AGENT-13 a /goal message to an idle Codex chat sets the goal and starts no turn", async () => {
		const { host, app, children, sessionId, workspace } = await harness();

		const sent = unwrap<{ deliveredAs: string }>(
			await host.handlers.requests.sendMessage({
				sessionId,
				messageId: "message-1" as MessageId,
				turnId: "turn-1" as TurnId,
				text: "/goal ship the importer",
				attachmentPaths: [],
				delivery: "new_turn",
				firstMessage: false,
				config: codexConfig,
				workspace,
				launch: { env: {}, providerKeys: {} },
			}),
		);

		expect(sent.deliveredAs).toBe("new_turn");
		const child = children.at(-1);
		if (child === undefined) throw new Error("No Codex child process was started.");
		expect(child.lines.find((line) => line.method === "thread/goal/set")?.params).toEqual({
			threadId: "thread-1",
			objective: "ship the importer",
		});
		expect(child.lines.some((line) => line.method === "turn/start")).toBe(false);
		expect(app.notifications.some((entry) => entry.method === "goalChanged")).toBe(true);

		// The chat stores the message as a turn that already ended, so it never shows as running.
		const events = () =>
			app
				.notified("sessionEvent")
				.filter((entry) => entry.sessionId === sessionId)
				.map((entry) => entry.event);
		await waitFor(
			() => events().some((event) => event.type === "turn_ended"),
			"the goal message's turn to end",
		);
		expect(
			events().map((event) =>
				event.type === "user_message"
					? { type: event.type, text: event.text, delivery: event.delivery }
					: event.type === "turn_ended"
						? { type: event.type, outcome: event.outcome }
						: { type: event.type },
			),
		).toEqual([
			{ type: "user_message", text: "/goal ship the importer", delivery: "new_turn" },
			{ type: "turn_ended", outcome: "success" },
		]);
	});

	test("AGENT-13 goal notifications from the server reach the app", async () => {
		const { host, app, children, sessionId } = await harness();
		await host.handlers.requests.getGoal({ sessionId });
		const child = children.at(-1);
		if (child === undefined) throw new Error("No Codex child process was started.");

		child.emit({
			jsonrpc: "2.0",
			method: "thread/goal/updated",
			params: {
				threadId: "thread-1",
				turnId: "turn-1",
				goal: {
					threadId: "thread-1",
					objective: "fix the flaky test",
					status: "usageLimited",
					tokenBudget: 1_000,
					tokensUsed: 1_000,
				},
			},
		});
		child.emit({
			jsonrpc: "2.0",
			method: "thread/goal/cleared",
			params: { threadId: "thread-1" },
		});

		expect(app.notifications.filter((entry) => entry.method === "goalChanged")).toEqual([
			{
				method: "goalChanged",
				params: {
					sessionId,
					goal: {
						objective: "fix the flaky test",
						status: "usage_limited",
						tokenBudget: 1_000,
						tokensUsed: 1_000,
					},
				},
			},
			{ method: "goalChanged", params: { sessionId, goal: null } },
		]);
	});
});
