// @vitest-environment node
/**
 * @feature RC-02 Per-chat Remote Control switch and connection status
 * Reaches the chat's Remote Control through the real composition root: the sidecar's
 * remoteControlState notification shows the link, turning the switch on stores it, tells the
 * sidecar and starts the chat's agent so the link comes up, and the app can ask for the status.
 * Test first: a remoteControlState line from the sidecar puts the link in the sessions store.
 */
import type { SessionConfig } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import { createTestContainer, seedWorkspace, type TestContainer } from "../../test/container.ts";

const CONFIG: SessionConfig = {
	agent: "claude",
	model: "default",
	effort: "high",
	fastMode: false,
	planMode: false,
	requireToolApproval: false,
	additionalDirectories: [],
	appTools: { diffComments: true, progressUpdates: true, setTargetBranch: true },
};

const SESSION_URL = "https://claude.ai/code/session_1";

const must = <T>(result: { ok: true; value: T } | { ok: false; error: unknown }): T => {
	if (!result.ok) throw new Error(JSON.stringify(result.error));
	return result.value;
};

interface Sent {
	id: number;
	method: string;
	params: { sessionId?: string; config?: SessionConfig };
}

/** Answers the sidecar requests the switch makes, and records every request in order. */
function scriptSidecar(test: TestContainer, statusAnswer: () => unknown): Sent[] {
	const sent: Sent[] = [];
	const transport = test.memory.platform.sidecar;
	const originalSend = transport.send.bind(transport);
	const answers: Record<string, () => unknown> = {
		updateConfig: () => ({ applied: "on_next_turn" }),
		warmAgent: () => ({}),
		getSessionStatus: statusAnswer,
	};
	transport.send = async (line) => {
		const answered = await originalSend(line);
		const parsed = JSON.parse(line) as Sent;
		const answer = answers[parsed.method];
		if (answer !== undefined && parsed.id !== undefined) {
			sent.push(parsed);
			queueMicrotask(() =>
				test.memory.controls.emitSidecarLine(
					JSON.stringify({ jsonrpc: "2.0", id: parsed.id, result: answer() }),
				),
			);
		}
		return answered;
	};
	return sent;
}

async function chat(test: TestContainer): Promise<SessionId> {
	const workspace = await seedWorkspace(test.container);
	return must(await test.container.services.sessions.create(workspace.id, CONFIG)).id;
}

describe("RC-02 Remote Control through the composition root", () => {
	it("shows the link the sidecar reports for a chat", async () => {
		const test = createTestContainer();
		try {
			scriptSidecar(test, () => ({ known: false }));
			must(await test.container.sidecar.start());
			const sessionId = await chat(test);

			test.memory.controls.emitSidecarLine(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "remoteControlState",
					params: { sessionId, status: { state: "connected", sessionUrl: SESSION_URL } },
				}),
			);

			const store = test.container.services.sessions.store;
			await vi.waitFor(() =>
				expect(store.getState().remoteControl?.[sessionId]).toEqual({
					state: "connected",
					sessionUrl: SESSION_URL,
				}),
			);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("turning the switch on stores it, tells the sidecar, then starts the agent", async () => {
		const test = createTestContainer();
		try {
			const sent = scriptSidecar(test, () => ({ known: false }));
			must(await test.container.sidecar.start());
			must(await test.container.services.settings.start());
			const sessionId = await chat(test);

			must(
				await test.container.actions.sessions.updateConfig(sessionId, {
					...CONFIG,
					remoteControl: true,
				}),
			);

			expect(sent.map((entry) => entry.method)).toEqual(["updateConfig", "warmAgent"]);
			expect(sent[1]?.params.config?.remoteControl).toBe(true);
			const stored = test.container.services.sessions.store.getState().sessions[sessionId];
			expect(stored?.config.remoteControl).toBe(true);

			// Turning it off tells the sidecar and starts nothing.
			must(
				await test.container.actions.sessions.updateConfig(sessionId, {
					...CONFIG,
					remoteControl: false,
				}),
			);
			expect(sent.map((entry) => entry.method)).toEqual([
				"updateConfig",
				"warmAgent",
				"updateConfig",
			]);
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("asks the sidecar for a chat's status, and a chat it does not know is off", async () => {
		const test = createTestContainer();
		try {
			let known = true;
			scriptSidecar(test, () =>
				known
					? { known: true, remoteControl: { state: "ready", sessionUrl: SESSION_URL } }
					: { known: false },
			);
			must(await test.container.sidecar.start());
			const sessionId = await chat(test);
			const sessions = test.container.services.sessions;

			must(await sessions.refreshRemoteControl(sessionId));
			expect(sessions.store.getState().remoteControl?.[sessionId]).toEqual({
				state: "ready",
				sessionUrl: SESSION_URL,
			});

			known = false;
			must(await sessions.refreshRemoteControl(sessionId));
			expect(sessions.store.getState().remoteControl?.[sessionId]).toEqual({ state: "off" });
		} finally {
			await test.container.stop();
			test.close();
		}
	});

	it("drops a status answer that a newer notification overtook", async () => {
		const test = createTestContainer();
		try {
			let notify: () => void = () => {};
			const sessionId = await chat(test);
			scriptSidecar(test, () => {
				notify();
				return { known: true, remoteControl: { state: "connecting" } };
			});
			notify = () =>
				test.container.services.sessions.applyRemoteControlState(sessionId, {
					state: "connected",
					sessionUrl: SESSION_URL,
				});
			must(await test.container.sidecar.start());

			must(await test.container.services.sessions.refreshRemoteControl(sessionId));
			expect(test.container.services.sessions.store.getState().remoteControl?.[sessionId]).toEqual({
				state: "connected",
				sessionUrl: SESSION_URL,
			});
		} finally {
			await test.container.stop();
			test.close();
		}
	});
});
