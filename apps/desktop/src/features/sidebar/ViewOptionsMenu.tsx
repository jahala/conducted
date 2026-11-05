/**
 * @feature NAV-03 View options menu
 * Owns: The sort icon menu above the list: Group by (Status or Project), Filter by project, Sort by
 * (Updated or Created).
 * Behaviour: ui-map.md 4 (View options menu; the project filter is searchable from 5 repos; Sort by
 * is hidden when manual order is on).
 * Our design choice: Sort by stays visible until NAV-04 saves a real manual order. Hiding it before
 * then would leave the user with neither a sort choice nor a working reorder.
 * Must handle: Fewer than 5 repos (no search box in the filter); a filter that names a removed repo
 * is dropped; the menu shows the current choice with a check mark.
 * Test first: Choosing Group by Project calls onChange with groupBy 'project'; Sort by is present
 * even when manualOrder is true, until NAV-04 supplies the saved order.
 */

import type { RepoId } from "@conducted/shared";
import { useState } from "react";
import type { Repo } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Input } from "../../ui/Input.tsx";
import { ListTodoIcon } from "../../ui/icons.tsx";
import {
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuLabel,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuSub,
	MenuSubContent,
	MenuSubTrigger,
	MenuTrigger,
} from "../../ui/Menu.tsx";
import type { SidebarView } from "./sidebar-view.ts";

export interface ViewOptionsMenuProps {
	view: SidebarView;
	repos: Repo[];
	onChange: (view: SidebarView) => void;
}

export function ViewOptionsMenu({ view, repos, onChange }: ViewOptionsMenuProps) {
	const [query, setQuery] = useState("");
	const existing = new Set(repos.map((repo) => repo.id));
	const activeFilter = view.projectFilter.filter((repoId) => existing.has(repoId));
	const matchingRepos = repos.filter((repo) =>
		repo.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
	);

	const toggleRepo = (repoId: RepoId, checked: boolean) => {
		const next = checked
			? [...activeFilter, repoId]
			: activeFilter.filter((candidate) => candidate !== repoId);
		onChange({ ...view, projectFilter: next });
	};

	return (
		<Menu>
			<MenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					aria-label="Sort workspaces"
					title="Sort workspaces"
					className="w-7 px-0"
				>
					<ListTodoIcon />
				</Button>
			</MenuTrigger>
			<MenuContent align="end">
				<MenuLabel>Group by</MenuLabel>
				<MenuRadioGroup
					value={view.groupBy}
					onValueChange={(value) =>
						onChange({ ...view, groupBy: value === "status" ? "status" : "project" })
					}
				>
					<MenuRadioItem value="status">Status</MenuRadioItem>
					<MenuRadioItem value="project">Project</MenuRadioItem>
				</MenuRadioGroup>
				<MenuSeparator />
				<MenuSub>
					<MenuSubTrigger>Filter by project</MenuSubTrigger>
					<MenuSubContent className="w-52">
						{repos.length >= 5 ? (
							<div className="p-1">
								<Input
									aria-label="Search projects"
									placeholder="Search projects"
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									onKeyDown={(event) => event.stopPropagation()}
								/>
							</div>
						) : null}
						{matchingRepos.length === 0 ? (
							<p className="px-2 py-1.5 text-xs text-fg-muted">No matching projects</p>
						) : (
							matchingRepos.map((repo) => (
								<MenuCheckboxItem
									key={repo.id}
									checked={activeFilter.includes(repo.id)}
									onCheckedChange={(checked) => toggleRepo(repo.id, checked === true)}
								>
									{repo.name}
								</MenuCheckboxItem>
							))
						)}
					</MenuSubContent>
				</MenuSub>
				<MenuSeparator />
				<MenuLabel>Sort by</MenuLabel>
				<MenuRadioGroup
					value={view.sortBy}
					onValueChange={(value) =>
						onChange({ ...view, sortBy: value === "created" ? "created" : "updated" })
					}
				>
					<MenuRadioItem value="updated">Updated</MenuRadioItem>
					<MenuRadioItem value="created">Created</MenuRadioItem>
				</MenuRadioGroup>
			</MenuContent>
		</Menu>
	);
}
