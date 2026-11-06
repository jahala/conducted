/**
 * @feature test support Answers to the requests a test container sends its sidecar
 * Owns: recording every JSON-RPC request the container sends over the in-memory sidecar transport
 * and answering it with what the test says the sidecar replies.
 * Behaviour: not applicable, test support only.
 * Must handle: an answer the test settles later (a promise), so tests can make answers arrive in
 * the wrong order; a refusal (`sidecarRefuses`), sent as a JSON-RPC error; notifications (no id)
 * are passed on unanswered.
 * Test first: not applicable; the goal tests (COMP-10) and the n15-s1-ui-2 join test use it.
 */
import type { TestContainer } from "./container.ts";

export interface SidecarCall {
	id: number;
	method: string;
	params: Record<string, unknown>;
}

const REFUSAL = Symbol("sidecar refusal");

/** A JSON-RPC error answer, made by `sidecarRefuses`. */
export interface SidecarRefusal {
	readonly [REFUSAL]: true;
	readonly code: number;
	readonly message: string;
}

/** An answer that refuses the request with a JSON-RPC error, as the real sidecar does. */
export function sidecarRefuses(message: string, code = -32603): SidecarRefusal {
	return { [REFUSAL]: true, code, message };
}

function isRefusal(value: unknown): value is SidecarRefusal {
	return typeof value === "object" && value !== null && REFUSAL in value;
}

/**
 * Records every request the container sends to the sidecar and answers it. `answer` returns the
 * result, a refusal, or a promise the test settles later.
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
					JSON.stringify(
						isRefusal(result)
							? {
									jsonrpc: "2.0",
									id: call.id,
									error: { code: result.code, message: result.message },
								}
							: { jsonrpc: "2.0", id: call.id, result },
					),
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
