/**
 * @feature CHAT-08 Tool card frame
 * Owns: the shared look of every tool call: one quiet row with the tool's icon, a plain title and a short
 * summary chip, a status mark, and a body that opens under the row; plus the scrolling text block
 * (`ToolOutput`) the cards show output in.
 * Behaviour: measured from Conductor 0.92.1's collapsible tool row (renderApp @8747084, ui-dimensions.md 5):
 * a 32px row (6px top and bottom, 8px sides pulled out by 8px so the text lines up with the reply), 4px
 * radius, a muted hover fill at 50%; a 12px icon that turns into a chevron on hover; the title in text-sm;
 * the summary in medium monospace text-xs, at most 400px wide, hidden while the row is open unless the card
 * keeps it; the body 8px below in a bordered well with 12px padding.
 * Our design choice: a card is collapsed by default unless it needs attention (running or failed). Status is
 * a word as well as a mark. `expandAll` opens every card, from the "Expand all tool calls" setting and its
 * Ctrl+O shortcut. A card's actions (its footer) sit at the end of the open body, in the interface font.
 * The reading helpers below are shared by the cards because tool input and output arrive as untyped data.
 * Must handle: running (spinner, "Running"); failed (danger title and "Failed"); a very long summary
 * truncates; no body (the row is not a button); keyboard toggle with Enter and Space; `aria-expanded` on
 * the toggle; a card whose expansion changes while it is on screen.
 * Test first: a done card starts collapsed and shows its body after the toggle is clicked.
 */
import { type ReactNode, useEffect, useState } from "react";
import type { ToolCallView } from "../../../core/model.ts";
import { cn } from "../../../ui/cn.ts";
import { ChevronDownIcon, ChevronRightIcon, WrenchIcon } from "../../../ui/icons.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { useWorkspaceLinks } from "../workspace-links.ts";
import { TOOL_ICONS, useToolKind } from "./tool-icons.tsx";

export type ToolStatus = "running" | "done" | "error";

/** Running until a result arrives; failed when the result says so. */
export function toolStatus(call: ToolCallView): ToolStatus {
	if (call.result === null) return "running";
	return call.result.isError ? "error" : "done";
}

/** Tool input and output arrive as untyped data from the agent; these readers stay safe on any shape. */
export function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

export function textField(value: unknown, ...keys: string[]): string | null {
	const record = asRecord(value);
	for (const key of keys) {
		const found = record[key];
		if (typeof found === "string") return found;
		if (typeof found === "number") return String(found);
	}
	return null;
}

export function numberField(value: unknown, ...keys: string[]): number | null {
	const record = asRecord(value);
	for (const key of keys) {
		const found = record[key];
		if (typeof found === "number" && Number.isFinite(found)) return found;
	}
	return null;
}

export function boolField(value: unknown, ...keys: string[]): boolean {
	const record = asRecord(value);
	return keys.some((key) => record[key] === true);
}

export function arrayField(value: unknown, key: string): unknown[] {
	const found = asRecord(value)[key];
	return Array.isArray(found) ? found : [];
}

