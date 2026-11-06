/**
 * @feature CHAT-06 One block of a turn; CHAT-27 Visible auto-retry with Retry now
 * Owns: choosing the component for each block of an assistant turn: text, thinking, tool call, todo list,
 * notice or error.
 * Behaviour: frontend.md 5 (tool cards keyed by kind, thinking and todo as their own kinds), ui-map.md 3.3
 * (banners in the list; an error block offers Retry in new chat).
 * Must handle: every ChatBlock kind has a view (the switch is exhaustive, so a new kind fails to compile here);
 * an empty text block renders nothing; a streaming text block grows in place; a block whose view is a
 * placeholder, or throws, is replaced by one line and the rest of the turn stays; a retry target reaches an
 * error block's banner.
 * Test first: a tool block renders the tool card for its call; a notice block renders a banner.
 */
import type { SessionId, WorkspaceId } from "@conducted/shared";
import type { ChatBlock } from "../../core/model.ts";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { AssistantText } from "./AssistantText.tsx";
import { ChatBanner, type RetryInNewChatTarget } from "./ChatBanner.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { TodoBlock } from "./TodoBlock.tsx";
import { ToolCard } from "./tools/ToolCard.tsx";

/** The name a block shows when its view is not built yet or fails to render. */
const BLOCK_AREA = {
	text: "Message",
	thinking: "Thinking",
	tool: "Tool call",
	todo: "Todo list",
	notice: "Notice",
	error: "Error",
} as const satisfies Record<ChatBlock["kind"], string>;

function BlockContent({
	block,
	sessionId,
	workspaceId,
<<<<<<< HEAD
	canRun,
=======
	streaming,
>>>>>>> node/chat.24
	onRetry,
	retryInNewChat,
}: {
	block: ChatBlock;
	sessionId: SessionId;
	workspaceId?: WorkspaceId;
<<<<<<< HEAD
	canRun?: boolean;
=======
	streaming?: boolean;
>>>>>>> node/chat.24
	onRetry?: () => void;
	retryInNewChat?: RetryInNewChatTarget;
}) {
	switch (block.kind) {
		case "text":
<<<<<<< HEAD
			return <AssistantText text={block.text} workspaceId={workspaceId} canRun={canRun} />;
=======
			return <AssistantText text={block.text} workspaceId={workspaceId} streaming={streaming} />;
>>>>>>> node/chat.24
		case "thinking":
			return <ThinkingBlock text={block.text} summarized={block.summarized} />;
		case "tool":
			return <ToolCard call={block.call} sessionId={sessionId} />;
		case "todo":
			return <TodoBlock item={block.item} />;
		case "notice":
		case "error":
			return <ChatBanner block={block} onRetry={onRetry} retryInNewChat={retryInNewChat} />;
	}
}

/**
 * One block in its own `NotBuiltYet` boundary. A block whose view is a placeholder (thinking and todo until
 * CHAT-09 is built) shows "Not built yet" in its place. Without this, the placeholder's error would pass the
 * turn's `ErrorBoundary`, which re-throws it, and replace the whole message list.
 */
export function ChatBlockView({
	block,
	sessionId,
	workspaceId,
<<<<<<< HEAD
	canRun,
=======
	streaming,
>>>>>>> node/chat.24
	onRetry,
	retryInNewChat,
}: {
	block: ChatBlock;
	sessionId: SessionId;
<<<<<<< HEAD
	workspaceId?: WorkspaceId;
	canRun?: boolean;
=======
	/** The workspace a relative file or video target in the text belongs to. */
	workspaceId?: WorkspaceId;
	/** The reply's text is still arriving from the agent. */
	streaming?: boolean;
>>>>>>> node/chat.24
	/** Resends the last message, for a retryable error block. */
	onRetry?: () => void;
	/** The failed turn to send again in a new chat, for an error block. */
	retryInNewChat?: RetryInNewChatTarget;
}) {
	// A streaming block that failed on half a sentence gets another try when more text arrives.
	const resetKey =
		block.kind === "text" || block.kind === "thinking" ? block.text.length : undefined;
	return (
		<NotBuiltYet area={BLOCK_AREA[block.kind]} variant="inline" resetKey={resetKey}>
			<BlockContent
				block={block}
				sessionId={sessionId}
				workspaceId={workspaceId}
<<<<<<< HEAD
				canRun={canRun}
=======
				streaming={streaming}
>>>>>>> node/chat.24
				onRetry={onRetry}
				retryInNewChat={retryInNewChat}
			/>
		</NotBuiltYet>
	);
}
