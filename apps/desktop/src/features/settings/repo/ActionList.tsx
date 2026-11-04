/**
 * @feature SET-07 Action list
 * Owns: the list of actions on the Actions page with icon, name, command, source marker, default
 * marker and row actions.
 * Behaviour: ui-map.md 6, "Actions page"; services-map.md 5A.1.6.
 * Must handle: a long command (one line, truncated), reorder (the default is the first marked,
 * ordering is the file order), source "shared" versus "personal", hidden actions shown muted, and
 * empty list (the parent shows the empty state).
 * Test first: a shared action shows Hide but not Delete, and a personal one shows Delete.
 */
import { notImplemented } from "@conducted/shared";

export interface ActionListItem {
	id: string;
	label: string;
	command: string;
	icon: string | null;
	isDefault: boolean;
	source: "shared" | "personal";
	hidden: boolean;
}

export interface ActionListProps {
	items: ActionListItem[];
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
	onToggleHidden: (id: string, hidden: boolean) => void;
	onSetDefault: (id: string) => void;
}

export function ActionList(_props: ActionListProps): never {
	return notImplemented("SET-07");
}