/** Splits text into lines, keeping a trailing empty line out but blank lines inside intact. */
export function textLines(text: string): string[] {
	if (text.length === 0) return [];
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

/** Agent output still carries terminal colour codes; the cards never show them raw. */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

export function stripAnsi(text: string): string {
	return text.replace(ANSI, "");
}

export function formatJson(value: unknown): string {
	if (value === undefined || value === null) return "";
	try {
		return JSON.stringify(value, null, 2) ?? "";
	} catch {
		return String(value);
	}
}

/** Opens a workspace file in a centre tab, as the URL state the workspace route reads (NAV-02). */
export function FileLink({
	path,
	mode = "diff",
	children,
}: {
	path: string;
	mode?: "diff" | "edit";
	children?: ReactNode;
}) {
	const links = useWorkspaceLinks();
	return (
		<button
			type="button"
			title={path}
			onClick={() => links.openFile(path, mode)}
			className={cn(
				"max-w-full truncate rounded-xs text-xs text-link hover:underline",
				children === undefined && "font-mono",
			)}
		>
			{children ?? path}
		</button>
	);
}

/** Stable keys for repeated text and objects, so a list never keys on its array index. */
export function withKeys<T>(
	items: readonly T[],
	keyOf: (item: T) => string,
	prefix: string,
): { key: string; item: T }[] {
	const seen = new Map<string, number>();
	return items.map((item) => {
		const base = `${prefix}-${keyOf(item)}`;
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		return { key: `${base}-${count}`, item };
	});
}

function keyedLines(text: string, prefix: string) {
	return withKeys(textLines(text), (line) => line, prefix);
}

/** The last part of a path: the file's own name. */
export function fileNameOf(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts.at(-1) ?? path;
}

/** Old and new text as a small diff: removed lines carry "-", added lines carry "+". */
export function DiffLines({ removed, added }: { removed: string; added: string }) {
	return (
		<pre className="overflow-x-auto rounded-sm bg-canvas p-2 font-mono text-xs text-fg">
			{keyedLines(removed, "removed").map(({ key, item: line }) => (
				<div key={key} className="whitespace-pre text-danger">
					<span aria-hidden="true" className="select-none">
						-
					</span>
					{line}
				</div>
			))}
			{keyedLines(added, "added").map(({ key, item: line }) => (
				<div key={key} className="whitespace-pre text-success">
					<span aria-hidden="true" className="select-none">
						+
					</span>
					{line}
				</div>
			))}
		</pre>
	);
}

/**
 * The scrolling monospace block a card shows a tool's text in: its output, raw result or message.
 * One home, so every card scrolls and wraps the same way.
 */
export function ToolOutput({
	children,
	muted = false,
	className,
}: {
	children: ReactNode;
	/** Secondary text, such as a raw result shown when it could not be read. */
	muted?: boolean;
	className?: string;
}) {
	return (
		<pre
			className={cn(
				"max-h-64 overflow-auto whitespace-pre-wrap font-mono text-xs",
				muted ? "text-fg-muted" : "text-fg",
				className,
			)}
		>
			{children}
		</pre>
	);
}

/** A summary chip: the command, pattern or text a row shows after its title (Conductor's code chip). */
export function SummaryChip({ children, sans = false }: { children: ReactNode; sans?: boolean }) {
	return (
		<span
			className={cn(
				"block truncate rounded-md bg-muted px-1 py-0.5 text-xs text-fg-muted",
				sans ? "font-sans" : "font-mono font-medium",
			)}
		>
			{children}
		</span>
	);
}

/** A file named in a row: a small outlined chip with the file's own name; the full path is its tooltip. */
export function FileBadge({ path }: { path: string }) {
	const links = useWorkspaceLinks();
	return (
		<button
			type="button"
			title={path}
			onClick={(event) => {
				event.stopPropagation();
				links.openFile(path, "edit");
			}}
			className="filebadge inline-flex h-5 min-w-0 max-w-64 items-center gap-1 rounded-sm border border-border px-1.5 font-sans text-xs leading-none text-fg hover:bg-hover"
		>
			<FileIconSmall />
			<span className="truncate">{fileNameOf(path)}</span>
		</button>
	);
}

function FileIconSmall() {
	const Icon = TOOL_ICONS.read;
	return <Icon className="size-3 shrink-0 text-fg-muted" />;
}

/** Added and removed line counts, green and red, in small monospace. */
export function LineCounts({ added, removed }: { added: number; removed: number }) {
	return (
		<span className="flex shrink-0 items-center gap-1 font-mono text-3xs font-medium">
			<span className="text-git-added">+{added}</span>
			<span className="text-git-removed">-{removed}</span>
		</span>
	);
}

export interface ToolCardFrameProps {
	/** The row's plain words: what the call did ("Read 40 lines", a command's description). */
	title: ReactNode;
	/** A string becomes a monospace chip; a node (a file badge, a count) is shown as it is. */
	summary?: ReactNode;
	status: ToolStatus;
	/** Overrides the icon of the tool kind (set by ToolCard). */
	icon?: ReactNode;
	body?: ReactNode;
	footer?: ReactNode;
	/** Garry mode: show every tool call open instead of collapsed. */
	expandAll?: boolean;
	/** Keep the summary on the row while the body is open (file badges). */
	keepSummary?: boolean;
	/** Show the body as plain text under the row, without the well (thinking). */
	plainBody?: boolean;
}

export function ToolCardFrame({
	title,
	summary,
	status,
	icon,
	body,
	footer,
	expandAll = false,
	keepSummary = false,
	plainBody = false,
}: ToolCardFrameProps) {
	const [open, setOpen] = useState(status !== "done" || expandAll);
	const [lastExpandAll, setLastExpandAll] = useState(expandAll);
	const kind = useToolKind();

	useEffect(() => {
		if (expandAll === lastExpandAll) return;
		setLastExpandAll(expandAll);
		setOpen(expandAll || status !== "done");
	}, [expandAll, lastExpandAll, status]);

	const KindIcon = kind === null ? WrenchIcon : TOOL_ICONS[kind];
	const failed = status === "error";
	const mark = (
		<span
			className={cn(
				"flex size-3 items-center justify-center",
				failed ? "text-danger" : "text-fg-muted",
			)}
		>
			{icon ?? <KindIcon className="size-3" />}
		</span>
	);
	const collapsible = body !== undefined && body !== null;
	const header = (
		<>
			<span className="relative shrink-0">
				<span className={collapsible ? "block group-hover/collapsible:opacity-0" : "block"}>
					{mark}
				</span>
				{collapsible ? (
					<span className="absolute inset-0 m-auto hidden size-3 text-fg-muted group-hover/collapsible:block [&>svg]:size-3">
						{open ? <ChevronDownIcon /> : <ChevronRightIcon />}
					</span>
				) : null}
			</span>
			<span className="flex min-w-0 flex-1 items-center gap-2">
				<span className={cn("truncate text-left text-sm", failed ? "text-danger" : "text-fg")}>
					{title}
				</span>
				{status === "running" ? (
					<span className="flex shrink-0 items-center gap-1">
						<Spinner
							label={typeof title === "string" ? `${title} is running` : "Running"}
							size="sm"
						/>
						<span className="text-xs text-fg-muted">Running</span>
					</span>
				) : null}
				{failed ? <span className="shrink-0 text-xs font-medium text-danger">Failed</span> : null}
				{summary === undefined || summary === null || summary === "" ? null : (
					<span className={cn("min-w-0 max-w-[400px] shrink", open && !keepSummary && "invisible")}>
						{typeof summary === "string" ? <SummaryChip>{summary}</SummaryChip> : summary}
					</span>
				)}
			</span>
		</>
	);
	const rowClass =
		"group/collapsible -mx-2 inline-flex max-w-[calc(100%+1rem)] items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-muted/50";
	return (
		<div className="w-full">
			{collapsible ? (
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className={rowClass}
				>
					{header}
				</button>
			) : (
				<div className={rowClass}>{header}</div>
			)}
			{collapsible && open ? (
				<div
					className={
						plainBody
							? "mt-2 select-text"
							: cn(
									"mt-2 select-text rounded-md border p-3 text-xs text-fg",
									failed ? "border-danger/20 bg-danger/10" : "border-border bg-well",
								)
					}
				>
					{body}
					{footer ? (
						<div className="mt-2 flex items-center gap-3 text-xs text-fg-muted">{footer}</div>
					) : null}
				</div>
			) : null}
			{!collapsible && footer ? (
				<div className="mt-1 flex items-center gap-3 text-xs text-fg-muted">{footer}</div>
			) : null}
		</div>
	);
}
