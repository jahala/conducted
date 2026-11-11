/**
 * @feature NAV-13 The list of places workspaces are named after
 * Owns: our own gazetteer: each place's name, country, position and how often the workspace namer
 * picks it, the folder form of a name, and the key that matches a folder name back to its place.
 * Behaviour: frontend.md 6 (a workspace folder is a random city from rarity tiers: common,
 * uncommon, rare, legendary; collisions get "-v1", "-v2"), ui-map.md 4 (Passport plots each
 * workspace's city on a world map).
 * Our design choice: Conductor ships its own city lists, which we must not copy (D002). This list
 * is ours: a small set of cities with public coordinates, and the tier of each is our choice. The
 * workspace namer (`createPlaceNames`, core/services/workspace-creation.ts) and the Passport map
 * (features/passport/passport-places.ts) both read it, so every name the namer gives is a place on
 * the map.
 * Must handle: a name with spaces or accents ("São Paulo" is the folder "sao-paulo"); a folder
 * name with a "-vN" collision suffix still matches its place; case and accents are ignored.
 * Test first: every name the namer gives, suffixed ones too, is a place on the map
 * (passport-places.test.ts).
 */

export type PlaceTier = "common" | "uncommon" | "rare" | "legendary";

export interface GazetteerPlace {
	name: string;
	country: string;
	/** Degrees, the place's centre from public maps. */
	latitude: number;
	longitude: number;
	tier: PlaceTier;
}

