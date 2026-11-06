/**
 * @feature REV-08 Editor surface
 * Owns: the React host of one CodeMirror view. It creates the view in an effect, keeps it in sync
 * with props, and destroys it on unmount.
 * Behaviour: ui-map.md 3.2 and 8 (CodeMirror 6 for file editing; ligatures setting applies to
 * editors and diffs), 5.3 (the editor's right-click menu has Cut, Copy and Paste with key hints).
 * Library reference: `EditorView` from "@codemirror/view" and `EditorState` from
 * "@codemirror/state". Language packages are not installed, so the document is plain text.
 * Must handle: the document being replaced from outside (disk reload) without losing the cursor
 * when possible, destroy on unmount with no leaked listeners, focus on open, read-only mode, and
 * a theme or wrapping change while the editor is open (a reconfigure, not a new view).
 * Test first: mounting then unmounting leaves no editor DOM and no listeners behind.
 */
import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "../../../ui/ContextMenu.tsx";
import {
	createEditorState,
	type EditorSurfaceOptions,
	editorExtensions,
} from "./codemirror-setup.ts";

export interface EditorSurfaceProps {
	path: string;
	text: string;
	options: EditorSurfaceOptions;
	onChange: (text: string) => void;
	onSave: () => void;
}

export function EditorSurface({ path, text, options, onChange, onSave }: EditorSurfaceProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<EditorView | null>(null);
	const hooksRef = useRef({ onChange, onSave });
	hooksRef.current = { onChange, onSave };
	const [note, setNote] = useState<string | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: only a different file rebuilds the view.
	useEffect(() => {
		const host = hostRef.current;
		if (host === null) return;
		const view = new EditorView({
			state: createEditorState(path, text, options, {
				onChange: (next) => hooksRef.current.onChange(next),
				onSave: () => hooksRef.current.onSave(),
			}),
			parent: host,
		});
		viewRef.current = view;
		view.focus();
		return () => {
			viewRef.current = null;
			view.destroy();
		};
		// The view is rebuilt only for a different file; text and options are synced below.
	}, [path]);

	useEffect(() => {
		const view = viewRef.current;
		if (view === null) return;
		if (view.state.doc.toString() === text) return;
		const anchor = Math.min(view.state.selection.main.anchor, text.length);
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: text },
			selection: { anchor },
		});
	}, [text]);

	useEffect(() => {
		const view = viewRef.current;
		if (view === null) return;
		view.dispatch({
			effects: StateEffect.reconfigure.of(
				editorExtensions(path, options, {
					onChange: (next) => hooksRef.current.onChange(next),
					onSave: () => hooksRef.current.onSave(),
				}),
			),
		});
	}, [path, options]);

	const selectedText = (): string => {
		const view = viewRef.current;
		if (view === null) return "";
		return view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
	};

	const copy = async (): Promise<void> => {
		const text = selectedText();
		if (text.length === 0) return;
		try {
			await navigator.clipboard.writeText(text);
			setNote(null);
		} catch {
			setNote("Could not copy to the clipboard.");
		}
	};

	const cut = async (): Promise<void> => {
		const view = viewRef.current;
		if (view === null) return;
		const text = selectedText();
		if (text.length === 0) return;
		try {
			await navigator.clipboard.writeText(text);
			view.dispatch({
				changes: { from: view.state.selection.main.from, to: view.state.selection.main.to },
			});
			setNote(null);
		} catch {
			setNote("Could not cut to the clipboard.");
		}
	};

	const paste = async (): Promise<void> => {
		const view = viewRef.current;
		if (view === null) return;
		try {
			const text = await navigator.clipboard.readText();
			view.dispatch({
				changes: {
					from: view.state.selection.main.from,
					to: view.state.selection.main.to,
					insert: text,
				},
			});
			setNote(null);
		} catch {
			setNote("Could not read the clipboard.");
		}
	};

	return (
		<ContextMenu
			items={
				<>
					<ContextMenuItem shortcut="⌘X" onSelect={() => void cut()}>
						Cut
					</ContextMenuItem>
					<ContextMenuItem shortcut="⌘C" onSelect={() => void copy()}>
						Copy
					</ContextMenuItem>
					<ContextMenuItem shortcut="⌘V" onSelect={() => void paste()}>
						Paste
					</ContextMenuItem>
					<ContextMenuSeparator />
					<ContextMenuItem onSelect={() => viewRef.current?.focus()}>
						Select all text
					</ContextMenuItem>
				</>
			}
		>
			<div className="relative h-full w-full" data-editor-path={path}>
				<div ref={hostRef} className="h-full w-full" />
				{note === null ? null : (
					<p
						role="alert"
						className="absolute right-2 bottom-2 rounded-sm bg-raised px-2 py-1 text-xs text-danger shadow-popover"
					>
						{note}
					</p>
				)}
			</div>
		</ContextMenu>
	);
}
