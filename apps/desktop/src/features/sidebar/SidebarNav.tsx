/**
 * @feature NAV-03 Sidebar navigation rows
 * @feature NAV-16 Draft markers on the Create row and on workspaces
 * @feature CLOUD-19 Create cloud workspaces: the organisation switcher and the new-workspace page in cloud mode
 * Owns: the rows under the window controls: the organisation switcher (CLOUD-19), Dashboard (with
 * its setting on), Home, Create and Search, and the Create row's draft marker.
 * Behaviour: ui-map.md 4 item 3 (nav rows, each with a hover shortcut hint: Home, Create, Search; Dashboard
 * appears behind a setting) and 4.3 (Create shows a draft marker when the new-workspace draft is non-empty).
 * The switcher is the block's first row, as Conductor mounts it above Dashboard (renderApp `R8a`).
 * Our design choice: the current route's row is marked with a filled background, not the accent. Search opens
 * the command palette through the overlay store. Shortcut hints read the live binding from the command
 * registry so they follow the user's rebinds.
 * Must handle: keyboard focus ring on every row; the active row for /all-workspaces and /create; a row that
 * is a link versus a button (Search) looks the same; the Dashboard row hidden unless the setting is on.
 * Test first: renders links to /all-workspaces and /create, and a Search button that opens the palette.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { useLiveShortcut, useSetting } from "../../core/hooks.ts";
import { cn } from "../../ui/cn.ts";
import { HomeIcon, ListTodoIcon, PlusIcon, SearchIcon } from "../../ui/icons.tsx";
import { Kbd } from "../../ui/Kbd.tsx";
import { useNewWorkspaceDraft } from "../composer/draft-sources.ts";
import { DraftMarker } from "./DraftMarker.tsx";
import { OrganizationSwitcher } from "./OrganizationSwitcher.tsx";

/** Conductor's nav row: 6px padding, 8px gap, 6px radius, the hover tint, a 16px icon box. */
const rowClass =
	"group flex h-8 w-full min-w-0 items-center gap-2 rounded-md p-1.5 text-left text-sm text-sidebar-fg transition-colors hover:bg-hover";

function Row({
	icon,
	shortcut,
	marker,
	children,
}: {
	icon: ReactNode;
	shortcut: string | null;
	marker?: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			<span className="flex size-4 items-center justify-center">{icon}</span>
			<span className="min-w-0 flex-1 truncate">{children}</span>
			{marker}
			{shortcut === null ? null : (
				<span aria-hidden="true" className="hidden shrink-0 group-hover:inline-flex">
					<Kbd>{shortcut}</Kbd>
				</span>
			)}
		</>
	);
}

export function SidebarNav() {
	const showOverlay = useOverlayStore((state) => state.show);
	const dashboardEnabled = useSetting<boolean>("dashboard_enabled");
	const homeShortcut = useLiveShortcut("nav.home");
	const createShortcut = useLiveShortcut("workspace.create");
	const searchShortcut = useLiveShortcut("app.commandPalette");
	const newWorkspaceDraft = useNewWorkspaceDraft();
	return (
		<nav aria-label="Main" className="flex shrink-0 flex-col gap-0.5 border-b border-border p-1.5">
			<OrganizationSwitcher />
			{dashboardEnabled ? (
				<Link
					to="/dashboard"
					className={rowClass}
					activeProps={{ className: cn(rowClass, "bg-hover text-fg") }}
				>
					<Row icon={<ListTodoIcon />} shortcut={null}>
						Dashboard
					</Row>
				</Link>
			) : null}
			<Link
				to="/all-workspaces"
				className={rowClass}
				activeProps={{ className: cn(rowClass, "bg-hover text-fg") }}
			>
				<Row icon={<HomeIcon />} shortcut={homeShortcut}>
					Home
				</Row>
			</Link>
			<Link
				to="/create"
				className={rowClass}
				activeProps={{ className: cn(rowClass, "bg-hover text-fg") }}
			>
				<Row
					icon={<PlusIcon />}
					shortcut={createShortcut}
					marker={<DraftMarker place="create-row" draft={newWorkspaceDraft.draft} />}
				>
					Create
				</Row>
			</Link>
			<button type="button" className={rowClass} onClick={() => showOverlay("palette")}>
				<Row icon={<SearchIcon />} shortcut={searchShortcut}>
					Search
				</Row>
			</button>
		</nav>
	);
}