export const PLACE_GAZETTEER: readonly GazetteerPlace[] = [
	{ name: "Lisbon", country: "Portugal", latitude: 38.7223, longitude: -9.1393, tier: "common" },
	{ name: "Porto", country: "Portugal", latitude: 41.1579, longitude: -8.6291, tier: "uncommon" },
	{ name: "Madrid", country: "Spain", latitude: 40.4168, longitude: -3.7038, tier: "common" },
	{ name: "Barcelona", country: "Spain", latitude: 41.3874, longitude: 2.1686, tier: "common" },
	{ name: "Paris", country: "France", latitude: 48.8566, longitude: 2.3522, tier: "common" },
	{
		name: "London",
		country: "United Kingdom",
		latitude: 51.5074,
		longitude: -0.1278,
		tier: "common",
	},
	{ name: "Dublin", country: "Ireland", latitude: 53.3498, longitude: -6.2603, tier: "common" },
	{
		name: "Amsterdam",
		country: "Netherlands",
		latitude: 52.3676,
		longitude: 4.9041,
		tier: "common",
	},
	{ name: "Brussels", country: "Belgium", latitude: 50.8503, longitude: 4.3517, tier: "uncommon" },
	{ name: "Berlin", country: "Germany", latitude: 52.52, longitude: 13.405, tier: "common" },
	{ name: "Munich", country: "Germany", latitude: 48.1351, longitude: 11.582, tier: "common" },
	{ name: "Zurich", country: "Switzerland", latitude: 47.3769, longitude: 8.5417, tier: "common" },
	{ name: "Vienna", country: "Austria", latitude: 48.2082, longitude: 16.3738, tier: "common" },
	{ name: "Prague", country: "Czechia", latitude: 50.0755, longitude: 14.4378, tier: "common" },
	{ name: "Warsaw", country: "Poland", latitude: 52.2297, longitude: 21.0122, tier: "uncommon" },
	{ name: "Stockholm", country: "Sweden", latitude: 59.3293, longitude: 18.0686, tier: "common" },
	{ name: "Oslo", country: "Norway", latitude: 59.9139, longitude: 10.7522, tier: "uncommon" },
	{ name: "Copenhagen", country: "Denmark", latitude: 55.6761, longitude: 12.5683, tier: "common" },
	{ name: "Helsinki", country: "Finland", latitude: 60.1699, longitude: 24.9384, tier: "uncommon" },
	{
		name: "Reykjavik",
		country: "Iceland",
		latitude: 64.1466,
		longitude: -21.9426,
		tier: "legendary",
	},
	{ name: "Rome", country: "Italy", latitude: 41.9028, longitude: 12.4964, tier: "common" },
	{ name: "Athens", country: "Greece", latitude: 37.9838, longitude: 23.7275, tier: "common" },
	{ name: "Istanbul", country: "Turkey", latitude: 41.0082, longitude: 28.9784, tier: "common" },
	{ name: "Moscow", country: "Russia", latitude: 55.7558, longitude: 37.6173, tier: "uncommon" },
	{ name: "Cairo", country: "Egypt", latitude: 30.0444, longitude: 31.2357, tier: "uncommon" },
	{
		name: "Cape Town",
		country: "South Africa",
		latitude: -33.9249,
		longitude: 18.4241,
		tier: "rare",
	},
	{ name: "Nairobi", country: "Kenya", latitude: -1.2921, longitude: 36.8219, tier: "rare" },
	{ name: "Lagos", country: "Nigeria", latitude: 6.5244, longitude: 3.3792, tier: "rare" },
	{
		name: "Dubai",
		country: "United Arab Emirates",
		latitude: 25.2048,
		longitude: 55.2708,
		tier: "uncommon",
	},
	{ name: "Mumbai", country: "India", latitude: 19.076, longitude: 72.8777, tier: "uncommon" },
	{ name: "Delhi", country: "India", latitude: 28.7041, longitude: 77.1025, tier: "uncommon" },
	{
		name: "Bangkok",
		country: "Thailand",
		latitude: 13.7563,
		longitude: 100.5018,
		tier: "uncommon",
	},
	{
		name: "Singapore",
		country: "Singapore",
		latitude: 1.3521,
		longitude: 103.8198,
		tier: "common",
	},
	{ name: "Jakarta", country: "Indonesia", latitude: -6.2088, longitude: 106.8456, tier: "rare" },
	{ name: "Hong Kong", country: "China", latitude: 22.3193, longitude: 114.1694, tier: "uncommon" },
	{ name: "Beijing", country: "China", latitude: 39.9042, longitude: 116.4074, tier: "uncommon" },
	{ name: "Shanghai", country: "China", latitude: 31.2304, longitude: 121.4737, tier: "uncommon" },
	{ name: "Seoul", country: "South Korea", latitude: 37.5665, longitude: 126.978, tier: "common" },
	{ name: "Tokyo", country: "Japan", latitude: 35.6762, longitude: 139.6503, tier: "common" },
	{ name: "Osaka", country: "Japan", latitude: 34.6937, longitude: 135.5023, tier: "uncommon" },
	{ name: "Sydney", country: "Australia", latitude: -33.8688, longitude: 151.2093, tier: "common" },
	{
		name: "Melbourne",
		country: "Australia",
		latitude: -37.8136,
		longitude: 144.9631,
		tier: "uncommon",
	},
	{
		name: "Auckland",
		country: "New Zealand",
		latitude: -36.8509,
		longitude: 174.7645,
		tier: "legendary",
	},
	{
		name: "New York",
		country: "United States",
		latitude: 40.7128,
		longitude: -74.006,
		tier: "common",
	},
	{
		name: "San Francisco",
		country: "United States",
		latitude: 37.7749,
		longitude: -122.4194,
		tier: "common",
	},
	{
		name: "Seattle",
		country: "United States",
		latitude: 47.6062,
		longitude: -122.3321,
		tier: "uncommon",
	},
	{
		name: "Chicago",
		country: "United States",
		latitude: 41.8781,
		longitude: -87.6298,
		tier: "common",
	},
	{
		name: "Austin",
		country: "United States",
		latitude: 30.2672,
		longitude: -97.7431,
		tier: "uncommon",
	},
	{ name: "Toronto", country: "Canada", latitude: 43.6532, longitude: -79.3832, tier: "common" },
	{
		name: "Vancouver",
		country: "Canada",
		latitude: 49.2827,
		longitude: -123.1207,
		tier: "uncommon",
	},
	{ name: "Montreal", country: "Canada", latitude: 45.5019, longitude: -73.5674, tier: "uncommon" },
	{
		name: "Mexico City",
		country: "Mexico",
		latitude: 19.4326,
		longitude: -99.1332,
		tier: "common",
	},
	{ name: "Bogota", country: "Colombia", latitude: 4.711, longitude: -74.0721, tier: "rare" },
	{ name: "Lima", country: "Peru", latitude: -12.0464, longitude: -77.0428, tier: "rare" },
	{
		name: "São Paulo",
		country: "Brazil",
		latitude: -23.5505,
		longitude: -46.6333,
		tier: "uncommon",
	},
	{
		name: "Rio de Janeiro",
		country: "Brazil",
		latitude: -22.9068,
		longitude: -43.1729,
		tier: "rare",
	},
	{
		name: "Buenos Aires",
		country: "Argentina",
		latitude: -34.6037,
		longitude: -58.3816,
		tier: "uncommon",
	},
	{ name: "Santiago", country: "Chile", latitude: -33.4489, longitude: -70.6693, tier: "rare" },
];

/** A place name as a workspace folder: lower case, no accents, words joined by hyphens. */
export function placeFolderName(name: string): string {
	return name
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Folds case, accents, separators and a "-vN" collision suffix, so folder names and places meet. */
export function placeKey(name: string): string {
	return name
		.trim()
		.replace(/-v\d+$/i, "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");
}
