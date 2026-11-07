/**
 * @feature NAV-03 Sidebar
 * Owns: the left sidebar layout: navigation rows on top, the workspace list in the middle, and a footer with
 * the update notice above one row holding Help and Settings.
 * Behaviour: ui-map.md 4 (top to bottom: window controls row, organization switcher, nav rows, Pinned, sections,
 * main list, footer). The window controls row is the floating <ShellControls> in app/. The organization
 * switcher is cloud only and is left out.
 * Our design choice: each region fails on its own inside <NotBuiltYet>, so a missing hook shows one line of text,
 * not a broken sidebar. A footer region whose feature is not built (the update notice, APP-06) shows its
 * one-line "Not built yet" note until it is. The resource usage chip lives in the top strip
 * (app/ShellControls.tsx), where Conductor mounts it.
 * Measured from Conductor 0.92.1 (renderApp @10375068): the footer row is 16px by 12px padding over a top
 * rule; the plan badge sits at the left (left out, D025) and Help and Settings sit at the right, 20px apart,
 * as 16px muted icons. Adding a project lives in the list header menu, the palette and Cmd+Alt+A, as in
 * Conductor; its footer has no add-project button.
 * Must handle: sidebar narrower than a row's content (names truncate); no projects (empty state in the list
 * region); loading and error in the list region.
 * Test first: renders the navigation rows and, with no projects, the "Add a project to get started."
 * empty state.
 */
import { Link } from "@tanstack/react-router";
import { GearIcon } from "../../ui/icons.tsx";
import { NotBuiltYet } from "../../ui/not-built-yet.tsx";
import { MacosVersionWarningNotice } from "../updates/MacosVersionWarning.tsx";
import { UpdateNotice } from "../updates/UpdateNotice.tsx";
import { HelpMenu } from "./HelpMenu.tsx";
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
			<div className="flex shrink-0 flex-col">
				<div className="flex flex-col gap-1 px-2 pb-2 empty:hidden">
					<MacosVersionWarningNotice />
					<NotBuiltYet area="Update notice" variant="inline">
						<UpdateNotice />
					</NotBuiltYet>
				</div>
				<div className="flex items-center justify-end gap-5 border-t border-border px-4 py-3">
					<HelpMenu />
					<Link
						to="/settings"
						aria-label="Settings"
						title="Settings"
						className="flex size-4 shrink-0 items-center justify-center rounded-sm text-sidebar-fg-muted transition-colors hover:text-fg"
					>
						<GearIcon />
					</Link>
				</div>
			</div>
		</div>
	);
}
