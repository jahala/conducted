/**
 * @feature NAV-05 Home
 * Owns: the Home route: a list of all workspaces (Conductor's full-width 44px rows) with the toolbar in
 * the title strip (search, filters, sort, Display, "+ Create"), a pinned group and paging.
 * Behaviour: ui-map.md 2 (/all-workspaces: search, filters for projects and active or archived,
 * sort, "Display" card fields, pinned group, paging by 50; empty: "No matching workspaces";
 * renderApp @10272000-10278200: the toolbar sits in the title strip and the list has no heading),
 * 7.3 (loading skeleton with role="status"), 7.4 (error with retry).
 * Our design choice: owner filters, routine origin and team avatars are cloud features and are
 * left out. The "Home" title stays at the left of the strip (ours). Filters and sort are screen state, not saved settings, so leaving Home resets them.
 * Must handle: loading (skeleton cards with role="status"); error with retry; no workspaces;
 * filters that match nothing; Clear filters resets search, projects and the archived toggle while
 * leaving sort and Display alone; the archived filter (cards offer Unarchive, Open in Finder, Copy
 * path); more than 50 results ("Show more"); a workspace whose project is not in the visible
 * repository list is left out rather than drawn without a project.
 * Test first: with 60 workspaces the first page shows 50 cards and "Show more" shows the rest.
 */
import type { Result } from "@conducted/shared";
import { useCallback, useMemo, useState } from "react";
import { useServices } from "../../core/context.tsx";
import { useRepos, useWorkspaces } from "../../core/hooks.ts";
import type { Repo, Workspace } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { TitleBarInset } from "../../ui/TitleBarInset.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { useNow } from "../sidebar/use-now.ts";
import { HomeEmptyState } from "./HomeEmptyState.tsx";
import { HomeFilters } from "./HomeFilters.tsx";
import {
	defaultHomeDisplay,
	type HomeDisplay,
	type HomeFilterState,
	queryHome,
} from "./home-query.ts";
import { WorkspaceCard } from "./WorkspaceCard.tsx";

const INITIAL_FILTERS: HomeFilterState = {
	search: "",
	projects: [],
	archive: "active",
	sortBy: "lastActive",
};

function HomeSkeleton() {
	return (
		<div className="flex flex-col">
			{["a", "b", "c", "d", "e", "f"].map((key) => (
				<Skeleton key={key} className="h-32" />
			))}
		</div>
	);
}

/** A grid of cards, with the project looked up once so each card does not search the list. */
function CardGrid({
	workspaces,
	reposById,
	now,
	display,
}: {
	workspaces: Workspace[];
	reposById: ReadonlyMap<string, Repo>;
	now: number;
	display: HomeDisplay;
}) {
	return (
		<div className="flex flex-col">
			{workspaces.map((workspace) => {
				const repo = reposById.get(workspace.repoId);
				if (repo === undefined) return null;
				return (
					<WorkspaceCard
						key={workspace.id}
						workspace={workspace}
						repo={repo}
						now={now}
						display={display}
					/>
				);
			})}
		</div>
	);
}

interface HomeContentProps {
	repos: Repo[];
	workspaces: Workspace[];
	filters: HomeFilterState;
	display: HomeDisplay;
	now: number;
	pageCount: number;
	onShowMore: () => void;
	onClearFilters: () => void;
}

