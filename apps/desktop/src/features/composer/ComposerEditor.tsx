/**
 * @feature COMP-01 Composer editor
 * Owns: The rich text editor itself, built on TipTap (StarterKit and our mention and slash
 * extensions), with the send key rules and paste handling.
 * Behaviour: ui-map.md 3.5 (editor: TipTap/ProseMirror, placeholder, aria-label 'composer'; pasted
 * text over 5000 characters becomes a text attachment; 'Paste copied files as paths'), 5.4 (send
 * keys).
 * Our design choice: Plain text with mention chips; headings, lists and marks from StarterKit are
 * switched off because the agent receives plain text. Send keys come from resolveSendKey
 * (send-key.ts). Use useEditor and EditorContent from @tiptap/react.
 * Must handle: IME composition (Enter must not send); paste of files and images (becomes
 * attachments); paste of a very long text (text attachment); Shift+Enter line break; undo and redo;
 * the draft text is saved on a short pause (use-draft-sync.ts); a suggestion popup open (Enter
 * picks the item, not send); screen reader name 'composer'.
 * Test first: Typing 'hello' and pressing Enter calls onSubmit('submit') with the text 'hello';
 * Shift+Enter inserts a line break instead.
 */

import type { SessionId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { SendIntent } from "./send-key.ts";

export interface ComposerEditorProps {
	sessionId: SessionId;
	disabled: boolean;
	onSubmit: (intent: SendIntent) => void;
}

export function ComposerEditor(_props: ComposerEditorProps): never {
	return notImplemented("COMP-01");
}
