/**
 * @feature REV-01 Changed folder row
 * Owns: one folder line in the folder view of the Changes list, with its name, a chevron, and the
 * total added and removed lines below it.
 * Behaviour: ui-map.md 3.6 ("Show folder hierarchy").
 * Must handle: a chain of single-child folders shown as one row ("src/features/diff"), expand and
 * collapse by click and by arrow keys, and the folder total updating as files are marked viewed.
 * Test first: a folder with two files shows the sum of their line counts.
 */
import { notImplemented } from "@conducted/shared";

export interface ChangedFolderRowProps {
	name: string;
	depth: number;
	collapsed: boolean;
	linesAdded: number;
	linesRemoved: number;
	onToggle: () => void;
}

export function ChangedFolderRow(_props: ChangedFolderRowProps): never {
	return notImplemented("REV-01");
}
