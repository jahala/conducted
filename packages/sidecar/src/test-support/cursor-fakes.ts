/**
 * @feature AGENT-09 Cursor: SDK in process
 * Owns: the scripted Cursor SDK, its module, its installed files and the translator the Cursor
 * loader, runner and session tests use.
 * Behaviour: runners/cursor/cursor-sdk.ts, which describes @cursor/sdk 1.3.1. The SDK has a
 * proprietary licence and is never in this repository or its CI (D010), so no test runs the real
 * package; these doubles follow the shapes of its published type declarations: `wait()` resolves
 * with a status, `steer()` answers complete_delivered or revert_to_followup, a refused key throws
 * the SDK's AuthenticationError, and `module()` exports `createAgentPlatform` and
 * `AuthenticationError` as the package does. The real package was checked against the loader and
 * these shapes by hand on 2026-11-06 (docs/decisions.md D078).
 * Contract test: packages/sidecar/src/runners/cursor/cursor-session.test.ts and load-sdk.test.ts
 * Must handle: a run that streams messages and then waits, a run that is cancelled, a run whose
 * wait fails or ends in an error result, a steer that is delivered or handed back, a run without
 * steer, a send that is still pending, and an agent that hands out a new run for each turn.
 * Test first: cursor-session.test.ts, "a run that streams one text message emits it and resolves
 * success".
 */
import path from "node:path";
import type { AgentMessage } from "@conducted/protocol";
import { type AppError, ok, type Result } from "@conducted/shared";
import type {
	CursorAgent,
	CursorAgentOptions,
	CursorPlatform,
	CursorRun,
	CursorRunResult,
	CursorSdk,
	CursorSdkMessage,
	CursorSteerOutcome,
} from "../runners/cursor/cursor-sdk.ts";
import { createDeferred } from "../util/deferred.ts";

/** Stands in for the SDK's AuthenticationError class. */
export class FakeCursorAuthenticationError extends Error {
	readonly status = 401;
}

export class FakeCursorRun implements CursorRun {
	messages: CursorSdkMessage[] = [];
	lateMessages: CursorSdkMessage[] = [];
	steerCalls: string[] = [];
	steerOutcome: CursorSteerOutcome = "complete_delivered";
	cancelCalls = 0;
	waitCalls = 0;
	/** How many streamed messages the consumer has finished with and asked past. */
	consumed = 0;
	/** When set, wait() rejects with it. */
	waitError: Error | undefined;
	/** What wait() resolves with when it does not reject. */
	result: CursorRunResult = { status: "finished" };
	steer?: (text: string) => Promise<CursorSteerOutcome>;

	private readonly finished = createDeferred<void>();
	private cancelled = false;

	constructor(options: { steer?: boolean } = {}) {
		if (options.steer !== false) {
			this.steer = async (text) => {
				this.steerCalls.push(text);
				return this.steerOutcome;
			};
		}
	}

	finish(): void {
		this.finished.resolve();
	}

	async *stream(): AsyncIterable<CursorSdkMessage> {
		for (const message of this.messages) {
			if (this.cancelled) return;
			yield message;
			this.consumed += 1;
		}
		await this.finished.promise;
		for (const message of this.lateMessages) yield message;
	}

	async wait(): Promise<CursorRunResult> {
		this.waitCalls += 1;
		if (this.waitError !== undefined) throw this.waitError;
		return this.cancelled ? { status: "cancelled" } : this.result;
	}

	async cancel(): Promise<void> {
		this.cancelCalls += 1;
		this.cancelled = true;
		this.finished.resolve();
	}
}

export class FakeCursorAgent implements CursorAgent {
	readonly sent: string[] = [];
	/** Runs for the next sends, in order; once empty, every send gets `run`. */
	readonly nextRuns: FakeCursorRun[] = [];
	/** When set, a send records its text and then waits for this before it returns its run. */
	sendGate: Promise<void> | undefined;
	closeCalls = 0;

	constructor(readonly run: FakeCursorRun = new FakeCursorRun()) {}

	async send(text: string): Promise<CursorRun> {
		this.sent.push(text);
		if (this.sendGate !== undefined) await this.sendGate;
		return this.nextRuns.shift() ?? this.run;
	}

	close(): void {
		this.closeCalls += 1;
	}
}

