/**
 * @feature COMP-09 Prompt snippets
 * Owns: which snippet dialog is open (the picker, the create form or the edit list) and how a
 * chosen prompt reaches the composer that opened the picker.
 * Behaviour: ui-map.md 5.1 (the palette's Create snippet and Edit snippets actions), 5.2 (the
 * Create snippet and Edit snippets dialogs), 3.5 (Add snippet and Insert snippet).
 * Our design choice: one zustand store, so the composer's '+' menu, Cmd+; and the palette open the
 * same dialog the same way. The insert callback belongs to the composer that opened the picker and
 * is dropped when the dialog closes.
 * Must handle: a picker opened without a composer (the palette's Create snippet and Edit snippets);
 * a create form started from the picker returning to the picker after saving; a create form started
 * from the edit list returning to the edit list.
 * Test first: opening the picker from the palette leaves no insert callback, and closing drops it.
 */
import { create } from "zustand";

export type SnippetDialogMode = "picker" | "create" | "edit";

export type SnippetReturnTo = "picker" | "edit";

export interface SnippetDialogsState {
	mode: SnippetDialogMode | null;
	/** Inserts a chosen prompt into the composer that opened the picker. */
	insert: ((prompt: string) => void) | null;
	/** Where the create form goes after its snippet is saved. */
	returnTo: SnippetReturnTo | null;
	openPicker: (insert?: (prompt: string) => void) => void;
	openCreate: (returnTo?: SnippetReturnTo) => void;
	openEdit: () => void;
	/** Leaves the create form for the dialog that opened it. */
	finishCreate: () => void;
	close: () => void;
}

export const useSnippetDialogsStore = create<SnippetDialogsState>()((set, get) => ({
	mode: null,
	insert: null,
	returnTo: null,
	openPicker: (insert) => set({ mode: "picker", insert: insert ?? null, returnTo: null }),
	openCreate: (returnTo) => set({ mode: "create", returnTo: returnTo ?? null }),
	openEdit: () => set({ mode: "edit", insert: null, returnTo: null }),
	finishCreate: () => {
		const { returnTo, insert } = get();
		if (returnTo === "picker") {
			set({ mode: "picker", insert });
			return;
		}
		if (returnTo === "edit") {
			set({ mode: "edit", insert: null, returnTo: null });
			return;
		}
		set({ mode: null, insert: null, returnTo: null });
	},
	close: () => set({ mode: null, insert: null, returnTo: null }),
}));
