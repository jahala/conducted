/**
 * @feature APP-10 Reset callout dismissals
 * Owns: the settings row with the "Reset callout dismissals" button, which brings back every hint the user
 * dismissed.
 * Behaviour: ui-map.md 7.1 ("Reset callout dismissals" exists, so callouts exist; in Conductor it sits under
 * the internal settings); settings-states-kit.md (callout dismissals and the reset action).
 * Our design choice: unlike Conductor, the action is on a user page, so a person who dismissed a hint by
 * accident can get it back. It sits on the General page. It clears the one stored list through
 * `Actions.settings.set`; it does not need a confirm because nothing is lost.
 * Must handle: no dismissed hints (the button is disabled and the row says "No dismissed hints"); the
 * write failing (a short error beside the button, the list unchanged); a second click while the write runs
 * (ignored); the result announced to screen readers.
 * Test first: with two dismissed ids, clicking the button writes an empty list once and the row then shows
 * "No dismissed hints".
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/Button.tsx";

export interface ResetCalloutDismissalsProps {
	/** The ids stored as dismissed. */
	dismissedIds: readonly string[];
	onReset: () => Promise<boolean>;
}

const RESET_FAILED_MESSAGE = "Couldn't reset the callout dismissals.";

function countLabel(count: number): string {
	if (count === 0) return "No dismissed hints";
	return count === 1 ? "1 dismissed hint" : `${count} dismissed hints`;
}

export function ResetCalloutDismissals({ dismissedIds, onReset }: ResetCalloutDismissalsProps) {
	const [ids, setIds] = useState<readonly string[]>(() => [...dismissedIds]);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const running = useRef(false);
	const signature = dismissedIds.join("\u0000");

	// The caller's stored list is the source of truth until a reset succeeds. Comparing its contents,
	// not its identity, stops a fresh default array from clearing the local result.
	// biome-ignore lint/correctness/useExhaustiveDependencies: signature stands for the list's contents.
	useEffect(() => {
		setIds([...dismissedIds]);
	}, [signature]);

	const reset = async () => {
		if (running.current || ids.length === 0) return;
		running.current = true;
		setSaving(true);
		setError(null);
		const saved = await onReset();
		running.current = false;
		setSaving(false);
		if (saved) setIds([]);
		else setError(RESET_FAILED_MESSAGE);
	};

	return (
		<div
			data-setting-row="reset-callout-dismissals"
			className="flex flex-col gap-3 border-t border-border py-4"
		>
			<div className="flex items-start justify-between gap-6">
				<div className="flex min-w-0 flex-col gap-1">
					<p className="text-sm font-medium text-fg">Reset callout dismissals</p>
					<p className="max-w-prose text-sm text-fg-muted">Bring back every hint you dismissed.</p>
					<p role="status" className="text-xs text-fg-subtle">
						{countLabel(ids.length)}
					</p>
					{error === null ? null : (
						<p role="alert" className="text-xs text-danger">
							{error}
						</p>
					)}
				</div>
				<Button
					variant="secondary"
					loading={saving}
					disabled={ids.length === 0}
					onClick={() => void reset()}
				>
					Reset callout dismissals
				</Button>
			</div>
		</div>
	);
}
