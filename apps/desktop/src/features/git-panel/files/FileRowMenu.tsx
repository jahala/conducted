/**
 * @feature REV-06 File row menu
 * Owns: the context menu of a file row, shared by the All files tab (FileTreeRow) and the Changes
 * list (changes/ChangedFileRow), with the one discard confirm both use.
 * Behaviour: ui-map.md 3.6, "All files" paragraph. Items: View, Attach in chat, Copy path, Copy
 * relative path, Discard changes.
 * Must handle: Discard changes shown only for changed files, with a confirm step because it cannot
 * be undone; Attach in chat disabled with a reason when no chat is open; folders get no View and no
 * Discard (Attach still works); a menu opened on an archived workspace offers only the copy items;
 * a callback the caller leaves out hides that item instead of doing nothing.
 * Test first: for an unchanged file the menu has no "Discard changes" item.
 */
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../../../ui/Button.tsx";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../../../ui/ContextMenu.tsx";
import { Dialog, DialogContent, DialogFooter } from "../../../ui/Dialog.tsx";

export interface FileRowMenuProps {
	path: string;
	isDirectory: boolean;
	changed: boolean;
	hasActiveChat: boolean;
	/** The workspace's worktree is gone, so only the copy items work. */
	archived?: boolean;
	/** The row itself, which opens the menu on right click. */
	children: ReactElement;
	onView?: () => void;
	onAttachInChat?: () => void;
	onCopyPath?: (kind: "absolute" | "relative") => void;
	onDiscard?: () => void;
}

export function FileRowMenu({
	path,
	isDirectory,
	changed,
	hasActiveChat,
	archived = false,
	children,
	onView,
	onAttachInChat,
	onCopyPath,
	onDiscard,
}: FileRowMenuProps) {
	const [confirmDiscard, setConfirmDiscard] = useState(false);
	const canView = !isDirectory && !archived && onView !== undefined;
	const canAttach = !archived && onAttachInChat !== undefined;
	const canDiscard = !isDirectory && changed && !archived && onDiscard !== undefined;
	const attachDisabled = !hasActiveChat;
	const items = (
		<>
			{canView ? <ContextMenuItem onSelect={onView}>View</ContextMenuItem> : null}
			{canAttach ? (
				<ContextMenuItem
					disabled={attachDisabled}
					title={attachDisabled ? "Open a chat first." : undefined}
					onSelect={onAttachInChat}
				>
					Attach in chat
				</ContextMenuItem>
			) : null}
			{onCopyPath !== undefined ? (
				<>
					<ContextMenuItem onSelect={() => onCopyPath("absolute")}>Copy path</ContextMenuItem>
					<ContextMenuItem onSelect={() => onCopyPath("relative")}>
						Copy relative path
					</ContextMenuItem>
				</>
			) : null}
			{canDiscard ? (
				<>
					<ContextMenuSeparator />
					<ContextMenuItem destructive onSelect={() => setConfirmDiscard(true)}>
						Discard changes
					</ContextMenuItem>
				</>
			) : null}
		</>
	);

	return (
		<>
			<ContextMenu items={items}>{children}</ContextMenu>
			<Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
				<DialogContent title="Discard file changes?" size="md">
					<p className="text-sm text-fg-muted">
						This puts {path} back to the target branch. It cannot be undone.
					</p>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmDiscard(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								setConfirmDiscard(false);
								onDiscard?.();
							}}
						>
							Discard
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
