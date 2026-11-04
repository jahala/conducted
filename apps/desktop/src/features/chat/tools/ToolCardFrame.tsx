/**
 * @feature CHAT-08 Tool card frame
 * Owns: the shared look of every tool card: a header row with an icon, the tool's title and a one-line summary,
 * a status mark, a collapsible body and an optional footer.
 * Behaviour: ui-map.md 8 (the Tool family: header, title, description, content, footer, is the base of tool
 * cards), 3.3 (tool cards).
 * Our design choice: a card is collapsed by default unless it needs attention (running or failed). The summary
 * is monospace because it is usually a path or a command. Status is a word as well as a mark.
 * Must handle: running (spinner, "Running"); failed (danger text "Failed"); a very long summary truncates;
 * no body (the header is not a button); keyboard toggle with Enter and Space; `aria-expanded` on the toggle.
 * Test first: a done card starts collapsed and shows its body after the toggle is clicked.
 */
import { type ReactNode, useState } from "react";
import type { ToolCallView } from "../../../core/model.ts";
import { cn } from "../../../ui/cn.ts";
import { ChevronDownIcon, ChevronRightIcon } from "../../../ui/icons.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";

export type ToolStatus = "running" | "done" | "error";

/** Running until a result arrives; failed when the result says so. */
export function toolStatus(call: ToolCallView): ToolStatus {
	if (call.result === null) return "running";
	return call.result.isError ? "error" : "done";
}

export interface ToolCardFrameProps {
	title: string;
	summary?: string;
	status: ToolStatus;
	icon?: ReactNode;
	body?: ReactNode;
	footer?: ReactNode;
}

export function ToolCardFrame({ title, summary, status, icon, body, footer }: ToolCardFrameProps) {
	const [open, setOpen] = useState(status !== "done");
	const header = (
		<>
			{body ? open ? <ChevronDownIcon /> : <ChevronRightIcon /> : <span className="size-4" />}
			{icon ? (
				<span className="flex size-4 items-center justify-center text-fg-subtle">{icon}</span>
			) : null}
			<span className="text-sm font-medium text-fg">{title}</span>
			{summary ? (
				<span className="min-w-0 flex-1 truncate text-left font-mono text-xs text-fg-muted">
					{summary}
				</span>
			) : (
				<span className="flex-1" />
			)}
			{status === "running" ? <Spinner label={`${title} is running`} size="sm" /> : null}
			{status === "error" ? <span className="text-xs font-medium text-danger">Failed</span> : null}
		</>
	);
	return (
		<div
			className={cn(
				"rounded-lg border border-border bg-surface",
				status === "error" && "border-danger",
			)}
		>
			{body ? (
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="flex h-9 w-full items-center gap-2 rounded-lg px-2"
				>
					{header}
				</button>
			) : (
				<div className="flex h-9 items-center gap-2 px-2">{header}</div>
			)}
			{body && open ? <div className="border-t border-border p-3 text-sm">{body}</div> : null}
			{footer ? (
				<div className="border-t border-border px-3 py-2 text-xs text-fg-muted">{footer}</div>
			) : null}
		</div>
	);
}
