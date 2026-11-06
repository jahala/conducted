/**
 * @feature COMP-09 Prompt snippets
 * Owns: tests that an older snippet read cannot replace a newer list, and that a failed read lands
 * in the store unless a newer read has taken over.
 * Behaviour: ui-map.md 3.5 and 5.1; architecture.md ("Only the newest async result changes state").
 * Test first: two overlapping loads keep the second list when the first answers last.
 */
import { appError, err, ok, type Result, type SnippetId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import type { Snippet } from "../model.ts";
import { createSnippetCache, type SnippetCacheState } from "./snippets-cache.ts";

const snippet = (id: string): Snippet => ({
	id: id as SnippetId,
	name: id,
	keyword: null,
	prompt: `${id} prompt`,
	createdAt: 0,
	updatedAt: 0,
});

function setup() {
	const store = createStore<SnippetCacheState>(() => ({ snippets: null, snippetError: null }));
	const answers: ((value: Result<Snippet[]>) => void)[] = [];
	const list = () =>
		new Promise<Result<Snippet[]>>((resolve) => {
			answers.push(resolve);
		});
	const cache = createSnippetCache({ store, list });
	return { store, answers, cache };
}

describe("COMP-09 snippet cache", () => {
	it("keeps the newest list when two loads overlap and the older answer arrives last", async () => {
		const { store, answers, cache } = setup();
		const first = cache.load();
		const second = cache.load();
		answers[1]?.(ok([snippet("newer")]));
		await second;
		expect(store.getState().snippets).toEqual([snippet("newer")]);

		answers[0]?.(ok([snippet("older")]));
		await first;
		expect(store.getState().snippets).toEqual([snippet("newer")]);
	});

	it("stores a failed read's error", async () => {
		const { store, answers, cache } = setup();
		const load = cache.load();
		const failure = appError("db", "The snippets could not be read.");
		answers[0]?.(err(failure));
		await load;
		expect(store.getState().snippetError).toEqual(failure);
		expect(store.getState().snippets).toBeNull();
	});

	it("drops a superseded read's error and keeps the newer list", async () => {
		const { store, answers, cache } = setup();
		const first = cache.load();
		const second = cache.load();
		answers[1]?.(ok([snippet("kept")]));
		await second;
		answers[0]?.(err(appError("db", "Too late.")));
		await first;
		expect(store.getState().snippetError).toBeNull();
		expect(store.getState().snippets).toEqual([snippet("kept")]);
	});
});
