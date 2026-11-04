/**
 * @feature NAV-03 Sidebar
 * Owns: the left sidebar layout: navigation rows on top, the workspace list in the middle, and a footer with
 * update notice, resource usage and "Add project".
 * Behaviour: ui-map.md 4 (top to bottom: window controls row, organization switcher, nav rows, Pinned, sections,
 * main list, footer). The window controls row is the floating <ShellControls> in app/. The organization
 * switcher is cloud only and is left out.
 * Our design choice: each region fails on its own inside <NotBuiltYet>, so a missing hook shows one line of text,
 * not a broken sidebar. The footer shows only things that exist: the update notice appears when an update is
 * waiting, the resource table when its setting is on.
 * Must handle: sidebar narrower than a row's content (names truncate); no projects (empty state in the list
 * region); loading and error in the list region; footer regions are hidden when they have nothing to show.
 * Test first: renders the navigation rows and, with no projects, the "No projects yet" empty state.
 */

import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { UpdateNotice } from "../updates/UpdateNotice.tsx";
import { AddProjectButton } from "./AddProjectButton.tsx";
import { ResourceUsageTable } from "./ResourceUsageTable.tsx";
import { SidebarNav } from "./SidebarNav.tsx";
import { WorkspaceList } from "./WorkspaceList.tsx";

export function Sidebar() {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<SidebarNav />
			<div className="min-h-0 flex-1 overflow-y-auto">
				<NotBuiltYet area="Workspaces">
					<WorkspaceList />
				</NotBuiltYet>
			</div>
			<div className="flex shrink-0 flex-col gap-1 border-t border-border p-2">
				<NotBuiltYet area="Update notice" variant="inline">
					<UpdateNotice />
				</NotBuiltYet>
				<NotBuiltYet area="Resource usage" variant="inline">
					<ResourceUsageTable />
				</NotBuiltYet>
				<NotBuiltYet area="Add project" variant="inline">
					<AddProjectButton variant="ghost" className="w-full justify-start" />
				</NotBuiltYet>
			</div>
		</div>
	);
}
