/**
 * @feature NAV-09 Rebinding shortcuts, shared by the dialog and Settings
 * Owns: the one set of rebinding rules the Keyboard shortcuts dialog and the Settings page both
 * use: the search over the command list, recording a combination (refused when it does not parse
 * or is reserved, held as a conflict when another command in its scope has it), Replace and
 * Cancel for a conflict, clearing, resetting one command or all, and saving the overrides.
 * Behaviour: ui-map.md 5.4 (rebinding with conflict detection per scope; reserved keys; overrides
 * stored under a versioned key). The rules themselves are the registry's: `reservedCommand` and
 * `findShortcutConflicts` in core/registries/commands.ts.
 * Must handle: an empty recording (the command is unbound), a combination that does not parse
 * (its error is shown), a reserved key ("<keys> is reserved for <command>.", nothing saved), a
 * conflict (nothing saved until Replace, which takes the keys off the other command in the same
 * write), and a save that fails (its message is shown).
 * Test first: recording Cmd+Q for a configurable command is refused and nothing is saved.
 */
import { useState } from "react";
import type { CommandEntry } from "../../../core/api.ts";
import { useActions, useShortcutOverrides } from "../../../core/hooks.ts";
import {
	COMMANDS,
	findShortcutConflicts,
	formatShortcut,
	getCommand,
	parseShortcut,
	reservedCommand,
	type ShortcutOverrides,
	withShortcutOverrides,
} from "../../../core/registries/commands.ts";

const SETTING_KEY = "keybinding_overrides_v1";

/**
 * The app's own commands, whose keys (Cmd+, and Cmd+Q) no other command may take. The Rust menu
 * handles both, so no handler in the web view names them.
 */
const APP_RESERVED_COMMANDS: ReadonlySet<string> = new Set(["app.openSettings", "app.quit"]);

export interface KeybindingConflict {
	commandId: string;
	combination: string;
	otherId: string;
	otherTitle: string;
}

/** The overrides with `combination` bound to `commandId` and taken off the command that had it. */
function replaceBinding(
	overrides: ShortcutOverrides,
	commandId: string,
	combination: string,
	otherId: string,
): ShortcutOverrides {
	const clash = formatShortcut(combination);
	const other = withShortcutOverrides(COMMANDS, overrides).find(
		(command) => command.id === otherId,
	);
	const kept = (other?.defaultShortcuts ?? []).filter((spec) => formatShortcut(spec) !== clash);
	return { ...overrides, [commandId]: [combination], [otherId]: kept };
}

/** Why `combination` cannot be bound to `commandId`, or null when it can. */
export function keybindingRefusal(combination: string, commandId: string): string | null {
	const parsed = parseShortcut(combination);
	if (!parsed.ok) return parsed.error.message;
	const reserved = reservedCommand(combination, commandId, APP_RESERVED_COMMANDS);
	return reserved === null
		? null
		: `${formatShortcut(combination)} is reserved for ${reserved.title}.`;
}

/** The commands whose name, category or id contains the search text. */
export function matchingCommands(
	commands: readonly CommandEntry[],
	filter: string,
): CommandEntry[] {
	const needle = filter.trim().toLowerCase();
	if (needle === "") return [...commands];
	return commands.filter(
		(command) =>
			command.title.toLowerCase().includes(needle) ||
			command.category.toLowerCase().includes(needle) ||
			command.id.toLowerCase().includes(needle),
	);
}

export interface KeybindingEditing {
	overrides: ShortcutOverrides;
	/** The saved overrides could not be read. */
	overridesError: string | null;
	conflict: KeybindingConflict | null;
	/** Why the last recording or save did not happen. */
	saveError: string | null;
	/** Binds the recorded combination; "" unbinds the command. */
	record: (commandId: string, combination: string) => void;
	clear: (commandId: string) => void;
	reset: (commandId: string) => void;
	resetAll: () => void;
	/** Binds the conflicting keys here and takes them off the other command. */
	replace: () => void;
	cancelConflict: () => void;
	/** Forgets the last conflict and error, when a new recording starts. */
	dismiss: () => void;
}

export function useKeybindingEditing(): KeybindingEditing {
	const { overrides, error } = useShortcutOverrides();
	const actions = useActions();
	const [conflict, setConflict] = useState<KeybindingConflict | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);

	const persist = async (next: ShortcutOverrides) => {
		const text = Object.keys(next).length === 0 ? "" : JSON.stringify(next);
		const saved = await actions.settings.set(SETTING_KEY, text);
		setSaveError(saved.ok ? null : saved.error.message);
	};

	const record = (commandId: string, combination: string) => {
		setConflict(null);
		setSaveError(null);
		if (combination === "") {
			void persist({ ...overrides, [commandId]: [] });
			return;
		}
		const refusal = keybindingRefusal(combination, commandId);
		if (refusal !== null) {
			setSaveError(refusal);
			return;
		}
		if (getCommand(commandId) === undefined) return;
		const next: ShortcutOverrides = { ...overrides, [commandId]: [combination] };
		const found = findShortcutConflicts(withShortcutOverrides(COMMANDS, next)).find((clash) =>
			clash.ids.includes(commandId),
		);
		if (found !== undefined) {
			const otherId = found.ids[0] === commandId ? found.ids[1] : found.ids[0];
			setConflict({
				commandId,
				combination,
				otherId,
				otherTitle: getCommand(otherId)?.title ?? otherId,
			});
			return;
		}
		void persist(next);
	};

	return {
		overrides,
		overridesError: error?.message ?? null,
		conflict,
		saveError,
		record,
		clear: (commandId) => {
			setSaveError(null);
			void persist({ ...overrides, [commandId]: [] });
		},
		reset: (commandId) => {
			const next = { ...overrides };
			delete next[commandId];
			setSaveError(null);
			void persist(next);
		},
		resetAll: () => {
			setSaveError(null);
			void persist({});
		},
		replace: () => {
			if (conflict === null) return;
			setConflict(null);
			void persist(
				replaceBinding(overrides, conflict.commandId, conflict.combination, conflict.otherId),
			);
		},
		cancelConflict: () => setConflict(null),
		dismiss: () => {
			setConflict(null);
			setSaveError(null);
		},
	};
}
