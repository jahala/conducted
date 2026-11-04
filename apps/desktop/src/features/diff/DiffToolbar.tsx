/**
 * @feature REV-02 Diff toolbar
 * Owns: the controls for how a diff is drawn. Unified or split layout, entire file, hide
 * whitespace changes, wrap lines.
 * Behaviour: ui-map.md 3.2 (File tab: "Unified view", "Split view", "Entire file", "View options"
 * with "Hide whitespace changes" and "Wrap lines"). Preferences are user settings (keys
 * using_split_view, hide_whitespace_changes, wrap_lines in services-map.md 4.2.3).
 * Must handle: a narrow tab (split layout disabled below a width threshold, Our design choice), a
 * binary file (controls disabled), and changing a preference while a diff is loading.
 * Test first: toggling "Wrap lines" calls onChange with wrapLines flipped and nothing else changed.
 */
import { notImplemented } from "@conducted/shared";
import type { DiffPreferences } from "./diff-types.ts";

export interface DiffToolbarProps {
	preferences: DiffPreferences;
	onChange: (next: DiffPreferences) => void;
	disabled: boolean;
}

export function DiffToolbar(_props: DiffToolbarProps): never {
	return notImplemented("REV-02");
}
