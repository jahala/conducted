/**
 * @feature NAV-01 Full-page frame
 * Owns: the frame for routes that have no sidebar (settings, diagnostics, onboarding): a drag strip for the
 * overlay title bar and a filling content area.
 * Behaviour: ui-map.md 2 (settings, diagnostics and onboarding sit outside the main layout), 1.1 (header areas
 * carry data-tauri-drag-region, traffic lights are inset by a CSS variable).
 * Must handle: the drag strip stays at the top while the content scrolls; content brings its own heading.
 * Test first: renders its children below an element marked as a drag region.
 */
import type { ReactNode } from "react";

export function FullPage({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-full flex-col bg-canvas">
			<div data-tauri-drag-region className="h-(--titlebar-height) shrink-0" />
			<div className="min-h-0 flex-1">{children}</div>
		</div>
	);
}
