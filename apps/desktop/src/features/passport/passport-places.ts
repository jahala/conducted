/**
 * @feature NAV-13 Passport places
 * Owns: matching a workspace's folder name to a place with a country and coordinates, and building
 * the list of places the map shows.
 * Behaviour: frontend.md 6 (a workspace folder is named after a place), ui-map.md 4 (Passport plots
 * them and labels them 'CITIES VISITED', '[NOT VISITED]' and '[ARCHIVED]').
 * Our design choice: Conductor ships its own city lists, which we must not copy (D002). This file
 * holds our own small gazetteer of place names with public coordinates and countries. The workspace
 * namer does not read it yet, so a folder whose name is not here is listed without a position.
 * Must handle: a name with no entry (no position, still listed); two workspaces with the same place
 * (one entry, both workspaces); a collision suffix such as '-v2' is stripped before matching; case
 * and accents are ignored.
 * Test first: 'lisbon-v2' matches 'Lisbon' and gives its latitude and longitude.
 */
import type { Workspace } from "../../core/model.ts";

export interface PlacePosition {
	latitude: number;
	longitude: number;
}

/** A place from our gazetteer: what the map can plot and what the place list shows beside it. */
export interface GazetteerPlace extends PlacePosition {
	name: string;
	country: string;
}

export interface PassportPlace {
	name: string;
	country: string | null;
	/** Null when the name is not in the gazetteer. */
	position: PlacePosition | null;
	workspaces: Workspace[];
	archived: boolean;
}

/**
 * Our own place list (D002). Coordinates are the place's centre, in degrees, from public maps.
 * It is deliberately small: enough names for a passport wall, and every one has a country.
 */
