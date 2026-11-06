/**
 * @feature AGENT-09 Cursor: SDK in process
 * Owns: the scripted Cursor SDK and translator the Cursor runner and session tests use.
 * Behaviour: runners/cursor/cursor-sdk.ts and the real runner path. The SDK is not installed in
 * this scaffold (D010), so these doubles stand in for the package the narrow interface describes;
 * the session tests drive the real CursorSession on them.
 * Contract test: packages/sidecar/src/runners/cursor/cursor-session.test.ts
 * Must handle: a run that streams messages and then waits, a run that is cancelled, a run whose
 * wait fails, a steer that is delivered or handed back, a run without steer, a send that is still
 * pending, and an agent that hands out a new run for each turn.
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
	/** How many streamed messages the consumer has finished with and asked past. */
	consumed = 0;
	/** When set, wait() rejects with it, as a run that fails after streaming. */
	waitError: Error | undefined;
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
			this.consumed += 1;
		}
		await this.finished.promise;
		for (const message of this.lateMessages) yield message;
	}

	async wait(): Promise<void> {
		this.waitCalls += 1;
		if (this.waitError !== undefined) throw this.waitError;
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

	constructor(readonly run: FakeCursorRun = new FakeCursorRun()) {}

	async send(text: string): Promise<CursorRun> {
		this.sent.push(text);
		if (this.sendGate !== undefined) await this.sendGate;
		return this.nextRuns.shift() ?? this.run;
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
