/**
 * @feature NAV-05 Workspace card
 * Owns: one card in the Home grid: name, repository, branch, status and last activity, plus the
 * actions an archived card offers.
 * Behaviour: ui-map.md 2 (Home cards), 3.8 (status model), 4 (archived workspace actions:
 * "Unarchive workspace", "Clear & unarchive", "Open in Finder", "Copy path").
 * Our design choice: an active card is one link to the workspace. An archived card is not a link;
 * it offers Unarchive, Clear & unarchive, Open in Finder and Copy path, because the router refuses
 * to open an archived workspace. Line changes wait for GIT-04, which supplies git state.
 * Must handle: an archived card (muted, with Unarchive instead of opening); a branch that is taken
 * or has moved (a dialog asks for a new branch name and keeps the "Clear & unarchive" choice); a
 * failure or lost uncommitted changes (the toasts from `runUnarchive`); a long name truncates;
 * status unknown (no status line); the whole active card is one link, so its buttons are never
 * nested links; keyboard focus ring.
 * Test first: an archived workspace's card shows an Unarchive button and does not link to the
 * workspace.
 */

import type { Result } from "@conducted/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useActions, useWorkspaceStatus } from "../../core/hooks.ts";
import type { Repo, Workspace } from "../../core/model.ts";
import { Badge } from "../../ui/Badge.tsx";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { GitBranchIcon } from "../../ui/icons.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { relativeTime } from "../sidebar/WorkspaceRow.tsx";
import { RenameDialog } from "../workspace/RenameDialog.tsx";
import { type StatusTone, statusText } from "../workspace/status-text.ts";
import { WorkspaceStatusIcon } from "../workspace/WorkspaceStatusIcon.tsx";
import { runUnarchive } from "../workspace/workspace-actions.ts";
import { workspaceName } from "../workspace/workspace-name.ts";
import { type HomeDisplay, isArchived } from "./home-query.ts";

export interface WorkspaceCardProps {
	workspace: Workspace;
	repo: Repo;
	/** The current time, read once by the grid so every card shares one timer. */
	now: number;
	display: HomeDisplay;
}

const toneClass: Record<StatusTone, string> = {
	attention: "text-accent",
	active: "text-fg-muted",
	danger: "text-danger",
	success: "text-success",
	neutral: "text-fg-muted",
};

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
		<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
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
				variant="ghost"
				size="xs"
				loading={busy === "clear"}
				disabled={busy !== null && busy !== "clear"}
				onClick={() => restore("clear")}
			>
				Clear & unarchive
			</Button>
			<Button
				variant="ghost"
				size="xs"
				onClick={() =>
					run("Couldn't open the workspace in Finder", () =>
						actions.workspaces.openIn(workspace.id, "Finder"),
					)
				}
			>
				Open in Finder
			</Button>
			<Button
				variant="ghost"
				size="xs"
				onClick={() => run("Couldn't copy the path", () => actions.app.copyText(workspace.path))}
			>
				Copy path
			</Button>
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

export function WorkspaceCard({ workspace, repo, now, display }: WorkspaceCardProps) {
	const status = useWorkspaceStatus(workspace.id);
	const archived = isArchived(workspace);
	const subtitle = statusText(status);

	const body = (
		<>
			<div className="flex items-start justify-between gap-2">
				<span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">
					{workspaceName(workspace)}
				</span>
				{archived ? (
					<Badge>Archived</Badge>
				) : (
					<span className="flex size-4 shrink-0 items-center justify-center">
						<WorkspaceStatusIcon status={status} decorative />
					</span>
				)}
			</div>
			{subtitle.text === "" ? null : (
				<p className={cn("truncate text-xs", toneClass[subtitle.tone])}>{subtitle.text}</p>
			)}
			<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
				<span className="flex min-w-0 items-center gap-1">
					<GitBranchIcon className="size-3 shrink-0" />
					<span className="truncate">{workspace.branch}</span>
				</span>
				{display.has("repository") ? (
					<span className="truncate text-fg-subtle">{repo.name}</span>
				) : null}
			</div>
			{display.has("lastActive") ? (
				<time
					dateTime={new Date(workspace.lastActivityAt).toISOString()}
					title={new Date(workspace.lastActivityAt).toLocaleString()}
					className="text-2xs text-fg-subtle"
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
				className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
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
			className="flex flex-col gap-2 rounded-lg border border-border bg-raised p-4 text-left transition-colors hover:bg-hover"
		>
			{body}
		</Link>
	);
}
