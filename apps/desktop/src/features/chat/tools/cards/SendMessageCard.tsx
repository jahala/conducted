/**
 * @feature CHAT-20 Send message card
 * Owns: The card for the agent sending a message to another chat.
 * Behaviour: ui-map.md 3.3 (send message: a 'To:' row naming the target chat, renderApp @8824972).
 * Must handle: A target chat that was closed or deleted (the result text is shown); a long message
 * (it scrolls); a call that names no target.
 * Test first: A send_message call shows a 'To:' row naming the chat it went to.
 */
import { asRecord, ToolCardFrame, ToolOutput, textField, toolStatus } from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

export function SendMessageCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const target = textField(
		input,
		"chat",
		"chatName",
		"chat_name",
		"target",
		"targetChat",
		"target_chat",
		"session",
		"sessionId",
		"session_id",
		"recipient",
		"to",
	);
	const message = textField(input, "message", "text", "content", "prompt") ?? "";
	const output = call.result?.output ?? "";
	return (
		<ToolCardFrame
			title="Send message"
			summary={target ?? undefined}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				<div className="flex flex-col gap-2">
					{target ? (
						<p className="flex gap-1 text-xs text-fg-muted">
							<span>To:</span>
							<span className="font-medium text-fg">{target}</span>
						</p>
					) : (
						<p className="text-xs text-fg-subtle">This call names no target chat.</p>
					)}
					{message.length > 0 ? (
						<ToolOutput className="rounded-sm bg-surface p-2">{message}</ToolOutput>
					) : null}
					{output.length > 0 ? (
						<pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs text-fg-muted">
							{output}
						</pre>
					) : null}
				</div>
			}
		/>
	);
}
