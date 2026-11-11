/**
 * @feature NAV-03 Workspace list
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: loading projects and workspaces and choosing what the list region shows: skeleton rows, an error with
 * retry, an empty state, or the grouped list. CLOUD-19: the list holds the active organisation's
 * workspaces: this Mac's while it is active, and the paired Worker's while that is.
 * Behaviour (CLOUD-19): Conductor's sidebar filter, main @922363.
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
import { useMemo } from "react";
import { useStore } from "zustand";
import type { Loadable } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";
import { useOrganizations, useRepos, useWorkspaces } from "../../core/hooks.ts";
import type { Workspace } from "../../core/model.ts";
import { LOCAL_ORGANIZATION, workspaceInOrganization } from "../../core/organization.ts";
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
	const allWorkspaces = useWorkspaces();
	const organizations = useOrganizations();
	// Until a stored cloud choice is confirmed by the pairing, the list is this Mac's, as Conductor
	// lists local workspaces while no organisation is known (main `wue`).
	const organization =
		organizations.state === "ready" ? organizations.data.active : LOCAL_ORGANIZATION;
	const workspaces = useMemo<Loadable<Workspace[]>>(
		() =>
			allWorkspaces.state === "ready"
				? {
						state: "ready",
						data: allWorkspaces.data.filter((workspace) =>
							workspaceInOrganization(workspace, organization),
						),
					}
				: allWorkspaces,
		[allWorkspaces, organization],
	);
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
