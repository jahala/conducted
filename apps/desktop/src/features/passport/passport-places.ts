/**
 * @feature NAV-13 Passport places
 * Owns: matching a workspace's folder name to a place with a country and coordinates, and building
 * the list of places the map shows.
 * Behaviour: frontend.md 6 (a workspace folder is named after a place), ui-map.md 4 (Passport plots
 * them and labels them 'CITIES VISITED', '[NOT VISITED]' and '[ARCHIVED]').
 * Our design choice: the places are our own gazetteer (core/place-gazetteer.ts, D002),
 * the same list the workspace namer picks from, so every named workspace has a position. A folder
 * named before that, or renamed by hand, can still miss it, and is listed without a position.
 * Must handle: a name with no entry (no position, still listed); two workspaces with the same place
 * (one entry, both workspaces); a collision suffix such as '-v2' is stripped before matching; case
 * and accents are ignored.
 * Test first: 'lisbon-v2' matches 'Lisbon' and gives its latitude and longitude.
 */
import type { Workspace } from "../../core/model.ts";
import { type GazetteerPlace, PLACE_GAZETTEER, placeKey } from "../../core/place-gazetteer.ts";
import { isArchivedWorkspace } from "../../core/status/archived.ts";

export interface PlacePosition {
	latitude: number;
	longitude: number;
}

export interface PassportPlace {
	name: string;
	country: string | null;
	/** Null when the name is not in the gazetteer. */
	position: PlacePosition | null;
	workspaces: Workspace[];
	archived: boolean;
}

const GAZETTEER_BY_KEY: ReadonlyMap<string, GazetteerPlace> = new Map(
	PLACE_GAZETTEER.map((place) => [placeKey(place.name), place]),
);

/** The folder name without git's collision suffix, for a place that is not in the gazetteer. */
function folderPlaceName(directoryName: string): string {
	const trimmed = directoryName.trim();
	const withoutSuffix = trimmed.replace(/-v\d+$/i, "").trim();
	return withoutSuffix === "" ? trimmed : withoutSuffix;
}

/**
 * Groups workspaces by the place in their folder name. A place with every workspace archived is
 * archived; one with any open workspace stays visited. Order comes from the place name, so the
 * dialog and the map draw the same list every time.
 */
export function buildPassportPlaces(workspaces: readonly Workspace[]): PassportPlace[] {
	const byKey = new Map<
		string,
		{
			name: string;
			country: string | null;
			position: PlacePosition | null;
			workspaces: Workspace[];
		}
	>();

	for (const workspace of workspaces) {
		const key = placeKey(workspace.directoryName);
		const known = GAZETTEER_BY_KEY.get(key);
		const existing = byKey.get(key);
		if (existing !== undefined) {
			existing.workspaces.push(workspace);
			continue;
		}
		byKey.set(key, {
			name: known?.name ?? folderPlaceName(workspace.directoryName),
			country: known?.country ?? null,
			position:
				known === undefined ? null : { latitude: known.latitude, longitude: known.longitude },
			workspaces: [workspace],
		});
	}

	return [...byKey.values()]
		.map((place) => ({
			name: place.name,
			country: place.country,
			position: place.position,
			workspaces: place.workspaces,
			archived: place.workspaces.every(isArchivedWorkspace),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

/** The gazetteer places no workspace has visited yet, for the map's faint `[NOT VISITED]` dots. */
export function unvisitedPlaces(visited: readonly PassportPlace[]): GazetteerPlace[] {
	const seen = new Set(visited.map((place) => placeKey(place.name)));
	return PLACE_GAZETTEER.filter((place) => !seen.has(placeKey(place.name)));
}
