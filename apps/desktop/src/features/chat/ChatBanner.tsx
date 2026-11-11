/**
 * @feature CHAT-06 Chat banners; CHAT-27 Visible auto-retry with Retry now
 * Owns: Notices and errors in the list: interrupted, history compacted, compacting, session limit
 * reached, sign-in needed, 'This content could not be displayed.', the agent's own retry progress
 * with Retry now, and Retry in new chat on a failed turn.
 * Behaviour: ui-map.md 3.3 (Banners in the list; 'Something went wrong, retrying n/m' with Retry
 * now while the agent retries by itself; the error card offers Retry in new chat), 7.4 (agent
 * binary and auth problems are shown inline in chat).
 * Our design choice: Sign-in and key problems link to the Agents settings page and show the agent's
 * own message, which names the problem (one auth code covers every agent). Retryable errors show
 * 'Try again', which resends the last message. 'Image too large' belongs to the composer's
 * attachment bar, not this list banner. Retry in new chat creates the chat and opens it, and one
 * request at a time starts it.
 * Must handle: Each notice kind has its own wording (the protocol's notice kinds: session_started,
 * compacted, rate_limit, model_changed, info); an error with `retryable` false has no retry; an
 * auto-retry line names the attempt and the agent's reason; a retry in a new chat that fails shows
 * a toast; text is selectable; error colour only for real errors, not for notices.
 * Test first: A 'compacted' notice reads as a quiet line; a retryable error shows a Try again
 * button; the retry line names the attempt and Retry now calls back.
 */
import { AGENT_ERROR_CODES, type LiveState } from "@conducted/protocol";
import type { SessionId, TurnId } from "@conducted/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions } from "../../core/hooks.ts";
import type { ChatBlock } from "../../core/model.ts";
import { Alert, AlertDescription, AlertTitle } from "../../ui/Alert.tsx";
import { Button } from "../../ui/Button.tsx";
import { ContextMenu, ContextMenuItem } from "../../ui/ContextMenu.tsx";
import { XCircleIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { reportFailure } from "./report-failure.ts";

/** The turn whose message Retry in new chat sends again. */
export interface RetryInNewChatTarget {
	sessionId: SessionId;
	turnId: TurnId;
}

export interface ChatBannerProps {
	block: Extract<ChatBlock, { kind: "notice" | "error" }>;
	/** Resends the last message. Without it a retryable error has no button. */
	onRetry?: () => void;
	/** The failed turn to send again in a new chat of the same workspace. */
	retryInNewChat?: RetryInNewChatTarget;
}

export interface ChatRetryBannerProps {
	retry: NonNullable<LiveState["retry"]>;
	/** Stops the retrying turn and sends its message again at once. */
	onRetryNow?: () => void;
	/** The failed turn to send again in a new chat of the same workspace. */
	retryInNewChat?: RetryInNewChatTarget;
}

function noticeLine(item: Extract<ChatBlock, { kind: "notice" }>["item"]): string {
	const text = item.text.trim();
	const compacting = /^compacting\b/i.test(text);
	switch (item.notice) {
		case "compacted":
			return text.length === 0 ? "Chat history compacted" : `Chat history compacted. ${text}`;
		case "rate_limit":
			return text.length === 0 ? "Claude Code session limit reached" : text;
		case "model_changed":
			return text.length === 0 ? "Model changed" : text;
		case "session_started":
			return text.length === 0 ? "Session started" : text;
		case "info":
			return compacting ? "Compacting..." : text;
	}
}

/** Starts the turn again in a new chat and opens it. One request at a time starts one chat. */
function RetryInNewChatButton({ target }: { target: RetryInNewChatTarget }) {
	const actions = useActions();
	const navigate = useNavigate();
	const flight = useRef(createSingleFlight()).current;
	const retry = () => {
		void flight.run(`chat:${target.sessionId}:retry-in-new-chat:${target.turnId}`, async () => {
			const result = await actions.sessions.retryInNewChat(target.sessionId, target.turnId);
			if (!result.ok) {
				toastError("Couldn't retry in a new chat", result.error);
				return;
			}
			void navigate({
				search: ((previous: Record<string, unknown>) => ({
					...previous,
					tab: "session",
					sessionId: result.value.id,
				})) as never,
			});
		});
	};
	return (
		<Button variant="secondary" size="sm" onClick={retry}>
			Retry in new chat
		</Button>
	);
}

/** The agent's own retry, with the count and the actions the failed request offers. */
export function ChatRetryBanner({ retry, onRetryNow, retryInNewChat }: ChatRetryBannerProps) {
	return (
		<Alert tone="destructive" icon={<XCircleIcon />}>
			<AlertTitle>
				Something went wrong, retrying {retry.attempt}/{retry.maxAttempts}
			</AlertTitle>
			{retry.error === undefined ? null : (
				<AlertDescription className="select-text">{retry.error}</AlertDescription>
			)}
			<div className="flex flex-wrap items-center gap-2">
				{onRetryNow === undefined ? null : (
					<Button variant="secondary" size="sm" onClick={onRetryNow}>
						Retry now
					</Button>
				)}
				{retryInNewChat === undefined ? null : <RetryInNewChatButton target={retryInNewChat} />}
			</div>
		</Alert>
	);
}

export function ChatBanner({ block, onRetry, retryInNewChat }: ChatBannerProps) {
	const actions = useActions();
	const copy = (text: string) => {
		void reportFailure(actions.app.copyText(text), "Failed to copy message");
	};

	if (block.kind === "notice") {
		return (
			<ContextMenu
				items={
					<ContextMenuItem onSelect={() => copy(noticeLine(block.item))}>
						Copy message
					</ContextMenuItem>
				}
			>
				<p
					role="note"
					data-notice={block.item.notice}
					className="px-4 py-1.5 text-xs text-fg-muted select-text"
				>
					{noticeLine(block.item)}
				</p>
			</ContextMenu>
		);
	}

	const item = block.item;
	const isAuth = item.code === AGENT_ERROR_CODES.authRequired;
	const message =
		item.message.trim().length === 0 ? "This content could not be displayed." : item.message;

	return (
		<ContextMenu
			items={
				<>
					<ContextMenuItem onSelect={() => copy(message)}>Copy error</ContextMenuItem>
					<ContextMenuItem onSelect={() => copy(JSON.stringify(item, null, 2))}>
						Copy details
					</ContextMenuItem>
				</>
			}
		>
			<div>
				<Alert tone="destructive" icon={<XCircleIcon />}>
					<AlertTitle>
						{isAuth ? "Authentication required" : "The agent reported an error"}
					</AlertTitle>
					<AlertDescription>
						<div className="flex flex-col gap-2">
							<span className="select-text">{message}</span>
							<div className="flex items-center gap-2">
								{isAuth ? (
									<Link
										to="/settings/user/$page"
										params={{ page: "agents" }}
										className="inline-flex h-7 items-center rounded-md border border-border-strong px-2.5 text-xs font-book text-fg hover:bg-hover"
									>
										Open agent settings
									</Link>
								) : null}
								{item.retryable && onRetry ? (
									<Button variant="secondary" size="sm" onClick={onRetry}>
										Try again
									</Button>
								) : null}
								{retryInNewChat === undefined ? null : (
									<RetryInNewChatButton target={retryInNewChat} />
								)}
							</div>
						</div>
					</AlertDescription>
				</Alert>
			</div>
		</ContextMenu>
	);
}
