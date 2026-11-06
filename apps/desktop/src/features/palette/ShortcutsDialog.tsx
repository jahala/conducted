/**
 * @feature NAV-09 Shortcuts dialog
 * Owns: The dialog that lists every shortcut by category, with a search box, and lets the user
 * rebind them.
 * Behaviour: ui-map.md 5.4 (176 entries with id, key, configurable, category, optional when;
 * categories General, View, Navigation, Workspace, Chat, Code review, Terminal; overrides persist;
 * search box 'Search shortcuts...'), 5.2 (dialog 'Keyboard shortcuts').
 * Our design choice: Rows come from the command registry (useCommands), so the dialog, menus,
 * tooltips and palette always agree. A fixed command is listed without an edit control.
 * Must handle: Search with no match; a command that cannot be rebound (shown without the edit
 * control); a key already used in the same scope (conflict warning with both names, the user
 * decides); reset one or all; the user's send-key mode swaps the four Enter bindings and the dialog
 * shows the current ones.
 * Test first: Searching 'sidebar' lists the two sidebar toggles; a conflicting binding shows a
 * warning naming the other command.
 */
import { useState } from "react";
import { useActions, useCommands, useSetting, useShortcutOverrides } from "../../core/hooks.ts";
import {
	COMMAND_CATEGORIES,
	COMMANDS,
	effectiveShortcuts,
	findShortcutConflicts,
	formatShortcut,
	getCommand,
	parseShortcut,
	type ShortcutOverrides,
	withShortcutOverrides,
} from "../../core/registries/commands.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent } from "../../ui/Dialog.tsx";
import { Input } from "../../ui/Input.tsx";
import type { OverlayProps } from "../../ui/overlay-props.ts";
import { KeybindingEditor } from "./KeybindingEditor.tsx";

const SETTING_KEY = "keybinding_overrides_v1";

/** COMP-01's swap, shown here only. The dispatcher still decides what a key press means. */
const SEND_KEY_MODE_SHORTCUTS: Readonly<Record<string, string>> = {
	"chat.newLine": "Enter",
	"chat.submit": "Cmd+Enter",
	"chat.submitOpposite": "Alt+Enter",
	"chat.question.submit": "Cmd+Enter",
};

interface Conflict {
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

/** The live binding as the registry writes it, before the display swap. */
function rawShortcut(commandId: string, overrides: ShortcutOverrides): string | null {
	const command = getCommand(commandId);
	if (command === undefined) return null;
	return effectiveShortcuts(command, overrides)[0] ?? null;
}

/** The binding to show: the user's own, or the one the send-key mode gives a chat command. */
function shownShortcut(
	commandId: string,
	overrides: ShortcutOverrides,
	sendKeyMode: string,
): string | null {
	const raw = rawShortcut(commandId, overrides);
	if (raw === null) return null;
	if (sendKeyMode !== "cmd-enter" || overrides[commandId] !== undefined) return raw;
	return SEND_KEY_MODE_SHORTCUTS[commandId] ?? raw;
}

export function ShortcutsDialog({ open, onOpenChange }: OverlayProps) {
	const commands = useCommands();
	const { overrides, error: overridesError } = useShortcutOverrides();
	const sendKeyMode = useSetting<string>("message_send_key");
	const actions = useActions();
	const [filter, setFilter] = useState("");
	const [conflict, setConflict] = useState<Conflict | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);

	const persist = async (next: ShortcutOverrides) => {
		const text = Object.keys(next).length === 0 ? "" : JSON.stringify(next);
		const saved = await actions.settings.set(SETTING_KEY, text);
		setSaveError(saved.ok ? null : saved.error.message);
	};

	const record = (commandId: string, combination: string | null) => {
		setConflict(null);
		setSaveError(null);
		if (combination === null) {
			void persist({ ...overrides, [commandId]: [] });
			return;
		}
		const parsed = parseShortcut(combination);
		if (!parsed.ok) {
			setSaveError(parsed.error.message);
			return;
		}
		const command = getCommand(commandId);
		if (command === undefined) return;
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

	const reset = (commandId: string) => {
		const next = { ...overrides };
		delete next[commandId];
		setSaveError(null);
		void persist(next);
	};

	const resetAll = () => {
		setSaveError(null);
		void persist({});
	};

	const needle = filter.trim().toLowerCase();
	const shown = commands.filter(
		(command) =>
			needle === "" ||
			command.title.toLowerCase().includes(needle) ||
			command.category.toLowerCase().includes(needle) ||
			command.id.toLowerCase().includes(needle),
	);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Keyboard shortcuts"
				description="Every command and the keys that run it. Changes take effect at once."
				size="2xl"
			>
				<div className="flex items-center gap-2">
					<Input
						type="search"
						aria-label="Search shortcuts"
						placeholder="Search shortcuts..."
						value={filter}
						onChange={(event) => setFilter(event.target.value)}
						className="flex-1"
					/>
					{Object.keys(overrides).length === 0 ? null : (
						<Button variant="secondary" aria-label="Reset all shortcuts" onClick={resetAll}>
							Reset all
						</Button>
					)}
				</div>
				{overridesError === null ? null : (
					<p role="alert" className="text-xs text-danger">
						{overridesError.message}
					</p>
				)}
				{saveError === null ? null : (
					<p role="alert" className="text-xs text-danger">
						{saveError}
					</p>
				)}
				<div className="min-h-0 flex-1 overflow-y-auto pr-1">
					{shown.length === 0 ? (
						<p role="status" className="text-sm text-fg-muted">
							No shortcuts match your search.
						</p>
					) : (
						COMMAND_CATEGORIES.map((category) => {
							const entries = shown.filter((command) => command.category === category);
							if (entries.length === 0) return null;
							return (
								<section key={category} className="flex flex-col">
									<h2 className="pb-1 text-sm font-medium text-fg">{category}</h2>
									{entries.map((command) => {
										const current = shownShortcut(command.id, overrides, sendKeyMode);
										const changed = overrides[command.id] !== undefined;
										return (
											<div key={command.id}>
												<fieldset
													aria-label={command.title}
													className="m-0 flex min-w-0 items-center justify-between gap-4 border-x-0 border-b-0 border-t border-border p-0 py-2"
												>
													<div className="flex min-w-0 flex-col gap-0.5">
														<p className="text-sm text-fg">{command.title}</p>
														<p className="text-xs text-fg-subtle">{command.category}</p>
													</div>
													<div className="flex shrink-0 items-center gap-2">
														<KeybindingEditor
															commandId={command.id}
															current={current}
															onChange={(keys) => record(command.id, keys)}
														/>
														{changed ? (
															<Button
																variant="ghost"
																size="sm"
																aria-label={`Reset shortcut for ${command.title}`}
																onClick={() => reset(command.id)}
															>
																Reset
															</Button>
														) : null}
													</div>
												</fieldset>
												{conflict?.commandId === command.id ? (
													<div className="flex flex-wrap items-center gap-2 pb-2">
														<p role="alert" className="text-xs text-danger">
															Already used by {conflict.otherTitle}.
														</p>
														<Button
															size="sm"
															variant="destructive"
															onClick={() => {
																const pending = conflict;
																setConflict(null);
																void persist(
																	replaceBinding(
																		overrides,
																		pending.commandId,
																		pending.combination,
																		pending.otherId,
																	),
																);
															}}
														>
															Replace
														</Button>
														<Button size="sm" variant="secondary" onClick={() => setConflict(null)}>
															Cancel
														</Button>
													</div>
												) : null}
											</div>
										);
									})}
								</section>
							);
						})
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
