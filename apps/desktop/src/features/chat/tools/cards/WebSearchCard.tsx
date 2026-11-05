/**
 * @feature CHAT-08 Web search card
 * Owns: The card for a web search: the query and the result titles with links.
 * Behaviour: frontend.md 5 (registry key 'web'), ui-map.md 3.3 (approval title 'do this search').
 * Must handle: No results; results without titles (show the address); many results (first 8).
 * Test first: A web_search call shows the query and one row per result.
 */
import {
	asRecord,
	ToolCardFrame,
	textField,
	textLines,
	toolStatus,
	withKeys,
} from "../ToolCardFrame.tsx";
import type { ToolCardProps } from "../tool-card-props.ts";

const MAX_RESULTS = 8;
const URL = /https?:\/\/\S+/;

interface SearchResult {
	title: string;
	url: string | null;
}

/** Agent output is often "Title" followed by its address; either line can stand alone. */
function parseResults(output: string): SearchResult[] {
	const results: SearchResult[] = [];
	for (const line of textLines(output)) {
		if (line.trim().length === 0) continue;
		const url = URL.exec(line)?.[0] ?? null;
		const last = results.at(-1);
		if (url !== null && last !== undefined && last.url === null) {
			last.url = url;
			if (last.title.length === 0) last.title = url;
			continue;
		}
		results.push({ title: line.replace(url ?? "", "").trim(), url });
	}
	return results;
}

export function WebSearchCard({ call, defaultExpanded }: ToolCardProps) {
	const input = asRecord(call.item.input);
	const query = textField(input, "query", "q") ?? "";
	const results = parseResults(call.result?.output ?? "").slice(0, MAX_RESULTS);
	return (
		<ToolCardFrame
			title="Web search"
			summary={query}
			status={toolStatus(call)}
			expandAll={defaultExpanded}
			body={
				results.length === 0 ? (
					<p className="text-xs text-fg-subtle">No results</p>
				) : (
					<div className="flex flex-col gap-1">
						{withKeys(results, (result) => `${result.title}-${result.url ?? ""}`, "result").map(
							({ key, item: result }) =>
								result.url === null ? (
									<span key={key} className="text-xs text-fg-muted">
										{result.title}
									</span>
								) : (
									<a
										key={key}
										href={result.url}
										target="_blank"
										rel="noreferrer"
										className="truncate text-xs text-link hover:underline"
									>
										{result.title.length > 0 ? result.title : result.url}
									</a>
								),
						)}
					</div>
				)
			}
		/>
	);
}
