/**
 * @feature WS-08 Open-in button
 * Owns: the split button of the Open in control. The main part opens the default app, the arrow
 * opens the menu.
 * Behaviour: ui-map.md 3.10 (Cmd+O opens in the default app, Cmd+Shift+O opens the menu).
 * Must handle: no default app (main part opens the menu), an open in flight (spinner, one click
 * at a time), the label and icon of the default app, and keyboard focus ring.
 * Test first: clicking the main part calls onOpenDefault once, even if clicked twice while busy.
 */
import { notImplemented } from "@conducted/shared";
import type { OpenInApp } from "./open-in-apps.ts";

export interface OpenInButtonProps {
	defaultApp: OpenInApp | null;
	busy: boolean;
	disabledReason: string | null;
	onOpenDefault: () => void;
	menuOpen: boolean;
	onMenuOpenChange: (open: boolean) => void;
}

export function OpenInButton(_props: OpenInButtonProps): never {
	return notImplemented("WS-08");
}
