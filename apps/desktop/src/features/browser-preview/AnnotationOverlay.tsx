/**
 * @feature RUN-05 Annotation overlay
 * Owns: the layer over the preview where the user points at page elements, writes a note on each,
 * and sends them to the chat.
 * Behaviour: ui-map.md 3.2 (browser tab: annotation overlay, button "Add to chat");
 * native-and-sidecar-map.md (Agentation: a proxy injects the toolbar and formats annotations for
 * the agent).
 * Children: uses formatAnnotations from annotation-format.ts for the chat text.
 * Our design choice: annotations are held in this tab's state until sent, then cleared. They are
 * not stored in the database.
 * Must handle: annotating off (overlay inert, page clickable), a selector that no longer matches
 * after navigation (annotation kept with an outdated mark), many annotations (numbered, list
 * scrolls), Escape cancelling the current note, sending with no active chat (the action creates
 * none; disabled with a reason), and the page not allowing the injected script (overlay says
 * annotations are unavailable for this page).
 * Test first: two annotations produce one chat message listing both in order.
 */
import { notImplemented } from "@conducted/shared";
import type { PageAnnotation } from "./annotation-format.ts";

export interface AnnotationOverlayProps {
	active: boolean;
	annotations: PageAnnotation[];
	canSendToChat: boolean;
	onAdd: (annotation: PageAnnotation) => void;
	onRemove: (id: string) => void;
	onSendToChat: () => void;
	onClear: () => void;
}

export function AnnotationOverlay(_props: AnnotationOverlayProps): never {
	return notImplemented("RUN-05");
}
