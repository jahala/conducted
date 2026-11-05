/**
 * @feature NAV-05 Home filters
 * Owns: the search box, project filter, active or archived toggle, sort and Display menu above the
 * grid.
 * Behaviour: ui-map.md 2 (Home: search, filters for projects and active or archived, sort,
 * "Display" card fields), 10 (the fields seen on Home cards).
 * Our design choice: the search waits for a short pause before it changes the query, so typing
 * does not rebuild 50 cards on every key. Escape clears the search at once. The Display menu
 * offers only the fields the card can draw now; line changes wait for GIT-04.
 * Must handle: typing in search changes the query after the pause, not on every key; Escape in the
 * search box clears it; a project filter naming a removed repository is dropped; an outside change
 * to the search text replaces the box.
 * Test first: typing "auth" calls onChange once with search "auth" after the pause.
 */

import type { RepoId } from "@conducted/shared";
import { useEffect, useState } from "react";
import type { Repo } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Input } from "../../ui/Input.tsx";
import { Menu, MenuCheckboxItem, MenuContent, MenuLabel, MenuTrigger } from "../../ui/Menu.tsx";
import { Select } from "../../ui/Select.tsx";
import { ToggleGroup, ToggleGroupItem } from "../../ui/Toggle.tsx";
import {
	HOME_DISPLAY_FIELDS,
	type HomeDisplay,
	type HomeDisplayField,
	type HomeFilterState,
} from "./home-query.ts";

/** How long the search box waits after the last key before it filters. */
export const SEARCH_PAUSE_MS = 250;

const DISPLAY_LABELS: Record<HomeDisplayField, string> = {
	repository: "Repository",
	lastActive: "Last active",
};

export interface HomeFiltersProps {
	filters: HomeFilterState;
	repos: Repo[];
	display: HomeDisplay;
	onChange: (filters: HomeFilterState) => void;
	onDisplayChange: (display: HomeDisplay) => void;
}

function projectOptions(repos: Repo[]): { value: string; label: string }[] {
	return [
		{ value: "all", label: "All projects" },
		...repos.map((repo) => ({ value: repo.id, label: repo.name })),
	];
}

export function HomeFilters({
	filters,
	repos,
	display,
	onChange,
	onDisplayChange,
}: HomeFiltersProps) {
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

	const selectedProject = filters.projects[0] ?? "all";

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Input
				type="search"
				aria-label="Search workspaces"
				placeholder="Search workspaces"
				value={search}
				onChange={(event) => setSearch(event.target.value)}
				onKeyDown={(event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					setSearch("");
					onChange({ ...filters, search: "" });
				}}
				className="w-64"
			/>
			<Select
				aria-label="Filter by project"
				value={selectedProject}
				options={projectOptions(repos)}
				onValueChange={(value) =>
					onChange({
						...filters,
						projects: value === "all" ? [] : [value as RepoId],
					})
				}
			/>
			<ToggleGroup
				type="single"
				aria-label="Show workspaces"
				value={filters.archivedOnly ? "archived" : "active"}
				onValueChange={(value) => {
					if (value === "") return;
					onChange({ ...filters, archivedOnly: value === "archived" });
				}}
			>
				<ToggleGroupItem value="active">Active</ToggleGroupItem>
				<ToggleGroupItem value="archived">Archived</ToggleGroupItem>
			</ToggleGroup>
			<Select
				aria-label="Sort workspaces"
				value={filters.sortBy}
				options={[
					{ value: "updated", label: "Last updated" },
					{ value: "created", label: "Created" },
				]}
				onValueChange={(value) =>
					onChange({ ...filters, sortBy: value === "created" ? "created" : "updated" })
				}
			/>
			<Menu>
				<MenuTrigger asChild>
					<Button variant="ghost" size="sm">
						Display
					</Button>
				</MenuTrigger>
				<MenuContent align="end">
					<MenuLabel>Show on cards</MenuLabel>
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
		</div>
	);
}
