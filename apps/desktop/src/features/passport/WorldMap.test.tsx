/**
 * @feature NAV-13 World map
 * Owns: tests that the map draws a sphere, a graticule and the land, that every plotted place is a
 * focusable marker, and that zoom, unvisited dots and opening a place work.
 * Test first: given two places the map renders two focusable markers named after them.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Workspace, WorkspaceState } from "../../core/model.ts";
import type { GazetteerPlace } from "../../core/services/place-gazetteer.ts";
import { LAND_RINGS } from "./land-outline.ts";
import type { PassportPlace } from "./passport-places.ts";
import { WorldMap } from "./WorldMap.tsx";

function workspace(directoryName: string, state: WorkspaceState = "ready"): Workspace {
	return {
		id: directoryName as WorkspaceId,
		repoId: "repo-1" as RepoId,
		directoryName,
		path: `/code/workspaces/${directoryName}`,
		branch: `me/${directoryName}`,
		branchIsPlaceholder: false,
		displayName: null,
		targetBranch: "origin/main",
		state,
		kanbanStatus: "in_progress",
		port: 55000,
		pinnedAt: null,
		notes: null,
		linkedPaths: [],
		prNumber: null,
		prTitle: null,
		prDescription: null,
		archiveCommit: null,
		archivedAt: null,
		activeSessionId: null,
		filesCopied: null,
		lastActivityAt: 1,
		createdAt: 1,
		updatedAt: 1,
	};
}

function place(name: string, latitude: number, longitude: number, archived = false): PassportPlace {
	return {
		name,
		country: "Testland",
		position: { latitude, longitude },
		workspaces: [workspace(name.toLowerCase(), archived ? "archived" : "ready")],
		archived,
	};
}

afterEach(cleanup);

describe("NAV-13 world map", () => {
	it("renders a focusable marker named after each place", () => {
		render(
			<WorldMap
				places={[place("Lisbon", 38.7223, -9.1393), place("Oslo", 59.9139, 10.7522)]}
				onOpen={() => {}}
			/>,
		);

		const markers = screen.getAllByRole("button", { name: /^(Lisbon|Oslo)$/ });
		expect(markers).toHaveLength(2);
		markers[0]?.focus();
		expect(document.activeElement).toBe(markers[0]);
	});

	it("draws a sphere and a graticule", () => {
		const { container } = render(
			<WorldMap places={[place("Lisbon", 38.7223, -9.1393)]} onOpen={() => {}} />,
		);
		expect(container.querySelector("[data-map-sphere]")).not.toBeNull();
		expect(container.querySelector("[data-map-graticule]")?.children.length).toBeGreaterThan(0);
	});

	it("draws every land outline, and zooms it with the markers", () => {
		const { container } = render(
			<WorldMap places={[place("Lisbon", 38.7223, -9.1393)]} onOpen={() => {}} />,
		);
		const land = container.querySelector("[data-map-land]");
		expect(land?.getAttribute("d")?.match(/M/g)?.length).toBe(LAND_RINGS.length);
		expect(land?.getAttribute("transform")).toContain("scale(1)");

		fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

		expect(container.querySelector("[data-map-land]")?.getAttribute("transform")).toContain(
			"scale(1.5)",
		);
	});

	it("changes the zoom from the buttons and resets it", () => {
		const { container } = render(
			<WorldMap places={[place("Lisbon", 38.7223, -9.1393)]} onOpen={() => {}} />,
		);
		const map = container.querySelector<HTMLElement>('[data-region="world-map"]');
		expect(map?.dataset.zoom).toBe("1");

		fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
		expect(map?.dataset.zoom).toBe("1.5");

		fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
		expect(map?.dataset.zoom).toBe("1");

		fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
		expect(map?.dataset.zoom).toBe("1");
	});

	it("opens the place whose marker is chosen", () => {
		const opened: PassportPlace[] = [];
		const lisbon = place("Lisbon", 38.7223, -9.1393);
		render(<WorldMap places={[lisbon]} onOpen={(chosen) => opened.push(chosen)} />);

		fireEvent.click(screen.getByRole("button", { name: "Lisbon" }));
		expect(opened).toEqual([lisbon]);
	});

	it("draws gazetteer places no workspace has visited as dots", () => {
		const unvisited: GazetteerPlace[] = [
			{ name: "Oslo", country: "Norway", latitude: 59.9139, longitude: 10.7522, tier: "uncommon" },
		];
		const { container } = render(
			<WorldMap
				places={[place("Lisbon", 38.7223, -9.1393)]}
				unvisited={unvisited}
				onOpen={() => {}}
			/>,
		);
		expect(container.querySelector('[data-map-unvisited="Oslo"]')).not.toBeNull();
	});

	it("skips a place that has no position", () => {
		const unknown: PassportPlace = {
			name: "moon-base",
			country: null,
			position: null,
			workspaces: [workspace("moon-base")],
			archived: false,
		};
		render(<WorldMap places={[unknown]} onOpen={() => {}} />);
		expect(screen.queryByRole("button", { name: "moon-base" })).toBeNull();
	});

	it("names an archived marker as archived", () => {
		render(<WorldMap places={[place("Oslo", 59.9139, 10.7522, true)]} onOpen={() => {}} />);
		expect(screen.getByRole("button", { name: "Oslo, archived" })).toBeTruthy();
	});
});
