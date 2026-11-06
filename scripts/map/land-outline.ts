/**
 * Writes the Passport map's land outline (NAV-13) from Natural Earth's 1:110m land polygons.
 *
 * - Input: `ne_110m_land.geojson` from the Natural Earth release (public domain,
 *   github.com/nvkelso/natural-earth-vector, `geojson/`).
 * - Output: `apps/desktop/src/features/passport/land-outline.ts`, one string per ring of
 *   "longitude latitude" pairs rounded to a tenth of a degree, with repeated points dropped.
 * - The map projects the rings itself, so the file holds coordinates, not drawing commands.
 *
 * Usage: bun scripts/map/land-outline.ts <ne_110m_land.geojson> <output.ts>
 */
import { readFileSync, writeFileSync } from "node:fs";

interface LandFile {
	features: { geometry: { type: string; coordinates: unknown } }[];
}

type Ring = readonly (readonly [number, number])[];

const round = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

/** The polygons' outer rings and holes, each as one "lon lat,lon lat" string. */
export function encodeRings(land: LandFile): string[] {
	const rings: string[] = [];
	for (const feature of land.features) {
		const { type, coordinates } = feature.geometry;
		const polygons = (type === "Polygon" ? [coordinates] : coordinates) as Ring[][];
		for (const polygon of polygons) {
			for (const ring of polygon) {
				const points: string[] = [];
				for (const [longitude, latitude] of ring) {
					const point = `${round(longitude)} ${round(latitude)}`;
					if (points.at(-1) !== point) points.push(point);
				}
				if (points.length >= 4) rings.push(points.join(","));
			}
		}
	}
	return rings;
}

export function landModule(rings: readonly string[]): string {
	return `/**
 * @feature NAV-13 Land outline for the Passport map
 * Owns: the coastlines the world map draws under its markers.
 * Behaviour: ui-map.md 4 (the Passport map is a world map with countries; Conductor draws its own
 * map data, which we do not copy, D002).
 * Our design choice: Natural Earth's 1:110m land polygons (public domain, naturalearthdata.com),
 * written by scripts/map/land-outline.ts. Each string is one ring of "longitude latitude" pairs
 * in degrees, rounded to a tenth.
 * Test first: not applicable, generated data; WorldMap's test checks that land is drawn.
 */
export const LAND_RINGS: readonly string[] = ${JSON.stringify(rings, null, "\t")};
`;
}

if (import.meta.main) {
	const [input, output] = process.argv.slice(2);
	if (input === undefined || output === undefined) {
		console.error("Usage: bun scripts/map/land-outline.ts <ne_110m_land.geojson> <output.ts>");
		process.exit(1);
	}
	const rings = encodeRings(JSON.parse(readFileSync(input, "utf8")) as LandFile);
	writeFileSync(output, landModule(rings));
	console.log(`Wrote ${rings.length} rings to ${output}`);
}
