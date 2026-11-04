/**
 * @feature RUN-04 BrowserTab
 * Owns: a center tab with an in-app browser preview of the workspace's dev server. Entry point
 * embedded by the workspace tab strip.
 * Behaviour: ui-map.md 3.2, "Tab content: Browser" ("Reload", "Open in browser", "Port and path"
 * picker, "Starting preview...", an annotation overlay with "Add to chat"; setting "In-app browser
 * preview"); native-and-sidecar-map.md (Agentation: a proxy injects the annotation toolbar into the
 * page).
 * Children: BrowserToolbar, PreviewFrame, AnnotationOverlay, BrowserState.
 * Data: useRunState (is the dev server running, detected ports), useWorkspace, useSetting. Where
 * the page is drawn and how annotations reach the app are open questions (see PreviewFrame.tsx).
 * Must handle: the server not running or not yet listening ("Starting preview..." then a timeout
 * with a Retry), the page failing to load, a navigation to another origin (kept inside only for
 * localhost; other URLs open in the system browser, Our design choice), the setting being off (the
 * tab says previews open in the system browser and offers that), an archived workspace, and the
 * tab being hidden (the page keeps its state).
 * Test first: with the server not listening the tab shows "Starting preview" and, after the
 * timeout, a Retry action.
 */
import type { WorkspaceId } from "@conducted/shared";
import { notImplemented } from "@conducted/shared";

export function BrowserTab(_props: { workspaceId: WorkspaceId; url: string }): never {
	return notImplemented("RUN-04");
}
