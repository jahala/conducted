/**
 * @feature test support Answers to the requests a test container sends its sidecar
 * Owns: recording every JSON-RPC request the container sends over the in-memory sidecar transport
 * and answering it with what the test says the sidecar replies.
 * Behaviour: not applicable, test support only.
 * Must handle: an answer the test settles later (a promise), so tests can make answers arrive in
 * the wrong order; notifications (no id) are passed on unanswered.
 * Test first: not applicable; the goal tests (COMP-10) and the n15-s1-ui-2 join test use it.
 */
import type { TestContainer } from "./container.ts";

export interface SidecarCall {
	id: number;
	method: string;
	params: Record<string, unknown>;
}

/**
 * Records every request the container sends to the sidecar and answers it. `answer` returns the
 * result, or a promise the test settles later.
 */
export function answerSidecar(
	test: TestContainer,
	answer: (call: SidecarCall) => unknown,
): SidecarCall[] {
	const transport = test.memory.platform.sidecar;
	const original = transport.send.bind(transport);
	const calls: SidecarCall[] = [];
	transport.send = async (line) => {
		const sent = await original(line);
		const parsed = JSON.parse(line) as Partial<SidecarCall>;
		if (parsed.method !== undefined && parsed.id !== undefined) {
			const call = { id: parsed.id, method: parsed.method, params: parsed.params ?? {} };
			calls.push(call);
			void Promise.resolve(answer(call)).then((result) =>
				test.memory.controls.emitSidecarLine(
					JSON.stringify({ jsonrpc: "2.0", id: call.id, result }),
				),
			);
		}
		return sent;
	};
	return calls;
}

/** The sidecar's answer to a sendMessage: delivered as asked. Other requests get an empty result. */
export const deliveredAsAsked = (call: SidecarCall): unknown =>
	call.method === "sendMessage" ? { deliveredAs: call.params.delivery } : {};
