/**
 * @feature AGENT-09 Cursor: SDK in process
 * Owns: the scripted Cursor SDK and translator the Cursor runner and session tests use.
 * Behaviour: runners/cursor/cursor-sdk.ts and the real runner path. The SDK is not installed in
 * this scaffold (D010), so these doubles stand in for the package the narrow interface describes;
 * the session tests drive the real CursorSession on them.
 * Contract test: packages/sidecar/src/runners/cursor/cursor-session.test.ts
 * Must handle: a run that streams messages and then waits, a run that is cancelled, a steer that
 * is delivered or handed back, and a run without steer.
 * Test first: cursor-session.test.ts, "a run that streams one text message emits it and resolves
 * success".
 */
import type { AgentMessage } from "@conducted/protocol";
import type {
	CursorAgent,
	CursorAgentOptions,
	CursorRun,
	CursorSdk,
	CursorSdkMessage,
} from "../runners/cursor/cursor-sdk.ts";
import { createDeferred } from "../util/deferred.ts";

export class FakeCursorRun implements CursorRun {
	messages: CursorSdkMessage[] = [];
	lateMessages: CursorSdkMessage[] = [];
	steerCalls: string[] = [];
	steerOutcome = "complete_delivered";
	cancelCalls = 0;
	waitCalls = 0;
	steer?: (text: string) => Promise<string>;

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
		}
		await this.finished.promise;
		for (const message of this.lateMessages) yield message;
	}

	async wait(): Promise<void> {
		this.waitCalls += 1;
	}

	async cancel(): Promise<void> {
		this.cancelCalls += 1;
		this.cancelled = true;
		this.finished.resolve();
	}
}

export class FakeCursorAgent implements CursorAgent {
	readonly sent: string[] = [];

	constructor(readonly run: FakeCursorRun = new FakeCursorRun()) {}

	async send(text: string): Promise<CursorRun> {
		this.sent.push(text);
		return this.run;
	}
}

export class FakeCursorSdk implements CursorSdk {
	readonly resumeCalls: { agentId: string; options: CursorAgentOptions }[] = [];
	readonly createCalls: { agentId: string; options: CursorAgentOptions }[] = [];
	resumeError: Error | undefined;
	createError: Error | undefined;
	onResume: (() => void) | undefined;
	readonly agent: FakeCursorAgent;

	constructor(run: FakeCursorRun = new FakeCursorRun()) {
		this.agent = new FakeCursorAgent(run);
	}

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