const PLACE_GAZETTEER: readonly GazetteerPlace[] = [
	{ name: "Lisbon", country: "Portugal", latitude: 38.7223, longitude: -9.1393 },
	{ name: "Porto", country: "Portugal", latitude: 41.1579, longitude: -8.6291 },
	{ name: "Madrid", country: "Spain", latitude: 40.4168, longitude: -3.7038 },
	{ name: "Barcelona", country: "Spain", latitude: 41.3874, longitude: 2.1686 },
	{ name: "Paris", country: "France", latitude: 48.8566, longitude: 2.3522 },
	{ name: "London", country: "United Kingdom", latitude: 51.5074, longitude: -0.1278 },
	{ name: "Dublin", country: "Ireland", latitude: 53.3498, longitude: -6.2603 },
	{ name: "Amsterdam", country: "Netherlands", latitude: 52.3676, longitude: 4.9041 },
	{ name: "Brussels", country: "Belgium", latitude: 50.8503, longitude: 4.3517 },
	{ name: "Berlin", country: "Germany", latitude: 52.52, longitude: 13.405 },
	{ name: "Munich", country: "Germany", latitude: 48.1351, longitude: 11.582 },
	{ name: "Zurich", country: "Switzerland", latitude: 47.3769, longitude: 8.5417 },
	{ name: "Vienna", country: "Austria", latitude: 48.2082, longitude: 16.3738 },
	{ name: "Prague", country: "Czechia", latitude: 50.0755, longitude: 14.4378 },
	{ name: "Warsaw", country: "Poland", latitude: 52.2297, longitude: 21.0122 },
	{ name: "Stockholm", country: "Sweden", latitude: 59.3293, longitude: 18.0686 },
	{ name: "Oslo", country: "Norway", latitude: 59.9139, longitude: 10.7522 },
	{ name: "Copenhagen", country: "Denmark", latitude: 55.6761, longitude: 12.5683 },
	{ name: "Helsinki", country: "Finland", latitude: 60.1699, longitude: 24.9384 },
	{ name: "Reykjavik", country: "Iceland", latitude: 64.1466, longitude: -21.9426 },
	{ name: "Rome", country: "Italy", latitude: 41.9028, longitude: 12.4964 },
	{ name: "Athens", country: "Greece", latitude: 37.9838, longitude: 23.7275 },
	{ name: "Istanbul", country: "Turkey", latitude: 41.0082, longitude: 28.9784 },
	{ name: "Moscow", country: "Russia", latitude: 55.7558, longitude: 37.6173 },
	{ name: "Cairo", country: "Egypt", latitude: 30.0444, longitude: 31.2357 },
	{ name: "Cape Town", country: "South Africa", latitude: -33.9249, longitude: 18.4241 },
	{ name: "Nairobi", country: "Kenya", latitude: -1.2921, longitude: 36.8219 },
	{ name: "Lagos", country: "Nigeria", latitude: 6.5244, longitude: 3.3792 },
	{ name: "Dubai", country: "United Arab Emirates", latitude: 25.2048, longitude: 55.2708 },
	{ name: "Mumbai", country: "India", latitude: 19.076, longitude: 72.8777 },
	{ name: "Delhi", country: "India", latitude: 28.7041, longitude: 77.1025 },
	{ name: "Bangkok", country: "Thailand", latitude: 13.7563, longitude: 100.5018 },
	{ name: "Singapore", country: "Singapore", latitude: 1.3521, longitude: 103.8198 },
	{ name: "Jakarta", country: "Indonesia", latitude: -6.2088, longitude: 106.8456 },
	{ name: "Hong Kong", country: "China", latitude: 22.3193, longitude: 114.1694 },
	{ name: "Beijing", country: "China", latitude: 39.9042, longitude: 116.4074 },
	{ name: "Shanghai", country: "China", latitude: 31.2304, longitude: 121.4737 },
	{ name: "Seoul", country: "South Korea", latitude: 37.5665, longitude: 126.978 },
	{ name: "Tokyo", country: "Japan", latitude: 35.6762, longitude: 139.6503 },
	{ name: "Osaka", country: "Japan", latitude: 34.6937, longitude: 135.5023 },
	{ name: "Sydney", country: "Australia", latitude: -33.8688, longitude: 151.2093 },
	{ name: "Melbourne", country: "Australia", latitude: -37.8136, longitude: 144.9631 },
	{ name: "Auckland", country: "New Zealand", latitude: -36.8509, longitude: 174.7645 },
	{ name: "New York", country: "United States", latitude: 40.7128, longitude: -74.006 },
	{ name: "San Francisco", country: "United States", latitude: 37.7749, longitude: -122.4194 },
	{ name: "Seattle", country: "United States", latitude: 47.6062, longitude: -122.3321 },
	{ name: "Chicago", country: "United States", latitude: 41.8781, longitude: -87.6298 },
	{ name: "Austin", country: "United States", latitude: 30.2672, longitude: -97.7431 },
	{ name: "Toronto", country: "Canada", latitude: 43.6532, longitude: -79.3832 },
	{ name: "Vancouver", country: "Canada", latitude: 49.2827, longitude: -123.1207 },
	{ name: "Montreal", country: "Canada", latitude: 45.5019, longitude: -73.5674 },
	{ name: "Mexico City", country: "Mexico", latitude: 19.4326, longitude: -99.1332 },
	{ name: "Bogota", country: "Colombia", latitude: 4.711, longitude: -74.0721 },
	{ name: "Lima", country: "Peru", latitude: -12.0464, longitude: -77.0428 },
	{ name: "São Paulo", country: "Brazil", latitude: -23.5505, longitude: -46.6333 },
	{ name: "Rio de Janeiro", country: "Brazil", latitude: -22.9068, longitude: -43.1729 },
	{ name: "Buenos Aires", country: "Argentina", latitude: -34.6037, longitude: -58.3816 },
	{ name: "Santiago", country: "Chile", latitude: -33.4489, longitude: -70.6693 },
];

/** Folds case, accents and a `-vN` collision suffix, so folder names and the gazetteer meet. */
function placeKey(name: string): string {
	return name
		.trim()
		.replace(/-v\d+$/i, "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
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
			archived: place.workspaces.every((workspace) => workspace.state === "archived"),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

/** The gazetteer places no workspace has visited yet, for the map's faint `[NOT VISITED]` dots. */
export function unvisitedPlaces(visited: readonly PassportPlace[]): GazetteerPlace[] {
	const seen = new Set(visited.map((place) => placeKey(place.name)));
	return PLACE_GAZETTEER.filter((place) => !seen.has(placeKey(place.name)));
}
