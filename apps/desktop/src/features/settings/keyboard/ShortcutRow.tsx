/**
 * @feature SET-02 Shortcut row
 * Owns: one command in the shortcuts list: title, category, the current shortcut as key caps, and
 * actions to change, clear or reset it.
 * Behaviour: ui-map.md 5.4 and 6 (Keyboard shortcuts page).
 * Must handle: an unbound command ("Not set"), a command changed from its default (marked, with
 * Reset), a disabled command (muted), and a conflict flagged on the row.
 * Test first: an unbound command shows "Not set" and a Set action.
 */
import type { CommandEntry } from "../../../core/api.ts";
import { Button } from "../../../ui/Button.tsx";
import { cn } from "../../../ui/cn.ts";
import { Kbd } from "../../../ui/Kbd.tsx";

export interface ShortcutRowProps {
	command: CommandEntry;
	changedFromDefault: boolean;
	conflictWith: string | null;
	recording: boolean;
	onStartRecording: () => void;
	onClear: () => void;
	onReset: () => void;
}

export function ShortcutRow({
	command,
	changedFromDefault,
	conflictWith,
	recording,
	onStartRecording,
	onClear,
	onReset,
}: ShortcutRowProps) {
	return (
		<div
			className={cn(
				"flex items-start justify-between gap-4 border-t border-border py-2 first:border-t-0",
				!command.enabled && "opacity-60",
			)}
		>
			<div className="flex min-w-0 flex-col gap-0.5">
				<p className="text-sm text-fg">{command.title}</p>
				<p className="text-xs text-fg-subtle">{command.category}</p>
				{conflictWith ? (
					<p role="alert" className="text-xs text-danger">
						Already used by {conflictWith}.
					</p>
				) : null}
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{command.shortcut === null ? (
					<span className="text-xs text-fg-muted">Not set</span>
				) : (
					<Kbd>{command.shortcut}</Kbd>
				)}
				{recording ? (
					<span className="text-xs text-accent">Recording…</span>
				) : (
					<Button
						variant="secondary"
						size="sm"
						aria-label={`${command.shortcut === null ? "Set" : "Change"} shortcut for ${command.title}`}
						disabled={!command.enabled}
						onClick={onStartRecording}
					>
						{command.shortcut === null ? "Set" : "Change"}
					</Button>
				)}
				{command.shortcut !== null ? (
					<Button
						variant="ghost"
						size="sm"
						aria-label={`Clear shortcut for ${command.title}`}
						disabled={!command.enabled}
						onClick={onClear}
					>
						Clear
					</Button>
				) : null}
				{changedFromDefault ? (
					<Button
						variant="ghost"
						size="sm"
						aria-label={`Reset shortcut for ${command.title}`}
						disabled={!command.enabled}
						onClick={onReset}
					>
						Reset
					</Button>
				) : null}
			</div>
		</div>
	);
}
