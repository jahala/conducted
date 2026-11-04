/**
 * @feature SET-07 Action icon picker
 * Owns: a searchable grid of icons for an action.
 * Behaviour: ui-map.md 3.7 (icon picker: "Search icons", "No icons found"); icons come from the
 * icon set the UI kit uses (Lucide, ui-map.md 8).
 * Must handle: no match (designed empty text), keyboard selection, the current icon marked, and a
 * stored icon name that no longer exists (shown as the default icon, reported in the log).
 * Test first: searching "play" narrows the grid to icons whose name contains it.
 */
import { notImplemented } from "@conducted/shared";

export interface ActionIconPickerProps {
	selected: string | null;
	onSelect: (iconName: string) => void;
}

export function ActionIconPicker(_props: ActionIconPickerProps): never {
	return notImplemented("SET-07");
}
