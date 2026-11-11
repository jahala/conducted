/**
 * @feature WS-11 Backlog workspaces: save now, start later
 * Owns: the backlog screen and the actions that start or remove a saved workspace.
 * Behaviour: ui-map.md 3.9 (a saved workspace starts through the normal create flow), 3.1 (Workspace
 * actions offers Start for an unstarted workspace), 3.8 (the lifecycle label is Unstarted), 5.4
 * (Cmd+Enter starts the backlog workspace).
 * Our design choice: the backlog lives on its own screen reached from the create page. A row shows
 * its repository, name, first message and the Unstarted label, with the same Start and Remove
 * choices in its Workspace actions menu. Cmd+Enter starts the selected row, or the first one. Each
 * row has a "Switch repo" picker (the create flow's name for its repository picker, ui-map 3.9);
 * a draft whose repository was removed says "No ready repository. Pick one to start this
 * workspace." until one is picked.
 * Must handle: loading, an empty backlog, a failed start (an error toast and the row stays), removal,
 * a draft with no repository, and a pick that fails (an error toast, the draft keeps its repository).
 * Test first: pressing Cmd+Enter starts the selected backlog workspace.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { createSingleFlight } from "../../core/async/single-flight.ts";
import { useActions, useBacklogWorkspaces, useRepos, useSetting } from "../../core/hooks.ts";
import type { BacklogWorkspace, Repo } from "../../core/model.ts";
import { NO_READY_REPOSITORY_MESSAGE } from "../../core/workspace-helpers.ts";
import { Button } from "../../ui/Button.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { Select } from "../../ui/Select.tsx";
import { toast, toastError } from "../../ui/Toast.tsx";
import { statusText } from "./status-text.ts";

const unstarted = statusText({ kind: "lifecycle", label: "unstarted" });

/** The name a saved workspace shows: its own name, the first line of its message, or a fallback. */
export function backlogName(entry: BacklogWorkspace): string {
	if (entry.displayName !== null && entry.displayName.trim() !== "") return entry.displayName;
	const firstLine = entry.prompt.split("\n")[0]?.trim() ?? "";
	return firstLine === "" ? "Untitled workspace" : firstLine;
}

export function BacklogScreen(_props: Record<string, never>) {
	const actions = useActions();
	const navigate = useNavigate();
	const backlog = useBacklogWorkspaces();
	const repos = useRepos();
	const [selected, setSelected] = useState<WorkspaceId | null>(null);
	const flight = useRef(createSingleFlight()).current;
	// The switch Conductor uses for this feature, from the settings registry (WS-11).
	const enabled = useSetting<boolean>("unstarted_workspaces_enabled");

	const entries = backlog.state === "ready" ? backlog.data : [];
	const repoList: readonly Repo[] = repos.state === "ready" ? repos.data : [];
	/** The draft's repository; undefined while the list loads or when it was removed. */
	const repoOf = (entry: BacklogWorkspace): Repo | undefined =>
		entry.repoId === null ? undefined : repoList.find((repo) => repo.id === entry.repoId);
	const repoOptions = repoList.map((repo) => ({ value: repo.id as string, label: repo.name }));

	const pickRepo = async (entry: BacklogWorkspace, repoId: string) => {
		const repo = repoList.find((candidate) => candidate.id === repoId);
		if (repo === undefined) return;
		const result = await actions.workspaces.setBacklogRepo(entry.id, repo.id);
		if (!result.ok) toastError("Couldn't change the repository", result.error);
	};

	const open = (repoId: RepoId, workspaceId: WorkspaceId) => {
		void navigate({
			to: "/repository/$repositoryId/workspace/$workspaceId",
			params: { repositoryId: repoId, workspaceId },
		});
	};

	const start = async (entry: BacklogWorkspace) => {
		await flight.run(`start-${entry.id}`, async () => {
			const result = await actions.workspaces.startFromBacklog(entry.id);
			if (!result.ok) {
				toastError("Couldn't start the workspace", result.error);
				return;
			}
			toast.success("Workspace started");
			open(result.value.repoId, result.value.id);
		});
	};

	const remove = async (entry: BacklogWorkspace) => {
		const result = await actions.workspaces.removeFromBacklog(entry.id);
		if (!result.ok) {
			toastError("Couldn't remove the workspace", result.error);
			return;
		}
		toast.success("Removed from backlog");
	};

	useCommandHandler("workspace.startFromBacklog", "area", () => {
		const entry = entries.find((candidate) => candidate.id === selected) ?? entries[0];
		if (entry === undefined) return false;
		void start(entry);
		return true;
	});

	const heading = (
		<header className="flex items-center justify-between gap-3 border-b border-border px-8 py-5">
			<div className="flex flex-col gap-1">
				<h1 className="text-2xl font-medium text-fg">Backlog</h1>
				<p className="text-sm text-fg-muted">Workspaces saved to start later.</p>
			</div>
			<Button onClick={() => void navigate({ to: "/create" })}>New workspace</Button>
		</header>
	);

	if (!enabled) {
		return (
			<div className="flex h-full flex-col">
				{heading}
				<EmptyState
					title="Backlog is turned off"
					body="Unstarted workspaces are turned off, so drafts cannot be saved to start later."
				/>
			</div>
		);
	}

	if (backlog.state === "loading") {
		return (
			<div className="flex h-full flex-col">
				{heading}
				<p role="status" className="p-8 text-sm text-fg-muted">
					Loading backlog…
				</p>
			</div>
		);
	}
	if (backlog.state === "error") {
		return (
			<div className="flex h-full flex-col">
				{heading}
				<p role="alert" className="p-8 text-sm text-danger">
					{backlog.error.message}
				</p>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			{heading}
			{entries.length === 0 ? (
				<EmptyState
					title="No workspaces in the backlog"
					body="Draft a workspace now and start it when you are ready."
					action={<Button onClick={() => void navigate({ to: "/create" })}>New workspace</Button>}
				/>
			) : (
				<ul aria-label="Backlog workspaces" className="flex flex-col gap-1 px-4 py-4">
					{entries.map((entry) => {
						const repo = repoOf(entry);
						const missing = repos.state === "ready" && repo === undefined;
						return (
							<li key={entry.id}>
								<div className="flex items-center gap-3 rounded-md px-4 py-3 hover:bg-hover">
									<button
										type="button"
										aria-current={entry.id === selected ? "true" : undefined}
										className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-sm text-left aria-current:text-fg"
										onClick={() => setSelected(entry.id)}
									>
										<span className="truncate text-sm font-medium text-fg">
											{backlogName(entry)}
										</span>
										<span className="truncate text-xs text-fg-muted">
											{repo === undefined ? unstarted.text : `${repo.name} · ${unstarted.text}`}
										</span>
										{missing ? (
											<span className="text-xs text-warning">{NO_READY_REPOSITORY_MESSAGE}</span>
										) : null}
									</button>
									<Select
										aria-label="Switch repo"
										size="sm"
										value={repo?.id ?? ""}
										options={repoOptions}
										onValueChange={(next) => void pickRepo(entry, next)}
									/>
									<Button size="sm" onClick={() => void start(entry)}>
										Start
									</Button>
									<Menu>
										<MenuTrigger asChild>
											<Button size="sm" variant="ghost" aria-label="Workspace actions">
												More
											</Button>
										</MenuTrigger>
										<MenuContent aria-label="Workspace actions">
											<MenuItem onSelect={() => void start(entry)}>Start</MenuItem>
											<MenuItem destructive onSelect={() => void remove(entry)}>
												Remove from backlog
											</MenuItem>
										</MenuContent>
									</Menu>
								</div>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}
