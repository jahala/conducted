import type { RepoId, WorkspaceId } from "@conducted/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServicesProvider } from "../../core/context.tsx";
import { useWorkspaces } from "../../core/hooks.ts";
import type { Workspace } from "../../core/model.ts";
import { createTestContainer, type TestContainer } from "../../test/container.ts";

function workspace(id: string, createdAt: number): Workspace {
	return {
		id: id as WorkspaceId,
		repoId: "app" as RepoId,
		directoryName: id,
		path: `/workspaces/${id}`,
		branch: id,
		branchIsPlaceholder: false,
		displayName: null,
		targetBranch: "main",
		state: "ready",
		kanbanStatus: "in_progress",
		port: 0,
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
		lastActivityAt: createdAt,
		createdAt,
		updatedAt: createdAt,
	};
}

let test: TestContainer;

beforeEach(() => {
	test = createTestContainer();
});

afterEach(() => {
	cleanup();
	test.close();
});

function setup() {
	const store = test.container.services.workspace.store;
	store.setState({
		loaded: false,
		backlogLoaded: false,
		backlogById: {},
		workspacesById: {},
		setup: {},
		archiving: {},
	});
	const wrapper = ({ children }: { children: ReactNode }) => (
		<ServicesProvider container={test.container}>{children}</ServicesProvider>
	);
	return { store, wrapper };
}

describe("NAV-03 useWorkspaces", () => {
	it("is loading until the workspace store has loaded", () => {
		const { wrapper } = setup();
		const { result } = renderHook(() => useWorkspaces(), { wrapper });
		expect(result.current).toEqual({ state: "loading" });
	});

	it("returns every workspace in creation order once loaded", () => {
		const { store, wrapper } = setup();
		act(() => {
			store.setState({
				loaded: true,
				workspacesById: {
					second: workspace("second", 20),
					first: workspace("first", 10),
				},
			});
		});
		const { result } = renderHook(() => useWorkspaces(), { wrapper });
		expect(result.current).toEqual({
			state: "ready",
			data: [workspace("first", 10), workspace("second", 20)],
		});
	});
});
