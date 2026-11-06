/**
 * @feature GIT-17 Continue after a merge or from a detached HEAD
 * Owns: the header shown when a pull request has merged or HEAD is detached. It offers one action,
 * Continue, which starts a new branch in the same workspace.
 * Behaviour: inventory-ui-text.md "Continue after merge"; services-map.md 3.1.
 * Data: the parent passes the git state and the action.
 * Must handle: a running continue (the button shows progress and ignores a second press), a merged
 * pull request, and a detached HEAD.
 * Test first: a merged pull request and a detached HEAD both surface the Continue action.
 */
import type { GitState } from "../../core/model.ts";
import { Badge, type BadgeTone } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";

export interface ContinueHeaderModel {
	title: string;
	tone: BadgeTone;
}

/** The Continue header's title and tone, or null when the state has no Continue action. */
export function continueHeaderFor(git: GitState): ContinueHeaderModel | null {
	if (git.pullRequest?.state === "merged") return { title: "Merged", tone: "neutral" };
	if (git.branch === "") return { title: "Detached HEAD", tone: "warning" };
	return null;
}

export interface ContinueHeaderProps {
	model: ContinueHeaderModel;
	busy: boolean;
	onContinue: () => void;
}

export function ContinueHeader({ model, busy, onContinue }: ContinueHeaderProps) {
	return (
		<div className="flex h-10 shrink-0 items-center gap-2 border-b border-separator px-3">
			<div className="flex min-w-0 flex-1">
				<Badge tone={model.tone}>{model.title}</Badge>
			</div>
			<Button
				size="sm"
				loading={busy}
				disabled={busy}
				onClick={onContinue}
				className="shrink-0"
				title="Continue on a new branch with the same chats"
			>
				Continue
			</Button>
		</div>
	);
}
