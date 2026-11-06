/**
 * @feature NAV-06 Kanban dashboard
 * Owns: The Dashboard route: a board of workspaces in five status columns, with project filter
 * chips, drag and drop between columns, and an optimistic move that rolls back when the write fails.
 * Behaviour: ui-map.md 2 (/dashboard: Backlog, In progress, In review, Done, Canceled; drag a card
 * to change status; project filter chips, top 5 plus more; empty: 'New workspace'; behind the
 * setting 'Dashboard'), 6 (the setting is under Experimental). As in Conductor's frontend bundle,
 * the route sends the user to Home while the setting is off (the sidebar hides its row too), the
 * filter shows only with more than one project, and an empty board is one centred 'New workspace'
 * button that opens the create screen for the chosen project.
 * Our design choice: A moved card shows in its new column at once; a failed write puts it back and
 * shows a toast.
 * Must handle: Setting off (waits for the settings to load, then goes to Home); loading; error; no
 * workspaces ('New workspace'); a failed status change returns the card to its column and shows a
 * toast; archived workspaces are not on the board.
 * Test first: Dropping a card on 'Done' calls workspaces.setKanbanStatus(id, 'done'); a failure
 * moves it back.
 */
import type { RepoId, Result } from "@conducted/shared";
import { Navigate, useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useActions, useRepos, useSetting, useWorkspaces } from "../../core/hooks.ts";
import type { KanbanStatus, Repo, Workspace } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../../ui/Menu.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { TitleBarInset } from "../../ui/TitleBarInset.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { KanbanColumn } from "./KanbanColumn.tsx";
import { groupByKanbanStatus, KANBAN_STATUSES } from "./kanban.ts";

/** How many projects get their own chip before the rest move under More. */
export const DASHBOARD_PROJECT_CHIPS = 5;

function DashboardSkeleton() {
	return (
		<div className="grid h-full min-w-[900px] grid-cols-5 gap-3 p-4">
			{["a", "b", "c", "d", "e"].map((key) => (
				<Skeleton key={key} className="h-full" />
			))}
		</div>
	);
}

function ProjectFilter({
	repos,
	selected,
	onSelect,
}: {
	repos: Repo[];
	selected: RepoId | null;
	onSelect: (repoId: RepoId | null) => void;
}) {
	const top = repos.slice(0, DASHBOARD_PROJECT_CHIPS);
	const rest = repos.slice(DASHBOARD_PROJECT_CHIPS);
	if (repos.length < 2) return null;
	return (
		<fieldset
			aria-label="Filter by project"
			className="m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0"
		>
			<Button
				variant={selected === null ? "secondary" : "ghost"}
				size="xs"
				aria-pressed={selected === null}
				onClick={() => onSelect(null)}
			>
				All projects
			</Button>
			{top.map((repo) => (
				<Button
					key={repo.id}
					variant={selected === repo.id ? "secondary" : "ghost"}
					size="xs"
					aria-pressed={selected === repo.id}
					onClick={() => onSelect(repo.id)}
				>
					{repo.name}
				</Button>
			))}
			{rest.length === 0 ? null : (
				<Menu>
					<MenuTrigger asChild>
						<Button variant="ghost" size="xs">
							More
						</Button>
					</MenuTrigger>
					<MenuContent align="start" aria-label="More projects">
						{rest.map((repo) => (
							<MenuItem key={repo.id} onSelect={() => onSelect(repo.id)}>
								{repo.name}
							</MenuItem>
						))}
					</MenuContent>
				</Menu>
			)}
		</fieldset>
	);
}

export function DashboardScreen() {
	const enabled = useSetting<boolean>("dashboard_enabled");
	const { services } = useServices();
	const settingsLoaded = useStore(services.settings.store, (state) => state.loaded);
	const navigate = useNavigate();
	const repos = useRepos();
	const workspaces = useWorkspaces();
	const actions = useActions();
	const { repo, workspace } = services;
	const [project, setProject] = useState<RepoId | null>(null);
	const [overrides, setOverrides] = useState<Record<string, KanbanStatus>>({});

	const move = useCallback(
		(workspaceId: Workspace["id"], status: KanbanStatus) => {
			const current = workspace.store.getState().workspacesById[workspaceId];
			if (current === undefined || current.kanbanStatus === status) return;
			setOverrides((previous) => ({ ...previous, [workspaceId]: status }));
			void actions.workspaces.setKanbanStatus(workspaceId, status).then((result) => {
				setOverrides((previous) => {
					const next = { ...previous };
					delete next[workspaceId];
					return next;
				});
				if (!result.ok) toastError("Couldn't change the workspace status", result.error);
			});
		},
		[actions, workspace.store],
	);

	const retry = (start: () => Promise<Result<void>>) => () => {
		void start().then((result) => {
			if (!result.ok) toastError("Couldn't load workspaces", result.error);
		});
	};

	if (settingsLoaded && !enabled) return <Navigate to="/" replace />;

	return (
		<div className="flex h-full min-h-0 flex-col bg-canvas">
			<header
				data-tauri-drag-region
				className="flex h-(--titlebar-height) shrink-0 items-center border-b border-border px-4"
			>
				<TitleBarInset />
				<h1 className="text-sm font-medium text-fg">Dashboard</h1>
			</header>
			{enabled ? (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<LoadableView
						value={repos}
						loadingLabel="Loading projects"
						loading={
							<div role="status" aria-label="Loading projects">
								<DashboardSkeleton />
							</div>
						}
						errorTitle="Couldn't load projects"
						onRetry={retry(() => repo.start())}
					>
						{(repoRows) => (
							<LoadableView
								value={workspaces}
								loadingLabel="Loading workspaces"
								loading={
									<div role="status" aria-label="Loading workspaces">
										<DashboardSkeleton />
									</div>
								}
								errorTitle="Couldn't load workspaces"
								onRetry={retry(() => workspace.start())}
							>
								{(workspaceRows) => {
									const reposById = new Map(repoRows.map((row) => [row.id, row]));
									const effective = workspaceRows.map((row): Workspace => {
										const moved = overrides[row.id];
										return moved === undefined ? row : { ...row, kanbanStatus: moved };
									});
									// One project needs no filter: its workspaces are the whole board.
									const chosen =
										project ?? (repoRows.length === 1 ? (repoRows[0]?.id ?? null) : null);
									const visible = effective.filter(
										(row) =>
											reposById.has(row.repoId) && (chosen === null || row.repoId === chosen),
									);
									const groups = groupByKanbanStatus(visible);
									const total = KANBAN_STATUSES.reduce(
										(count, status) => count + groups[status].length,
										0,
									);
									return (
										<div className="flex h-full min-h-0 flex-col gap-3 p-4">
											<ProjectFilter repos={repoRows} selected={project} onSelect={setProject} />
											{total === 0 ? (
												<div className="flex min-h-0 flex-1 items-center justify-center">
													<Button
														onClick={() =>
															void navigate({
																to: "/create",
																search: chosen === null ? {} : { repo: chosen },
															})
														}
													>
														New workspace
													</Button>
												</div>
											) : (
												<div className="min-h-0 flex-1 overflow-x-auto">
													<div className="flex h-full gap-6">
														{KANBAN_STATUSES.map((status) => (
															<KanbanColumn
																key={status}
																status={status}
																workspaces={groups[status]}
																repos={repoRows}
																onMove={move}
															/>
														))}
													</div>
												</div>
											)}
										</div>
									);
								}}
							</LoadableView>
						)}
					</LoadableView>
				</div>
			) : null}
		</div>
	);
}
