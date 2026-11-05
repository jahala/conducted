/**
 * @feature CHAT-06 Chat turn
 * Owns: One list item: the user's message, steers sent during the turn, the assistant's blocks,
 * banners and the turn footer.
 * Behaviour: frontend.md 5 (one item per turn), ui-map.md 3.3 (user message with attachments and
 * mention chips; assistant text; thinking; footer; 'Interrupted by user'; per-turn boundary).
 * Our design choice: Wrapped in the shared ErrorBoundary so one broken turn does not hide the
 * others. Blocks render through ChatBlockView.
 * Must handle: A running turn (live caret or spinner, no footer yet); a turn that ended in error,
 * cancelled or interrupted (banner); a reverted turn (dimmed, labelled); steers not yet read by the
 * agent (marked pending); the last turn (footer actions always visible).
 * Test first: A turn with one text block and a tool block renders both in order; a thrown render
 * error shows the boundary text and the next turn still renders.
 */
import type { SessionId } from "@conducted/shared";
import { memo } from "react";
import { useActions } from "../../core/hooks.ts";
import type { ChatBlock, ChatTurn } from "../../core/model.ts";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { ChatBanner } from "./ChatBanner.tsx";
import { ChatBlockView } from "./ChatBlockView.tsx";
import { TurnFooter } from "./TurnFooter.tsx";
import { UserMessage } from "./UserMessage.tsx";

export interface TurnItemProps {
	turn: ChatTurn;
	sessionId: SessionId;
	isLast: boolean;
}

function blockKey(block: ChatBlock): string {
	switch (block.kind) {
		case "text":
			return `text:${block.text.slice(0, 40)}`;
		case "thinking":
			return `thinking:${block.text.slice(0, 40)}`;
		case "tool":
			return `tool:${block.call.toolUseId}`;
		case "todo":
			return `todo:${block.item.items.map((item) => item.label).join("|")}`;
		case "notice":
			return `notice:${block.item.notice}:${block.item.text.slice(0, 40)}`;
		case "error":
			return `error:${block.item.code}:${block.item.message.slice(0, 40)}`;
	}
}

function keyedBlocks(blocks: ChatBlock[]): { key: string; block: ChatBlock }[] {
	const seen = new Map<string, number>();
	return blocks.map((block) => {
		const base = blockKey(block);
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return { key: `${base}#${count}`, block };
	});
}

function outcomeBlock(turn: ChatTurn): Extract<ChatBlock, { kind: "notice" | "error" }> | null {
	if (turn.outcome === "interrupted" || turn.outcome === "cancelled") {
		return {
			kind: "notice",
			item: { kind: "notice", notice: "info", text: "Interrupted by user" },
		};
	}
	if (turn.outcome === "error") {
		return {
			kind: "error",
			item: {
				kind: "error",
				code: "turn_error",
				message: turn.error ?? "The turn failed.",
				retryable: false,
			},
		};
	}
	return null;
}

export const TurnItem = memo(function TurnItem({ turn, sessionId, isLast }: TurnItemProps) {
	const actions = useActions();
	const retry = () => {
		const message = turn.userMessage;
		if (message === null) return;
		void actions.sessions.send(sessionId, message.text, message.attachmentPaths, "auto");
	};
	const banner = outcomeBlock(turn);
	const blocks = keyedBlocks(turn.blocks);

	return (
		<div
			data-turn={turn.turnId}
			data-last-turn={isLast ? "true" : undefined}
			className={
				turn.reverted
					? "mx-auto flex w-full max-w-[896px] flex-col gap-3 px-7 py-4 opacity-60"
					: "mx-auto flex w-full max-w-[896px] flex-col gap-3 px-7 py-4"
			}
		>
			<ErrorBoundary
				resetKey={turn.turnId}
				fallback={() => (
					<div role="status" className="rounded-lg border border-border bg-surface px-4 py-3">
						<p className="text-sm font-medium text-fg">This chat turn failed to render.</p>
						<p className="text-xs text-fg-muted">Other turns are still available.</p>
					</div>
				)}
			>
				{turn.reverted ? <p className="text-2xs text-fg-subtle">This turn was reverted.</p> : null}
				{turn.userMessage !== null ? <UserMessage turn={turn} sessionId={sessionId} /> : null}
				{turn.steers.map((steer) => (
					<div key={steer.messageId} className="flex justify-end">
						<div className="max-w-[min(100%,36rem)] rounded-xl bg-surface px-4 py-2 text-sm text-fg shadow-xs">
							<p className="whitespace-pre-wrap break-words select-text">{steer.text}</p>
							{steer.consumed ? null : <p className="mt-1 text-2xs text-fg-subtle">Pending</p>}
						</div>
					</div>
				))}
				{blocks.map(({ key, block }) => (
					<ChatBlockView key={key} block={block} sessionId={sessionId} onRetry={retry} />
				))}
				{banner === null ? null : <ChatBanner block={banner} onRetry={retry} />}
				{turn.outcome === "running" ? (
					<div className="flex items-center gap-2 px-1 text-xs text-fg-muted">
						<Spinner size="sm" label="The agent is working" />
						<span>The agent is working</span>
					</div>
				) : (
					<TurnFooter turn={turn} sessionId={sessionId} />
				)}
			</ErrorBoundary>
		</div>
	);
});
