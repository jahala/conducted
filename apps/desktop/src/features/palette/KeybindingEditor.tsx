/**
 * @feature NAV-09 Keybinding editor
 * Owns: The control that records a new key combination for one command.
 * Behaviour: ui-map.md 5.4 (rebinding with conflict detection per scope; overrides stored under a
 * versioned key). The recorder itself is the one Settings uses (features/settings/keyboard).
 * Must handle: Recording starts on click and stops on Escape without changing anything; a reserved
 * key (Cmd+, and Cmd+Q, and a fixed command's key in the same scope) is refused with a reason;
 * modifiers alone are not accepted; the key is shown in macOS symbols and spoken as words.
 * Test first: Pressing Cmd+Shift+K while recording calls onChange('Cmd+Shift+K'); Escape cancels.
 */
import { useState } from "react";
import {
	COMMANDS,
	type CommandDef,
	formatShortcut,
	getCommand,
	parseShortcut,
} from "../../core/registries/commands.ts";
import { Button } from "../../ui/Button.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { ShortcutRecorder } from "../settings/keyboard/ShortcutRecorder.tsx";

export interface KeybindingEditorProps {
	commandId: string;
	current: string | null;
	onChange: (keys: string | null) => void;
}

/** Commands whose keys belong to the app, so no other command may take them. */
const APP_RESERVED_IDS: ReadonlySet<string> = new Set(["app.openSettings", "app.quit"]);

/** The fixed command that already holds `combination`, in the edited command's scope or app-wide. */
function reservedCommand(combination: string, commandId: string): CommandDef | null {
	const form = formatShortcut(combination);
	const target = getCommand(commandId);
	for (const command of COMMANDS) {
		if (command.configurable) continue;
		const sameScope = target !== undefined && command.scope === target.scope;
		if (!APP_RESERVED_IDS.has(command.id) && !sameScope) continue;
		for (const shortcut of command.defaultShortcuts) {
			if (formatShortcut(shortcut) === form) return command;
		}
	}
	return null;
}

const SPOKEN_MODIFIERS = [
	["ctrl", "Control"],
	["alt", "Option"],
	["cmd", "Command"],
	["shift", "Shift"],
] as const;

/** The same shortcut in words, for screen readers: "⌘⇧K" reads "Command Shift K". */
function spokenShortcut(spec: string): string {
	const parsed = parseShortcut(spec);
	if (!parsed.ok) return spec;
	const parts: string[] = SPOKEN_MODIFIERS.filter(([field]) => parsed.value[field]).map(
		([, word]) => word,
	);
	parts.push(parsed.value.key);
	return parts.join(" ");
}

function CurrentShortcut({ current }: { current: string | null }) {
	if (current === null) return <span className="text-xs text-fg-muted">Not set</span>;
	return (
		<>
			<span aria-hidden="true">
				<Kbd>{formatShortcut(current)}</Kbd>
			</span>
			<span className="sr-only">{spokenShortcut(current)}</span>
		</>
	);
}

export function KeybindingEditor({ commandId, current, onChange }: KeybindingEditorProps) {
	const command = getCommand(commandId);
	const title = command?.title ?? commandId;
	const [recording, setRecording] = useState(false);
	const [reason, setReason] = useState<string | null>(null);

	if (command !== undefined && !command.configurable) {
		return <CurrentShortcut current={current} />;
	}

	const cancel = () => {
		setRecording(false);
		setReason(null);
	};

	const record = (combination: string) => {
		if (combination === "") {
			cancel();
			onChange(null);
			return;
		}
		const parsed = parseShortcut(combination);
		if (!parsed.ok) {
			setReason(parsed.error.message);
			return;
		}
		const reserved = reservedCommand(combination, commandId);
		if (reserved !== null) {
			setReason(`${formatShortcut(combination)} is reserved for ${reserved.title}.`);
			return;
		}
		cancel();
		onChange(combination);
	};

	return (
		<div className="flex flex-col items-end gap-1">
			{recording ? (
				<div className="flex items-center gap-2">
					<ShortcutRecorder onRecord={record} onCancel={cancel} />
					<Button variant="ghost" size="sm" onClick={cancel}>
						Cancel
					</Button>
				</div>
			) : (
				<div className="flex items-center gap-2">
					<CurrentShortcut current={current} />
					<Button
						variant="secondary"
						size="sm"
						aria-label={`Change shortcut for ${title}`}
						onClick={() => {
							setReason(null);
							setRecording(true);
						}}
					>
						Change
					</Button>
					{current === null ? null : (
						<Button
							variant="ghost"
							size="sm"
							aria-label={`Clear shortcut for ${title}`}
							onClick={() => onChange(null)}
						>
							Clear
						</Button>
					)}
				</div>
			)}
			{reason === null ? null : (
				<p role="alert" className="text-xs text-danger">
					{reason}
				</p>
			)}
		</div>
	);
}
