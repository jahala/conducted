/**
 * @feature PR-04 PR summary header
 * Owns: the block under the Checks tab's inline title editor: PR number, state badge, base branch,
 * the "Open on GitHub" button and a menu with Copy link and Copy number. The title is not repeated
 * here: the inline editor above shows it, as Conductor's Checks tab does (PR-07's PrInlineEditor).
 * Behaviour: ui-map.md 3.6, "Checks" paragraph ("PR header, Git status"); services-map.md 3.7.1
 * ("Open on GitHub"); ui-map.md 5.3 (the header menu).
 * Must handle: no PR (shows the branch and a Create PR button instead), draft, merged and closed
 * badges, and copying.
 * Test first: a draft PR renders the "Draft" badge and the number "#12".
 */
import type { PullRequest } from "../../../core/model.ts";
import { Badge, type BadgeTone } from "../../../ui/Badge.tsx";
import { Button } from "../../../ui/Button.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../../ui/Menu.tsx";

export interface PrSummaryHeaderProps {
	pullRequest: PullRequest | null;
	branch: string;
	onOpenOnGithub: () => void;
	onCopy: (text: string) => void;
}

const STATE_LABEL: Readonly<Record<PullRequest["state"], string>> = {
	open: "Open",
	draft: "Draft",
	merged: "Merged",
	closed: "Closed",
};

const STATE_TONE: Readonly<Record<PullRequest["state"], BadgeTone>> = {
	open: "success",
	draft: "neutral",
	merged: "success",
	closed: "neutral",
};

export function PrSummaryHeader({
	pullRequest,
	branch,
	onOpenOnGithub,
	onCopy,
}: PrSummaryHeaderProps) {
	if (pullRequest === null) {
		return (
			<section
				aria-label="Pull request"
				className="flex items-center justify-between gap-2 border-b border-separator px-2 py-2"
			>
				<div className="min-w-0">
					<p className="text-sm font-medium text-fg">No pull request yet</p>
					<p className="truncate text-xs text-fg-muted">{branch}</p>
				</div>
				<Button variant="outline" size="sm" onClick={onOpenOnGithub}>
					Create PR
				</Button>
			</section>
		);
	}

	return (
		<section aria-label="Pull request" className="border-b border-separator px-2 py-2">
			<div className="flex items-start gap-2">
				<span className="min-w-0 flex-1 pt-0.5 font-mono text-xs text-fg-muted">
					#{pullRequest.number}
				</span>
				<Badge tone={STATE_TONE[pullRequest.state]}>{STATE_LABEL[pullRequest.state]}</Badge>
				<Button variant="outline" size="xs" onClick={onOpenOnGithub}>
					Open on GitHub
				</Button>
				<Menu>
					<MenuTrigger asChild>
						<Button variant="ghost" size="xs" aria-label="Pull request menu">
							More
						</Button>
					</MenuTrigger>
					<MenuContent align="end">
						<MenuItem onSelect={() => onCopy(pullRequest.url)}>Copy link</MenuItem>
						<MenuItem onSelect={() => onCopy(String(pullRequest.number))}>Copy number</MenuItem>
					</MenuContent>
				</Menu>
			</div>
			<div className="mt-1 flex items-center gap-2 text-xs text-fg-muted">
				<span>Base: {pullRequest.baseBranch}</span>
				<span className="truncate">{branch}</span>
			</div>
		</section>
	);
}
