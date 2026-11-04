/**
 * @feature RUN-06 Terminal surface
 * Owns: the React host of one xterm.js Terminal and its fit addon. It creates both in an effect,
 * connects them to a TerminalConnection, and disposes everything on unmount.
 * Behaviour: ui-map.md 3.7 (xterm.js terminals); ui-map.md 6, Appearance ("Terminal font", size) and
 * Advanced ("Scrollback limit").
 * Library reference (checked in node_modules): `Terminal` from "@xterm/xterm" (options include
 * fontFamily, fontSize, scrollback, theme; methods write, resize, onData, dispose) and `FitAddon`
 * from "@xterm/addon-fit" (fit, proposeDimensions).
 * Must handle: fit on mount, on container resize and on becoming visible (debounced, only the
 * newest size is sent to the PTY), replaying history before live output with no duplicated lines,
 * dispose on unmount with no leaked listeners or observers, font or theme changes applied without
 * recreating the terminal, copy and paste with the usual shortcuts, and keyboard focus ring.
 * Test first: mounting then unmounting disposes the terminal and removes the resize observer.
 */
import { notImplemented } from "@conducted/shared";
import type { TerminalConnection } from "../../core/model.ts";
import type { TerminalAppearance } from "./terminal-theme.ts";

export interface TerminalSurfaceProps {
	connection: TerminalConnection;
	appearance: TerminalAppearance;
	/** The surface is on screen. Fit runs when this turns true. */
	visible: boolean;
	focusOnMount: boolean;
}

export function TerminalSurface(_props: TerminalSurfaceProps): never {
	return notImplemented("RUN-06");
}
