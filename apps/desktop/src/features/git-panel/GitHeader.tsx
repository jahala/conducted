/**
 * @feature REV-01 Git panel header
 * Owns: the status chip and the one main action button above the tab strip. It renders a
 * GitHeaderModel and calls the matching action. It decides nothing itself. Create PR is Conductor's
 * outlined split button: its menu holds "Create draft PR" and "Create PR manually".
 * Behaviour: ui-map.md 3.6 ("Header status chip and action"); the cases are in core/status/git-header.ts.
 * Data: the parent computes the model with computeGitHeader and passes it in.
 * Must handle: no title (no chip, as on a GitHub branch with no pull request), no action (chip only), an action in flight (spinner, clicks ignored), a failed
 * action (button usable again; the parent shows the error toast from the Result), the user's
 * current key binding shown on
 * the button, the Retry action for missing PR info, narrow panel widths (title truncates,
 * button keeps its label), and an action's tooltip and count ("Merge stack" shows how many pull
 * requests it merges, and says so in its tooltip).
 * Test first: a model with kind "ready_to_merge" renders a Merge button, and clicking it calls
 * onAction with "merge" once even if clicked twice while busy.
 */
import { type ReactElement, useState } from "react";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useLiveShortcut } from "../../core/hooks.ts";
import type {
	GitHeaderActionId,
	GitHeader as GitHeaderModel,
	GitHeaderTone,
} from "../../core/status/git-header.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import {
	ArrowUpRightIcon,
	ChevronDownIcon,
	PullRequestDraftIcon,
	PullRequestIcon,
} from "../../ui/icons.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { Popover } from "../../ui/Popover.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";

export interface GitHeaderProps {
	model: GitHeaderModel;
	/** The workspace's pull request, for the "#12 ↗" chip. */
	pullRequest?: { number: number; url: string } | null;
	/** Opens the pull request on GitHub, from the chip. */
	onOpenPullRequest?: () => void;
	/** Archives the workspace; offered once its pull request is merged. */
	onArchive?: () => void;
	/** Settles when the action is finished, including a failed one, so the button is usable again. */
	onAction: (action: GitHeaderActionId) => Promise<unknown> | undefined;
}

/**
 * The header's tint and word colour per state, after Conductor: green when the pull request can merge,
 * amber while queued or busy, the highlight pair when it needs attention, purple once merged.
 */
const toneTint: Record<GitHeaderTone, { bar: string; word: string }> = {
	neutral: { bar: "", word: "text-sidebar-fg" },
	busy: { bar: "bg-status-progress/10", word: "text-status-progress" },
	attention: { bar: "bg-highlight-surface", word: "text-highlight-fg" },
	danger: { bar: "", word: "text-danger" },
	success: { bar: "bg-success/10", word: "text-success" },
	done: { bar: "bg-merged/10", word: "text-merged" },
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

export function GitHeader({
	model,
	onAction,
	pullRequest = null,
	onOpenPullRequest,
	onArchive,
}: GitHeaderProps) {
	const tint = model.kind === "merged" ? toneTint.done : toneTint[model.tone];
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
		<div
			className={cn(
				"flex h-10 shrink-0 items-center gap-2 border-b border-separator pr-2 pl-4",
				tint.bar,
			)}
		>
			<div className="flex min-w-0 flex-1 items-center gap-1">
				{pullRequest === null || model.title === "" ? null : (
					<button
						type="button"
						onClick={onOpenPullRequest}
						title={`Open pull request #${pullRequest.number}`}
						className={cn(
							"mr-1 flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 font-mono text-xs font-medium hover:bg-hover",
							tint.word,
						)}
					>
						#{pullRequest.number}
						<ArrowUpRightIcon className="size-3" />
					</button>
				)}
				{model.title === "" ? null : (
					<Popover
						trigger={
							<button
								type="button"
								aria-label="PR status details"
								className={cn(
									"min-w-0 truncate rounded-sm px-1 text-left text-sm font-medium hover:bg-hover",
									tint.word,
								)}
								title={model.title}
							>
								{model.title}
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
				)}
			</div>

			{model.action?.id === "create_pr" ? (
				<CreatePrButton busy={busy} shortcut={shortcut} onRun={run} />
			) : model.action !== null ? (
				<ActionTooltip content={model.action.tooltip}>
					<Button
						size="sm"
						variant={model.kind === "merged" ? "outline" : "default"}
						loading={busy}
						disabled={busy}
						onClick={() => run(model.action?.id ?? "retry")}
						className={cn("shrink-0", model.kind === "merged" && `border-dashed ${tint.word}`)}
					>
						{model.action.label}
						{model.action.count !== undefined ? (
							<span className="rounded-full bg-canvas/20 px-1.5 tabular-nums">
								{model.action.count}
							</span>
						) : null}
						{shortcut !== null ? (
							// The key glyphs are a visual hint. A screen reader should hear only the action's name.
							<span aria-hidden="true">
								<Kbd>{shortcut}</Kbd>
							</span>
						) : null}
					</Button>
				</ActionTooltip>
			) : null}
			{model.kind === "merged" && onArchive !== undefined ? (
				<Button
					size="sm"
					onClick={onArchive}
					className="shrink-0 bg-merged! text-on-merged! hover:opacity-90"
				>
					Archive
				</Button>
			) : null}
		</div>
	);
}

/**
 * Conductor's Create PR: an outlined split button. The main part asks the agent for a pull request
 * and names its shortcut in the tooltip; the arrow's menu offers a draft pull request and GitHub's
 * own page (renderApp i8s, @2228800).
 */
function CreatePrButton({
	busy,
	shortcut,
	onRun,
}: {
	busy: boolean;
	shortcut: string | null;
	onRun: (action: GitHeaderActionId) => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	return (
		<Menu open={menuOpen} onOpenChange={setMenuOpen}>
			<div className="flex shrink-0 items-center">
				<Tooltip content="Create PR" shortcut={shortcut ?? undefined}>
					<Button
						variant="outline"
						size="xs"
						className="rounded-r-none bg-raised"
						loading={busy}
						disabled={busy}
						onClick={() => onRun("create_pr")}
					>
						{busy ? null : <PullRequestIcon className="size-3" />}
						Create PR
					</Button>
				</Tooltip>
				<MenuTrigger asChild>
					<Button
						variant="outline"
						size="xs"
						className="-ml-px rounded-l-none bg-raised px-1"
						aria-label="More ways to create a PR"
						aria-expanded={menuOpen}
						disabled={busy}
						onClick={() => setMenuOpen(!menuOpen)}
					>
						<ChevronDownIcon className="size-3" />
					</Button>
				</MenuTrigger>
			</div>
			<MenuContent align="end" aria-label="Create PR">
				<MenuItem icon={<PullRequestDraftIcon />} onSelect={() => onRun("create_draft_pr")}>
					Create draft PR
				</MenuItem>
				<MenuItem icon={<ArrowUpRightIcon />} onSelect={() => onRun("create_pr_manually")}>
					Create PR manually
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}

/** Wraps the action button in its tooltip, when the action has one. */
function ActionTooltip({
	content,
	children,
}: {
	content: string | undefined;
	children: ReactElement;
}) {
	return content === undefined ? children : <Tooltip content={content}>{children}</Tooltip>;
}
