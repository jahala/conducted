/**
 * @feature APP-05 Panel and section headers
 * Owns: the header row of a panel (title, actions) and the small label row that opens a group in a list.
 * Behaviour: ui-map.md 1.1 (regions), 4 (sidebar sections with a count and actions).
 * Our design choice: a panel header is text-sm semibold; a section header is text-xs medium muted. Size and
 * weight carry the hierarchy, not colour.
 * Must handle: a long title truncates; actions stay visible; `dragRegion` lets the macOS overlay title bar
 * be dragged from this row (data-tauri-drag-region).
 * Test first: renders the title and the actions; sets data-tauri-drag-region when asked.
 */
import type { ReactNode } from "react";
import { cn } from "./cn.ts";

export interface PanelHeaderProps {
	title: ReactNode;
	actions?: ReactNode;
	dragRegion?: boolean;
	className?: string;
}

export function PanelHeader({ title, actions, dragRegion = false, className }: PanelHeaderProps) {
	return (
		<header
			{...(dragRegion ? { "data-tauri-drag-region": true } : {})}
			className={cn(
				"flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border px-3",
				className,
			)}
		>
			<h2 className="min-w-0 truncate text-sm font-semibold text-fg">{title}</h2>
			{actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
		</header>
	);
}

export interface SectionHeaderProps {
	label: ReactNode;
	count?: number;
	actions?: ReactNode;
	className?: string;
}

export function SectionHeader({ label, count, actions, className }: SectionHeaderProps) {
	return (
		<div className={cn("flex h-7 items-center justify-between gap-2 px-2", className)}>
			<span className="truncate text-xs font-medium text-fg-subtle">
				{label}
				{count === undefined ? null : <span className="ml-1.5 font-normal">{count}</span>}
			</span>
			{actions ? <span className="flex items-center gap-1">{actions}</span> : null}
		</div>
	);
}
