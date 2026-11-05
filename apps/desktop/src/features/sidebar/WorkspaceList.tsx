/**
 * @feature NAV-03 Workspace list
 * Owns: loading projects and workspaces and choosing what the list region shows: skeleton rows, an error with
 * retry, an empty state, or the grouped list.
 * Behaviour: ui-map.md 4 items 4 to 7 (Pinned, sections, main list grouped by status or project).
 * Our design choice: this component only decides the state and hands the saved sections to
 * <GroupedWorkspaces>, which owns the rows.
 * "Try again" starts the failed service again; it does not reload the window.
 * Must handle: loading (skeleton rows with role="status", aria-label "Loading workspaces"); error (message and
 * "Try again"); no projects; projects but no workspaces; archived workspaces are not listed here (they are
 * reached from Home, the palette and Passport).
 * Test first: with useRepos ready and empty, renders "No projects yet"; with one repo and no workspaces,
 * renders "No workspaces yet".
 */
import type { Result } from "@conducted/shared";
import { useStore } from "zustand";
import { useServices } from "../../core/context.tsx";
import { useRepos, useWorkspaces } from "../../core/hooks.ts";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { GroupedWorkspaces } from "./GroupedWorkspaces.tsx";
import { SidebarEmptyState } from "./SidebarEmptyState.tsx";

function ListSkeleton() {
	return (
		<div className="flex flex-col gap-1 p-2">
			{["a", "b", "c", "d"].map((key) => (
				<Skeleton key={key} className="h-8" />
			))}
		</div>
	);
}

export function WorkspaceList() {
	const repos = useRepos();
	const workspaces = useWorkspaces();
	const services = useServices().services;
	const { repo, workspace } = services;
	const sections = useStore(services.sections.store, (state) => state.sections);
	// "Try again" reads the table again. A failure shows as a toast, because the card is the failure.
	const retry = (title: string, start: () => Promise<Result<void>>) => () => {
		void start().then((result) => {
			if (!result.ok) toastError(title, result.error);
		});
	};
	return (
		<LoadableView
			value={repos}
			loadingLabel="Loading workspaces"
			loading={<ListSkeleton />}
			errorTitle="Couldn't load projects"
			onRetry={retry("Couldn't load the projects", () => repo.start())}
			compact
		>
			{(repoRows) =>
				repoRows.length === 0 ? (
					<SidebarEmptyState kind="no-projects" />
				) : (
					<LoadableView
						value={workspaces}
						loadingLabel="Loading workspaces"
						loading={<ListSkeleton />}
						errorTitle="Couldn't load workspaces"
						onRetry={retry("Couldn't load the workspaces", () => workspace.start())}
						compact
					>
						{(workspaceRows) =>
							workspaceRows.length === 0 ? (
								<SidebarEmptyState kind="no-workspaces" />
							) : (
								<GroupedWorkspaces
									repos={repoRows}
									workspaces={workspaceRows}
									sections={sections}
								/>
							)
						}
					</LoadableView>
				)
			}
		</LoadableView>
	);
}