function HomeContent({
	repos,
	workspaces,
	filters,
	display,
	now,
	pageCount,
	onShowMore,
	onClearFilters,
}: HomeContentProps) {
	const reposById = useMemo(() => new Map(repos.map((repo) => [repo.id, repo])), [repos]);
	const withProjects = useMemo(
		() => workspaces.filter((workspace) => reposById.has(workspace.repoId)),
		[workspaces, reposById],
	);
	const page = useMemo(
		() => queryHome({ workspaces: withProjects, repos, filters, pageCount }),
		[withProjects, repos, filters, pageCount],
	);
	const filtersActive =
		filters.search.trim() !== "" || filters.projects.length > 0 || filters.archive !== "active";
	const empty = page.pinned.length === 0 && page.items.length === 0;

	return (
		<div className="flex w-full flex-col">
			{empty ? (
				<HomeEmptyState
					filtersActive={filtersActive}
					archivedOnly={filters.archive === "archived"}
					onClearFilters={onClearFilters}
				/>
			) : (
				<>
					{page.pinned.length === 0 ? null : (
						<section aria-label="Pinned" className="flex flex-col">
							<h2 className="px-4 py-2 text-xs font-medium text-fg-muted">Pinned</h2>
							<CardGrid
								workspaces={page.pinned}
								reposById={reposById}
								now={now}
								display={display}
							/>
						</section>
					)}
					{page.items.length === 0 ? null : (
						<section aria-label="All workspaces" className="flex flex-col">
							<CardGrid workspaces={page.items} reposById={reposById} now={now} display={display} />
						</section>
					)}
					{page.hasMore ? (
						<div className="flex items-center gap-3 px-4 py-3">
							<Button variant="secondary" onClick={onShowMore}>
								Show more
							</Button>
							<span className="text-xs text-fg-muted">
								{page.items.length} of {page.total}
							</span>
						</div>
					) : null}
				</>
			)}
		</div>
	);
}

export function HomeScreen() {
	const repos = useRepos();
	const workspaces = useWorkspaces();
	const { repo, workspace } = useServices().services;
	const now = useNow();
	const [filters, setFilters] = useState<HomeFilterState>(INITIAL_FILTERS);
	const [display, setDisplay] = useState<HomeDisplay>(defaultHomeDisplay);
	const [pageCount, setPageCount] = useState(1);

	const changeFilters = useCallback((next: HomeFilterState) => {
		setFilters(next);
		setPageCount(1);
	}, []);
	const changeDisplay = useCallback((next: HomeDisplay) => setDisplay(next), []);
	const showMore = useCallback(() => setPageCount((count) => count + 1), []);
	const clearFilters = useCallback(() => {
		setFilters((current) => ({ ...current, search: "", projects: [], archive: "active" }));
		setPageCount(1);
	}, []);

	const retry = (start: () => Promise<Result<void>>) => () => {
		void start().then((result) => {
			if (!result.ok) toastError("Couldn't load workspaces", result.error);
		});
	};

	return (
		<div className="flex h-full min-h-0 flex-col bg-canvas">
			<header
				data-tauri-drag-region
				className="flex h-(--titlebar-height) shrink-0 items-center gap-2 border-b border-border pr-2 pl-4"
			>
				<TitleBarInset />
				<h1 className="shrink-0 text-sm font-medium text-fg">Home</h1>
				{repos.state === "ready" ? (
					<HomeFilters
						filters={filters}
						repos={repos.data}
						display={display}
						onChange={changeFilters}
						onDisplayChange={changeDisplay}
					/>
				) : null}
			</header>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<LoadableView
					value={repos}
					loadingLabel="Loading workspaces"
					loading={<HomeSkeleton />}
					errorTitle="Couldn't load workspaces"
					onRetry={retry(() => repo.start())}
				>
					{(repoRows) => (
						<LoadableView
							value={workspaces}
							loadingLabel="Loading workspaces"
							loading={<HomeSkeleton />}
							errorTitle="Couldn't load workspaces"
							onRetry={retry(() => workspace.start())}
						>
							{(workspaceRows) => (
								<HomeContent
									repos={repoRows}
									workspaces={workspaceRows}
									filters={filters}
									display={display}
									now={now}
									pageCount={pageCount}
									onShowMore={showMore}
									onClearFilters={clearFilters}
								/>
							)}
						</LoadableView>
					)}
				</LoadableView>
			</div>
		</div>
	);
}
