/**
 * @feature NAV-09 Shortcuts dialog
 * Owns: The dialog that lists every shortcut by category, with a search box, and lets the user
 * rebind them.
 * Behaviour: ui-map.md 5.4 (176 entries with id, key, configurable, category, optional when;
 * categories General, View, Navigation, Workspace, Chat, Code review, Terminal; overrides persist;
 * search box 'Search shortcuts...'), 5.2 (dialog 'Keyboard shortcuts').
 * Our design choice: Rows come from the command registry (useCommands), so the dialog, menus,
 * tooltips and palette always agree. A fixed command is listed without an edit control. The
 * search, the rebinding rules and the save are the ones the Settings page uses
 * (useKeybindingEditing), and each row shows the dispatcher's own live binding (`liveBinding`),
 * so the dialog shows the key a press actually runs, send-key swap included.
 * Must handle: Search with no match; a command that cannot be rebound (shown without the edit
 * control); a key already used in the same scope (conflict warning with both names, the user
 * decides); reset one or all; the user's send-key mode swaps the four Enter bindings and the dialog
 * shows the current ones.
 * Test first: Searching 'sidebar' lists the two sidebar toggles; a conflicting binding shows a
 * warning naming the other command.
 */
import { useState } from "react";
import { liveBinding, useSendKeyMode } from "../../app/command-dispatcher.ts";
import { useCommands } from "../../core/hooks.ts";
import { COMMAND_CATEGORIES } from "../../core/registries/commands.ts";
import { Button } from "../../ui/Button.tsx";
import { Dialog, DialogContent } from "../../ui/Dialog.tsx";
import { Input } from "../../ui/Input.tsx";
import type { OverlayProps } from "../../ui/overlay-props.ts";
import {
	matchingCommands,
	useKeybindingEditing,
} from "../settings/keyboard/use-keybinding-editing.ts";
import { KeybindingEditor } from "./KeybindingEditor.tsx";

export function ShortcutsDialog({ open, onOpenChange }: OverlayProps) {
	const commands = useCommands();
	const editing = useKeybindingEditing();
	const { overrides, conflict } = editing;
	const sendKeyMode = useSendKeyMode();
	const [filter, setFilter] = useState("");
	const shown = matchingCommands(commands, filter);

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
						<Button variant="secondary" aria-label="Reset all shortcuts" onClick={editing.resetAll}>
							Reset all
						</Button>
					)}
				</div>
				{editing.overridesError === null ? null : (
					<p role="alert" className="text-xs text-danger">
						{editing.overridesError}
					</p>
				)}
				{editing.saveError === null ? null : (
					<p role="alert" className="text-xs text-danger">
						{editing.saveError}
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
										const current = liveBinding(command.id, overrides, sendKeyMode);
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
															onChange={(keys) =>
																keys === null
																	? editing.clear(command.id)
																	: editing.record(command.id, keys)
															}
														/>
														{changed ? (
															<Button
																variant="ghost"
																size="sm"
																aria-label={`Reset shortcut for ${command.title}`}
																onClick={() => editing.reset(command.id)}
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
														<Button size="sm" variant="destructive" onClick={editing.replace}>
															Replace
														</Button>
														<Button size="sm" variant="secondary" onClick={editing.cancelConflict}>
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
