/**
 * @feature NAV-03 Sidebar
 * Owns: the left sidebar layout: navigation rows on top, the workspace list in the middle, and a footer with
 * update notice, resource usage, Settings and "Add project".
 * Behaviour: ui-map.md 4 (top to bottom: window controls row, organization switcher, nav rows, Pinned, sections,
 * main list, footer). The window controls row is the floating <ShellControls> in app/. The organization
 * switcher is cloud only and is left out.
 * Our design choice: each region fails on its own inside <NotBuiltYet>, so a missing hook shows one line of text,
 * not a broken sidebar. A footer region whose feature is not built (the update notice, APP-06, and the
 * resource table, APP-07) shows its one-line "Not built yet" note until it is. Settings is in the footer
 * because the account menu that holds it in Conductor is a cloud feature we leave out.
 * Must handle: sidebar narrower than a row's content (names truncate); no projects (empty state in the list
 * region); loading and error in the list region.
 * Test first: renders the navigation rows and, with no projects, the "No projects yet" empty state.
 */
import { Link } from "@tanstack/react-router";
import { GearIcon } from "../../ui/icons.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { MacosVersionWarningNotice } from "../updates/MacosVersionWarning.tsx";
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
			<div className="flex shrink-0 flex-col gap-1 border-t border-border px-2 py-2">
				<MacosVersionWarningNotice />
				<NotBuiltYet area="Update notice" variant="inline">
					<UpdateNotice />
				</NotBuiltYet>
				<NotBuiltYet area="Resource usage" variant="inline">
					<ResourceUsageTable />
				</NotBuiltYet>
				<div className="flex items-center gap-1">
					<NotBuiltYet area="Add project" variant="inline">
						<AddProjectButton
							variant="ghost"
							size="sm"
							className="min-w-0 justify-start text-sidebar-fg-muted"
						/>
					</NotBuiltYet>
					<span className="flex-1" />
					<Link
						to="/settings"
						aria-label="Settings"
						title="Settings"
						className="flex size-7 shrink-0 items-center justify-center rounded-md text-sidebar-fg-muted transition-colors hover:bg-hover hover:text-fg"
					>
						<GearIcon />
					</Link>
				</div>
			</div>
		</div>
	);
}
