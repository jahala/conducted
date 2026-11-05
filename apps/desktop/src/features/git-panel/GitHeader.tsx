/**
 * @feature REV-01 Git panel header
 * Owns: the status chip and the one main action button above the tab strip. It renders a
 * GitHeaderModel and calls the matching action. It decides nothing itself.
 * Behaviour: ui-map.md 3.6 ("Header status chip and action"); the cases are in core/status/git-header.ts.
 * Data: the parent computes the model with computeGitHeader and passes it in.
 * Must handle: no action (chip only), an action in flight (spinner, clicks ignored), a failed
 * action (error toast from the Result, button usable again), a waiting note instead of a button
 * (reviewer cannot approve own PR), the keyboard shortcut shown on the button, the Retry action
 * for missing PR info, and narrow panel widths (title truncates, button keeps its label).
 * Test first: a model with kind "ready_to_merge" renders a Merge button, and clicking it calls
 * onAction with "merge" once even if clicked twice while busy.
 */
import { useEffect, useRef, useState } from "react";
import { formatShortcut, getCommand } from "../../core/registries/commands.ts";
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

function shortcutOf(action: GitHeaderActionId): string | undefined {
	const command = getCommand(actionCommand[action] ?? "");
	const first = command?.defaultShortcuts[0];
	return first === undefined ? undefined : formatShortcut(first);
}

export function GitHeader({ model, onAction }: GitHeaderProps) {
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(false);

	const actionKey = model.action?.id ?? "none";
	// A new model means the previous action finished, so the button can be used again.
	const lastAction = useRef(actionKey);
	useEffect(() => {
		if (lastAction.current === actionKey) return;
		lastAction.current = actionKey;
		busyRef.current = false;
		setBusy(false);
	});

	const run = (action: GitHeaderActionId) => {
		if (busyRef.current) return;
		busyRef.current = true;
		setBusy(true);
		const settle = () => {
			busyRef.current = false;
			setBusy(false);
		};
		// A failed action settles too, so the button is usable again rather than stuck loading.
		void Promise.resolve(onAction(action)).then(settle, settle);
	};

	const shortcut = model.action === null ? undefined : shortcutOf(model.action.id);

	return (
		<div className="flex h-10 shrink-0 items-center gap-2 border-b border-separator px-3">
			<Popover
				trigger={
					<button
						type="button"
						aria-label="PR status details"
						className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 hover:bg-hover"
					>
						<Badge tone={toneBadge[model.tone]}>{model.title}</Badge>
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

			<span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{model.title}</span>

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
					{shortcut !== undefined ? <Kbd>{shortcut}</Kbd> : null}
				</Button>
			) : null}
		</div>
	);
}
