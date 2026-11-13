/**
 * @feature NAV-05 Workspace card
 * Owns: one row of the Home list: status, name, line changes, project and last activity, plus the
 * actions an archived row offers.
 * Behaviour: ui-map.md 2 (Home cards), 3.8 (status model), 4 (archived workspace actions:
 * "Unarchive workspace", "Clear & unarchive", "Open in Finder", "Copy path").
 * Measured from Conductor 0.92.1 (renderApp @10254031, @10251109, @10230874): one 44px row with 16px
 * sides, 12px gaps and a bottom rule: the status icon, the name (weight 450 in the muted colour, bold
 * when unread, faint when archived), the line changes in a 96px column, the project (icon and name, 12px
 * muted) in a 160px column and the age (12px muted) in a 40px column. A merged pull request tints the
 * row and its text purple, a pull request ready to merge tints it green, one in the merge queue tints
 * it yellow, and a 1.5px bar of the same colour marks the row's left edge.
 * Our design choice: an active row is one link to the workspace. An archived row is not a link, because
 * the router refuses to open an archived workspace; it offers Unarchive, Clear & unarchive, Open in
 * Finder and Copy path at its right end, drawn as Conductor draws the same actions on its unarchive
 * toast (two small secondary buttons, then icon buttons named by tooltip, renderApp @12098182; D098).
 * The row shows no status words or branch after the name, as Conductor's does not (D098). Line
 * changes and the pull request are read from the git state the app already has; the row never starts
 * a git read.
 * Must handle: an archived card (muted, with Unarchive instead of opening); a branch that is taken
 * or has moved (a dialog asks for a new branch name and keeps the "Clear & unarchive" choice); a
 * failure or lost uncommitted changes (the toasts from `runUnarchive`); a long name truncates;
 * status unknown (no status icon); the whole active card is one link, so its buttons are never
 * nested links; keyboard focus ring.
 * Test first: an archived workspace's card shows an Unarchive button and does not link to the
 * workspace.
 */

