/**
 * @feature WS-09 Workspace status as a pure function
 * Owns: the matrix-style status mark a local workspace's sidebar row and Home card draw while the
 * Experimental setting "Workspace status matrix for local workspaces" is on.
 * Behaviour: Conductor's matrix (renderApp @10236000 to @10244000, and the setting at @11107518): a
 * 16px square of sixteen small squares in four rows, only the border twelve for an unstarted
 * workspace; a finer checkerboard over a merged workspace ("workspace-status-matrix-merged-
 * pattern"); an X of squares in the danger colour for failing checks or a failed workspace
 * ("workspace-status-matrix-error-pattern"); the squares animate while the workspace works, sets
 * up or waits. Its colours are the status mark's (WorkspaceStatusIcon).
 * Our design choice: the working animation is one staggered pulse, where Conductor gives working,
 * setting up and waiting each its own choreography. Conductor's arrow overlay marks a routine's
 * runs, which stay out (D018).
 * Must handle: reduced motion (the squares hold still), an unknown status (the plain squares), and
 * 300 rows (one small SVG each, no timers).
 * Test first: a merged workspace draws the merged pattern, and a failing one the error pattern.
 */
import type { WorkspaceStatus } from "../../core/model.ts";
import { cn } from "../../ui/cn.ts";

/** The 4 by 4 squares: 1.5 wide, 3 apart, starting 2.5 in. */
const CELL = 1.5;
const ORIGIN = 2.5;
const SQUARES = Array.from({ length: 16 }, (_, index) => ({
	index,
	column: index % 4,
	row: Math.floor(index / 4),
	x: ORIGIN + (index % 4) * CELL * 2,
	y: ORIGIN + Math.floor(index / 4) * CELL * 2,
}));
/** The finer 7 by 7 grid the merged checkerboard sits on. */
const FINE = Array.from({ length: 49 }, (_, index) => ({
	column: index % 7,
	row: Math.floor(index / 7),
	x: ORIGIN + (index % 7) * CELL,
	y: ORIGIN + Math.floor(index / 7) * CELL,
}));
/** The squares of the X the error pattern draws. */
const ERROR_SQUARES = new Set([0, 3, 5, 6, 9, 10, 12, 15]);

const pathOf = (cells: readonly { x: number; y: number }[]): string =>
	cells.map(({ x, y }) => `M${x} ${y}h${CELL}v${CELL}h-${CELL}Z`).join("");

const ALL = pathOf(SQUARES);
const BORDER = pathOf(
	SQUARES.filter(({ column, row }) => column === 0 || column === 3 || row === 0 || row === 3),
);
const CHECKERBOARD = pathOf(FINE.filter(({ column, row }) => (column + row) % 2 === 0));
const ERROR_X = pathOf(SQUARES.filter(({ index }) => ERROR_SQUARES.has(index)));

/** Statuses whose squares animate. */
function isActive(status: WorkspaceStatus | null): boolean {
	if (status === null) return false;
	if (status.kind === "agent") {
		return (
			status.label === "working" || status.label === "cancelling" || status.label === "waiting"
		);
	}
	if (status.kind === "lifecycle") {
		return (
			status.label === "initializing" ||
			status.label === "setting_up" ||
			status.label === "archiving"
		);
	}
	return false;
}

/** The status mark's colour, for the squares. */
function toneOf(status: WorkspaceStatus | null): string {
	if (status === null) return "text-fg-muted";
	if (status.kind === "lifecycle" && status.label === "failed") return "text-danger";
	if (status.kind !== "git") return "text-fg-muted";
	switch (status.label) {
		case "merged":
			return "text-merged";
		case "ready_to_merge":
			return "text-success";
		case "in_merge_queue":
		case "checks_running":
			return "text-status-progress";
		case "merge_conflict":
			return "text-accent";
		case "checks_failing":
			return "text-danger";
		default:
			return "text-fg-muted";
	}
}

export function WorkspaceStatusMatrix({
	status,
	hasUnread,
	className,
}: {
	status: WorkspaceStatus | null;
	hasUnread: boolean;
	className?: string;
}) {
	const active = isActive(status);
	const failing =
		(status?.kind === "lifecycle" && status.label === "failed") ||
		(status?.kind === "git" && status.label === "checks_failing");
	const merged = status?.kind === "git" && status.label === "merged";
	const unstarted = status?.kind === "lifecycle" && status.label === "unstarted";
	const toned = status?.kind === "git" && toneOf(status) !== "text-fg-muted";
	return (
		<svg
			data-testid="workspace-status-matrix"
			data-motion={active ? "active" : "steady"}
			aria-hidden="true"
			viewBox="0 0 16 16"
			width="16"
			height="16"
			fill="none"
			className={cn("block size-4 shrink-0", toneOf(status), className)}
		>
			{active ? (
				SQUARES.map(({ index, x, y }) => (
					<rect
						key={index}
						x={x}
						y={y}
						width={CELL}
						height={CELL}
						className="animate-pulse fill-current motion-reduce:animate-none"
						style={{ animationDelay: `${((index * 7) % 16) * 90}ms` }}
					/>
				))
			) : (
				<path
					d={unstarted ? BORDER : ALL}
					data-testid="workspace-status-matrix-base"
					className={cn(
						"fill-current",
						failing ? "opacity-30" : merged ? "opacity-50" : toned || hasUnread ? "" : "opacity-50",
					)}
				/>
			)}
			{merged && !failing ? (
				<path
					d={CHECKERBOARD}
					data-testid="workspace-status-matrix-merged-pattern"
					className="fill-current"
				/>
			) : null}
			{failing ? (
				<path
					d={ERROR_X}
					data-testid="workspace-status-matrix-error-pattern"
					className="fill-current text-danger"
				/>
			) : null}
		</svg>
	);
}
