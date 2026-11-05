/**
 * @feature CHAT-06 Chat turn; CHAT-27 Visible auto-retry with Retry now
 * Owns: One list item: the user's message, steers sent during the turn, the assistant's blocks,
 * banners, the agent's own retry line with Retry now, Retry in new chat on a failed turn, and the
 * turn footer.
 * Behaviour: frontend.md 5 (one item per turn), ui-map.md 3.3 (user message with attachments and
 * mention chips; assistant text; thinking; footer; 'Interrupted by user'; per-turn boundary;
 * 'Something went wrong, retrying n/m' with Retry now and Retry in new chat).
 * Our design choice: Wrapped in the shared ErrorBoundary so one broken turn does not hide the
 * others. Blocks render through ChatBlockView.
 * Must handle: A running turn (spinner, no footer yet); a turn that ended in error,
 * cancelled ("Interrupted by user") or cut off by a crash (a different line, since the user did not stop it);
 * a block that streams keeps its place on screen (keys come from position, not text); a reverted turn (dimmed, labelled); steers not yet read by the
 * agent (marked pending); footer actions are always visible, on every turn; the agent's retry line names
 * the attempt, Retry now stops the turn and sends the message again, and Retry in new chat hands the turn
 * to the banner.
 * Test first: A turn with one text block and a tool block renders both in order; a thrown render
 * error shows the boundary text and the next turn still renders; Retry now cancels and resends.
 */
import type { LiveState } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { memo, useRef } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions } from "../../core/hooks.ts";
import type { ChatBlock, ChatTurn } from "../../core/model.ts";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { ChatBanner, ChatRetryBanner } from "./ChatBanner.tsx";
import { ChatBlockView } from "./ChatBlockView.tsx";
import { reportFailure } from "./report-failure.ts";
import { TurnFooter } from "./TurnFooter.tsx";
import { UserMessage } from "./UserMessage.tsx";

export interface TurnItemProps {
	turn: ChatTurn;
	sessionId: SessionId;
	/** The agent's own retry, when this is the running turn that has one. */
	retry?: LiveState["retry"];
}

/**
 * A tool block keeps its tool call id. Every other block is keyed by its position, because its text
 * changes while it streams: a key made from the text would remount the block on every change.
 */
function keyedBlocks(blocks: ChatBlock[]): { key: string; block: ChatBlock }[] {
	return blocks.map((block, position) => ({
		key: block.kind === "tool" ? `tool:${block.call.toolUseId}` : `${block.kind}:${position}`,
		block,
	}));
}

function outcomeBlock(turn: ChatTurn): Extract<ChatBlock, { kind: "notice" | "error" }> | null {
	if (turn.outcome === "cancelled") {
		return {
			kind: "notice",
			item: { kind: "notice", notice: "info", text: "Interrupted by user" },
		};
	}
	if (turn.outcome === "interrupted") {
		return {
			kind: "notice",
			item: { kind: "notice", notice: "info", text: "This turn stopped before it finished." },
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

export const TurnItem = memo(function TurnItem({ turn, sessionId, retry }: TurnItemProps) {
	const actions = useActions();
	const retryFlight = useRef(createSingleFlight()).current;
	const retryMessage = () => {
		const message = turn.userMessage;
		if (message === null) return;
		void reportFailure(
			actions.sessions.send(sessionId, message.text, message.attachmentPaths, "auto"),
			"Couldn't send the message again",
		);
	};
	// Retry now stops the agent's waiting retry and sends the same message as a fresh turn. The
	// sidecar starts a new turn when it has gone idle, so a steer request falls back correctly.
	const retryNow = () => {
		const message = turn.userMessage;
		if (message === null) return;
		void reportFailure(
			retryFlight.run(`chat:${sessionId}:retry-now`, async () => {
				const stopped = await actions.sessions.cancel(sessionId);
				if (!stopped.ok) return stopped;
				return actions.sessions.send(sessionId, message.text, message.attachmentPaths, "auto");
			}),
			"Couldn't retry now",
		);
	};
	const banner = outcomeBlock(turn);
	const blocks = keyedBlocks(turn.blocks);
	const retryInNewChat = { sessionId, turnId: turn.turnId };

	return (
		<div
			data-turn={turn.turnId}
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
					<ChatBlockView
						key={key}
						block={block}
						sessionId={sessionId}
						onRetry={retryMessage}
						retryInNewChat={retryInNewChat}
					/>
				))}
				{banner === null ? null : (
					<ChatBanner block={banner} onRetry={retryMessage} retryInNewChat={retryInNewChat} />
				)}
				{retry === undefined ? null : (
					<ChatRetryBanner retry={retry} onRetryNow={retryNow} retryInNewChat={retryInNewChat} />
				)}
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
