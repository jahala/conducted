/**
 * @feature CHAT-08 Tool card frame
 * Owns: the shared look of every tool card: a header row with an icon, the tool's title and a one-line summary,
 * a status mark, a collapsible body and an optional footer.
 * Behaviour: ui-map.md 8 (the Tool family: header, title, description, content, footer, is the base of tool
 * cards), 3.3 (tool cards).
 * Our design choice: a card is collapsed by default unless it needs attention (running or failed). The summary
 * is monospace because it is usually a path or a command. Status is a word as well as a mark. `expandAll`
 * opens every card, from the "Expand all tool calls" setting and its Ctrl+O shortcut. The reading helpers
 * below are shared by the cards because tool input and output arrive as untyped agent data.
 * Must handle: running (spinner, "Running"); failed (danger text "Failed"); a very long summary truncates;
 * no body (the header is not a button); keyboard toggle with Enter and Space; `aria-expanded` on the toggle;
 * a card whose expansion changes while it is on screen.
 * Test first: a done card starts collapsed and shows its body after the toggle is clicked.
 */
import { type ReactNode, useEffect, useState } from "react";
import type { ToolCallView } from "../../../core/model.ts";
import { cn } from "../../../ui/cn.ts";
import { ChevronDownIcon, ChevronRightIcon, WrenchIcon } from "../../../ui/icons.tsx";
import { Spinner } from "../../../ui/Spinner.tsx";
import { useWorkspaceLinks } from "../workspace-links.ts";

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
			className="max-w-full truncate rounded-xs font-mono text-xs text-link hover:underline"
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

/** Old and new text as a small diff: removed lines carry "-", added lines carry "+". */
export function DiffLines({ removed, added }: { removed: string; added: string }) {
	return (
		<pre className="overflow-x-auto rounded-sm bg-surface p-2 font-mono text-code text-fg">
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

export interface ToolCardFrameProps {
	title: string;
	summary?: string;
	status: ToolStatus;
	icon?: ReactNode;
	body?: ReactNode;
	footer?: ReactNode;
	/** Garry mode: show every tool call open instead of collapsed. */
	expandAll?: boolean;
}

export function ToolCardFrame({
	title,
	summary,
	status,
	icon,
	body,
	footer,
	expandAll = false,
}: ToolCardFrameProps) {
	const [open, setOpen] = useState(status !== "done" || expandAll);
	const [lastExpandAll, setLastExpandAll] = useState(expandAll);

	useEffect(() => {
		if (expandAll === lastExpandAll) return;
		setLastExpandAll(expandAll);
		setOpen(expandAll || status !== "done");
	}, [expandAll, lastExpandAll, status]);

	const header = (
		<>
			{body ? open ? <ChevronDownIcon /> : <ChevronRightIcon /> : <span className="size-4" />}
			<span className="flex size-4 items-center justify-center text-fg-subtle">
				{icon ?? <WrenchIcon />}
			</span>
			<span className="text-sm font-medium text-fg">{title}</span>
			{summary ? (
				<span className="min-w-0 flex-1 truncate text-left font-mono text-xs text-fg-muted">
					{summary}
				</span>
			) : (
				<span className="flex-1" />
			)}
			{status === "running" ? (
				<>
					<Spinner label={`${title} is running`} size="sm" />
					<span className="text-xs text-fg-subtle">Running</span>
				</>
			) : null}
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
