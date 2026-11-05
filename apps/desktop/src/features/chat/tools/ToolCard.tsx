/**
 * @feature CHAT-08 Tool card
 * Owns: showing one tool call with the right card, looked up by the call's canonical tool name.
 * Behaviour: frontend.md 5 (a registry maps tool kind to component; unknown tools fall back to a generic card),
 * ui-map.md 3.3 (tool cards), 5.4 (Ctrl+O toggles Garry mode, which expands every tool call).
 * Our design choice: Conductor looks up its own tool name, exact first and then by prefix. Here the sidecar
 * translators already map every agent's tools to `CanonicalTool`, so the lookup is a direct table (see
 * registry.ts) and "unknown" gets the generic card. The Ctrl+O listener lives here until the shared command
 * dispatcher (NAV-14) can run command handlers; the flag it toggles is the same "Expand all tool calls"
 * setting the settings page uses, and the first listener to see the key press wins.
 * Must handle: a card that throws does not break the turn (the boundary shows one line naming the tool);
 * a call with no result yet is "running"; sub-agent calls render their children inside the sub-agent card.
 * Test first: a "bash" call renders BashCard; a call with tool "unknown" renders the generic card.
 */
import type { SessionId } from "@conducted/shared";
import { useEffect } from "react";
import { useActions, useSetting } from "../../../core/hooks.ts";
import type { ToolCallView } from "../../../core/model.ts";
import { NotBuiltYet } from "../../../ui/not-built-yet.tsx";
import { toolCardFor } from "./registry.ts";

function isExpandAllShortcut(event: KeyboardEvent): boolean {
	return (
		event.key.toLowerCase() === "o" &&
		event.ctrlKey &&
		!event.metaKey &&
		!event.altKey &&
		!event.shiftKey
	);
}

export function ToolCard({ call, sessionId }: { call: ToolCallView; sessionId: SessionId }) {
	const expandAll = useSetting<boolean>("expand_tool_calls");
	const actions = useActions();
	const Card = toolCardFor(call.item.tool);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isExpandAllShortcut(event) || event.repeat || event.defaultPrevented) return;
			event.preventDefault();
			void actions.settings.set("expand_tool_calls", !expandAll);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [actions, expandAll]);

	return (
		<NotBuiltYet area={`Tool: ${call.item.rawName}`} variant="inline" resetKey={call.toolUseId}>
			<Card call={call} sessionId={sessionId} defaultExpanded={expandAll} />
		</NotBuiltYet>
	);
}
