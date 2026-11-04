/**
 * @feature REV-06 File tree row
 * Owns: one row of the file tree. Indent, chevron for folders, file icon by type, name, and a
 * change marker when the file differs from the target branch.
 * Behaviour: ui-map.md 3.6 ("file tree with Material file icons, virtualised"). Icons: Conductor
 * uses a Material icon set; which set we ship is an open question (licence check, backlog APP-05).
 * Must handle: a folder with thousands of children, a long name (end truncation keeps the
 * extension visible), keyboard focus ring, right-click opening the row menu, double-click
 * opening the file, and a changed file inside a collapsed folder (the folder shows a marker too).
 * Test first: a changed file row renders the change marker, an unchanged one does not.
 */
import { notImplemented } from "@conducted/shared";

export interface FileTreeRowProps {
	name: string;
	path: string;
	depth: number;
	isDirectory: boolean;
	expanded: boolean;
	selected: boolean;
	changed: boolean;
	onToggle: () => void;
	onOpen: () => void;
}

export function FileTreeRow(_props: FileTreeRowProps): never {
	return notImplemented("REV-06");
}
