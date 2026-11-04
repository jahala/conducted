/**
 * @feature SET-02 Keyboard shortcuts settings page
 * Owns: the Keyboard shortcuts page of Settings: every command with its shortcut, search, and
 * rebinding.
 * Behaviour: ui-map.md 5.4 (the shortcut list, 176 in Conductor) and 6 (page in Personal group).
 * One command registry feeds menus, palette, this page and the shortcut dialog (structure-map.md
 * 3.2), so this page only lists and edits what the registry holds.
 * Data: useCommands() (id, title, category, shortcut, defaultShortcut, enabled). Overrides are
 * saved with useActions().settings.set("keybinding_overrides_v1", ...). "Reset" restores
 * `defaultShortcut`.
 * Children: keyboard/ShortcutRow, keyboard/ShortcutRecorder. The clash rule is
 * findShortcutConflicts in core/registries/commands.ts: the page passes the table with the edit
 * applied and reads the pairs that name the edited command.
 * Must handle: a filter with no match, a clash with another command (the recorder names it and
 * offers to replace or cancel), a system-reserved shortcut (refused), unbinding a command, reset
 * of one command and of all, a command that is disabled in this context (shown muted), and
 * grouping by category.
 * Test first: recording "Cmd+K" for a command that another command uses reports that command.
 */
import { notImplemented } from "@conducted/shared";

export function KeyboardShortcutsPage(): never {
	return notImplemented("SET-02");
}
