/**
 * @feature NAV-05 Home filters
 * Owns: Home's toolbar: the search box, project filter, archive filter, sort, Display menu and
 * "+ Create".
 * Behaviour: ui-map.md 2 (Home: search, filters for projects and active or archived, sort,
 * "Display" card fields), 10 (the fields seen on Home cards).
 * Measured from Conductor 0.92.1 (renderApp @10212800-10226500, @10274108): one row in the 40px title
 * strip. At the left a 200px search with its icon and "Search"; then, right-aligned, ghost controls 28px
 * tall in muted 14px text, each with a 16px icon and a 12px chevron: "In all projects" (a checkbox menu
 * with "All projects" and each project, shown when there is more than one project), the archive
 * filter ("Hiding archived", "Showing all", "Only archived"), the sort ("Last active", "Newest", "Name",
 * "Repository"), "Display" (Repository, Repository icon, Line changes, Last active) and a 24px "+ Create".
 * Our design choice: the search waits for a short pause before it changes the query, so typing
 * does not rebuild 50 rows on every key. Escape clears the search at once. Conductor's owner and
 * routine filters, and its Cost and Owner fields, are cloud features and are left out.
 * Must handle: typing in search changes the query after the pause, not on every key; Escape in the
 * search box clears it; a project filter naming a removed repository is dropped; an outside change
 * to the search text replaces the box.
 * Test first: typing "auth" calls onChange once with search "auth" after the pause.
 */

import type { RepoId } from "@conducted/shared";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Repo } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import {
	ArchiveIcon,
	ArrowUpDownIcon,
	ChevronDownIcon,
	FolderIcon,
	PlusIcon,
	SearchIcon,
	SlidersIcon,
} from "../../ui/icons.tsx";
import { Menu, MenuCheckboxItem, MenuContent, MenuTrigger } from "../../ui/Menu.tsx";
import { Select } from "../../ui/Select.tsx";
import {
	HOME_DISPLAY_FIELDS,
	type HomeArchiveFilter,
	type HomeDisplay,
	type HomeDisplayField,
	type HomeFilterState,
	type HomeSort,
} from "./home-query.ts";

/** How long the search box waits after the last key before it filters. */
export const SEARCH_PAUSE_MS = 250;

const DISPLAY_LABELS: Record<HomeDisplayField, string> = {
	repository: "Repository",
	repositoryIcon: "Repository icon",
	lineChanges: "Line changes",
	lastActive: "Last active",
};

const ARCHIVE_OPTIONS: { value: HomeArchiveFilter; label: string }[] = [
	{ value: "active", label: "Hiding archived" },
	{ value: "all", label: "Showing all" },
	{ value: "archived", label: "Only archived" },
];

const SORT_OPTIONS: { value: HomeSort; label: string }[] = [
	{ value: "lastActive", label: "Last active" },
	{ value: "created", label: "Newest" },
	{ value: "name", label: "Name" },
	{ value: "repository", label: "Repository" },
];

/** The toolbar's ghost trigger: icon, label, small chevron (Conductor's toolbar button). */
const ghostTrigger =
	"flex h-7 max-w-48 min-w-0 items-center gap-1.5 rounded-md px-2 text-sm text-fg-muted outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover data-[state=open]:text-fg";

export interface HomeFiltersProps {
	filters: HomeFilterState;
	repos: Repo[];
	display: HomeDisplay;
	onChange: (filters: HomeFilterState) => void;
	onDisplayChange: (display: HomeDisplay) => void;
}

function projectLabel(repos: Repo[], projects: readonly RepoId[]): string {
	if (projects.length === 0) return "In all projects";
	if (projects.length === 1) {
		const name = repos.find((repo) => repo.id === projects[0])?.name;
		return name === undefined ? "In 1 project" : `In ${name}`;
	}
	return `In ${projects.length} projects`;
}

