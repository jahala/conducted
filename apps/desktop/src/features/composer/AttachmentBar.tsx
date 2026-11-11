/**
 * @feature COMP-07 Attachment bar
 * Owns: the row of file chips above the editor, each removable, and the row that says a copy is
 * still running.
 * Behaviour: ui-map.md 3.5 (attachments), 3.3 ('Image too large' is reported by the add path).
 * Our design choice: a chip carries the file's name and a type icon, and no thumbnail yet.
 * `Platform.fs.assetUrl` can load a staged image now; showing one is a visible change to settle
 * against Conductor first.
 * Must handle: no attachments (renders nothing); many attachments (wrap); remove by keyboard (the
 * chip's button); a copy in progress (a status row named 'Loading attachment').
 * Test first: two attachments render two removable items; removing one updates the draft.
 */
import type { SessionId } from "@conducted/shared";
import { IconButton } from "../../ui/IconButton.tsx";
import { CloseIcon, FileIcon } from "../../ui/icons.tsx";

export interface AttachmentBarProps {
	sessionId: SessionId;
	attachmentPaths: readonly string[];
	busy?: boolean;
	onRemove: (path: string) => void;
}

const fileName = (path: string): string => path.split("/").pop() ?? path;

export function AttachmentBar({
	sessionId,
	attachmentPaths,
	busy = false,
	onRemove,
}: AttachmentBarProps) {
	if (attachmentPaths.length === 0 && !busy) return null;
	return (
		<ul
			aria-label="Attachments"
			data-session-id={sessionId}
			className="flex flex-wrap items-center gap-1 px-2 pt-2"
		>
			{attachmentPaths.map((path) => (
				<li
					key={path}
					className="flex max-w-64 items-center gap-1 rounded-md border border-border bg-muted py-0.5 pl-1.5 pr-0.5 text-xs text-fg"
				>
					<FileIcon width={12} height={12} className="shrink-0 text-fg-muted" />
					<span className="truncate">{fileName(path)}</span>
					<IconButton
						size="xs"
						label={`Remove ${fileName(path)}`}
						icon={<CloseIcon width={12} height={12} />}
						onClick={() => onRemove(path)}
					/>
				</li>
			))}
			{busy ? (
				<li
					role="status"
					aria-label="Loading attachment"
					className="flex items-center gap-1.5 px-1 text-xs text-fg-muted"
				>
					<span className="size-3 animate-spin rounded-full border border-border-strong border-t-accent" />
					Copying attachment…
				</li>
			) : null}
		</ul>
	);
}
