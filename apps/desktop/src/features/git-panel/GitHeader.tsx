/**
 * @feature REV-01 Git panel header
 * Owns: the status chip and the one main action button above the tab strip. It renders a
 * GitHeaderModel and calls the matching action. It decides nothing itself.
 * Behaviour: ui-map.md 3.6 ("Header status chip and action"); the cases are in core/status/git-header.ts.
 * Data: the parent computes the model with computeGitHeader and passes it in.
 * Must handle: no action (chip only), an action in flight (spinner, clicks ignored), a failed
 * action (button usable again; the parent shows the error toast from the Result), a waiting note
 * instead of a button (reviewer cannot approve own PR), the user's current key binding shown on
 * the button, the Retry action for missing PR info, and narrow panel widths (title truncates,
 * button keeps its label).
 * Test first: a model with kind "ready_to_merge" renders a Merge button, and clicking it calls
 * onAction with "merge" once even if clicked twice while busy.
 */
import { useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useLiveShortcut } from "../../core/hooks.ts";
import type {
	GitHeaderActionId,
	GitHeader as GitHeaderModel,
	GitHeaderTone,
} from "../../core/status/git-header.ts";
import { Badge, type BadgeTone } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { Popover } from "../../ui/Popover.tsx";

export interface GitHeaderProps {
	model: GitHeaderModel;
	/** Settles when the action is finished, including a failed one, so the button is usable again. */
	onAction: (action: GitHeaderActionId) => Promise<unknown> | undefined;
}

const toneBadge: Record<GitHeaderTone, BadgeTone> = {
	neutral: "neutral",
	busy: "warning",
	attention: "warning",
	danger: "danger",
	success: "success",
	done: "neutral",
};

const actionCommand: Partial<Record<GitHeaderActionId, string>> = {
	create_pr: "git.createPr",
	commit_and_push: "git.commitAndPush",
	pull: "git.pullLatest",
	ready_for_review: "pr.markReady",
	fix_errors: "pr.fixErrors",
	merge: "pr.merge",
	merge_stack: "pr.merge",
};

export function GitHeader({ model, onAction }: GitHeaderProps) {
	// The action in flight, if any. The single-flight guard ignores a second press of the same
	// action; a different action (the model changed under the button) runs on its own.
	const [flight] = useState(() => createSingleFlight<GitHeaderActionId>());
	const [busyAction, setBusyAction] = useState<GitHeaderActionId | null>(null);
	const actionId = model.action?.id ?? null;
	const busy = actionId !== null && busyAction === actionId;
	const shortcut = useLiveShortcut(actionId === null ? "" : (actionCommand[actionId] ?? ""));

	const run = (action: GitHeaderActionId) => {
		if (flight.isRunning(action)) return;
		setBusyAction(action);
		const settle = () => setBusyAction((current) => (current === action ? null : current));
		// A failed action settles too, so the button is usable again rather than stuck loading.
		void flight.run(action, async () => onAction(action)).then(settle, settle);
	};

	return (
		<div className="flex h-10 shrink-0 items-center gap-2 border-b border-separator px-3">
			<div className="flex min-w-0 flex-1">
				<Popover
					trigger={
						<button
							type="button"
							aria-label="PR status details"
							className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-hover"
						>
							<span className="min-w-0 truncate" title={model.title}>
								<Badge tone={toneBadge[model.tone]}>{model.title}</Badge>
							</span>
						</button>
					}
				>
					<fieldset aria-label="PR status details" className="m-0 w-56 space-y-1 border-0 p-0">
						<p className="text-sm font-medium text-fg">{model.title}</p>
						<p className="text-xs text-fg-muted">Status: {model.kind.replaceAll("_", " ")}</p>
						<p className="text-xs text-fg-muted">
							{model.action === null ? "No action is available." : `Next: ${model.action.label}`}
						</p>
					</fieldset>
				</Popover>
			</div>

			{model.action !== null && model.action.waitingNote !== null ? (
				<span className="shrink-0 text-xs text-fg-muted">{model.action.waitingNote}</span>
			) : model.action !== null ? (
				<Button
					size="sm"
					loading={busy}
					disabled={busy}
					onClick={() => run(model.action?.id ?? "retry")}
					className="shrink-0"
				>
					{model.action.label}
					{shortcut !== null ? <Kbd>{shortcut}</Kbd> : null}
				</Button>
			) : null}
		</div>
	);
}
