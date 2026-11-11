/**
 * @feature CHAT-06 Chat banners; CHAT-27 Visible auto-retry with Retry now
 * Owns: Notices and errors in the list: interrupted, history compacted, compacting, session limit
 * reached, sign-in needed, 'This message could not be displayed.', the agent's own retry progress
 * with Retry now, Retry in new chat on a failed turn, and the views of the error that ended a turn:
 * 'Error: <text>', the context window, the session limit with its reset time and help link, an
 * overloaded server with 'Check Anthropic API status', and an image over the size limit.
 * Behaviour: ui-map.md 3.3 (Banners in the list; 'Something went wrong, retrying n/m' with Retry
 * now while the agent retries by itself; the error card offers Retry in new chat), 7.4 (agent
 * binary and auth problems are shown inline in chat). The turn error views and their words are
 * Conductor's IQi (renderApp @9538488) and GFe (@9534766); GFe's retry button reads 'Retry'.
 * Our design choice: Sign-in and key problems link to the Agents settings page. One auth code covers
 * every agent, so the banner reads the agent and its message and shows Conductor's words for it:
 * "Authentication required" (Claude), "ChatGPT login expired", "Codex authentication required" and
 * "Cursor API key required" (renderApp @9512696, @9542567, @9543489). Retryable errors show
 * 'Retry', which resends the last message. Every error keeps the title 'The agent reported an
 * error' unless Conductor's view has a title of its own, and keeps Retry in new chat, which
 * Conductor leaves off its session limit and image views. Retry in new chat creates the chat and
 * opens it, and one request at a time starts it.
 * Must handle: Each notice kind has its own wording (the protocol's notice kinds: session_started,
 * compacted, rate_limit, model_changed, info); an error with `retryable` false has no retry; an
 * auto-retry line names the attempt and the agent's reason; a retry in a new chat that fails shows
 * a toast; text is selectable; error colour only for real errors, not for notices.
 * Test first: A 'compacted' notice reads as a quiet line; a retryable error shows a Retry
 * button; the retry line names the attempt and Retry now calls back.
 */
import { AGENT_ERROR_CODES, type LiveState } from "@conducted/protocol";
import type { AgentKind, SessionId, TurnId } from "@conducted/shared";
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
import { ExternalLink } from "./ExternalLink.tsx";
import { reportFailure } from "./report-failure.ts";
import { formatResetTime } from "./reset-time.ts";
import type { TurnErrorView } from "./turn-error-view.ts";

/** The turn whose message Retry in new chat sends again. */
export interface RetryInNewChatTarget {
	sessionId: SessionId;
	turnId: TurnId;
}

export interface ChatBannerProps {
	block: Extract<ChatBlock, { kind: "notice" | "error" }>;
	/** The view of the error that ended the turn (turn-error-view.ts). Unset: the block's own error. */
	view?: TurnErrorView;
	/** Resends the last message. Without it a retryable error has no button. */
	onRetry?: () => void;
	/** The failed turn to send again in a new chat of the same workspace. */
	retryInNewChat?: RetryInNewChatTarget;
	/** The chat's agent, so a sign-in error reads as that agent's own (renderApp @9542567). */
	agent?: AgentKind;
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

/** Conductor's titles for the views that carry one (IQi @9538488). Others keep our own title. */
function errorTitle(isAuth: boolean, view: TurnErrorView | undefined): string {
	if (isAuth) return "Authentication required";
	if (view?.kind === "session_limit") return "Claude Code session limit reached";
	if (view?.kind === "image_too_large") return "Image too large";
	return "The agent reported an error";
}

/** The title and help of a sign-in error, in each agent's own words (renderApp @9512696, @9542577, @9543489). */
function authCopy(agent: AgentKind | undefined, message: string): { title: string; body: string | null } {
	const text = message.toLowerCase();
	if (agent === "codex") {
		if (/chatgpt|token.*expired|session.*expired|login expired/.test(text)) {
			return {
				title: "ChatGPT login expired",
				body: "Your ChatGPT login has expired. Reconnect ChatGPT, then send your message again.",
			};
		}
		return {
			title: "Codex authentication required",
			body: "Please configure Codex authentication in Settings to use Codex.",
		};
	}
	if (agent === "cursor") {
		return {
			title: "Cursor API key required",
			body: "Add a Cursor API key in provider settings to use Cursor.",
		};
	}
	return { title: "Authentication required", body: null };
}

const SESSION_LIMIT_NOTE =
	"This limit is imposed by Anthropic and applies to all Claude Code usage.";
const SESSION_LIMIT_HELP =
	"https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan#h_50f6dec29d";
const ANTHROPIC_STATUS = "https://status.anthropic.com/";

/** The words of a turn's error view, in Conductor's wording (IQi @9538488, GFe @9534766). */
function viewText(view: TurnErrorView): string | null {
	switch (view.kind) {
		case "error":
			return `Error: ${view.text}`;
		case "context_window":
			return "Exceeded Claude's context window. Please compact using /compact, or summarize into a new chat.";
		case "overloaded":
			return "Anthropic's API servers are temporarily overloaded. Please try again in a few minutes.";
		case "image_too_large":
			return "Exceeds Claude Code's size limit (5MB). Please revert to a previous user message by hovering over it, otherwise this chat will fail going forward.";
		case "session_limit":
			return `${sessionLimitReset(view.resetsAt)} ${SESSION_LIMIT_NOTE}`;
		case "sign_in":
			return view.text;
		case "interrupted":
			return null;
	}
}

function sessionLimitReset(resetsAt: number | null): string {
	return resetsAt === null
		? "Please try again later."
		: `Your limit will be reset on ${formatResetTime(resetsAt)}.`;
}

export function ChatBanner({ block, view, onRetry, retryInNewChat, agent }: ChatBannerProps) {
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
	const auth = isAuth ? authCopy(agent, item.message) : null;
	const shown = view === undefined ? item.message : (viewText(view) ?? item.message);
	const message =
		auth?.body ?? (shown.trim().length === 0 ? "This message could not be displayed." : shown);
	const openStatus = () => {
		void reportFailure(actions.app.openUrl(ANTHROPIC_STATUS), "Couldn't open the link");
	};

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
					<AlertTitle>{auth?.title ?? errorTitle(isAuth, view)}</AlertTitle>
					<AlertDescription>
						<div className="flex flex-col gap-2">
							<span className="select-text">
								{message}
								{view?.kind === "session_limit" ? (
									<>
										{" "}
										<ExternalLink
											url={SESSION_LIMIT_HELP}
											title="Learn more about Claude Code limits"
											className="font-medium text-fg underline underline-offset-2"
										>
											Learn more about Claude Code limits
										</ExternalLink>
									</>
								) : null}
							</span>
							<div className="flex items-center gap-2">
								{isAuth ? (
									<Link
										to="/settings/user/$page"
										params={{ page: "agents" }}
										className="inline-flex h-7 items-center rounded-md border border-border-strong px-2.5 text-xs font-book text-fg hover:bg-hover"
									>
										Open settings
									</Link>
								) : null}
								{item.retryable && onRetry ? (
									<Button variant="secondary" size="sm" onClick={onRetry}>
										Retry
									</Button>
								) : null}
								{view?.kind === "overloaded" ? (
									<Button variant="secondary" size="sm" onClick={openStatus}>
										Check Anthropic API status
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
