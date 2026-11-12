import type { RepoId, SessionId, WorkspaceId } from "@conducted/shared";
import { describe, expect, it } from "vitest";
import type { Workspace } from "../core/model.ts";
import type { WorkspaceSearch } from "../features/workspace/workspace-search.ts";
import {
	chooseRestoreTarget,
	readSavedLocation,
	SAVED_LOCATION_KEY,
	type SavedLocation,
	type SavedLocationStorage,
	saveSavedLocation,
} from "./navigation-history.ts";

function workspace({
	id,
	...overrides
}: Omit<Partial<Workspace>, "id"> & { id: string }): Workspace {
	return {
		id: id as WorkspaceId,
		repoId: "r1" as RepoId,
		directoryName: id,
		path: `/repos/${id}`,
		branch: `branch-${id}`,
		branchIsPlaceholder: false,
		remoteFileSyncEnabled: false,
		host: { kind: "local" },
		displayName: null,
		targetBranch: "main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 50000,
		pinnedAt: null,
		linkedPaths: [],
		prNumber: null,
		prTitle: null,
		prDescription: null,
		archiveCommit: null,
		archivedAt: null,
		activeSessionId: null,
		filesCopied: null,
		lastActivityAt: 0,
		createdAt: 0,
		updatedAt: 0,
		...overrides,
	};
}

const search: WorkspaceSearch = {
	tab: "session",
	sessionId: "saved-session" as SessionId,
};

const savedFor = (workspaceId: string | null, savedSearch: WorkspaceSearch | null = null) =>
	({ workspaceId, search: savedSearch }) satisfies SavedLocation;

describe("NAV-02 chooseRestoreTarget", () => {
	it("restores the saved ready workspace with its saved search", () => {
		const saved = workspace({ id: "w1" });
		const other = workspace({ id: "w2", lastActivityAt: 900 });

		expect(
			chooseRestoreTarget({
				saved: savedFor("w1", search),
				workspaces: [saved, other],
				hasProjects: true,
			}),
		).toEqual({
			kind: "workspace",
			repoId: "r1",
			workspaceId: "w1",
			search,
		});
	});

	it("falls back to the most recently active ready workspace when the saved one is archived", () => {
		const archived = workspace({
			id: "w1",
			state: "archived",
			archivedAt: 500,
			lastActivityAt: 1000,
		});
		const older = workspace({ id: "w2", lastActivityAt: 200 });
		const newer = workspace({ id: "w3", lastActivityAt: 800 });

		expect(
			chooseRestoreTarget({
				saved: savedFor("w1", search),
				workspaces: [archived, older, newer],
				hasProjects: true,
			}),
		).toEqual({
			kind: "workspace",
			repoId: "r1",
			workspaceId: "w3",
			search: null,
		});
	});

	it("falls back to the most recently active ready workspace when the saved one was deleted", () => {
		const older = workspace({ id: "w2", lastActivityAt: 200 });
		const newer = workspace({ id: "w3", lastActivityAt: 800 });

		expect(
			chooseRestoreTarget({
				saved: savedFor("gone"),
				workspaces: [older, newer],
				hasProjects: true,
			}),
		).toMatchObject({ kind: "workspace", workspaceId: "w3" });
	});

	it("skips workspaces that are still initializing or failed when choosing a fallback", () => {
		const initializing = workspace({ id: "w1", state: "initializing", lastActivityAt: 900 });
		const failed = workspace({ id: "w2", state: "failed", lastActivityAt: 800 });
		const ready = workspace({ id: "w3", lastActivityAt: 100 });

		expect(
			chooseRestoreTarget({
				saved: savedFor("gone"),
				workspaces: [initializing, failed, ready],
				hasProjects: true,
			}),
		).toMatchObject({ kind: "workspace", workspaceId: "w3" });
	});

	it("uses the id to break a tie between equally recent workspaces", () => {
		const second = workspace({ id: "w2", lastActivityAt: 500 });
		const first = workspace({ id: "w1", lastActivityAt: 500 });

		expect(
			chooseRestoreTarget({
				saved: savedFor("gone"),
				workspaces: [second, first],
				hasProjects: true,
			}),
		).toMatchObject({ kind: "workspace", workspaceId: "w1" });
	});

	it("opens the empty state on first launch when projects exist but nothing was saved", () => {
		expect(
			chooseRestoreTarget({
				saved: null,
				workspaces: [workspace({ id: "w1" })],
				hasProjects: true,
			}),
		).toEqual({ kind: "empty" });
	});

	it("opens onboarding on a first run with no projects", () => {
		expect(chooseRestoreTarget({ saved: null, workspaces: [], hasProjects: false })).toEqual({
			kind: "onboarding",
		});
	});

	it("opens the empty state when projects exist but no workspace is ready", () => {
		expect(
			chooseRestoreTarget({
				saved: savedFor("gone"),
				workspaces: [workspace({ id: "w1", state: "archived" })],
				hasProjects: true,
			}),
		).toEqual({ kind: "empty" });
	});
});

function memoryStorage(): SavedLocationStorage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
	};
}

describe("NAV-02 saved location", () => {
	it("round-trips the workspace and its search", () => {
		const storage = memoryStorage();
		const saved = { workspaceId: "w1", search } satisfies SavedLocation;

		saveSavedLocation(saved, storage);

		expect(storage.values.get(SAVED_LOCATION_KEY)).toBe(JSON.stringify(saved));
		expect(readSavedLocation(storage)).toEqual(saved);
	});

	it("drops a search value the search schema cannot use", () => {
		const storage = memoryStorage();
		storage.setItem(
			SAVED_LOCATION_KEY,
			JSON.stringify({ workspaceId: "w1", search: { tab: "nope" } }),
		);

		expect(readSavedLocation(storage)).toEqual({ workspaceId: "w1", search: {} });
	});

	it("returns null for unreadable text or a missing workspace id", () => {
		const storage = memoryStorage();
		storage.setItem(SAVED_LOCATION_KEY, "not json");
		expect(readSavedLocation(storage)).toBeNull();

		storage.setItem(SAVED_LOCATION_KEY, JSON.stringify({ workspaceId: 7 }));
		expect(readSavedLocation(storage)).toBeNull();

		storage.setItem(SAVED_LOCATION_KEY, JSON.stringify({ workspaceId: "" }));
		expect(readSavedLocation(storage)).toBeNull();
	});

	it("clears the value when there is no workspace", () => {
		const storage = memoryStorage();
		saveSavedLocation({ workspaceId: "w1", search: null }, storage);

		saveSavedLocation({ workspaceId: null, search: null }, storage);

		expect(readSavedLocation(storage)).toBeNull();
	});

	it("does nothing when storage is unavailable", () => {
		expect(readSavedLocation(null)).toBeNull();
		expect(() => saveSavedLocation({ workspaceId: "w1", search: null }, null)).not.toThrow();
	});
});
