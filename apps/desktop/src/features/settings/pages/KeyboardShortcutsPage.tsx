/**
 * @feature SET-02 Keyboard shortcuts settings page
 * Owns: the Keyboard shortcuts page of Settings: every command with its shortcut, search, and
 * rebinding.
 * Behaviour: ui-map.md 5.4 (the shortcut list) and 6 (page in the Personal group). One command
 * registry feeds menus, the palette, this page and the shortcut dialog, so this page only lists
 * and edits what the registry holds.
 * Data: useCommands(), useShortcutOverrides() and Actions.settings for keybinding_overrides_v1.
 * The clash rule is findShortcutConflicts in core/registries/commands.ts: the page passes the
 * table with the edit applied and reads the pair that names the edited command.
 * Must handle: a filter with no match, a clash with another command (the page names it and offers
 * to replace or cancel), unbinding a command, resetting one command, a disabled command (shown
 * muted), and saved text that cannot be read (its error is shown here).
 * Test first: recording "Cmd+K" for a command that another command uses reports that command.
 */
import { useState } from "react";
import { useActions, useCommands, useShortcutOverrides } from "../../../core/hooks.ts";
import {
	COMMAND_CATEGORIES,
	COMMANDS,
	findShortcutConflicts,
	getCommand,
	parseShortcut,
	type ShortcutOverrides,
	withShortcutOverrides,
} from "../../../core/registries/commands.ts";
import { Button } from "../../../ui/Button.tsx";
import { Input } from "../../../ui/Input.tsx";
import { ShortcutRecorder } from "../keyboard/ShortcutRecorder.tsx";
import { ShortcutRow } from "../keyboard/ShortcutRow.tsx";
import { SettingsPageFrame } from "../SettingsPageFrame.tsx";

interface Conflict {
	commandId: string;
	combination: string;
	otherTitle: string;
}

const SETTING_KEY = "keybinding_overrides_v1";

export function KeyboardShortcutsPage({
	focusSettingKey = null,
}: {
	focusSettingKey?: string | null;
}) {
	const commands = useCommands();
	const { overrides, error: overridesError } = useShortcutOverrides();
	const actions = useActions();
	const [filter, setFilter] = useState("");
	const [recordingId, setRecordingId] = useState<string | null>(null);
	const [conflict, setConflict] = useState<Conflict | null>(null);
	const [saveError, setSaveError] = useState<string | null>(null);

	const persist = async (next: ShortcutOverrides) => {
		const text = Object.keys(next).length === 0 ? "" : JSON.stringify(next);
		const saved = await actions.settings.set(SETTING_KEY, text);
		setSaveError(saved.ok ? null : saved.error.message);
	};

	const record = (commandId: string, combination: string) => {
		setRecordingId(null);
		setSaveError(null);
		if (combination === "") {
			void persist({ ...overrides, [commandId]: [] });
			return;
		}
		const parsed = parseShortcut(combination);
		if (!parsed.ok) {
			setSaveError(parsed.error.message);
			return;
		}
		const next: ShortcutOverrides = { ...overrides, [commandId]: [combination] };
		const clashes = findShortcutConflicts(withShortcutOverrides(COMMANDS, next));
		const found = clashes.find((clash) => clash.ids.includes(commandId));
		if (found !== undefined) {
			const otherId = found.ids[0] === commandId ? found.ids[1] : found.ids[0];
			setConflict({
				commandId,
				combination,
				otherTitle: getCommand(otherId)?.title ?? otherId,
			});
			return;
		}
		void persist(next);
	};

	const clear = (commandId: string) => {
		setSaveError(null);
		void persist({ ...overrides, [commandId]: [] });
	};

	const reset = (commandId: string) => {
		const next = { ...overrides };
		delete next[commandId];
		setSaveError(null);
		void persist(next);
	};

	const needle = filter.trim().toLowerCase();
	const shown = commands.filter((command) =>
		needle === ""
			? true
			: command.title.toLowerCase().includes(needle) ||
				command.category.toLowerCase().includes(needle),
	);

	return (
		<SettingsPageFrame
			title="Keyboard shortcuts"
			description="Every command and the keys that run it. Changes take effect at once."
			state="ready"
			errorMessage={null}
			onRetry={() => undefined}
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

			{overridesError ? (
				<p role="alert" className="pb-2 text-xs text-danger">
					{overridesError.message}
				</p>
			) : null}
			{saveError ? (
				<p role="alert" className="pb-2 text-xs text-danger">
					{saveError}
				</p>
			) : null}
			{conflict ? (
				<div
					role="alert"
					className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-danger/40 p-3"
				>
					<p className="text-sm text-fg">
						{conflict.combination} is already used by {conflict.otherTitle}.
					</p>
					<Button
						size="sm"
						variant="destructive"
						onClick={() => {
							const pending = conflict;
							setConflict(null);
							void persist({ ...overrides, [pending.commandId]: [pending.combination] });
						}}
					>
						Replace
					</Button>
					<Button size="sm" variant="secondary" onClick={() => setConflict(null)}>
						Cancel
					</Button>
				</div>
			) : null}

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
											conflictWith={null}
											recording={recordingId === command.id}
											onStartRecording={() => {
												setConflict(null);
												setSaveError(null);
												setRecordingId(command.id);
											}}
											onClear={() => clear(command.id)}
											onReset={() => reset(command.id)}
										/>
										{recordingId === command.id ? (
											<div className="pb-2">
												<ShortcutRecorder
													onRecord={(combination) => record(command.id, combination)}
													onCancel={() => setRecordingId(null)}
												/>
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
