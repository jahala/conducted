/**
 * @feature NAV-08 Props of a window-level overlay
 * Owns: the one prop shape that the command palette, shortcuts dialog, Passport, quick open and search in
 * files share, so the overlay host (app/GlobalOverlays.tsx) can mount any of them the same way.
 * Behaviour: ui-map.md 5.1 and 5.2 (dialogs and the palette open and close from anywhere; the palette offers
 * workspace actions for the current workspace).
 * Must handle: the overlay calls onOpenChange(false) on Escape, on outside click and after it acts;
 * `workspaceId` is null on screens that have no current workspace (Home, settings).
 * Test first: not needed, this is a type only.
 */
import type { WorkspaceId } from "@conducted/shared";

export interface OverlayProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The workspace in the current route, if any. */
	workspaceId: WorkspaceId | null;
}
