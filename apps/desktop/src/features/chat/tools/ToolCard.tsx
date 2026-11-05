/**
 * @feature CHAT-08 Tool card
 * Owns: showing one tool call with the right card, looked up by the call's canonical tool name.
 * Behaviour: frontend.md 5 (a registry maps tool kind to component; unknown tools fall back to a generic card),
 * ui-map.md 3.3 (tool cards), 5.4 (Ctrl+O toggles Garry mode, which expands every tool call).
 * Our design choice: Conductor looks up its own tool name, exact first and then by prefix. Here the sidecar
 * translators already map every agent's tools to `CanonicalTool`, so the lookup is a direct table (see
 * registry.ts) and "unknown" gets the generic card. The Ctrl+O handler belongs to the chat list, which
 * registers `chat.expandAllToolCalls` once for the whole list; a card only reads the "Expand all tool
 * calls" setting.
 * Must handle: a card that throws shows one error line naming the tool and is logged, without breaking
 * the turn; a call with no result yet is "running"; sub-agent calls render their children inside the
 * sub-agent card.
 * Test first: a "bash" call renders BashCard; a call with tool "unknown" renders the generic card.
 */
import type { SessionId } from "@conducted/shared";
import { useSetting } from "../../../core/hooks.ts";
import type { ToolCallView } from "../../../core/model.ts";
import { ErrorBoundary } from "../../../ui/ErrorBoundary.tsx";
import { toolCardFor } from "./registry.ts";

export function ToolCard({ call, sessionId }: { call: ToolCallView; sessionId: SessionId }) {
	const expandAll = useSetting<boolean>("expand_tool_calls");
	const Card = toolCardFor(call.item.tool);
	return (
		<ErrorBoundary
			resetKey={call.toolUseId}
			fallback={() => (
				<p role="status" className="px-2 py-1 text-xs text-fg-subtle">
					Tool: {call.item.rawName}: This part failed to load.
				</p>
			)}
		>
			<Card call={call} sessionId={sessionId} defaultExpanded={expandAll} />
		</ErrorBoundary>
	);
}
