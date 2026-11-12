/**
 * @feature PR-08 Stack view in the Changes tab
 * Owns: a read-only list of the PRs in a stack, from trunk up, with the current one marked, each
 * entry's readiness and the stack's verdict. Each open entry can be chosen for the range view
 * (services-map.md 3.4.1 `range`, 3.4.5): a click, Shift-click or Cmd-click is handed to the
 * caller, which owns the choice (stack-selection.ts).
 * Behaviour: ui-map.md 3.6 ("Stack view: Stack PRs, Current, (trunk), gt restack, Checkout this
 * branch, Ready for review"); services-map.md 3.8 (a stack is read-only plus checkout; a ready
 * action only marks a draft; readiness per stack entry, whose rules and words live in
 * core/status/stack-readiness.ts), ui-map.md 5.2 ("Switch branch?" with "Switch anyway"; its body
 * names the branch, in Conductor's words).
 * Data: the props. The Changes tab supplies entries from useStack(workspaceId), the trunk from the
 * workspace's target branch without its remote, Checkout through switch branch, Ready through
 * mark ready for the entry's own pull request number, and the chosen pull requests from the diff
 * scope.
 * Must handle: no stack (renders nothing, so the parent does not offer the view), an entry whose
 * `needsRestack` is true (shows the `gt restack` hint, never runs it), a draft entry with a Ready
 * for review action, the current branch (marked, with no checkout action), and a checkout while an
 * agent is working (asks "Switch branch?" first), a stack that can merge ("Ready to merge") or
 * cannot ("Can't merge this stack yet"), and readiness GitHub has not given (no verdict, entries
 * read "Open"), and a merged or closed entry (not choosable: it has no range of its own).
 * Test first: three entries render in order with the current one marked and the trunk shown first.
 */
import { useState } from "react";
import type { StackEntryView } from "../../../core/model.ts";
import { type StackEntryStatus, stackViewReadiness } from "../../../core/status/stack-readiness.ts";
import { AlertDialog, AlertDialogContent } from "../../../ui/AlertDialog.tsx";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { cn } from "../../../ui/cn.ts";
import { type StackSelectModifier, selectModifierOf } from "./stack-selection.ts";

export interface StackViewProps {
	trunk: string;
	entries: StackEntryView[];
	onCheckout: (branch: string) => void;
	onMarkReady: (prNumber: number) => void;
	/** Whether an agent is working in this workspace, so a switch asks first. */
	agentRunning?: boolean;
	/** The pull requests chosen for the range view. */
	selectedPrNumbers: readonly number[];
	/** A click on an open entry, with the modifier held: plain, Shift (range) or Cmd (toggle). */
	onSelectPr: (prNumber: number, modifier: StackSelectModifier) => void;
}

export function StackView({
	trunk,
	entries,
	onCheckout,
	onMarkReady,
	agentRunning = false,
	selectedPrNumbers,
	onSelectPr,
}: StackViewProps) {
	const [pendingBranch, setPendingBranch] = useState<string | null>(null);
	if (entries.length === 0) return null;
	const readiness = stackViewReadiness(entries);

	const requestCheckout = (branch: string) => {
		if (agentRunning) setPendingBranch(branch);
		else onCheckout(branch);
	};

	return (
		<>
			<section aria-label="Stack PRs" className="border-b border-separator px-2 py-2">
				<h3 className="pb-1 text-sm font-medium text-fg">Stack PRs</h3>
				{readiness.verdict === null ? null : (
					<p
						data-testid="stack-verdict"
						className={cn(
							"px-2 pb-1 text-xs font-medium",
							readiness.verdict === "ready" ? "text-success" : "text-warning",
						)}
					>
						{readiness.verdict === "ready" ? "Ready to merge" : "Can't merge this stack yet"}
					</p>
				)}
				<ul className="m-0 list-none space-y-1 p-0">
					<li
						data-testid="stack-trunk"
						className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
					>
						<span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">{trunk}</span>
						<span className="text-xs text-fg-muted">(trunk)</span>
					</li>
					{entries.map((entry) => {
						const choosable = entry.state === "open" || entry.state === "draft";
						const chosen = choosable && selectedPrNumbers.includes(entry.number);
						const label = (
							<>
								<span className="text-fg-muted">#{entry.number}</span> {entry.title}
							</>
						);
						return (
							<li
								key={entry.number}
								data-testid="stack-entry"
								data-current={entry.isCurrent ? "true" : undefined}
								aria-current={entry.isCurrent ? "step" : undefined}
								className={cn("flex flex-col gap-1 rounded-md px-2 py-1.5", chosen && "bg-active")}
							>
								<div className="flex items-center gap-2">
									{choosable ? (
										<button
											type="button"
											aria-pressed={chosen}
											onClick={(event) => onSelectPr(entry.number, selectModifierOf(event))}
											className="min-w-0 flex-1 cursor-pointer select-none truncate rounded-sm text-left text-sm text-fg"
										>
											{label}
										</button>
									) : (
										<span className="min-w-0 flex-1 truncate text-sm text-fg">{label}</span>
									)}
									{entry.isCurrent ? <Badge tone="neutral">Current</Badge> : null}
									<EntryStatus status={readiness.statusOf(entry)} />
								</div>
								<div className="flex items-center gap-2">
									<span className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-muted">
										{entry.branch}
									</span>
									{entry.needsRestack ? (
										<span data-testid="stack-restack" className="text-xs text-warning">
											gt restack
										</span>
									) : null}
									{entry.isCurrent ? null : (
										<Button variant="link" size="xs" onClick={() => requestCheckout(entry.branch)}>
											Checkout this branch
										</Button>
									)}
									{entry.state === "draft" ? (
										<Button variant="link" size="xs" onClick={() => onMarkReady(entry.number)}>
											Ready for review
										</Button>
									) : null}
								</div>
							</li>
						);
					})}
				</ul>
			</section>
			<AlertDialog
				open={pendingBranch !== null}
				onOpenChange={(open) => {
					if (!open) setPendingBranch(null);
				}}
			>
				<AlertDialogContent
					letShortcutsThrough
					title="Switch branch?"
					description={`An agent is running in this workspace. Switching to ${pendingBranch ?? ""} will change the files it's working on.`}
					confirmLabel="Switch anyway"
					onConfirm={() => {
						if (pendingBranch !== null) onCheckout(pendingBranch);
						setPendingBranch(null);
					}}
				/>
			</AlertDialog>
		</>
	);
}

function EntryStatus({ status }: { status: StackEntryStatus }) {
	return (
		<span data-testid="stack-entry-status">
			<Badge tone={status.tone}>{status.label}</Badge>
		</span>
	);
}
