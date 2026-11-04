/**
 * @feature NAV-04 Section dialog
 * Owns: The dialog to create or rename a section: a name and an optional emoji.
 * Behaviour: ui-map.md 5.2 ('Section create or edit (name, emoji)'), 4 item 5.
 * Must handle: Empty name (submit disabled); a name that already exists (allowed, sections are told
 * apart by id); Enter submits; Escape closes; the action fails (error under the field, dialog stays
 * open).
 * Test first: Submitting 'Review' with no emoji calls sections.create('Review', null).
 */
import { notImplemented } from "@conducted/shared";
import type { Section } from "../../core/model.ts";

export interface SectionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Null to create a new section. */
	section: Section | null;
}

export function SectionDialog(_props: SectionDialogProps): never {
	return notImplemented("NAV-04");
}
