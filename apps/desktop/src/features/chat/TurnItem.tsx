/**
 * @feature CHAT-06 Chat turn; CHAT-27 Visible auto-retry with Retry now
 * Owns: One list item: the user's message, steers sent during the turn, the assistant's blocks,
 * banners, the agent's own retry line with Retry now, Retry in new chat on a failed turn, the files the
 * turn changed (with Open diff, which shows the turn in the Git panel's Changes tab) and the turn footer.
 * A finished turn folds runs of its tool calls and messages into one row each (fold-turn.ts), unless
 * "Expand all tool calls" is on.
 * Behaviour: frontend.md 5 (one item per turn), ui-map.md 3.3 (user message with attachments and
 * mention chips; assistant text; thinking; footer; 'Cancelled' on a stopped turn; per-turn boundary;
 * 'Something went wrong, retrying n/m' with Retry now and Retry in new chat).
 * Measured from Conductor 0.92.1 (renderApp @9595770): the turn is a column with 4px gaps, 28px sides and
 * 8px top and bottom; the user message gets 12px more above and below. The working line sits in the
 * list's footer (MessageList), not in the turn.
 * Our design choice: Wrapped in the shared ErrorBoundary so one broken turn does not hide the
 * others. Blocks render through ChatBlockView.
 * Must handle: A running turn (nothing folded, no footer yet); a turn that ended in error (one banner:
 * none of its own when an error block of the turn already shows the same error; otherwise the view
 * Conductor shows for the error that ended a turn, from turn-error-view.ts), cancelled ("Interrupted by user") or cut off by a crash (a different line, since the user did not stop it);
 * a block that streams keeps its place on screen (keys come from position, not text); a reverted turn (dimmed, labelled); steers not yet read by the
 * agent (marked pending); footer actions are always visible, on every turn; the agent's retry line names
 * the attempt, Retry now stops the turn and sends the message again, and Retry in new chat hands the turn
 * to the banner; a turn with no user message offers no Retry now or Retry.
 * Test first: A turn with one text block and a tool block renders both in order; a thrown render
 * error shows the boundary text and the next turn still renders; Retry now cancels and resends.
 */
import { AGENT_ERROR_CODES, type LiveState } from "@conducted/protocol";
import type { AgentKind, SessionId, WorkspaceId } from "@conducted/shared";
import { memo, useRef } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions } from "../../core/hooks.ts";
import type { ChatBlock, ChatTurn } from "../../core/model.ts";
import { cn } from "../../ui/cn.ts";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import { ChatBanner, ChatRetryBanner } from "./ChatBanner.tsx";
import { ChatBlockView } from "./ChatBlockView.tsx";
import { FoldedRun } from "./FoldedRun.tsx";
import { type FoldItem, foldTurnBlocks } from "./fold-turn.ts";
import { reportFailure } from "./report-failure.ts";
import { TurnFooter } from "./TurnFooter.tsx";
import { type TurnErrorView, turnErrorView } from "./turn-error-view.ts";
import { UserMessage } from "./UserMessage.tsx";
import { useWorkspaceLinks } from "./workspace-links.ts";

