/**
 * @feature NAV-13 Passport
 * Owns: The dialog with a world map of workspace place names: visited places, archived places, and
 * a way to open a workspace.
 * Behaviour: ui-map.md 4 (Passport: dialog with a world map, 'CITIES VISITED', '[NOT VISITED]',
 * '[ARCHIVED]', '[CLICK TO OPEN]'; each workspace is named after a city, so the map plots them).
 * Our design choice: Opened from the command palette ('Passport'). Labels are our wording. Archived
 * workspaces are listed here so they can be reached and unarchived.
 * Must handle: No workspaces yet (empty state with the reason); a workspace whose name is not a
 * known place (listed under the map, not plotted); archived places drawn differently and labelled
 * in text too; keyboard access to every place without the mouse; Escape closes.
 * Test first: A workspace named 'Lisbon' appears as a marker; an archived one is marked archived in
 * text.
 */
import { notImplemented } from "@conducted/shared";
import type { OverlayProps } from "../../ui/overlay-props.ts";

export function PassportDialog(_props: OverlayProps): never {
	return notImplemented("NAV-13");
}
