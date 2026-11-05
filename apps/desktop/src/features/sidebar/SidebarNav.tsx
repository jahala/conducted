/**
 * @feature NAV-03 Sidebar navigation rows
 * Owns: the rows under the window controls: Dashboard (with its setting on), Home, Create and Search.
 * Behaviour: ui-map.md 4 item 3 (nav rows, each with a hover shortcut hint: Home, Create, Search; Dashboard
 * appears behind a setting).
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

const rowClass =
	"group flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg";

function Row({
	icon,
	shortcut,
	children,
}: {
	icon: ReactNode;
	shortcut: string | null;
	children: ReactNode;
}) {
	return (
		<>
			<span className="flex size-4 items-center justify-center">{icon}</span>
			<span className="min-w-0 flex-1 truncate">{children}</span>
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
	return (
		<nav aria-label="Main" className="flex shrink-0 flex-col gap-0.5 p-2">
			{dashboardEnabled ? (
				<Link
					to="/dashboard"
					className={rowClass}
					activeProps={{ className: cn(rowClass, "bg-active text-fg") }}
				>
					<Row icon={<ListTodoIcon />} shortcut={null}>
						Dashboard
					</Row>
				</Link>
			) : null}
			<Link
				to="/all-workspaces"
				className={rowClass}
				activeProps={{ className: cn(rowClass, "bg-active text-fg") }}
			>
				<Row icon={<HomeIcon />} shortcut={homeShortcut}>
					Home
				</Row>
			</Link>
			<Link
				to="/create"
				className={rowClass}
				activeProps={{ className: cn(rowClass, "bg-active text-fg") }}
			>
				<Row icon={<PlusIcon />} shortcut={createShortcut}>
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
