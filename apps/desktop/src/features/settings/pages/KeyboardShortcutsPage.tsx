/**
 * @feature SET-02 Keyboard shortcuts settings page
 * Owns: the Keyboard shortcuts page of Settings: every command with its shortcut, search, and
 * rebinding.
 * Behaviour: ui-map.md 5.4 (the shortcut list) and 6 (page in the Personal group). One command
 * registry feeds menus, the palette, this page and the shortcut dialog, so this page only lists
 * and edits what the registry holds.
 * Data: useCommands(), useShortcutOverrides() and Actions.settings for keybinding_overrides_v1.
 * The search, the rebinding rules and the save are NAV-09's useKeybindingEditing, which the
 * shortcuts dialog uses too: the clash rule (findShortcutConflicts) and the reserved keys
 * (reservedCommand) live in core/registries/commands.ts.
 * Must handle: a filter with no match, a clash with another command (the edited row names it and
 * offers Replace, which binds the keys here and removes them from the other command in the same
 * write, or Cancel), a reserved key (refused with the command that holds it), unbinding a
 * command, resetting one command, a disabled command (shown muted), and saved text that cannot be
 * read (its error is shown here).
 * Test first: recording "Cmd+K" for a command that another command uses reports that command.
 */
import { useState } from "react";
import { useCommands } from "../../../core/hooks.ts";
import { COMMAND_CATEGORIES } from "../../../core/registries/commands.ts";
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";
import { ShortcutRecorder } from "../keyboard/ShortcutRecorder.tsx";
import { ShortcutRow } from "../keyboard/ShortcutRow.tsx";
import { matchingCommands, useKeybindingEditing } from "../keyboard/use-keybinding-editing.ts";
import { SettingsPageFrame, useSettingsLoad } from "../SettingsPageFrame.tsx";

export function KeyboardShortcutsPage({
	focusSettingKey = null,
}: {
	focusSettingKey?: string | null;
}) {
	const load = useSettingsLoad();
	const commands = useCommands();
	const editing = useKeybindingEditing();
	const { conflict } = editing;
	const [filter, setFilter] = useState("");
	const [recordingId, setRecordingId] = useState<string | null>(null);
	const shown = matchingCommands(commands, filter);

	const record = (commandId: string, combination: string) => {
		setRecordingId(null);
		editing.record(commandId, combination);
	};

	return (
		<SettingsPageFrame
			title="Keyboard shortcuts"
			description={null}
			{...load}
			focusSettingKey={focusSettingKey}
		>
			<div className="max-w-sm pb-4">
				<Input
					type="search"
					aria-label="Search commands"
					placeholder="Search commands"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
				/>
			</div>

			{editing.overridesError === null ? null : (
				<p role="alert" className="pb-2 text-xs text-danger">
					{editing.overridesError}
				</p>
			)}
			{editing.saveError === null ? null : (
				<p role="alert" className="pb-2 text-xs text-danger">
					{editing.saveError}
				</p>
			)}
			{shown.length === 0 ? (
				<p role="status" className="text-sm text-fg-muted">
					No commands match your search.
				</p>
			) : (
				<div className="flex flex-col gap-5">
					{COMMAND_CATEGORIES.map((category) => {
						const entries = shown.filter((command) => command.category === category);
						if (entries.length === 0) return null;
						return (
							<section key={category} className="flex flex-col">
								<h2 className="pb-1 text-sm font-medium text-fg">{category}</h2>
								{entries.map((command) => (
									<div key={command.id}>
										<ShortcutRow
											command={command}
											changedFromDefault={command.shortcut !== command.defaultShortcut}
											conflictWith={conflict?.commandId === command.id ? conflict.otherTitle : null}
											recording={recordingId === command.id}
											onStartRecording={() => {
												editing.dismiss();
												setRecordingId(command.id);
											}}
											onClear={() => editing.clear(command.id)}
											onReset={() => editing.reset(command.id)}
										/>
										{recordingId === command.id ? (
											<div className="pb-2">
												<ShortcutRecorder
													onRecord={(combination) => record(command.id, combination)}
													onCancel={() => setRecordingId(null)}
												/>
											</div>
										) : null}
										{conflict?.commandId === command.id ? (
											<div className="flex flex-wrap items-center gap-2 pb-2">
												<p className="text-xs text-fg-muted">
													Use {conflict.combination} here and remove it from {conflict.otherTitle}?
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
								))}
							</section>
						);
					})}
				</div>
			)}
		</SettingsPageFrame>
	);
}