export function HomeFilters({
	filters,
	repos,
	display,
	onChange,
	onDisplayChange,
}: HomeFiltersProps) {
	const navigate = useNavigate();
	const [search, setSearch] = useState(filters.search);

	// A Clear filters action in the empty state, or any other outside change, replaces the text.
	useEffect(() => {
		setSearch(filters.search);
	}, [filters.search]);

	// The parent owns the query. This local text changes on every key; the timer decides when.
	useEffect(() => {
		if (search === filters.search) return;
		const timer = setTimeout(() => onChange({ ...filters, search }), SEARCH_PAUSE_MS);
		return () => clearTimeout(timer);
	}, [search, filters, onChange]);

	// A saved project filter may name a repository that was removed since.
	useEffect(() => {
		const known = new Set(repos.map((repo) => repo.id));
		const valid = filters.projects.filter((id) => known.has(id));
		if (valid.length !== filters.projects.length) {
			onChange({ ...filters, projects: valid });
		}
	}, [filters, repos, onChange]);

	const toggleProject = (id: RepoId) =>
		onChange({
			...filters,
			projects: filters.projects.includes(id)
				? filters.projects.filter((project) => project !== id)
				: [...filters.projects, id],
		});

	return (
		<div className="flex min-w-0 flex-1 items-center gap-1">
			<label className="flex h-7 w-[200px] min-w-0 shrink items-center gap-2 px-2">
				<SearchIcon className="size-4 shrink-0 text-fg-muted" />
				<input
					type="search"
					aria-label="Search"
					placeholder="Search"
					value={search}
					onChange={(event) => setSearch(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Escape") return;
						event.preventDefault();
						setSearch("");
						onChange({ ...filters, search: "" });
					}}
					className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted [&::-webkit-search-cancel-button]:hidden"
				/>
			</label>
			<div className="flex-1 self-stretch" data-tauri-drag-region />
			{repos.length > 1 ? (
				<Menu>
					<MenuTrigger asChild>
						<button type="button" className={ghostTrigger}>
							<FolderIcon className="size-4 shrink-0" />
							<span className="truncate">{projectLabel(repos, filters.projects)}</span>
							<ChevronDownIcon className="size-3 shrink-0" />
						</button>
					</MenuTrigger>
					<MenuContent align="start" className="w-56">
						<MenuCheckboxItem
							checked={filters.projects.length === 0}
							onCheckedChange={() => onChange({ ...filters, projects: [] })}
						>
							All projects
						</MenuCheckboxItem>
						{repos.map((repo) => (
							<MenuCheckboxItem
								key={repo.id}
								checked={filters.projects.includes(repo.id)}
								onCheckedChange={() => toggleProject(repo.id)}
							>
								<span className="truncate">{repo.name}</span>
							</MenuCheckboxItem>
						))}
					</MenuContent>
				</Menu>
			) : null}
			<Select<HomeArchiveFilter>
				variant="ghost"
				aria-label="Archived workspaces"
				icon={<ArchiveIcon className="size-4 shrink-0" />}
				value={filters.archive}
				options={ARCHIVE_OPTIONS}
				onValueChange={(archive) => onChange({ ...filters, archive })}
			/>
			<Select<HomeSort>
				variant="ghost"
				aria-label="Sort workspaces"
				icon={<ArrowUpDownIcon className="size-4 shrink-0" />}
				value={filters.sortBy}
				options={SORT_OPTIONS}
				onValueChange={(sortBy) => onChange({ ...filters, sortBy })}
			/>
			<Menu>
				<MenuTrigger asChild>
					<button type="button" aria-label="Display" className={ghostTrigger}>
						<SlidersIcon className="size-4 shrink-0" />
						<span>Display</span>
						<ChevronDownIcon className="size-3 shrink-0" />
					</button>
				</MenuTrigger>
				<MenuContent align="end" className="w-48">
					{HOME_DISPLAY_FIELDS.map((field) => (
						<MenuCheckboxItem
							key={field}
							checked={display.has(field)}
							onCheckedChange={(checked) => {
								const next = new Set(display);
								if (checked) next.add(field);
								else next.delete(field);
								onDisplayChange(next);
							}}
						>
							{DISPLAY_LABELS[field]}
						</MenuCheckboxItem>
					))}
				</MenuContent>
			</Menu>
			<Button
				size="xs"
				className="ml-1 shrink-0 gap-1 pr-2 pl-1.5 text-sm shadow-xs"
				onClick={() => void navigate({ to: "/create" })}
			>
				<PlusIcon className="size-3" />
				Create
			</Button>
		</div>
	);
}
