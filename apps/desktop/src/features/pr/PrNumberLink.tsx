/**
 * @feature PR-07 The pull request's number as a link
 * Owns: "#<number>" beside the PR tab's title. A click opens the pull request where "Open pull
 * requests in" says; right click offers "Open in <app>" for each choice (the chosen one first,
 * with its Cmd+Shift+G hint), "Copy link" and "Copy number".
 * Behaviour: ui-map.md 3.2 (PR tab title, "Open on GitHub"), 6 ("Open pull requests in"); the menu
 * and its wording are from Conductor's frontend bundle.
 * Must handle: an address that is not on github.com (GitHub Enterprise: it opens as it is, and no
 * other apps are offered); a failed open or
 * copy (the caller's toast).
 * Test first: clicking "#12" with the target Graphite opens the app.graphite.com address.
 */
import { useLiveShortcut } from "../../core/hooks.ts";
import { ContextMenu, ContextMenuItem } from "../../ui/ContextMenu.tsx";
import {
	openTargetLabel,
	PULL_REQUEST_OPEN_TARGETS,
	type PullRequestOpenTarget,
	pullRequestOpenUrl,
} from "./pr-open-target.ts";

export interface PrNumberLinkProps {
	prUrl: string;
	prNumber: number;
	target: PullRequestOpenTarget;
	onOpen: (url: string) => void;
	onCopy: (text: string) => void;
}

export function PrNumberLink({ prUrl, prNumber, target, onOpen, onCopy }: PrNumberLinkProps) {
	const shortcut = useLiveShortcut("pr.open");
	const onGithub = prUrl.startsWith("https://github.com/");
	const others = onGithub ? PULL_REQUEST_OPEN_TARGETS.filter((other) => other !== target) : [];
	return (
		<ContextMenu
			items={
				<>
					<ContextMenuItem
						shortcut={shortcut ?? undefined}
						onSelect={() => onOpen(pullRequestOpenUrl(prUrl, target))}
					>
						{openTargetLabel(onGithub ? target : "github")}
					</ContextMenuItem>
					{others.map((other) => (
						<ContextMenuItem key={other} onSelect={() => onOpen(pullRequestOpenUrl(prUrl, other))}>
							{openTargetLabel(other)}
						</ContextMenuItem>
					))}
					<ContextMenuItem onSelect={() => onCopy(prUrl)}>Copy link</ContextMenuItem>
					<ContextMenuItem onSelect={() => onCopy(String(prNumber))}>Copy number</ContextMenuItem>
				</>
			}
		>
			<a
				href={prUrl}
				onClick={(event) => {
					event.preventDefault();
					onOpen(pullRequestOpenUrl(prUrl, target));
				}}
				className="shrink-0 rounded-sm pt-1 font-mono text-xs text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
			>
				#{prNumber}
			</a>
		</ContextMenu>
	);
}
