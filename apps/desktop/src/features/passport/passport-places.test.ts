/**
 * @feature NAV-13 Passport places
 * Owns: tests that a workspace folder name matches a gazetteer place with a country and position,
 * that unknown names stay listed, and that places group.
 * Test first: 'lisbon-v2' matches 'Lisbon' and gives its latitude and longitude.
 */
import type { RepoId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Workspace, WorkspaceState } from "../../core/model.ts";
import { buildPassportPlaces, unvisitedPlaces } from "./passport-places.ts";

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
		archiveCommit: state === "archived" ? "abc123" : null,
		archivedAt: state === "archived" ? 1 : null,
		activeSessionId: null,
		filesCopied: null,
		lastActivityAt: 1,
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("NAV-13 passport places", () => {
	it("matches 'lisbon-v2' to Lisbon and gives its position and country", () => {
		const [place] = buildPassportPlaces([workspace("lisbon-v2")]);
		expect(place).toMatchObject({
			name: "Lisbon",
			country: "Portugal",
			position: { latitude: 38.7223, longitude: -9.1393 },
			archived: false,
		});
		expect(place?.workspaces).toHaveLength(1);
	});

	it("ignores case, accents and a collision suffix", () => {
		const [place] = buildPassportPlaces([workspace("SAO-PAULO-v3")]);
		expect(place).toMatchObject({
			name: "São Paulo",
			country: "Brazil",
			position: { latitude: -23.5505, longitude: -46.6333 },
		});
	});

	it("keeps a name that is not in the gazetteer, with no position", () => {
		const [place] = buildPassportPlaces([workspace("moon-base-v2")]);
		expect(place).toMatchObject({
			name: "moon-base",
			country: null,
			position: null,
		});
	});

	it("groups two workspaces at the same place into one entry", () => {
		const places = buildPassportPlaces([workspace("lisbon"), workspace("lisbon-v2")]);
		expect(places).toHaveLength(1);
		expect(places[0]?.name).toBe("Lisbon");
		expect(places[0]?.workspaces).toHaveLength(2);
	});

	it("marks a place archived only when every workspace there is archived", () => {
		const onlyArchived = buildPassportPlaces([workspace("Oslo", "archived")]);
		expect(onlyArchived[0]?.archived).toBe(true);

		const mixed = buildPassportPlaces([
			workspace("Oslo", "archived"),
			workspace("oslo-v2", "ready"),
		]);
		expect(mixed).toHaveLength(1);
		expect(mixed[0]?.archived).toBe(false);
	});

	it("lists gazetteer places no workspace has visited, each with a country and position", () => {
		const visited = buildPassportPlaces([workspace("lisbon")]);
		const unvisited = unvisitedPlaces(visited);
		expect(unvisited.map((place) => place.name)).not.toContain("Lisbon");
		expect(unvisited.map((place) => place.name)).toContain("Oslo");
		expect(unvisited.length).toBeGreaterThan(0);
		for (const place of unvisited) {
			expect(place.country).not.toBe("");
			expect(Number.isFinite(place.latitude)).toBe(true);
			expect(Number.isFinite(place.longitude)).toBe(true);
		}
	});
});
