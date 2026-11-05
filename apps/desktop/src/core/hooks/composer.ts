/**
 * @feature DATA-01 Query hook contract for screens
 * Owns: the composer hooks: the draft for a chat and the saved snippets.
 * Behaviour: services-map.md 1.3; core/hooks.ts states the contract.
 * Must handle: a chat with no saved draft yet.
 * Test first: the test for a hook body lives with the feature that implements it.
 */
import { notImplemented } from "@conducted/shared";
import { useEffect } from "react";
import { useStore } from "zustand";
import type { Draft, Queries } from "../api.ts";
import { useServices } from "../context.tsx";

const EMPTY_DRAFT: Draft = { text: "", attachmentPaths: [] };

export const useDraft: Queries["useDraft"] = (sessionId) => {
	const composer = useServices().services.composer;
	const draft = useStore(composer.store, (state) => state.drafts[sessionId]);
	useEffect(() => {
		if (draft === undefined) void composer.loadDraft(sessionId);
	}, [composer, sessionId, draft]);
	return draft ?? EMPTY_DRAFT;
};
export const useSnippets: Queries["useSnippets"] = () => notImplemented("COMP-09");
