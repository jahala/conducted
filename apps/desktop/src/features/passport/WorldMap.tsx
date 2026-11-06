/**
 * @feature NAV-13 World map
 * Owns: the drawing: an Equal Earth sphere, graticule and land outline with one marker per place,
 * and zoom and pan.
 * Behaviour: ui-map.md 4 (the map has a sphere, a graticule and a zoomable group; markers are the way
 * into a workspace, and Conductor draws the map with a react-simple-maps style kit).
 * Our design choice: no map library is installed, so this file draws the sphere, the graticule,
 * the land and the markers itself from the Equal Earth formula. The land is Natural Earth's 1:110m
 * coastline (public domain, land-outline.ts), projected once and zoomed with an SVG transform, so it
 * stays under the markers. Conductor draws country borders; one land shape is enough to read the
 * map as the world, and needs no country data. Unvisited places are small dots;
 * a visited place is a focusable button. Zoom has buttons as well as the wheel, and nothing is
 * animated, so reduced motion needs no separate path.
 * Must handle: a place with no position is not drawn; markers keep their text label in the DOM and
 * their accessible name; zoom and pan keep the markers over the same coordinates.
 * Test first: given two places the map renders two focusable markers named after them.
 */
import { type PointerEvent, useRef, useState, type WheelEvent } from "react";
import type { GazetteerPlace } from "../../core/services/place-gazetteer.ts";
import { Button } from "../../ui/Button.tsx";
import { cn } from "../../ui/cn.ts";
import { LAND_RINGS } from "./land-outline.ts";
import type { PassportPlace } from "./passport-places.ts";

interface WorldMapProps {
	places: PassportPlace[];
	/** Gazetteer places with no workspace yet, drawn as faint dots. */
	unvisited?: readonly GazetteerPlace[];
	onOpen: (place: PassportPlace) => void;
}

interface View {
	zoom: number;
	panX: number;
	panY: number;
}

interface Point {
	x: number;
	y: number;
}

const MAP_WIDTH = 800;
const MAP_HEIGHT = 400;
const MAP_SCALE = 140;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

const A1 = 1.340264;
const A2 = -0.081106;
const A3 = 0.000893;
const A4 = 0.003796;

/** Projects a coordinate to the map's viewBox with the current zoom and pan. */
function project(latitude: number, longitude: number, view: View): Point {
	const phi = (latitude * Math.PI) / 180;
	const lambda = (longitude * Math.PI) / 180;
	const theta = Math.asin((Math.sqrt(3) / 2) * Math.sin(phi));
	const theta2 = theta * theta;
	const theta3 = theta2 * theta;
	const theta6 = theta3 * theta3;
	const theta7 = theta6 * theta;
	const theta8 = theta6 * theta2;
	const theta9 = theta8 * theta;
	const rawX =
		(2 * Math.sqrt(3) * lambda * Math.cos(theta)) /
		(3 * (9 * A4 * theta8 + 7 * A3 * theta6 + 3 * A2 * theta2 + A1));
	const rawY = A4 * theta9 + A3 * theta7 + A2 * theta3 + A1 * theta;
	return {
		x: MAP_WIDTH / 2 + rawX * MAP_SCALE * view.zoom + view.panX,
		y: MAP_HEIGHT / 2 - rawY * MAP_SCALE * view.zoom + view.panY,
	};
}

const ZERO_VIEW: View = { zoom: 1, panX: 0, panY: 0 };
const SPHERE_HALF_WIDTH = project(0, 180, ZERO_VIEW).x - MAP_WIDTH / 2;
const SPHERE_HALF_HEIGHT = MAP_HEIGHT / 2 - project(90, 0, ZERO_VIEW).y;

const PARALLELS = [60, 30, 0, -30, -60];
const MERIDIANS = [180, 150, 120, 90, 60, 30, 0, -30, -60, -90, -120, -150];

