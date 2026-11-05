/**
 * @feature COMP-01 Composer editor
 * Owns: The rich text editor itself, built on TipTap and StarterKit, with the send key rules.
 * Behaviour: ui-map.md 3.5 (editor: TipTap/ProseMirror, placeholder, aria-label 'composer'), 5.4
 * (send keys).
 * Our design choice: Plain text with no marks; headings, lists and other marks from StarterKit are
 * switched off because the agent receives plain text. Send keys come from resolveSendKey
 * (send-key.ts). Use useEditor and EditorContent from @tiptap/react.
 * Must handle: IME composition (Enter must not send); Shift+Enter line break; undo and redo
 * (StarterKit's UndoRedo); the draft text is saved on a short pause (use-draft-sync.ts); screen
 * reader name 'composer'.
 * Moved: `@` file mentions, `#` PR and issue mentions, `/` slash commands, paste of files and
 * images, and long pasted text becoming an attachment belong to COMP-04, COMP-05, COMP-06 and
 * COMP-07.
 * Test first: Typing 'hello' and pressing Enter calls onSubmit('submit') with the text 'hello';
 * Shift+Enter inserts a line break instead.
 */

import type { SessionId } from "@conducted/shared";
import { type Editor, EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { KeyboardEvent } from "react";
import { useEffect } from "react";
import { resolveSendKey, type SendIntent, type SendWith } from "./send-key.ts";

export interface ComposerEditorProps {
	sessionId: SessionId;
	disabled: boolean;
	onSubmit: (intent: SendIntent) => void;
	/** The setting `message_send_key`, mapped to the send-key mode. Default "enter". */
	sendWith?: SendWith;
	/** The editor, for the composer to read its text and to restore a draft. */
	onEditorReady?: (editor: Editor | null) => void;
}

export function ComposerEditor({
	sessionId,
	disabled,
	onSubmit,
	sendWith = "enter",
	onEditorReady,
}: ComposerEditorProps) {
	const editor = useEditor(
		{
			extensions: [
				StarterKit.configure({
					blockquote: false,
					bold: false,
					bulletList: false,
					code: false,
					codeBlock: false,
					heading: false,
					horizontalRule: false,
					italic: false,
					link: false,
					listItem: false,
					listKeymap: false,
					orderedList: false,
					strike: false,
					underline: false,
				}),
			],
			content: "",
			editorProps: {
				attributes: {
					"aria-label": "composer",
					"aria-multiline": "true",
					class:
						"min-h-[88px] max-h-[188px] overflow-y-auto px-3 py-2 text-sm font-light text-fg outline-none",
					role: "textbox",
				},
			},
		},
		[sessionId],
	);

	const empty = useEditorState({
		editor,
		selector: ({ editor: current }) => current?.isEmpty ?? true,
	});

	useEffect(() => {
		onEditorReady?.(editor);
		return () => onEditorReady?.(null);
	}, [editor, onEditorReady]);

	useEffect(() => {
		editor?.setEditable(!disabled);
	}, [editor, disabled]);

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (disabled) return;
		const native = event.nativeEvent;
		const intent = resolveSendKey(
			{
				key: event.key,
				shiftKey: event.shiftKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				ctrlKey: event.ctrlKey,
				isComposing: native.isComposing || native.keyCode === 229,
			},
			sendWith,
		);
		if (intent !== "submit" && intent !== "submit_opposite") return;
		event.preventDefault();
		event.stopPropagation();
		onSubmit(intent);
	};

	return (
		<div className="relative" onKeyDownCapture={handleKeyDown} data-testid="composer-editor">
			{empty ? (
				<span className="pointer-events-none absolute left-3 top-2 text-sm font-light text-fg-subtle">
					Write something ...
				</span>
			) : null}
			<EditorContent editor={editor} />
		</div>
	);
}
