/**
 * @feature COMP-01 Draft sync
 * Owns: Saving the editor's text and attachments as the draft after a short pause, and restoring
 * them when a chat opens.
 * Behaviour: ui-map.md 3.5 (draft per session kept in a store), frontend.md 4 (drafts live in local
 * storage and survive restarts).
 * Our design choice: Saves through useActions().sessions.saveDraft, which is synchronous from the
 * screen's side. Restores the draft once per chat, then the editor is the source of truth. An
 * update event marks the chat as typed in, so the previous chat's text left in the editor is not
 * mistaken for typing. Edits before the restore finishes are not written, so a chat switch cannot
 * save the previous chat's attachments into the new one. Attachments are remembered per chat.
 * Must handle: a saved draft that cannot be read (the user is told; later typing saves again);
 * Switching chats before the pause ends (save the old chat's draft first); a send
 * clears the draft; an empty editor removes the draft; typing before the restore arrives (keep it,
 * and do not overwrite it with the saved text); a draft for a closed chat is cleaned up by the
 * data-lifetime job.
 * Attachments put in the stored draft from outside the composer (CHAT-26's shelves, the Files tab)
 * are handed to the composer, and become the last saved list so they are not saved back.
 * Test first: Typing then switching chats saves the first chat's text once and restores the second
 * chat's draft.
 */

import type { SessionId } from "@conducted/shared";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import type { Draft } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";
import { useActions } from "../../core/hooks.ts";
import { toastError } from "../../ui/Toast.tsx";
import { textToDocument } from "./text-content.ts";

export interface DraftSyncProps {
	sessionId: SessionId;
	editor: Editor | null;
	attachmentPaths?: readonly string[];
	onRestore?: (draft: Draft) => void;
	/**
	 * The stored draft's attachments changed from outside the composer: the empty chat's shelves
	 * (CHAT-26), the Files tab, or the composer service adding a file. The composer shows them.
	 */
	onStoredAttachments?: (paths: string[]) => void;
}

/** A stable key for a list of attachment paths, so a change is noticed by value. */
function keyOf(paths: readonly string[]): string {
	return paths.join("\u0000");
}

export function useDraftSync({
	sessionId,
	editor,
	attachmentPaths = [],
	onRestore,
	onStoredAttachments,
}: DraftSyncProps): void {
	const composer = useServices().services.composer;
	const { sessions } = useActions();
	const attachmentsBySession = useRef(new Map<string, readonly string[]>());
	const lastSavedAttachments = useRef(new Map<string, string>());
	const restoredSession = useRef<SessionId | null>(null);
	const typedSinceRestore = useRef(false);
	const restore = useRef(onRestore);
	restore.current = onRestore;
	const storedAttachments = useRef(onStoredAttachments);
	storedAttachments.current = onStoredAttachments;

	useEffect(() => {
		if (editor === null) return;
		const persist = () => {
			typedSinceRestore.current = true;
			if (restoredSession.current !== sessionId) return;
			const paths = attachmentsBySession.current.get(sessionId) ?? [];
			lastSavedAttachments.current.set(sessionId, keyOf(paths));
			sessions.saveDraft(sessionId, { text: editor.getText(), attachmentPaths: [...paths] });
		};
		editor.on("update", persist);
		return () => {
			editor.off("update", persist);
			if (restoredSession.current !== sessionId) return;
			const paths = attachmentsBySession.current.get(sessionId) ?? [];
			sessions.saveDraft(sessionId, { text: editor.getText(), attachmentPaths: [...paths] });
		};
	}, [editor, sessionId, sessions]);

	useEffect(() => {
		if (editor === null) return;
		let cancelled = false;
		restoredSession.current = null;
		typedSinceRestore.current = false;
		const load = async () => {
			const result = await composer.loadDraft(sessionId);
			if (cancelled) return;
			if (!result.ok) {
				// Tell the user the saved draft is lost, then let later typing save again.
				toastError("Couldn't restore the draft", result.error);
				restoredSession.current = sessionId;
				return;
			}
			const draft = result.value;
			if (!typedSinceRestore.current && editor.getText() !== draft.text) {
				editor.commands.setContent(textToDocument(draft.text), { emitUpdate: false });
			}
			attachmentsBySession.current.set(sessionId, draft.attachmentPaths);
			lastSavedAttachments.current.set(sessionId, keyOf(draft.attachmentPaths));
			restoredSession.current = sessionId;
			restore.current?.({ text: editor.getText(), attachmentPaths: [...draft.attachmentPaths] });
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [composer, editor, sessionId]);

	// A change to the stored attachments that this hook did not save came from elsewhere. It
	// becomes the last saved list, so showing it does not save it back over a newer change.
	useEffect(() => {
		return composer.store.subscribe((state) => {
			if (restoredSession.current !== sessionId) return;
			const paths = state.drafts[sessionId]?.attachmentPaths;
			if (paths === undefined) return;
			const key = keyOf(paths);
			if (lastSavedAttachments.current.get(sessionId) === key) return;
			lastSavedAttachments.current.set(sessionId, key);
			attachmentsBySession.current.set(sessionId, paths);
			storedAttachments.current?.([...paths]);
		});
	}, [composer, sessionId]);

	const attachmentKey = keyOf(attachmentPaths);
	useEffect(() => {
		if (editor === null || restoredSession.current !== sessionId) return;
		attachmentsBySession.current.set(sessionId, attachmentPaths);
		if (lastSavedAttachments.current.get(sessionId) === attachmentKey) return;
		lastSavedAttachments.current.set(sessionId, attachmentKey);
		sessions.saveDraft(sessionId, {
			text: editor.getText(),
			attachmentPaths: [...attachmentPaths],
		});
	}, [attachmentKey, attachmentPaths, editor, sessionId, sessions]);
}
