/**
 * @feature NAV-10 Rename dialog
 * Owns: One small dialog to rename a workspace or a chat.
 * Behaviour: ui-map.md 3.10 and 5.2 ('Rename workspace', 'Rename chat').
 * Must handle: Empty name (submit disabled; for a workspace, clearing the name returns to the
 * automatic name); Enter submits; Escape closes; the action fails (error under the field, dialog
 * stays open); the current name is selected on open.
 * Test first: Submitting 'Fix login' calls onSubmit('Fix login'); an empty field disables the
 * submit button.
 */
import { notImplemented } from "@conducted/shared";

export interface RenameDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	initialName: string;
	onSubmit: (name: string) => Promise<void>;
}

export function RenameDialog(_props: RenameDialogProps): never {
	return notImplemented("NAV-10");
}
