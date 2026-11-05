/**
 * @feature CHAT-06 User message
 * Owns: The user's message in a turn: text, mention chips, attachments and the hover actions.
 * Behaviour: ui-map.md 3.3 (user message: attachments, mention chips, 'Sent via' or 'Sent from
 * another session'; hover actions include revert; 'Message not sent' with Retry and Discard).
 * Must handle: Not sent (error state with Retry and Discard); a very long message collapses with
 * 'Show more'; image attachments show a thumbnail and a missing file shows its name; mention chips
 * for files and PRs open the file or PR tab; text is selectable and copyable.
 * Test first: A message with two attachment paths renders two attachment items; a failed send shows
 * Retry and Discard.
 */
import { MENTION_TOKEN, type MentionKind } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useActions } from "../../core/hooks.ts";
import type { ChatTurn } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { ContextMenu, ContextMenuItem } from "../../ui/ContextMenu.tsx";
import { FileIcon, PullRequestIcon } from "../../ui/icons.tsx";

const LONG_MESSAGE = 800;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

export interface UserMessageProps {
	turn: ChatTurn;
	sessionId: SessionId;
	/** A message the sidecar did not accept. */
	failed?: { message: string; error: string | null } | null;
	onRetry?: () => void;
	onDiscard?: () => void;
	onRevert?: () => void;
}

function baseName(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts.at(-1) ?? path;
}

function AttachmentItem({ path }: { path: string }) {
	const [failed, setFailed] = useState(false);
	const name = baseName(path);
	const image = IMAGE.test(path);
	return (
		<figure
			data-testid="attachment"
			className="flex max-w-56 items-center gap-2 rounded-md border border-border bg-surface px-2 py-1"
		>
			{image && !failed ? (
				<img
					src={path}
					alt={name}
					onError={() => setFailed(true)}
					className="size-8 rounded-sm object-cover"
				/>
			) : (
				<FileIcon className="text-fg-muted" />
			)}
			<figcaption className="truncate font-mono text-2xs text-fg-muted" title={path}>
				{name}
			</figcaption>
		</figure>
	);
}

function mentionChips(
	text: string,
	onOpen: (kind: MentionKind, value: string) => void,
): ReactNode[] {
	const nodes: ReactNode[] = [];
	let last = 0;
	let index = 0;
	for (const match of text.matchAll(MENTION_TOKEN)) {
		const at = match.index ?? 0;
		if (at > last) nodes.push(text.slice(last, at));
		const kind = match[1] as MentionKind;
		const value = match[2] ?? "";
		nodes.push(
			<button
				key={`mention-${index}`}
				type="button"
				onClick={() => onOpen(kind, value)}
				className="mx-0.5 inline-flex items-center gap-1 rounded-sm bg-muted px-1 py-0.5 font-mono text-2xs text-fg hover:bg-hover"
			>
				{kind === "pr" ? <PullRequestIcon /> : <FileIcon />}
				{kind === "pr" ? `PR #${value}` : value}
			</button>,
		);
		last = at + match[0].length;
		index += 1;
	}
	if (last < text.length) nodes.push(text.slice(last));
	return nodes;
}

export function UserMessage({
	turn,
	sessionId,
	failed = null,
	onRetry,
	onDiscard,
	onRevert,
}: UserMessageProps) {
	const actions = useActions();
	const navigate = useNavigate();
	const message = turn.userMessage;
	const [expanded, setExpanded] = useState(false);
	if (message === null) return null;

	const openMention = (kind: MentionKind, value: string) => {
		if (kind === "file") {
			void navigate({
				search: ((previous: Record<string, unknown>) => ({
					...previous,
					tab: "file",
					path: value,
					fileMode: "diff",
				})) as never,
			});
			return;
		}
		void navigate({
			search: ((previous: Record<string, unknown>) => ({
				...previous,
				tab: "pr",
			})) as never,
		});
	};

	const revert = () => {
		if (onRevert !== undefined) {
			onRevert();
			return;
		}
		void actions.sessions.revertTo(sessionId, turn.turnId);
	};

	const tooLong = message.text.length > LONG_MESSAGE && !expanded;
	const shown = tooLong ? `${message.text.slice(0, LONG_MESSAGE)}…` : message.text;
	const sender =
		message.sender === null
			? null
			: message.sender.kind === "claude_ai"
				? "Sent via Claude"
				: "Sent from another session";

	return (
		<div className="group flex flex-col items-end gap-1">
			<ContextMenu
				items={
					<ContextMenuItem
						onSelect={() => {
							void actions.app.copyText(message.text);
						}}
					>
						Copy message
					</ContextMenuItem>
				}
			>
				<div className="max-w-[min(100%,36rem)] rounded-xl bg-surface px-4 py-3 text-sm text-fg shadow-xs">
					<p className="whitespace-pre-wrap break-words select-text">
						{mentionChips(shown, openMention)}
					</p>
					{tooLong ? (
						<button
							type="button"
							onClick={() => setExpanded(true)}
							className="mt-1 text-xs font-medium text-link hover:underline"
						>
							Show more
						</button>
					) : null}
					{message.attachmentPaths.length > 0 ? (
						<div className="mt-2 flex flex-wrap justify-end gap-1">
							{message.attachmentPaths.map((path) => (
								<AttachmentItem key={path} path={path} />
							))}
						</div>
					) : null}
				</div>
			</ContextMenu>
			<div className="flex items-center gap-2 text-2xs text-fg-subtle">
				{sender ? <span>{sender}</span> : null}
				<button
					type="button"
					onClick={revert}
					aria-label="Revert to before this message"
					className="rounded-sm px-1 text-2xs text-fg-subtle opacity-0 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
				>
					Revert
				</button>
			</div>
			{failed !== null ? (
				<div className="flex flex-wrap items-center justify-end gap-2 rounded-md border border-danger bg-surface px-2 py-1.5 text-xs">
					<span className="font-medium text-danger">{failed.message}</span>
					{failed.error ? <span className="text-fg-muted">{failed.error}</span> : null}
					<Button variant="secondary" size="xs" onClick={onRetry}>
						Retry
					</Button>
					<Button variant="ghost" size="xs" onClick={onDiscard}>
						Discard
					</Button>
				</div>
			) : null}
		</div>
	);
}
