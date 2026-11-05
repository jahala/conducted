/**
 * @feature COMP-01 Draft sync
 * Owns: Saving the editor's text and attachments as the draft after a short pause, and restoring
 * them when a chat opens.
 * Behaviour: ui-map.md 3.5 (draft per session kept in a store), frontend.md 4 (drafts live in local
 * storage and survive restarts).
 * Our design choice: Saves through sessions.saveDraft, which is synchronous from the screen's side.
 * Restores the draft once per chat, then the editor is the source of truth.
 * Must handle: Switching chats before the pause ends (save the old chat's draft first); a send
 * clears the draft; an empty editor removes the draft; a draft for a closed chat is cleaned up by
 * the data-lifetime job.
 * Test first: Typing then switching chats saves the first chat's text once and restores the second
 * chat's draft.
 */

import type { SessionId } from "@conducted/shared";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import type { Draft } from "../../core/api.ts";
import { useServices } from "../../core/context.tsx";

export interface DraftSyncProps {
	sessionId: SessionId;
	editor: Editor | null;
	attachmentPaths?: readonly string[];
	onRestore?: (draft: Draft) => void;
}

interface TextNode {
	type: "text";
	text: string;
}

interface HardBreakNode {
	type: "hardBreak";
}

/** Turns the editor's plain text back into paragraphs and line breaks, so a restart keeps them. */
export function draftToContent(text: string): {
	type: "doc";
	content: { type: "paragraph"; content?: (TextNode | HardBreakNode)[] }[];
} {
	const paragraphs = text.split("\n\n").map((paragraph) => {
		const content: (TextNode | HardBreakNode)[] = [];
		for (const [index, line] of paragraph.split("\n").entries()) {
			if (index > 0) content.push({ type: "hardBreak" });
			if (line.length > 0) content.push({ type: "text", text: line });
		}
		return content.length === 0
			? { type: "paragraph" as const }
			: { type: "paragraph" as const, content };
	});
	return { type: "doc", content: paragraphs };
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
}: DraftSyncProps): void {
	const composer = useServices().services.composer;
	const attachmentsBySession = useRef(new Map<string, readonly string[]>());
	const lastSavedAttachments = useRef(new Map<string, string>());
	const restoredSession = useRef<SessionId | null>(null);
	const restore = useRef(onRestore);
	restore.current = onRestore;
	attachmentsBySession.current.set(sessionId, attachmentPaths);

	useEffect(() => {
		if (editor === null) return;
		const persist = () => {
			const paths = attachmentsBySession.current.get(sessionId) ?? [];
			lastSavedAttachments.current.set(sessionId, keyOf(paths));
			composer.saveDraft(sessionId, { text: editor.getText(), attachmentPaths: [...paths] });
		};
		editor.on("update", persist);
		return () => {
			editor.off("update", persist);
			const paths = attachmentsBySession.current.get(sessionId) ?? [];
			composer.saveDraft(sessionId, { text: editor.getText(), attachmentPaths: [...paths] });
		};
	}, [composer, editor, sessionId]);

	useEffect(() => {
		if (editor === null) return;
		let cancelled = false;
		restoredSession.current = null;
		const load = async () => {
			const result = await composer.loadDraft(sessionId);
			if (cancelled || !result.ok) return;
			const draft = result.value;
			if (editor.getText() !== draft.text) {
				editor.commands.setContent(draftToContent(draft.text), { emitUpdate: false });
			}
			lastSavedAttachments.current.set(sessionId, keyOf(draft.attachmentPaths));
			restoredSession.current = sessionId;
			restore.current?.(draft);
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [composer, editor, sessionId]);

	const attachmentKey = keyOf(attachmentPaths);
	useEffect(() => {
		if (editor === null || restoredSession.current !== sessionId) return;
		if (lastSavedAttachments.current.get(sessionId) === attachmentKey) return;
		lastSavedAttachments.current.set(sessionId, attachmentKey);
		composer.saveDraft(sessionId, {
			text: editor.getText(),
			attachmentPaths: [...attachmentPaths],
		});
	}, [attachmentKey, attachmentPaths, composer, editor, sessionId]);
}
