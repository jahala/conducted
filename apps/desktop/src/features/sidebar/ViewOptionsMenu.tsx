/**
 * @feature NAV-03 View options menu
 * Owns: The sort icon menu above the list: Group by (Status or Project), Filter by project, Sort by
 * (Updated or Created), then "New section…" and "Add project…".
 * Behaviour: ui-map.md 4 (View options menu; the project filter is searchable from 5 repos; Sort by
 * is hidden when manual order is on). Measured from Conductor 0.92.1: the list header's actions menu ends,
 * under a separator, with "New section…" and "Add project…" (renderApp @10467029, @10495160).
 * Our design choice: The user's drag order is saved, so Sort by goes away while manual order is on;
 * the saved order is the only order that applies then.
 * Must handle: Fewer than 5 repos (no search box in the filter); a filter that names a removed repo
 * is dropped; the menu shows the current choice with a check mark; Sort by is hidden while manual
 * order is on.
 * Test first: Choosing Group by Project calls onChange with groupBy 'project'; Sort by is absent
 * when manualOrder is true.
 */

import type { RepoId } from "@conducted/shared";
import { useState } from "react";
import type { Repo } from "../../core/model.ts";
import { Button } from "../../ui/Button.tsx";
import { Input } from "../../ui/Input.tsx";
import { FolderPlusIcon, ListTodoIcon, PlusIcon } from "../../ui/icons.tsx";
import {
	Menu,
	MenuCheckboxItem,
	MenuContent,
	MenuItem,
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
	onNewSection: () => void;
	/** Runs the "Add project" command, which opens the add-project menu under this row. */
	onAddProject: () => void;
}

export function ViewOptionsMenu({
	view,
	repos,
	onChange,
	onNewSection,
	onAddProject,
}: ViewOptionsMenuProps) {
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
				{view.manualOrder ? null : (
					<>
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
					</>
				)}
				<MenuSeparator />
				<MenuItem icon={<PlusIcon />} onSelect={onNewSection}>
					New section…
				</MenuItem>
				<MenuItem icon={<FolderPlusIcon />} onSelect={onAddProject}>
					Add project…
				</MenuItem>
			</MenuContent>
		</Menu>
	);
}
