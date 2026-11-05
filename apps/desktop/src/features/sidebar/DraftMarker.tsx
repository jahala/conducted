/**
 * @feature NAV-16 Draft markers on the Create row and on workspaces
 * Owns: the small marker that says "there is an unsent draft here". On the Create row it shows when the
 * new-workspace draft is not empty. On a workspace row it is a button named "Open draft" with the tooltip
 * "Draft".
 * Behaviour: ui-map.md 4.3 (the Create row shows a draft marker when the new-workspace draft is non-empty).
 * coverage/inventory-controls.md (a button with the aria label "Open draft", test id
 * workspace-draft-indicator, on a workspace row, tooltip "Draft"; it opens that workspace's draft; the exact
 * draft kind is not clear from the bundle).
 * Data: the caller passes the draft (useDraft for a chat, the composer store for the new-workspace draft).
 * Our design choice: "Open draft" opens the workspace with its draft chat active and the composer focused.
 * A draft with only spaces and no attachments counts as empty.
 * Must handle: an empty or whitespace-only draft (no marker); a draft with attachments but no text (marker);
 * the marker sitting beside the unread dot and the time without moving the row's columns; keyboard focus
 * on the workspace-row button; a screen reader reading "Open draft" for the button and "Draft" for the
 * Create-row marker.
 * Test first: a draft of "   " with no attachments renders no marker; "fix the login" renders one.
 */
import { notImplemented } from "@conducted/shared";
import type { Draft } from "../../core/api.ts";

export type DraftMarkerProps =
	| { place: "create-row"; draft: Draft | null }
	| { place: "workspace-row"; draft: Draft | null; onOpenDraft: () => void };

export function DraftMarker(_props: DraftMarkerProps): never {
	return notImplemented("NAV-16");
}
