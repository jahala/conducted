/**
 * @feature DATA-01 Query hook contract for screens
 * @feature COMP-09 Prompt snippets
 * Owns: the composer hooks: the draft for a chat and the saved snippets.
 * Behaviour: services-map.md 1.3; core/hooks.ts states the contract; ui-map.md 5.1 (the snippet
 * picker loads its list once).
 * Must handle: a chat with no saved draft yet; the snippet list before its first read answers, after
 * a failed read, and after a snippet is saved or deleted.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import type { Draft, Loadable, Queries } from "../api.ts";
import { useServices } from "../context.tsx";
import type { Snippet } from "../model.ts";

const EMPTY_DRAFT: Draft = { text: "", attachmentPaths: [] };

export const useDraft: Queries["useDraft"] = (sessionId) => {
	const composer = useServices().services.composer;
	const draft = useStore(composer.store, (state) => state.drafts[sessionId]);
	useEffect(() => {
		if (draft === undefined) void composer.loadDraft(sessionId);
	}, [composer, sessionId, draft]);
	return draft ?? EMPTY_DRAFT;
};
export const useSnippets: Queries["useSnippets"] = () => {
	const composer = useServices().services.composer;
	const snippets = useStore(composer.store, (state) => state.snippets);
	const snippetError = useStore(composer.store, (state) => state.snippetError);
	useEffect(() => {
		if (snippets === null && snippetError === null) void composer.loadSnippets();
	}, [composer, snippetError, snippets]);
	return useMemo<Loadable<Snippet[]>>(() => {
		if (snippets !== null) return { state: "ready", data: snippets };
		if (snippetError !== null) return { state: "error", error: snippetError };
		return { state: "loading" };
	}, [snippetError, snippets]);
};
