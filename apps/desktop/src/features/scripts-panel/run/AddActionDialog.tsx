/**
 * @feature SET-07 Add or edit action dialog
 * Owns: the dialog for creating or editing a run action: name, command, folder, icon, default
 * flag. Used by the Run tab and by the repository Actions settings page.
 * Behaviour: ui-map.md 3.7 (Add-action dialog: "Action name", "Can run in", icon picker with
 * search); services-map.md 5A.1.6 (action fields: command, args, options.cwd, default, icon, hide;
 * ids are normalised; labels come from the id; the shared file is read-only, the personal file is
 * written). "Can run in" is a cloud choice and is left out.
 * Children: ActionIconPicker.
 * Must handle: an empty name or command (Save disabled), a name that normalises to an existing id
 * (error naming the clash), a working folder with $VARIABLES (checked for known names), saving to
 * the personal file when the shared file is read-only, and a save failure (dialog stays open).
 * Test first: two names that normalise to the same id show the clash and disable Save.
 */
import { notImplemented } from "@conducted/shared";

export interface ActionDraft {
	/** Null while creating. */
	id: string | null;
	name: string;
	command: string;
	cwd: string;
	icon: string | null;
	isDefault: boolean;
}

export interface AddActionDialogProps {
	open: boolean;
	initial: ActionDraft;
	existingIds: readonly string[];
	onOpenChange: (open: boolean) => void;
	onSave: (draft: ActionDraft) => Promise<boolean>;
}

export function AddActionDialog(_props: AddActionDialogProps): never {
	return notImplemented("SET-07");
}
