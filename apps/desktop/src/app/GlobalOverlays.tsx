/**
 * @feature NAV-08 Global overlay host
 * Owns: mounting whichever window-level overlay is open (command palette, shortcuts dialog, Passport, quick
 * open, search in files, Feedback) and the prompt snippet dialogs (COMP-09), once, at the root of
 * the app, and registering the Cmd+P, Cmd+Shift+F and Cmd+Alt+/ commands that show quick open,
 * search in files and the shortcuts dialog, and Send feedback (Cmd+Alt+F and Help > Send
 * Feedback, APP-09).
 * Behaviour: ui-map.md 5.1 (the palette is a dialog mounted once), 3.10 (quick open and search in files),
 * 1.1 (global overlays are mounted once at the root); PR-01's GitHub sign-in notice is raised here
 * so every screen hears it.
 * Our design choice: an overlay is mounted only while it is open. Its state resets on every open, and an
 * unbuilt overlay shows a small card with a close button instead of an empty frame.
 * Must handle: Escape or outside click closes (the overlay calls onOpenChange(false)); opening a second overlay
 * replaces the first; an overlay that is not built yet can still be dismissed; Cmd+K opens the palette from any
 * screen; Changelog and Docs open this app's own pages (APP-06, the palette's Navigation group), and Passport
 * opens its overlay (NAV-13).
 * Our design choice: Changelog opens the published changelog page (scripts/site/build.ts writes it from
 * CHANGELOG.md) and Docs opens the repository's docs folder, which the product page also links to. Conductor's
 * pair open its own site (renderApp @11369015: `_b.changelog`, `_b.home`), which does not exist for this app.
 * Test first: show("palette") then show("passport") leaves only "passport" open; Cmd+K opens the palette.
 */
import type { WorkspaceId } from "@conducted/shared";
import { useRouterState } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { useActions } from "../core/hooks.ts";
import { SnippetOverlays } from "../features/composer/SnippetOverlays.tsx";
import { FeedbackDialog } from "../features/diagnostics/FeedbackDialog.tsx";
import { CommandPalette } from "../features/palette/CommandPalette.tsx";
import { QuickOpen } from "../features/palette/QuickOpen.tsx";
import { SearchInFiles } from "../features/palette/SearchInFiles.tsx";
import { ShortcutsDialog } from "../features/palette/ShortcutsDialog.tsx";
import { PassportDialog } from "../features/passport/PassportDialog.tsx";
import { GitHubSignInNotice } from "../features/settings/GitHubSignInNotice.tsx";
import { NotBuiltYet } from "../ui/not-built-yet.tsx";
import type { OverlayProps } from "../ui/overlay-props.ts";
import { toastError } from "../ui/Toast.tsx";
import { useCommandHandler } from "./command-dispatcher.ts";
import { type OverlayId, useOverlayStore } from "./overlay-store.ts";

/** The published changelog page, written from CHANGELOG.md by scripts/site/build.ts. */
export const CHANGELOG_URL = "https://jahala.github.io/conducted/changelog/";
/** The repository's docs folder, the page the product site's Docs link opens (docs/site/index.html). */
export const DOCUMENTATION_URL = "https://github.com/jahala/conducted/tree/main/docs";

const overlays: Record<OverlayId, { area: string; Component: ComponentType<OverlayProps> }> = {
	palette: { area: "Command palette", Component: CommandPalette },
	shortcuts: { area: "Keyboard shortcuts", Component: ShortcutsDialog },
	passport: { area: "Passport", Component: PassportDialog },
	"quick-open": { area: "Quick open", Component: QuickOpen },
	"search-files": { area: "Search in files", Component: SearchInFiles },
	feedback: { area: "Feedback", Component: FeedbackDialog },
};

export function GlobalOverlays() {
	const actions = useActions();
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
	useCommandHandler("app.sendFeedback", "base", () => {
		show("feedback");
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
	useCommandHandler("app.openPassport", "base", () => {
		show("passport");
		return true;
	});
	useCommandHandler("app.openChangelog", "base", () => {
		void actions.app.openUrl(CHANGELOG_URL).then((result) => {
			if (!result.ok) toastError("Couldn't open the changelog", result.error);
		});
		return true;
	});
	useCommandHandler("app.openDocumentation", "base", () => {
		void actions.app.openUrl(DOCUMENTATION_URL).then((result) => {
			if (!result.ok) toastError("Couldn't open the documentation", result.error);
		});
		return true;
	});
	if (open === null) {
		return (
			<>
				<GitHubSignInNotice />
				<SnippetOverlays />
			</>
		);
	}
	const { area, Component } = overlays[open];
	return (
		<>
			<GitHubSignInNotice />
			<SnippetOverlays />
			<NotBuiltYet area={area} variant="overlay" onDismiss={close} resetKey={open}>
				<Component
					open
					onOpenChange={(next) => (next ? undefined : close())}
					workspaceId={workspaceId}
				/>
			</NotBuiltYet>
		</>
	);
}
