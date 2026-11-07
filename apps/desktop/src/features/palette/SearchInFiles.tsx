/**
 * @feature REV-07 Search in files
 * Owns: The Cmd+Shift+F dialog that searches file contents in the workspace and opens a match.
 * Behaviour: ui-map.md 3.6 (search in files Cmd+Shift+F with Match case, Whole word, Regular
 * expression), 3.10.
 * Data: useContentSearch(workspaceId, query, { matchCase, wholeWord, regex }), which greps through
 * the gitignore-aware Rust search. Results are grouped by file, with the line number and the match
 * marked.
 * Must handle: No workspace selected (explains and offers nothing); a query under two characters
 * (says so); an invalid regular expression (the pattern error takes the place of the results);
 * thousands of matches (the newest search replaces the last; the first CONTENT_SEARCH_LIMIT are
 * shown, with 'Refine your search' only when the service found more); a pattern the search accepts
 * but JavaScript cannot compile (the line is shown without a highlight); binary and ignored files
 * are skipped by the search; Escape closes; clicking a match opens its file.
 * Test first: Searching 'retry' returns matches grouped by file; turning on 'Whole word' removes
 * 'retrying'.
 */
import { appError, err, ok, type Result, type WorkspaceId } from "@conducted/shared";
import { useMemo, useState } from "react";
import type { ContentMatch, ContentSearchOptions } from "../../core/api.ts";
import { CONTENT_SEARCH_LIMIT, useContentSearch } from "../../core/hooks.ts";
import { cn } from "../../ui/cn.ts";
import { Dialog, DialogContent } from "../../ui/Dialog.tsx";
import { HighlightedText } from "../../ui/HighlightedText.tsx";
import { SearchIcon } from "../../ui/icons.tsx";
import type { OverlayProps } from "../../ui/overlay-props.ts";
import { Spinner } from "../../ui/Spinner.tsx";
import { Toggle } from "../../ui/Toggle.tsx";
import { useWorkspaceLinks } from "../chat/workspace-links.ts";

export function SearchInFiles({ open, onOpenChange, workspaceId }: OverlayProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				title="Search in files"
				hideTitle
				size="xl"
				className="h-[min(500px,calc(100vh-4rem))] gap-0 overflow-hidden p-0"
			>
				{workspaceId === null ? (
					<p className="p-6 text-sm text-fg-muted">Open a workspace to search its file contents.</p>
				) : (
					<SearchBody workspaceId={workspaceId} onOpenChange={onOpenChange} />
				)}
			</DialogContent>
		</Dialog>
	);
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The search pattern as a JavaScript expression, or the reason it cannot be compiled. */
function compileHighlight(query: string, options: ContentSearchOptions): Result<RegExp> {
	let pattern = options.regex ? query : escapeRegExp(query);
	if (options.wholeWord) pattern = `\\b(?:${pattern})\\b`;
	try {
		return ok(new RegExp(pattern, options.matchCase ? "" : "i"));
	} catch (cause) {
		return err(appError("invalid_pattern", "The pattern cannot be highlighted.", cause));
	}
}

/**
 * The exact text to mark on the line, so a regular expression's own match is highlighted. A pattern
 * JavaScript cannot compile, or one that finds nothing on this line, marks nothing.
 */
function highlightText(preview: string, pattern: Result<RegExp>): string {
	if (!pattern.ok) return "";
	return pattern.value.exec(preview)?.[0] ?? "";
}

function groupByFile(matches: readonly ContentMatch[]): [string, ContentMatch[]][] {
	const groups = new Map<string, ContentMatch[]>();
	for (const match of matches) {
		const group = groups.get(match.path);
		if (group === undefined) groups.set(match.path, [match]);
		else group.push(match);
	}
	return [...groups.entries()];
}

function SearchBody({
	workspaceId,
	onOpenChange,
}: {
	workspaceId: WorkspaceId;
	onOpenChange: (open: boolean) => void;
}) {
	const links = useWorkspaceLinks();
	const [query, setQuery] = useState("");
	const [options, setOptions] = useState<ContentSearchOptions>({
		matchCase: false,
		wholeWord: false,
		regex: false,
	});
	const results = useContentSearch(workspaceId, query, options);
	const trimmed = query.trim();
	const found = results.state === "ready" ? results.data : [];
	const matches = useMemo(() => found.slice(0, CONTENT_SEARCH_LIMIT), [found]);
	const cut = found.length > CONTENT_SEARCH_LIMIT;
	const groups = useMemo(() => groupByFile(matches), [matches]);
	const pattern = useMemo(() => compileHighlight(trimmed, options), [trimmed, options]);

	const setOption = (key: keyof ContentSearchOptions) => (pressed: boolean) =>
		setOptions((current) => ({ ...current, [key]: pressed }));

	const open = (match: ContentMatch) => {
		links.openFile(match.path, "edit");
		onOpenChange(false);
	};

	return (
		<>
			<div className="relative border-b border-separator">
				<SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-fg-subtle" />
				<input
					// biome-ignore lint/a11y/noAutofocus: the dialog exists to take the typed query.
					autoFocus
					type="search"
					aria-label="Search in files..."
					placeholder="Search in files..."
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					className="h-11 w-full bg-transparent pl-11 pr-3 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-none"
				/>
			</div>
			<div className="flex items-center gap-1 border-b border-separator px-3 py-2">
				<Toggle
					size="sm"
					aria-label="Match case"
					pressed={options.matchCase}
					onPressedChange={setOption("matchCase")}
					className="font-mono"
				>
					Aa
				</Toggle>
				<Toggle
					size="sm"
					aria-label="Whole word"
					pressed={options.wholeWord}
					onPressedChange={setOption("wholeWord")}
					className="font-mono"
				>
					ab
				</Toggle>
				<Toggle
					size="sm"
					aria-label="Regular expression"
					pressed={options.regex}
					onPressedChange={setOption("regex")}
					className="font-mono"
				>
					.*
				</Toggle>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-1">
				{trimmed.length < 2 ? (
					<p className="px-3 py-4 text-sm text-fg-subtle">Type at least 2 characters to search.</p>
				) : results.state === "loading" ? (
					<div className="flex items-center justify-center py-6">
						<Spinner label="Searching files" />
					</div>
				) : results.state === "error" ? (
					<p role="alert" className="px-3 py-4 text-sm text-danger">
						{results.error.message}
					</p>
				) : matches.length === 0 ? (
					<p className="px-3 py-4 text-sm text-fg-subtle">No matches.</p>
				) : (
					<>
						{groups.map(([path, fileMatches]) => (
							<section key={path} aria-label={path} className="py-1">
								<h3 className="px-3 py-1 font-mono text-xs font-medium text-fg-muted">{path}</h3>
								{fileMatches.map((match) => (
									<button
										key={`${match.path}:${match.line}`}
										type="button"
										aria-label={`${match.path}:${match.line}`}
										onClick={() => open(match)}
										className={cn(
											"flex h-7 w-full items-center gap-3 rounded-md px-3 text-left",
											"hover:bg-hover",
										)}
									>
										<span className="w-10 shrink-0 text-right font-mono text-xs text-fg-subtle">
											{match.line}
										</span>
										<span className="min-w-0 flex-1 truncate font-mono text-code text-fg">
											<HighlightedText
												text={match.preview}
												query={highlightText(match.preview, pattern)}
											/>
										</span>
									</button>
								))}
							</section>
						))}
						{cut ? <p className="px-3 py-3 text-xs text-fg-subtle">Refine your search.</p> : null}
					</>
				)}
			</div>
		</>
	);
}
