/**
 * @feature NAV-15 Terminals and previews that survive tab switches
 * Owns: a layer above the tab content that keeps terminals and browser previews mounted, and places each
 * one over the empty slot (the anchor) that its tab renders. Also the anchor, which measures its box.
 * Behaviour: ui-map.md 8 ("Surface/anchor system places long-lived DOM (terminals, browser webviews) over
 * layout anchors so they survive tab switches"), 1.1; services-map.md 1.5 (a surface layout registry holds
 * anchors, surface configs, placements and the surface that asked for focus; a dialog manager is separate).
 * Our design choice: the placements (a rectangle per surface id) are passed in, because the registry is a
 * store owned by the caller. The layer is pure placement: it draws what it is given and measures nothing.
 * Must handle: a tab switch (the surface stays mounted, hidden, with its scrollback and page state);
 * a tab that closes (its surface is removed and disposed); a layout that moves (split drag, sidebar resize,
 * window resize, zen mode) so the surface follows without a frame of lag; an anchor that is not on screen
 * (the surface is hidden, not unmounted); hidden surfaces take no focus and no pointer events; two
 * surfaces never share a slot; keyboard focus moves into the surface when the tab is activated.
 * Test first: switching the active tab away and back does not unmount the terminal surface.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";
import type { ReactNode } from "react";

export type SurfaceKind = "terminal" | "browser";

/** A box in window coordinates, in pixels. */
export interface SurfaceRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SurfaceSpec {
	surfaceId: string;
	kind: SurfaceKind;
	workspaceId: WorkspaceId;
	/** What the surface draws, for example a TerminalSurface or a PreviewFrame. */
	content: ReactNode;
}

export interface SurfaceLayerProps {
	surfaces: readonly SurfaceSpec[];
	/** Where each surface goes. A missing or null entry hides the surface without unmounting it. */
	placements: ReadonlyMap<string, SurfaceRect | null>;
	/** The surface that should take keyboard focus, if any. */
	focusSurfaceId: string | null;
}

export function SurfaceLayer(_props: SurfaceLayerProps): never {
	return notImplemented("NAV-15");
}

export interface SurfaceAnchorProps {
	surfaceId: string;
	/** Called with the anchor's box whenever it moves or resizes, and with null when it unmounts. */
	onPlace: (surfaceId: string, rect: SurfaceRect | null) => void;
}

export function SurfaceAnchor(_props: SurfaceAnchorProps): never {
	return notImplemented("NAV-15");
}