import type { Result } from "@conducted/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
	useActions,
	useGitState,
	useSessions,
	useSetting,
	useWorkspaceStatus,
} from "../../core/hooks.ts";
import type { PullRequest, Repo, Workspace } from "../../core/model.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { IconButton } from "../../ui/IconButton.tsx";
import { CopyIcon, FolderIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { RepoIconMark } from "../sidebar/RepoIcon.tsx";
import { compactCount, relativeTime } from "../sidebar/WorkspaceRow.tsx";
import { RenameDialog } from "../workspace/RenameDialog.tsx";
import { useBranchPrefix } from "../workspace/use-branch-prefix.ts";
import { WorkspaceStatusIcon } from "../workspace/WorkspaceStatusIcon.tsx";
import { runUnarchive } from "../workspace/workspace-actions.ts";
import { workspaceName } from "../workspace/workspace-name.ts";
import type { HomeDisplay } from "./home-query.ts";

export interface WorkspaceCardProps {
	workspace: Workspace;
	repo: Repo;
	/** The current time, read once by the grid so every card shares one timer. */
	now: number;
	display: HomeDisplay;
}

function ArchivedActions({ workspace }: { workspace: Workspace }) {
	const actions = useActions();
	const [busy, setBusy] = useState<"unarchive" | "clear" | null>(null);
	const [branchPrompt, setBranchPrompt] = useState<{ clearChats: boolean } | null>(null);

	const run = (title: string, work: () => Promise<Result<unknown>>) => {
		void work().then((result) => {
			if (!result.ok) toastError(title, result.error);
		});
	};

	const restore = (kind: "unarchive" | "clear") => {
		setBusy(kind);
		const clearChats = kind === "clear";
		void runUnarchive(actions, workspace.id, { branchName: null, clearChats })
			.then((result) => {
				// The branch is taken or has moved: ask for a new name, and keep the Clear choice.
				if (result.ok && result.value.needsBranchName) setBranchPrompt({ clearChats });
			})
			.finally(() => setBusy(null));
	};

	return (
		<div className="flex shrink-0 items-center gap-2">
			<Button
				variant="secondary"
				size="xs"
				loading={busy === "unarchive"}
				disabled={busy !== null && busy !== "unarchive"}
				onClick={() => restore("unarchive")}
			>
				Unarchive
			</Button>
			<Button
				variant="secondary"
				size="xs"
				loading={busy === "clear"}
				disabled={busy !== null && busy !== "clear"}
				onClick={() => restore("clear")}
			>
				Clear & unarchive
			</Button>
			<IconButton
				variant="secondary"
				size="xs"
				label="Open in Finder"
				icon={<FolderIcon className="size-3.5" />}
				onClick={() =>
					run("Couldn't open the workspace in Finder", () =>
						actions.workspaces.openIn(workspace.id, "Finder"),
					)
				}
			/>
			<IconButton
				variant="secondary"
				size="xs"
				label="Copy path"
				icon={<CopyIcon className="size-3.5" />}
				onClick={() => run("Couldn't copy the path", () => actions.app.copyText(workspace.path))}
			/>
			<RenameDialog
				open={branchPrompt !== null}
				onOpenChange={(open) => {
					if (!open) setBranchPrompt(null);
				}}
				title="Unarchive workspace"
				initialName={workspace.branch}
				fieldLabel="Branch name"
				submitLabel="Unarchive"
				onSubmit={(name) =>
					runUnarchive(actions, workspace.id, {
						branchName: name,
						clearChats: branchPrompt?.clearChats ?? false,
					})
				}
			/>
		</div>
	);
}

type RowTone = "merged" | "ready" | "queued";

/** Conductor's row tones by pull request state. A failing or pending check, or a conflict, is not ready. */
export function rowTone(pullRequest: PullRequest | null): RowTone | null {
	if (pullRequest === null) return null;
	if (pullRequest.state === "merged") return "merged";
	if (pullRequest.state !== "open") return null;
	if (pullRequest.inMergeQueue) return "queued";
	const checksPass = pullRequest.checks.every(
		(check) => check.state === "success" || check.state === "skipped",
	);
	return pullRequest.mergeable === "mergeable" &&
		checksPass &&
		pullRequest.reviewDecision !== "changes_requested"
		? "ready"
		: null;
}

const TONE_CLASS: Record<RowTone, string> = {
	merged: "bg-merged/10 text-merged hover:bg-merged/15",
	ready: "bg-success/10 text-success hover:bg-success/15",
	queued: "bg-status-progress/10 text-status-progress hover:bg-status-progress/15",
};

const TONE_BAR: Record<RowTone, string> = {
	merged: "bg-merged",
	ready: "bg-success",
	queued: "bg-status-progress",
};

export function WorkspaceCard({ workspace, repo, now, display }: WorkspaceCardProps) {
	const status = useWorkspaceStatus(workspace.id);
	const branchPrefix = useBranchPrefix();
	const archived = isArchivedWorkspace(workspace);
	// Read only: the row shows what the git state already knows and never starts a git read.
	const git = useGitState(workspace.id);
	const sessions = useSessions(workspace.id);
	const unread =
		sessions.state === "ready" && sessions.data.some((session) => session.unreadCount > 0);
	// WS-09: the Experimental matrix mark, for workspaces on this Mac only.
	const matrix =
		useSetting<boolean>("internal_workspace_status_matrix") === true &&
		workspace.host.kind === "local";
	const tone = archived || git.state !== "ready" ? null : rowTone(git.data.pullRequest);
	const counts =
		git.state === "ready" && (git.data.linesAdded > 0 || git.data.linesRemoved > 0)
			? { added: git.data.linesAdded, removed: git.data.linesRemoved }
			: null;
	const showProject = display.has("repository") || display.has("repositoryIcon");

	const body = (
		<>
			{tone === null ? null : (
				<span
					aria-hidden="true"
					className={cn(
						"absolute top-1/2 left-0 h-[18px] w-[1.5px] -translate-y-1/2 rounded-full",
						TONE_BAR[tone],
					)}
				/>
			)}
			<span className="flex size-4 shrink-0 items-center justify-center">
				{archived ? null : (
					<WorkspaceStatusIcon status={status} decorative matrix={matrix} hasUnread={unread} />
				)}
			</span>
			<span className="flex min-w-0 flex-1 items-baseline gap-2">
				<span
					className={cn(
						"min-w-0 truncate",
						archived
							? "font-book text-fg-subtle"
							: unread
								? cn("font-semibold", tone === null && "text-fg")
								: cn("font-book", tone === null && "text-fg-muted"),
					)}
				>
					{workspaceName(workspace, branchPrefix)}
				</span>
				{archived ? <Badge>Archived</Badge> : null}
			</span>
			{display.has("lineChanges") ? (
				<span className="flex w-24 shrink-0 justify-end gap-1 font-mono text-xs font-medium">
					{counts === null ? null : (
						<>
							<span className="text-git-added">+{compactCount(counts.added)}</span>
							{counts.removed > 0 ? (
								<span className="text-git-removed">-{compactCount(counts.removed)}</span>
							) : null}
						</>
					)}
				</span>
			) : null}
			{showProject ? (
				<span className="flex w-40 shrink-0 items-center gap-1.5 text-xs text-fg-muted">
					{display.has("repositoryIcon") ? (
						<span className="flex size-4 shrink-0 items-center justify-center overflow-hidden">
							<RepoIconMark repo={repo} />
						</span>
					) : null}
					{display.has("repository") ? <span className="truncate">{repo.name}</span> : null}
				</span>
			) : null}
			{display.has("lastActive") ? (
				<time
					dateTime={new Date(workspace.lastActivityAt).toISOString()}
					title={new Date(workspace.lastActivityAt).toLocaleString()}
					className="w-10 shrink-0 text-right text-xs text-fg-muted"
				>
					{relativeTime(workspace.lastActivityAt, now)}
				</time>
			) : null}
		</>
	);

	if (archived) {
		return (
			<article
				data-testid="home-workspace-card"
				data-archived="true"
				className="relative flex h-11 min-w-0 items-center gap-3 border-b border-separator px-4 text-sm"
			>
				{body}
				<ArchivedActions workspace={workspace} />
			</article>
		);
	}

	return (
		<Link
			to="/repository/$repositoryId/workspace/$workspaceId"
			params={{ repositoryId: repo.id, workspaceId: workspace.id }}
			data-testid="home-workspace-card"
			data-tone={tone ?? undefined}
			className={cn(
				"relative flex h-11 min-w-0 items-center gap-3 border-b border-separator px-4 text-left text-sm transition-colors",
				tone === null ? "hover:bg-hover" : TONE_CLASS[tone],
			)}
		>
			{body}
		</Link>
	);
}
