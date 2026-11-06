/**
 * @feature NAV-16 Draft markers on the Create row and on workspaces
 * Owns: reading the composer draft behind the Create row's marker and the draft behind a workspace row's
 * "Open draft" marker.
 * Behaviour: ui-map.md 4.3 (the Create row shows a draft marker when the new-workspace draft is non-empty);
 * coverage/inventory-controls.md (a workspace row shows "Open draft" when that workspace has a draft).
 * Data: the composer store. Chat drafts are keyed by session id (COMP-01). The new-workspace draft uses the
 * reserved id "new-workspace", which no session id can be, so it survives a route change and a restart like
 * a chat draft.
 * Our design choice: a workspace row has a draft when any open chat in it has one, and "Open draft" opens the
 * first such chat.
 * Must handle: a draft that is not loaded yet (load it, then show the marker); a whitespace-only draft (no
 * marker); a chat whose draft file cannot be read (no marker, the composer tells the user when the chat opens).
 * Test first: a whitespace-only new-workspace draft shows no marker; text shows one.
 */
import type { SessionId } from "@conducted/shared";
import { useCallback, useEffect } from "react";
import { useStore } from "zustand";
import type { Draft } from "../../core/api.ts";
import { NEW_WORKSPACE_DRAFT_ID as NEW_WORKSPACE_DRAFT_KEY } from "../../core/app-paths.ts";
import { useServices } from "../../core/context.tsx";
import { toastError } from "../../ui/Toast.tsx";
import { hasDraft } from "../sidebar/DraftMarker.tsx";

/** The composer key of the draft on the Create page. No session id can equal it. */
export const NEW_WORKSPACE_DRAFT_ID = NEW_WORKSPACE_DRAFT_KEY as SessionId;

const EMPTY_DRAFT: Draft = { text: "", attachmentPaths: [] };

export interface NewWorkspaceDraftHandle {
	draft: Draft;
	/** False until the saved draft has been read, so a screen does not save over it too early. */
	loaded: boolean;
	save: (draft: Draft) => void;
	clear: () => void;
}

/** The draft on the Create page, loaded once and kept in the composer store. */
export function useNewWorkspaceDraft(): NewWorkspaceDraftHandle {
	const composer = useServices().services.composer;
	const draft = useStore(composer.store, (state) => state.drafts[NEW_WORKSPACE_DRAFT_ID]);
	useEffect(() => {
		if (draft !== undefined) return;
		void composer.loadDraft(NEW_WORKSPACE_DRAFT_ID).then((result) => {
			if (!result.ok) toastError("Couldn't load the new-workspace draft", result.error);
		});
	}, [composer, draft]);
	const save = useCallback(
		(next: Draft) => composer.saveDraft(NEW_WORKSPACE_DRAFT_ID, next),
		[composer],
	);
	const clear = useCallback(() => {
		void composer.clearDraft(NEW_WORKSPACE_DRAFT_ID).then((result) => {
			if (!result.ok) toastError("Couldn't clear the new-workspace draft", result.error);
		});
	}, [composer]);
	return { draft: draft ?? EMPTY_DRAFT, loaded: draft !== undefined, save, clear };
}

export interface WorkspaceDraft {
	sessionId: SessionId;
	draft: Draft;
}

/** The first open chat in a workspace with a non-empty draft, or null. */
export function useWorkspaceDraft(sessionIds: readonly SessionId[]): WorkspaceDraft | null {
	const composer = useServices().services.composer;
	const drafts = useStore(composer.store, (state) => state.drafts);
	const ids = sessionIds.join("\u0000");
	useEffect(() => {
		for (const id of ids === "" ? [] : (ids.split("\u0000") as SessionId[])) {
			if (drafts[id] !== undefined) continue;
			void composer.loadDraft(id).then((result) => {
				if (!result.ok) toastError("Couldn't load the draft", result.error);
			});
		}
	}, [composer, drafts, ids]);
	for (const id of ids === "" ? [] : (ids.split("\u0000") as SessionId[])) {
		const draft = drafts[id];
		if (hasDraft(draft)) return { sessionId: id, draft };
	}
	return null;
}
