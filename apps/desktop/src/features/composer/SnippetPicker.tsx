/**
 * @feature COMP-09 Prompt snippets
 * Owns: the snippet picker: its "Search snippets..." box, the loading and failed-read states, the
 * snippet rows, and its "Create snippet" action.
 * Behaviour: ui-map.md 3.5 (Insert snippet, Cmd+;), 5.1 (Search snippets...), inventory
 * aria_label #67 and #152, placeholder #57.
 * Our design choice: the picker is one cmdk dialog, like the Link issue dialog. Choosing a snippet
 * hands its prompt to the composer that opened it; the picker does not edit the draft itself.
 * Must handle: the list still loading; a read that failed; no saved snippets; a search with no
 * match; choosing a row; Create snippet opening the form.
 * Test first: a saved snippet appears while the query matches, and choosing it hands its prompt to
 * the composer.
 */
import { Command } from "cmdk";
import { useState } from "react";
import { useSnippets } from "../../core/hooks.ts";
import { Button } from "../../ui/Button.tsx";
import { Spinner } from "../../ui/Spinner.tsx";
import { filterSnippets } from "./snippet-model.ts";

export interface SnippetPickerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onInsert: (prompt: string) => void;
	onCreate: () => void;
}

const itemClass =
	"flex h-11 cursor-default items-center gap-3 rounded-md px-3 text-sm text-fg outline-none data-[selected=true]:bg-active";

const groupClass =
	"[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle";

export function SnippetPicker({ open, onOpenChange, onInsert, onCreate }: SnippetPickerProps) {
	const snippets = useSnippets();
	const [query, setQuery] = useState("");
	const rows = snippets.state === "ready" ? filterSnippets(snippets.data, query) : [];
	const searching = query.trim() !== "";

	return (
		<Command.Dialog
			open={open}
			onOpenChange={onOpenChange}
			label="Insert snippet"
			shouldFilter={false}
			overlayClassName="fixed inset-0 z-40 bg-overlay"
			contentClassName="fixed left-1/2 top-[max(2rem,calc(50%-250px))] z-50 flex w-(--palette-width) max-w-[calc(100%-2rem)] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-border bg-raised text-fg shadow-palette"
		>
			<h2 className="sr-only">Insert snippet</h2>
			<div className="flex h-11 items-center border-b border-border px-3">
				<Command.Input
					value={query}
					onValueChange={setQuery}
					placeholder="Search snippets..."
					aria-label="Search snippets..."
					className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
				/>
			</div>
			{snippets.state === "error" ? (
				<p role="alert" className="px-3 py-2 text-xs text-danger">
					Couldn't load snippets. {snippets.error.message}
				</p>
			) : null}
			<Command.List className="max-h-(--palette-max-height) overflow-y-auto p-2">
				{snippets.state === "loading" ? (
					<div className="flex items-center gap-2 px-3 py-6 text-sm text-fg-muted">
						<Spinner label="Loading snippets" size="sm" />
						Loading snippets...
					</div>
				) : null}
				{snippets.state === "ready" && rows.length > 0 ? (
					<Command.Group heading="Snippets" className={groupClass}>
						{rows.map((snippet) => (
							<Command.Item
								key={snippet.id}
								value={snippet.id}
								onSelect={() => {
									onInsert(snippet.prompt);
									onOpenChange(false);
								}}
								className={itemClass}
							>
								<span className="min-w-0 flex-1 truncate">{snippet.name}</span>
								{snippet.keyword === null ? null : (
									<span className="shrink-0 text-xs text-fg-subtle">{snippet.keyword}</span>
								)}
							</Command.Item>
						))}
					</Command.Group>
				) : null}
				{snippets.state === "ready" && rows.length === 0 ? (
					<p className="px-3 py-6 text-center text-sm text-fg-muted">
						{searching ? "No snippets found" : "No saved snippets yet."}
					</p>
				) : null}
			</Command.List>
			<div className="flex justify-end border-t border-border p-2">
				<Button variant="outline" size="sm" onClick={onCreate}>
					Create snippet
				</Button>
			</div>
		</Command.Dialog>
	);
}
