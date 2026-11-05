/**
 * @feature NAV-03 Workspace list
 * Owns: loading projects and workspaces and choosing what the list region shows: skeleton rows, an error with
 * retry, an empty state, or the grouped list.
 * Behaviour: ui-map.md 4 items 4 to 7 (Pinned, sections, main list grouped by status or project).
 * Our design choice: this component only decides the state. The rows are in <GroupedWorkspaces>.
 * Must handle: loading (skeleton rows with role="status", aria-label "Loading workspaces"); error (message and
 * "Try again"); no projects; projects but no workspaces; archived workspaces are not listed here (they are
 * reached from Home, the palette and Passport).
 * Test first: with useRepos ready and empty, renders "No projects yet"; with one repo and no workspaces,
 * renders "No workspaces yet".
 */
import { useRepos, useWorkspaces } from "../../core/hooks.ts";
import { LoadableView } from "../../ui/LoadableView.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
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
	return (
		<LoadableView
			value={repos}
			loadingLabel="Loading workspaces"
			loading={<ListSkeleton />}
			errorTitle="Couldn't load projects"
			onRetry={() => window.location.reload()}
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
						onRetry={() => window.location.reload()}
						compact
					>
						{(workspaceRows) =>
							workspaceRows.length === 0 ? (
								<SidebarEmptyState kind="no-workspaces" />
							) : (
								<GroupedWorkspaces repos={repoRows} workspaces={workspaceRows} />
							)
						}
					</LoadableView>
				)
			}
		</LoadableView>
	);
}
