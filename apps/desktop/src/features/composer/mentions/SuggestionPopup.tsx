/**
 * @feature COMP-04 Suggestion popup
 * Owns: The floating list that the '@', '#' and '/' triggers share: rows, the selected row, loading
 * and empty states, the caret position it opens from, and the shared way a trigger takes its root
 * down.
 * Behaviour: ui-map.md 3.5 (the three triggers), 5.1 ('No results found').
 * Our design choice: the popup is controlled. The trigger extension owns the query, the rows and
 * the selection, and the popup only draws them and reports a clicked row. It opens below the caret
 * and flips above it when the list would not fit in the window.
 * Must handle: a loading state; an empty list with a reason; a notice above the rows, for a source
 * that is still loading or failed while other rows can be offered; rows announced as options in a
 * listbox; the selected row marked with aria-selected; a click on a row; a caret anchor; a root
 * taken down while another root is committing (see closeSuggestionRoot).
 * Test first: Given three items and selectedIndex 1, the second row has aria-selected true;
 * clicking a row calls onPick with it.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { Root } from "react-dom/client";

/**
 * Takes a trigger's popup off the page at once, then unmounts its React root after the commit that
 * may be running now. The editor is destroyed from a timer (TipTap's scheduleDestroy), which can
 * land while another root is committing; unmounting this root inside that commit leaves React's
 * work queued past the commit, and that work reads a window that may already be gone (a test's
 * teardown). A microtask runs after the commit that is running now, so the root unmounts on its own.
 */
export function closeSuggestionRoot(root: Root, host: HTMLElement | null): void {
	host?.remove();
	queueMicrotask(() => root.unmount());
}

export interface SuggestionRow {
	id: string;
	label: string;
	detail?: string;
}

export interface SuggestionAnchor {
	left: number;
	top: number;
	bottom: number;
}

export interface SuggestionPopupProps {
	rows: SuggestionRow[];
	selectedIndex: number;
	state: "loading" | "ready" | "error";
	emptyText: string;
	onPick: (row: SuggestionRow) => void;
	/** Where the caret is, in viewport coordinates. Without it the popup stays in the page flow. */
	anchor?: SuggestionAnchor;
	/** Screen reader name of the list. */
	label?: string;
	/** One line above the rows, such as a source that failed to load. */
	notice?: string;
}

export interface PopupPosition {
	left: number;
	top: number;
}

/** Places the popup under the caret, or above it when it would fall past the bottom of the window. */
export function suggestionPopupPosition(
	anchor: SuggestionAnchor,
	height: number,
	viewportHeight: number,
): PopupPosition {
	const below = anchor.bottom;
	if (below + height <= viewportHeight) return { left: anchor.left, top: below };
	return { left: anchor.left, top: Math.max(0, anchor.top - height) };
}

export function SuggestionPopup({
	rows,
	selectedIndex,
	state,
	emptyText,
	onPick,
	anchor,
	label = "Suggestions",
	notice,
}: SuggestionPopupProps) {
	const list = useRef<HTMLDivElement | null>(null);
	const [height, setHeight] = useState(0);

	useLayoutEffect(() => {
		if (anchor === undefined) return;
		const measured = list.current?.getBoundingClientRect().height ?? 0;
		setHeight(measured);
	});

	const placed =
		anchor === undefined ? undefined : suggestionPopupPosition(anchor, height, window.innerHeight);

	return (
		<div
			ref={list}
			role="listbox"
			aria-label={label}
			aria-busy={state === "loading" ? "true" : undefined}
			className="z-50 min-w-48 max-w-96 rounded-lg bg-raised p-1 text-sm text-fg shadow-popover"
			style={
				placed === undefined ? undefined : { position: "fixed", left: placed.left, top: placed.top }
			}
		>
			{notice === undefined ? null : (
				<p role="status" className="px-2 py-1.5 text-xs text-fg-muted">
					{notice}
				</p>
			)}
			{state === "loading" ? (
				<p role="status" className="px-2 py-1.5 text-xs text-fg-muted">
					Loading ...
				</p>
			) : null}
			{state !== "loading" && state !== "ready" ? (
				<p role="status" className="px-2 py-1.5 text-xs text-fg-muted">
					{emptyText}
				</p>
			) : null}
			{state === "ready" && rows.length === 0 ? (
				<p role="status" className="px-2 py-1.5 text-xs text-fg-muted">
					{emptyText}
				</p>
			) : null}
			{state === "ready"
				? rows.map((row, index) => {
						const selected = index === selectedIndex;
						return (
							<div
								key={row.id}
								role="option"
								id={`suggestion-${index}`}
								aria-selected={selected}
								tabIndex={-1}
								className={`flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 ${
									selected ? "bg-hover" : ""
								}`}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => onPick(row)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") onPick(row);
								}}
							>
								<span className="truncate">{row.label}</span>
								{row.detail === undefined ? null : (
									<span className="ml-auto truncate text-xs text-fg-muted">{row.detail}</span>
								)}
							</div>
						);
					})
				: null}
		</div>
	);
}
