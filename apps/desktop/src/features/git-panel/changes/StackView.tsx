/**
 * @feature PR-08 Stack view in the Changes tab
 * Owns: a read-only list of the PRs in a stack, from trunk up, with the current one marked.
 * Behaviour: ui-map.md 3.6 ("Stack view: Stack PRs, Current, (trunk), gt restack, Checkout this
 * branch, Ready for review"); services-map.md 3.8 (a stack is read-only plus checkout; a ready
 * action only marks a draft).
 * Data: the props. No screen renders this view yet: mounting it in the Changes tab, with entries
 * from useStack(workspaceId), the trunk from the target branch, Checkout through switch branch and
 * Ready through mark ready, is an open PR-08 item. Graphite is not read anywhere yet, so every
 * entry's `needsRestack` is false today and the `gt restack` hint never shows in the app.
 * Must handle: no stack (renders nothing, so the parent does not offer the view), an entry whose
 * `needsRestack` is true (shows the `gt restack` hint, never runs it), a draft entry with a Ready
 * for review action, and the current branch (marked, with no checkout action).
 * Test first: three entries render in order with the current one marked and the trunk shown first.
 */
import type { StackEntryView } from "../../../core/model.ts";
import { Badge } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";

export interface StackViewProps {
	trunk: string;
	entries: StackEntryView[];
	onCheckout: (branch: string) => void;
	onMarkReady: (prNumber: number) => void;
}

export function StackView({ trunk, entries, onCheckout, onMarkReady }: StackViewProps) {
	if (entries.length === 0) return null;

	return (
		<section aria-label="Stack PRs" className="border-b border-separator px-2 py-2">
			<h3 className="pb-1 text-sm font-medium text-fg">Stack PRs</h3>
			<ul className="m-0 list-none space-y-1 p-0">
				<li
					data-testid="stack-trunk"
					className="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
				>
					<span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">{trunk}</span>
					<span className="text-xs text-fg-muted">(trunk)</span>
				</li>
				{entries.map((entry) => (
					<li
						key={entry.number}
						data-testid="stack-entry"
						data-current={entry.isCurrent ? "true" : undefined}
						aria-current={entry.isCurrent ? "step" : undefined}
						className="flex flex-col gap-1 rounded-md px-2 py-1.5"
					>
						<div className="flex items-center gap-2">
							<span className="min-w-0 flex-1 truncate text-sm text-fg">
								<span className="text-fg-muted">#{entry.number}</span> {entry.title}
							</span>
							{entry.isCurrent ? <Badge tone="neutral">Current</Badge> : null}
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
								<Button variant="link" size="xs" onClick={() => onCheckout(entry.branch)}>
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
				))}
			</ul>
		</section>
	);
}
