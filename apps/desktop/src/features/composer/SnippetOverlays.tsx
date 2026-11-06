/**
 * @feature COMP-09 Prompt snippets
 * Owns: mounting the snippet picker, the create form and the edit list once at the app root, and
 * registering the palette's Create snippet and Edit snippets commands.
 * Behaviour: ui-map.md 5.1 (Create snippet and Edit snippets actions), 5.2 (both dialogs), 3.5
 * (Insert snippet, Cmd+;).
 * Our design choice: the dialogs live outside the composer so the palette can open them from any
 * screen. Only the composer supplies the callback that inserts a chosen prompt, so Insert snippet
 * changes the draft and Create snippet or Edit snippets do not need an open chat.
 * Must handle: the palette commands closing the palette and opening the right dialog; a create form
 * returning to the picker or the edit list that opened it; Cancel closing without a write.
 * Test first: running snippet.create from the palette opens "Create snippet", and snippet.edit opens
 * "Edit snippets".
 */
import { useStore } from "zustand";
import { useCommandHandler } from "../../app/command-dispatcher.ts";
import { SnippetFormDialog } from "./SnippetForm.tsx";
import { SnippetManagerDialog } from "./SnippetManager.tsx";
import { SnippetPicker } from "./SnippetPicker.tsx";
import { useSnippetDialogsStore } from "./snippet-dialogs-store.ts";

export function SnippetOverlays() {
	const mode = useStore(useSnippetDialogsStore, (state) => state.mode);
	const insert = useStore(useSnippetDialogsStore, (state) => state.insert);
	const openCreate = useSnippetDialogsStore((state) => state.openCreate);
	const openEdit = useSnippetDialogsStore((state) => state.openEdit);
	const finishCreate = useSnippetDialogsStore((state) => state.finishCreate);
	const close = useSnippetDialogsStore((state) => state.close);

	useCommandHandler("snippet.create", "base", () => {
		openCreate();
		return true;
	});
	useCommandHandler("snippet.edit", "base", () => {
		openEdit();
		return true;
	});

	const createClosed = (next: boolean) => {
		if (next) return;
		// Saving the form already moved to the dialog that opened it; only a cancel closes here.
		if (useSnippetDialogsStore.getState().mode === "create") close();
	};

	return (
		<>
			<SnippetPicker
				open={mode === "picker"}
				onOpenChange={(next) => {
					if (!next) close();
				}}
				onInsert={(prompt) => {
					insert?.(prompt);
					close();
				}}
				onCreate={() => openCreate("picker")}
			/>
			<SnippetFormDialog
				open={mode === "create"}
				snippet={null}
				onOpenChange={createClosed}
				onSaved={finishCreate}
			/>
			<SnippetManagerDialog
				open={mode === "edit"}
				onOpenChange={(next) => {
					if (!next) close();
				}}
				onCreate={() => openCreate("edit")}
			/>
		</>
	);
}

/** Opens the snippet picker for a composer, replacing any dialog already open. */
export function openSnippetPicker(insert: (prompt: string) => void): void {
	useSnippetDialogsStore.getState().openPicker(insert);
}