function pathThrough(points: readonly Point[]): string {
	return `M ${points.map((point) => `${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" L ")}`;
}

/** The land at zoom 1 with no pan, as one SVG path with a subpath per ring. Built once. */
const LAND_PATH = LAND_RINGS.map((ring) =>
	pathThrough(
		ring.split(",").map((pair) => {
			const [longitude = 0, latitude = 0] = pair.split(" ").map(Number);
			return project(latitude, longitude, ZERO_VIEW);
		}),
	),
)
	.map((subpath) => `${subpath} Z`)
	.join(" ");

/** Moves the land drawn at zoom 1 to the current zoom and pan, as `project` does for a point. */
function landTransform(view: View): string {
	const centreX = MAP_WIDTH / 2;
	const centreY = MAP_HEIGHT / 2;
	return `translate(${centreX + view.panX} ${centreY + view.panY}) scale(${view.zoom}) translate(${-centreX} ${-centreY})`;
}

function parallelPath(latitude: number, view: View): string {
	const points: Point[] = [];
	for (let longitude = -180; longitude <= 180; longitude += 10) {
		points.push(project(latitude, longitude, view));
	}
	return pathThrough(points);
}

function meridianPath(longitude: number, view: View): string {
	const points: Point[] = [];
	for (let latitude = -90; latitude <= 90; latitude += 10) {
		points.push(project(latitude, longitude, view));
	}
	return pathThrough(points);
}

function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function percentage(value: number, total: number): string {
	return `${(value / total) * 100}%`;
}

export function WorldMap({ places, unvisited = [], onOpen }: WorldMapProps) {
	const [view, setView] = useState<View>(ZERO_VIEW);
	const drag = useRef<{ pointerX: number; pointerY: number; panX: number; panY: number } | null>(
		null,
	);
	const plotted = places.filter((place) => place.position !== null);

	const zoomBy = (factor: number) => {
		setView((current) => ({ ...current, zoom: clampZoom(current.zoom * factor) }));
	};

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if ((event.target as HTMLElement).closest("button") !== null) return;
		drag.current = {
			pointerX: event.clientX,
			pointerY: event.clientY,
			panX: view.panX,
			panY: view.panY,
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const start = drag.current;
		if (start === null) return;
		const bounds = event.currentTarget.getBoundingClientRect();
		const scale = bounds.width === 0 ? 1 : MAP_WIDTH / bounds.width;
		setView((current) => ({
			...current,
			panX: start.panX + (event.clientX - start.pointerX) * scale,
			panY: start.panY + (event.clientY - start.pointerY) * scale,
		}));
	};

	const stopDrag = () => {
		drag.current = null;
	};

	const onWheel = (event: WheelEvent<HTMLDivElement>) => {
		zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2);
	};

	return (
		<div
			className="relative overflow-hidden rounded-md border border-border bg-surface"
			data-region="world-map"
			data-zoom={view.zoom}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={stopDrag}
			onPointerCancel={stopDrag}
			onPointerLeave={stopDrag}
			onWheel={onWheel}
		>
			<svg
				viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
				className="block h-auto w-full touch-none select-none"
				role="img"
				aria-label="World map"
			>
				<ellipse
					cx={MAP_WIDTH / 2 + view.panX}
					cy={MAP_HEIGHT / 2 + view.panY}
					rx={SPHERE_HALF_WIDTH * view.zoom}
					ry={SPHERE_HALF_HEIGHT * view.zoom}
					className="fill-none stroke-border-strong"
					strokeWidth={1}
					data-map-sphere
				/>
				<path
					d={LAND_PATH}
					transform={landTransform(view)}
					className="fill-active stroke-border"
					strokeWidth={0.5}
					vectorEffect="non-scaling-stroke"
					data-map-land
				/>
				<g data-map-graticule>
					{PARALLELS.map((latitude) => (
						<path
							key={`parallel-${latitude}`}
							d={parallelPath(latitude, view)}
							className="fill-none stroke-border"
							strokeWidth={0.5}
						/>
					))}
					{MERIDIANS.map((longitude) => (
						<path
							key={`meridian-${longitude}`}
							d={meridianPath(longitude, view)}
							className="fill-none stroke-border"
							strokeWidth={0.5}
						/>
					))}
				</g>
			</svg>

			<div className="absolute inset-0">
				{unvisited.map((place) => {
					const point = project(place.latitude, place.longitude, view);
					return (
						<span
							key={place.name}
							aria-hidden="true"
							data-map-unvisited={place.name}
							className="absolute size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg-subtle/40"
							style={{ left: percentage(point.x, MAP_WIDTH), top: percentage(point.y, MAP_HEIGHT) }}
						/>
					);
				})}
				{plotted.map((place) => {
					const position = place.position;
					if (position === null) return null;
					const point = project(position.latitude, position.longitude, view);
					return (
						<button
							key={place.name}
							type="button"
							data-map-marker={place.name}
							data-archived={place.archived ? "true" : "false"}
							aria-label={place.archived ? `${place.name}, archived` : place.name}
							onClick={() => onOpen(place)}
							className={cn(
								"group absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-sm",
								"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
							)}
							style={{ left: percentage(point.x, MAP_WIDTH), top: percentage(point.y, MAP_HEIGHT) }}
						>
							<span
								aria-hidden="true"
								className={cn(
									"size-2 shrink-0 rounded-full ring-2 ring-surface",
									place.archived ? "bg-fg-subtle" : "bg-accent",
								)}
							/>
							<span
								className={cn(
									"whitespace-nowrap rounded-sm bg-raised/90 px-1 text-2xs",
									place.archived ? "text-fg-subtle" : "font-medium text-fg",
								)}
							>
								{place.name}
							</span>
						</button>
					);
				})}
			</div>

			<div className="absolute right-2 top-2 flex gap-1">
				<Button variant="secondary" size="xs" onClick={() => zoomBy(1.5)}>
					Zoom in
				</Button>
				<Button variant="secondary" size="xs" onClick={() => zoomBy(1 / 1.5)}>
					Zoom out
				</Button>
				<Button variant="secondary" size="xs" onClick={() => setView(ZERO_VIEW)}>
					Reset view
				</Button>
			</div>
		</div>
	);
}
