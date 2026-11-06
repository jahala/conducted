/**
 * @feature CHAT-06 User message
 * @feature CHAT-29 Attachment and image viewer: copy, save, open
 * Owns: The user's message in a turn: text, mention chips, attachments and the hover actions.
 * Behaviour: ui-map.md 3.3 (user message: attachments, mention chips, 'Sent via' or 'Sent from
 * another session'; hover actions include revert; 'Message not sent' with Retry and Discard).
 * A chat image has a menu with Save image and Copy image (inventory toast rows 535 to 537), and a
 * click opens the attachment viewer (inventory label rows 343 and 462).
 * Must handle: Not sent (the `failed` prop draws the error state with Retry and Discard, and offers no Revert,
 * because a message that was never sent has nothing to revert to; FailedSends passes it); a very long
 * message collapses with 'Show more'; an image attachment loads its thumbnail through `Platform.fs.assetUrl`, and a
 * file that does not load (gone, or outside the folders the shell serves) shows its name; a video
 * attachment opens the same viewer; mention chips for
 * files and PRs open the file or PR tab; text is selectable and copyable; Revert opens the confirmation
 * dialog instead of changing anything at once.
 * Measured from Conductor 0.92.1 (renderApp @9519197, @9520536): the user's own message is a bubble
 * aligned to the right of the column, at most 576px (768px on windows 1024px and wider), 12px by 16px
 * padding, 4px radius, in the highlight pair (`highlight-surface`, `highlight-fg`); a long message
 * wraps inside it.
 * Test first: A message with two attachment paths renders two attachment items; a failed send shows
 * Retry and Discard; a PR chip opens the PR tab on that number; Revert opens the reset dialog.
 */
import { MENTION_TOKEN, type MentionKind } from "@conducted/protocol";
import type { SessionId } from "@conducted/shared";
import { type ReactNode, useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { isImagePath, isVideoPath } from "../../core/media-files.ts";
import type { ChatTurn } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { ContextMenu, ContextMenuItem } from "../../ui/ContextMenu.tsx";
import { FileIcon, PullRequestIcon } from "../../ui/icons.tsx";
import { AttachmentViewer } from "../file-viewer/AttachmentViewer.tsx";
import { useAttachmentActions } from "../file-viewer/use-attachment-actions.ts";
import { ResetChatDialog } from "./ResetChatDialog.tsx";
import { reportFailure } from "./report-failure.ts";
import { fileNameOf } from "./tools/ToolCardFrame.tsx";
import { useWorkspaceLinks } from "./workspace-links.ts";

const LONG_MESSAGE = 800;

export interface UserMessageProps {
	turn: ChatTurn;
	sessionId: SessionId;
	/** A message the sidecar did not accept. */
	failed?: { message: string; error: string | null } | null;
	onRetry?: () => void;
	onDiscard?: () => void;
}

function AttachmentItem({ path }: { path: string }) {
	const { platform } = useServices();
	const attachmentActions = useAttachmentActions();
	const [failed, setFailed] = useState(false);
	const [viewerOpen, setViewerOpen] = useState(false);
	const name = fileNameOf(path);
	const image = isImagePath(path);
	const video = !image && isVideoPath(path);
	const kind = image ? "image" : video ? "video" : null;

	const figure = (
		<figure
			data-testid="attachment"
			className="flex max-w-56 items-center gap-2 rounded-md border border-border bg-surface px-2 py-1"
		>
			{image && !failed ? (
				<button
					type="button"
					onClick={() => setViewerOpen(true)}
					aria-label={`Open ${name}`}
					className="shrink-0 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
				>
					<img
						src={platform.fs.assetUrl(path)}
						alt={name}
						onError={() => setFailed(true)}
						className="size-8 rounded-sm object-cover"
					/>
				</button>
			) : video ? (
				<button
					type="button"
					onClick={() => setViewerOpen(true)}
					aria-label={`Open ${name}`}
					className="shrink-0 rounded-sm text-fg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
				>
					<FileIcon />
				</button>
			) : (
				<FileIcon className="text-fg-muted" />
			)}
			<figcaption className="truncate font-mono text-2xs text-fg-muted" title={path}>
				{name}
			</figcaption>
		</figure>
	);

	return (
		<>
			{image ? (
				<ContextMenu
					items={
						<>
							<ContextMenuItem onSelect={() => attachmentActions.saveFile(path, "image")}>
								Save image
							</ContextMenuItem>
							<ContextMenuItem onSelect={() => attachmentActions.copyImage(path)}>
								Copy image
							</ContextMenuItem>
						</>
					}
				>
					{figure}
				</ContextMenu>
			) : (
				figure
			)}
			{viewerOpen && kind !== null ? (
				<AttachmentViewer
					path={path}
					fileName={name}
					kind={kind}
					onClose={() => setViewerOpen(false)}
				/>
			) : null}
		</>
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
}: UserMessageProps) {
	const actions = useActions();
	const links = useWorkspaceLinks();
	const message = turn.userMessage;
	const [expanded, setExpanded] = useState(false);
	const [resetOpen, setResetOpen] = useState(false);
	if (message === null) return null;

	const openMention = (kind: MentionKind, value: string) => {
		if (kind === "file") {
			links.openFile(value, "diff");
			return;
		}
		const number = Number(value);
		if (Number.isInteger(number) && number > 0) links.openPullRequest(number);
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
		<div className="group relative flex flex-col items-end gap-1">
			<ContextMenu
				items={
					<ContextMenuItem
						onSelect={() => {
							void reportFailure(actions.app.copyText(message.text), "Couldn't copy the message");
						}}
					>
						Copy message
					</ContextMenuItem>
				}
			>
				<div className="relative max-w-[min(100%,var(--user-bubble-width))] overflow-hidden break-words rounded-sm bg-highlight-surface px-4 py-3 text-sm text-highlight-fg transition-colors duration-300 lg:max-w-[min(100%,var(--user-bubble-width-wide))]">
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
			{failed === null ? (
				<button
					type="button"
					onClick={() => setResetOpen(true)}
					aria-label="Revert to before this message"
					className="absolute -top-2 right-2 rounded-sm bg-canvas/80 px-1 text-2xs text-fg-muted opacity-0 hover:text-fg group-hover:opacity-100 focus-visible:opacity-100"
				>
					Revert
				</button>
			) : null}
			{sender ? <span className="text-2xs text-fg-muted">{sender}</span> : null}
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
			<ResetChatDialog
				open={resetOpen}
				onOpenChange={setResetOpen}
				sessionId={sessionId}
				turnId={turn.turnId}
				busy={turn.outcome === "running"}
			/>
		</div>
	);
}
