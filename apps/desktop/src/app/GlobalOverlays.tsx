/**
 * @feature NAV-08 Global overlay host
 * Owns: mounting whichever window-level overlay is open (command palette, shortcuts dialog, Passport, quick
 * open, search in files), once, at the root of the app, and registering the Cmd+P, Cmd+Shift+F and
 * Cmd+Alt+/ commands that show quick open, search in files and the shortcuts dialog.
 * Behaviour: ui-map.md 5.1 (the palette is a dialog mounted once), 3.10 (quick open and search in files),
 * 1.1 (global overlays are mounted once at the root).
 * Our design choice: an overlay is mounted only while it is open. Its state resets on every open, and an
 * unbuilt overlay shows a small card with a close button instead of an empty frame.
 * Must handle: Escape or outside click closes (the overlay calls onOpenChange(false)); opening a second overlay
 * replaces the first; an overlay that is not built yet can still be dismissed; Cmd+K opens the palette from any
 * screen.
 * Test first: show("palette") then show("passport") leaves only "passport" open; Cmd+K opens the palette.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useRouterState } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { CommandPalette } from "../features/palette/CommandPalette.tsx";
import { QuickOpen } from "../features/palette/QuickOpen.tsx";
import { SearchInFiles } from "../features/palette/SearchInFiles.tsx";
import { ShortcutsDialog } from "../features/palette/ShortcutsDialog.tsx";
import { PassportDialog } from "../features/passport/PassportDialog.tsx";
import { NotBuiltYet } from "../ui/not-built-yet.tsx";
import type { OverlayProps } from "../ui/overlay-props.ts";
import { useCommandHandler } from "./command-dispatcher.ts";
import { type OverlayId, useOverlayStore } from "./overlay-store.ts";

const overlays: Record<OverlayId, { area: string; Component: ComponentType<OverlayProps> }> = {
	palette: { area: "Command palette", Component: CommandPalette },
	shortcuts: { area: "Keyboard shortcuts", Component: ShortcutsDialog },
	passport: { area: "Passport", Component: PassportDialog },
	"quick-open": { area: "Quick open", Component: QuickOpen },
	"search-files": { area: "Search in files", Component: SearchInFiles },
};

export function GlobalOverlays() {
	const open = useOverlayStore((state) => state.open);
	const show = useOverlayStore((state) => state.show);
	const close = useOverlayStore((state) => state.close);
	const workspaceId = useRouterState({
		select: (state) => {
			for (let index = state.matches.length - 1; index >= 0; index -= 1) {
				const params = state.matches[index]?.params as { workspaceId?: unknown } | undefined;
				if (typeof params?.workspaceId === "string") return params.workspaceId as WorkspaceId;
			}
			return null;
		},
	});
	useCommandHandler("nav.quickOpenFile", "base", () => {
		show("quick-open");
		return true;
	});
	useCommandHandler("nav.searchInFiles", "base", () => {
		show("search-files");
		return true;
	});
	useCommandHandler("app.commandPalette", "base", () => {
		show("palette");
		return true;
	});
	useCommandHandler("app.showShortcuts", "base", () => {
		show("shortcuts");
		return true;
	});
	if (open === null) return null;
	const { area, Component } = overlays[open];
	return (
		<NotBuiltYet area={area} variant="overlay" onDismiss={close} resetKey={open}>
			<Component
				open
				onOpenChange={(next) => (next ? undefined : close())}
				workspaceId={workspaceId}
			/>
		</NotBuiltYet>
	);
}
