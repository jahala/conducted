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
 * Drawn as Conductor draws it (renderApp @10432391): a bare 12px pencil in the muted sidebar colour that
 * brightens on hover, with no box.
 * Our design choice: "Open draft" opens the workspace with its draft chat active. A draft with only spaces
 * and no attachments counts as empty.
 * Must handle: an empty or whitespace-only draft (no marker); a draft with attachments but no text (marker);
 * the marker sitting beside the unread dot and the time without moving the row's columns; keyboard focus
 * on the workspace-row button; a screen reader reading "Open draft" for the button and "Draft" for the
 * Create-row marker.
 * Test first: a draft of "   " with no attachments renders no marker; "fix the login" renders one.
 */
import type { Draft } from "../../core/api.ts";
import { PencilIcon } from "../../ui/icons.tsx";
import { Tooltip } from "../../ui/Tooltip.tsx";

export type DraftMarkerProps =
	| { place: "create-row"; draft: Draft | null }
	| { place: "workspace-row"; draft: Draft | null; onOpenDraft: () => void };

/** True when the draft holds text or an attachment. Whitespace alone is not a draft. */
export function hasDraft(draft: Draft | null | undefined): draft is Draft {
	return (
		draft !== null &&
		draft !== undefined &&
		(draft.text.trim().length > 0 || draft.attachmentPaths.length > 0)
	);
}

export function DraftMarker(props: DraftMarkerProps) {
	if (!hasDraft(props.draft)) return null;
	if (props.place === "create-row") {
		return (
			<span
				role="img"
				aria-label="Draft"
				className="inline-block size-1.5 shrink-0 rounded-full bg-accent"
			/>
		);
	}
	return (
		<Tooltip content="Draft">
			<button
				type="button"
				aria-label="Open draft"
				title="Draft"
				data-testid="workspace-draft-indicator"
				className="flex shrink-0 items-center justify-center rounded-sm px-0.5 py-1 text-sidebar-fg-muted transition-colors hover:text-sidebar-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					props.onOpenDraft();
				}}
			>
				<PencilIcon className="size-3" />
			</button>
		</Tooltip>
	);
}
