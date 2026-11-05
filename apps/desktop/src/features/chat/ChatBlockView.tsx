/**
 * @feature CHAT-06 One block of a turn
 * Owns: choosing the component for each block of an assistant turn: text, thinking, tool call, todo list,
 * notice or error.
 * Behaviour: frontend.md 5 (tool cards keyed by kind, thinking and todo as their own kinds), ui-map.md 3.3
 * (banners in the list).
 * Must handle: every ChatBlock kind has a view (the switch is exhaustive, so a new kind fails to compile here);
 * an empty text block renders nothing; a streaming text block grows in place.
 * Test first: a tool block renders the tool card for its call; a notice block renders a banner.
 */
import type { SessionId } from "@conducted/shared";
import type { ChatBlock } from "../../core/model.ts";
import { AssistantText } from "./AssistantText.tsx";
import { ChatBanner } from "./ChatBanner.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { TodoBlock } from "./TodoBlock.tsx";
import { ToolCard } from "./tools/ToolCard.tsx";

export function ChatBlockView({
	block,
	sessionId,
	onRetry,
}: {
	block: ChatBlock;
	sessionId: SessionId;
	/** Resends the last message, for a retryable error block. */
	onRetry?: () => void;
}) {
	switch (block.kind) {
		case "text":
			return <AssistantText text={block.text} />;
		case "thinking":
			return <ThinkingBlock text={block.text} summarized={block.summarized} />;
		case "tool":
			return <ToolCard call={block.call} sessionId={sessionId} />;
		case "todo":
			return <TodoBlock item={block.item} />;
		case "notice":
		case "error":
			return <ChatBanner block={block} onRetry={onRetry} />;
	}
}