export class FakeCursorPlatform implements CursorPlatform {
	readonly resumeCalls: { agentId: string; options: CursorAgentOptions }[] = [];
	readonly createCalls: { agentId: string; options: CursorAgentOptions }[] = [];
	resumeError: Error | undefined;
	createError: Error | undefined;
	onResume: (() => void) | undefined;

	constructor(readonly agent: FakeCursorAgent) {}

	async resumeAgent(agentId: string, options: CursorAgentOptions): Promise<CursorAgent> {
		this.resumeCalls.push({ agentId, options });
		this.onResume?.();
		if (this.resumeError !== undefined) throw this.resumeError;
		return this.agent;
	}

	async createAgent(options: CursorAgentOptions & { agentId: string }): Promise<CursorAgent> {
		this.createCalls.push({ agentId: options.agentId, options });
		if (this.createError !== undefined) throw this.createError;
		return this.agent;
	}
}

/** The SDK behind the narrow interface: one platform for every store folder, one agent in it. */
export class FakeCursorSdk implements CursorSdk {
	readonly version = "1.3.1";
	env: Readonly<Record<string, string>> = { CURSOR_RIPGREP_PATH: "/sdk/native/bin/rg" };
	readonly platformCalls: { stateRoot: string; workspaceRef: string }[] = [];
	readonly platform: FakeCursorPlatform;
	/** When set, createPlatform rejects with it. */
	platformError: Error | undefined;
	/** Runs inside createPlatform, before it answers. */
	onPlatform: (() => void) | undefined;

	constructor(run: FakeCursorRun = new FakeCursorRun()) {
		this.platform = new FakeCursorPlatform(new FakeCursorAgent(run));
	}

	get agent(): FakeCursorAgent {
		return this.platform.agent;
	}
	get resumeCalls(): FakeCursorPlatform["resumeCalls"] {
		return this.platform.resumeCalls;
	}
	get createCalls(): FakeCursorPlatform["createCalls"] {
		return this.platform.createCalls;
	}
	set resumeError(error: Error | undefined) {
		this.platform.resumeError = error;
	}
	set createError(error: Error | undefined) {
		this.platform.createError = error;
	}
	set onResume(listener: (() => void) | undefined) {
		this.platform.onResume = listener;
	}

	async createPlatform(options: {
		stateRoot: string;
		workspaceRef: string;
	}): Promise<CursorPlatform> {
		this.platformCalls.push({ ...options });
		this.onPlatform?.();
		if (this.platformError !== undefined) throw this.platformError;
		return this.platform;
	}

	isAuthenticationError(error: unknown): boolean {
		return error instanceof FakeCursorAuthenticationError;
	}

	/** The module as the package exports it, for the loader. */
	module(): Record<string, unknown> {
		return {
			createAgentPlatform: (options: { stateRoot: string; workspaceRef: string }) =>
				this.createPlatform(options),
			AuthenticationError: FakeCursorAuthenticationError,
		};
	}
}

/**
 * The two package.json files of an installed SDK tree under `agentBinariesDir`, the way
 * binaries.rs leaves them, served by a `readText` port. Every other path does not exist.
 */
export function cursorSdkFiles(
	agentBinariesDir: string,
	cpu = "arm64",
): { readText(target: string): Promise<Result<string | null, AppError>> } {
	const modules = path.join(agentBinariesDir, "cursor", "current", "node_modules");
	const files = new Map<string, string>([
		[
			path.join(modules, "@cursor", "sdk", "package.json"),
			JSON.stringify({
				name: "@cursor/sdk",
				version: "1.3.1",
				exports: { ".": { bun: "./dist/bundled/index.js", import: "./dist/esm/index.js" } },
			}),
		],
		[
			path.join(modules, "@cursor", `sdk-darwin-${cpu}`, "package.json"),
			JSON.stringify({ name: `@cursor/sdk-darwin-${cpu}`, version: "1.3.1" }),
		],
	]);
	return { readText: async (target) => ok(files.get(target) ?? null) };
}

export class FakeCursorTranslator {
	readonly pushed: CursorSdkMessage[] = [];

	push(message: CursorSdkMessage): AgentMessage[] {
		this.pushed.push(message);
		const text = typeof message.text === "string" ? message.text : "";
		return text === "" ? [] : [{ agent: "cursor", items: [{ kind: "text", text }] }];
	}

	flush(): AgentMessage[] {
		return [];
	}
}
