/**
 * @feature CHAT-06 Chat banners
 * Owns: Notices and errors in the list: interrupted, history compacted, compacting, session limit
 * reached, sign-in needed, image too large, 'This message could not be displayed.'.
 * Behaviour: ui-map.md 3.3 (Banners in the list), 7.4 (agent binary and auth problems are shown
 * inline in chat).
 * Our design choice: Sign-in and key problems link to the Agents settings page and show the agent's
 * own message, which names the problem. Retryable errors show 'Try again', which resends the last
 * message.
 * Must handle: Each notice kind has its own wording (the protocol's notice kinds: session_started,
 * compacted, rate_limit, model_changed, info); an error with `retryable` false has no retry; text
 * is selectable; error colour only for real errors, not for notices.
 * Test first: A 'compacted' notice reads as a quiet line; a retryable error shows a Try again
 * button.
 */
import { AGENT_ERROR_CODES } from "@conducted/protocol";
import { Link } from "@tanstack/react-router";
import { useActions } from "../../core/hooks.ts";
import type { ChatBlock } from "../../core/model.ts";
import { Alert, AlertDescription, AlertTitle } from "../../ui/Alert.tsx";
import { Button } from "../../ui/Button.tsx";
import { ContextMenu, ContextMenuItem } from "../../ui/ContextMenu.tsx";
import { XCircleIcon } from "../../ui/icons.tsx";

export interface ChatBannerProps {
	block: Extract<ChatBlock, { kind: "notice" | "error" }>;
	/** Resends the last message. Without it a retryable error has no button. */
	onRetry?: () => void;
}

function noticeLine(item: Extract<ChatBlock, { kind: "notice" }>["item"]): string {
	const text = item.text.trim();
	const compacting = /compact/i.test(text);
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

export function ChatBanner({ block, onRetry }: ChatBannerProps) {
	const actions = useActions();
	const copy = (text: string) => {
		void actions.app.copyText(text);
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
		item.message.trim().length === 0 ? "This message could not be displayed." : item.message;

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
										to="/settings/$page"
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
							</div>
						</div>
					</AlertDescription>
				</Alert>
			</div>
		</ContextMenu>
	);
}
