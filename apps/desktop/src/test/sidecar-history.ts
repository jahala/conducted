/**
 * @feature test support The sidecar's real chat history mapping, answering a test container
 * Owns: `answerHistory`, which answers the three Conductor history requests a test container
 * sends its sidecar with the sidecar's own `ConductorHistoryImports`, so an import through the
 * container maps chat history with the code the app ships (APP-18).
 * Behaviour: not applicable, test support only.
 * Must handle: params and answers cross the same JSON round trip as on the socket, so the mapping
 * sees what the real sidecar would; a refusal is sent as the JSON-RPC error the peer would send;
 * any other request is left to the caller's own answer.
 * Test first: not applicable; conductor-import.container.test.ts uses it.
 */
import { ConductorHistoryImports } from "../../../../packages/sidecar/src/import/history-imports.ts";
import { type SidecarCall, sidecarRefuses } from "./sidecar-answers.ts";

const HISTORY_METHODS = new Set([
	"indexConductorHistory",
	"mapConductorHistory",
	"closeConductorHistory",
]);

/** An answer for `answerSidecar`: history requests go to the real mapping, others to `rest`. */
export function answerHistory(
	rest: (call: SidecarCall) => unknown,
	imports = new ConductorHistoryImports(),
): (call: SidecarCall) => unknown {
	return (call) => {
		if (!HISTORY_METHODS.has(call.method)) return rest(call);
		const params = JSON.parse(JSON.stringify(call.params));
		const answered =
			call.method === "indexConductorHistory"
				? imports.index(params)
				: call.method === "mapConductorHistory"
					? imports.map(params)
					: imports.close(params);
		return answered.ok
			? JSON.parse(JSON.stringify(answered.value))
			: sidecarRefuses(answered.error.message);
	};
}
