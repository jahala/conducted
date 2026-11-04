/**
 * @feature NAV-13 World map
 * Owns: The drawing: a world outline with a marker per place, zoom and pan.
 * Behaviour: ui-map.md 4 (the map is an Equal Earth projection with graticule and zoomable group;
 * Conductor uses a react-simple-maps style kit).
 * Our design choice: No map library or map data is installed. Needs an owner decision: d3-geo (ISC)
 * plus a public-domain Natural Earth outline is the likely choice. Markers are drawn as buttons
 * over the map so they are focusable.
 * Must handle: Reduced motion (no animated zoom); overlapping markers (cluster or offset); a
 * marker's text label is in the DOM for screen readers; zoom has buttons as well as wheel and
 * pinch.
 * Test first: Given two places the map renders two focusable markers named after them.
 */
import { notImplemented } from "@conducted/shared";
import type { PassportPlace } from "./passport-places.ts";

export interface WorldMapProps {
	places: PassportPlace[];
	onOpen: (place: PassportPlace) => void;
}

export function WorldMap(_props: WorldMapProps): never {
	return notImplemented("NAV-13");
}
