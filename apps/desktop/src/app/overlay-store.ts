/**
 * @feature NAV-08 Which global overlay is open
 * Owns: the one piece of state for window-level overlays: the command palette, shortcuts dialog, Passport,
 * quick open and search in files. Only one is open at a time.
 * Behaviour: ui-map.md 5.1 (palette with tabs), 3.10 (quick open and search in files), 5.2 (dialogs).
 * Our design choice: one zustand store, so a shortcut, a menu item and a sidebar row all open an overlay the
 * same way. Opening one closes any other.
 * Must handle: showing the open overlay again keeps it open; closing when none is open does nothing.
 * Test first: show("palette") then show("passport") leaves only "passport" open.
 */
import { create } from "zustand";

export type OverlayId = "palette" | "shortcuts" | "passport" | "quick-open" | "search-files";

export interface OverlayState {
	open: OverlayId | null;
	show: (id: OverlayId) => void;
	close: () => void;
}

export const useOverlayStore = create<OverlayState>()((set) => ({
	open: null,
	show: (id) => set({ open: id }),
	close: () => set({ open: null }),
}));
