/**
 * @feature COMP-09 Prompt snippets
 * Owns: loading the user's snippets into a store so an older list that arrives late cannot replace a
 * newer one.
 * Behaviour: ui-map.md 3.5 and 5.1 (the snippet picker and the palette actions); architecture.md
 * ("Only the newest async result changes state").
 * Data: the caller supplies the store slice and the repository read, so the composer service keeps
 * its one store and its one snippet repository.
 * Must handle: two loads in flight, where the older answer arrives last and is dropped; a failed
 * read that stores its error; a read superseded by a newer one, whose error is dropped too.
 * Test first: two overlapping loads keep the second list when the first answers last.
 */
import type { AppError, Result } from "@conducted/shared";
import type { StoreApi } from "zustand/vanilla";
import { createLatestWins } from "../async/latest-wins.ts";
import type { Snippet } from "../model.ts";

/** The part of a store a snippet list is written to. */
export interface SnippetCacheState {
	/** The snippets read so far. Null until the first answer. */
	snippets: Snippet[] | null;
	/** The last failed read, cleared by the next answer that wins. */
	snippetError: AppError | null;
}

export interface SnippetCacheDeps<S extends SnippetCacheState> {
	store: StoreApi<S>;
	list: () => Promise<Result<Snippet[]>>;
}

export interface SnippetCache {
	/** Reads the list and writes it to the store unless a newer read has begun. */
	load(): Promise<void>;
	/** Drops any running read's answer, for a store that is being torn down. */
	invalidate(): void;
}

export function createSnippetCache<S extends SnippetCacheState>(
	deps: SnippetCacheDeps<S>,
): SnippetCache {
	const latest = createLatestWins<"snippets">();
	return {
		async load() {
			const ticket = latest.begin("snippets");
			const listed = await deps.list();
			if (!latest.isLatest(ticket)) return;
			latest.settle(ticket);
			if (listed.ok) {
				deps.store.setState({ snippets: listed.value, snippetError: null } as Partial<S>);
				return;
			}
			deps.store.setState({ snippetError: listed.error } as Partial<S>);
		},
		invalidate() {
			latest.invalidate("snippets");
		},
	};
}
