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
 * window resize, zen mode) so the surface follows when the anchor resizes, the window resizes or the page
 * scrolls; an anchor that is not on screen (the surface is hidden, not unmounted); hidden surfaces take no
 * focus and no pointer events; two surfaces never share a slot; keyboard focus moves into the surface when
 * the tab is activated.
 * Test first: switching the active tab away and back does not unmount the terminal surface.
 */
import type { WorkspaceId } from "@conducted/shared";
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

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

interface PlacedSurface {
	spec: SurfaceSpec;
	rect: SurfaceRect | null;
}

const FOCUSABLE =
	"textarea, input, select, [contenteditable='true'], [tabindex]:not([tabindex='-1'])";

/** A slot is a real box on screen. A missing, null or empty box is not shown. */
function usableRect(rect: SurfaceRect | null | undefined): rect is SurfaceRect {
	return rect !== null && rect !== undefined && rect.width > 0 && rect.height > 0;
}

function rectKey(rect: SurfaceRect): string {
	return `${rect.x}:${rect.y}:${rect.width}:${rect.height}`;
}

/**
 * One surface per slot: the first surface given an anchor keeps it, and a later surface with the same
 * rectangle stays hidden until it gets a slot of its own.
 */
function placeSurfaces(
	surfaces: readonly SurfaceSpec[],
	placements: ReadonlyMap<string, SurfaceRect | null>,
): PlacedSurface[] {
	const claimed = new Set<string>();
	return surfaces.map((spec) => {
		const placed = placements.get(spec.surfaceId);
		if (!usableRect(placed)) return { spec, rect: null };
		const key = rectKey(placed);
		if (claimed.has(key)) return { spec, rect: null };
		claimed.add(key);
		return { spec, rect: placed };
	});
}

function surfaceStyle(rect: SurfaceRect): CSSProperties {
	return {
		position: "fixed",
		left: rect.x,
		top: rect.y,
		width: rect.width,
		height: rect.height,
		pointerEvents: "auto",
	};
}

/** Moves keyboard focus into the surface, preferring an editable control inside it. */
function focusSurface(element: HTMLElement): void {
	const target = element.querySelector<HTMLElement>(FOCUSABLE) ?? element;
	target.focus();
}

function SurfaceHost({
	spec,
	rect,
	focused,
}: {
	spec: SurfaceSpec;
	rect: SurfaceRect | null;
	focused: boolean;
}) {
	const hostRef = useRef<HTMLDivElement>(null);
	const visible = rect !== null;

	useEffect(() => {
		const host = hostRef.current;
		if (host === null) return;
		if (!visible) {
			const active = document.activeElement;
			if (active instanceof HTMLElement && host.contains(active)) active.blur();
			return;
		}
		if (focused) focusSurface(host);
	}, [visible, focused]);

	return (
		<div
			ref={hostRef}
			data-surface-id={spec.surfaceId}
			data-surface-kind={spec.kind}
			data-surface-visible={visible ? "true" : "false"}
			hidden={!visible}
			aria-hidden={visible ? undefined : true}
			tabIndex={visible ? -1 : undefined}
			className={visible ? "overflow-hidden" : undefined}
			style={rect === null ? undefined : surfaceStyle(rect)}
		>
			{spec.content}
		</div>
	);
}

/** Draws every surface it is given, keeping hidden ones mounted over their last known slot. */
export function SurfaceLayer({ surfaces, placements, focusSurfaceId }: SurfaceLayerProps) {
	const placed = placeSurfaces(surfaces, placements);
	return (
		<div data-surface-layer="" className="pointer-events-none fixed inset-0 z-10">
			{placed.map(({ spec, rect }) => (
				<SurfaceHost
					key={spec.surfaceId}
					spec={spec}
					rect={rect}
					focused={rect !== null && focusSurfaceId === spec.surfaceId}
				/>
			))}
		</div>
	);
}

export interface SurfaceAnchorProps {
	surfaceId: string;
	/** Called with the anchor's box whenever it moves or resizes, and with null when it unmounts. */
	onPlace: (surfaceId: string, rect: SurfaceRect | null) => void;
}

/**
 * An empty slot in the tab content. It reports its box to the caller, which stores the placement the
 * surface layer draws. Reporting stops and null is sent when the slot unmounts.
 */
export function SurfaceAnchor({ surfaceId, onPlace }: SurfaceAnchorProps) {
	const anchorRef = useRef<HTMLDivElement>(null);
	const placeRef = useRef(onPlace);
	placeRef.current = onPlace;

	useLayoutEffect(() => {
		const element = anchorRef.current;
		if (element === null) return;
		const report = () => {
			const box = element.getBoundingClientRect();
			placeRef.current(surfaceId, {
				x: box.x,
				y: box.y,
				width: box.width,
				height: box.height,
			});
		};
		report();
		const observer =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => report());
		observer?.observe(element);
		window.addEventListener("resize", report);
		document.addEventListener("scroll", report, true);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", report);
			document.removeEventListener("scroll", report, true);
			placeRef.current(surfaceId, null);
		};
	}, [surfaceId]);

	return <div ref={anchorRef} data-surface-anchor={surfaceId} className="h-full w-full" />;
}
