/**
 * @feature SET-02 Shortcut row
 * Owns: one command in the shortcuts list, as Conductor's row (renderApp, the keyboard shortcuts
 * page @11744000): the title in medium weight, then at the right the shortcut as key caps beside
 * a pencil, which starts recording; a fixed shortcut shows a lock instead ("Fixed shortcut" for
 * screen readers). Reset shows while the shortcut differs from its default, and Clear, ours, while
 * one is set.
 * Behaviour: ui-map.md 5.4 and 6 (Keyboard shortcuts page).
 * Must handle: an unbound command (no key caps, only the pencil), a command changed from its default
 * (Reset), a fixed command (lock, no pencil), a disabled command (muted), and a conflict flagged on
 * the row.
 * Test first: an unbound command shows no key caps and a Set action.
 */
import type { CommandEntry } from "../../../core/api.ts";
import { Button } from "../../../ui/Button.tsx";
import { cn } from "../../../ui/cn.ts";
import { LockIcon, PencilIcon } from "../../../ui/icons.tsx";

export interface ShortcutRowProps {
	command: CommandEntry;
	changedFromDefault: boolean;
	conflictWith: string | null;
	recording: boolean;
	/** A shortcut the app keeps, such as Cmd+Q: shown with a lock, never changed. */
	fixed: boolean;
	onStartRecording: () => void;
	onClear: () => void;
	onReset: () => void;
}

/** Conductor's key caps: one rounded chip in mono, muted. */
function KeyCaps({ shortcut }: { shortcut: string }) {
	return (
		<span className="inline-flex min-h-8 items-center rounded-full bg-muted px-3 font-mono text-sm text-fg-muted">
			{shortcut}
		</span>
	);
}

export function ShortcutRow({
	command,
	changedFromDefault,
	conflictWith,
	recording,
	fixed,
	onStartRecording,
	onClear,
	onReset,
}: ShortcutRowProps) {
	return (
		<article
			className={cn(
				"flex min-w-0 items-center justify-between gap-6 px-4 py-3",
				!command.enabled && "opacity-60",
			)}
		>
			<div className="flex min-w-0 flex-col gap-0.5">
				<p className="text-sm font-medium text-fg">{command.title}</p>
				{conflictWith ? (
					<p role="alert" className="text-xs text-danger">
						Already used by {conflictWith}.
					</p>
				) : null}
			</div>
			{fixed ? (
				<div className="flex shrink-0 items-center gap-2">
					{command.shortcut === null ? null : <KeyCaps shortcut={command.shortcut} />}
					<LockIcon className="size-4 shrink-0 text-fg-muted" />
					<span className="sr-only">Fixed shortcut</span>
				</div>
			) : (
				<div className="flex shrink-0 items-center gap-2">
					{recording ? (
						<span className="inline-flex min-h-8 items-center rounded-full bg-muted px-3 text-xs text-fg-muted">
							Type shortcut
						</span>
					) : (
						<button
							type="button"
							aria-label={`${command.shortcut === null ? "Set" : "Change"} shortcut for ${command.title}`}
							disabled={!command.enabled}
							onClick={onStartRecording}
							className="flex min-h-10 items-center gap-2 rounded-md py-1 pr-2 pl-1 text-fg-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
						>
							{command.shortcut === null ? null : <KeyCaps shortcut={command.shortcut} />}
							<PencilIcon className="size-4 shrink-0" />
						</button>
					)}
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
				</div>
			)}
		</article>
	);
}
