/**
 * @feature NAV-03 Sidebar section header marks
 * Owns: the count and the chevron at the end of every sidebar list header (Pinned, the user's sections,
 * the status and project groups).
 * Behaviour: measured from Conductor 0.92.1. Pinned and the user's sections (renderApp @10461981,
 * @10458105): a collapsed header shows its count only while hovered, in 12px muted text; the 12px chevron
 * at the right end points right while collapsed and shows, pointing down, only while an open header is
 * hovered. The status groups (WTa, near @10495900): the count of a collapsed group always shows, in 11px
 * monospace, and the chevron sits right after it, shown only on hover. The project groups (ZTa,
 * @10511900): the count as in a status group; the project's avatar turns into the chevron on hover.
 * Must handle: the header's own hover group (`group/header`), so a hovered row below does not light it.
 * Test first: a collapsed header shows a right chevron and an open one shows none until hovered.
 */
import { cn } from "../../ui/cn.ts";
import { ChevronDownIcon, ChevronRightIcon } from "../../ui/icons.tsx";

/** The workspace count of a collapsed header. */
export function HeaderCount({
	open,
	count,
	variant = "section",
}: {
	open: boolean;
	count: number;
	/** "section": 12px, on hover (Pinned, sections). "group": 11px monospace, always (status, project). */
	variant?: "section" | "group";
}) {
	if (open || count === 0) return null;
	return (
		<span
			className={cn(
				"shrink-0 text-sidebar-fg-muted",
				variant === "section"
					? "text-xs opacity-0 group-hover/header:opacity-100"
					: "font-mono text-2xs font-normal",
			)}
		>
			{count}
		</span>
	);
}

/**
 * "section": at the right end, right while collapsed; down, and only on hover, while open.
 * "group": right after the count, only on hover, right or down.
 */
export function HeaderChevron({
	open,
	variant = "section",
}: {
	open: boolean;
	variant?: "section" | "group";
}) {
	const hoverOnly = variant === "group" || open;
	return (
		<span
			aria-hidden="true"
			data-chevron={open ? "open" : "collapsed"}
			className={cn(
				"flex shrink-0 text-sidebar-fg-muted",
				variant === "section" && "ml-auto",
				hoverOnly && "opacity-0 group-hover/header:opacity-100",
			)}
		>
			{open ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
		</span>
	);
}
