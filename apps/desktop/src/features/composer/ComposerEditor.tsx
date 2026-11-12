/**
 * @feature COMP-01 Composer editor
 * Owns: The rich text editor itself, built on TipTap and StarterKit, with the send key rules.
 * Behaviour: ui-map.md 3.5 (editor: TipTap/ProseMirror, placeholder, aria-label 'composer'), 5.4
 * (send keys). Measured from Conductor 0.92.1: the placeholder "Ask to make changes, @mention files,
 * run /commands" in the faint colour; 14px text at weight 350, at least 48px tall and at most 188px
 * before it scrolls; the composer box around it holds the padding.
 * Our design choice: Plain text with no marks; headings, lists and other marks from StarterKit are
 * switched off because the agent receives plain text. Send keys come from resolveSendKey
 * (send-key.ts). Use useEditor and EditorContent from @tiptap/react.
 * Focus: the editor takes the keyboard focus with the caret at the end when it opens, unless it is
 * disabled, as Conductor's composer does (renderApp's composer, autoFocus on by default).
 * Must handle: IME composition (Enter must not send); an open '@', '/', '#' or '§' menu (Enter goes
 * to the menu, mentions/trigger-menu.ts); Shift+Enter line break; an app shortcut on a modified
 * Enter (Cmd+Shift+Enter, Cmd+Alt+Enter), which runs before ProseMirror takes the key; undo and redo
 * (StarterKit's UndoRedo); the draft text is saved on a short pause (use-draft-sync.ts); screen
 * reader name 'composer'.
 * The composer passes the trigger extensions here: `@` file mentions (COMP-04), `#` PR and issue
 * mentions (COMP-05) and `/` slash commands (COMP-06). Without them the editor is plain text, as
 * it was before those triggers.
 * Moved: paste of files and images, and long pasted text becoming an attachment (COMP-07).
 * Test first: Typing 'hello' and pressing Enter calls onSubmit('submit') with the text 'hello';
 * Shift+Enter inserts a line break instead.
 */

import type { SessionId } from "@conducted/shared";
import {
	type Editor,
	EditorContent,
	type Extensions,
	useEditor,
	useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import type { KeyboardEvent } from "react";
import { useEffect } from "react";
import { useScopeKeyDown } from "../../app/command-dispatcher.ts";
import { triggerMenuOpen } from "./mentions/trigger-menu.ts";
import { resolveSendKey, type SendIntent, type SendWith } from "./send-key.ts";

export interface ComposerEditorProps {
	sessionId: SessionId;
	disabled: boolean;
	onSubmit: (intent: SendIntent) => void;
	/** The setting `message_send_key`, mapped to the send-key mode. Default "enter". */
	sendWith?: SendWith;
	/** The editor, for the composer to read its text and to restore a draft. */
	onEditorReady?: (editor: Editor | null) => void;
	/** The trigger extensions the composer supplies (COMP-04, COMP-06). Default: plain text. */
	extensions?: Extensions;
	/**
	 * The hint shown while the editor is empty. Default: Conductor's chat placeholder; goal mode shows
	 * "Set a goal" (COMP-10).
	 */
	placeholder?: string;
	/** Called when the editor gains or loses focus. */
	onFocusChange?: (focused: boolean) => void;
}

/** Conductor's placeholder for a chat's composer. */
export const COMPOSER_PLACEHOLDER = "Ask to make changes, @mention files, run /commands";

/** Plain text with no marks: the editor's own extensions when the caller supplies none. */
const plainExtensions: Extensions = [
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
];

export function ComposerEditor({
	sessionId,
	disabled,
	onSubmit,
	sendWith = "enter",
	onEditorReady,
	extensions,
	placeholder = COMPOSER_PLACEHOLDER,
	onFocusChange,
}: ComposerEditorProps) {
	const editor = useEditor(
		{
			extensions: extensions ?? plainExtensions,
			content: "",
			// Conductor's composer takes the focus, caret at the end, when a chat opens.
			autofocus: disabled ? false : "end",
			editorProps: {
				attributes: {
					"aria-label": "composer",
					"aria-multiline": "true",
					"data-testid": "composer-input",
					class: "min-h-12 max-h-[188px] overflow-y-auto text-sm font-light text-fg outline-none",
					role: "textbox",
				},
			},
		},
		[sessionId, extensions],
	);

	const runAppKey = useScopeKeyDown(null);

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

	useEffect(() => {
		if (editor === null || onFocusChange === undefined) return;
		const focus = () => onFocusChange(true);
		const blur = () => onFocusChange(false);
		editor.on("focus", focus);
		editor.on("blur", blur);
		return () => {
			editor.off("focus", focus);
			editor.off("blur", blur);
		};
	}, [editor, onFocusChange]);

	const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (disabled) return;
		// An open trigger menu takes Enter itself (it chooses a row); the message is not sent.
		if (editor !== null && triggerMenuOpen(editor.state)) return;
		const native = event.nativeEvent;
		const composing = native.isComposing || native.keyCode === 229;
		const intent = resolveSendKey(
			{
				key: event.key,
				shiftKey: event.shiftKey,
				metaKey: event.metaKey,
				altKey: event.altKey,
				ctrlKey: event.ctrlKey,
				isComposing: composing,
			},
			sendWith,
		);
		// ProseMirror prevents the default of every Enter it does not handle, and the root listener
		// skips a prevented key. So a modified Enter the send keys give no meaning to (Cmd+Shift+Enter
		// approves a waiting plan) runs as an app shortcut here, before the editor sees it, as
		// Conductor's root listener does from the window's capture phase (renderApp @682452).
		if (intent === null && event.key === "Enter" && !composing) {
			if (runAppKey(native)) event.stopPropagation();
			return;
		}
		if (intent !== "submit" && intent !== "submit_opposite") return;
		event.preventDefault();
		event.stopPropagation();
		onSubmit(intent);
	};

	return (
		<div className="relative" onKeyDownCapture={handleKeyDown} data-testid="composer-editor">
			{empty ? (
				<span className="pointer-events-none absolute left-0 top-0 text-sm font-light text-fg-subtle">
					{placeholder}
				</span>
			) : null}
			<EditorContent editor={editor} />
		</div>
	);
}