export interface TurnItemProps {
	turn: ChatTurn;
	sessionId: SessionId;
	/** The workspace for a shell command, or a relative file or video target in the text. */
	workspaceId?: WorkspaceId;
	/** The workspace is ready and not archived, so a shell block can run its command. */
	canRun?: boolean;
	/** The agent's own retry, when this is the running turn that has one. */
	retry?: LiveState["retry"];
	/** "Expand all tool calls" is on: nothing folds. */
	expandAll?: boolean;
	/** The chat's agent. A turn error offers sign-in only in a Claude chat, as Conductor's does. */
	agent?: AgentKind;
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

interface OutcomeBanner {
	block: Extract<ChatBlock, { kind: "notice" | "error" }>;
	view?: TurnErrorView;
}

const notice = (text: string): OutcomeBanner => ({
	block: { kind: "notice", item: { kind: "notice", notice: "info", text } },
});

/**
 * The banner of how the turn ended. A failed turn's error is shown through Conductor's views for
 * the error that ended a turn (turn-error-view.ts, IQi @9538488), unless an error block of the turn
 * already says it.
 */
function outcomeBanner(turn: ChatTurn, agent: AgentKind | undefined): OutcomeBanner | null {
	if (turn.outcome === "cancelled") return notice("Interrupted by user");
	if (turn.outcome === "interrupted") return notice("This turn stopped before it finished.");
	if (turn.outcome !== "error") return null;
	// The agent's own error block already shows this error, with its retry actions.
	const shown = turn.blocks.some(
		(block) => block.kind === "error" && (turn.error === null || block.item.message === turn.error),
	);
	if (shown) return null;
	const view = turnErrorView(turn.error, agent);
	if (view.kind === "interrupted") return notice("Interrupted by user");
	if (view.kind === "sign_in") {
		// IQi shows nothing more when the turn's result already shows the sign-in view.
		const signInShown = turn.blocks.some(
			(block) => block.kind === "error" && block.item.code === AGENT_ERROR_CODES.authRequired,
		);
		if (signInShown) return null;
		return {
			block: {
				kind: "error",
				item: {
					kind: "error",
					code: AGENT_ERROR_CODES.authRequired,
					message: view.text,
					retryable: false,
				},
			},
		};
	}
	return {
		block: {
			kind: "error",
			item: {
				kind: "error",
				code: "turn_error",
				message: turn.error ?? "Unknown error",
				// GFe offers Retry on these two views only (IQi @9538488).
				retryable: view.kind === "error" || view.kind === "overloaded",
			},
		},
		view,
	};
}

export const TurnItem = memo(function TurnItem({
	turn,
	sessionId,
	workspaceId,
	canRun,
	retry,
	expandAll = false,
	agent,
}: TurnItemProps) {
	const actions = useActions();
	const links = useWorkspaceLinks();
	const retryFlight = useRef(createSingleFlight()).current;
	const message = turn.userMessage;
	// A turn the agent started by itself has no message to send again in this chat, so the actions
	// that resend it are not offered. Showing one that does nothing would be a silent failure.
	const retryMessage =
		message === null
			? undefined
			: () => {
					void reportFailure(
						actions.sessions.send(sessionId, message.text, message.attachmentPaths, "auto"),
						"Couldn't send the message again",
					);
				};
	// Retry now stops the agent's waiting retry and sends the same message as a fresh turn. The
	// sidecar starts a new turn when it has gone idle, so a steer request falls back correctly.
	const retryNow =
		message === null
			? undefined
			: () => {
					void reportFailure(
						retryFlight.run(`chat:${sessionId}:retry-now`, async () => {
							const stopped = await actions.sessions.cancel(sessionId);
							if (!stopped.ok) return stopped;
							return actions.sessions.send(
								sessionId,
								message.text,
								message.attachmentPaths,
								"auto",
							);
						}),
						"Couldn't retry now",
					);
				};
	const banner = outcomeBanner(turn, agent);
	const keyed = keyedBlocks(turn.blocks);
	const items: FoldItem[] =
		turn.outcome === "running" || expandAll
			? keyed.map(({ key, block }) => ({ kind: "block", key, block }))
			: foldTurnBlocks(keyed);
	const retryInNewChat = { sessionId, turnId: turn.turnId };
	const renderBlock = (key: string, block: ChatBlock) => (
		<ChatBlockView
			key={key}
			block={block}
			sessionId={sessionId}
			workspaceId={workspaceId}
			canRun={canRun}
			streaming={turn.outcome === "running"}
			onRetry={retryMessage}
			retryInNewChat={retryInNewChat}
			agent={agent}
		/>
	);

	return (
		<div
			data-turn={turn.turnId}
			className={
				turn.reverted
					? "mx-auto flex w-full max-w-[896px] flex-col gap-1 px-7 py-2 opacity-60"
					: "mx-auto flex w-full max-w-[896px] flex-col gap-1 px-7 py-2"
			}
		>
			<ErrorBoundary
				resetKey={turn.turnId}
				fallback={() => (
					<div role="status" className="rounded-lg border border-border bg-surface px-4 py-3">
						<p className="text-sm font-medium text-fg">This chat turn failed to render</p>
						<p className="text-xs text-fg-muted">Other turns are still available.</p>
					</div>
				)}
			>
				{turn.reverted ? <p className="text-2xs text-fg-subtle">This turn was reverted.</p> : null}
				{turn.userMessage !== null ? (
					<div className="py-3">
						<UserMessage turn={turn} sessionId={sessionId} />
					</div>
				) : null}
				{turn.steers.map((steer) => (
					<div key={steer.messageId} className="flex justify-end">
						<div
							className={cn(
								"max-w-[min(100%,var(--user-bubble-width))] overflow-hidden break-words rounded-sm px-4 py-3 text-sm transition-colors duration-300 lg:max-w-[min(100%,var(--user-bubble-width-wide))]",
								// Conductor's tones: a steer the agent has read is the user's own bubble; one still
								// waiting is drawn as queued, in the muted pair.
								steer.consumed
									? "bg-highlight-surface text-highlight-fg"
									: "bg-muted text-fg-muted",
							)}
						>
							<p className="whitespace-pre-wrap break-words select-text">{steer.text}</p>
							{steer.consumed ? null : <p className="mt-1 text-2xs text-fg-subtle">Pending</p>}
						</div>
					</div>
				))}
				{items.map((item) =>
					item.kind === "block" ? (
						renderBlock(item.key, item.block)
					) : (
						<FoldedRun key={item.key} summary={item.summary}>
							{item.blocks.map(({ key, block }) => renderBlock(key, block))}
						</FoldedRun>
					),
				)}
				{banner === null ? null : (
					<ChatBanner
						block={banner.block}
						view={banner.view}
						onRetry={retryMessage}
						retryInNewChat={retryInNewChat}
						agent={agent}
					/>
				)}
				{retry === undefined ? null : (
					<ChatRetryBanner retry={retry} onRetryNow={retryNow} retryInNewChat={retryInNewChat} />
				)}
				{turn.outcome === "running" ? null : (
					<TurnFooter
						turn={turn}
						sessionId={sessionId}
						onOpenDiff={links.openDiffScope}
						onOpenFile={links.openFileInScope}
					/>
				)}
			</ErrorBoundary>
		</div>
	);
});
