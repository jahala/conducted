/**
 * @feature NAV-03 Sidebar navigation rows
 * Owns: the rows under the window controls: Home, Create and Search.
 * Behaviour: ui-map.md 4 item 3 (nav rows, each with a hover shortcut hint: Home, Create, Search; Dashboard
 * appears behind a setting).
 * Our design choice: the current route's row is marked with a filled background, not the accent. Search opens
 * the command palette through the overlay store. The Dashboard row and the shortcut hints are not here yet:
 * the row needs the "Dashboard" setting (SET-01) and the hints need the command registry (NAV-07), and neither
 * is guessed.
 * Must handle: keyboard focus ring on every row; the active row for /all-workspaces and /create; a row that
 * is a link versus a button (Search) looks the same.
 * Test first: renders links to /all-workspaces and /create, and a Search button that opens the palette.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useOverlayStore } from "../../app/overlay-store.ts";
import { cn } from "../../ui/cn.ts";
import { HomeIcon, PlusIcon, SearchIcon } from "../../ui/icons.tsx";

const rowClass =
	"flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm font-medium text-fg-muted transition-colors hover:bg-hover hover:text-fg";

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
	return (
		<>
			<span className="flex size-4 items-center justify-center">{icon}</span>
			<span className="truncate">{children}</span>
		</>
	);
}

export function SidebarNav() {
	const showOverlay = useOverlayStore((state) => state.show);
	return (
		<nav aria-label="Main" className="flex shrink-0 flex-col gap-0.5 p-2">
			<Link
				to="/all-workspaces"
				className={rowClass}
				activeProps={{ className: cn(rowClass, "bg-active text-fg") }}
			>
				<Row icon={<HomeIcon />}>Home</Row>
			</Link>
			<Link
				to="/create"
				className={rowClass}
				activeProps={{ className: cn(rowClass, "bg-active text-fg") }}
			>
				<Row icon={<PlusIcon />}>New workspace</Row>
			</Link>
			<button type="button" className={rowClass} onClick={() => showOverlay("palette")}>
				<Row icon={<SearchIcon />}>Search</Row>
			</button>
		</nav>
	);
}
