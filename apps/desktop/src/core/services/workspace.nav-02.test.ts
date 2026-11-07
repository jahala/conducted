/**
 * @feature NAV-02 Active chat tab per workspace
 * Owns: remembering the chat tab a workspace had open, so a restart reopens it.
 * Behaviour: ui-map.md 2 (the workspace route restores the last active search).
 * Test first: saving a chat tab writes it to the repository and to the workspace store.
 */
import { appError, err, ok, type SessionId, type WorkspaceId } from "@conducted/shared";
import { describe, expect, it, vi } from "vitest";
import type { Workspace } from "../model.ts";
import { WorkspaceService, type WorkspaceServiceDeps } from "./workspace.ts";

function workspace(overrides: Partial<Workspace> = {}): Workspace {
	return {
		id: "w1" as WorkspaceId,
		repoId: "r1" as Workspace["repoId"],
		directoryName: "w1",
		path: "/repos/w1",
		branch: "branch-w1",
		branchIsPlaceholder: false,
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

function serviceWith(
	row: Workspace,
	setActiveSession: WorkspaceServiceDeps["repos"]["workspaces"]["setActiveSession"],
): WorkspaceService {
	const service = new WorkspaceService({
		repos: { workspaces: { setActiveSession } },
	} as unknown as WorkspaceServiceDeps);
	service.store.setState({
		loaded: true,
		workspacesById: { [row.id]: row },
		setup: {},
		archiving: {},
	});
	return service;
}

describe("NAV-02 workspace active chat tab", () => {
	it("writes the chat tab to the repository and the store", async () => {
		const row = workspace();
		const write = vi.fn(async () => ok(undefined));
		const service = serviceWith(row, write);

		const result = await service.setActiveSession(row.id, "s1" as SessionId);

		expect(result.ok).toBe(true);
		expect(write).toHaveBeenCalledWith(row.id, "s1");
		expect(service.store.getState().workspacesById[row.id]?.activeSessionId).toBe("s1");
	});

	it("leaves the store alone when the write fails", async () => {
		const row = workspace();
		const write = vi.fn(async () =>
			err(appError("db.not_found", "Saving the active chat: the row no longer exists")),
		);
		const service = serviceWith(row, write);

		const result = await service.setActiveSession(row.id, "s1" as SessionId);

		expect(result.ok).toBe(false);
		expect(service.store.getState().workspacesById[row.id]?.activeSessionId).toBeNull();
	});
});
