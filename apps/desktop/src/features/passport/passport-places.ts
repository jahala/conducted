/**
 * @feature NAV-13 Passport places
 * Owns: Matching workspace place names to map positions, and building the list of places the map
 * shows.
 * Behaviour: frontend.md 6 (a workspace directory is named after a city from rarity tiers),
 * ui-map.md 4 (Passport plots them).
 * Our design choice: Conductor ships its own city lists, which we must not copy. This file needs
 * our own small gazetteer of place names and coordinates (public data). The same list should feed
 * the workspace namer in core/services so names always plot.
 * Must handle: A name with no entry (no position, still listed); two workspaces with the same place
 * (one marker, a count); a collision suffix such as '-v2' is stripped before matching; case and
 * accents are ignored.
 * Test first: 'lisbon-v2' matches 'Lisbon' and gives its latitude and longitude.
 */
import { notImplemented } from "@conducted/shared";
import type { Workspace } from "../../core/model.ts";

export interface PassportPlace {
	name: string;
	/** Null when the name is not in the gazetteer. */
	position: { latitude: number; longitude: number } | null;
	workspaces: Workspace[];
	archived: boolean;
}

export function buildPassportPlaces(_props: Workspace[]): PassportPlace[] {
	return notImplemented("NAV-13");
}
