/**
 * @feature CHAT-08 Tool card
 * Owns: showing one tool call with the right card, looked up by the call's canonical tool name.
 * Behaviour: frontend.md 5 (a registry maps tool kind to component; unknown tools fall back to a generic card),
 * ui-map.md 3.3 (tool cards).
 * Our design choice: Conductor looks up its own tool name, exact first and then by prefix. Here the sidecar
 * translators already map every agent's tools to `CanonicalTool`, so the lookup is a direct table (see
 * registry.ts) and "unknown" gets the generic card.
 * Must handle: a card that throws does not break the turn (the boundary shows one line naming the tool);
 * a call with no result yet is "running"; sub-agent calls render their children inside the sub-agent card.
 * Test first: a "bash" call renders BashCard; a call with tool "unknown" renders the generic card.
 */
import type { SessionId } from "@conducted/shared";
import type { ToolCallView } from "../../../core/model.ts";
import { NotBuiltYet } from "../../../ui/not-built-yet.tsx";
import { toolCardFor } from "./registry.ts";

export function ToolCard({ call, sessionId }: { call: ToolCallView; sessionId: SessionId }) {
	const Card = toolCardFor(call.item.tool);
	return (
		<NotBuiltYet area={`Tool: ${call.item.rawName}`} variant="inline" resetKey={call.toolUseId}>
			<Card call={call} sessionId={sessionId} />
		</NotBuiltYet>
	);
}
