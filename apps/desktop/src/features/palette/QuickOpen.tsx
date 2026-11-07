/**
 * @feature REV-07 Quick open
 * Owns: The Cmd+P dialog that opens a file of the current workspace by typing part of its name.
 * Behaviour: ui-map.md 3.6 (quick open Cmd+P 'Open file picker'), 3.10 (Quick open dialog).
 * Data: useFileSearch(workspaceId, query) does the fuzzy matching in the workspace service, which
 * asks the gitignore-aware Rust search. Choosing a file opens it as a file tab in the URL.
 * Must handle: No workspace selected (explains and offers nothing); a query under two characters
 * (says so); searching (spinner); a huge tree (the first 50 matches); files ignored by git are not
 * offered; Escape closes; ArrowUp, ArrowDown and Enter move and choose.
 * Test first: Typing 'appshell' lists 'src/app/AppShell.tsx'; Enter opens it as a file tab.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useFileSearch } from "../../core/hooks.ts";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent } from "../../ui/Dialog.tsx";
import { HighlightedText } from "../../ui/HighlightedText.tsx";
import { FileIcon, SearchIcon } from "../../ui/icons.tsx";
import type { OverlayProps } from "../../ui/overlay-props.ts";
import { Spinner } from "../../ui/Spinner.tsx";
import { useWorkspaceLinks } from "../chat/workspace-links.ts";

export function QuickOpen({ open, onOpenChange, workspaceId }: OverlayProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Quick open"
				hideTitle
				size="xl"
				className="max-h-[500px] gap-0 overflow-hidden p-0"
			>
				{workspaceId === null ? (
					<p className="p-6 text-sm text-fg-muted">Open a workspace to search its files.</p>
				) : (
					<QuickOpenBody workspaceId={workspaceId} onOpenChange={onOpenChange} />
				)}
			</DialogContent>
		</Dialog>
	);
}

function QuickOpenBody({
	workspaceId,
	onOpenChange,
}: {
	workspaceId: WorkspaceId;
	onOpenChange: (open: boolean) => void;
}) {
	const fieldId = useId();
	const links = useWorkspaceLinks();
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const results = useFileSearch(workspaceId, query);
	const trimmed = query.trim();
	const entries = results.state === "ready" ? results.data : [];
	const selected = entries.length === 0 ? -1 : Math.min(activeIndex, entries.length - 1);

	useEffect(() => {
		const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
		row?.scrollIntoView?.({ block: "nearest" });
	}, [selected]);

	const choose = (path: string) => {
		links.openFile(path, "edit");
		onOpenChange(false);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveIndex((index) => Math.min(index + 1, Math.max(0, entries.length - 1)));
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveIndex((index) => Math.max(0, index - 1));
			return;
		}
		if (event.key === "Enter") {
			const entry = entries[selected];
			if (entry === undefined) return;
			event.preventDefault();
			choose(entry.path);
		}
	};

	return (
		<>
			<div className="relative border-b border-separator">
				<SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-fg-subtle" />
				<input
					// biome-ignore lint/a11y/noAutofocus: the dialog exists to take the typed query.
					autoFocus
					id={fieldId}
					type="text"
					aria-label="Search files..."
					placeholder="Search files..."
					value={query}
					onChange={(event) => {
						setQuery(event.target.value);
						setActiveIndex(0);
					}}
					onKeyDown={onKeyDown}
					className="h-11 w-full bg-transparent pl-11 pr-3 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none"
				/>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-1" ref={listRef}>
				{trimmed.length < 2 ? (
					<p className="px-3 py-4 text-sm text-fg-subtle">
						Type at least 2 characters to search files.
					</p>
				) : results.state === "loading" ? (
					<div className="flex items-center justify-center py-6">
						<Spinner label="Searching files" />
					</div>
				) : results.state === "error" ? (
					<p role="alert" className="px-3 py-4 text-sm text-danger">
						{results.error.message}
					</p>
				) : entries.length === 0 ? (
					<p className="px-3 py-4 text-sm text-fg-subtle">No files match.</p>
				) : (
					entries.map((entry, index) => (
						<button
							key={entry.path}
							type="button"
							data-index={index}
							aria-label={entry.path}
							onMouseEnter={() => setActiveIndex(index)}
							onClick={() => choose(entry.path)}
							className={cn(
								"flex h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm text-fg",
								index === selected ? "bg-hover" : "hover:bg-hover",
							)}
						>
							<FileIcon className="size-4 shrink-0 text-fg-muted" />
							<span className="min-w-0 flex-1 truncate">
								<HighlightedText text={entry.path} query={trimmed} />
							</span>
						</button>
					))
				)}
			</div>
		</>
	);
}
